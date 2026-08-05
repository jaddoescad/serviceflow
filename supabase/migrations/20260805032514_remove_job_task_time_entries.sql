-- Task-level timers were never used in production. Keep whole-job clock-ins
-- in public.time_entries and remove the unused task timer subsystem.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'job_task_time_entries'
  ) and exists (select 1 from public.job_task_time_entries) then
    raise exception 'Refusing to drop non-empty job_task_time_entries';
  end if;
end
$$;

create or replace function public.record_time_entry_command(
  action text,
  command jsonb,
  next_command jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor public.employees%rowtype;
  target public.time_entries%rowtype;
  target_id uuid;
  requested_job_id uuid;
  requested_task_id uuid;
  requested_client_id text;
  event_name text;
  result jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;

  select * into actor
  from public.employees employee
  where employee.id = actor_id and employee.is_active;
  if not found then
    raise exception 'Active employee profile required';
  end if;

  if action in ('task_start', 'task_stop', 'task_adjust') then
    raise exception 'Task timers have been removed';

  elsif action in ('job_issue', 'task_issue') then
    requested_task_id := nullif(command ->> 'task_id', '')::uuid;
    requested_job_id := nullif(command ->> 'job_id', '')::uuid;
    if requested_job_id is null and requested_task_id is not null then
      select task.job_id into requested_job_id
      from public.job_tasks task where task.id = requested_task_id;
    end if;
    if requested_job_id is null or not exists (
      select 1 from public.jobs job where job.id = requested_job_id
    ) then
      raise exception 'A valid job_id is required';
    end if;
    insert into public.job_issues (
      id, client_id, job_id, task_id, employee_id, issue_type,
      reason, note, minutes_over, metadata, created_at
    ) values (
      extensions.gen_random_uuid(), nullif(command ->> 'client_id', ''),
      requested_job_id, requested_task_id, actor_id,
      case when action = 'task_issue' then 'task_over_budget' else 'job_over_budget' end,
      coalesce(nullif(command ->> 'reason', ''), 'other'),
      nullif(command ->> 'note', ''),
      greatest(0, coalesce(nullif(command ->> 'minutes_over', '')::integer, 0)),
      coalesce(command -> 'metadata', '{}'::jsonb), now()
    )
    on conflict (client_id) where client_id is not null do nothing
    returning id into target_id;
    return jsonb_build_object('id', target_id, 'duplicate', target_id is null);
  end if;

  if action = 'switch' then
    result := jsonb_build_object(
      'completed_entry',
      public.record_time_entry_command('clock_out', command, null),
      'active_entry',
      public.record_time_entry_command('clock_in', next_command, null)
    );
    return result;
  end if;

  requested_client_id := nullif(btrim(command ->> 'client_entry_id'), '');

  if action = 'clock_in' then
    if requested_client_id is null then
      raise exception 'client_entry_id is required';
    end if;

    select * into target
    from public.time_entries entry
    where entry.client_entry_id = requested_client_id
    for update;
    if found then
      if target.employee_id <> actor_id and not private.is_manager() then
        raise exception 'Time entry belongs to another employee';
      end if;
      return to_jsonb(target);
    end if;

    if exists (
      select 1
      from public.time_entries entry
      where entry.employee_id = actor_id
        and entry.status = 'active'
        and entry.ended_at is null
    ) then
      raise exception 'Employee already has an active time entry';
    end if;

    requested_job_id := nullif(command ->> 'job_id', '')::uuid;
    if requested_job_id is null or not exists (
      select 1 from public.jobs job where job.id = requested_job_id
    ) then
      raise exception 'A valid job_id is required';
    end if;

    target_id := coalesce(nullif(command ->> 'server_id', '')::uuid, extensions.gen_random_uuid());
    insert into public.time_entries (
      id, client_entry_id, employee_id, job_id, employee_email,
      employee_name, job_name, job_address, original_started_at,
      started_at, status, clock_in_latitude, clock_in_longitude,
      last_distance_meters, is_on_site, segments, notes, created_at, updated_at
    )
    select
      target_id,
      requested_client_id,
      actor_id,
      job.id,
      actor.email,
      coalesce(actor.full_name, actor.email, 'Painter'),
      job.name,
      coalesce(job.formatted_address, job.address_line_1),
      coalesce(
        nullif(command ->> 'original_started_at', '')::timestamptz,
        nullif(command ->> 'started_at', '')::timestamptz,
        now()
      ),
      coalesce(nullif(command ->> 'started_at', '')::timestamptz, now()),
      'active',
      nullif(command ->> 'clock_in_latitude', '')::double precision,
      nullif(command ->> 'clock_in_longitude', '')::double precision,
      nullif(command ->> 'last_distance_meters', '')::integer,
      nullif(command ->> 'is_on_site', '')::boolean,
      coalesce(command -> 'segments', '[]'::jsonb),
      nullif(command ->> 'reason', ''),
      now(),
      now()
    from public.jobs job
    where job.id = requested_job_id
    returning * into target;
    event_name := 'clock_in';

  elsif action in ('clock_out', 'adjust', 'delete', 'observation') then
    select * into target
    from public.time_entries entry
    where (
      nullif(command ->> 'server_id', '')::uuid is not null
      and entry.id = nullif(command ->> 'server_id', '')::uuid
    ) or (
      requested_client_id is not null
      and entry.client_entry_id = requested_client_id
    )
    order by entry.started_at desc
    limit 1
    for update;

    if not found then
      if action = 'delete' then return 'false'::jsonb; end if;
      raise exception 'Time entry not found';
    end if;
    if target.employee_id <> actor_id and not private.is_manager() then
      raise exception 'Time entry belongs to another employee';
    end if;

    if action = 'clock_out' then
      if target.status = 'active' then
        update public.time_entries entry
        set
          ended_at = coalesce(nullif(command ->> 'ended_at', '')::timestamptz, now()),
          status = 'completed',
          clock_out_latitude = coalesce(
            nullif(command ->> 'clock_out_latitude', '')::double precision,
            entry.clock_out_latitude
          ),
          clock_out_longitude = coalesce(
            nullif(command ->> 'clock_out_longitude', '')::double precision,
            entry.clock_out_longitude
          ),
          last_distance_meters = coalesce(
            nullif(command ->> 'last_distance_meters', '')::integer,
            entry.last_distance_meters
          ),
          is_on_site = coalesce(
            nullif(command ->> 'is_on_site', '')::boolean,
            entry.is_on_site
          ),
          segments = coalesce(command -> 'segments', entry.segments),
          notes = coalesce(nullif(command ->> 'reason', ''), entry.notes),
          updated_at = now()
        where entry.id = target.id
        returning * into target;
      end if;
      event_name := 'clock_out';

    elsif action = 'adjust' then
      if target.employee_id <> actor_id and not private.is_manager() then
        raise exception 'Only a manager can adjust another employee time entry';
      end if;
      update public.time_entries entry
      set
        original_started_at = coalesce(entry.original_started_at, entry.started_at),
        started_at = coalesce(nullif(command ->> 'started_at', '')::timestamptz, entry.started_at),
        start_edited_at = case
          when command ? 'started_at' then now()
          else entry.start_edited_at
        end,
        ended_at = case
          when command ? 'ended_at' then nullif(command ->> 'ended_at', '')::timestamptz
          else entry.ended_at
        end,
        status = case
          when command ? 'ended_at' and nullif(command ->> 'ended_at', '') is not null
            then 'completed'
          else entry.status
        end,
        adjustment_history = entry.adjustment_history || jsonb_build_array(
          jsonb_build_object(
            'adjusted_at', now(),
            'adjusted_by', actor_id,
            'source', coalesce(command ->> 'adjustment_source', 'app'),
            'previous_started_at', entry.started_at,
            'previous_ended_at', entry.ended_at
          )
        ),
        notes = coalesce(nullif(command ->> 'reason', ''), entry.notes),
        updated_at = now()
      where entry.id = target.id
      returning * into target;
      event_name := 'adjust';

    elsif action = 'delete' then
      update public.time_entries entry
      set status = 'deleted',
          ended_at = coalesce(entry.ended_at, now()),
          updated_at = now()
      where entry.id = target.id
      returning * into target;
      event_name := 'delete';

    else
      update public.time_entries entry
      set
        clock_out_latitude = coalesce(
          nullif(command ->> 'clock_out_latitude', '')::double precision,
          entry.clock_out_latitude
        ),
        clock_out_longitude = coalesce(
          nullif(command ->> 'clock_out_longitude', '')::double precision,
          entry.clock_out_longitude
        ),
        last_distance_meters = coalesce(
          nullif(command ->> 'last_distance_meters', '')::integer,
          entry.last_distance_meters
        ),
        is_on_site = coalesce(
          nullif(command ->> 'is_on_site', '')::boolean,
          entry.is_on_site
        ),
        segments = coalesce(command -> 'segments', entry.segments),
        updated_at = now()
      where entry.id = target.id
      returning * into target;
      return to_jsonb(target);
    end if;
  else
    raise exception 'Unsupported time-entry action: %', action;
  end if;

  insert into public.time_entry_events (
    id, time_entry_id, client_entry_id, employee_id, event_type,
    captured_at, received_at, source, metadata
  ) values (
    extensions.gen_random_uuid(),
    target.id,
    target.client_entry_id,
    target.employee_id,
    event_name,
    coalesce(nullif(command ->> 'captured_at', '')::timestamptz, now()),
    now(),
    coalesce(nullif(command ->> 'source', ''), 'app'),
    jsonb_build_object('command', command - 'segments')
  );

  if action = 'delete' then return 'true'::jsonb; end if;
  return to_jsonb(target);
end
$$;

revoke all on function public.record_time_entry_command(text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_time_entry_command(text, jsonb, jsonb)
  to authenticated, service_role;

drop table if exists public.job_task_time_entries;

