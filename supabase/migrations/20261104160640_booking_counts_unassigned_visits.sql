-- Suggested times count visits nobody is assigned to (userId null): they are
-- on everyone's day, so new times land near them and never on top of them.
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
    'busy', coalesce((
      select jsonb_agg(jsonb_build_object('userId', b.user_id, 'startsAt', b.starts_at, 'endsAt', b.ends_at))
      from private.calendar_busy b
      join private.calendar_connections c on c.user_id = b.user_id and c.status = 'connected'
      where b.user_id = any(people) and b.starts_at < requested_to and b.ends_at > requested_from), '[]'::jsonb));
end
$$;
