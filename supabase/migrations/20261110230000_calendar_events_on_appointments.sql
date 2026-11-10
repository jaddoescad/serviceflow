-- The Appointments calendar shows what is on connected Google Calendars
-- (for example estimates still booked in DripJobs) as read-only entries. Busy
-- times now keep each event's title, address and whether it lasts all day,
-- and are read from five weeks back to about two months ahead so the month
-- view has them. Apply after 20261110210000_calendar_data_deletion.sql.
begin;

alter table private.calendar_busy
  add column if not exists title text,
  add column if not exists location text,
  add column if not exists all_day boolean not null default false;

-- Same as 20261110210000's version, plus title, location and all_day.
create or replace function public.save_calendar_busy(
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
  if not exists (
    select 1 from private.calendar_connections where user_id = requested_user and status = 'connected') then
    return;
  end if;
  insert into private.calendar_busy (user_id, starts_at, ends_at, title, location, all_day)
  select requested_user, b.starts_at, b.ends_at,
    left(nullif(btrim(b.title), ''), 300), left(nullif(btrim(b.location), ''), 500), coalesce(b.all_day, false)
  from jsonb_to_recordset(requested_blocks)
    b(starts_at timestamptz, ends_at timestamptz, title text, location text, all_day boolean)
  where b.starts_at is not null and b.ends_at > b.starts_at
  limit 4000;
end
$$;

-- Same as before, plus "since", and "until" about two months ahead.
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
    'timezone', o.timezone, 'since', now() - interval '35 days', 'until', now() + interval '62 days')), '[]'::jsonb)
  into result
  from claimed c
  join public.organizations o on o.id = c.org_id;
  return result;
end
$$;

-- Managers: the events on their team's connected calendars in a range.
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
      'calendar', c.google_email,
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
revoke all on function public.list_calendar_events(timestamptz, timestamptz) from public, anon;
grant execute on function public.list_calendar_events(timestamptz, timestamptz) to authenticated;
revoke all on function public.save_calendar_busy(uuid, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.save_calendar_busy(uuid, jsonb, text, boolean) to service_role;
revoke all on function public.claim_calendar_busy(integer) from public, anon, authenticated;
grant execute on function public.claim_calendar_busy(integer) to service_role;

notify pgrst, 'reload schema';
commit;
