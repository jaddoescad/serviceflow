update public.companycam_projects
set
  is_archived = true,
  updated_at = timezone('utc', now())
where companycam_id = 'qa-web-smoke-project';

delete from public.project_assignments
where companycam_project_id = 'qa-web-smoke-project';
