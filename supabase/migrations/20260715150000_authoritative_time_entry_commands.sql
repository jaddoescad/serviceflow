-- Time-entry lifecycle authority lives in Postgres. Mobile clients submit
-- narrow, idempotent commands and no longer insert/update/delete rows directly.
-- GPS/geofence callbacks have a separate observation command that
-- cannot change started_at, ended_at, or status.

create table if not exists public.time_entry_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid references public.time_entries(id) on delete set null,
  client_entry_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('clock_in', 'clock_out')),
  captured_at timestamptz not null,
  received_at timestamptz not null default timezone('utc', now()),
  source text not null default 'mobile_command',
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  unique (time_entry_id, event_type)
);

create index if not exists time_entry_lifecycle_events_user_captured_idx
  on public.time_entry_lifecycle_events (user_id, captured_at desc);

create index if not exists time_entry_lifecycle_events_client_idx
  on public.time_entry_lifecycle_events (client_entry_id, captured_at);

alter table public.time_entry_lifecycle_events enable row level security;

drop policy if exists "Users and managers can read time entry lifecycle events"
  on public.time_entry_lifecycle_events;
create policy "Users and managers can read time entry lifecycle events"
on public.time_entry_lifecycle_events
for select
to authenticated
using (
  user_id = auth.uid()
  or public.current_employee_role() in ('admin', 'manager')
);

revoke insert, update, delete on public.time_entry_lifecycle_events
  from anon, authenticated;

-- New rows must have a coherent lifecycle. Existing rows are intentionally not
-- scanned during this migration; the constraint can be validated after any
-- historical anomalies have been reviewed and repaired.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.time_entries'::regclass
      and conname = 'time_entries_status_end_consistent'
  ) then
    alter table public.time_entries
      add constraint time_entries_status_end_consistent
      check (
        (status = 'active' and ended_at is null)
        or (status = 'complete' and ended_at is not null)
      ) not valid;
  end if;
end;
$$;

-- Fail safely rather than arbitrarily closing a historical duplicate. This
-- preflight produces a clear deployment error if cleanup is required.
do $$
begin
  if exists (
    select 1
    from public.time_entries
    where status = 'active' and ended_at is null
    group by user_id
    having count(*) > 1
  ) then
    raise exception
      'Cannot enforce one active time entry per user: duplicate active rows exist';
  end if;
end;
$$;

create unique index if not exists time_entries_one_active_per_user_idx
  on public.time_entries (user_id)
  where status = 'active' and ended_at is null;

create or replace function public._require_time_entry_actor()
returns public.employee_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor public.employee_profiles;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Locking the profile serializes lifecycle commands for this employee.
  select profile.*
  into actor
  from public.employee_profiles profile
  where profile.user_id = auth.uid()
    and profile.is_active = true
  for update;

  if not found then
    raise exception 'An active employee profile is required'
      using errcode = '42501';
  end if;

  return actor;
end;
$$;

revoke all on function public._require_time_entry_actor() from public;

create or replace function public._record_time_entry_lifecycle_event(
  entry_row public.time_entries,
  event_name text,
  captured_at_value timestamptz,
  metadata_value jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.time_entry_lifecycle_events (
    time_entry_id,
    client_entry_id,
    user_id,
    event_type,
    captured_at,
    metadata
  ) values (
    entry_row.id,
    entry_row.client_entry_id,
    entry_row.user_id,
    event_name,
    captured_at_value,
    coalesce(metadata_value, '{}'::jsonb)
  )
  on conflict (time_entry_id, event_type) do nothing;
end;
$$;

revoke all on function public._record_time_entry_lifecycle_event(
  public.time_entries,
  text,
  timestamptz,
  jsonb
) from public;

create or replace function public.clock_in_time_entry(command jsonb)
returns public.time_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor public.employee_profiles;
  existing_entry public.time_entries;
  active_entry public.time_entries;
  created_entry public.time_entries;
  client_id text;
  project_id text;
  project_name_value text;
  started_at_value timestamptz;
  segments_value jsonb;
begin
  if command is null or jsonb_typeof(command) <> 'object' then
    raise exception 'clock_in command must be a JSON object'
      using errcode = '22023';
  end if;

  select * into actor from public._require_time_entry_actor();

  client_id := nullif(btrim(command ->> 'client_entry_id'), '');
  project_id := nullif(btrim(command ->> 'companycam_project_id'), '');
  project_name_value := nullif(btrim(command ->> 'project_name'), '');
  started_at_value := nullif(command ->> 'started_at', '')::timestamptz;
  segments_value := coalesce(command -> 'segments', '[]'::jsonb);

  if client_id is null or started_at_value is null or project_name_value is null then
    raise exception 'clock_in requires client_entry_id, started_at, and project_name'
      using errcode = '22023';
  end if;
  if jsonb_typeof(segments_value) <> 'array' then
    raise exception 'segments must be a JSON array' using errcode = '22023';
  end if;

  select entry.*
  into existing_entry
  from public.time_entries entry
  where entry.client_entry_id = client_id
  for update;

  if found then
    if existing_entry.user_id is distinct from actor.user_id then
      raise exception 'The session identifier belongs to another user'
        using errcode = '42501';
    end if;
    -- Idempotency: a completed session is returned, never reopened.
    return existing_entry;
  end if;

  select entry.*
  into active_entry
  from public.time_entries entry
  where entry.user_id = actor.user_id
    and entry.status = 'active'
    and entry.ended_at is null
  for update;

  if found then
    raise exception 'The employee already has an active time entry'
      using errcode = '23505',
        detail = active_entry.client_entry_id;
  end if;

  insert into public.time_entries (
    client_entry_id,
    user_id,
    user_email,
    user_name,
    companycam_project_id,
    project_name,
    project_address,
    original_started_at,
    started_at,
    ended_at,
    status,
    clock_in_latitude,
    clock_in_longitude,
    clock_out_latitude,
    clock_out_longitude,
    last_distance_meters,
    is_on_site,
    segments
  ) values (
    client_id,
    actor.user_id,
    coalesce(nullif(actor.email, ''), nullif(auth.jwt() ->> 'email', '')),
    coalesce(
      nullif(actor.full_name, ''),
      nullif(command ->> 'user_name', ''),
      nullif(split_part(coalesce(actor.email, auth.jwt() ->> 'email', ''), '@', 1), ''),
      'Painter'
    ),
    project_id,
    project_name_value,
    nullif(command ->> 'project_address', ''),
    started_at_value,
    started_at_value,
    null,
    'active',
    nullif(command ->> 'clock_in_latitude', '')::double precision,
    nullif(command ->> 'clock_in_longitude', '')::double precision,
    nullif(command ->> 'clock_out_latitude', '')::double precision,
    nullif(command ->> 'clock_out_longitude', '')::double precision,
    nullif(command ->> 'last_distance_meters', '')::integer,
    nullif(command ->> 'is_on_site', '')::boolean,
    segments_value
  )
  returning * into created_entry;

  perform public._record_time_entry_lifecycle_event(
    created_entry,
    'clock_in',
    started_at_value,
    jsonb_build_object(
      'companycam_project_id', project_id,
      'source', coalesce(nullif(command ->> 'source', ''), 'mobile')
    )
  );

  return created_entry;
end;
$$;

create or replace function public.clock_out_time_entry(command jsonb)
returns public.time_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor public.employee_profiles;
  entry_row public.time_entries;
  completed_entry public.time_entries;
  client_id text;
  server_id text;
  project_id text;
  project_name_value text;
  started_at_value timestamptz;
  ended_at_value timestamptz;
  segments_value jsonb;
begin
  if command is null or jsonb_typeof(command) <> 'object' then
    raise exception 'clock_out command must be a JSON object'
      using errcode = '22023';
  end if;

  select * into actor from public._require_time_entry_actor();

  client_id := nullif(btrim(command ->> 'client_entry_id'), '');
  server_id := nullif(btrim(command ->> 'server_id'), '');
  ended_at_value := nullif(command ->> 'ended_at', '')::timestamptz;

  if ended_at_value is null or (client_id is null and server_id is null) then
    raise exception 'clock_out requires a session identifier and ended_at'
      using errcode = '22023';
  end if;

  select entry.*
  into entry_row
  from public.time_entries entry
  where entry.user_id = actor.user_id
    and (
      (server_id is not null and entry.id::text = server_id)
      or (client_id is not null and entry.client_entry_id = client_id)
    )
  order by (entry.id::text = server_id) desc
  limit 1
  for update;

  if found then
    -- First clock-out wins permanently. Retried or delayed commands read the
    -- canonical row without changing its end time.
    if entry_row.status = 'complete' and entry_row.ended_at is not null then
      return entry_row;
    end if;
    if ended_at_value < entry_row.started_at then
      raise exception 'Clock-out must not be before clock-in'
        using errcode = '22023';
    end if;

    segments_value := coalesce(command -> 'segments', entry_row.segments, '[]'::jsonb);
    if jsonb_typeof(segments_value) <> 'array' then
      raise exception 'segments must be a JSON array' using errcode = '22023';
    end if;

    update public.time_entries
    set ended_at = ended_at_value,
        status = 'complete',
        clock_out_latitude = nullif(command ->> 'clock_out_latitude', '')::double precision,
        clock_out_longitude = nullif(command ->> 'clock_out_longitude', '')::double precision,
        last_distance_meters = nullif(command ->> 'last_distance_meters', '')::integer,
        is_on_site = nullif(command ->> 'is_on_site', '')::boolean,
        segments = segments_value
    where id = entry_row.id
      and status = 'active'
      and ended_at is null
    returning * into completed_entry;

    if completed_entry.id is null then
      select entry.* into completed_entry
      from public.time_entries entry
      where entry.id = entry_row.id;
      return completed_entry;
    end if;

    perform public._record_time_entry_lifecycle_event(
      completed_entry,
      'clock_out',
      ended_at_value,
      jsonb_build_object(
        'reason', coalesce(nullif(command ->> 'reason', ''), 'manual'),
        'source', coalesce(nullif(command ->> 'source', ''), 'mobile')
      )
    );
    return completed_entry;
  end if;

  -- Offline clock-in and clock-out may collapse to one queued terminal command.
  -- In that case create the already-completed row from the self-contained
  -- command instead of requiring the earlier clock-in to arrive first.
  project_id := nullif(btrim(command ->> 'companycam_project_id'), '');
  project_name_value := nullif(btrim(command ->> 'project_name'), '');
  started_at_value := nullif(command ->> 'started_at', '')::timestamptz;
  segments_value := coalesce(command -> 'segments', '[]'::jsonb);

  if client_id is null or started_at_value is null or project_name_value is null then
    raise exception 'An unsynced clock-out requires the complete clock-in details'
      using errcode = '22023';
  end if;
  if ended_at_value < started_at_value then
    raise exception 'Clock-out must not be before clock-in'
      using errcode = '22023';
  end if;
  if jsonb_typeof(segments_value) <> 'array' then
    raise exception 'segments must be a JSON array' using errcode = '22023';
  end if;

  insert into public.time_entries (
    client_entry_id,
    user_id,
    user_email,
    user_name,
    companycam_project_id,
    project_name,
    project_address,
    original_started_at,
    started_at,
    ended_at,
    status,
    clock_in_latitude,
    clock_in_longitude,
    clock_out_latitude,
    clock_out_longitude,
    last_distance_meters,
    is_on_site,
    segments
  ) values (
    client_id,
    actor.user_id,
    coalesce(nullif(actor.email, ''), nullif(auth.jwt() ->> 'email', '')),
    coalesce(
      nullif(actor.full_name, ''),
      nullif(command ->> 'user_name', ''),
      nullif(split_part(coalesce(actor.email, auth.jwt() ->> 'email', ''), '@', 1), ''),
      'Painter'
    ),
    project_id,
    project_name_value,
    nullif(command ->> 'project_address', ''),
    started_at_value,
    started_at_value,
    ended_at_value,
    'complete',
    nullif(command ->> 'clock_in_latitude', '')::double precision,
    nullif(command ->> 'clock_in_longitude', '')::double precision,
    nullif(command ->> 'clock_out_latitude', '')::double precision,
    nullif(command ->> 'clock_out_longitude', '')::double precision,
    nullif(command ->> 'last_distance_meters', '')::integer,
    nullif(command ->> 'is_on_site', '')::boolean,
    segments_value
  )
  returning * into completed_entry;

  perform public._record_time_entry_lifecycle_event(
    completed_entry,
    'clock_in',
    started_at_value,
    jsonb_build_object(
      'companycam_project_id', project_id,
      'source', coalesce(nullif(command ->> 'source', ''), 'mobile_offline')
    )
  );
  perform public._record_time_entry_lifecycle_event(
    completed_entry,
    'clock_out',
    ended_at_value,
    jsonb_build_object(
      'reason', coalesce(nullif(command ->> 'reason', ''), 'manual'),
      'source', coalesce(nullif(command ->> 'source', ''), 'mobile_offline')
    )
  );

  return completed_entry;
end;
$$;

create or replace function public.switch_time_entry(
  clock_out_command jsonb,
  clock_in_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  completed_entry public.time_entries;
  active_entry public.time_entries;
begin
  -- Both calls participate in this function's transaction. If the new shift
  -- cannot be created, the old shift is not partially completed on the server.
  completed_entry := public.clock_out_time_entry(clock_out_command);
  active_entry := public.clock_in_time_entry(clock_in_command);

  return jsonb_build_object(
    'completed_entry', to_jsonb(completed_entry),
    'active_entry', to_jsonb(active_entry)
  );
end;
$$;

create or replace function public.record_time_entry_observation(command jsonb)
returns public.time_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor public.employee_profiles;
  entry_row public.time_entries;
  updated_entry public.time_entries;
  client_id text;
  server_id text;
  segments_value jsonb;
begin
  if command is null or jsonb_typeof(command) <> 'object' then
    raise exception 'observation command must be a JSON object'
      using errcode = '22023';
  end if;

  select * into actor from public._require_time_entry_actor();
  client_id := nullif(btrim(command ->> 'client_entry_id'), '');
  server_id := nullif(btrim(command ->> 'server_id'), '');

  select entry.*
  into entry_row
  from public.time_entries entry
  where entry.user_id = actor.user_id
    and (
      (server_id is not null and entry.id::text = server_id)
      or (client_id is not null and entry.client_entry_id = client_id)
    )
  order by (entry.id::text = server_id) desc
  limit 1
  for update;

  if not found or entry_row.status <> 'active' or entry_row.ended_at is not null then
    return entry_row;
  end if;

  segments_value := coalesce(command -> 'segments', entry_row.segments, '[]'::jsonb);
  if jsonb_typeof(segments_value) <> 'array' then
    raise exception 'segments must be a JSON array' using errcode = '22023';
  end if;

  -- Deliberately limited to observation columns. No lifecycle field appears in
  -- this update, so GPS cannot clock anyone in, out, or back in.
  update public.time_entries
  set clock_out_latitude = nullif(command ->> 'clock_out_latitude', '')::double precision,
      clock_out_longitude = nullif(command ->> 'clock_out_longitude', '')::double precision,
      last_distance_meters = nullif(command ->> 'last_distance_meters', '')::integer,
      is_on_site = nullif(command ->> 'is_on_site', '')::boolean,
      segments = segments_value
  where id = entry_row.id
    and status = 'active'
    and ended_at is null
  returning * into updated_entry;

  if updated_entry.id is null then
    return entry_row;
  end if;
  return updated_entry;
end;
$$;

create or replace function public.adjust_time_entry(command jsonb)
returns public.time_entries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor public.employee_profiles;
  entry_row public.time_entries;
  adjusted_entry public.time_entries;
  client_id text;
  server_id text;
  started_at_value timestamptz;
  ended_at_value timestamptz;
  project_id_value text;
  project_name_value text;
  project_address_value text;
  original_started_at_value timestamptz;
  seed_command jsonb;
  changes jsonb := '{}'::jsonb;
  history jsonb;
begin
  if command is null or jsonb_typeof(command) <> 'object' then
    raise exception 'adjust command must be a JSON object'
      using errcode = '22023';
  end if;

  select * into actor from public._require_time_entry_actor();
  client_id := nullif(btrim(command ->> 'client_entry_id'), '');
  server_id := nullif(btrim(command ->> 'server_id'), '');

  select entry.*
  into entry_row
  from public.time_entries entry
  where (server_id is not null and entry.id::text = server_id)
     or (client_id is not null and entry.client_entry_id = client_id)
  order by (entry.id::text = server_id) desc
  limit 1
  for update;

  if not found then
    -- An offline lifecycle command may have been compacted into this later
    -- adjustment. Seed the missing row through the same authoritative command
    -- functions, then apply the audited correction below.
    original_started_at_value := nullif(command ->> 'original_started_at', '')::timestamptz;
    seed_command := command;
    if original_started_at_value is not null then
      seed_command := jsonb_set(
        seed_command,
        '{started_at}',
        to_jsonb(original_started_at_value),
        true
      );
    end if;

    if nullif(command ->> 'ended_at', '') is null then
      select * into entry_row from public.clock_in_time_entry(seed_command);
    else
      select * into entry_row from public.clock_out_time_entry(seed_command);
    end if;
  end if;
  if entry_row.user_id <> actor.user_id and actor.role not in ('admin', 'manager') then
    raise exception 'Not allowed to adjust this time entry'
      using errcode = '42501';
  end if;

  started_at_value := case
    when command ? 'started_at'
      then nullif(command ->> 'started_at', '')::timestamptz
    else entry_row.started_at
  end;
  ended_at_value := case
    when command ? 'ended_at'
      then nullif(command ->> 'ended_at', '')::timestamptz
    else entry_row.ended_at
  end;
  project_id_value := case
    when command ? 'companycam_project_id'
      then nullif(btrim(command ->> 'companycam_project_id'), '')
    else entry_row.companycam_project_id
  end;
  project_name_value := case
    when command ? 'project_name'
      then nullif(btrim(command ->> 'project_name'), '')
    else entry_row.project_name
  end;
  project_address_value := case
    when command ? 'project_address'
      then nullif(command ->> 'project_address', '')
    else entry_row.project_address
  end;

  if started_at_value is null or project_name_value is null then
    raise exception 'started_at and project_name are required'
      using errcode = '22023';
  end if;
  if ended_at_value is not null and ended_at_value < started_at_value then
    raise exception 'Clock-out must not be before clock-in'
      using errcode = '22023';
  end if;
  if entry_row.status = 'complete' and ended_at_value is null then
    raise exception 'A completed entry cannot be reopened by an adjustment'
      using errcode = '22023';
  end if;

  if started_at_value is distinct from entry_row.started_at then
    changes := changes || jsonb_build_object(
      'started_at', jsonb_build_object('from', entry_row.started_at, 'to', started_at_value)
    );
  end if;
  if ended_at_value is distinct from entry_row.ended_at then
    changes := changes || jsonb_build_object(
      'ended_at', jsonb_build_object('from', entry_row.ended_at, 'to', ended_at_value)
    );
  end if;
  if project_id_value is distinct from entry_row.companycam_project_id then
    changes := changes || jsonb_build_object(
      'companycam_project_id',
      jsonb_build_object('from', entry_row.companycam_project_id, 'to', project_id_value)
    );
  end if;

  if changes = '{}'::jsonb
    and project_name_value is not distinct from entry_row.project_name
    and project_address_value is not distinct from entry_row.project_address then
    return entry_row;
  end if;

  history := case
    when jsonb_typeof(entry_row.adjustment_history) = 'array'
      then entry_row.adjustment_history
    else '[]'::jsonb
  end;
  history := history || jsonb_build_array(jsonb_build_object(
    'at', timezone('utc', now()),
    'by', actor.user_id,
    'by_role', actor.role,
    'source', coalesce(nullif(command ->> 'adjustment_source', ''), 'mobile_time_edit'),
    'changes', changes
  ));

  update public.time_entries
  set original_started_at = coalesce(entry_row.original_started_at, entry_row.started_at),
      started_at = started_at_value,
      start_edited_at = case
        when started_at_value is distinct from entry_row.started_at
          then timezone('utc', now())
        else entry_row.start_edited_at
      end,
      ended_at = ended_at_value,
      status = case when ended_at_value is null then 'active' else 'complete' end,
      companycam_project_id = project_id_value,
      project_name = project_name_value,
      project_address = project_address_value,
      adjustment_history = history,
      approved_at = null,
      approved_by = null
  where id = entry_row.id
  returning * into adjusted_entry;

  return adjusted_entry;
end;
$$;

create or replace function public.delete_time_entry(command jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor public.employee_profiles;
  entry_row public.time_entries;
  client_id text;
  server_id text;
begin
  if command is null or jsonb_typeof(command) <> 'object' then
    raise exception 'delete command must be a JSON object'
      using errcode = '22023';
  end if;

  select * into actor from public._require_time_entry_actor();
  client_id := nullif(btrim(command ->> 'client_entry_id'), '');
  server_id := nullif(btrim(command ->> 'server_id'), '');

  select entry.*
  into entry_row
  from public.time_entries entry
  where (server_id is not null and entry.id::text = server_id)
     or (client_id is not null and entry.client_entry_id = client_id)
  order by (entry.id::text = server_id) desc
  limit 1
  for update;

  if not found then
    return true;
  end if;
  if entry_row.user_id <> actor.user_id and actor.role <> 'admin' then
    raise exception 'Only an admin may delete another employee''s time entry'
      using errcode = '42501';
  end if;

  delete from public.time_entries where id = entry_row.id;
  return true;
end;
$$;

-- Compatibility window: existing mobile releases still use the legacy
-- owner-scoped time_entries policies. Keep those policies until the command-
-- based app release has been adopted, then revoke the direct write surface in
-- a separate cutover migration. The preceding lifecycle trigger already stops
-- old clients from reopening or extending a completed entry during this window.

revoke all on function public.clock_in_time_entry(jsonb) from public;
revoke all on function public.clock_out_time_entry(jsonb) from public;
revoke all on function public.switch_time_entry(jsonb, jsonb) from public;
revoke all on function public.record_time_entry_observation(jsonb) from public;
revoke all on function public.adjust_time_entry(jsonb) from public;
revoke all on function public.delete_time_entry(jsonb) from public;

grant execute on function public.clock_in_time_entry(jsonb) to authenticated;
grant execute on function public.clock_out_time_entry(jsonb) to authenticated;
grant execute on function public.switch_time_entry(jsonb, jsonb) to authenticated;
grant execute on function public.record_time_entry_observation(jsonb) to authenticated;
grant execute on function public.adjust_time_entry(jsonb) to authenticated;
grant execute on function public.delete_time_entry(jsonb) to authenticated;

comment on function public.clock_in_time_entry(jsonb) is
  'Idempotently creates one authenticated employee shift; never reopens a completed session.';
comment on function public.clock_out_time_entry(jsonb) is
  'First-write-wins terminal clock-out command. Can create a complete offline session if clock-in was not synced.';
comment on function public.switch_time_entry(jsonb, jsonb) is
  'Atomically completes one session and starts the next session.';
comment on function public.record_time_entry_observation(jsonb) is
  'Updates location evidence for an active session without lifecycle write authority.';
