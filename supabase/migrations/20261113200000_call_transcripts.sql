-- Answered calls: what was said. Quo transcribes and summarises calls (on plans
-- with it); the quo function fetches both the first time a call's card is
-- opened and keeps them on the call, so the card's activity shows them and the
-- AI reads them before suggesting a next step.
begin;

-- Keep a call's summary and transcript (service role, from the quo function).
-- notesStatus says they were looked for: completed, absent (none, or the plan
-- has no transcripts), failed. Anything else is tried again.
create function public.quo_save_call_notes(requested_org uuid, requested_id text, requested_notes jsonb)
returns void
language sql security definer set search_path = ''
as $$
  update public.conversation_messages
  set call = coalesce(call, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
    'notesStatus', requested_notes ->> 'status',
    'summary', requested_notes -> 'summary',
    'nextSteps', requested_notes -> 'nextSteps',
    'transcript', left(requested_notes ->> 'transcript', 12000)))
  where org_id = requested_org and channel = 'call' and provider_message_id = requested_id
$$;
revoke all on function public.quo_save_call_notes(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.quo_save_call_notes(uuid, text, jsonb) to service_role;

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
              and (o.conversation_id = any(threads) or (deal.contact_id is not null and o.contact_id = deal.contact_id))
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
    left join public.contacts c on c.id = deal.contact_id
    left join public.project_directory d on d.id = card.lead_id
    left join public.conversations cv on cv.id = card.conversation_id);
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
