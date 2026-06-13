alter table public.companycam_projects
  add column if not exists geocoded_at timestamptz,
  add column if not exists geocode_source text,
  add column if not exists geocode_query text,
  add column if not exists geocode_error text;

create index if not exists companycam_projects_missing_geocode_idx
on public.companycam_projects (is_archived, is_lead, companycam_updated_at desc nulls last)
where latitude is null or longitude is null;
