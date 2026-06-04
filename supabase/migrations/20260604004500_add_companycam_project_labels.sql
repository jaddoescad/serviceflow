alter table public.companycam_projects
  add column if not exists labels jsonb not null default '[]'::jsonb,
  add column if not exists is_lead boolean not null default false;

update public.companycam_projects
set labels = case
  when jsonb_typeof(raw->'labels') = 'array' then raw->'labels'
  when jsonb_typeof(raw->'project_labels') = 'array' then raw->'project_labels'
  else '[]'::jsonb
end
where raw is not null;

update public.companycam_projects
set is_lead = exists (
  select 1
  from jsonb_array_elements(labels) as label
  where lower(trim(coalesce(
    label->>'value',
    label->>'display_value',
    label->>'name',
    label->>'title',
    label#>>'{}'
  ))) in ('lead', 'leads')
);

create index if not exists companycam_projects_job_feed_idx
  on public.companycam_projects (is_lead, is_archived, companycam_updated_at desc);
