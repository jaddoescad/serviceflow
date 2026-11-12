-- Booking an appointment chooses which customer messages it sends: each
-- confirmation and reminder that applies to its type is a checkbox on the
-- form, ticked or not by default per rule (Drips › Reminders). The choice is
-- kept on the appointment, so moving it re-plans the same messages.
begin;

alter table public.reminder_rules
  add column checked_by_default boolean not null default true;

-- null: booked before there was a choice, so every applicable rule sends.
alter table public.appointments
  add column message_rule_ids uuid[];

create or replace function private.queue_schedule_messages(
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
    starts := (job_row.scheduled_on + coalesce(job_row.scheduled_start_time, time '08:00')) at time zone zone;
    ends := (coalesce(job_row.scheduled_end_on, job_row.scheduled_on)
      + coalesce(job_row.scheduled_end_time, time '17:00')) at time zone zone;
  end if;
  customer := coalesce(
    (select contact_id from public.leads where id = project),
    (select contact_id from public.jobs where id = project));

  for rr in
    select * from public.reminder_rules r
    where r.org_id = company and r.is_enabled and r.target = requested_target
      and (r.appointment_kind is null or r.appointment_kind = appt_kind)
      -- An appointment sends only the messages ticked when it was booked;
      -- one booked before there was a choice sends every one.
      and (requested_target <> 'appointment' or appt.message_rule_ids is null or r.id = any(appt.message_rule_ids))
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

drop function public.save_appointment(uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, text, boolean);
create function public.save_appointment(
  requested_id uuid, requested_project uuid, requested_title text, requested_starts_at timestamptz,
  requested_ends_at timestamptz, requested_assigned_to uuid, requested_location text,
  requested_notes text, requested_status text default 'scheduled',
  requested_kind text default null, requested_notify boolean default false,
  requested_message_rule_ids uuid[] default null)
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
    or existing.kind is distinct from coalesce(requested_kind, existing.kind)
    or (requested_message_rule_ids is not null
      and existing.message_rule_ids is distinct from requested_message_rule_ids);

  insert into public.appointments as a (
    id, org_id, project_id, title, starts_at, ends_at, assigned_to, location, notes, status, kind,
    message_rule_ids)
  values (
    requested_id, company, requested_project, btrim(requested_title), requested_starts_at,
    requested_ends_at, requested_assigned_to, nullif(btrim(requested_location), ''),
    nullif(btrim(requested_notes), ''), requested_status, coalesce(requested_kind, 'estimate'),
    requested_message_rule_ids)
  on conflict (id) do update set
    project_id = excluded.project_id, title = excluded.title, starts_at = excluded.starts_at,
    ends_at = excluded.ends_at, assigned_to = excluded.assigned_to, location = excluded.location,
    notes = excluded.notes, status = excluded.status,
    kind = coalesce(requested_kind, a.kind),
    message_rule_ids = coalesce(requested_message_rule_ids, a.message_rule_ids), updated_at = now();

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
revoke all on function public.save_appointment(uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, text, boolean, uuid[]) from public, anon;
grant execute on function public.save_appointment(uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, text, boolean, uuid[]) to authenticated;

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
      'projectName', d.name, 'projectAddress', d.address,
      'messageRuleIds', a.message_rule_ids) order by a.starts_at)
    from public.appointments a
    left join public.employees e on e.id = a.assigned_to
    left join public.project_directory d on d.id = a.project_id
    where a.org_id = company and a.starts_at < range_end and a.ends_at > range_start
  ), '[]'::jsonb);
end
$$;

drop function public.save_reminder_rule(uuid, text, text, text, integer, text, text, text, boolean);
create function public.save_reminder_rule(
  requested_id uuid, requested_target text, requested_appointment_kind text, requested_trigger text,
  requested_offset_minutes integer, requested_channel text, requested_subject text, requested_body text,
  requested_enabled boolean, requested_checked_by_default boolean default true)
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
    id, org_id, target, appointment_kind, trigger, offset_minutes, channel, subject, body, is_enabled,
    checked_by_default)
  values (
    requested_id, company, requested_target,
    case when requested_target = 'appointment' then nullif(requested_appointment_kind, '') end,
    requested_trigger, case when requested_trigger = 'reminder' then coalesce(requested_offset_minutes, 0) else 0 end,
    requested_channel, nullif(btrim(requested_subject), ''), btrim(requested_body), coalesce(requested_enabled, true),
    coalesce(requested_checked_by_default, true))
  on conflict (id) do update set
    target = excluded.target, appointment_kind = excluded.appointment_kind, trigger = excluded.trigger,
    offset_minutes = excluded.offset_minutes, channel = excluded.channel, subject = excluded.subject,
    body = excluded.body, is_enabled = excluded.is_enabled,
    checked_by_default = excluded.checked_by_default, updated_at = now()
  where r.org_id = company;
  -- Turning a rule off stops what it already queued.
  if not coalesce(requested_enabled, true) then
    update public.outbound_messages set status = 'cancelled', error = 'Reminder turned off.'
    where reminder_rule_id = requested_id and status = 'queued';
  end if;
  return requested_id;
end
$$;
revoke all on function public.save_reminder_rule(uuid, text, text, text, integer, text, text, text, boolean, boolean) from public, anon;
grant execute on function public.save_reminder_rule(uuid, text, text, text, integer, text, text, text, boolean, boolean) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
