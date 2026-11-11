-- Google Calendar shows what ServiceFlow shows: a connected calendar gets the
-- appointments its owner can see on the Appointments calendar (owners, admins
-- and managers see every appointment; others the ones assigned to them).
-- sees_appointment is that one rule, so limiting what someone sees later
-- limits their Google Calendar too. A manager can also let a calendar's other
-- events (for example DripJobs bookings on info@paintersottawa.com) block
-- everyone's suggested times; those events are then read whether or not the
-- owner takes appointments, and show on the Appointments calendar whoever is
-- filtered for.
begin;

alter table private.calendar_connections
  add column if not exists blocks_everyone boolean not null default false;

-- Whether viewer sees an appointment of company assigned to assignee.
create or replace function private.sees_appointment(viewer uuid, company uuid, assignee uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select assignee = viewer or exists (
    select 1 from public.org_members m
    where m.org_id = company and m.user_id = viewer and m.is_active and m.role in ('owner', 'admin', 'manager'))
$$;
revoke all on function private.sees_appointment(uuid, uuid, uuid) from public, anon, authenticated;

drop function if exists public.set_my_calendar_sync(boolean, boolean);

create or replace function private.calendar_sync_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  kind text := case tg_table_name when 'appointments' then 'appointment' else 'job' end;
  company uuid := new.org_id;
begin
  begin
    perform private.queue_calendar_sync(c.user_id, kind, new.id)
    from private.calendar_connections c
    where c.org_id = company and c.status <> 'disconnecting'
      and case kind
        -- Calendars that already hold it are re-checked below (a reassignment can remove it).
        when 'appointment' then c.sync_appointments
          and private.sees_appointment(c.user_id, company, (to_jsonb(new) ->> 'assigned_to')::uuid)
        else c.sync_jobs end;
    perform private.queue_calendar_sync(l.user_id, kind, new.id)
    from private.calendar_event_links l
    where l.source_kind = kind and l.source_id = new.id;
  exception when others then
    raise warning 'Calendar sync queue failed for %: %', new.id, sqlerrm;
  end;
  return null;
end
$$;

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
            'summary', a.title || coalesce(' — ' || d.name, '')
              || case when a.assigned_to is distinct from q.user_id
                then coalesce(' (' || nullif(btrim(e.full_name), '') || ')', '') else '' end,
            'location', coalesce(a.location, d.address),
            'description', a.notes, 'projectId', a.project_id,
            'start', jsonb_build_object('dateTime', a.starts_at),
            'end', jsonb_build_object('dateTime', a.ends_at))
          from public.appointments a
          left join public.project_directory d on d.id = a.project_id
          left join public.employees e on e.id = a.assigned_to
          where a.id = q.source_id and c.sync_appointments
            and private.sees_appointment(q.user_id, a.org_id, a.assigned_to)
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

create or replace function private.backfill_calendar(target_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  conn private.calendar_connections%rowtype;
begin
  select * into conn from private.calendar_connections where user_id = target_user;
  if not found then
    return;
  end if;
  perform private.queue_calendar_sync(target_user, 'appointment', a.id)
  from public.appointments a
  where a.org_id = conn.org_id and private.sees_appointment(target_user, conn.org_id, a.assigned_to)
    and a.status = 'scheduled' and a.starts_at >= now() - interval '1 day';
  if conn.sync_jobs then
    perform private.queue_calendar_sync(target_user, 'job', j.id)
    from public.jobs j
    where j.org_id = conn.org_id and j.scheduled_on is not null
      and coalesce(j.scheduled_end_on, j.scheduled_on) >= current_date - 7
      and j.archived_at is null and j.status in ('scheduled', 'active', 'completed');
  end if;
  -- Items already on the calendar are re-checked too (an option switched off removes them).
  perform private.queue_calendar_sync(target_user, l.source_kind, l.source_id)
  from private.calendar_event_links l where l.user_id = target_user;
end
$$;

create or replace function public.get_my_calendar_connection()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object('connected', true, 'googleEmail', c.google_email, 'status', c.status,
      'syncAppointments', c.sync_appointments, 'syncJobs', c.sync_jobs,
      'blocksEveryone', c.blocks_everyone, 'lastError', c.last_error,
      'pending', (select count(*) from private.calendar_sync_queue q where q.user_id = c.user_id))
    from private.calendar_connections c where c.user_id = auth.uid()),
    jsonb_build_object('connected', false))
$$;

create or replace function public.set_my_calendar_sync(
  requested_appointments boolean, requested_jobs boolean, requested_blocks_everyone boolean default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if requested_blocks_everyone and not private.is_org_manager(private.web_org_id()) then
    raise exception 'Only managers can make their calendar block everyone''s times.' using errcode = '42501';
  end if;
  update private.calendar_connections set sync_appointments = coalesce(requested_appointments, sync_appointments),
    sync_jobs = coalesce(requested_jobs, sync_jobs),
    blocks_everyone = coalesce(requested_blocks_everyone, blocks_everyone), updated_at = now()
  where user_id = auth.uid() and status <> 'disconnecting';
  if not found then
    raise exception 'Connect Google Calendar first.' using errcode = 'P0002';
  end if;
  perform private.backfill_calendar(auth.uid());
end
$$;

create or replace function public.claim_calendar_busy(batch_size integer default 10)
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
      and (c.blocks_everyone or exists (select 1 from private.team_availability a
        where a.org_id = c.org_id and a.user_id = c.user_id and a.takes_bookings))
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
    'timezone', o.timezone, 'since', now() - interval '35 days', 'until', now() + interval '62 days')), '[]'::jsonb)
  into result
  from claimed c
  join public.organizations o on o.id = c.org_id;
  return result;
end
$$;

create or replace function public.booking_context(
  requested_org uuid,
  requested_from timestamptz,
  requested_to timestamptz,
  requested_user uuid default null,
  requested_exclude uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
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
      where a.org_id = requested_org and a.status = 'scheduled'
        and (a.assigned_to = any(people) or a.assigned_to is null)
        and a.starts_at < requested_to and a.ends_at > requested_from
        and a.id is distinct from requested_exclude), '[]'::jsonb),
    -- Each person's own calendar, and calendars that block everyone.
    'busy', coalesce((
      select jsonb_agg(jsonb_build_object('userId', x.person, 'startsAt', x.starts_at, 'endsAt', x.ends_at))
      from (
        select b.user_id as person, b.starts_at, b.ends_at
        from private.calendar_busy b
        join private.calendar_connections c on c.user_id = b.user_id and c.status = 'connected'
        where b.user_id = any(people) and b.starts_at < requested_to and b.ends_at > requested_from
        union
        select p.person, b.starts_at, b.ends_at
        from private.calendar_busy b
        join private.calendar_connections c
          on c.user_id = b.user_id and c.status = 'connected' and c.org_id = requested_org and c.blocks_everyone
        cross join unnest(people) as p(person)
        where b.starts_at < requested_to and b.ends_at > requested_from) x), '[]'::jsonb));
end
$$;

create or replace function public.list_calendar_events(requested_from timestamptz, requested_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see team calendars.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'userId', b.user_id,
      'personName', coalesce(nullif(btrim(e.full_name), ''), e.email, 'Team member'),
      'calendar', c.google_email, 'shared', c.blocks_everyone,
      'title', b.title, 'location', b.location,
      'startsAt', b.starts_at, 'endsAt', b.ends_at, 'allDay', b.all_day)
      order by b.starts_at)
    from private.calendar_busy b
    join private.calendar_connections c on c.user_id = b.user_id and c.org_id = company and c.status = 'connected'
    join public.org_members m on m.org_id = company and m.user_id = b.user_id and m.is_active
    join public.employees e on e.id = b.user_id
    where b.starts_at < requested_to and b.ends_at > requested_from
      and b.ends_at - b.starts_at <= interval '14 days'), '[]'::jsonb);
end
$$;

revoke all on function public.set_my_calendar_sync(boolean, boolean, boolean) from public, anon;
grant execute on function public.set_my_calendar_sync(boolean, boolean, boolean) to authenticated;

-- Connected calendars get the appointments they can now see.
select private.backfill_calendar(c.user_id) from private.calendar_connections c where c.status = 'connected';

notify pgrst, 'reload schema';
commit;
