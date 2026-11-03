-- A job's description, written in the crew app (e.g. by the sales manager at
-- the estimate) for the crew and contractors who open the job.
create table public.job_descriptions (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 5000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.job_descriptions enable row level security;
create policy org_member_read on public.job_descriptions for select to authenticated
  using (org_id in (select private.my_org_ids()));
revoke all on public.job_descriptions from anon, authenticated;
grant select on public.job_descriptions to authenticated;

-- Managers write it; an empty body removes it. Returns the saved text.
create or replace function public.set_job_description(requested_job_id uuid, requested_body text)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  company uuid;
  body text := btrim(coalesce(requested_body, ''));
begin
  select org_id into company from public.jobs where id = requested_job_id;
  if company is null then
    raise exception 'Job not found' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(company) then
    raise exception 'Only managers can edit job descriptions.' using errcode = '42501';
  end if;
  if char_length(body) > 5000 then
    raise exception 'Keep the description under 5,000 characters.' using errcode = '22001';
  end if;
  if body = '' then
    delete from public.job_descriptions where job_id = requested_job_id;
    return '';
  end if;
  insert into public.job_descriptions (job_id, org_id, body, updated_by, updated_at)
  values (requested_job_id, company, body, auth.uid(), now())
  on conflict (job_id) do update
    set body = excluded.body, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  return body;
end
$$;

revoke execute on function public.set_job_description(uuid, text) from public, anon;
grant execute on function public.set_job_description(uuid, text) to authenticated;
