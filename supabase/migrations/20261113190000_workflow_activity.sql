-- Appointment workflows: a card opens as the contact's whole activity, not
-- just the latest texts. Everything with them in one feed: texts, calls,
-- voicemails and emails (with subject and who sent each), and what the AI
-- suggested and a manager did on the card (workflow_events).
begin;

create table public.workflow_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  card_id uuid not null references public.workflow_cards(id) on delete cascade,
  -- suggested, needs_you (the AI); sent, booked, taken, closed, reopened (a manager).
  kind text not null check (kind in ('suggested', 'needs_you', 'sent', 'booked', 'taken', 'closed', 'reopened')),
  summary text check (char_length(summary) <= 500),
  actor uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index workflow_events_card_idx on public.workflow_events (card_id, created_at);
alter table public.workflow_events enable row level security;
revoke all on public.workflow_events from public, anon, authenticated;

-- The AI's entries have no actor: a manager only opened the board.
create function private.workflow_log(card uuid, company uuid, what text, about text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.workflow_events (org_id, card_id, kind, summary, actor)
  values (company, card, what, left(about, 500), case when what in ('suggested', 'needs_you') then null else auth.uid() end)
$$;
revoke all on function private.workflow_log(uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.workflow_card(requested_card uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := public.booking_staff_org();
  card public.workflow_cards%rowtype;
  deal public.leads%rowtype;
  settings private.workflow_settings%rowtype;
  zone text;
  threads uuid[];
begin
  select * into card from public.workflow_cards where id = requested_card and org_id = company;
  if not found then
    raise exception 'That card is gone.' using errcode = 'P0002';
  end if;
  select * into deal from public.leads where id = card.lead_id;
  select * into settings from private.workflow_settings where org_id = company;
  zone := coalesce((select timezone from public.organizations where id = company), 'America/Toronto');
  threads := private.workflow_conversations(card);
  return (
    select jsonb_build_object(
      'id', card.id, 'stage', card.stage, 'kind', card.kind, 'reason', card.reason,
      'leadId', card.lead_id, 'conversationId', card.conversation_id,
      'name', coalesce(nullif(btrim(c.name), ''), null),
      'phone', coalesce(c.phone, cv.handle), 'email', c.email,
      'address', coalesce(nullif(btrim(d.address), ''), deal.address),
      'source', deal.source, 'leadStatus', deal.status,
      'optedOut', exists (select 1 from public.message_opt_outs o where o.contact_id = deal.contact_id and o.channel = 'sms'),
      'timezone', zone,
      'now', to_char(now() at time zone zone, 'FMDay, FMMonth FMDD, YYYY "at" FMHH12:MI AM'),
      'notes', coalesce((select jsonb_agg(n.body order by n.created_at) from public.project_notes n
        where n.project_id = card.lead_id), '[]'::jsonb),
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object('direction', m.direction, 'channel', m.channel, 'text', m.text,
            'subject', m.subject, 'by', m.sender, 'ai', m.from_agent, 'at', m.happened_at)
          order by m.happened_at)
        from (
          select * from (
            select 'outbound' as direction, o.channel, o.body as text, nullif(btrim(o.subject), '') as subject,
              coalesce(o.sent_at, o.scheduled_for, o.created_at) as happened_at,
              (select nullif(btrim(e.full_name), '') from public.employees e where e.id = o.created_by) as sender,
              o.sent_by_agent as from_agent
            from public.outbound_messages o
            where o.org_id = company and o.status not in ('cancelled', 'skipped')
              and (o.conversation_id = any(threads) or (deal.contact_id is not null and o.contact_id = deal.contact_id))
            union all
            select cm.direction, cm.channel, private.agent_message_text(cm.channel, cm.direction, cm.body, cm.call),
              nullif(btrim(cm.subject), ''), cm.received_at, null, false
            from public.conversation_messages cm where cm.conversation_id = any(threads)
          ) everything
          order by happened_at desc
          limit 100) m), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(jsonb_build_object('kind', v.kind, 'summary', v.summary, 'at', v.created_at,
            'by', (select nullif(btrim(e.full_name), '') from public.employees e where e.id = v.actor)) order by v.created_at)
        from public.workflow_events v where v.card_id = card.id), '[]'::jsonb),
      'createdAt', card.created_at,
      'appointments', coalesce((
        select jsonb_agg(jsonb_build_object('startsAt', a.starts_at, 'with', coalesce(nullif(btrim(e.full_name), ''), e.email))
          order by a.starts_at)
        from public.appointments a left join public.employees e on e.id = a.assigned_to
        where a.project_id = card.lead_id and a.status = 'scheduled'), '[]'::jsonb),
      'settings', jsonb_build_object('prompt', coalesce(settings.prompt, ''), 'skills', coalesce(settings.skills, '[]'::jsonb),
        'minutes', coalesce(settings.appointment_minutes, 60)),
      'people', public.workflow_people(),
      'suggestion', card.suggestion, 'suggestedAt', card.suggested_at)
    from (select 1) one
    left join public.contacts c on c.id = deal.contact_id
    left join public.project_directory d on d.id = card.lead_id
    left join public.conversations cv on cv.id = card.conversation_id);
end
$$;

create or replace function public.save_workflow_suggestion(requested_card uuid, requested_suggestion jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := public.booking_staff_org();
begin
  update public.workflow_cards set
    suggestion = requested_suggestion, suggested_at = now(),
    stage = case when requested_suggestion ->> 'action' = 'needs_you' and stage in ('new', 'waiting') then 'needs_you' else stage end,
    reason = case when requested_suggestion ->> 'action' = 'needs_you' and stage in ('new', 'waiting')
      then left(requested_suggestion ->> 'reason', 500) else reason end,
    updated_at = now()
  where id = requested_card and org_id = company;
  if found then
    perform private.workflow_log(requested_card, company,
      case when requested_suggestion ->> 'action' = 'needs_you' then 'needs_you' else 'suggested' end,
      case when requested_suggestion ->> 'action' in ('needs_you', 'close')
        then coalesce(nullif(requested_suggestion ->> 'reason', ''), requested_suggestion ->> 'summary')
        else coalesce(nullif(requested_suggestion ->> 'summary', ''), requested_suggestion ->> 'reason') end);
  end if;
end
$$;

create or replace function public.workflow_send_text(requested_card uuid, requested_body text,
  requested_name text default null, requested_address text default null,
  requested_email text default null, requested_request text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := public.booking_staff_org();
  card public.workflow_cards%rowtype;
  sent jsonb;
begin
  select * into card from public.workflow_cards where id = requested_card and org_id = company for update;
  if not found then
    raise exception 'That card is gone.' using errcode = 'P0002';
  end if;
  card := private.workflow_lead(company, card, requested_name, requested_address, requested_email, requested_request, false);
  sent := case when card.lead_id is not null
    then public.agent_send_text(company, card.lead_id, requested_body)
    else public.agent_text_inquiry(company, card.conversation_id, requested_body) end;
  update public.outbound_messages set created_by = auth.uid() where id = (sent ->> 'messageId')::uuid;
  update public.workflow_cards set stage = 'waiting', suggestion = null, suggested_at = null, reason = null, updated_at = now()
  where id = card.id;
  perform private.workflow_log(card.id, company, 'sent', null);
  return jsonb_build_object('cardId', card.id);
end
$$;

create or replace function public.workflow_book(requested_card uuid, requested_person uuid, requested_starts_at timestamptz,
  requested_name text default null, requested_address text default null,
  requested_email text default null, requested_request text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := public.booking_staff_org();
  card public.workflow_cards%rowtype;
  booked jsonb;
  minutes integer := coalesce((select appointment_minutes from private.workflow_settings where org_id = company), 60);
begin
  select * into card from public.workflow_cards where id = requested_card and org_id = company for update;
  if not found then
    raise exception 'That card is gone.' using errcode = 'P0002';
  end if;
  card := private.workflow_lead(company, card, requested_name, requested_address, requested_email, requested_request, true);
  booked := public.agent_book_estimate(company, card.lead_id, requested_person, requested_starts_at, minutes);
  update public.appointments set created_by = auth.uid(), notes = 'Booked from Appointment workflows.'
  where id = (booked ->> 'appointmentId')::uuid;
  update public.workflow_cards set stage = 'booked', suggestion = null, suggested_at = null, reason = null, updated_at = now()
  where id = card.id;
  perform private.workflow_log(card.id, company, 'booked', (booked ->> 'when') || ' with ' || (booked ->> 'with'));
  return booked;
end
$$;

create or replace function public.workflow_move(requested_card uuid, requested_stage text, requested_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := public.booking_staff_org();
begin
  if requested_stage not in ('new', 'waiting', 'needs_you', 'closed') then
    raise exception 'Unknown column.' using errcode = '22023';
  end if;
  update public.workflow_cards set
    stage = requested_stage,
    reason = case when requested_stage in ('needs_you', 'closed') then left(nullif(btrim(requested_reason), ''), 500) end,
    suggestion = case when requested_stage = 'new' then null else suggestion end,
    suggested_at = case when requested_stage = 'new' then null else suggested_at end,
    updated_at = now()
  where id = requested_card and org_id = company;
  if not found then
    raise exception 'That card is gone.' using errcode = 'P0002';
  end if;
  perform private.workflow_log(requested_card, company,
    case requested_stage when 'needs_you' then 'taken' when 'closed' then 'closed' else 'reopened' end,
    nullif(btrim(requested_reason), ''));
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
