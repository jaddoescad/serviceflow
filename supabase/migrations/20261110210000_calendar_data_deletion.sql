-- Google Calendar data is deleted when it is no longer needed, as the privacy
-- policy says: busy times when a calendar is disconnected, and all calendar
-- data when a person deletes their account (the login is only soft-deleted,
-- so the tables' on-delete-cascade never runs).
begin;

-- Disconnecting deletes busy times straight away; removing the events
-- ServiceFlow added still goes through the sync queue as before.
create or replace function public.disconnect_my_calendar()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update private.calendar_connections set status = 'disconnecting', updated_at = now()
  where user_id = auth.uid();
  delete from private.calendar_busy where user_id = auth.uid();
  if not exists (select 1 from private.calendar_event_links where user_id = auth.uid()) then
    delete from private.calendar_sync_queue where user_id = auth.uid();
    delete from private.calendar_connections where user_id = auth.uid();
    return;
  end if;
  delete from private.calendar_sync_queue where user_id = auth.uid();
  perform private.queue_calendar_sync(auth.uid(), l.source_kind, l.source_id)
  from private.calendar_event_links l where l.user_id = auth.uid();
end
$$;

-- A busy-time read that finishes after the calendar was disconnected (or
-- broke) saves nothing, so it can't put deleted busy times back.
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
  insert into private.calendar_busy (user_id, starts_at, ends_at)
  select requested_user, b.starts_at, b.ends_at
  from jsonb_to_recordset(requested_blocks) b(starts_at timestamptz, ends_at timestamptz)
  where b.starts_at is not null and b.ends_at > b.starts_at
  limit 2000;
end
$$;

create or replace function public.prepare_account_deletion(requested_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  blocking_company text;
begin
  -- Don't strand a team: the last owner or admin of a company that still has
  -- other active members must hand it over first.
  select o.name into blocking_company
  from public.org_members me
  join public.organizations o on o.id = me.org_id
  where me.user_id = requested_user
    and me.is_active
    and me.role in ('owner', 'admin')
    and not exists (
      select 1 from public.org_members other
      where other.org_id = me.org_id and other.user_id <> requested_user
        and other.is_active and other.role in ('owner', 'admin'))
    and exists (
      select 1 from public.org_members other
      where other.org_id = me.org_id and other.user_id <> requested_user and other.is_active)
  limit 1;
  if blocking_company is not null then
    return jsonb_build_object('ok', false, 'reason', 'last_admin', 'company', blocking_company);
  end if;

  -- Companies with no one else left are suspended rather than orphaned.
  update public.organizations o
  set status = 'suspended', updated_at = now()
  where exists (select 1 from public.org_members m where m.org_id = o.id and m.user_id = requested_user and m.is_active)
    and not exists (select 1 from public.org_members m where m.org_id = o.id and m.user_id <> requested_user and m.is_active);

  update public.org_members set is_active = false, updated_at = now() where user_id = requested_user;
  delete from public.push_tokens where employee_id = requested_user;
  delete from public.employee_location_points where employee_id = requested_user;
  delete from public.employee_tracking_status where employee_id = requested_user;
  delete from public.location_alerts where employee_id = requested_user;
  -- Google Calendar: the token, busy times and records of the events it added.
  -- Events already on their calendar stay there; the token to remove them is gone.
  delete from private.calendar_sync_queue where user_id = requested_user;
  delete from private.calendar_event_links where user_id = requested_user;
  delete from private.calendar_busy where user_id = requested_user;
  delete from private.calendar_connections where user_id = requested_user;
  update public.employees
  set full_name = 'Deleted user', email = null, phone = null, job_title = null,
      is_active = false, updated_at = now()
  where id = requested_user;

  return jsonb_build_object('ok', true);
end
$$;

-- Busy times left from earlier disconnects, and calendar data of people who
-- already deleted their account.
delete from private.calendar_busy b
where not exists (
  select 1 from private.calendar_connections c where c.user_id = b.user_id and c.status = 'connected');
delete from private.calendar_sync_queue q using auth.users u where u.id = q.user_id and u.deleted_at is not null;
delete from private.calendar_event_links l using auth.users u where u.id = l.user_id and u.deleted_at is not null;
delete from private.calendar_connections c using auth.users u where u.id = c.user_id and u.deleted_at is not null;

notify pgrst, 'reload schema';
commit;
