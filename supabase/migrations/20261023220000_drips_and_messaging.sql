-- Drips and customer messages. Each pipeline column can carry timed email and
-- text steps; a deal or job entering a column with drips on is enrolled and
-- its messages are queued, and leaving the column cancels what has not gone
-- out. Records already in a column when drips are turned on are not enrolled.
-- Staff can also queue a message straight to a customer (a proposal link).
-- The send-messages function delivers queued messages every minute: email
-- through Resend, texts through each company's own Quo number.
begin;

-- Per-company messaging settings. The Quo key never leaves the database
-- except to the send-messages function.
create table private.org_messaging (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  quo_api_key text,
  quo_from_number text check (quo_from_number ~ '^\+[1-9][0-9]{7,14}$'),
  reply_to_email text check (reply_to_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  updated_at timestamptz not null default now()
);

alter table public.pipeline_stages add column drips_enabled boolean not null default false;

create table public.drip_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  position integer not null,
  delay_minutes integer not null check (delay_minutes between 0 and 525600),
  channel text not null check (channel in ('email', 'sms')),
  subject text check (char_length(subject) <= 200),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (channel = 'sms' or nullif(btrim(subject), '') is not null)
);
create index drip_steps_stage_idx on public.drip_steps (stage_id, position);

create table public.drip_enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  record_id uuid not null,
  stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  entered_at timestamptz not null default now(),
  left_at timestamptz
);
create index drip_enrollments_record_idx on public.drip_enrollments (record_id, entered_at desc);

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  record_id uuid,
  contact_id uuid references public.contacts(id) on delete set null,
  enrollment_id uuid references public.drip_enrollments(id) on delete set null,
  drip_step_id uuid references public.drip_steps(id) on delete set null,
  channel text not null check (channel in ('email', 'sms')),
  subject text check (char_length(subject) <= 200),
  body text not null check (char_length(body) <= 10000),
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled')),
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  error text,
  provider_message_id text,
  lease_until timestamptz,
  created_by uuid default auth.uid() references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index outbound_messages_due_idx on public.outbound_messages (scheduled_for)
  where status in ('queued', 'sending');
create index outbound_messages_org_idx on public.outbound_messages (org_id, created_at desc);
create index outbound_messages_record_idx on public.outbound_messages (record_id);

create table public.message_opt_outs (
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, channel)
);

alter table public.drip_steps enable row level security;
alter table public.drip_enrollments enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.message_opt_outs enable row level security;
revoke all on public.drip_steps, public.drip_enrollments, public.outbound_messages, public.message_opt_outs
  from anon, authenticated;
grant select on public.drip_steps, public.outbound_messages to authenticated;
create policy org_manager_read on public.drip_steps for select to authenticated
  using (org_id in (select private.my_managed_org_ids()));
create policy org_manager_read on public.outbound_messages for select to authenticated
  using (org_id in (select private.my_managed_org_ids()));

-- The column a lead or job is in right now; null once it leaves the board
-- (won, cancelled, archived).
create function private.current_pipeline_stage(target_record uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select ps.id from public.pipeline_placements pp
     join public.pipeline_stages ps on ps.id = pp.stage_id
     where pp.record_id = target_record and ps.record_status = x.status),
    private.derived_pipeline_stage(x.org_id, x.pipeline, x.status, x.raw_stage, x.prefer_last))
  from (
    select l.org_id, 'sales' as pipeline, l.status, l.pipeline_stage_raw as raw_stage,
      l.status = 'lost' and exists (
        select 1 from public.quotes q where q.lead_id = l.id and q.status <> 'superseded') as prefer_last
    from public.leads l
    where l.id = target_record and l.status not in ('won', 'cancelled')
    union all
    select j.org_id, 'jobs', j.status, null,
      j.status = 'completed' or (j.status = 'scheduled' and j.scheduled_on is not null)
    from public.jobs j
    where j.id = target_record and j.status in ('scheduled', 'active', 'completed')
      and j.archived_at is null and j.is_feed_visible is not false
  ) x
$$;
revoke all on function private.current_pipeline_stage(uuid) from public, anon, authenticated;

create function private.sync_drips(target_record uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  current_stage uuid := private.current_pipeline_stage(target_record);
  latest public.drip_enrollments%rowtype;
  stage public.pipeline_stages%rowtype;
  enrollment uuid;
begin
  select * into latest from public.drip_enrollments
  where record_id = target_record and left_at is null
  order by entered_at desc limit 1
  for update;
  if found then
    if latest.stage_id is not distinct from current_stage then
      return;
    end if;
    update public.drip_enrollments set left_at = now() where id = latest.id;
    update public.outbound_messages set status = 'cancelled', error = 'Left the stage before sending.'
    where enrollment_id = latest.id and status = 'queued';
  end if;
  if current_stage is null then
    return;
  end if;
  select * into stage from public.pipeline_stages where id = current_stage;
  if not stage.drips_enabled
    or not exists (select 1 from public.drip_steps where stage_id = stage.id and is_enabled) then
    return;
  end if;
  insert into public.drip_enrollments (org_id, record_id, stage_id)
  values (stage.org_id, target_record, stage.id)
  returning id into enrollment;
  insert into public.outbound_messages (
    org_id, record_id, contact_id, enrollment_id, drip_step_id, channel, subject, body,
    scheduled_for, created_by)
  select stage.org_id, target_record,
    coalesce((select contact_id from public.leads where id = target_record),
      (select contact_id from public.jobs where id = target_record)),
    enrollment, s.id, s.channel, s.subject, s.body,
    now() + make_interval(mins => s.delay_minutes), null
  from public.drip_steps s
  where s.stage_id = stage.id and s.is_enabled;
end
$$;
revoke all on function private.sync_drips(uuid) from public, anon, authenticated;

-- Drips never block the write that moved the record.
create function private.sync_drips_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  row_data jsonb := to_jsonb(new);
  target_record uuid := coalesce(row_data ->> 'record_id', row_data ->> 'id')::uuid;
begin
  if exists (select 1 from public.pipeline_stages
      where org_id = (row_data ->> 'org_id')::uuid and drips_enabled)
    or exists (select 1 from public.drip_enrollments where record_id = target_record and left_at is null) then
    begin
      perform private.sync_drips(target_record);
    exception when others then
      raise warning 'Drip sync failed for %: %', target_record, sqlerrm;
    end;
  end if;
  return null;
end
$$;
revoke all on function private.sync_drips_after_write() from public, anon, authenticated;

create trigger sync_drips after insert or update of status on public.leads
  for each row execute function private.sync_drips_after_write();
create trigger sync_drips after insert or update of status, scheduled_on, archived_at on public.jobs
  for each row execute function private.sync_drips_after_write();
create trigger sync_drips after insert or update of stage_id on public.pipeline_placements
  for each row execute function private.sync_drips_after_write();

-- Drip editing ----------------------------------------------------------

create function public.save_drip_step(
  requested_id uuid, requested_stage uuid, requested_delay_minutes integer, requested_channel text,
  requested_subject text, requested_body text, requested_enabled boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  stage public.pipeline_stages%rowtype;
begin
  select * into stage from public.pipeline_stages where id = requested_stage;
  if not found or not private.is_org_manager(stage.org_id) then
    raise exception 'Only managers can edit drips.' using errcode = '42501';
  end if;
  insert into public.drip_steps as d (
    id, org_id, stage_id, position, delay_minutes, channel, subject, body, is_enabled)
  values (
    requested_id, stage.org_id, stage.id,
    coalesce((select max(position) from public.drip_steps where stage_id = stage.id), 0) + 1,
    requested_delay_minutes, requested_channel, nullif(btrim(requested_subject), ''),
    btrim(requested_body), coalesce(requested_enabled, true))
  on conflict (id) do update set
    delay_minutes = excluded.delay_minutes, channel = excluded.channel, subject = excluded.subject,
    body = excluded.body, is_enabled = excluded.is_enabled, updated_at = now()
  where d.stage_id = stage.id;
  return requested_id;
end
$$;

create function public.delete_drip_step(requested_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_org_manager((select org_id from public.drip_steps where id = requested_id)) then
    raise exception 'Only managers can edit drips.' using errcode = '42501';
  end if;
  update public.outbound_messages set status = 'cancelled', error = 'Drip step deleted.'
  where drip_step_id = requested_id and status = 'queued';
  delete from public.drip_steps where id = requested_id;
end
$$;

create function public.set_stage_drips(requested_stage uuid, requested_enabled boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  stage public.pipeline_stages%rowtype;
begin
  select * into stage from public.pipeline_stages where id = requested_stage for update;
  if not found or not private.is_org_manager(stage.org_id) then
    raise exception 'Only managers can edit drips.' using errcode = '42501';
  end if;
  update public.pipeline_stages set drips_enabled = requested_enabled, updated_at = now()
  where id = requested_stage;
  if not requested_enabled then
    update public.outbound_messages m set status = 'cancelled', error = 'Drips turned off for this stage.'
    from public.drip_enrollments e
    where m.enrollment_id = e.id and e.stage_id = requested_stage and m.status = 'queued';
  end if;
end
$$;

-- Messaging settings and direct messages --------------------------------

create function public.get_messaging_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  settings private.org_messaging%rowtype;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see messaging settings.' using errcode = '42501';
  end if;
  select * into settings from private.org_messaging where org_id = company;
  return jsonb_build_object(
    'quoConnected', settings.quo_api_key is not null,
    'quoKeyEnding', right(settings.quo_api_key, 4),
    'quoFromNumber', settings.quo_from_number,
    'replyToEmail', settings.reply_to_email);
end
$$;

-- A null key keeps the saved one; an empty key disconnects Quo.
create function public.save_messaging_settings(
  requested_quo_api_key text, requested_quo_from_number text, requested_reply_to_email text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can change messaging settings.' using errcode = '42501';
  end if;
  insert into private.org_messaging as m (org_id, quo_api_key, quo_from_number, reply_to_email)
  values (company, nullif(btrim(requested_quo_api_key), ''),
    nullif(regexp_replace(coalesce(requested_quo_from_number, ''), '[^0-9+]', '', 'g'), ''),
    nullif(btrim(requested_reply_to_email), ''))
  on conflict (org_id) do update set
    quo_api_key = case when requested_quo_api_key is null then m.quo_api_key
      else nullif(btrim(requested_quo_api_key), '') end,
    quo_from_number = excluded.quo_from_number,
    reply_to_email = excluded.reply_to_email,
    updated_at = now();
end
$$;

create function public.queue_customer_message(
  requested_record uuid, requested_channel text, requested_subject text, requested_body text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.org_of_project(requested_record);
  message_id uuid := gen_random_uuid();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can message customers.' using errcode = '42501';
  end if;
  if requested_channel not in ('email', 'sms') or nullif(btrim(requested_body), '') is null then
    raise exception 'Write a message to send.' using errcode = '22023';
  end if;
  if requested_channel = 'sms' and not exists (
    select 1 from private.org_messaging where org_id = company and quo_api_key is not null and quo_from_number is not null) then
    raise exception 'Connect Quo in Settings to send texts.' using errcode = '22023';
  end if;
  insert into public.outbound_messages (id, org_id, record_id, contact_id, channel, subject, body)
  values (message_id, company, requested_record,
    coalesce((select contact_id from public.leads where id = requested_record),
      (select contact_id from public.jobs where id = requested_record)),
    requested_channel, nullif(btrim(requested_subject), ''), btrim(requested_body));
  return message_id;
end
$$;

-- Unsubscribe links carry the message id.
create function public.opt_out_of_messages(requested_message uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  message public.outbound_messages%rowtype;
begin
  select * into message from public.outbound_messages where id = requested_message;
  if not found or message.contact_id is null then
    return null;
  end if;
  insert into public.message_opt_outs (contact_id, channel, org_id)
  values (message.contact_id, message.channel, message.org_id)
  on conflict do nothing;
  update public.outbound_messages set status = 'cancelled', error = 'Customer opted out.'
  where contact_id = message.contact_id and channel = message.channel and status = 'queued';
  return (select name from public.organizations where id = message.org_id);
end
$$;

create function public.get_message_activity()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see messages.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'recordId', m.record_id, 'customerName', c.name, 'channel', m.channel,
      'subject', m.subject, 'body', left(m.body, 280), 'status', m.status, 'error', m.error,
      'scheduledFor', m.scheduled_for, 'sentAt', m.sent_at, 'stageName', s.name,
      'isDrip', m.drip_step_id is not null) order by m.scheduled_for desc)
    from (
      select * from public.outbound_messages
      where org_id = company
      order by scheduled_for desc
      limit 200) m
    left join public.contacts c on c.id = m.contact_id
    left join public.drip_enrollments e on e.id = m.enrollment_id
    left join public.pipeline_stages s on s.id = e.stage_id
  ), '[]'::jsonb);
end
$$;

-- Delivery (service role only) ------------------------------------------

-- Claims due messages for the send-messages function and fills in the
-- customer and company placeholders. Opted-out customers and missing
-- addresses are skipped here.
create function public.claim_outbound_messages(batch_size integer default 50)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  update public.outbound_messages m set status = 'skipped', error = case
      when o.contact_id is not null then 'Customer opted out.'
      when m.channel = 'email' then 'Customer has no email address.'
      else 'Customer has no mobile number.' end
  from public.outbound_messages q
  left join public.contacts c on c.id = q.contact_id
  left join public.message_opt_outs o on o.contact_id = q.contact_id and o.channel = q.channel
  where m.id = q.id and q.status = 'queued' and q.scheduled_for <= now()
    and (o.contact_id is not null
      or (q.channel = 'email' and nullif(btrim(c.email), '') is null)
      or (q.channel = 'sms' and nullif(btrim(c.phone), '') is null));

  with due as (
    select id from public.outbound_messages
    where (status = 'queued' and scheduled_for <= now())
      or (status = 'sending' and lease_until < now())
    order by scheduled_for
    limit greatest(1, least(batch_size, 200))
    for update skip locked
  ), claimed as (
    update public.outbound_messages m set status = 'sending', lease_until = now() + interval '5 minutes'
    from due where m.id = due.id
    returning m.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'channel', m.channel,
      'to', case when m.channel = 'email' then btrim(c.email) else btrim(c.phone) end,
      'subject', private.fill_placeholders(m.subject, c.name, o.name, o.phone),
      'body', private.fill_placeholders(m.body, c.name, o.name, o.phone),
      'proposalToken', (
        select q.public_token from public.quotes q
        where q.lead_id = coalesce(
            (select id from public.leads where id = m.record_id),
            (select lead_id from public.jobs where id = m.record_id))
          and q.status in ('sent', 'accepted') and q.public_token is not null
        order by q.sent_at desc nulls last limit 1),
      'companyName', o.name,
      'replyTo', s.reply_to_email,
      'quoApiKey', s.quo_api_key,
      'quoFrom', s.quo_from_number)), '[]'::jsonb)
  into result
  from claimed m
  left join public.contacts c on c.id = m.contact_id
  join public.organizations o on o.id = m.org_id
  left join private.org_messaging s on s.org_id = m.org_id;
  return result;
end
$$;

create function private.fill_placeholders(template text, customer text, company text, company_phone text)
returns text
language sql immutable set search_path = ''
as $$
  select replace(replace(replace(replace(template,
    '{{first_name}}', coalesce(split_part(btrim(customer), ' ', 1), 'there')),
    '{{name}}', coalesce(btrim(customer), '')),
    '{{company}}', coalesce(company, '')),
    '{{company_phone}}', coalesce(company_phone, ''))
$$;
revoke all on function private.fill_placeholders(text, text, text, text) from public, anon, authenticated;

create function public.complete_outbound_message(
  requested_id uuid, requested_status text, requested_error text default null,
  requested_provider_id text default null)
returns void
language sql security definer set search_path = ''
as $$
  update public.outbound_messages set
    status = requested_status,
    error = left(requested_error, 1000),
    provider_message_id = requested_provider_id,
    sent_at = case when requested_status = 'sent' then now() else sent_at end,
    lease_until = null
  where id = requested_id and status = 'sending'
    and requested_status in ('sent', 'failed', 'skipped')
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'save_drip_step(uuid, uuid, integer, text, text, text, boolean)',
    'delete_drip_step(uuid)',
    'set_stage_drips(uuid, boolean)',
    'get_messaging_settings()',
    'save_messaging_settings(text, text, text)',
    'queue_customer_message(uuid, text, text, text)',
    'get_message_activity()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  foreach fn in array array['claim_outbound_messages(integer)', 'complete_outbound_message(uuid, text, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
  execute 'revoke all on function public.opt_out_of_messages(uuid) from public';
  execute 'grant execute on function public.opt_out_of_messages(uuid) to anon, authenticated';
end
$$;

-- The board reads each card's column from the same function drips use.
create or replace function public.get_pipeline_board(requested_pipeline text, include_closed boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  result jsonb;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can open the pipeline.' using errcode = '42501';
  end if;
  if requested_pipeline not in ('sales', 'jobs') then
    raise exception 'Unknown pipeline.' using errcode = '22023';
  end if;

  with records as (
    select l.id, greatest(l.updated_at, pp.moved_at) as updated_at, l.source, l.address,
      coalesce(nullif(btrim(c.name), ''), 'Unnamed lead') as name,
      l.estimate_appointment_on as date_on,
      q.id as quote_id, q.status as quote_status, q.amount_cents as value_cents,
      private.current_pipeline_stage(l.id) as stage_id
    from public.leads l
    left join public.contacts c on c.id = l.contact_id
    left join public.pipeline_placements pp on pp.record_id = l.id
    left join lateral (
      select q.id, q.status, q.amount_cents from public.quotes q
      where q.lead_id = l.id and q.status <> 'superseded'
      order by (q.status in ('sent', 'accepted')) desc, q.updated_at desc
      limit 1
    ) q on true
    where requested_pipeline = 'sales' and l.org_id = company
      and l.status not in ('won', 'cancelled')
    union all
    select j.id, greatest(j.updated_at, pp.moved_at), l.source,
      coalesce(j.formatted_address, j.address_line_1),
      j.name, j.scheduled_on, j.accepted_quote_id, null, j.contract_amount_cents,
      private.current_pipeline_stage(j.id)
    from public.jobs j
    left join public.leads l on l.id = j.lead_id
    left join public.pipeline_placements pp on pp.record_id = j.id
    where requested_pipeline = 'jobs' and j.org_id = company
      and j.status in ('scheduled', 'active', 'completed')
      and j.archived_at is null and j.is_feed_visible is not false
  ), stages as (
    select s.*,
      (select count(*) from records r where r.stage_id = s.id) as card_count,
      (select coalesce(sum(r.value_cents), 0) from records r where r.stage_id = s.id) as value_cents
    from public.pipeline_stages s
    where s.org_id = company and s.pipeline = requested_pipeline
  )
  select jsonb_build_object(
    'pipeline', requested_pipeline,
    'stages', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'position', s.position, 'isClosed', s.is_closed,
        'dripsEnabled', s.drips_enabled,
        'count', s.card_count, 'valueCents', s.value_cents) order by s.position)
      from stages s), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'stageId', r.stage_id, 'name', r.name, 'source', r.source,
        'address', r.address, 'dateOn', r.date_on, 'valueCents', r.value_cents,
        'quoteId', r.quote_id, 'quoteStatus', r.quote_status, 'updatedAt', r.updated_at,
        'labels', coalesce((select jsonb_agg(jsonb_build_object(
            'id', pl.id, 'name', pl.name, 'color', pl.color) order by pl.name)
          from public.project_label_links ll
          join public.project_labels pl on pl.id = ll.label_id
          where ll.project_id = r.id), '[]'::jsonb))
        order by r.updated_at desc, r.id)
      from records r join stages s on s.id = r.stage_id
      where include_closed or not s.is_closed), '[]'::jsonb)
  ) into result;
  return result;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
