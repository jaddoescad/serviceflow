-- Appointment types; confirmations and reminders timed off the actual
-- appointment or job start (drips are timed off entering a stage); a reusable
-- products/services catalog; and sending a document by email or text in one
-- step, so "sent" means the delivery was queued and its status shows.
begin;

-- Appointment types --------------------------------------------------------

alter table public.appointments
  add column kind text not null default 'estimate'
    check (kind in ('estimate', 'walkthrough', 'punch_out', 'quality_control', 'other'));
update public.appointments set kind = case
  when title ilike '%estimate%' then 'estimate'
  when title ilike '%walkthrough%' or title ilike '%walk-through%' then 'walkthrough'
  when title ilike '%punch%' then 'punch_out'
  when title ilike '%quality%' then 'quality_control'
  else 'other' end;

-- Confirmation and reminder rules -------------------------------------------

create table public.reminder_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  target text not null check (target in ('appointment', 'job')),
  -- Appointment rules can apply to one type; null means every type.
  appointment_kind text check (appointment_kind in ('estimate', 'walkthrough', 'punch_out', 'quality_control', 'other')),
  trigger text not null check (trigger in ('confirmation', 'reminder')),
  -- Reminders go out this long before the start; confirmations go out on booking.
  offset_minutes integer not null default 0 check (offset_minutes between 0 and 43200),
  channel text not null check (channel in ('email', 'sms')),
  subject text check (char_length(subject) <= 200),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (target = 'appointment' or appointment_kind is null),
  check (channel = 'sms' or nullif(btrim(subject), '') is not null)
);
create index reminder_rules_org_idx on public.reminder_rules (org_id, target);

alter table public.outbound_messages
  add column appointment_id uuid references public.appointments(id) on delete cascade,
  add column reminder_rule_id uuid references public.reminder_rules(id) on delete set null,
  add column document_kind text check (document_kind in ('proposal', 'change_order', 'invoice')),
  add column document_id uuid;
create index outbound_messages_appointment_idx on public.outbound_messages (appointment_id) where appointment_id is not null;
create index outbound_messages_document_idx on public.outbound_messages (document_id) where document_id is not null;

alter table public.reminder_rules enable row level security;
revoke all on public.reminder_rules from anon, authenticated;
grant select on public.reminder_rules to authenticated;
create policy org_manager_read on public.reminder_rules for select to authenticated
  using (org_id in (select private.my_managed_org_ids()));

-- {{date}}, {{time}}, {{end_date}}, {{appointment_type}} and
-- {{scheduled_or_rescheduled}} are filled when the message is queued; the
-- customer and company placeholders are filled when it is sent.
create function private.fill_schedule_placeholders(
  template text, starts timestamptz, ends timestamptz, appointment_kind text, zone text, rescheduled boolean)
returns text
language sql stable set search_path = ''
as $$
  select replace(replace(replace(replace(replace(template,
    '{{date}}', to_char(starts at time zone zone, 'FMDay, FMMonth FMDD')),
    '{{time}}', to_char(starts at time zone zone, 'FMHH12:MI AM')),
    '{{end_date}}', to_char(ends at time zone zone, 'FMDay, FMMonth FMDD')),
    '{{appointment_type}}', case appointment_kind
      when 'estimate' then 'estimate' when 'walkthrough' then 'walkthrough'
      when 'punch_out' then 'punch-out' when 'quality_control' then 'quality check'
      else 'appointment' end),
    '{{scheduled_or_rescheduled}}', case when rescheduled then 'rescheduled' else 'scheduled' end)
$$;
revoke all on function private.fill_schedule_placeholders(text, timestamptz, timestamptz, text, text, boolean) from public, anon, authenticated;

-- Re-plans the confirmation and reminders for an appointment or a job's
-- dates: anything still queued for it is cancelled, then the enabled rules
-- queue new messages. Jobs start at 8 AM company time on their first day.
create function private.queue_schedule_messages(
  requested_target text, requested_source uuid, send_confirmation boolean, was_rescheduled boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  appt public.appointments%rowtype;
  job_row public.jobs%rowtype;
  company uuid;
  project uuid;
  starts timestamptz;
  ends timestamptz;
  appt_kind text;
  zone text;
  customer uuid;
  rr public.reminder_rules%rowtype;
  send_at timestamptz;
begin
  if requested_target = 'appointment' then
    select * into appt from public.appointments where id = requested_source;
    if not found then
      return;
    end if;
    update public.outbound_messages set status = 'cancelled', error = 'Appointment changed.'
    where appointment_id = requested_source and status = 'queued';
    if appt.status <> 'scheduled' then
      return;
    end if;
    company := appt.org_id;
    project := appt.project_id;
    starts := appt.starts_at;
    ends := appt.ends_at;
    appt_kind := appt.kind;
  else
    select * into job_row from public.jobs where id = requested_source;
    if not found then
      return;
    end if;
    update public.outbound_messages set status = 'cancelled', error = 'Job dates changed.'
    where record_id = requested_source and appointment_id is null
      and reminder_rule_id is not null and status = 'queued';
    if job_row.scheduled_on is null or job_row.archived_at is not null
      or job_row.status not in ('scheduled', 'active') then
      return;
    end if;
    company := job_row.org_id;
    project := job_row.id;
  end if;

  select timezone into zone from public.organizations where id = company;
  if requested_target = 'job' then
    starts := (job_row.scheduled_on + time '08:00') at time zone zone;
    ends := (coalesce(job_row.scheduled_end_on, job_row.scheduled_on) + time '17:00') at time zone zone;
  end if;
  customer := coalesce(
    (select contact_id from public.leads where id = project),
    (select contact_id from public.jobs where id = project));

  for rr in
    select * from public.reminder_rules r
    where r.org_id = company and r.is_enabled and r.target = requested_target
      and (r.appointment_kind is null or r.appointment_kind = appt_kind)
  loop
    if rr.trigger = 'confirmation' then
      if not send_confirmation then
        continue;
      end if;
      send_at := now();
    else
      send_at := starts - make_interval(mins => rr.offset_minutes);
      if send_at <= now() then
        continue;
      end if;
    end if;
    insert into public.outbound_messages (
      org_id, record_id, contact_id, appointment_id, reminder_rule_id, channel, subject, body,
      scheduled_for, created_by)
    values (
      company, project, customer,
      case when requested_target = 'appointment' then requested_source end,
      rr.id, rr.channel,
      private.fill_schedule_placeholders(rr.subject, starts, ends, appt_kind, zone, was_rescheduled),
      private.fill_schedule_placeholders(rr.body, starts, ends, appt_kind, zone, was_rescheduled),
      send_at, auth.uid());
  end loop;
end
$$;
revoke all on function private.queue_schedule_messages(text, uuid, boolean, boolean) from public, anon, authenticated;

create function public.save_reminder_rule(
  requested_id uuid, requested_target text, requested_appointment_kind text, requested_trigger text,
  requested_offset_minutes integer, requested_channel text, requested_subject text, requested_body text,
  requested_enabled boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := coalesce((select org_id from public.reminder_rules where id = requested_id), private.web_org_id());
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can edit reminders.' using errcode = '42501';
  end if;
  insert into public.reminder_rules as r (
    id, org_id, target, appointment_kind, trigger, offset_minutes, channel, subject, body, is_enabled)
  values (
    requested_id, company, requested_target,
    case when requested_target = 'appointment' then nullif(requested_appointment_kind, '') end,
    requested_trigger, case when requested_trigger = 'reminder' then coalesce(requested_offset_minutes, 0) else 0 end,
    requested_channel, nullif(btrim(requested_subject), ''), btrim(requested_body), coalesce(requested_enabled, true))
  on conflict (id) do update set
    target = excluded.target, appointment_kind = excluded.appointment_kind, trigger = excluded.trigger,
    offset_minutes = excluded.offset_minutes, channel = excluded.channel, subject = excluded.subject,
    body = excluded.body, is_enabled = excluded.is_enabled, updated_at = now()
  where r.org_id = company;
  -- Turning a rule off stops what it already queued.
  if not coalesce(requested_enabled, true) then
    update public.outbound_messages set status = 'cancelled', error = 'Reminder turned off.'
    where reminder_rule_id = requested_id and status = 'queued';
  end if;
  return requested_id;
end
$$;

create function public.delete_reminder_rule(requested_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_org_manager((select org_id from public.reminder_rules where id = requested_id)) then
    raise exception 'Only managers can edit reminders.' using errcode = '42501';
  end if;
  update public.outbound_messages set status = 'cancelled', error = 'Reminder deleted.'
  where reminder_rule_id = requested_id and status = 'queued';
  delete from public.reminder_rules where id = requested_id;
end
$$;

-- Booking or moving an appointment re-plans its messages; the confirmation
-- goes out only when the person booking asks for it.
drop function public.save_appointment(uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text);
create function public.save_appointment(
  requested_id uuid, requested_project uuid, requested_title text, requested_starts_at timestamptz,
  requested_ends_at timestamptz, requested_assigned_to uuid, requested_location text,
  requested_notes text, requested_status text default 'scheduled',
  requested_kind text default null, requested_notify boolean default false)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.org_of_project(requested_project);
  existing public.appointments%rowtype;
  timing_changed boolean;
begin
  if company is null then
    raise exception 'Deal or job not found.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(company) then
    raise exception 'Only managers can book appointments.' using errcode = '42501';
  end if;
  if requested_assigned_to is not null and not exists (
    select 1 from public.org_members
    where org_id = company and user_id = requested_assigned_to and is_active) then
    raise exception 'Assign someone on your team.' using errcode = '22023';
  end if;
  if requested_status not in ('scheduled', 'completed', 'cancelled') then
    raise exception 'Unknown appointment status.' using errcode = '22023';
  end if;
  perform private.set_acting_org(company);

  select * into existing from public.appointments where id = requested_id for update;
  if found and existing.org_id <> company then
    raise exception 'Appointment belongs to another company.' using errcode = '42501';
  end if;
  timing_changed := existing.id is null
    or existing.starts_at is distinct from requested_starts_at
    or existing.ends_at is distinct from requested_ends_at
    or existing.status is distinct from requested_status
    or existing.kind is distinct from coalesce(requested_kind, existing.kind);

  insert into public.appointments as a (
    id, org_id, project_id, title, starts_at, ends_at, assigned_to, location, notes, status, kind)
  values (
    requested_id, company, requested_project, btrim(requested_title), requested_starts_at,
    requested_ends_at, requested_assigned_to, nullif(btrim(requested_location), ''),
    nullif(btrim(requested_notes), ''), requested_status, coalesce(requested_kind, 'estimate'))
  on conflict (id) do update set
    project_id = excluded.project_id, title = excluded.title, starts_at = excluded.starts_at,
    ends_at = excluded.ends_at, assigned_to = excluded.assigned_to, location = excluded.location,
    notes = excluded.notes, status = excluded.status,
    kind = coalesce(requested_kind, a.kind), updated_at = now();

  update public.leads l set
    status = case when l.status in ('new', 'contacted') then 'estimate_scheduled' else l.status end,
    estimate_appointment_on = (
      select min((a.starts_at at time zone o.timezone)::date)
      from public.appointments a
      join public.organizations o on o.id = a.org_id
      where a.project_id = l.id and a.status = 'scheduled' and a.starts_at >= now() - interval '1 day'),
    updated_at = now()
  where l.id = requested_project;

  if timing_changed then
    perform private.queue_schedule_messages('appointment', requested_id,
      coalesce(requested_notify, false) and requested_status = 'scheduled',
      existing.id is not null and existing.starts_at is distinct from requested_starts_at);
  end if;
  return requested_id;
end
$$;
revoke all on function public.save_appointment(uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.save_appointment(uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, text, boolean) to authenticated;

create or replace function public.get_appointments(range_start timestamptz, range_end timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see appointments.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'projectId', a.project_id, 'title', a.title, 'kind', a.kind, 'startsAt', a.starts_at,
      'endsAt', a.ends_at, 'assignedTo', a.assigned_to, 'assigneeName', e.full_name,
      'location', a.location, 'notes', a.notes, 'status', a.status,
      'projectName', d.name, 'projectAddress', d.address) order by a.starts_at)
    from public.appointments a
    left join public.employees e on e.id = a.assigned_to
    left join public.project_directory d on d.id = a.project_id
    where a.org_id = company and a.starts_at < range_end and a.ends_at > range_start
  ), '[]'::jsonb);
end
$$;

-- Dating a job re-plans its confirmation and reminders.
drop function public.schedule_job(uuid, date, date);
create function public.schedule_job(
  requested_job uuid, requested_start date, requested_end date, requested_notify boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  job public.jobs%rowtype;
begin
  select * into job from public.jobs where id = requested_job for update;
  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(job.org_id) then
    raise exception 'Only managers can schedule jobs.' using errcode = '42501';
  end if;
  if requested_start is null and requested_end is not null then
    raise exception 'Choose a start date.' using errcode = '22023';
  end if;
  if requested_end < requested_start then
    raise exception 'The end date is before the start date.' using errcode = '22023';
  end if;
  perform private.set_acting_org(job.org_id);
  update public.jobs set scheduled_on = requested_start,
    scheduled_end_on = coalesce(requested_end, requested_start), updated_at = now()
  where id = requested_job;
  delete from public.pipeline_placements p
  using public.pipeline_stages s
  where p.record_id = requested_job and s.id = p.stage_id and s.record_status = 'scheduled';
  if job.scheduled_on is distinct from requested_start
    or job.scheduled_end_on is distinct from coalesce(requested_end, requested_start) then
    perform private.queue_schedule_messages('job', requested_job,
      coalesce(requested_notify, false) and requested_start is not null,
      job.scheduled_on is not null);
  end if;
end
$$;
revoke all on function public.schedule_job(uuid, date, date, boolean) from public, anon;
grant execute on function public.schedule_job(uuid, date, date, boolean) to authenticated;

-- Products and services catalog -------------------------------------------

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  unit_price_cents bigint not null default 0 check (abs(unit_price_cents) <= 100000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index catalog_items_org_idx on public.catalog_items (org_id, name);

alter table public.catalog_items enable row level security;
revoke all on public.catalog_items from anon, authenticated;
grant select on public.catalog_items to authenticated;
create policy org_member_read on public.catalog_items for select to authenticated
  using (org_id in (select private.my_org_ids()));

create function public.save_catalog_item(
  requested_id uuid, requested_name text, requested_description text, requested_unit_price_cents bigint)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := coalesce((select org_id from public.catalog_items where id = requested_id), private.web_org_id());
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can edit the catalog.' using errcode = '42501';
  end if;
  insert into public.catalog_items as c (id, org_id, name, description, unit_price_cents)
  values (requested_id, company, btrim(requested_name), coalesce(requested_description, ''),
    coalesce(requested_unit_price_cents, 0))
  on conflict (id) do update set name = excluded.name, description = excluded.description,
    unit_price_cents = excluded.unit_price_cents, updated_at = now()
  where c.org_id = company;
  return requested_id;
end
$$;

create function public.delete_catalog_item(requested_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_org_manager((select org_id from public.catalog_items where id = requested_id)) then
    raise exception 'Only managers can edit the catalog.' using errcode = '42501';
  end if;
  delete from public.catalog_items where id = requested_id;
end
$$;

-- Sending a document --------------------------------------------------------

-- Marks a proposal, change order or invoice sent and, unless the office only
-- wants the link, queues the email or text in the same step. Problems with
-- the customer's address or Quo are reported before anything is marked sent.
-- Messages may use {{document_link}}.
create function public.send_document(
  requested_kind text, requested_id uuid, requested_channel text,
  requested_subject text default '', requested_body text default '')
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid;
  project uuid;
  customer_id uuid;
  customer public.contacts%rowtype;
  token text;
begin
  if requested_kind = 'proposal' then
    select q.org_id, q.lead_id, l.contact_id into company, project, customer_id
    from public.quotes q join public.leads l on l.id = q.lead_id where q.id = requested_id;
  elsif requested_kind in ('change_order', 'invoice') then
    select d.org_id, d.job_id, j.contact_id into company, project, customer_id
    from (
      select org_id, job_id from public.change_orders where id = requested_id and requested_kind = 'change_order'
      union all
      select org_id, job_id from public.invoices where id = requested_id and requested_kind = 'invoice'
    ) d join public.jobs j on j.id = d.job_id;
  else
    raise exception 'Unknown document.' using errcode = '22023';
  end if;
  if company is null then
    raise exception 'Document not found.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(company) then
    raise exception 'Only managers can send documents.' using errcode = '42501';
  end if;
  if requested_channel not in ('email', 'sms', 'link') then
    raise exception 'Choose how to send it.' using errcode = '22023';
  end if;
  select * into customer from public.contacts where id = customer_id;
  if requested_channel = 'email' and nullif(btrim(customer.email), '') is null then
    raise exception 'This customer has no email address.' using errcode = '22023';
  end if;
  if requested_channel = 'sms' and nullif(btrim(customer.phone), '') is null then
    raise exception 'This customer has no phone number.' using errcode = '22023';
  end if;
  if requested_channel = 'sms' and not exists (
    select 1 from private.org_messaging where org_id = company and quo_api_key is not null and quo_from_number is not null) then
    raise exception 'Connect Quo in Settings to send texts.' using errcode = '22023';
  end if;
  if requested_channel <> 'link' and nullif(btrim(requested_body), '') is null then
    raise exception 'Write a message to send.' using errcode = '22023';
  end if;

  token := case requested_kind
    when 'proposal' then public.send_proposal(requested_id)
    when 'change_order' then public.send_change_order(requested_id)
    else public.send_invoice(requested_id) end;

  if requested_channel <> 'link' then
    insert into public.outbound_messages (
      org_id, record_id, contact_id, channel, subject, body, document_kind, document_id)
    values (company, project, customer_id, requested_channel, nullif(btrim(requested_subject), ''),
      btrim(requested_body), requested_kind, requested_id);
  end if;
  return token;
end
$$;
revoke all on function public.send_document(text, uuid, text, text, text) from public, anon;
grant execute on function public.send_document(text, uuid, text, text, text) to authenticated;

-- The send-messages function now also gets each document's link path.
create or replace function public.claim_outbound_messages(batch_size integer default 50)
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
      'documentPath', case m.document_kind
        when 'proposal' then (select '/p/' || public_token from public.quotes where id = m.document_id)
        when 'change_order' then (select '/co/' || public_token from public.change_orders where id = m.document_id)
        when 'invoice' then (select '/i/' || public_token from public.invoices where id = m.document_id)
      end,
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

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'save_reminder_rule(uuid, text, text, text, integer, text, text, text, boolean)',
    'delete_reminder_rule(uuid)',
    'save_catalog_item(uuid, text, text, bigint)',
    'delete_catalog_item(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
