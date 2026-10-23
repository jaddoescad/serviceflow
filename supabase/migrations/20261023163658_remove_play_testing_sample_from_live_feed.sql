-- Retire the explicitly identified Google Play fixture without deleting its
-- photos, shifts, or tester accounts. No real job or time entry is modified.
do $$
declare
  sample_id constant uuid := '6f5afe33-fdac-4d06-aaf0-13d345099f01';
  sample_org constant uuid := 'bdb14cca-3181-4a76-813a-0c879489da1c';
begin
  if not exists (select 1 from public.jobs where id = sample_id) then
    return;
  end if;
  if not exists (
    select 1 from public.jobs
    where id = sample_id and org_id = sample_org
      and metadata @> '{"synthetic":true,"purpose":"Google Play closed testing"}'::jsonb
  ) then
    raise exception 'Refusing to retire a job that is not the expected Play testing fixture';
  end if;

  insert into public.project_workspace(project_id, job_id, org_id)
  values (sample_id, sample_id, sample_org)
  on conflict (project_id) do nothing;

  -- Respect the existing archive-before-trash lifecycle and hide its media.
  update public.project_workspace
  set archived_at = coalesce(archived_at, now())
  where project_id = sample_id and trashed_at is null;
  update public.project_workspace
  set trashed_at = now()
  where project_id = sample_id and trashed_at is null;

  update public.jobs
  set is_feed_visible = false, updated_at = now()
  where id = sample_id and is_feed_visible;
end $$;
