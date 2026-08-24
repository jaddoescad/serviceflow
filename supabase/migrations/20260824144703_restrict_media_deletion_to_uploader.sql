-- A project role never grants ownership of another employee's media.
-- The R2 Worker deletes the object only after this metadata delete succeeds,
-- so this policy is the authoritative delete permission.
drop policy if exists job_media_delete on public.job_media;

create policy job_media_delete on public.job_media
  for delete to authenticated
  using (
    (select auth.uid()) is not null
    and uploaded_by = (select auth.uid())
    and (
      (
        job_id is not null
        and exists (
          select 1 from public.jobs j
          where j.id = job_media.job_id
        )
      )
      or
      (
        lead_id is not null
        and exists (
          select 1 from public.leads l
          where l.id = job_media.lead_id
        )
      )
    )
  );
