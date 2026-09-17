-- Retire project notes; descriptions and customer contact notes are unchanged.
begin;

drop function if exists public.save_project_profile(
  uuid, text, text, text, text, text, text, text, text
);

create or replace function public.save_project_profile(
  requested_project_id uuid,
  requested_section text,
  requested_name text default null,
  requested_email text default null,
  requested_phone text default null,
  requested_address text default null,
  requested_customer_notes text default null,
  requested_description text default null
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

  if requested_section is null or requested_section not in ('contact', 'description') then
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

  end if;

  return true;
end;
$$;

revoke all on function public.save_project_profile(
  uuid, text, text, text, text, text, text, text
) from public;
revoke all on function public.save_project_profile(
  uuid, text, text, text, text, text, text, text
) from anon;
grant execute on function public.save_project_profile(
  uuid, text, text, text, text, text, text, text
) to authenticated;

-- Remove only the retired metadata key, preserving every other project field.
update public.jobs set metadata = metadata - 'project_notes'
where metadata ? 'project_notes';
update public.leads set metadata = metadata - 'project_notes'
where metadata ? 'project_notes';

commit;
