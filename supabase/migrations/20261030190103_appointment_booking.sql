-- Suggested appointment times: the hours each team member takes
-- appointments, a break between visits and a fallback drive time per company,
-- Google Calendar busy times, and cached Google drive times. The booking edge
-- function ranks open times (hours minus appointments, busy times, breaks and
-- the drive to and from each visit) against the days and times a customer asks for.

create table private.booking_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 120),
  -- Drive time between visits when Google can't estimate it.
  travel_minutes integer not null default 30 check (travel_minutes between 0 and 180),
  updated_at timestamptz not null default now()
);

create table private.team_availability (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.employees(id) on delete cascade,
  takes_bookings boolean not null default false,
  -- [{"day": 1, "start": "09:00", "end": "17:00"}]: day 0 is Sunday, company time.
  hours jsonb not null default '[]'::jsonb,
  max_per_day integer check (max_per_day between 1 and 20),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Busy times read from the Google Calendars of people who take appointments.
create table private.calendar_busy (
  user_id uuid not null references auth.users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null
);
create index calendar_busy_user_idx on private.calendar_busy (user_id, starts_at);
alter table private.calendar_connections add column busy_synced_at timestamptz;

-- Google drive times and distances between normalized addresses.
create table private.travel_times (
  from_key text not null,
  to_key text not null,
  seconds integer not null check (seconds >= 0),
  meters integer check (meters >= 0),
  fetched_at timestamptz not null default now(),
  primary key (from_key, to_key)
);

alter table private.booking_settings enable row level security;
alter table private.team_availability enable row level security;
alter table private.calendar_busy enable row level security;
alter table private.travel_times enable row level security;
revoke all on private.booking_settings, private.team_availability, private.calendar_busy, private.travel_times
  from public, anon, authenticated;

-- Checks a week of hours and returns it in a standard form.
create function private.clean_booking_hours(raw jsonb)
returns jsonb
language plpgsql immutable set search_path = ''
as $$
declare
  item jsonb;
  result jsonb := '[]'::jsonb;
  weekday integer;
  starts time;
  ends time;
begin
  if raw is null or jsonb_typeof(raw) <> 'array' or jsonb_array_length(raw) > 21 then
    raise exception 'Hours must be a list of days.' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(raw) loop
    begin
      weekday := (item ->> 'day')::integer;
      starts := (item ->> 'start')::time;
      ends := (item ->> 'end')::time;
    exception when others then
      raise exception 'Each day needs a start and an end time.' using errcode = '22023';
    end;
    if weekday is null or weekday not between 0 and 6 or starts is null or ends is null or starts >= ends then
      raise exception 'Each day must end after it starts.' using errcode = '22023';
    end if;
    result := result || jsonb_build_array(jsonb_build_object(
      'day', weekday, 'start', to_char(starts, 'HH24:MI'), 'end', to_char(ends, 'HH24:MI')));
  end loop;
  if exists (
    select 1
    from jsonb_array_elements(result) with ordinality a(item, n)
    join jsonb_array_elements(result) with ordinality b(item, m)
      on a.n < b.m and a.item ->> 'day' = b.item ->> 'day'
    where (a.item ->> 'start')::time < (b.item ->> 'end')::time
      and (b.item ->> 'start')::time < (a.item ->> 'end')::time) then
    raise exception 'Hours on the same day overlap.' using errcode = '22023';
  end if;
  return result;
end
$$;
revoke all on function private.clean_booking_hours(jsonb) from public, anon, authenticated;

-- Settings › Availability (managers) ---------------------------------------------

-- The company's break and fallback drive time, and everyone's hours.
create function public.get_booking_settings()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  s private.booking_settings%rowtype;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see availability.' using errcode = '42501';
  end if;
  select * into s from private.booking_settings where org_id = company;
  return jsonb_build_object(
    'bufferMinutes', coalesce(s.buffer_minutes, 0), 'travelMinutes', coalesce(s.travel_minutes, 30),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', coalesce(nullif(btrim(e.full_name), ''), e.email, 'Team member'),
        'takesBookings', coalesce(a.takes_bookings, false), 'hours', coalesce(a.hours, '[]'::jsonb),
        'maxPerDay', a.max_per_day,
        'calendarConnected', exists (
          select 1 from private.calendar_connections c where c.user_id = e.id and c.status = 'connected'))
        order by lower(coalesce(nullif(btrim(e.full_name), ''), e.email)))
      from public.org_members m
      join public.employees e on e.id = m.user_id
      left join private.team_availability a on a.org_id = company and a.user_id = e.id
      where m.org_id = company and m.is_active), '[]'::jsonb));
end
$$;

create function public.save_booking_settings(requested_buffer_minutes integer, requested_travel_minutes integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can change availability.' using errcode = '42501';
  end if;
  insert into private.booking_settings as s (org_id, buffer_minutes, travel_minutes)
  values (company, coalesce(requested_buffer_minutes, 0), coalesce(requested_travel_minutes, 30))
  on conflict (org_id) do update set buffer_minutes = excluded.buffer_minutes,
    travel_minutes = excluded.travel_minutes, updated_at = now();
end
$$;

-- Managers set anyone's hours; others their own.
create function public.save_team_availability(
  requested_user uuid, requested_takes_bookings boolean, requested_hours jsonb, requested_max_per_day integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  clean jsonb := private.clean_booking_hours(coalesce(requested_hours, '[]'::jsonb));
begin
  if company is null or not (private.is_org_manager(company) or requested_user = auth.uid()) then
    raise exception 'Only managers can change someone else''s hours.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.org_members where org_id = company and user_id = requested_user and is_active) then
    raise exception 'Pick someone on your team.' using errcode = '22023';
  end if;
  if requested_takes_bookings and jsonb_array_length(clean) = 0 then
    raise exception 'Add at least one day.' using errcode = '22023';
  end if;
  if requested_max_per_day is not null and requested_max_per_day not between 1 and 20 then
    raise exception 'Pick a daily limit between 1 and 20.' using errcode = '22023';
  end if;
  insert into private.team_availability as a (org_id, user_id, takes_bookings, hours, max_per_day)
  values (company, requested_user, coalesce(requested_takes_bookings, false), clean, requested_max_per_day)
  on conflict (org_id, user_id) do update set takes_bookings = excluded.takes_bookings,
    hours = excluded.hours, max_per_day = excluded.max_per_day, updated_at = now();
end
$$;

-- The signed-in manager's company, for the booking function.
create function public.booking_staff_org()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can book appointments.' using errcode = '42501';
  end if;
  return company;
end
$$;

-- Booking function (service role) --------------------------------------------------

-- What ranking times needs, for a company the function already checked the
-- staff member belongs to: its rules, the people who take appointments (or
-- just requested_user), and their appointments and Google busy times in the
-- range. requested_exclude is the visit being moved.
create function public.booking_context(
  requested_org uuid, requested_from timestamptz, requested_to timestamptz,
  requested_user uuid default null, requested_exclude uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s private.booking_settings%rowtype;
  people uuid[];
begin
  select * into s from private.booking_settings where org_id = requested_org;
  select array_agg(a.user_id) into people
  from private.team_availability a
  join public.org_members m on m.org_id = a.org_id and m.user_id = a.user_id and m.is_active
  where a.org_id = requested_org and a.takes_bookings and (requested_user is null or a.user_id = requested_user);

  return jsonb_build_object(
    'timezone', (select timezone from public.organizations where id = requested_org),
    'bufferMinutes', coalesce(s.buffer_minutes, 0),
    'travelMinutes', coalesce(s.travel_minutes, 30),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.user_id, 'name', coalesce(nullif(btrim(e.full_name), ''), e.email, 'Team member'),
        'hours', a.hours, 'maxPerDay', a.max_per_day))
      from private.team_availability a
      join public.employees e on e.id = a.user_id
      where a.org_id = requested_org and a.user_id = any(people)), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', a.assigned_to, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
        'location', coalesce(nullif(btrim(a.location), ''), nullif(btrim(d.address), ''))))
      from public.appointments a
      left join public.project_directory d on d.id = a.project_id
      where a.org_id = requested_org and a.status = 'scheduled' and a.assigned_to = any(people)
        and a.starts_at < requested_to and a.ends_at > requested_from
        and a.id is distinct from requested_exclude), '[]'::jsonb),
    'busy', coalesce((
      select jsonb_agg(jsonb_build_object('userId', b.user_id, 'startsAt', b.starts_at, 'endsAt', b.ends_at))
      from private.calendar_busy b
      join private.calendar_connections c on c.user_id = b.user_id and c.status = 'connected'
      where b.user_id = any(people) and b.starts_at < requested_to and b.ends_at > requested_from), '[]'::jsonb));
end
$$;

create function public.cached_travel_times(requested_pairs jsonb)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'from', t.from_key, 'to', t.to_key, 'seconds', t.seconds, 'meters', t.meters)), '[]'::jsonb)
  from jsonb_to_recordset(coalesce(requested_pairs, '[]'::jsonb)) p(from_key text, to_key text)
  join private.travel_times t on t.from_key = p.from_key and t.to_key = p.to_key
  where t.fetched_at > now() - interval '60 days'
$$;

create function public.save_travel_times(requested_rows jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into private.travel_times as t (from_key, to_key, seconds, meters)
  select left(r.from_key, 500), left(r.to_key, 500), greatest(r.seconds, 0), greatest(r.meters, 0)
  from jsonb_to_recordset(coalesce(requested_rows, '[]'::jsonb)) r(from_key text, to_key text, seconds integer, meters integer)
  where r.from_key is not null and r.to_key is not null and r.seconds is not null
  on conflict (from_key, to_key) do update set seconds = excluded.seconds, meters = excluded.meters, fetched_at = now()
$$;

-- Google Calendar busy times (calendar-sync, service role) -------------------------

-- Connected people who take appointments and whose busy times are over 10
-- minutes old. Suggestions look three weeks ahead.
create function public.claim_calendar_busy(batch_size integer default 10)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  with due as (
    select c.user_id from private.calendar_connections c
    where c.status = 'connected'
      and (c.busy_synced_at is null or c.busy_synced_at < now() - interval '10 minutes')
      and exists (select 1 from private.team_availability a
        where a.org_id = c.org_id and a.user_id = c.user_id and a.takes_bookings)
    order by c.busy_synced_at nulls first
    limit greatest(1, least(batch_size, 50))
    for update of c skip locked
  ), claimed as (
    update private.calendar_connections c set busy_synced_at = now()
    from due where c.user_id = due.user_id
    returning c.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', c.user_id, 'refreshToken', c.refresh_token, 'calendarId', c.calendar_id,
    'timezone', o.timezone, 'until', now() + interval '22 days')), '[]'::jsonb)
  into result
  from claimed c
  join public.organizations o on o.id = c.org_id;
  return result;
end
$$;

-- Replaces a person's busy times, or marks the connection broken.
create function public.save_calendar_busy(
  requested_user uuid, requested_blocks jsonb, requested_error text default null,
  requested_connection_error boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if requested_connection_error then
    update private.calendar_connections set status = 'error', last_error = left(requested_error, 500), updated_at = now()
    where user_id = requested_user and status = 'connected';
    return;
  end if;
  if requested_blocks is null then
    return;
  end if;
  delete from private.calendar_busy where user_id = requested_user;
  insert into private.calendar_busy (user_id, starts_at, ends_at)
  select requested_user, b.starts_at, b.ends_at
  from jsonb_to_recordset(requested_blocks) b(starts_at timestamptz, ends_at timestamptz)
  where b.starts_at is not null and b.ends_at > b.starts_at
  limit 2000;
end
$$;

-- Grants -----------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'get_booking_settings()',
    'save_booking_settings(integer, integer)',
    'save_team_availability(uuid, boolean, jsonb, integer)',
    'booking_staff_org()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  foreach fn in array array[
    'booking_context(uuid, timestamptz, timestamptz, uuid, uuid)',
    'cached_travel_times(jsonb)',
    'save_travel_times(jsonb)',
    'claim_calendar_busy(integer)',
    'save_calendar_busy(uuid, jsonb, text, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');
