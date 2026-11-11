-- The appointment dialog draws each day: its visits by name, time and address
-- with the drive between them. booking_context now carries each visit's title
-- (the deal or job name, else the appointment's title; the event's title for
-- calendar bookings).
begin;

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
    -- ServiceFlow appointments, and timed events on each person's calendar and
    -- on calendars that block everyone (such as DripJobs bookings): those are
    -- visits too, so times land next to them with the drive in between.
    'appointments', coalesce((
      select jsonb_agg(v.visit)
      from (
        select jsonb_build_object(
          'userId', a.assigned_to, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
          'title', coalesce(nullif(btrim(d.name), ''), nullif(btrim(a.title), '')),
          'location', coalesce(nullif(btrim(a.location), ''), nullif(btrim(d.address), ''))) as visit
        from public.appointments a
        left join public.project_directory d on d.id = a.project_id
        where a.org_id = requested_org and a.status = 'scheduled'
          and (a.assigned_to = any(people) or a.assigned_to is null)
          and a.starts_at < requested_to and a.ends_at > requested_from
          and a.id is distinct from requested_exclude
        union all
        select jsonb_build_object(
          'userId', x.person, 'startsAt', x.starts_at, 'endsAt', x.ends_at, 'title', x.title, 'location', x.location)
        from (
          select b.user_id as person, b.starts_at, b.ends_at, nullif(btrim(b.title), '') as title, b.location
          from private.calendar_busy b
          join private.calendar_connections c on c.user_id = b.user_id and c.status = 'connected'
          where b.user_id = any(people) and not b.all_day
            and b.starts_at < requested_to and b.ends_at > requested_from
          union
          select p.person, b.starts_at, b.ends_at, nullif(btrim(b.title), ''), b.location
          from private.calendar_busy b
          join private.calendar_connections c
            on c.user_id = b.user_id and c.status = 'connected' and c.org_id = requested_org and c.blocks_everyone
          cross join unnest(people) as p(person)
          where not b.all_day and b.starts_at < requested_to and b.ends_at > requested_from) x) v), '[]'::jsonb),
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

notify pgrst, 'reload schema';
commit;
