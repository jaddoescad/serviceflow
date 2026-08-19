-- Project media metadata for the Expo -> Cloudflare Worker -> private R2 pipeline.
-- Binary originals live in the private R2 bucket (ottawa-painters-project-media);
-- this table holds metadata and drives authorization through RLS. The Worker
-- reads/writes this table with the caller's JWT, so RLS is the access model.

create table public.job_media (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  object_key text not null unique,
  media_type text not null check (media_type in ('image', 'video')),
  mime_type text not null check (
    mime_type in (
      'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
      'video/mp4', 'video/quicktime'
    )
  ),
  original_filename text check (char_length(original_filename) <= 120),
  byte_size bigint not null check (byte_size > 0),
  width integer check (width > 0),
  height integer check (height > 0),
  duration_ms bigint check (duration_ms >= 0),
  captured_at timestamptz,
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  -- No UPDATE grant exists, so updated_at is only ever set at insert time.
  -- Revisit with a trigger if UPDATE is ever granted.
  updated_at timestamptz not null default now(),
  constraint job_media_object_key_matches_metadata check (
    object_key = 'jobs/' || job_id::text || '/' || id::text ||
      case mime_type
        when 'image/jpeg' then '.jpg'
        when 'image/png' then '.png'
        when 'image/webp' then '.webp'
        when 'image/heic' then '.heic'
        when 'image/heif' then '.heif'
        when 'video/mp4' then '.mp4'
        when 'video/quicktime' then '.mov'
      end
  )
);

comment on table public.job_media is
  'Metadata for job photos/videos stored in the private R2 bucket. Object keys are jobs/{job_id}/{media_id}.{ext}.';

create index job_media_job_id_captured_at_idx
  on public.job_media (job_id, captured_at desc nulls last, created_at desc);

create index job_media_uploaded_by_idx
  on public.job_media (uploaded_by);

alter table public.job_media enable row level security;

revoke all on public.job_media from anon, authenticated;
grant select, insert, delete on public.job_media to authenticated;

-- Anyone who can see the referenced job can see its media. Mirrors the current
-- jobs access model (authenticated read) but stays correct if jobs tightens.
create policy job_media_select on public.job_media
  for select to authenticated
  using (
    (select auth.uid()) is not null
    and exists (
      select 1 from public.jobs j
      where j.id = job_media.job_id
    )
  );

-- Uploads must be attributed to the caller, target a visible job, and use the
-- canonical object key prefix so R2 keys can never point at another job.
create policy job_media_insert on public.job_media
  for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and uploaded_by = (select auth.uid())
    and exists (
      select 1 from public.jobs j
      where j.id = job_media.job_id
    )
  );

-- Uploaders can delete their own media; admins/managers can delete any media
-- on a job they can see.
create policy job_media_delete on public.job_media
  for delete to authenticated
  using (
    (select auth.uid()) is not null
    and exists (
      select 1 from public.jobs j
      where j.id = job_media.job_id
    )
    and (
      uploaded_by = (select auth.uid())
      or exists (
        select 1 from public.employees e
        where e.id = (select auth.uid())
          and e.is_active
          and e.role in ('admin', 'manager')
      )
    )
  );
