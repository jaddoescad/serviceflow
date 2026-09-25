-- Phase 1, step 2 of multi-company ServiceFlow. Every company-owned table gets
-- org_id. All existing rows belong to Ottawa Painters.
--
-- ADD COLUMN with a non-volatile default stores the value in the catalog
-- instead of rewriting rows, so no UPDATE triggers fire: the Ottawa Painters
-- sync outbox, updated_at stamps and the historical-accounting guards are
-- untouched. The sync only forwards its allow-listed columns, so org_id never
-- reaches the Ottawa Painters project.
--
-- The default keeps current clients working: rows they insert without org_id
-- land in Ottawa Painters. It is removed once the apps send org_id themselves.
--
-- Not company-owned, so deliberately left alone: employees (the person; roles
-- live in org_members), push_tokens (a device), app_config (platform flags;
-- its labour/calculator settings move to per-company settings later).

create function private.legacy_default_org_id()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select id from public.organizations where slug = 'ottawa-painters'
$$;

revoke all on function private.legacy_default_org_id() from public, anon;
grant execute on function private.legacy_default_org_id() to authenticated, service_role;

do $$
declare
  target regclass;
begin
  foreach target in array array[
    'public.contacts',
    'public.leads',
    'public.quotes',
    'public.jobs',
    'public.job_budgets',
    'public.job_assignments',
    'public.job_tasks',
    'public.job_issues',
    'public.job_media',
    'public.time_entries',
    'public.time_entry_events',
    'public.employee_pay_rates',
    'public.employee_location_points',
    'public.employee_tracking_status',
    'public.location_alerts',
    'public.project_workspace',
    'public.project_labels',
    'public.project_label_links',
    'public.media_creator_links',
    'private.integration_events',
    'private.photo_annotation_history'
  ]::regclass[] loop
    execute format(
      'alter table %s add column org_id uuid not null
         default private.legacy_default_org_id()
         references public.organizations (id)',
      target
    );
    execute format(
      'create index %I on %s (org_id)',
      replace(target::text, '.', '_') || '_org_id_idx',
      target
    );
  end loop;
end
$$;
