-- Apply to Ottawa Painters BEFORE ServiceFlow, then deploy the worker.
-- Preserve the project, logical media ID and MIME-derived extension in every
-- key. Optional attempt UUIDs isolate concurrent upload writes in R2.
alter table public.job_media
  drop constraint job_media_object_key_matches_metadata,
  add constraint job_media_object_key_matches_metadata check (
    object_key ~ (
      '^' || case when job_id is not null then 'jobs/' || job_id::text
                  else 'leads/' || lead_id::text end
      || '/' || id::text
      || '(~[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?'
      || '[.]' || case mime_type
        when 'image/jpeg' then 'jpg'
        when 'image/png' then 'png'
        when 'image/webp' then 'webp'
        when 'image/heic' then 'heic'
        when 'image/heif' then 'heif'
        when 'video/mp4' then 'mp4'
        when 'video/quicktime' then 'mov'
      end || '$'
    )
  );
