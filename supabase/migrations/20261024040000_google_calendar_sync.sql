-- Google Calendar: each team member can connect their own Google Calendar.
-- Their appointments (and, if they choose, the job schedule) are pushed to it
-- and kept up to date. Changes queue a sync; the calendar-sync function works
-- the queue every minute. Refresh tokens stay in the private schema.
begin;

create table private.calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  google_email text,
  refresh_token text not null,
  calendar_id text not null default 'primary',
  sync_appointments boolean not null default true,
  sync_jobs boolean not null default false,
  status text not null default 'connected' check (status in ('connected', 'error', 'disconnecting')),
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table private.calendar_event_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null check (source_kind in ('appointment', 'job')),
  source_id uuid not null,
  google_event_id text not null,
  calendar_id text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, source_kind, source_id)
);

create table private.calendar_sync_queue (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null check (source_kind in ('appointment', 'job')),
  source_id uuid not null,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0,
  lease_until timestamptz,
  last_error text,
  primary key (user_id, source_kind, source_id)
);

create function private.queue_calendar_sync(target_user uuid, requested_kind text, requested_source uuid)
returns void
language sql security definer set search_path = ''
as $$
  insert into private.calendar_sync_queue (user_id, source_kind, source_id)
  values (target_user, requested_kind, requested_source)
  on conflict (user_id, source_kind, source_id) do update
    set queued_at = now(), lease_until = null, attempts = 0, last_error = null
$$;
revoke all on function private.queue_calendar_sync(uuid, text, uuid) from public, anon, authenticated;

-- Appointments sync to their assignee's calendar (and away from a previous
-- assignee's); jobs sync to everyone who chose the job schedule. Syncing never
-- blocks the change that triggered it.
create function private.calendar_sync_after_write()
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
        when 'appointment' then c.sync_appointments and (
          c.user_id = (to_jsonb(new) ->> 'assigned_to')::uuid
          or (tg_op = 'UPDATE' and c.user_id = (to_jsonb(old) ->> 'assigned_to')::uuid))
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
revoke all on function private.calendar_sync_after_write() from public, anon, authenticated;

create trigger calendar_sync after insert or update on public.appointments
  for each row execute function private.calendar_sync_after_write();
create trigger calendar_sync
  after update of scheduled_on, scheduled_end_on, name, status, archived_at, formatted_address, is_feed_visible
  on public.jobs
  for each row execute function private.calendar_sync_after_write();

-- Queue everything a connection should hold now (on connect or when a sync
-- option is switched on); the worker decides per item whether it belongs.
create function private.backfill_calendar(target_user uuid)
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
  where a.org_id = conn.org_id and a.assigned_to = target_user
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
revoke all on function private.backfill_calendar(uuid) from public, anon, authenticated;

-- Web: the signed-in person's own connection --------------------------------

create function public.get_my_calendar_connection()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object('connected', true, 'googleEmail', c.google_email, 'status', c.status,
      'syncAppointments', c.sync_appointments, 'syncJobs', c.sync_jobs, 'lastError', c.last_error,
      'pending', (select count(*) from private.calendar_sync_queue q where q.user_id = c.user_id))
    from private.calendar_connections c where c.user_id = auth.uid()),
    jsonb_build_object('connected', false))
$$;

create function public.save_my_calendar_connection(requested_refresh_token text, requested_google_email text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.web_org_id();
begin
  if auth.uid() is null or company is null or not private.is_org_member(company) then
    raise exception 'Sign in to connect a calendar.' using errcode = '42501';
  end if;
  if nullif(btrim(requested_refresh_token), '') is null then
    raise exception 'Google did not grant offline access. Try connecting again.' using errcode = '22023';
  end if;
  insert into private.calendar_connections as c (user_id, org_id, google_email, refresh_token)
  values (auth.uid(), company, nullif(btrim(requested_google_email), ''), requested_refresh_token)
  on conflict (user_id) do update set org_id = excluded.org_id, google_email = excluded.google_email,
    refresh_token = excluded.refresh_token, status = 'connected', last_error = null, updated_at = now();
  perform private.backfill_calendar(auth.uid());
end
$$;

create function public.set_my_calendar_sync(requested_appointments boolean, requested_jobs boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update private.calendar_connections set sync_appointments = coalesce(requested_appointments, sync_appointments),
    sync_jobs = coalesce(requested_jobs, sync_jobs), updated_at = now()
  where user_id = auth.uid() and status <> 'disconnecting';
  if not found then
    raise exception 'Connect Google Calendar first.' using errcode = 'P0002';
  end if;
  perform private.backfill_calendar(auth.uid());
end
$$;

-- Removes ServiceFlow's events from the calendar, then the connection.
create function public.disconnect_my_calendar()
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update private.calendar_connections set status = 'disconnecting', updated_at = now()
  where user_id = auth.uid();
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

-- Worker (service role) -------------------------------------------------------

-- Each claimed item carries the connection, the event already on the calendar
-- (if any) and the event it should now be, or null when it should be removed.
create function public.claim_calendar_sync(batch_size integer default 50)
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
            'description', null, 'projectId', j.id,
            'start', jsonb_build_object('date', j.scheduled_on),
            'end', jsonb_build_object('date', coalesce(j.scheduled_end_on, j.scheduled_on) + 1))
          from public.jobs j
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

-- Records the outcome: the event now on the calendar (or none), or an error
-- to retry with backoff. A connection being removed goes once it is empty.
create function public.complete_calendar_sync(
  requested_user uuid, requested_kind text, requested_source uuid,
  requested_event_id text, requested_calendar_id text, requested_error text default null,
  requested_connection_error boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if requested_error is not null then
    update private.calendar_sync_queue set last_error = left(requested_error, 1000),
      lease_until = now() + least(interval '1 hour', interval '2 minutes' * attempts * attempts)
    where user_id = requested_user and source_kind = requested_kind and source_id = requested_source;
    update private.calendar_connections
    set last_error = left(requested_error, 1000),
      status = case when requested_connection_error and status = 'connected' then 'error' else status end,
      updated_at = now()
    where user_id = requested_user;
    return;
  end if;
  if requested_event_id is null then
    delete from private.calendar_event_links
    where user_id = requested_user and source_kind = requested_kind and source_id = requested_source;
  else
    insert into private.calendar_event_links (user_id, source_kind, source_id, google_event_id, calendar_id)
    values (requested_user, requested_kind, requested_source, requested_event_id, requested_calendar_id)
    on conflict (user_id, source_kind, source_id) do update
      set google_event_id = excluded.google_event_id, calendar_id = excluded.calendar_id, updated_at = now();
  end if;
  delete from private.calendar_sync_queue
  where user_id = requested_user and source_kind = requested_kind and source_id = requested_source;
  update private.calendar_connections set status = 'connected', last_error = null, updated_at = now()
  where user_id = requested_user and (status = 'error' or last_error is not null);
  delete from private.calendar_connections c
  where c.user_id = requested_user and c.status = 'disconnecting'
    and not exists (select 1 from private.calendar_event_links l where l.user_id = c.user_id);
end
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'get_my_calendar_connection()',
    'save_my_calendar_connection(text, text)',
    'set_my_calendar_sync(boolean, boolean)',
    'disconnect_my_calendar()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  foreach fn in array array[
    'claim_calendar_sync(integer)',
    'complete_calendar_sync(uuid, text, uuid, text, text, text, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
