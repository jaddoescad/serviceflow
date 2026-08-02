-- First-class DripJobs job identity and its originating lead relationship.
-- CompanyCam remains optional operational evidence and is not the job source.

create table if not exists public.dripjobs_jobs (
  proposal_id text primary key,
  source_crm_record_id uuid not null
    references public.marketing_crm_records(id) on delete restrict,
  invoice_id text,
  job_name text not null,
  contact_name text,
  email text,
  phone text,
  status text not null,
  label text,
  deal_stage text,
  salesperson text,
  amount numeric(14,2) not null default 0,
  invoice_status text,
  paid_amount numeric(14,2) not null default 0,
  balance_amount numeric(14,2) not null default 0,
  proposal_signed_on date,
  job_start_on date,
  job_scheduled_on date,
  job_completion_on date,
  lead_resolution_status text not null default 'needs_review',
  lead_resolution_note text,
  lead_resolved_at timestamptz,
  source_filename text not null,
  source_sha256 text not null,
  source_row_number integer not null,
  source_payload jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dripjobs_jobs_amounts_check check (
    amount >= 0 and paid_amount >= 0
  ),
  constraint dripjobs_jobs_lead_resolution_check check (
    lead_resolution_status in ('confirmed', 'needs_review', 'missing_source')
  ),
  constraint dripjobs_jobs_source_row_check check (source_row_number > 1),
  constraint dripjobs_jobs_source_hash_check check (
    source_sha256 ~ '^[0-9a-f]{64}$'
  )
);

create unique index if not exists dripjobs_jobs_source_record_idx
  on public.dripjobs_jobs(source_crm_record_id);
create index if not exists dripjobs_jobs_status_idx
  on public.dripjobs_jobs(status, proposal_signed_on desc);
create index if not exists dripjobs_jobs_lead_resolution_idx
  on public.dripjobs_jobs(lead_resolution_status, proposal_signed_on desc);

drop trigger if exists dripjobs_jobs_set_updated_at on public.dripjobs_jobs;
create trigger dripjobs_jobs_set_updated_at
before update on public.dripjobs_jobs
for each row execute function public.set_updated_at();

create table if not exists public.marketing_lead_job_links (
  id uuid primary key default gen_random_uuid(),
  lead_deal_id text not null
    references public.marketing_leads(deal_id) on delete restrict,
  job_proposal_id text not null
    references public.dripjobs_jobs(proposal_id) on delete restrict,
  relationship_type text not null default 'originated',
  link_status text not null default 'suggested',
  match_method text not null,
  confidence numeric(4,3) not null,
  evidence jsonb not null default '{}'::jsonb,
  review_note text,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_lead_job_links_pair_unique
    unique (lead_deal_id, job_proposal_id),
  constraint marketing_lead_job_links_relationship_check check (
    relationship_type in ('originated', 'related')
  ),
  constraint marketing_lead_job_links_status_check check (
    link_status in ('suggested', 'confirmed', 'rejected')
  ),
  constraint marketing_lead_job_links_method_check check (
    match_method in (
      'proposal_number',
      'dripjobs_contact_uuid',
      'email_and_phone',
      'email',
      'phone',
      'manual'
    )
  ),
  constraint marketing_lead_job_links_confidence_check check (
    confidence >= 0 and confidence <= 1
  ),
  constraint marketing_lead_job_links_confirmation_check check (
    link_status <> 'confirmed' or confirmed_at is not null
  )
);

create index if not exists marketing_lead_job_links_lead_idx
  on public.marketing_lead_job_links(lead_deal_id, link_status);
create index if not exists marketing_lead_job_links_job_idx
  on public.marketing_lead_job_links(job_proposal_id, link_status);
create unique index if not exists marketing_lead_job_links_one_origin_idx
  on public.marketing_lead_job_links(job_proposal_id)
  where relationship_type = 'originated' and link_status = 'confirmed';

drop trigger if exists marketing_lead_job_links_set_updated_at
  on public.marketing_lead_job_links;
create trigger marketing_lead_job_links_set_updated_at
before update on public.marketing_lead_job_links
for each row execute function public.set_updated_at();

alter table public.dripjobs_jobs enable row level security;
alter table public.marketing_lead_job_links enable row level security;

drop policy if exists "Managers can read dripjobs_jobs" on public.dripjobs_jobs;
create policy "Managers can read dripjobs_jobs"
  on public.dripjobs_jobs for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));
drop policy if exists "Managers can insert dripjobs_jobs" on public.dripjobs_jobs;
create policy "Managers can insert dripjobs_jobs"
  on public.dripjobs_jobs for insert to authenticated
  with check (public.current_employee_role() in ('admin', 'manager'));
drop policy if exists "Managers can update dripjobs_jobs" on public.dripjobs_jobs;
create policy "Managers can update dripjobs_jobs"
  on public.dripjobs_jobs for update to authenticated
  using (public.current_employee_role() in ('admin', 'manager'))
  with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can read marketing_lead_job_links"
  on public.marketing_lead_job_links;
create policy "Managers can read marketing_lead_job_links"
  on public.marketing_lead_job_links for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));
drop policy if exists "Managers can insert marketing_lead_job_links"
  on public.marketing_lead_job_links;
create policy "Managers can insert marketing_lead_job_links"
  on public.marketing_lead_job_links for insert to authenticated
  with check (public.current_employee_role() in ('admin', 'manager'));
drop policy if exists "Managers can update marketing_lead_job_links"
  on public.marketing_lead_job_links;
create policy "Managers can update marketing_lead_job_links"
  on public.marketing_lead_job_links for update to authenticated
  using (public.current_employee_role() in ('admin', 'manager'))
  with check (public.current_employee_role() in ('admin', 'manager'));
drop policy if exists "Managers can delete marketing_lead_job_links"
  on public.marketing_lead_job_links;
create policy "Managers can delete marketing_lead_job_links"
  on public.marketing_lead_job_links for delete to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));

grant select, insert, update on public.dripjobs_jobs to authenticated;
grant select, insert, update, delete
  on public.marketing_lead_job_links to authenticated;

comment on table public.dripjobs_jobs is
  'Canonical one-row-per-proposal DripJobs jobs. CompanyCam is optional supporting evidence only.';
comment on table public.marketing_lead_job_links is
  'Originating lead relationship for canonical DripJobs jobs, with duplicate-contact-safe evidence.';

select pg_notify('pgrst', 'reload schema');
