-- Appointment workflows: a Communication column. Every text, call and email
-- from anyone outside the team lands there, returning customers and ongoing
-- conversations included (only the team's own numbers are skipped). The AI then
-- sorts it: something to book moves to New with its suggestion, something it
-- can't act on to Needs you, and anything else stays in Communication until
-- someone closes it.
begin;

alter table public.workflow_cards drop constraint workflow_cards_stage_check;
alter table public.workflow_cards add constraint workflow_cards_stage_check
  check (stage in ('communication', 'new', 'waiting', 'needs_you', 'booked', 'closed'));
alter table public.workflow_cards drop constraint workflow_cards_kind_check;
alter table public.workflow_cards add constraint workflow_cards_kind_check
  check (kind in ('lead', 'missed_call', 'voicemail', 'call', 'text', 'email'));

-- A lead form is a booking request: straight to New.
create or replace function private.workflow_lead_arrived()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.metadata ->> 'created_by' = 'lead_intake' and new.status in ('new', 'contacted') then
    insert into public.workflow_cards (org_id, lead_id, kind, stage, activity_at)
    values (new.org_id, new.id, 'lead', 'new', coalesce(new.captured_at, new.created_at))
    on conflict (lead_id) do nothing;
  end if;
  return null;
end
$$;

-- A text, call, voicemail or email from outside the team. It joins the card
-- that person already has (their conversation's, or their latest lead's), or
-- starts one in Communication. A reply while we were waiting goes back to New;
-- a message on a booked or closed card brings it back to Communication. Either
-- way the old suggestion is dropped so the AI looks again. A voicemail can
-- arrive after its call.
create or replace function private.workflow_message_arrived()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  conversation public.conversations%rowtype;
  what text;
  existing uuid;
begin
  if new.direction <> 'inbound' or new.channel not in ('sms', 'call', 'email') then
    return null;
  end if;
  if tg_op = 'UPDATE' and (new.call -> 'voicemail') is not distinct from (old.call -> 'voicemail') then
    return null;
  end if;
  select * into conversation from public.conversations where id = new.conversation_id;
  if private.workflow_is_team_number(conversation.org_id, coalesce(conversation.handle,
      (select c.phone from public.contacts c where c.id = conversation.contact_id))) then
    return null;
  end if;
  what := case
    when new.channel = 'sms' then 'text'
    when new.channel = 'email' then 'email'
    when jsonb_typeof(new.call -> 'voicemail') = 'object' then 'voicemail'
    when not coalesce((new.call ->> 'answered')::boolean, false) then 'missed_call'
    else 'call' end;

  select w.id into existing
  from public.workflow_cards w
  where w.org_id = conversation.org_id
    and (w.conversation_id = conversation.id
      or (conversation.contact_id is not null
        and w.lead_id in (select l.id from public.leads l where l.contact_id = conversation.contact_id)))
  order by (w.stage in ('communication', 'new', 'waiting', 'needs_you')) desc, w.activity_at desc
  limit 1;

  if existing is null then
    insert into public.workflow_cards (org_id, conversation_id, kind, stage, activity_at)
    values (conversation.org_id, conversation.id, what, 'communication', new.received_at);
  else
    update public.workflow_cards w set
      kind = case when what = 'voicemail' and w.kind in ('missed_call', 'call') then 'voicemail' else w.kind end,
      stage = case w.stage when 'waiting' then 'new' when 'booked' then 'communication' when 'closed' then 'communication' else w.stage end,
      reason = case when w.stage in ('booked', 'closed') then null else w.reason end,
      suggestion = case when w.stage = 'needs_you' then w.suggestion else null end,
      suggested_at = case when w.stage = 'needs_you' then w.suggested_at else null end,
      activity_at = greatest(w.activity_at, new.received_at),
      updated_at = now()
    where w.id = existing;
  end if;
  return null;
end
$$;
drop function if exists private.workflow_already_talking(uuid, timestamptz);

create or replace function private.workflow_appointment_booked()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'scheduled' and new.project_id is not null then
    update public.workflow_cards set stage = 'booked', suggestion = null, suggested_at = null, updated_at = now()
    where lead_id = new.project_id and stage in ('communication', 'new', 'waiting', 'needs_you');
  end if;
  return null;
end
$$;

-- The lead to act on. The card's; for a returning customer, their open lead
-- or a new one; for an unknown number, a new customer and lead once their name
-- and address are known. If that lead already has a card, this one joins it.
create or replace function private.workflow_lead(company uuid, card public.workflow_cards, requested_name text,
  requested_address text, requested_email text, requested_request text, required boolean)
returns public.workflow_cards
language plpgsql security definer set search_path = ''
as $$
declare
  customer uuid := (select cv.contact_id from public.conversations cv where cv.id = card.conversation_id);
  deal uuid;
  entry public.pipeline_stages%rowtype;
  other public.workflow_cards%rowtype;
begin
  if card.lead_id is not null then
    return card;
  end if;
  if customer is not null then
    select l.id into deal from public.leads l
    where l.contact_id = customer and l.org_id = company and l.status in ('new', 'contacted', 'estimate_scheduled')
    order by l.created_at desc limit 1;
    if deal is null then
      deal := extensions.gen_random_uuid();
      perform set_config('serviceflow.org_id', company::text, true);
      select * into entry from public.pipeline_stages
      where org_id = company and pipeline = 'sales' and not is_closed
      order by position limit 1;
      insert into public.leads (id, contact_id, status, source, address, created_at, captured_at, metadata, org_id)
      values (deal, customer, coalesce(entry.record_status, 'new'), 'Returning customer',
        coalesce(left(nullif(btrim(requested_address), ''), 300),
          (select nullif(btrim(l.address), '') from public.leads l where l.contact_id = customer order by l.created_at desc limit 1)),
        now(), now(), jsonb_build_object('created_by', 'appointment_workflows'), company);
      if entry.id is not null then
        insert into public.pipeline_placements (record_id, org_id, stage_id, moved_by)
        values (deal, company, entry.id, auth.uid());
      end if;
      if nullif(btrim(requested_request), '') is not null then
        insert into public.project_notes (org_id, project_id, body, created_by)
        values (company, deal, left(btrim(requested_request), 4000), auth.uid());
      end if;
    end if;
  else
    if nullif(btrim(requested_name), '') is null or nullif(btrim(requested_address), '') is null then
      if required then
        raise exception 'Add their name and address first.' using errcode = '22023';
      end if;
      return card;
    end if;
    deal := (public.agent_create_lead(company, card.conversation_id, requested_name, requested_address,
      requested_email, requested_request) ->> 'leadId')::uuid;
  end if;
  select * into other from public.workflow_cards where lead_id = deal and id <> card.id;
  if found then
    delete from public.workflow_cards where id = card.id;
    update public.workflow_cards set stage = card.stage, updated_at = now() where id = other.id returning * into other;
    return other;
  end if;
  update public.workflow_cards set lead_id = deal, updated_at = now() where id = card.id returning * into card;
  return card;
end
$$;

create or replace function public.workflow_board()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := public.booking_staff_org();
begin
  return coalesce((
    select jsonb_agg(x.card order by x.activity_at desc)
    from (
      select w.activity_at, jsonb_build_object(
        'id', w.id, 'stage', w.stage, 'kind', w.kind, 'leadId', w.lead_id,
        'name', coalesce(nullif(btrim(c.name), ''), c.phone, cv.handle, 'Unknown'),
        'phone', coalesce(c.phone, cv.handle),
        'address', coalesce(nullif(btrim(d.address), ''), l.address),
        'source', l.source,
        'reason', w.reason,
        'activityAt', w.activity_at,
        'suggestion', case when w.suggestion is null then null
          else jsonb_build_object('action', w.suggestion ->> 'action', 'summary', w.suggestion ->> 'summary') end,
        'latest', coalesce(
          (select private.stored_message_preview(m) from public.conversation_messages m
            where m.conversation_id = any(private.workflow_conversations(w)) and m.direction = 'inbound'
            order by m.received_at desc limit 1),
          (select left(n.body, 200) from public.project_notes n where n.project_id = w.lead_id order by n.created_at limit 1)),
        'appointment', (select jsonb_build_object('startsAt', a.starts_at,
            'with', coalesce(nullif(btrim(e.full_name), ''), e.email))
          from public.appointments a left join public.employees e on e.id = a.assigned_to
          where a.project_id = w.lead_id and a.status = 'scheduled'
          order by a.starts_at desc limit 1)
      ) as card
      from public.workflow_cards w
      left join public.leads l on l.id = w.lead_id
      left join public.conversations cv on cv.id = w.conversation_id
      left join public.contacts c on c.id = coalesce(l.contact_id, cv.contact_id)
      left join public.project_directory d on d.id = w.lead_id
      where w.org_id = company
        and (w.stage in ('communication', 'new', 'waiting', 'needs_you') or w.updated_at > now() - interval '14 days')
      order by w.activity_at desc
      limit 300) x), '[]'::jsonb);
end
$$;

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
  person uuid;
begin
  select * into card from public.workflow_cards where id = requested_card and org_id = company;
  if not found then
    raise exception 'That card is gone.' using errcode = 'P0002';
  end if;
  select * into deal from public.leads where id = card.lead_id;
  -- A returning customer writing in has a contact but no lead on the card yet.
  person := coalesce(deal.contact_id, (select cv.contact_id from public.conversations cv where cv.id = card.conversation_id));
  select * into settings from private.workflow_settings where org_id = company;
  zone := coalesce((select timezone from public.organizations where id = company), 'America/Toronto');
  threads := private.workflow_conversations(card);
  return (
    select jsonb_build_object(
      'id', card.id, 'stage', card.stage, 'kind', card.kind, 'reason', card.reason,
      'leadId', card.lead_id, 'conversationId', card.conversation_id,
      'name', coalesce(nullif(btrim(c.name), ''), null),
      'phone', coalesce(c.phone, cv.handle), 'email', c.email,
      'address', coalesce(nullif(btrim(d.address), ''), deal.address,
        (select nullif(btrim(l.address), '') from public.leads l where l.contact_id = person order by l.created_at desc limit 1)),
      'source', deal.source, 'leadStatus', deal.status,
      'optedOut', exists (select 1 from public.message_opt_outs o where o.contact_id = person and o.channel = 'sms'),
      'timezone', zone,
      'now', to_char(now() at time zone zone, 'FMDay, FMMonth FMDD, YYYY "at" FMHH12:MI AM'),
      'notes', coalesce((select jsonb_agg(n.body order by n.created_at) from public.project_notes n
        where n.project_id = card.lead_id), '[]'::jsonb),
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object('direction', m.direction, 'channel', m.channel, 'text', m.text,
            'subject', m.subject, 'by', m.sender, 'ai', m.from_agent, 'at', m.happened_at,
            'callId', m.call_id, 'call', m.call)
          order by m.happened_at)
        from (
          select * from (
            select 'outbound' as direction, o.channel, o.body as text, nullif(btrim(o.subject), '') as subject,
              coalesce(o.sent_at, o.scheduled_for, o.created_at) as happened_at,
              (select nullif(btrim(e.full_name), '') from public.employees e where e.id = o.created_by) as sender,
              o.sent_by_agent as from_agent, null::text as call_id, null::jsonb as call
            from public.outbound_messages o
            where o.org_id = company and o.status not in ('cancelled', 'skipped')
              and (o.conversation_id = any(threads) or (person is not null and o.contact_id = person))
            union all
            select cm.direction, cm.channel, private.agent_message_text(cm.channel, cm.direction, cm.body, cm.call),
              nullif(btrim(cm.subject), ''), cm.received_at, null, false,
              case when cm.channel = 'call' then cm.provider_message_id end,
              case when cm.channel = 'call' then jsonb_strip_nulls(jsonb_build_object(
                'answered', coalesce((cm.call ->> 'answered')::boolean, false),
                'seconds', (cm.call ->> 'duration')::integer,
                'notes', cm.call ->> 'notesStatus',
                'summary', cm.call -> 'summary', 'nextSteps', cm.call -> 'nextSteps',
                'transcript', cm.call ->> 'transcript')) end
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
    left join public.contacts c on c.id = person
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
    -- The AI sorts what comes in: something to book goes to New, something
    -- it can't act on to Needs you, and the rest stays in Communication.
    stage = case
      when requested_suggestion ->> 'action' = 'needs_you' and stage in ('communication', 'new', 'waiting') then 'needs_you'
      when requested_suggestion ->> 'action' in ('text', 'book', 'wait') and stage = 'communication' then 'new'
      else stage end,
    reason = case when requested_suggestion ->> 'action' = 'needs_you' and stage in ('communication', 'new', 'waiting')
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

select pg_notify('pgrst', 'reload schema');

commit;
