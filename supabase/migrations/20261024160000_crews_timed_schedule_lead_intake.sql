-- Named crews, timed job scheduling and lead intake webhooks.
--
-- Crews: a company's named crews (colour, members, optional lead). Giving a
-- job a crew assigns its members through job_assignments, which the crew apps
-- already read. Jobs get optional daily start/end times; confirmations,
-- reminders and Google Calendar use them. Lead intake: a per-company secret
-- token lets Zapier, Make, Facebook Lead Ads and Google Ads lead forms post
-- leads straight into the sales pipeline's first stage.
begin;

-- Crews ------------------------------------------------------------------

create table public.crews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  color text not null default 'blue'
    check (color in ('blue', 'green', 'orange', 'purple', 'yellow', 'red', 'gray')),
  lead_employee_id uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index crews_org_name_idx on public.crews (org_id, lower(name));

create table public.crew_members (
  crew_id uuid not null references public.crews(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (crew_id, employee_id)
);
create index crew_members_employee_idx on public.crew_members (employee_id);

-- The crew a job was given. Kept beside the job (not on it) so removing a
-- crew never rewrites job rows, including locked historical ones.
create table public.job_crews (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  crew_id uuid not null references public.crews(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  assigned_at timestamptz not null default now()
);
create index job_crews_crew_idx on public.job_crews (crew_id);

alter table public.crews enable row level security;
alter table public.crew_members enable row level security;
alter table public.job_crews enable row level security;
revoke all on public.crews, public.crew_members, public.job_crews from anon, authenticated;
grant select on public.crews, public.crew_members, public.job_crews to authenticated;
create policy member_read on public.crews for select to authenticated
  using (private.is_org_member(org_id));
create policy member_read on public.crew_members for select to authenticated
  using (private.is_org_member(org_id));
create policy member_read on public.job_crews for select to authenticated
  using (private.is_org_member(org_id));

-- Daily working hours for a scheduled job, e.g. 08:00–16:00 on each day.
alter table public.jobs
  add column scheduled_start_time time,
  add column scheduled_end_time time,
  add constraint jobs_scheduled_times_check check (
    (scheduled_start_time is null) = (scheduled_end_time is null)
    and (scheduled_end_time is null or scheduled_end_time > scheduled_start_time));

create function public.get_crew_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can manage crews.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'crews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'color', c.color, 'leadId', c.lead_employee_id,
        'memberIds', coalesce((
          select jsonb_agg(m.employee_id order by (m.employee_id = c.lead_employee_id) desc, e.full_name)
          from public.crew_members m join public.employees e on e.id = m.employee_id
          where m.crew_id = c.id), '[]'::jsonb))
        order by lower(c.name))
      from public.crews c where c.org_id = company), '[]'::jsonb),
    'team', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', coalesce(e.full_name, e.email))
        order by coalesce(e.full_name, e.email))
      from public.org_members m join public.employees e on e.id = m.user_id
      where m.org_id = company and m.is_active and e.is_active), '[]'::jsonb));
end
$$;

-- Creates or updates a crew (the id comes from the browser, so a retried save
-- is harmless). Jobs the crew still has ahead of it follow its new members.
create function public.save_crew(
  requested_id uuid, requested_name text, requested_color text,
  requested_lead uuid, requested_members uuid[])
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  clean_name text := btrim(coalesce(requested_name, ''));
  members uuid[];
  previous uuid[];
  zone text;
  target uuid;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can manage crews.' using errcode = '42501';
  end if;
  if requested_id is null or char_length(clean_name) not between 1 and 60 then
    raise exception 'Enter a crew name of 60 characters or fewer.' using errcode = '22023';
  end if;
  if requested_color is null or requested_color not in ('blue', 'green', 'orange', 'purple', 'yellow', 'red', 'gray') then
    raise exception 'Choose a colour.' using errcode = '22023';
  end if;
  if exists (select 1 from public.crews where id = requested_id and org_id <> company) then
    raise exception 'Crew not found.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.crews where org_id = company and lower(name) = lower(clean_name) and id <> requested_id) then
    raise exception 'Another crew already has that name.' using errcode = '23505';
  end if;
  members := array(
    select distinct x from unnest(coalesce(requested_members, '{}') || requested_lead) x where x is not null);
  if exists (
    select 1 from unnest(members) x
    where not exists (
      select 1 from public.org_members m join public.employees e on e.id = m.user_id
      where m.org_id = company and m.user_id = x and m.is_active and e.is_active)) then
    raise exception 'Choose people on your team.' using errcode = '22023';
  end if;

  perform private.set_acting_org(company);
  previous := array(select employee_id from public.crew_members where crew_id = requested_id);
  insert into public.crews (id, org_id, name, color, lead_employee_id)
  values (requested_id, company, clean_name, requested_color, requested_lead)
  on conflict (id) do update set name = excluded.name, color = excluded.color,
    lead_employee_id = excluded.lead_employee_id, updated_at = now();
  delete from public.crew_members where crew_id = requested_id and employee_id <> all(members);
  insert into public.crew_members (crew_id, employee_id, org_id)
  select requested_id, x, company from unnest(members) x
  on conflict do nothing;

  -- Unfinished jobs this crew has: added people join them, removed people leave.
  select timezone into zone from public.organizations where id = company;
  for target in
    select j.id from public.job_crews jc join public.jobs j on j.id = jc.job_id
    where jc.crew_id = requested_id and j.archived_at is null and j.status in ('scheduled', 'active')
      and coalesce(j.scheduled_end_on, j.scheduled_on, 'infinity'::date) >= (now() at time zone zone)::date
      and not public.is_historical_job_accounting_locked(j.id)
  loop
    perform private.set_job_assignment__unscoped(target, x, true)
    from unnest(members) x
    where x <> all(previous)
      and not exists (select 1 from public.job_assignments a
        where a.job_id = target and a.employee_id = x and a.status = 'active');
    perform private.set_job_assignment__unscoped(target, x, false)
    from unnest(previous) x
    where x <> all(members)
      and exists (select 1 from public.job_assignments a
        where a.job_id = target and a.employee_id = x and a.status = 'active');
  end loop;
  return requested_id;
end
$$;

-- Removes the crew. Its people stay on the jobs they were assigned to.
create function public.delete_crew(requested_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can manage crews.' using errcode = '42501';
  end if;
  delete from public.crews where id = requested_id and org_id = company;
end
$$;

revoke all on function public.get_crew_settings() from public, anon;
revoke all on function public.save_crew(uuid, text, text, uuid, uuid[]) from public, anon;
revoke all on function public.delete_crew(uuid) from public, anon;
grant execute on function public.get_crew_settings() to authenticated;
grant execute on function public.save_crew(uuid, text, text, uuid, uuid[]) to authenticated;
grant execute on function public.delete_crew(uuid) to authenticated;

-- Schedule ---------------------------------------------------------------

create or replace function public.get_job_schedule(range_start date, range_end date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see the schedule.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id, 'name', j.name, 'address', coalesce(j.formatted_address, j.address_line_1),
        'startOn', j.scheduled_on, 'endOn', coalesce(j.scheduled_end_on, j.scheduled_on),
        'startTime', left(j.scheduled_start_time::text, 5), 'endTime', left(j.scheduled_end_time::text, 5),
        'status', j.status, 'valueCents', j.contract_amount_cents,
        'stageName', s.name,
        'crewId', c.id, 'crewName', c.name, 'crewColor', c.color,
        'crew', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.full_name)
            order by (e.id = c.lead_employee_id) desc, e.full_name)
          from public.job_assignments a join public.employees e on e.id = a.employee_id
          where a.job_id = j.id and a.status = 'active'), '[]'::jsonb))
        order by j.scheduled_on, j.scheduled_start_time nulls first, j.name)
      from public.jobs j
      left join public.pipeline_stages s on s.id = private.current_pipeline_stage(j.id)
      left join public.job_crews jc on jc.job_id = j.id
      left join public.crews c on c.id = jc.crew_id
      where j.org_id = company and j.archived_at is null and j.is_feed_visible is not false
        and j.status in ('scheduled', 'active', 'completed')
        and j.scheduled_on <= range_end and coalesce(j.scheduled_end_on, j.scheduled_on) >= range_start
    ), '[]'::jsonb),
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id, 'name', j.name, 'proposalName', q.name, 'valueCents', j.contract_amount_cents,
        'acceptedAt', coalesce(q.accepted_at, j.created_at), 'crewId', jc.crew_id)
        order by coalesce(q.accepted_at, j.created_at) desc)
      from public.jobs j
      left join public.quotes q on q.id = j.accepted_quote_id
      left join public.job_crews jc on jc.job_id = j.id
      where j.org_id = company and j.archived_at is null and j.is_feed_visible is not false
        and j.status = 'scheduled' and j.scheduled_on is null
    ), '[]'::jsonb),
    'crew', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', coalesce(e.full_name, e.email)) order by e.full_name)
      from public.org_members m join public.employees e on e.id = m.user_id
      where m.org_id = company and m.is_active
    ), '[]'::jsonb),
    'crews', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color) order by lower(c.name))
      from public.crews c where c.org_id = company
    ), '[]'::jsonb));
end
$$;

-- Dates, optional daily times and the crew in one save. Giving the job a crew
-- assigns its members; switching crews takes the old crew's members off.
-- Only date or time changes queue customer messages (confirmation only when
-- requested_notify).
drop function public.schedule_job(uuid, date, date, boolean);
create function public.schedule_job(
  requested_job uuid, requested_start date, requested_end date, requested_notify boolean default false,
  requested_start_time time default null, requested_end_time time default null, requested_crew uuid default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  job public.jobs%rowtype;
  new_end date := coalesce(requested_end, requested_start);
  new_start_time time := case when requested_start is not null then requested_start_time end;
  new_end_time time := case when requested_start is not null then requested_end_time end;
  previous_crew uuid;
  times_changed boolean;
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
  if (new_start_time is null) <> (new_end_time is null) then
    raise exception 'Enter both a start and an end time.' using errcode = '22023';
  end if;
  if new_end_time <= new_start_time then
    raise exception 'The end time must be after the start time.' using errcode = '22023';
  end if;
  if requested_crew is not null
    and not exists (select 1 from public.crews where id = requested_crew and org_id = job.org_id) then
    raise exception 'Crew not found.' using errcode = 'P0002';
  end if;
  select crew_id into previous_crew from public.job_crews where job_id = requested_job;
  times_changed := job.scheduled_on is distinct from requested_start
    or job.scheduled_end_on is distinct from new_end
    or job.scheduled_start_time is distinct from new_start_time
    or job.scheduled_end_time is distinct from new_end_time;
  if (times_changed or previous_crew is distinct from requested_crew)
    and public.is_historical_job_accounting_locked(requested_job) then
    raise exception 'Jobs before June 1, 2026 are locked.' using errcode = '42501';
  end if;

  perform private.set_acting_org(job.org_id);
  update public.jobs set scheduled_on = requested_start, scheduled_end_on = new_end,
    scheduled_start_time = new_start_time, scheduled_end_time = new_end_time, updated_at = now()
  where id = requested_job;
  delete from public.pipeline_placements p
  using public.pipeline_stages s
  where p.record_id = requested_job and s.id = p.stage_id and s.record_status = 'scheduled';

  if previous_crew is distinct from requested_crew then
    if previous_crew is not null then
      perform private.set_job_assignment__unscoped(requested_job, m.employee_id, false)
      from public.crew_members m
      where m.crew_id = previous_crew
        and exists (select 1 from public.job_assignments a
          where a.job_id = requested_job and a.employee_id = m.employee_id and a.status = 'active')
        and not exists (select 1 from public.crew_members n
          where n.crew_id = requested_crew and n.employee_id = m.employee_id);
    end if;
    if requested_crew is null then
      delete from public.job_crews where job_id = requested_job;
    else
      insert into public.job_crews (job_id, crew_id, org_id)
      values (requested_job, requested_crew, job.org_id)
      on conflict (job_id) do update set crew_id = excluded.crew_id, assigned_at = now();
    end if;
  end if;
  if requested_crew is not null then
    perform private.set_job_assignment__unscoped(requested_job, m.employee_id, true)
    from public.crew_members m
    join public.org_members o on o.org_id = job.org_id and o.user_id = m.employee_id and o.is_active
    where m.crew_id = requested_crew
      and not exists (select 1 from public.job_assignments a
        where a.job_id = requested_job and a.employee_id = m.employee_id and a.status = 'active');
  end if;

  if times_changed then
    perform private.queue_schedule_messages('job', requested_job,
      coalesce(requested_notify, false) and requested_start is not null,
      job.scheduled_on is not null);
  end if;
end
$$;
revoke all on function public.schedule_job(uuid, date, date, boolean, time, time, uuid) from public, anon;
grant execute on function public.schedule_job(uuid, date, date, boolean, time, time, uuid) to authenticated;

-- Same as before, except a job starts and ends at its own times when set
-- (otherwise 8 AM to 5 PM, as before).
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

-- Google Calendar: jobs with times become timed events (first day's start to
-- last day's end) in the company's time zone, and name their crew; jobs
-- without times stay all-day. The appointment branch is unchanged.
create or replace function public.claim_calendar_sync(batch_size integer default 50)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  with due as (
    select q.user_id, q.source_kind, q.source_id from private.calendar_sync_queue q
    where q.lease_until is null or q.lease_until < now()
    order by q.queued_at
    limit greatest(1, least(batch_size, 200))
    for update skip locked
  ), claimed as (
    update private.calendar_sync_queue q set lease_until = now() + interval '5 minutes', attempts = q.attempts + 1
    from due
    where q.user_id = due.user_id and q.source_kind = due.source_kind and q.source_id = due.source_id
    returning q.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'userId', q.user_id, 'sourceKind', q.source_kind, 'sourceId', q.source_id, 'attempts', q.attempts,
      'refreshToken', c.refresh_token, 'calendarId', coalesce(l.calendar_id, c.calendar_id),
      'existingEventId', l.google_event_id,
      'event', case
        when c.status = 'disconnecting' then null
        when q.source_kind = 'appointment' then (
          select jsonb_build_object(
            'summary', a.title || coalesce(' — ' || d.name, ''),
            'location', coalesce(a.location, d.address),
            'description', a.notes, 'projectId', a.project_id,
            'start', jsonb_build_object('dateTime', a.starts_at),
            'end', jsonb_build_object('dateTime', a.ends_at))
          from public.appointments a
          left join public.project_directory d on d.id = a.project_id
          where a.id = q.source_id and c.sync_appointments and a.assigned_to = q.user_id
            and a.status <> 'cancelled')
        else (
          select jsonb_build_object(
            'summary', j.name,
            'location', coalesce(j.formatted_address, j.address_line_1),
            'description', (select 'Crew: ' || cr.name from public.job_crews jc
              join public.crews cr on cr.id = jc.crew_id where jc.job_id = j.id),
            'projectId', j.id,
            'start', case when j.scheduled_start_time is null
              then jsonb_build_object('date', j.scheduled_on)
              else jsonb_build_object(
                'dateTime', (j.scheduled_on + j.scheduled_start_time) at time zone o.timezone,
                'timeZone', o.timezone) end,
            'end', case when j.scheduled_start_time is null
              then jsonb_build_object('date', coalesce(j.scheduled_end_on, j.scheduled_on) + 1)
              else jsonb_build_object(
                'dateTime', (coalesce(j.scheduled_end_on, j.scheduled_on) + j.scheduled_end_time) at time zone o.timezone,
                'timeZone', o.timezone) end)
          from public.jobs j
          join public.organizations o on o.id = j.org_id
          where j.id = q.source_id and c.sync_jobs and j.scheduled_on is not null
            and j.archived_at is null and j.is_feed_visible is not false
            and j.status in ('scheduled', 'active', 'completed'))
      end)), '[]'::jsonb)
  into result
  from claimed q
  join private.calendar_connections c on c.user_id = q.user_id
  left join private.calendar_event_links l
    on l.user_id = q.user_id and l.source_kind = q.source_kind and l.source_id = q.source_id;
  -- Items whose connection is gone have nothing to do.
  delete from private.calendar_sync_queue q
  where not exists (select 1 from private.calendar_connections c where c.user_id = q.user_id);
  return result;
end
$$;

-- Time changes reach connected calendars too.
drop trigger calendar_sync on public.jobs;
create trigger calendar_sync
  after update of scheduled_on, scheduled_end_on, scheduled_start_time, scheduled_end_time,
    name, status, archived_at, formatted_address, is_feed_visible
  on public.jobs
  for each row execute function private.calendar_sync_after_write();

-- Lead intake ------------------------------------------------------------

-- One secret URL token per company. Managers see it in Settings; whoever has
-- it can post leads, so it can be regenerated.
create table private.lead_intake_tokens (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- Every post, kept 90 days, so Settings can show recent deliveries and
-- retries of the same lead are recognised.
create table private.lead_intake_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  source text not null check (source in ('zapier', 'facebook', 'google')),
  status text not null check (status in ('created', 'duplicate', 'test', 'rejected')),
  dedupe_key text,
  lead_id uuid references public.leads(id) on delete set null,
  summary text,
  error text,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
create index lead_intake_deliveries_org_idx on private.lead_intake_deliveries (org_id, received_at desc);
create index lead_intake_deliveries_dedupe_idx on private.lead_intake_deliveries (org_id, dedupe_key)
  where status = 'created';

alter table private.lead_intake_tokens enable row level security;
alter table private.lead_intake_deliveries enable row level security;
revoke all on private.lead_intake_tokens, private.lead_intake_deliveries from public, anon, authenticated;

create function private.new_lead_intake_token()
returns text
language sql volatile set search_path = ''
as $$
  select encode(extensions.gen_random_bytes(24), 'hex')
$$;
revoke all on function private.new_lead_intake_token() from public, anon, authenticated;

-- The token (created on first look) and the last 20 deliveries.
create function public.get_lead_intake_settings()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  current_token text;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see lead intake.' using errcode = '42501';
  end if;
  insert into private.lead_intake_tokens (org_id, token, created_by)
  values (company, private.new_lead_intake_token(), auth.uid())
  on conflict (org_id) do nothing;
  select token into current_token from private.lead_intake_tokens where org_id = company;
  return jsonb_build_object(
    'token', current_token,
    'deliveries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'source', d.source, 'status', d.status, 'summary', d.summary,
        'error', d.error, 'leadId', l.id, 'receivedAt', d.received_at) order by d.received_at desc)
      from (
        select * from private.lead_intake_deliveries
        where org_id = company order by received_at desc limit 20
      ) d
      left join public.leads l on l.id = d.lead_id
    ), '[]'::jsonb));
end
$$;

-- A new token; the old URLs stop working at once.
create function public.regenerate_lead_intake_token()
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  new_token text := private.new_lead_intake_token();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can change lead intake.' using errcode = '42501';
  end if;
  insert into private.lead_intake_tokens (org_id, token, created_by)
  values (company, new_token, auth.uid())
  on conflict (org_id) do update set token = excluded.token, created_at = now(), created_by = auth.uid();
  return new_token;
end
$$;

-- Called only by the lead-intake edge function (service role) with fields it
-- already mapped from the payload. Matches an existing customer by email or
-- phone, adds the deal to the sales pipeline's first stage with the raw
-- payload in its metadata, and logs the delivery. A retry with the same
-- dedupe key within 30 days returns the first lead.
create function public.receive_lead_intake(
  requested_token text, requested_source text, requested_lead jsonb,
  requested_payload jsonb, requested_dedupe_key text, requested_is_test boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid;
  source_kind text := case when requested_source in ('facebook', 'google') then requested_source else 'zapier' end;
  fields jsonb := coalesce(requested_lead, '{}'::jsonb);
  payload jsonb := coalesce(requested_payload, '{}'::jsonb);
  clean_name text := left(nullif(btrim(fields ->> 'name'), ''), 120);
  clean_email text := lower(nullif(btrim(fields ->> 'email'), ''));
  raw_phone text := left(nullif(btrim(fields ->> 'phone'), ''), 40);
  clean_phone text;
  lead_source text := left(coalesce(nullif(btrim(fields ->> 'source'), ''),
    case source_kind when 'facebook' then 'Meta Ads' when 'google' then 'Google Ads' else 'Webhook' end), 120);
  dedupe text := left(nullif(btrim(requested_dedupe_key), ''), 300);
  summary text;
  existing_lead uuid;
  customer uuid;
  deal uuid := gen_random_uuid();
  delivery uuid := gen_random_uuid();
  entry public.pipeline_stages%rowtype;
begin
  select t.org_id into company
  from private.lead_intake_tokens t
  join public.organizations o on o.id = t.org_id and o.status = 'active'
  where t.token = requested_token;
  if company is null or coalesce(requested_token, '') = '' then
    return jsonb_build_object('status', 'unauthorized');
  end if;

  if clean_email is not null
    and (char_length(clean_email) > 200 or clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    clean_email := null;
  end if;
  clean_phone := nullif(regexp_replace(coalesce(raw_phone, ''), '\D', '', 'g'), '');
  summary := left(coalesce(clean_name, clean_email, raw_phone, 'No name'), 160);

  if (select count(*) from private.lead_intake_deliveries
      where org_id = company and received_at > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('status', 'rate_limited');
  end if;
  delete from private.lead_intake_deliveries where org_id = company and received_at < now() - interval '90 days';

  if coalesce(requested_is_test, false) then
    insert into private.lead_intake_deliveries (id, org_id, source, status, dedupe_key, summary, payload)
    values (delivery, company, source_kind, 'test', dedupe, summary, payload);
    return jsonb_build_object('status', 'test');
  end if;

  if dedupe is not null then
    perform pg_advisory_xact_lock(hashtextextended(company::text || ':' || dedupe, 0));
    select d.lead_id into existing_lead from private.lead_intake_deliveries d
    where d.org_id = company and d.dedupe_key = dedupe and d.status = 'created'
      and d.received_at > now() - interval '30 days'
    order by d.received_at desc limit 1;
    if found then
      insert into private.lead_intake_deliveries (id, org_id, source, status, dedupe_key, lead_id, summary, payload)
      values (delivery, company, source_kind, 'duplicate', dedupe, existing_lead, summary, payload);
      return jsonb_build_object('status', 'duplicate', 'leadId', existing_lead);
    end if;
  end if;

  if clean_email is null and clean_phone is null then
    insert into private.lead_intake_deliveries (id, org_id, source, status, dedupe_key, summary, error, payload)
    values (delivery, company, source_kind, 'rejected', dedupe, summary, 'No email or phone number.', payload);
    return jsonb_build_object('status', 'rejected', 'error', 'A lead needs an email or a phone number.');
  end if;
  clean_name := coalesce(clean_name, split_part(clean_email, '@', 1), raw_phone);

  perform set_config('serviceflow.org_id', company::text, true);

  select c.id into customer from public.contacts c
  where c.org_id = company and c.kind = 'customer'
    and ((clean_email is not null and (c.normalized_email = clean_email or lower(c.email) = clean_email))
      or (char_length(clean_phone) >= 7 and right(coalesce(nullif(c.normalized_phone, ''),
        regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')), 10) = right(clean_phone, 10)))
  order by c.updated_at desc limit 1;
  if customer is null then
    customer := gen_random_uuid();
    insert into public.contacts (id, kind, name, email, phone, normalized_email, normalized_phone, metadata, org_id)
    values (customer, 'customer', clean_name, clean_email, raw_phone, clean_email, clean_phone,
      jsonb_build_object('source', 'lead_intake', 'intake_source', source_kind), company);
  else
    -- Fill in what the customer record was missing; never overwrite.
    update public.contacts set
      email = coalesce(email, clean_email), normalized_email = coalesce(normalized_email, clean_email),
      phone = coalesce(phone, raw_phone), normalized_phone = coalesce(normalized_phone, clean_phone),
      updated_at = now()
    where id = customer
      and ((email is null and clean_email is not null) or (phone is null and raw_phone is not null));
  end if;

  select * into entry from public.pipeline_stages
  where org_id = company and pipeline = 'sales' and not is_closed
  order by position limit 1;

  insert into public.leads (id, contact_id, status, source, address, city, province, postal_code,
    created_at, captured_at, metadata, org_id)
  values (deal, customer, coalesce(entry.record_status, 'new'), lead_source,
    left(nullif(btrim(fields ->> 'address'), ''), 300),
    left(nullif(btrim(fields ->> 'city'), ''), 120),
    left(nullif(btrim(fields ->> 'province'), ''), 80),
    left(nullif(btrim(fields ->> 'postalCode'), ''), 20),
    now(), now(),
    jsonb_build_object('created_by', 'lead_intake', 'intake', jsonb_strip_nulls(jsonb_build_object(
      'source', source_kind, 'deliveryId', delivery,
      'externalId', fields ->> 'externalId', 'form', fields ->> 'form', 'campaign', fields ->> 'campaign'))
      || jsonb_build_object('payload', payload)),
    company);
  if entry.id is not null then
    insert into public.pipeline_placements (record_id, org_id, stage_id, moved_by)
    values (deal, company, entry.id, null);
  end if;
  if nullif(btrim(fields ->> 'note'), '') is not null then
    insert into public.project_notes (org_id, project_id, body, created_by)
    values (company, deal, left(btrim(fields ->> 'note'), 4000), null);
  end if;

  insert into private.lead_intake_deliveries (id, org_id, source, status, dedupe_key, lead_id, summary, payload)
  values (delivery, company, source_kind, 'created', dedupe, deal, summary, payload);
  return jsonb_build_object('status', 'created', 'leadId', deal);
end
$$;

revoke all on function public.get_lead_intake_settings() from public, anon;
revoke all on function public.regenerate_lead_intake_token() from public, anon;
revoke all on function public.receive_lead_intake(text, text, jsonb, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.get_lead_intake_settings() to authenticated;
grant execute on function public.regenerate_lead_intake_token() to authenticated;
grant execute on function public.receive_lead_intake(text, text, jsonb, jsonb, text, boolean) to service_role;

select pg_notify('pgrst', 'reload schema');

commit;
