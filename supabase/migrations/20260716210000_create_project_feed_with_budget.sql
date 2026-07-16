-- Return the Projects screen rows and their painter-safe labour summary in one
-- backend call. This prevents the UI from rendering projects first and then
-- filling/removing budget data as a separate request mounts and unmounts.

create or replace function public.list_project_feed(
  requested_page integer default 0,
  requested_page_size integer default 20,
  requested_search text default '',
  requested_project_ids text[] default null
)
returns table (
  companycam_id text,
  name text,
  formatted_address text,
  city text,
  state text,
  postal_code text,
  is_archived boolean,
  is_deleted boolean,
  companycam_status text,
  is_lead boolean,
  last_synced_at timestamptz,
  companycam_updated_at timestamptz,
  budget_percent_used numeric,
  budget_hours_used numeric,
  budget_status text,
  budget_is_complete boolean,
  budget_calculated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  search_term text := btrim(coalesce(requested_search, ''));
  page_offset bigint;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.employee_profiles profile
    where profile.user_id = auth.uid()
      and profile.is_active = true
  ) then
    raise exception 'Only active employees can view the project feed'
      using errcode = '42501';
  end if;

  if requested_page is null or requested_page < 0 then
    raise exception 'Project page must be zero or greater'
      using errcode = '22023';
  end if;

  if requested_page_size is null or requested_page_size < 1 or requested_page_size > 100 then
    raise exception 'Project page size must be between 1 and 100'
      using errcode = '22023';
  end if;

  if coalesce(array_length(requested_project_ids, 1), 0) > 1000 then
    raise exception 'Project feed filtering is limited to 1000 project IDs'
      using errcode = '22023';
  end if;

  page_offset := requested_page::bigint * requested_page_size::bigint;

  return query
  with matching_projects as (
    select project.*
    from public.companycam_projects project
    where project.is_deleted = false
      and project.companycam_id <> 'qa-web-smoke-project'
      and (
        search_term <> ''
        or (project.is_archived = false and project.is_lead = false)
      )
      and (
        search_term <> ''
        or requested_project_ids is null
        or project.companycam_id = any(requested_project_ids)
      )
      and (
        search_term = ''
        or position(
          lower(search_term) in lower(concat_ws(
            ' ',
            project.name,
            project.formatted_address,
            project.city,
            project.state,
            project.postal_code
          ))
        ) > 0
      )
  ),
  page_projects as (
    select
      project.*,
      count(*) over () as matched_count
    from matching_projects project
    order by project.companycam_updated_at desc nulls last, project.name, project.companycam_id
    offset page_offset
    limit requested_page_size
  ),
  budget_progress as (
    select progress.*
    from public.get_project_budget_progress(
      coalesce(
        (select array_agg(project.companycam_id) from page_projects project),
        array[]::text[]
      )
    ) progress
  )
  select
    project.companycam_id,
    project.name,
    project.formatted_address,
    project.city,
    project.state,
    project.postal_code,
    project.is_archived,
    project.is_deleted,
    project.companycam_status,
    project.is_lead,
    project.last_synced_at,
    project.companycam_updated_at,
    progress.percent_used,
    progress.hours_used,
    progress.budget_status,
    progress.is_complete,
    progress.calculated_at,
    project.matched_count
  from page_projects project
  left join budget_progress progress
    on progress.companycam_project_id = project.companycam_id
  order by project.companycam_updated_at desc nulls last, project.name, project.companycam_id;
end;
$$;

comment on function public.list_project_feed(integer, integer, text, text[]) is
  'Returns a paginated project feed with only painter-safe labour percentage, status, and actual team hours. Never returns job amounts, pay rates, or labour costs.';

revoke all on function public.list_project_feed(integer, integer, text, text[])
  from public, anon;
grant execute on function public.list_project_feed(integer, integer, text, text[])
  to authenticated;
