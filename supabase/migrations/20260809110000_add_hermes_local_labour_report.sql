-- Give Hermes one bounded report for crew activity. Raw time_entries values are
-- timestamptz (rendered as UTC by database clients), so the report also emits
-- explicit America/Toronto display values and prevents unsupported "manual"
-- entry claims.

create or replace function public.hermes_labour(
  p_date text default 'yesterday',
  p_limit integer default 100
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $function$
  with requested as (
    select lower(btrim(coalesce(nullif(p_date, ''), 'yesterday'))) as date_spec,
           least(greatest(coalesce(p_limit, 100), 1), 200) as row_limit,
           (now() at time zone 'America/Toronto')::date as today_local
  ),
  params as (
    select case date_spec
             when 'today' then today_local
             when 'yesterday' then today_local - 1
             else date_spec::date
           end as work_date,
           row_limit
    from requested
  ),
  all_entries as (
    select te.*,
           round(extract(epoch from (te.ended_at - te.started_at)) / 60.0)::integer as duration_minutes,
           te.start_edited_at is not null
             or jsonb_array_length(coalesce(te.adjustment_history, '[]'::jsonb)) > 0 as was_edited,
           case
             when te.ended_at is null then 'open'
             when te.approved_at is not null then 'approved'
             else 'pending'
           end as approval_status
    from public.time_entries te
    cross join params p
    where te.started_at >= p.work_date::timestamp at time zone 'America/Toronto'
      and te.started_at < (p.work_date + 1)::timestamp at time zone 'America/Toronto'
  ),
  selected_entries as (
    select *
    from all_entries
    order by started_at asc, employee_name asc
    limit (select row_limit from params)
  ),
  report_rows as (
    select jsonb_build_object(
      'id', entry.id,
      'employee_name', entry.employee_name,
      'job_id', entry.job_id,
      'job_name', entry.job_name,
      'work_date_local', (entry.started_at at time zone 'America/Toronto')::date,
      'clock_in_local', to_char(entry.started_at at time zone 'America/Toronto', 'HH12:MI AM'),
      'clock_out_local', case when entry.ended_at is null then null else to_char(entry.ended_at at time zone 'America/Toronto', 'HH12:MI AM') end,
      'started_at_utc', entry.started_at,
      'ended_at_utc', entry.ended_at,
      'duration_minutes', entry.duration_minutes,
      'duration_display', case
        when entry.duration_minutes is null then null
        else (entry.duration_minutes / 60)::text || 'h ' || lpad((entry.duration_minutes % 60)::text, 2, '0') || 'm'
      end,
      'entry_status', entry.status,
      'approval_status', entry.approval_status,
      'was_edited', entry.was_edited,
      'is_on_site', entry.is_on_site
    ) as item,
    entry.started_at
    from selected_entries entry
  ),
  job_rows as (
    select jsonb_build_object(
      'job_id', entry.job_id,
      'job_name', entry.job_name,
      'entry_count', count(*),
      'workers', to_jsonb(array_agg(distinct entry.employee_name order by entry.employee_name)),
      'total_minutes', coalesce(sum(entry.duration_minutes), 0),
      'first_clock_in_local', to_char(min(entry.started_at) at time zone 'America/Toronto', 'HH12:MI AM'),
      'last_clock_out_local', case when count(*) filter (where entry.ended_at is null) > 0 then null else to_char(max(entry.ended_at) at time zone 'America/Toronto', 'HH12:MI AM') end
    ) as item,
    min(entry.started_at) as first_started_at
    from all_entries entry
    group by entry.job_id, entry.job_name
  )
  select jsonb_build_object(
    'schema_version', 1,
    'command', 'labour',
    'as_of', now(),
    'timezone', 'America/Toronto',
    'filters', jsonb_build_object(
      'date', (select work_date from params),
      'limit', (select row_limit from params)
    ),
    'summary', jsonb_build_object(
      'entry_count', (select count(*) from all_entries),
      'job_count', (select count(distinct job_id) from all_entries),
      'worker_count', (select count(distinct employee_name) from all_entries),
      'total_minutes', coalesce((select sum(duration_minutes) from all_entries), 0),
      'pending_approval_count', (select count(*) from all_entries where approval_status = 'pending'),
      'edited_entry_count', (select count(*) from all_entries where was_edited)
    ),
    'jobs', coalesce((select jsonb_agg(item order by first_started_at) from job_rows), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(item order by started_at) from report_rows), '[]'::jsonb),
    'warnings', jsonb_build_array(
      'clock_in_local, clock_out_local, work_date_local, and job summary times are already formatted in America/Toronto. Repeat them exactly; do not reinterpret UTC fields as local time.',
      'The source table has no entry-method field. Never describe an entry as manual. was_edited is true only when explicit edit evidence exists.',
      'approval_status is derived from approved_at and whether the shift has ended. Pending approval does not imply manual entry.'
    ),
    'provenance', jsonb_build_array('public.time_entries')
  );
$function$;

revoke all on function public.hermes_labour(text, integer) from public, anon;

grant execute on function public.hermes_labour(text, integer)
to authenticated, service_role, supabase_read_only_user;
