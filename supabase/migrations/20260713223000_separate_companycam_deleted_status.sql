-- CompanyCam returns deleted projects in its API feed with status = 'deleted'.
-- Keep deletion separate from the archive flag so the two lifecycle states are
-- represented accurately and can be filtered independently.

alter table public.companycam_projects
  add column if not exists companycam_status text,
  add column if not exists is_deleted boolean not null default false;

update public.companycam_projects
set
  companycam_status = nullif(lower(btrim(raw ->> 'status')), ''),
  is_deleted = coalesce(lower(btrim(raw ->> 'status')) = 'deleted', false),
  is_archived = case
    when companycam_id = 'qa-web-smoke-project' then true
    when raw ? 'archived' then lower(coalesce(raw ->> 'archived', 'false')) in ('true', 't', '1', 'yes')
    when raw ? 'is_archived' then lower(coalesce(raw ->> 'is_archived', 'false')) in ('true', 't', '1', 'yes')
    else false
  end;

create index if not exists companycam_projects_visibility_idx
  on public.companycam_projects (
    is_deleted,
    is_archived,
    is_lead,
    companycam_updated_at desc nulls last
  );

-- Existing installed clients only filter is_archived. RLS keeps deleted rows
-- out of authenticated app reads immediately, without waiting for a new build.
drop policy if exists "Authenticated users can read CompanyCam projects"
  on public.companycam_projects;

create policy "Authenticated users can read CompanyCam projects"
  on public.companycam_projects
  for select
  to authenticated
  using (not is_deleted);
