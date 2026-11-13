-- Appointment workflows: a board of the things that could become a booked
-- estimate. A trigger (a lead from the website or ads, a missed call, a
-- voicemail or a text from a number that isn't a customer yet, a reply from
-- one of those) puts a card in New. Nothing is automatic: the AI writes a
-- suggestion (a text to send, a time to book, or "needs you") from the
-- company's prompt and skills, and a manager approves it. Approving goes
-- through the lead agent's functions, so the same rules hold: texts 8 AM to
-- 8 PM, never after STOP, at most two unanswered texts, a time still free with
-- someone who takes appointments.
begin;

create table private.workflow_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  prompt text not null default '' check (char_length(prompt) <= 8000),
  -- [{title, prompt}]
  skills jsonb not null default '[]'::jsonb check (jsonb_typeof(skills) = 'array'),
  appointment_minutes integer not null default 60 check (appointment_minutes between 15 and 480),
  updated_by uuid references public.employees(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table private.workflow_settings enable row level security;
revoke all on private.workflow_settings from public, anon, authenticated;

create table public.workflow_cards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid unique references public.leads(id) on delete cascade,
  conversation_id uuid unique references public.conversations(id) on delete set null,
  -- What started it.
  kind text not null check (kind in ('lead', 'missed_call', 'voicemail', 'call', 'text')),
  stage text not null default 'new' check (stage in ('new', 'waiting', 'needs_you', 'booked', 'closed')),
  reason text check (char_length(reason) <= 500),
  -- The AI's latest suggestion, cleared when something new comes in or it's acted on.
  suggestion jsonb,
  suggested_at timestamptz,
  activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (lead_id is not null or conversation_id is not null)
);
create index workflow_cards_board_idx on public.workflow_cards (org_id, stage, activity_at desc);
alter table public.workflow_cards enable row level security;
revoke all on public.workflow_cards from public, anon, authenticated;

-- Boards refresh live on the company's leads topic.
create trigger broadcast_inserts after insert on public.workflow_cards
  referencing new table as new_rows
  for each statement execute function private.broadcast_record_changes('leads');
create trigger broadcast_updates after update on public.workflow_cards
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.broadcast_record_changes('leads');

-- Triggers ----------------------------------------------------------------

-- A lead from the website or ads (lead intake). Leads staff add by hand, and
-- imports, are already someone's.
create function private.workflow_lead_arrived()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.metadata ->> 'created_by' = 'lead_intake' and new.status in ('new', 'contacted') then
    insert into public.workflow_cards (org_id, lead_id, kind, activity_at)
    values (new.org_id, new.id, 'lead', coalesce(new.captured_at, new.created_at))
    on conflict (lead_id) do nothing;
  end if;
  return null;
end
$$;
create trigger workflow_lead_arrived after insert on public.leads
  for each row execute function private.workflow_lead_arrived();

-- A call, voicemail or text. From an unknown number it is a card of its own;
-- from someone with a card still in New or Waiting, it brings that card back to
-- New for a fresh suggestion. A voicemail can arrive after its call.
create function private.workflow_message_arrived()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  conversation public.conversations%rowtype;
  what text;
begin
  if new.direction <> 'inbound' or new.channel not in ('sms', 'call') then
    return null;
  end if;
  if tg_op = 'UPDATE' and (new.call -> 'voicemail') is not distinct from (old.call -> 'voicemail') then
    return null;
  end if;
  select * into conversation from public.conversations where id = new.conversation_id;
  what := case
    when new.channel = 'sms' then 'text'
    when jsonb_typeof(new.call -> 'voicemail') = 'object' then 'voicemail'
    when not coalesce((new.call ->> 'answered')::boolean, false) then 'missed_call'
    else 'call' end;

  if conversation.contact_id is null then
    if conversation.handle is null or conversation.handle like '%@%' then
      return null;
    end if;
    insert into public.workflow_cards as w (org_id, conversation_id, kind, activity_at)
    values (conversation.org_id, conversation.id, what, new.received_at)
    on conflict (conversation_id) do update set
      kind = case when excluded.kind = 'voicemail' and w.kind in ('missed_call', 'call')
        then 'voicemail' else w.kind end,
      stage = case when w.stage = 'waiting' then 'new' else w.stage end,
      suggestion = case when w.stage in ('new', 'waiting') then null else w.suggestion end,
      suggested_at = case when w.stage in ('new', 'waiting') then null else w.suggested_at end,
      activity_at = greatest(w.activity_at, excluded.activity_at),
      updated_at = now();
  else
    update public.workflow_cards w set
      stage = case when w.stage = 'waiting' then 'new' else w.stage end,
      suggestion = case when w.stage in ('new', 'waiting') then null else w.suggestion end,
      suggested_at = case when w.stage in ('new', 'waiting') then null else w.suggested_at end,
      activity_at = greatest(w.activity_at, new.received_at),
      updated_at = now()
    where w.org_id = conversation.org_id
      and w.stage in ('new', 'waiting', 'needs_you')
      and (w.conversation_id = conversation.id
        or w.lead_id in (select l.id from public.leads l where l.contact_id = conversation.contact_id));
  end if;
  return null;
end
$$;
create trigger workflow_message_arrived after insert or update of call on public.conversation_messages
  for each row execute function private.workflow_message_arrived();

-- Booked anywhere (the deal, the calendar, here): the card is booked.
create function private.workflow_appointment_booked()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'scheduled' and new.project_id is not null then
    update public.workflow_cards set stage = 'booked', suggestion = null, suggested_at = null, updated_at = now()
    where lead_id = new.project_id and stage in ('new', 'waiting', 'needs_you');
  end if;
  return null;
end
$$;
create trigger workflow_appointment_booked after insert on public.appointments
  for each row execute function private.workflow_appointment_booked();

revoke all on function private.workflow_lead_arrived() from public, anon, authenticated;
revoke all on function private.workflow_message_arrived() from public, anon, authenticated;
revoke all on function private.workflow_appointment_booked() from public, anon, authenticated;

-- Reading ---------------------------------------------------------------

-- The people a card's texts and calls are with.
create function private.workflow_conversations(card public.workflow_cards)
returns uuid[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct x.id), '{}')
  from (
    select card.conversation_id as id where card.conversation_id is not null
    union
    select cv.id from public.conversations cv
    join public.leads l on l.contact_id = cv.contact_id
    where l.id = card.lead_id and cv.org_id = card.org_id) x
$$;
revoke all on function private.workflow_conversations(public.workflow_cards) from public, anon, authenticated;

-- The board: everything open, and what was booked or closed in the last two weeks.
create function public.workflow_board()
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
      left join public.contacts c on c.id = l.contact_id
      left join public.project_directory d on d.id = w.lead_id
      left join public.conversations cv on cv.id = w.conversation_id
      where w.org_id = company
        and (w.stage in ('new', 'waiting', 'needs_you') or w.updated_at > now() - interval '14 days')
      order by w.activity_at desc
      limit 300) x), '[]'::jsonb);
end
$$;

-- One card with everything the AI and the dialog need.
create function public.workflow_card(requested_card uuid)
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
        select jsonb_agg(jsonb_build_object('direction', m.direction, 'channel', m.channel, 'text', m.text, 'at', m.happened_at)
          order by m.happened_at)
        from (
          select * from (
            select 'outbound' as direction, o.channel, o.body as text, coalesce(o.sent_at, o.scheduled_for, o.created_at) as happened_at
            from public.outbound_messages o
            where o.org_id = company and o.status not in ('cancelled', 'skipped')
              and (o.conversation_id = any(threads) or (deal.contact_id is not null and o.contact_id = deal.contact_id))
            union all
            select cm.direction, cm.channel, private.agent_message_text(cm.channel, cm.direction, cm.body, cm.call), cm.received_at
            from public.conversation_messages cm where cm.conversation_id = any(threads)
          ) everything
          order by happened_at desc
          limit 40) m), '[]'::jsonb),
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

-- Who takes appointments, and whether their calendar is connected (only
-- they are offered: their busy times are known).
create function public.workflow_people()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := public.booking_staff_org();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.user_id, 'name', coalesce(nullif(btrim(e.full_name), ''), e.email),
      'calendar', cc.google_email, 'connected', coalesce(cc.status = 'connected', false),
      'calendarError', cc.status = 'error') order by e.full_name)
    from private.team_availability t
    join public.org_members m on m.org_id = t.org_id and m.user_id = t.user_id and m.is_active
    join public.employees e on e.id = t.user_id
    left join private.calendar_connections cc on cc.user_id = t.user_id
    where t.org_id = company and t.takes_bookings), '[]'::jsonb);
end
$$;

create function public.get_workflow_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := public.booking_staff_org();
  settings private.workflow_settings%rowtype;
begin
  select * into settings from private.workflow_settings where org_id = company;
  return jsonb_build_object('prompt', coalesce(settings.prompt, ''), 'skills', coalesce(settings.skills, '[]'::jsonb),
    'minutes', coalesce(settings.appointment_minutes, 60), 'people', public.workflow_people());
end
$$;

-- Writing ---------------------------------------------------------------

create function public.save_workflow_settings(requested_prompt text, requested_skills jsonb, requested_minutes integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := public.booking_staff_org();
  cleaned jsonb;
begin
  if jsonb_typeof(requested_skills) <> 'array' or jsonb_array_length(requested_skills) > 30 then
    raise exception 'Up to 30 skills.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('title', left(btrim(s ->> 'title'), 80), 'prompt', left(btrim(s ->> 'prompt'), 4000))), '[]'::jsonb)
  into cleaned
  from jsonb_array_elements(requested_skills) s
  where nullif(btrim(s ->> 'title'), '') is not null or nullif(btrim(s ->> 'prompt'), '') is not null;
  insert into private.workflow_settings (org_id, prompt, skills, appointment_minutes, updated_by, updated_at)
  values (company, left(coalesce(requested_prompt, ''), 8000), cleaned, coalesce(requested_minutes, 60), auth.uid(), now())
  on conflict (org_id) do update set prompt = excluded.prompt, skills = excluded.skills,
    appointment_minutes = excluded.appointment_minutes, updated_by = excluded.updated_by, updated_at = now();
end
$$;

-- The AI's suggestion. One it can't act on (out of scope) moves the card to Needs you.
create function public.save_workflow_suggestion(requested_card uuid, requested_suggestion jsonb)
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
end
$$;

-- The lead to act on: the card's, or a new one from an unknown number once
-- their name and address are known. A number that already had an open lead
-- with a card continues on that card.
create function private.workflow_lead(company uuid, card public.workflow_cards, requested_name text,
  requested_address text, requested_email text, requested_request text, required boolean)
returns public.workflow_cards
language plpgsql security definer set search_path = ''
as $$
declare
  created jsonb;
  deal uuid;
  other public.workflow_cards%rowtype;
begin
  if card.lead_id is not null then
    return card;
  end if;
  if nullif(btrim(requested_name), '') is null or nullif(btrim(requested_address), '') is null then
    if required then
      raise exception 'Add their name and address first.' using errcode = '22023';
    end if;
    return card;
  end if;
  created := public.agent_create_lead(company, card.conversation_id, requested_name, requested_address,
    requested_email, requested_request);
  deal := (created ->> 'leadId')::uuid;
  select * into other from public.workflow_cards where lead_id = deal and id <> card.id;
  if found then
    delete from public.workflow_cards where id = card.id;
    return other;
  end if;
  update public.workflow_cards set lead_id = deal, updated_at = now() where id = card.id returning * into card;
  return card;
end
$$;
revoke all on function private.workflow_lead(uuid, public.workflow_cards, text, text, text, text, boolean)
  from public, anon, authenticated;

create function public.workflow_send_text(requested_card uuid, requested_body text,
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
  return jsonb_build_object('cardId', card.id);
end
$$;

create function public.workflow_book(requested_card uuid, requested_person uuid, requested_starts_at timestamptz,
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
  return booked;
end
$$;

-- Move a card by hand: to Needs you (with why), Closed, or back to New.
create function public.workflow_move(requested_card uuid, requested_stage text, requested_reason text default null)
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
end
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'workflow_board()',
    'workflow_card(uuid)',
    'workflow_people()',
    'get_workflow_settings()',
    'save_workflow_settings(text, jsonb, integer)',
    'save_workflow_suggestion(uuid, jsonb)',
    'workflow_send_text(uuid, text, text, text, text, text)',
    'workflow_book(uuid, uuid, timestamptz, text, text, text, text)',
    'workflow_move(uuid, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
