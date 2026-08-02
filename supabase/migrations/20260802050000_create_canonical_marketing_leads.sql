-- One canonical row per DripJobs lead exported through the maintained
-- "Ottawa Painters - All Leads" Google Sheet. This table is the lead-count
-- denominator; CompanyCam remains separate operational/project evidence.

create table if not exists public.marketing_leads (
  deal_id text primary key,
  created_on date not null,
  created_at_local timestamp without time zone,
  created_at_precision text not null default 'date',
  contact_name text,
  email text,
  phone text,
  raw_lead_source text,
  normalized_channel text not null default 'unknown',
  address text,
  postal_code text,
  estimate_scheduled_on date,
  estimate_appointment_on date,
  proposal_number text,
  proposal_amount numeric(14,2),
  proposal_on date,
  job_crew text,
  is_interior boolean not null default false,
  is_exterior boolean not null default false,
  is_cabinets boolean not null default false,
  source_system text not null default 'google_sheets_dripjobs_export',
  source_filename text not null,
  source_spreadsheet_id text not null,
  source_sheet_name text not null,
  source_row_number integer not null,
  source_sha256 text not null,
  source_payload jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_leads_created_precision_check check (
    created_at_precision in ('date', 'timestamp')
  ),
  constraint marketing_leads_channel_check check (
    normalized_channel in (
      'paid_social',
      'organic_social',
      'website',
      'phone',
      'mail',
      'referral',
      'organic_search',
      'other',
      'unknown'
    )
  ),
  constraint marketing_leads_amount_check check (
    proposal_amount is null or proposal_amount >= 0
  ),
  constraint marketing_leads_source_row_check check (source_row_number > 1),
  constraint marketing_leads_source_hash_check check (
    source_sha256 ~ '^[0-9a-f]{64}$'
  )
);

create index if not exists marketing_leads_created_idx
  on public.marketing_leads(created_on desc, source_row_number desc);
create index if not exists marketing_leads_channel_idx
  on public.marketing_leads(normalized_channel, created_on desc);
create index if not exists marketing_leads_email_idx
  on public.marketing_leads(lower(email)) where email is not null;
create index if not exists marketing_leads_phone_idx
  on public.marketing_leads(phone) where phone is not null;
create index if not exists marketing_leads_source_idx
  on public.marketing_leads(source_sha256, source_row_number);

drop trigger if exists marketing_leads_set_updated_at
  on public.marketing_leads;
create trigger marketing_leads_set_updated_at
before update on public.marketing_leads
for each row execute function public.set_updated_at();

alter table public.marketing_leads enable row level security;

drop policy if exists "Managers can read marketing_leads"
  on public.marketing_leads;
create policy "Managers can read marketing_leads"
  on public.marketing_leads
  for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can insert marketing_leads"
  on public.marketing_leads;
create policy "Managers can insert marketing_leads"
  on public.marketing_leads
  for insert to authenticated
  with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can update marketing_leads"
  on public.marketing_leads;
create policy "Managers can update marketing_leads"
  on public.marketing_leads
  for update to authenticated
  using (public.current_employee_role() in ('admin', 'manager'))
  with check (public.current_employee_role() in ('admin', 'manager'));

grant select, insert, update on public.marketing_leads to authenticated;

comment on table public.marketing_leads is
  'Canonical All Leads denominator. One auditable DripJobs lead per Deal ID, independently linked to CompanyCam evidence at read time.';

select pg_notify('pgrst', 'reload schema');
