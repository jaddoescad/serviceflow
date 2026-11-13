-- Lead agent: an outside AI agent (Grok Bot, Claude, ...) turns new leads,
-- and missed calls, voicemails and texts from unknown numbers, into booked
-- estimates through the lead-agent function (an MCP server). A manager
-- makes a key in Settings › Integrations; the function trades the key for its
-- company and calls the agent_* functions below, which only the service role
-- can run. The rules live here, whatever the agent tries: texts only 8 AM to
-- 8 PM company time, never to someone who opted out or wrote STOP, at most two
-- unanswered texts, a booking only for someone who takes appointments at a
-- time still free, and nothing on a lead once it is handed to a person.
begin;

create table private.agent_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  -- sha256 of the key, hex; the key itself is shown once and never stored.
  key_hash text not null unique,
  key_prefix text not null,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index agent_keys_org_idx on private.agent_keys (org_id, created_at desc);
alter table private.agent_keys enable row level security;
revoke all on private.agent_keys from public, anon, authenticated;

-- A lead the agent gave to a person; the agent no longer acts on it.
alter table public.leads
  add column if not exists agent_handoff_at timestamptz,
  add column if not exists agent_handoff_reason text check (char_length(agent_handoff_reason) <= 500);

alter table public.outbound_messages
  add column if not exists sent_by_agent boolean not null default false;

-- A conversation with an unknown number (a missed call, voicemail or text
-- from someone not yet a customer) the agent closed: not a lead, or given to a person.
alter table public.conversations
  add column if not exists agent_closed_at timestamptz,
  add column if not exists agent_closed_reason text check (char_length(agent_closed_reason) <= 500);

-- Keys, for managers (Settings › Integrations) -------------------------------

create function public.create_agent_key(requested_name text default 'Lead agent')
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.web_org_id();
  secret text := 'sfa_' || encode(extensions.gen_random_bytes(24), 'hex');
  new_id uuid := extensions.gen_random_uuid();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can create agent keys.' using errcode = '42501';
  end if;
  insert into private.agent_keys (id, org_id, name, key_hash, key_prefix, created_by)
  values (new_id, company, coalesce(nullif(left(btrim(requested_name), 80), ''), 'Lead agent'),
    encode(extensions.digest(secret, 'sha256'), 'hex'), left(secret, 12), auth.uid());
  return jsonb_build_object('id', new_id, 'key', secret);
end
$$;

create function public.list_agent_keys()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.web_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see agent keys.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', k.id, 'name', k.name, 'prefix', k.key_prefix, 'createdAt', k.created_at,
      'createdBy', coalesce(nullif(btrim(e.full_name), ''), e.email), 'lastUsedAt', k.last_used_at,
      'revokedAt', k.revoked_at) order by k.created_at desc)
    from private.agent_keys k
    left join public.employees e on e.id = k.created_by
    where k.org_id = company), '[]'::jsonb);
end
$$;

create function public.revoke_agent_key(requested_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.web_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can turn off agent keys.' using errcode = '42501';
  end if;
  update private.agent_keys set revoked_at = now()
  where id = requested_id and org_id = company and revoked_at is null;
end
$$;

revoke all on function public.create_agent_key(text) from public, anon;
revoke all on function public.list_agent_keys() from public, anon;
revoke all on function public.revoke_agent_key(uuid) from public, anon;
grant execute on function public.create_agent_key(text) to authenticated;
grant execute on function public.list_agent_keys() to authenticated;
grant execute on function public.revoke_agent_key(uuid) to authenticated;

-- The agent's actions (service role only) -----------------------------------

-- The company a working key belongs to, or null.
create function public.agent_key_org(requested_hash text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid;
begin
  update private.agent_keys set last_used_at = now()
  where key_hash = requested_hash and revoked_at is null
  returning org_id into company;
  return company;
end
$$;

-- A stored message as the agent reads it: calls as "Missed call" or the
-- whole voicemail transcript.
create function private.agent_message_text(channel text, direction text, body text, call jsonb)
returns text
language sql stable set search_path = ''
as $$
  select case
    when channel <> 'call' then body
    when nullif(btrim(call #>> '{voicemail,transcript}'), '') is not null
      then 'Voicemail: ' || btrim(call #>> '{voicemail,transcript}')
    else private.call_preview(direction, call) end
$$;

-- A lead of the company the agent may act on, else an error it can read.
create function private.agent_lead(company uuid, requested_lead uuid, acting boolean)
returns public.leads
language plpgsql stable security definer set search_path = ''
as $$
declare
  deal public.leads%rowtype;
begin
  select * into deal from public.leads where id = requested_lead and org_id = company;
  if not found then
    raise exception 'No lead with that id.' using errcode = 'P0002';
  end if;
  if acting and deal.agent_handoff_at is not null then
    raise exception 'This lead was handed to a person; leave it to them.' using errcode = '42501';
  end if;
  if acting and deal.status in ('won', 'lost', 'cancelled') then
    raise exception 'This lead is closed.' using errcode = '42501';
  end if;
  return deal;
end
$$;

-- New leads with nobody booked yet, newest first.
create function public.agent_new_leads(requested_org uuid, requested_since timestamptz)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(x.lead order by x.created_at desc), '[]'::jsonb)
  from (
    select l.created_at, jsonb_build_object(
      'leadId', l.id, 'name', c.name, 'phone', c.phone, 'email', c.email,
      'address', coalesce(nullif(btrim(d.address), ''), l.address), 'source', l.source, 'createdAt', l.created_at,
      'request', (select n.body from public.project_notes n where n.project_id = l.id order by n.created_at limit 1),
      'textsSent', (select count(*) from public.outbound_messages m
        where m.org_id = l.org_id and m.contact_id = l.contact_id and m.channel = 'sms' and m.status <> 'cancelled'),
      'lastReplyAt', (select max(cm.received_at) from public.conversation_messages cm
        join public.conversations cv on cv.id = cm.conversation_id
        where cv.org_id = l.org_id and cv.contact_id = l.contact_id and cm.direction = 'inbound'),
      'optedOutOfTexts', exists (select 1 from public.message_opt_outs o where o.contact_id = l.contact_id and o.channel = 'sms')
    ) as lead
    from public.leads l
    join public.contacts c on c.id = l.contact_id
    left join public.project_directory d on d.id = l.id
    where l.org_id = requested_org
      and l.status in ('new', 'contacted')
      and l.agent_handoff_at is null
      and l.created_at >= coalesce(requested_since, now() - interval '7 days')
      and not exists (select 1 from public.appointments a where a.project_id = l.id and a.status = 'scheduled')
    order by l.created_at desc
    limit 50) x
$$;

-- One lead: who they are, what they asked for, the texts and emails so far
-- (oldest first) and anything booked.
create function public.agent_get_lead(requested_org uuid, requested_lead uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  deal public.leads%rowtype := private.agent_lead(requested_org, requested_lead, false);
  zone text := (select timezone from public.organizations where id = requested_org);
begin
  return (
    select jsonb_build_object(
      'leadId', deal.id, 'status', deal.status, 'name', c.name, 'phone', c.phone, 'email', c.email,
      'address', coalesce(nullif(btrim(d.address), ''), deal.address), 'source', deal.source,
      'createdAt', deal.created_at, 'companyTimezone', zone,
      'handedOff', deal.agent_handoff_at is not null, 'handoffReason', deal.agent_handoff_reason,
      'optedOutOfTexts', exists (select 1 from public.message_opt_outs o where o.contact_id = deal.contact_id and o.channel = 'sms'),
      'notes', coalesce((select jsonb_agg(n.body order by n.created_at) from public.project_notes n where n.project_id = deal.id), '[]'::jsonb),
      'messages', coalesce((
        select jsonb_agg(jsonb_build_object('direction', m.direction, 'channel', m.channel, 'body', m.body,
          'at', m.happened_at, 'status', m.status, 'fromAgent', m.from_agent) order by m.happened_at)
        from (
          select * from (
            select 'outbound' as direction, o.channel, o.body, coalesce(o.sent_at, o.scheduled_for) as happened_at,
              o.status, o.sent_by_agent as from_agent
            from public.outbound_messages o
            where o.org_id = requested_org and o.contact_id = deal.contact_id and o.status not in ('cancelled', 'skipped')
            union all
            select cm.direction, cm.channel, private.agent_message_text(cm.channel, cm.direction, cm.body, cm.call),
              cm.received_at, null, false
            from public.conversation_messages cm
            join public.conversations cv on cv.id = cm.conversation_id
            where cv.org_id = requested_org and cv.contact_id = deal.contact_id
          ) everything
          order by happened_at desc
          limit 40) m), '[]'::jsonb),
      'appointments', coalesce((
        select jsonb_agg(jsonb_build_object('title', a.title, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
          'status', a.status, 'with', e.full_name) order by a.starts_at)
        from public.appointments a left join public.employees e on e.id = a.assigned_to
        where a.project_id = deal.id and a.status = 'scheduled'), '[]'::jsonb))
    from public.contacts c
    left join public.project_directory d on d.id = deal.id
    where c.id = deal.contact_id);
end
$$;

-- Queue a text to the lead from the company's Quo number, like staff do.
create function public.agent_send_text(requested_org uuid, requested_lead uuid, requested_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  deal public.leads%rowtype := private.agent_lead(requested_org, requested_lead, true);
  zone text := coalesce((select timezone from public.organizations where id = requested_org), 'America/Toronto');
  local_hour integer := extract(hour from now() at time zone zone);
  phone text;
  last_reply timestamptz;
  last_reply_body text;
  waiting integer;
  conversation uuid;
  message_id uuid := extensions.gen_random_uuid();
begin
  if nullif(btrim(requested_body), '') is null or char_length(requested_body) > 1000 then
    raise exception 'Write a text of up to 1000 characters.' using errcode = '22023';
  end if;
  select nullif(btrim(c.phone), '') into phone from public.contacts c where c.id = deal.contact_id;
  if phone is null then
    raise exception 'This lead has no phone number; hand it to a person.' using errcode = '22023';
  end if;
  if exists (select 1 from public.message_opt_outs o where o.contact_id = deal.contact_id and o.channel = 'sms') then
    raise exception 'This customer opted out of texts. Do not text them.' using errcode = '42501';
  end if;
  -- Any call or text back counts as a reply; STOP is read from their last text.
  select max(cm.received_at) into last_reply
  from public.conversation_messages cm
  join public.conversations cv on cv.id = cm.conversation_id
  where cv.org_id = requested_org and cv.contact_id = deal.contact_id and cm.direction = 'inbound';
  select cm.body into last_reply_body
  from public.conversation_messages cm
  join public.conversations cv on cv.id = cm.conversation_id
  where cv.org_id = requested_org and cv.contact_id = deal.contact_id
    and cm.direction = 'inbound' and cm.channel = 'sms'
  order by cm.received_at desc limit 1;
  if last_reply_body ~* '^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*[.!]*\s*$' then
    insert into public.message_opt_outs (contact_id, channel, org_id)
    values (deal.contact_id, 'sms', requested_org) on conflict do nothing;
    raise exception 'The customer replied STOP. They are now opted out; do not text them.' using errcode = '42501';
  end if;
  if not exists (select 1 from private.org_messaging
      where org_id = requested_org and quo_api_key is not null and quo_from_number is not null) then
    raise exception 'Texting is not set up (Quo is not connected).' using errcode = '22023';
  end if;
  if local_hour < 8 or local_hour >= 20 then
    raise exception 'Texts only go out from 8 AM to 8 PM company time (it is now % there). Try again later.',
      to_char(now() at time zone zone, 'FMHH12:MI AM') using errcode = '22023';
  end if;
  select count(*) into waiting
  from public.outbound_messages o
  where o.org_id = requested_org and o.contact_id = deal.contact_id and o.channel = 'sms'
    and o.sent_by_agent and o.status <> 'cancelled'
    and o.created_at > coalesce(last_reply, '-infinity');
  if waiting >= 2 then
    raise exception 'Two texts are already waiting for a reply. Wait for the customer, or hand the lead to a person.'
      using errcode = '22023';
  end if;

  perform private.set_acting_org(requested_org);
  conversation := private.conversation_for(requested_org, deal.contact_id, null);
  insert into public.outbound_messages (id, org_id, record_id, contact_id, conversation_id, channel, body, created_by, sent_by_agent)
  values (message_id, requested_org, deal.id, deal.contact_id, conversation, 'sms', btrim(requested_body), null, true);
  if conversation is not null then
    perform private.touch_conversation(conversation, 'sms', 'outbound',
      private.message_preview(requested_body, null, false), now(), false);
  end if;
  update public.leads set status = 'contacted', updated_at = now() where id = deal.id and status = 'new';
  return jsonb_build_object('messageId', message_id, 'status', 'queued',
    'note', 'Sends within a minute from the company''s number.');
end
$$;

-- Book an estimate with someone who takes appointments, at a time still free.
create function public.agent_book_estimate(
  requested_org uuid, requested_lead uuid, requested_person uuid, requested_starts_at timestamptz,
  requested_minutes integer default 60)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  deal public.leads%rowtype := private.agent_lead(requested_org, requested_lead, true);
  zone text := coalesce((select timezone from public.organizations where id = requested_org), 'America/Toronto');
  ends timestamptz;
  person_name text;
  place text;
  appointment uuid := extensions.gen_random_uuid();
begin
  if requested_minutes is null or requested_minutes not between 15 and 480 then
    raise exception 'Appointments run 15 minutes to 8 hours.' using errcode = '22023';
  end if;
  if requested_starts_at is null or requested_starts_at < now() + interval '30 minutes' then
    raise exception 'Pick a time at least 30 minutes from now.' using errcode = '22023';
  end if;
  ends := requested_starts_at + make_interval(mins => requested_minutes);
  select coalesce(nullif(btrim(e.full_name), ''), e.email) into person_name
  from private.team_availability t
  join public.org_members m on m.org_id = t.org_id and m.user_id = t.user_id and m.is_active
  join public.employees e on e.id = t.user_id
  where t.org_id = requested_org and t.user_id = requested_person and t.takes_bookings;
  if person_name is null then
    raise exception 'That person does not take appointments. Use a person from find_times.' using errcode = '22023';
  end if;
  if exists (select 1 from public.appointments a
      where a.project_id = deal.id and a.status = 'scheduled' and a.ends_at > now()) then
    raise exception 'This lead already has an appointment booked.' using errcode = '22023';
  end if;
  -- Still free: no appointment of theirs (or nobody's) and nothing busy on their calendar.
  if exists (select 1 from public.appointments a
        where a.org_id = requested_org and a.status = 'scheduled'
          and (a.assigned_to = requested_person or a.assigned_to is null)
          and a.starts_at < ends and a.ends_at > requested_starts_at)
    or exists (select 1 from private.calendar_busy b
        join private.calendar_connections c on c.user_id = b.user_id and c.status = 'connected'
        where (b.user_id = requested_person or (c.org_id = requested_org and c.blocks_everyone))
          and b.starts_at < ends and b.ends_at > requested_starts_at) then
    raise exception 'That time is no longer free for %. Get fresh times with find_times.', person_name using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(d.address), ''), deal.address) into place
  from (select 1) one left join public.project_directory d on d.id = deal.id;
  perform private.set_acting_org(requested_org);
  insert into public.appointments (id, org_id, project_id, title, starts_at, ends_at, assigned_to, location,
    notes, status, kind, created_by, message_rule_ids)
  values (appointment, requested_org, deal.id, 'On-Site Estimate', requested_starts_at, ends, requested_person,
    left(place, 500), 'Booked by the lead agent.', 'scheduled', 'estimate', null,
    coalesce((select array_agg(r.id order by r.id) from public.reminder_rules r
      where r.org_id = requested_org and r.target = 'appointment' and r.is_enabled and r.checked_by_default
        and (r.appointment_kind is null or r.appointment_kind = 'estimate')), '{}'::uuid[]));
  update public.leads l set
    status = case when l.status in ('new', 'contacted') then 'estimate_scheduled' else l.status end,
    estimate_appointment_on = (requested_starts_at at time zone zone)::date,
    updated_at = now()
  where l.id = deal.id;
  perform private.queue_schedule_messages('appointment', appointment, true, false);
  return jsonb_build_object('appointmentId', appointment, 'with', person_name,
    'startsAt', requested_starts_at, 'endsAt', ends,
    'when', to_char(requested_starts_at at time zone zone, 'FMDay, FMMonth FMDD "at" FMHH12:MI AM'),
    'address', place,
    'note', 'Booked. The customer gets the company''s usual confirmation and reminders.');
end
$$;

-- Give the lead to a person: the agent stops, staff see it in the Inbox and the deal's notes.
create function public.agent_hand_off(requested_org uuid, requested_lead uuid, requested_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  deal public.leads%rowtype := private.agent_lead(requested_org, requested_lead, false);
  reason text := coalesce(nullif(left(btrim(requested_reason), 500), ''), 'No reason given');
begin
  perform private.set_acting_org(requested_org);
  update public.leads set agent_handoff_at = coalesce(agent_handoff_at, now()), agent_handoff_reason = reason,
    updated_at = now()
  where id = deal.id;
  insert into public.project_notes (org_id, project_id, body, created_by)
  values (requested_org, deal.id, 'Lead agent handed this to a person: ' || reason, null);
  update public.conversations set is_unread = true
  where org_id = requested_org and contact_id = deal.contact_id;
  return jsonb_build_object('handedOff', true, 'note', 'Staff will take it from here. Do not message this lead again.');
end
$$;


-- Inquiries: missed calls, voicemails and texts from numbers that aren't a
-- customer yet ------------------------------------------------------------

-- A conversation with an unknown phone number the agent may act on.
create function private.agent_inquiry(company uuid, requested_conversation uuid, acting boolean)
returns public.conversations
language plpgsql stable security definer set search_path = ''
as $$
declare
  conversation public.conversations%rowtype;
begin
  select * into conversation from public.conversations where id = requested_conversation and org_id = company;
  if not found then
    raise exception 'No conversation with that id.' using errcode = 'P0002';
  end if;
  if conversation.contact_id is not null then
    raise exception 'This number is already a customer; use their lead (list_new_leads) or hand off.' using errcode = '22023';
  end if;
  if conversation.handle is null or conversation.handle like '%@%' then
    raise exception 'This conversation has no phone number.' using errcode = '22023';
  end if;
  if acting and conversation.agent_closed_at is not null then
    raise exception 'This conversation was closed or handed to a person; leave it.' using errcode = '42501';
  end if;
  return conversation;
end
$$;

-- Unknown numbers that called, left a voicemail or texted since `since`, newest first.
create function public.agent_new_inquiries(requested_org uuid, requested_since timestamptz)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(x.inquiry order by x.latest desc), '[]'::jsonb)
  from (
    select reached.latest, jsonb_build_object(
      'conversationId', cv.id, 'phone', cv.handle, 'lastContactAt', reached.latest,
      'recent', coalesce((select jsonb_agg(jsonb_build_object('direction', r.direction, 'type', r.channel,
          'text', private.agent_message_text(r.channel, r.direction, r.body, r.call), 'at', r.received_at)
          order by r.received_at)
        from (select * from public.conversation_messages m where m.conversation_id = cv.id
          order by m.received_at desc limit 5) r), '[]'::jsonb),
      'textsSentByAgent', (select count(*) from public.outbound_messages o
        where o.conversation_id = cv.id and o.sent_by_agent and o.status <> 'cancelled')
    ) as inquiry
    from public.conversations cv
    cross join lateral (
      select max(m.received_at) as latest from public.conversation_messages m
      where m.conversation_id = cv.id and m.direction = 'inbound' and m.channel in ('sms', 'call')) reached
    where cv.org_id = requested_org and cv.contact_id is null and cv.agent_closed_at is null
      and cv.handle is not null and cv.handle not like '%@%'
      and reached.latest >= coalesce(requested_since, now() - interval '7 days')
    order by reached.latest desc
    limit 50) x
$$;

-- One inquiry: every call, voicemail and text with that number, oldest first.
create function public.agent_get_inquiry(requested_org uuid, requested_conversation uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  conversation public.conversations%rowtype := private.agent_inquiry(requested_org, requested_conversation, false);
begin
  return jsonb_build_object(
    'conversationId', conversation.id, 'phone', conversation.handle,
    'closed', conversation.agent_closed_at is not null, 'closedReason', conversation.agent_closed_reason,
    'companyTimezone', (select timezone from public.organizations where id = requested_org),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object('direction', m.direction, 'type', m.channel, 'text', m.text,
        'at', m.happened_at, 'fromAgent', m.from_agent) order by m.happened_at)
      from (
        select * from (
          select 'outbound' as direction, o.channel, o.body as text, coalesce(o.sent_at, o.scheduled_for) as happened_at,
            o.sent_by_agent as from_agent
          from public.outbound_messages o
          where o.conversation_id = conversation.id and o.status not in ('cancelled', 'skipped')
          union all
          select cm.direction, cm.channel, private.agent_message_text(cm.channel, cm.direction, cm.body, cm.call),
            cm.received_at, false
          from public.conversation_messages cm where cm.conversation_id = conversation.id
        ) everything
        order by happened_at desc
        limit 40) m), '[]'::jsonb));
end
$$;

-- Text an unknown number back (a missed-call text-back, or a reply), with the same rules as leads.
create function public.agent_text_inquiry(requested_org uuid, requested_conversation uuid, requested_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  conversation public.conversations%rowtype := private.agent_inquiry(requested_org, requested_conversation, true);
  zone text := coalesce((select timezone from public.organizations where id = requested_org), 'America/Toronto');
  local_hour integer := extract(hour from now() at time zone zone);
  last_in timestamptz;
  last_text text;
  waiting integer;
  message_id uuid := extensions.gen_random_uuid();
begin
  if nullif(btrim(requested_body), '') is null or char_length(requested_body) > 1000 then
    raise exception 'Write a text of up to 1000 characters.' using errcode = '22023';
  end if;
  select cm.body into last_text from public.conversation_messages cm
  where cm.conversation_id = conversation.id and cm.direction = 'inbound' and cm.channel = 'sms'
  order by cm.received_at desc limit 1;
  if last_text ~* '^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*[.!]*\s*$' then
    update public.conversations set agent_closed_at = now(), agent_closed_reason = 'Replied STOP'
    where id = conversation.id;
    raise exception 'They replied STOP. The conversation is closed; do not text them.' using errcode = '42501';
  end if;
  if not exists (select 1 from private.org_messaging
      where org_id = requested_org and quo_api_key is not null and quo_from_number is not null) then
    raise exception 'Texting is not set up (Quo is not connected).' using errcode = '22023';
  end if;
  if local_hour < 8 or local_hour >= 20 then
    raise exception 'Texts only go out from 8 AM to 8 PM company time (it is now % there). Try again later.',
      to_char(now() at time zone zone, 'FMHH12:MI AM') using errcode = '22023';
  end if;
  select max(cm.received_at) into last_in from public.conversation_messages cm
  where cm.conversation_id = conversation.id and cm.direction = 'inbound';
  select count(*) into waiting from public.outbound_messages o
  where o.conversation_id = conversation.id and o.sent_by_agent and o.status <> 'cancelled'
    and o.created_at > coalesce(last_in, '-infinity');
  if waiting >= 2 then
    raise exception 'Two texts are already waiting for a reply. Wait, or hand it to a person.' using errcode = '22023';
  end if;

  perform private.set_acting_org(requested_org);
  insert into public.outbound_messages (id, org_id, contact_id, conversation_id, channel, body, to_override,
    created_by, sent_by_agent)
  values (message_id, requested_org, null, conversation.id, 'sms', btrim(requested_body), conversation.handle,
    null, true);
  perform private.touch_conversation(conversation.id, 'sms', 'outbound',
    private.message_preview(requested_body, null, false), now(), false);
  return jsonb_build_object('messageId', message_id, 'status', 'queued',
    'note', 'Sends within a minute from the company''s number.');
end
$$;

-- Turn an inquiry into a customer and a lead in the sales pipeline (or find
-- the open lead this number already has); the conversation moves onto them.
create function public.agent_create_lead(
  requested_org uuid, requested_conversation uuid, requested_name text, requested_address text,
  requested_email text default null, requested_request text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  conversation public.conversations%rowtype := private.agent_inquiry(requested_org, requested_conversation, true);
  clean_name text := left(nullif(btrim(requested_name), ''), 160);
  clean_address text := left(nullif(btrim(requested_address), ''), 300);
  clean_email text := lower(nullif(btrim(requested_email), ''));
  digits text := regexp_replace(conversation.handle, '\D', '', 'g');
  customer uuid;
  existing uuid;
  deal uuid := extensions.gen_random_uuid();
  entry public.pipeline_stages%rowtype;
  called boolean;
  linked uuid;
begin
  if clean_name is null then
    raise exception 'Ask for their name first.' using errcode = '22023';
  end if;
  if clean_email is not null and clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    clean_email := null;
  end if;
  perform set_config('serviceflow.org_id', requested_org::text, true);
  select c.id into customer from public.contacts c
  where c.org_id = requested_org and c.kind = 'customer' and char_length(digits) >= 7
    and right(coalesce(nullif(c.normalized_phone, ''), regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')), 10) = right(digits, 10)
  order by c.updated_at desc limit 1;
  if customer is null then
    customer := extensions.gen_random_uuid();
    insert into public.contacts (id, kind, name, email, phone, normalized_email, normalized_phone, metadata, org_id)
    values (customer, 'customer', clean_name, clean_email, conversation.handle, clean_email, digits,
      jsonb_build_object('source', 'lead_agent'), requested_org);
  else
    select l.id into existing from public.leads l
    where l.contact_id = customer and l.status in ('new', 'contacted', 'estimate_scheduled')
    order by l.created_at desc limit 1;
  end if;

  if existing is null then
    select exists (select 1 from public.conversation_messages m
      where m.conversation_id = conversation.id and m.direction = 'inbound' and m.channel = 'call') into called;
    select * into entry from public.pipeline_stages
    where org_id = requested_org and pipeline = 'sales' and not is_closed
    order by position limit 1;
    insert into public.leads (id, contact_id, status, source, address, created_at, captured_at, metadata, org_id)
    values (deal, customer, coalesce(entry.record_status, 'new'), case when called then 'Phone Call' else 'Text message' end,
      clean_address, now(), now(), jsonb_build_object('created_by', 'lead_agent'), requested_org);
    if entry.id is not null then
      insert into public.pipeline_placements (record_id, org_id, stage_id, moved_by)
      values (deal, requested_org, entry.id, null);
    end if;
    if nullif(btrim(requested_request), '') is not null then
      insert into public.project_notes (org_id, project_id, body, created_by)
      values (requested_org, deal, left(btrim(requested_request), 4000), null);
    end if;
  else
    deal := existing;
  end if;

  -- The calls and texts so far move onto the customer, like linking it in the Inbox.
  linked := private.conversation_for(requested_org, customer, conversation.handle);
  update public.conversation_messages set record_id = deal
  where conversation_id = linked and record_id is null;
  update public.outbound_messages set contact_id = customer, record_id = coalesce(record_id, deal), to_override = null
  where conversation_id = linked and contact_id is null;
  return jsonb_build_object('leadId', deal, 'existing', existing is not null,
    'note', case when existing is not null then 'This number already has an open lead; continue with it.'
      else 'Lead created. Use its leadId from now on (find_times, book_appointment, send_text).' end);
end
$$;

-- Close an inquiry: not a lead (a supplier, a wrong number, an existing
-- customer) or given to a person. Staff see it unread in the Inbox.
create function public.agent_close_inquiry(requested_org uuid, requested_conversation uuid, requested_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  conversation public.conversations%rowtype := private.agent_inquiry(requested_org, requested_conversation, false);
begin
  update public.conversations set agent_closed_at = coalesce(agent_closed_at, now()),
    agent_closed_reason = coalesce(nullif(left(btrim(requested_reason), 500), ''), 'No reason given'),
    is_unread = true
  where id = conversation.id;
  return jsonb_build_object('closed', true, 'note', 'Staff will see it in the Inbox. Do not text this number again.');
end
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'agent_new_inquiries(uuid, timestamptz)',
    'agent_get_inquiry(uuid, uuid)',
    'agent_text_inquiry(uuid, uuid, text)',
    'agent_create_lead(uuid, uuid, text, text, text, text)',
    'agent_close_inquiry(uuid, uuid, text)',
    'agent_key_org(text)',
    'agent_new_leads(uuid, timestamptz)',
    'agent_get_lead(uuid, uuid)',
    'agent_send_text(uuid, uuid, text)',
    'agent_book_estimate(uuid, uuid, uuid, timestamptz, integer)',
    'agent_hand_off(uuid, uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end
$$;
revoke all on function private.agent_lead(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.agent_inquiry(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.agent_message_text(text, text, text, jsonb) from public, anon, authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
