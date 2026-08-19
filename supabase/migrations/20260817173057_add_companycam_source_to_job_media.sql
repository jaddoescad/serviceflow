-- Make historical media imports traceable and idempotent without weakening the
-- authenticated upload path. CompanyCam originals are copied into private R2;
-- only provenance metadata is retained here.

alter table public.job_media
  alter column uploaded_by drop not null,
  add column source_provider text not null default 'app',
  add column source_id text,
  add column source_project_id text,
  add column source_metadata jsonb not null default '{}'::jsonb,
  add constraint job_media_source_provider_check
    check (source_provider in ('app', 'companycam')),
  add constraint job_media_source_id_length_check
    check (source_id is null or char_length(source_id) <= 120),
  add constraint job_media_source_project_id_length_check
    check (source_project_id is null or char_length(source_project_id) <= 120),
  add constraint job_media_source_metadata_object_check
    check (jsonb_typeof(source_metadata) = 'object'),
  add constraint job_media_source_attribution_check
    check (
      (
        source_provider = 'app'
        and uploaded_by is not null
        and source_id is null
        and source_project_id is null
      )
      or
      (
        source_provider = 'companycam'
        and uploaded_by is null
        and source_id is not null
        and source_project_id is not null
      )
    );

create unique index job_media_source_identity_idx
  on public.job_media (source_provider, source_id)
  where source_id is not null;

comment on column public.job_media.source_provider is
  'Origin of the media: app for new uploads, companycam for the one-time historical migration.';
comment on column public.job_media.source_id is
  'Stable media identifier from the source system; unique per source provider.';
comment on column public.job_media.source_project_id is
  'Source project identifier retained for migration traceability.';
comment on column public.job_media.source_metadata is
  'Non-secret source metadata such as creator, description, hash, and original record URL.';

drop policy job_media_insert on public.job_media;

-- Regular users can only create first-party app uploads attributed to
-- themselves. Historical imports use the service role during the bounded
-- migration and therefore do not pass through this client-facing policy.
create policy job_media_insert on public.job_media
  for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and uploaded_by = (select auth.uid())
    and source_provider = 'app'
    and source_id is null
    and source_project_id is null
    and exists (
      select 1 from public.jobs j
      where j.id = job_media.job_id
    )
  );
