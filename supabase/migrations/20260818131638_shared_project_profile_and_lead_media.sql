-- Let the shared project experience attach media to either an operational job
-- or an unconverted lead. Existing job object keys and mobile uploads remain
-- unchanged; lead originals use leads/{lead_id}/{media_id}.{ext} in the same
-- private R2 bucket.

alter table public.job_media
  alter column job_id drop not null,
  add column lead_id uuid references public.leads (id) on delete cascade;

alter table public.job_media
  drop constraint job_media_object_key_matches_metadata,
  add constraint job_media_exactly_one_project_check
    check (num_nonnulls(job_id, lead_id) = 1),
  add constraint job_media_object_key_matches_metadata
    check (
      object_key =
        case
          when job_id is not null then 'jobs/' || job_id::text
          else 'leads/' || lead_id::text
        end
        || '/' || id::text ||
        case mime_type
          when 'image/jpeg' then '.jpg'
          when 'image/png' then '.png'
          when 'image/webp' then '.webp'
          when 'image/heic' then '.heic'
          when 'image/heif' then '.heif'
          when 'video/mp4' then '.mp4'
          when 'video/quicktime' then '.mov'
        end
    );

create index job_media_lead_id_captured_at_idx
  on public.job_media (lead_id, captured_at desc nulls last, created_at desc)
  where lead_id is not null;

comment on column public.job_media.lead_id is
  'Unconverted lead that owns this media. Exactly one of job_id or lead_id is set.';

drop policy job_media_select on public.job_media;
create policy job_media_select on public.job_media
  for select to authenticated
  using (
    (select auth.uid()) is not null
    and (
      (job_id is not null and exists (
        select 1 from public.jobs j where j.id = job_media.job_id
      ))
      or
      (lead_id is not null and exists (
        select 1 from public.leads l where l.id = job_media.lead_id
      ))
    )
  );

drop policy job_media_insert on public.job_media;
create policy job_media_insert on public.job_media
  for insert to authenticated
  with check (
    (select auth.uid()) is not null
    and uploaded_by = (select auth.uid())
    and source_provider = 'app'
    and source_id is null
    and source_project_id is null
    and (
      (job_id is not null and exists (
        select 1 from public.jobs j where j.id = job_media.job_id
      ))
      or
      (lead_id is not null and exists (
        select 1 from public.leads l where l.id = job_media.lead_id
      ))
    )
  );

drop policy job_media_delete on public.job_media;
create policy job_media_delete on public.job_media
  for delete to authenticated
  using (
    (select auth.uid()) is not null
    and (
      (job_id is not null and exists (
        select 1 from public.jobs j where j.id = job_media.job_id
      ))
      or
      (lead_id is not null and exists (
        select 1 from public.leads l where l.id = job_media.lead_id
      ))
    )
    and (
      uploaded_by = (select auth.uid())
      or exists (
        select 1
        from public.employees e
        where e.id = (select auth.uid())
          and e.is_active
          and e.role in ('admin', 'manager')
      )
    )
  );

-- One guarded mutation seam for the shared lead/job project profile. The
-- underlying tables remain read-only to ordinary authenticated clients.
create or replace function public.save_project_profile(
  requested_project_id uuid,
  requested_section text,
  requested_name text default null,
  requested_email text default null,
  requested_phone text default null,
  requested_address text default null,
  requested_customer_notes text default null,
  requested_description text default null,
  requested_project_notes text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_kind text;
  target_job_id uuid;
  target_lead_id uuid;
  target_contact_id uuid;
  job_contact_id uuid;
  lead_contact_id uuid;
  clean_name text := nullif(btrim(requested_name), '');
  clean_email text := nullif(btrim(requested_email), '');
  clean_phone text := nullif(btrim(requested_phone), '');
  clean_address text := nullif(btrim(requested_address), '');
  clean_customer_notes text := nullif(btrim(requested_customer_notes), '');
  clean_description text := nullif(btrim(requested_description), '');
  clean_project_notes text := nullif(btrim(requested_project_notes), '');
begin
  if not exists (
    select 1
    from public.employees e
    where e.id = auth.uid()
      and e.is_active
      and e.role in ('admin', 'manager')
  ) then
    raise exception 'Only active managers can edit project details.'
      using errcode = '42501';
  end if;

  if requested_section not in ('contact', 'description', 'notes') then
    raise exception 'Unsupported project section.' using errcode = '22023';
  end if;

  select j.id, j.lead_id, j.contact_id
    into target_job_id, target_lead_id, job_contact_id
  from public.jobs j
  where j.id = requested_project_id;

  if found then
    target_kind := 'job';
    if target_lead_id is not null then
      select l.contact_id into lead_contact_id
      from public.leads l
      where l.id = target_lead_id;
    end if;
    target_contact_id := coalesce(job_contact_id, lead_contact_id);
  else
    select l.id, l.contact_id
      into target_lead_id, target_contact_id
    from public.leads l
    where l.id = requested_project_id;

    if not found then
      raise exception 'Project not found.' using errcode = 'P0002';
    end if;
    target_kind := 'lead';
  end if;

  if requested_section = 'contact' then
    if clean_name is null then
      raise exception 'Contact name is required.' using errcode = '22023';
    end if;

    if target_contact_id is null then
      insert into public.contacts (
        id, kind, name, email, phone, normalized_email, normalized_phone,
        metadata, created_at, updated_at
      ) values (
        gen_random_uuid(),
        'customer',
        clean_name,
        clean_email,
        clean_phone,
        case when clean_email is null then null else lower(clean_email) end,
        nullif(regexp_replace(coalesce(clean_phone, ''), '[^0-9]+', '', 'g'), ''),
        case
          when clean_customer_notes is null then '{}'::jsonb
          else jsonb_build_object('customer_notes', clean_customer_notes)
        end,
        now(),
        now()
      )
      returning id into target_contact_id;
    else
      update public.contacts c
      set
        name = clean_name,
        email = clean_email,
        phone = clean_phone,
        normalized_email = case when clean_email is null then null else lower(clean_email) end,
        normalized_phone = nullif(
          regexp_replace(coalesce(clean_phone, ''), '[^0-9]+', '', 'g'),
          ''
        ),
        metadata = case
          when clean_customer_notes is null
            then coalesce(c.metadata, '{}'::jsonb) - 'customer_notes'
          else jsonb_set(
            coalesce(c.metadata, '{}'::jsonb),
            '{customer_notes}',
            to_jsonb(clean_customer_notes),
            true
          )
        end,
        updated_at = now()
      where c.id = target_contact_id;
    end if;

    if target_lead_id is not null then
      update public.leads l
      set
        contact_id = target_contact_id,
        address = clean_address,
        city = case when clean_address is null then null else l.city end,
        province = case when clean_address is null then null else l.province end,
        postal_code = case when clean_address is null then null else l.postal_code end,
        updated_at = now()
      where l.id = target_lead_id;
    end if;

    if target_job_id is not null then
      update public.jobs j
      set
        contact_id = target_contact_id,
        formatted_address = clean_address,
        address_line_1 = clean_address,
        city = case when clean_address is null then null else j.city end,
        province = case when clean_address is null then null else j.province end,
        postal_code = case when clean_address is null then null else j.postal_code end,
        updated_at = now()
      where j.id = target_job_id;
    end if;
  elsif requested_section = 'description' then
    if target_kind = 'job' then
      update public.jobs j
      set
        metadata = case
          when clean_description is null
            then coalesce(j.metadata, '{}'::jsonb) - 'project_description'
          else jsonb_set(
            coalesce(j.metadata, '{}'::jsonb),
            '{project_description}',
            to_jsonb(clean_description),
            true
          )
        end,
        updated_at = now()
      where j.id = target_job_id;
    else
      update public.leads l
      set
        metadata = case
          when clean_description is null
            then coalesce(l.metadata, '{}'::jsonb) - 'project_description'
          else jsonb_set(
            coalesce(l.metadata, '{}'::jsonb),
            '{project_description}',
            to_jsonb(clean_description),
            true
          )
        end,
        updated_at = now()
      where l.id = target_lead_id;
    end if;
  else
    if target_kind = 'job' then
      update public.jobs j
      set
        metadata = case
          when clean_project_notes is null
            then coalesce(j.metadata, '{}'::jsonb) - 'project_notes'
          else jsonb_set(
            coalesce(j.metadata, '{}'::jsonb),
            '{project_notes}',
            to_jsonb(clean_project_notes),
            true
          )
        end,
        updated_at = now()
      where j.id = target_job_id;
    else
      update public.leads l
      set
        metadata = case
          when clean_project_notes is null
            then coalesce(l.metadata, '{}'::jsonb) - 'project_notes'
          else jsonb_set(
            coalesce(l.metadata, '{}'::jsonb),
            '{project_notes}',
            to_jsonb(clean_project_notes),
            true
          )
        end,
        updated_at = now()
      where l.id = target_lead_id;
    end if;
  end if;

  return true;
end;
$$;

revoke all on function public.save_project_profile(
  uuid, text, text, text, text, text, text, text, text
) from public;
revoke all on function public.save_project_profile(
  uuid, text, text, text, text, text, text, text, text
) from anon;
grant execute on function public.save_project_profile(
  uuid, text, text, text, text, text, text, text, text
) to authenticated;
