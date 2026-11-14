-- Appointment workflows, for accuracy:
-- * workflow_card returns the contact's history (every deal, proposal, job
--   and past visit) and their scheduled visits across all their deals, so the
--   AI can tell whether there is still an estimate to book.
-- * Cards remember the times we texted (offered), so a reply like "Tuesday
--   works" can be booked as the exact time we offered, if it's still free.

alter table public.workflow_cards add column if not exists offered jsonb not null default '[]'::jsonb;

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
  deal_ids uuid[];
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
  -- Every deal this person has (or just the card's), for their history.
  deal_ids := array(
    select l.id from public.leads l
    where l.org_id = company and (l.id = card.lead_id or (person is not null and l.contact_id = person)));
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
        where a.project_id = any(deal_ids) and a.status = 'scheduled'), '[]'::jsonb),
      -- What this person has done with us, so the AI (and the manager) know
      -- whether there's still an estimate to book.
      'history', jsonb_build_object(
        'deals', coalesce((
          select jsonb_agg(jsonb_build_object('id', l.id, 'status', l.status, 'createdAt', l.created_at,
              'address', nullif(btrim(l.address), ''),
              'thisCard', l.id is not distinct from card.lead_id) order by l.created_at desc)
          from (select * from public.leads where id = any(deal_ids) order by created_at desc limit 10) l), '[]'::jsonb),
        'proposals', coalesce((
          select jsonb_agg(jsonb_build_object('dealId', q.lead_id, 'name', q.name, 'status', q.status,
              'amountCents', q.amount_cents, 'sentAt', q.sent_at, 'acceptedAt', q.accepted_at, 'declinedAt', q.declined_at)
            order by coalesce(q.accepted_at, q.sent_at, q.created_at) desc)
          from (select * from public.quotes where org_id = company and lead_id = any(deal_ids)
              and status not in ('draft', 'superseded') order by coalesce(accepted_at, sent_at, created_at) desc limit 10) q), '[]'::jsonb),
        'jobs', coalesce((
          select jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'status', j.status, 'amountCents', j.contract_amount_cents,
              'scheduledOn', j.scheduled_on, 'completedOn', j.completed_on, 'address', nullif(btrim(j.formatted_address), ''))
            order by j.created_at desc)
          from (select * from public.jobs where org_id = company
              and (lead_id = any(deal_ids) or (person is not null and contact_id = person))
              order by created_at desc limit 10) j), '[]'::jsonb),
        'pastVisits', coalesce((
          select jsonb_agg(jsonb_build_object('startsAt', a.starts_at, 'status', a.status) order by a.starts_at desc)
          from (select * from public.appointments where project_id = any(deal_ids)
              and (status <> 'scheduled' or starts_at < now()) order by starts_at desc limit 10) a), '[]'::jsonb)),
      'offered', card.offered,
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

-- The times the approved text offered: [{personId, person, startsAt}].
create or replace function public.workflow_save_offered(requested_card uuid, requested_offered jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := public.booking_staff_org();
begin
  if jsonb_typeof(requested_offered) is distinct from 'array' or jsonb_array_length(requested_offered) > 6 then
    raise exception 'Offered times must be a short list.' using errcode = '22023';
  end if;
  update public.workflow_cards set
    offered = (
      select coalesce(jsonb_agg(jsonb_build_object(
          'personId', t ->> 'personId', 'person', left(t ->> 'person', 120),
          'startsAt', (t ->> 'startsAt')::timestamptz, 'sentAt', now())), '[]'::jsonb)
      from jsonb_array_elements(requested_offered) t
      where (t ->> 'personId') is not null and (t ->> 'startsAt') is not null),
    updated_at = now()
  where id = requested_card and org_id = company;
  if not found then
    raise exception 'That card is gone.' using errcode = 'P0002';
  end if;
end
$$;

revoke all on function public.workflow_save_offered(uuid, jsonb) from public, anon;
grant execute on function public.workflow_save_offered(uuid, jsonb) to authenticated;
