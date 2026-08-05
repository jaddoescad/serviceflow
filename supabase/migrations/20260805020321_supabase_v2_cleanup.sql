begin;

set local lock_timeout = '15s';
set local statement_timeout = '15min';

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

drop schema if exists v2 cascade;
create schema v2;

create function v2.stable_uuid(scope text, source_key text)
returns uuid
language sql
immutable
strict
set search_path = ''
as $$
  select extensions.uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
    scope || ':' || source_key
  )
$$;

create table v2.app_config (
  id text primary key default 'default',
  schema_version integer not null check (schema_version > 0),
  maintenance_mode boolean not null default false,
  minimum_mobile_version text not null,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table v2.contacts (
  id uuid primary key,
  kind text not null check (kind in ('customer', 'contractor', 'supplier', 'other')),
  dripjobs_contact_id text unique,
  name text not null,
  email text,
  phone text,
  normalized_email text,
  normalized_phone text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table v2.leads (
  id uuid primary key,
  contact_id uuid not null references v2.contacts(id) on delete restrict,
  dripjobs_deal_id text unique,
  status text not null check (status in (
    'new', 'contacted', 'estimate_scheduled', 'estimated',
    'proposal_sent', 'won', 'lost', 'cancelled'
  )),
  pipeline_stage_raw text,
  source text,
  normalized_channel text not null default 'unknown',
  address text,
  city text,
  province text,
  postal_code text,
  estimate_scheduled_on date,
  estimate_appointment_on date,
  is_interior boolean not null default false,
  is_exterior boolean not null default false,
  is_cabinets boolean not null default false,
  created_at timestamptz not null,
  captured_at timestamptz not null,
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table v2.quotes (
  id uuid primary key,
  lead_id uuid not null references v2.leads(id) on delete restrict,
  dripjobs_proposal_id text unique,
  name text not null,
  status text not null check (status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'superseded')),
  amount_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  calculator_doc jsonb,
  accepted_at timestamptz,
  valid_until date,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table v2.jobs (
  id uuid primary key,
  contact_id uuid references v2.contacts(id) on delete restrict,
  lead_id uuid references v2.leads(id) on delete restrict,
  accepted_quote_id uuid unique references v2.quotes(id) on delete restrict,
  name text not null,
  status text not null check (status in ('scheduled', 'active', 'completed', 'cancelled', 'archived')),
  contract_amount_cents bigint not null default 0,
  address_line_1 text,
  address_line_2 text,
  city text,
  province text,
  postal_code text,
  country text not null default 'CA',
  formatted_address text,
  latitude double precision,
  longitude double precision,
  companycam_project_ids text[] not null default '{}'::text[],
  scheduled_on date,
  started_on date,
  completed_on date,
  archived_at timestamptz,
  is_feed_visible boolean not null default true,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table v2.employees (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null check (role in ('admin', 'manager', 'painter')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table v2.employee_pay_rates (
  id uuid primary key,
  employee_id uuid not null references v2.employees(id) on delete restrict,
  hourly_rate_cents integer not null check (hourly_rate_cents >= 0),
  effective_from date not null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, effective_from)
);

create table v2.job_assignments (
  id uuid primary key,
  job_id uuid not null references v2.jobs(id) on delete cascade,
  employee_id uuid not null references v2.employees(id) on delete cascade,
  status text not null check (status in ('active', 'inactive')),
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, employee_id)
);

create table v2.job_budgets (
  id uuid primary key,
  job_id uuid not null references v2.jobs(id) on delete cascade,
  quote_id uuid references v2.quotes(id) on delete set null,
  version integer not null default 1 check (version > 0),
  status text not null check (status in ('draft', 'active', 'closed', 'superseded')),
  budget_minutes integer,
  calculated_minutes integer,
  hourly_rate_cents integer,
  amount_including_tax_cents bigint,
  labour_allocation_percent numeric(6,3) not null default 40,
  actual_labour_cost_cents bigint,
  instructions text,
  notes text,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  source text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, source, version)
);

create table v2.time_entries (
  id uuid primary key,
  client_entry_id text unique,
  employee_id uuid references v2.employees(id) on delete restrict,
  job_id uuid references v2.jobs(id) on delete restrict,
  employee_email text,
  employee_name text,
  job_name text not null,
  job_address text,
  original_started_at timestamptz,
  started_at timestamptz not null,
  start_edited_at timestamptz,
  ended_at timestamptz,
  status text not null check (status in ('active', 'completed', 'deleted')),
  clock_in_latitude double precision,
  clock_in_longitude double precision,
  clock_out_latitude double precision,
  clock_out_longitude double precision,
  last_distance_meters integer,
  is_on_site boolean,
  segments jsonb not null default '[]'::jsonb,
  adjustment_history jsonb not null default '[]'::jsonb,
  notes text,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'active' and ended_at is null) or status <> 'active')
);

create table v2.time_entry_events (
  id uuid primary key,
  time_entry_id uuid references v2.time_entries(id) on delete cascade,
  client_entry_id text not null,
  employee_id uuid not null references v2.employees(id) on delete restrict,
  event_type text not null,
  captured_at timestamptz not null,
  received_at timestamptz not null,
  source text not null,
  metadata jsonb not null default '{}'::jsonb
);

create table v2.job_tasks (
  id uuid primary key,
  job_id uuid not null references v2.jobs(id) on delete cascade,
  budget_id uuid references v2.job_budgets(id) on delete set null,
  source_kind text not null,
  source_item_id text not null,
  title text not null,
  notes text,
  budget_minutes integer,
  calculated_minutes integer,
  sort_order integer not null default 0,
  status text not null check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  completed_by uuid references v2.employees(id) on delete set null,
  completed_at timestamptz,
  versions jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, source_kind, source_item_id)
);

create table v2.job_task_time_entries (
  id uuid primary key,
  client_entry_id text not null unique,
  task_id uuid not null references v2.job_tasks(id) on delete cascade,
  employee_id uuid not null references v2.employees(id) on delete restrict,
  time_entry_id uuid references v2.time_entries(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  status text not null check (status in ('active', 'completed', 'deleted')),
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table v2.job_issues (
  id uuid primary key,
  client_id text,
  job_id uuid not null references v2.jobs(id) on delete cascade,
  task_id uuid references v2.job_tasks(id) on delete cascade,
  employee_id uuid references v2.employees(id) on delete set null,
  issue_type text not null,
  reason text not null,
  note text,
  minutes_over integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table v2.push_tokens (
  id uuid primary key,
  employee_id uuid not null references v2.employees(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null,
  device_push_token text,
  app_version text,
  is_active boolean not null default true,
  last_registered_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table v2.employee_location_points (
  id uuid primary key,
  client_event_id text not null unique,
  employee_id uuid not null references v2.employees(id) on delete cascade,
  time_entry_id uuid references v2.time_entries(id) on delete set null,
  client_entry_id text not null,
  job_id uuid references v2.jobs(id) on delete set null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_meters double precision,
  speed_mps double precision,
  heading_degrees double precision,
  is_mocked boolean,
  tracking_mode text not null,
  event_type text not null,
  distance_from_job_meters integer,
  is_on_site boolean,
  captured_at timestamptz not null,
  received_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table v2.employee_tracking_status (
  employee_id uuid primary key references v2.employees(id) on delete cascade,
  employee_email text,
  employee_name text,
  time_entry_id uuid references v2.time_entries(id) on delete set null,
  client_entry_id text,
  job_id uuid references v2.jobs(id) on delete set null,
  job_name text,
  job_address text,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  last_location_at timestamptz,
  last_sync_at timestamptz,
  tracking_mode text not null,
  task_status text not null,
  permission_foreground boolean,
  permission_background boolean,
  platform text,
  app_version text,
  last_error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table v2.location_alerts (
  id uuid primary key default extensions.gen_random_uuid(),
  employee_id uuid not null references v2.employees(id) on delete cascade,
  time_entry_id uuid not null references v2.time_entries(id) on delete cascade,
  stale_since timestamptz not null,
  last_notified_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table v2.accounts (
  id uuid primary key,
  slug text not null unique,
  institution text not null,
  name text not null,
  account_type text not null,
  last_four text,
  currency text not null default 'CAD',
  is_active boolean not null default true,
  current_balance_cents bigint,
  available_balance_cents bigint,
  credit_limit_cents bigint,
  balance_as_of timestamptz,
  external_provider text,
  external_account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table v2.documents (
  id uuid primary key,
  kind text not null,
  original_filename text not null,
  mime_type text,
  size_bytes bigint,
  content_sha256 text,
  storage_bucket text,
  storage_path text,
  source_url text,
  captured_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table v2.transactions (
  id uuid primary key,
  account_id uuid not null references v2.accounts(id) on delete restrict,
  import_document_id uuid references v2.documents(id) on delete set null,
  contact_id uuid references v2.contacts(id) on delete set null,
  source_key text not null,
  posted_on date not null,
  transaction_on date,
  description text not null,
  counterparty text,
  amount_cents bigint not null,
  tax_cents bigint not null default 0,
  net_cents bigint,
  currency text not null default 'CAD',
  transaction_type text not null,
  category text not null,
  is_transfer boolean not null default false,
  review_status text not null,
  running_balance_cents bigint,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, source_key)
);

create table v2.invoices (
  id uuid primary key,
  contact_id uuid references v2.contacts(id) on delete set null,
  direction text not null check (direction in ('receivable', 'payable')),
  category text not null check (category in ('customer', 'labour', 'material', 'other')),
  source_system text not null,
  external_id text,
  invoice_number text not null,
  status text not null,
  issued_on date,
  due_on date,
  currency text not null default 'CAD',
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  paid_cents bigint not null default 0,
  balance_cents bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table v2.invoice_lines (
  id uuid primary key,
  invoice_id uuid not null references v2.invoices(id) on delete cascade,
  line_number integer not null,
  description text not null,
  quantity numeric,
  unit text,
  unit_price_cents bigint,
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  service_started_on date,
  service_ended_on date,
  source_kind text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, line_number)
);

create table v2.invoice_job_allocations (
  id uuid primary key,
  invoice_id uuid not null references v2.invoices(id) on delete cascade,
  invoice_line_id uuid references v2.invoice_lines(id) on delete cascade,
  job_id uuid not null references v2.jobs(id) on delete restrict,
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  quantity numeric,
  minutes integer,
  allocation_method text not null,
  confidence numeric,
  needs_review boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table v2.invoice_line_time_entries (
  invoice_line_id uuid not null references v2.invoice_lines(id) on delete cascade,
  time_entry_id uuid not null references v2.time_entries(id) on delete cascade,
  minutes integer not null check (minutes >= 0),
  match_method text not null,
  needs_review boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (invoice_line_id, time_entry_id)
);

create table v2.transaction_allocations (
  id uuid primary key,
  transaction_id uuid references v2.transactions(id) on delete cascade,
  invoice_id uuid references v2.invoices(id) on delete cascade,
  counter_invoice_id uuid references v2.invoices(id) on delete cascade,
  job_id uuid references v2.jobs(id) on delete restrict,
  contact_id uuid references v2.contacts(id) on delete set null,
  source_system text,
  external_id text,
  allocation_type text not null,
  amount_cents bigint not null,
  allocation_method text,
  confidence numeric,
  needs_review boolean not null default false,
  reversed_at timestamptz,
  reversal_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    transaction_id is not null
    or counter_invoice_id is not null
    or external_id is not null
  )
);

create table v2.evidence_links (
  id uuid primary key,
  document_id uuid not null references v2.documents(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  evidence_role text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table v2.verification_events (
  id uuid primary key,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  reason text,
  old_values jsonb,
  new_values jsonb,
  evidence jsonb not null default '{}'::jsonb,
  performed_by uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null
);

create table v2.acquisition_attributions (
  id uuid primary key,
  lead_id uuid references v2.leads(id) on delete cascade,
  job_id uuid references v2.jobs(id) on delete cascade,
  invoice_id uuid references v2.invoices(id) on delete cascade,
  source_system text not null,
  raw_source text,
  normalized_channel text not null,
  campaign text,
  evidence_source text not null,
  evidence_reference text,
  evidence jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (lead_id is not null or job_id is not null or invoice_id is not null)
);

create table v2.marketing_performance (
  id uuid primary key,
  platform text not null,
  account_id text not null,
  grain text not null check (grain in ('daily', 'range', 'monthly')),
  period_start date not null,
  period_end date not null,
  entity_level text not null,
  entity_id text,
  entity_name text not null,
  parent_campaign_name text,
  parent_ad_set_name text,
  purpose text not null,
  currency text not null,
  spend_cents bigint not null default 0,
  results numeric,
  result_indicator text,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table v2.integration_events (
  id uuid primary key,
  provider text not null,
  event_key text not null,
  event_type text not null,
  entity_type text,
  entity_id text,
  occurred_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  payload_sha256 text,
  processing_status text not null,
  error_code text,
  is_test boolean not null default false,
  attempt_count integer not null default 0,
  received_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, event_key)
);

create table v2.contact_map (
  source_type text not null,
  source_key text not null,
  contact_id uuid not null,
  primary key (source_type, source_key)
);

create table v2.project_lead_map (
  old_project_id text primary key,
  lead_id uuid not null references v2.leads(id) on delete cascade
);

create table v2.job_map (
  old_project_id text primary key,
  job_id uuid not null references v2.jobs(id) on delete cascade,
  proposal_id text
);

create table v2.document_map (
  source_type text not null,
  old_id uuid not null,
  document_id uuid not null,
  primary key (source_type, old_id)
);

create table v2.invoice_map (
  source_type text not null,
  old_id uuid not null,
  invoice_id uuid not null,
  primary key (source_type, old_id)
);

create table v2.invoice_line_map (
  source_type text not null,
  old_id uuid not null,
  invoice_line_id uuid not null,
  primary key (source_type, old_id)
);

-- Contacts and leads -------------------------------------------------------

insert into v2.contact_map (source_type, source_key, contact_id)
select
  'lead',
  lead.deal_id,
  v2.stable_uuid(
    'contact',
    case
      when nullif(btrim(lead.dripjobs_contact_uuid), '') is not null
        then 'dripjobs:' || btrim(lead.dripjobs_contact_uuid)
      when nullif(lower(btrim(lead.email)), '') is not null
       and nullif(regexp_replace(coalesce(lead.phone, ''), '[^0-9]+', '', 'g'), '') is not null
        then 'email-phone:' || lower(btrim(lead.email)) || ':' || regexp_replace(lead.phone, '[^0-9]+', '', 'g')
      else 'lead:' || lead.deal_id
    end
  )
from public.marketing_leads lead;

insert into v2.contacts (
  id, kind, dripjobs_contact_id, name, email, phone,
  normalized_email, normalized_phone, metadata, created_at, updated_at
)
select distinct on (mapping.contact_id)
  mapping.contact_id,
  'customer',
  nullif(btrim(lead.dripjobs_contact_uuid), ''),
  coalesce(nullif(btrim(lead.contact_name), ''), 'Unknown contact'),
  nullif(lower(btrim(lead.email)), ''),
  nullif(btrim(lead.phone), ''),
  nullif(lower(btrim(lead.email)), ''),
  nullif(regexp_replace(coalesce(lead.phone, ''), '[^0-9]+', '', 'g'), ''),
  jsonb_build_object('source', 'marketing_leads'),
  coalesce(lead.captured_at, lead.inserted_at),
  lead.updated_at
from public.marketing_leads lead
join v2.contact_map mapping
  on mapping.source_type = 'lead'
 and mapping.source_key = lead.deal_id
order by mapping.contact_id, lead.updated_at desc, lead.deal_id;

insert into v2.leads (
  id, contact_id, dripjobs_deal_id, status, pipeline_stage_raw,
  source, normalized_channel, address, postal_code,
  estimate_scheduled_on, estimate_appointment_on,
  is_interior, is_exterior, is_cabinets,
  created_at, captured_at, updated_at, metadata
)
select
  v2.stable_uuid('lead', lead.deal_id),
  mapping.contact_id,
  lead.deal_id,
  case
    when exists (
      select 1
      from public.marketing_lead_job_links link
      where link.lead_deal_id = lead.deal_id
        and link.relationship_type = 'originated'
        and link.link_status = 'confirmed'
    ) then 'won'
    when lead.proposal_number is not null then 'proposal_sent'
    when lead.estimate_appointment_on is not null then 'estimated'
    when lead.estimate_scheduled_on is not null then 'estimate_scheduled'
    else 'new'
  end,
  null,
  lead.raw_lead_source,
  lead.normalized_channel,
  lead.address,
  lead.postal_code,
  lead.estimate_scheduled_on,
  lead.estimate_appointment_on,
  lead.is_interior,
  lead.is_exterior,
  lead.is_cabinets,
  coalesce(
    lead.created_at_local at time zone 'America/Toronto',
    lead.created_on::timestamp at time zone 'America/Toronto',
    lead.captured_at
  ),
  lead.captured_at,
  lead.updated_at,
  jsonb_build_object(
    'source_system', lead.source_system,
    'source_payload', lead.source_payload,
    'source_filename', lead.source_filename,
    'source_row_number', lead.source_row_number,
    'proposal_number', lead.proposal_number,
    'proposal_amount', lead.proposal_amount,
    'proposal_on', lead.proposal_on,
    'job_crew', lead.job_crew,
    'old_operational_project_id', lead.operational_project_id
  )
from public.marketing_leads lead
join v2.contact_map mapping
  on mapping.source_type = 'lead'
 and mapping.source_key = lead.deal_id;

insert into v2.project_lead_map (old_project_id, lead_id)
select lead.operational_project_id, v2.stable_uuid('lead', lead.deal_id)
from public.marketing_leads lead
where lead.operational_project_id is not null
on conflict (old_project_id) do nothing;

insert into v2.project_lead_map (old_project_id, lead_id)
select link.companycam_project_id, v2.stable_uuid('lead', link.lead_deal_id)
from public.marketing_lead_project_links link
where link.link_status = 'confirmed'
  and exists (
    select 1 from public.marketing_leads lead where lead.deal_id = link.lead_deal_id
  )
on conflict (old_project_id) do nothing;

-- Preserve a calculator even if its old CompanyCam-only lead never reached
-- the DripJobs export. These rows remain leads, not operational jobs.
insert into v2.contacts (
  id, kind, name, metadata, created_at, updated_at
)
select
  v2.stable_uuid('contact', 'legacy-lead-project:' || project.companycam_id),
  'customer',
  project.name,
  jsonb_build_object('source', 'legacy_companycam_lead', 'companycam_project_id', project.companycam_id),
  coalesce(project.companycam_created_at, project.inserted_at),
  project.updated_at
from public.project_calculators calculator
join public.companycam_projects project
  on project.companycam_id = calculator.companycam_project_id
where not exists (
  select 1 from v2.project_lead_map map where map.old_project_id = project.companycam_id
)
  and not exists (
    select 1
    from public.job_project_links link
    where link.companycam_project_id = project.companycam_id
      and link.link_status = 'confirmed'
  )
on conflict (id) do nothing;

insert into v2.leads (
  id, contact_id, status, source, normalized_channel,
  address, city, province, postal_code,
  created_at, captured_at, updated_at, metadata
)
select
  v2.stable_uuid('lead', 'legacy-project:' || project.companycam_id),
  v2.stable_uuid('contact', 'legacy-lead-project:' || project.companycam_id),
  'proposal_sent',
  'legacy_companycam',
  'unknown',
  project.street_address_1,
  project.city,
  project.state,
  project.postal_code,
  coalesce(project.companycam_created_at, project.inserted_at),
  project.last_synced_at,
  project.updated_at,
  jsonb_build_object('companycam_project_id', project.companycam_id, 'labels', project.labels)
from public.project_calculators calculator
join public.companycam_projects project
  on project.companycam_id = calculator.companycam_project_id
where not exists (
  select 1 from v2.project_lead_map map where map.old_project_id = project.companycam_id
)
  and not exists (
    select 1
    from public.job_project_links link
    where link.companycam_project_id = project.companycam_id
      and link.link_status = 'confirmed'
  )
on conflict (id) do nothing;

insert into v2.project_lead_map (old_project_id, lead_id)
select
  project.companycam_id,
  v2.stable_uuid('lead', 'legacy-project:' || project.companycam_id)
from public.project_calculators calculator
join public.companycam_projects project
  on project.companycam_id = calculator.companycam_project_id
where not exists (
  select 1 from v2.project_lead_map map where map.old_project_id = project.companycam_id
)
  and not exists (
    select 1
    from public.job_project_links link
    where link.companycam_project_id = project.companycam_id
      and link.link_status = 'confirmed'
  )
on conflict (old_project_id) do nothing;

-- Accepted proposals and jobs ---------------------------------------------

with proposal_leads as (
  select distinct on (link.job_proposal_id)
    link.job_proposal_id,
    v2.stable_uuid('lead', link.lead_deal_id) as lead_id
  from public.marketing_lead_job_links link
  where link.relationship_type = 'originated'
    and link.link_status = 'confirmed'
  order by link.job_proposal_id, link.confirmed_at desc nulls last, link.id
)
insert into v2.quotes (
  id, lead_id, dripjobs_proposal_id, name, status,
  amount_cents, accepted_at, source, metadata, created_at, updated_at
)
select
  v2.stable_uuid('quote', job.proposal_id),
  proposal_leads.lead_id,
  job.proposal_id,
  job.job_name,
  case when job.accounting_status = 'superseded' then 'superseded' else 'accepted' end,
  round(coalesce(job.amount, 0) * 100)::bigint,
  coalesce(job.proposal_signed_on::timestamp at time zone 'America/Toronto', job.captured_at),
  'dripjobs',
  jsonb_build_object(
    'invoice_id', job.invoice_id,
    'invoice_status', job.invoice_status,
    'paid_amount', job.paid_amount,
    'balance_amount', job.balance_amount,
    'source_payload', job.source_payload,
    'accounting_status', job.accounting_status,
    'superseded_by_proposal_id', job.superseded_by_proposal_id
  ),
  job.captured_at,
  job.updated_at
from public.dripjobs_jobs job
join proposal_leads on proposal_leads.job_proposal_id = job.proposal_id;

with proposal_leads as (
  select distinct on (link.job_proposal_id)
    link.job_proposal_id,
    v2.stable_uuid('lead', link.lead_deal_id) as lead_id
  from public.marketing_lead_job_links link
  where link.relationship_type = 'originated'
    and link.link_status = 'confirmed'
  order by link.job_proposal_id, link.confirmed_at desc nulls last, link.id
), canonical_project as (
  select
    job.proposal_id,
    project.companycam_id,
    project.name,
    project.street_address_1,
    project.street_address_2,
    project.city,
    project.state,
    project.postal_code,
    project.country,
    project.formatted_address,
    project.latitude,
    project.longitude,
    project.is_archived,
    project.inserted_at,
    project.updated_at,
    row_number() over (
      partition by job.proposal_id
      order by
        (link.link_role = 'canonical') desc,
        (project.companycam_id ~ '^[0-9]+$') desc,
        link.confirmed_at desc nulls last,
        project.updated_at desc,
        project.companycam_id
    ) as project_rank
  from public.dripjobs_jobs job
  left join public.job_project_links link
    on link.job_proposal_id = job.proposal_id
   and link.link_status = 'confirmed'
  left join public.companycam_projects project
    on project.companycam_id = link.companycam_project_id
), companycam_ids as (
  select
    job.proposal_id,
    coalesce(
      array_agg(distinct project.companycam_id order by project.companycam_id)
        filter (where project.companycam_id ~ '^[0-9]+$'),
      '{}'::text[]
    ) as ids
  from public.dripjobs_jobs job
  left join public.job_project_links link
    on link.job_proposal_id = job.proposal_id
   and link.link_status = 'confirmed'
  left join public.companycam_projects project
    on project.companycam_id = link.companycam_project_id
  group by job.proposal_id
)
insert into v2.jobs (
  id, contact_id, lead_id, accepted_quote_id, name, status,
  contract_amount_cents, address_line_1, address_line_2,
  city, province, postal_code, country, formatted_address,
  latitude, longitude, companycam_project_ids,
  scheduled_on, started_on, completed_on, archived_at,
  is_feed_visible, source, metadata, created_at, updated_at
)
select
  v2.stable_uuid('job', 'proposal:' || job.proposal_id),
  lead.contact_id,
  proposal_leads.lead_id,
  v2.stable_uuid('quote', job.proposal_id),
  coalesce(nullif(canonical.name, ''), job.job_name),
  case
    when upper(job.status) = 'COMPLETED' or job.job_completion_on is not null then 'completed'
    when upper(job.status) = 'SCHEDULED' or job.job_scheduled_on is not null then 'scheduled'
    when upper(job.status) in ('CANCELLED', 'CANCELED') then 'cancelled'
    when upper(job.status) = 'ARCHIVED' then 'archived'
    else 'active'
  end,
  round(coalesce(job.amount, 0) * 100)::bigint,
  coalesce(canonical.street_address_1, job.address),
  canonical.street_address_2,
  coalesce(canonical.city, job.city),
  coalesce(canonical.state, job.state),
  coalesce(canonical.postal_code, job.postal_code),
  coalesce(canonical.country, 'CA'),
  canonical.formatted_address,
  canonical.latitude,
  canonical.longitude,
  companycam_ids.ids,
  job.job_scheduled_on,
  job.job_start_on,
  job.job_completion_on,
  case when upper(job.status) = 'ARCHIVED' then job.updated_at else null end,
  job.accounting_status = 'active',
  'dripjobs',
  jsonb_build_object(
    'dripjobs_status', job.status,
    'label', job.label,
    'deal_stage', job.deal_stage,
    'salesperson', job.salesperson,
    'accounting_status', job.accounting_status,
    'source_payload', job.source_payload,
    'old_canonical_project_id', canonical.companycam_id
  ),
  least(job.captured_at, coalesce(canonical.inserted_at, job.captured_at)),
  greatest(job.updated_at, coalesce(canonical.updated_at, job.updated_at))
from public.dripjobs_jobs job
join proposal_leads on proposal_leads.job_proposal_id = job.proposal_id
join v2.leads lead on lead.id = proposal_leads.lead_id
left join canonical_project canonical
  on canonical.proposal_id = job.proposal_id
 and canonical.project_rank = 1
join companycam_ids on companycam_ids.proposal_id = job.proposal_id;

insert into v2.job_map (old_project_id, job_id, proposal_id)
select
  link.companycam_project_id,
  v2.stable_uuid('job', 'proposal:' || link.job_proposal_id),
  link.job_proposal_id
from public.job_project_links link
where link.link_status = 'confirmed'
  and exists (select 1 from public.dripjobs_jobs job where job.proposal_id = link.job_proposal_id)
on conflict (old_project_id) do nothing;

insert into v2.job_map (old_project_id, job_id, proposal_id)
select
  project.companycam_id,
  v2.stable_uuid('job', 'proposal:' || project.operational_job_proposal_id),
  project.operational_job_proposal_id
from public.companycam_projects project
where project.operational_job_proposal_id is not null
  and exists (
    select 1 from public.dripjobs_jobs job
    where job.proposal_id = project.operational_job_proposal_id
  )
on conflict (old_project_id) do nothing;

insert into v2.job_map (old_project_id, job_id, proposal_id)
select alias.alias_project_id, canonical.job_id, canonical.proposal_id
from public.project_identity_aliases alias
join v2.job_map canonical
  on canonical.old_project_id = alias.canonical_project_id
on conflict (old_project_id) do nothing;

-- Create contacts and jobs for real legacy operational rows that do not map
-- to a DripJobs proposal. Lead/calculator-only rows are intentionally omitted.
insert into v2.contacts (id, kind, name, metadata, created_at, updated_at)
select
  v2.stable_uuid('contact', 'legacy-job:' || project.companycam_id),
  'customer',
  project.name,
  jsonb_build_object('source', 'legacy_job', 'old_project_id', project.companycam_id),
  coalesce(project.companycam_created_at, project.inserted_at),
  project.updated_at
from public.companycam_projects project
where not exists (select 1 from v2.job_map map where map.old_project_id = project.companycam_id)
  and not exists (select 1 from v2.project_lead_map map where map.old_project_id = project.companycam_id)
  and project.raw ->> 'source' is distinct from 'codex-web-qa'
  and project.companycam_id <> 'qa-web-smoke-project'
on conflict (id) do nothing;

insert into v2.leads (
  id, contact_id, status, source, normalized_channel, address,
  city, province, postal_code, created_at, captured_at, updated_at, metadata
)
select
  v2.stable_uuid('lead', 'legacy-job:' || project.companycam_id),
  v2.stable_uuid('contact', 'legacy-job:' || project.companycam_id),
  'won',
  'legacy_companycam',
  'unknown',
  coalesce(project.formatted_address, project.street_address_1),
  project.city,
  project.state,
  project.postal_code,
  coalesce(project.companycam_created_at, project.inserted_at),
  project.last_synced_at,
  project.updated_at,
  jsonb_build_object('old_project_id', project.companycam_id)
from public.companycam_projects project
where not exists (select 1 from v2.job_map map where map.old_project_id = project.companycam_id)
  and not exists (select 1 from v2.project_lead_map map where map.old_project_id = project.companycam_id)
  and project.raw ->> 'source' is distinct from 'codex-web-qa'
  and project.companycam_id <> 'qa-web-smoke-project'
on conflict (id) do nothing;

insert into v2.jobs (
  id, contact_id, lead_id, name, status, address_line_1, address_line_2,
  city, province, postal_code, country, formatted_address,
  latitude, longitude, companycam_project_ids, archived_at,
  is_feed_visible, source, metadata, created_at, updated_at
)
select
  v2.stable_uuid('job', 'legacy-project:' || project.companycam_id),
  v2.stable_uuid('contact', 'legacy-job:' || project.companycam_id),
  v2.stable_uuid('lead', 'legacy-job:' || project.companycam_id),
  project.name,
  case
    when project.is_deleted then 'cancelled'
    when project.is_archived then 'archived'
    else 'active'
  end,
  project.street_address_1,
  project.street_address_2,
  project.city,
  project.state,
  project.postal_code,
  coalesce(project.country, 'CA'),
  project.formatted_address,
  project.latitude,
  project.longitude,
  case when project.companycam_id ~ '^[0-9]+$' then array[project.companycam_id] else '{}'::text[] end,
  case when project.is_archived then project.updated_at else null end,
  project.is_job_feed_visible and not project.is_deleted,
  'legacy_companycam',
  jsonb_build_object('labels', project.labels, 'raw', project.raw, 'old_project_id', project.companycam_id),
  coalesce(project.companycam_created_at, project.inserted_at),
  project.updated_at
from public.companycam_projects project
where not exists (select 1 from v2.job_map map where map.old_project_id = project.companycam_id)
  and not exists (select 1 from v2.project_lead_map map where map.old_project_id = project.companycam_id)
  and project.raw ->> 'source' is distinct from 'codex-web-qa'
  and project.companycam_id <> 'qa-web-smoke-project';

insert into v2.job_map (old_project_id, job_id)
select
  project.companycam_id,
  v2.stable_uuid('job', 'legacy-project:' || project.companycam_id)
from public.companycam_projects project
where exists (
  select 1 from v2.jobs job
  where job.id = v2.stable_uuid('job', 'legacy-project:' || project.companycam_id)
)
on conflict (old_project_id) do nothing;

-- Every job-linked project inherits the originating lead for calculator
-- migration and shared lead/job navigation.
insert into v2.project_lead_map (old_project_id, lead_id)
select map.old_project_id, job.lead_id
from v2.job_map map
join v2.jobs job on job.id = map.job_id
where job.lead_id is not null
on conflict (old_project_id) do update set lead_id = excluded.lead_id;

-- Preserve every calculator document. The first calculator associated with
-- an accepted job enriches its accepted quote; additional calculators remain
-- independent draft quotes on the same lead.
with accepted_calculators as (
  select distinct on (job.accepted_quote_id)
    job.accepted_quote_id,
    calculator.doc,
    calculator.updated_at,
    calculator.companycam_project_id
  from public.project_calculators calculator
  join v2.job_map map on map.old_project_id = calculator.companycam_project_id
  join v2.jobs job on job.id = map.job_id
  where job.accepted_quote_id is not null
  order by job.accepted_quote_id,
    (calculator.companycam_project_id ~ '^[0-9]+$') desc,
    calculator.updated_at desc,
    calculator.companycam_project_id
)
update v2.quotes quote
set calculator_doc = accepted.doc,
    updated_at = greatest(quote.updated_at, accepted.updated_at),
    metadata = quote.metadata || jsonb_build_object(
      'calculator_old_project_id', accepted.companycam_project_id
    )
from accepted_calculators accepted
where quote.id = accepted.accepted_quote_id;

insert into v2.quotes (
  id, lead_id, name, status, amount_cents, calculator_doc,
  source, metadata, created_at, updated_at
)
select
  v2.stable_uuid('quote', 'calculator:' || calculator.companycam_project_id),
  lead_map.lead_id,
  coalesce(project.name, 'Estimate'),
  'draft',
  0,
  calculator.doc,
  'calculator',
  jsonb_build_object(
    'old_project_id', calculator.companycam_project_id,
    'legacy_project_budget', (
      select to_jsonb(budget)
      from public.project_budgets budget
      where budget.companycam_project_id = calculator.companycam_project_id
    ),
    'legacy_labour_budgets', coalesce((
      select jsonb_agg(to_jsonb(budget) order by budget.revision, budget.id)
      from public.project_labour_budgets budget
      where budget.companycam_project_id = calculator.companycam_project_id
    ), '[]'::jsonb)
  ),
  calculator.updated_at,
  calculator.updated_at
from public.project_calculators calculator
join v2.project_lead_map lead_map
  on lead_map.old_project_id = calculator.companycam_project_id
left join public.companycam_projects project
  on project.companycam_id = calculator.companycam_project_id
where not exists (
  select 1
  from v2.job_map map
  join v2.jobs job on job.id = map.job_id
  join v2.quotes accepted on accepted.id = job.accepted_quote_id
  where map.old_project_id = calculator.companycam_project_id
    and accepted.metadata ->> 'calculator_old_project_id'
      = calculator.companycam_project_id
)
on conflict (id) do nothing;

-- Employees and operations ------------------------------------------------

insert into v2.employees (
  id, email, full_name, role, is_active, created_at, updated_at
)
select
  profile.user_id,
  profile.email,
  profile.full_name,
  case when profile.role in ('admin', 'manager', 'painter') then profile.role else 'painter' end,
  profile.is_active,
  profile.inserted_at,
  profile.updated_at
from public.employee_profiles profile;

insert into v2.employee_pay_rates (
  id, employee_id, hourly_rate_cents, effective_from, notes,
  created_by, created_at, updated_at
)
select
  rate.id,
  rate.user_id,
  round(rate.hourly_rate * 100)::integer,
  rate.effective_from,
  rate.notes,
  rate.inserted_by,
  rate.inserted_at,
  rate.updated_at
from public.employee_pay_rates rate;

insert into v2.job_assignments (
  id, job_id, employee_id, status, assigned_by, created_at, updated_at
)
select
  assignment.id,
  map.job_id,
  assignment.user_id,
  case when assignment.status = 'inactive' then 'inactive' else 'active' end,
  assignment.assigned_by,
  assignment.inserted_at,
  assignment.updated_at
from public.project_assignments assignment
join v2.job_map map on map.old_project_id = assignment.companycam_project_id;

-- Canonical jobs can have several historical project aliases. Preserve every
-- budget row and assign a deterministic job-level version after aliases merge.
with ranked_budgets as (
  select
    budget.*,
    map.job_id,
    row_number() over (
      partition by map.job_id
      order by budget.updated_at, budget.companycam_project_id
    ) as canonical_version
  from public.project_budgets budget
  join v2.job_map map on map.old_project_id = budget.companycam_project_id
)
insert into v2.job_budgets (
  id, job_id, quote_id, version, status, budget_minutes,
  hourly_rate_cents, amount_including_tax_cents,
  labour_allocation_percent, actual_labour_cost_cents,
  notes, closed_at, closed_by, source, metadata, created_at, updated_at
)
select
  v2.stable_uuid('budget', 'project:' || budget.companycam_project_id),
  budget.job_id,
  job.accepted_quote_id,
  budget.canonical_version,
  case when budget.labour_closed_at is not null then 'closed' else 'active' end,
  case when budget.budgeted_hours is null then null else round(budget.budgeted_hours * 60)::integer end,
  case when budget.hourly_rate is null then null else round(budget.hourly_rate * 100)::integer end,
  case when budget.amount_including_tax is null then null else round(budget.amount_including_tax * 100)::bigint end,
  coalesce(budget.labour_allocation_percent, 40),
  case when budget.actual_labour_cost_override is null then null else round(budget.actual_labour_cost_override * 100)::bigint end,
  budget.notes,
  budget.labour_closed_at,
  budget.labour_closed_by,
  'project_budget',
  jsonb_build_object(
    'labour_invoice_job_started_on', budget.labour_invoice_job_started_on,
    'old_project_id', budget.companycam_project_id
  ),
  budget.inserted_at,
  budget.updated_at
from ranked_budgets budget
join v2.jobs job on job.id = budget.job_id;

with ranked_budgets as (
  select
    budget.*,
    map.job_id,
    row_number() over (
      partition by map.job_id
      order by budget.published_at, budget.revision, budget.id
    ) as canonical_version
  from public.project_labour_budgets budget
  join v2.job_map map on map.old_project_id = budget.companycam_project_id
)
insert into v2.job_budgets (
  id, job_id, quote_id, version, status, budget_minutes,
  calculated_minutes, instructions, source, metadata,
  created_at, updated_at
)
select
  v2.stable_uuid('budget', 'labour:' || budget.id::text),
  budget.job_id,
  job.accepted_quote_id,
  budget.canonical_version,
  case
    when budget.is_active then 'active'
    when exists (
      select 1 from public.project_labour_budgets newer
      where newer.companycam_project_id = budget.companycam_project_id
        and newer.revision > budget.revision
    ) then 'superseded'
    else 'closed'
  end,
  case when budget.budgeted_hours is null then null else round(budget.budgeted_hours * 60)::integer end,
  case when budget.calculated_hours is null then null else round(budget.calculated_hours * 60)::integer end,
  budget.instructions,
  'published_labour_budget',
  jsonb_build_object(
    'source_quote_id', budget.source_quote_id,
    'source_quote_name', budget.source_quote_name,
    'source_quote_updated_at', budget.source_quote_updated_at,
    'published_by', budget.published_by,
    'published_at', budget.published_at,
    'old_budget_id', budget.id,
    'old_budget_revision', budget.revision,
    'old_project_id', budget.companycam_project_id
  ),
  budget.inserted_at,
  budget.updated_at
from ranked_budgets budget
join v2.jobs job on job.id = budget.job_id;

insert into v2.time_entries (
  id, client_entry_id, employee_id, job_id, employee_email,
  employee_name, job_name, job_address, original_started_at,
  started_at, start_edited_at, ended_at, status,
  clock_in_latitude, clock_in_longitude, clock_out_latitude,
  clock_out_longitude, last_distance_meters, is_on_site,
  segments, adjustment_history, notes, approved_at, approved_by,
  created_at, updated_at
)
select
  entry.id,
  entry.client_entry_id,
  entry.user_id,
  map.job_id,
  entry.user_email,
  entry.user_name,
  entry.project_name,
  entry.project_address,
  entry.original_started_at,
  entry.started_at,
  entry.start_edited_at,
  entry.ended_at,
  case
    when entry.status = 'active' then 'active'
    when entry.status in ('deleted', 'void') then 'deleted'
    else 'completed'
  end,
  entry.clock_in_latitude,
  entry.clock_in_longitude,
  entry.clock_out_latitude,
  entry.clock_out_longitude,
  entry.last_distance_meters,
  entry.is_on_site,
  coalesce(entry.segments, '[]'::jsonb),
  coalesce(entry.adjustment_history, '[]'::jsonb),
  entry.notes,
  entry.approved_at,
  entry.approved_by,
  entry.inserted_at,
  entry.updated_at
from public.time_entries entry
left join v2.job_map map on map.old_project_id = entry.companycam_project_id;

insert into v2.time_entry_events (
  id, time_entry_id, client_entry_id, employee_id, event_type,
  captured_at, received_at, source, metadata
)
select
  event.id,
  event.time_entry_id,
  event.client_entry_id,
  event.user_id,
  event.event_type,
  event.captured_at,
  event.received_at,
  event.source,
  coalesce(event.metadata, '{}'::jsonb)
from public.time_entry_lifecycle_events event;

-- project_labour_tasks stored one row per budget revision. The progress row
-- is the stable task identity; all 94 historical rows are retained in
-- versions while only 35 current tasks remain operational.
with task_versions as (
  select
    task.progress_id,
    jsonb_agg(
      jsonb_build_object(
        'old_task_id', task.id,
        'old_budget_id', task.labour_budget_id,
        'budget_revision', task.budget_revision,
        'budgeted_hours', task.budgeted_hours,
        'calculated_hours', task.calculated_hours,
        'manual_budgeted_hours', task.manual_budgeted_hours,
        'title', task.title,
        'notes', task.notes,
        'status', task.status,
        'is_active', task.is_active,
        'metadata', task.metadata,
        'created_at', task.inserted_at,
        'updated_at', task.updated_at
      ) order by task.budget_revision, task.inserted_at, task.id
    ) as versions
  from public.project_labour_tasks task
  group by task.progress_id
), current_tasks as (
  select distinct on (task.progress_id) task.*
  from public.project_labour_tasks task
  order by task.progress_id, task.is_active desc, task.budget_revision desc, task.updated_at desc, task.id
)
insert into v2.job_tasks (
  id, job_id, budget_id, source_kind, source_item_id, title, notes,
  budget_minutes, calculated_minutes, sort_order, status,
  completed_by, completed_at, versions, metadata, created_at, updated_at
)
select
  task.progress_id,
  map.job_id,
  v2.stable_uuid('budget', 'labour:' || task.labour_budget_id::text),
  task.source_kind,
  task.source_item_id,
  task.title,
  task.notes,
  case
    when coalesce(task.manual_budgeted_hours, task.budgeted_hours) is null then null
    else round(coalesce(task.manual_budgeted_hours, task.budgeted_hours) * 60)::integer
  end,
  case when task.calculated_hours is null then null else round(task.calculated_hours * 60)::integer end,
  task.sort_order,
  case
    when progress.status = 'completed' then 'completed'
    when progress.status = 'in_progress' then 'in_progress'
    when progress.status in ('cancelled', 'canceled') then 'cancelled'
    else 'pending'
  end,
  progress.completed_by,
  progress.completed_at,
  history.versions,
  coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
    'old_current_task_id', task.id,
    'budget_revision', task.budget_revision
  ),
  progress.inserted_at,
  greatest(progress.updated_at, task.updated_at)
from current_tasks task
join task_versions history on history.progress_id = task.progress_id
join public.project_labour_task_progress progress on progress.id = task.progress_id
join v2.job_map map on map.old_project_id = task.companycam_project_id;

insert into v2.job_task_time_entries (
  id, client_entry_id, task_id, employee_id, time_entry_id,
  started_at, ended_at, status, notes, metadata, created_at, updated_at
)
select
  task_time.id,
  task_time.client_entry_id,
  task_time.progress_id,
  task_time.user_id,
  task_time.time_entry_id,
  task_time.started_at,
  task_time.ended_at,
  case
    when task_time.status = 'active' then 'active'
    when task_time.status in ('deleted', 'void') then 'deleted'
    else 'completed'
  end,
  task_time.notes,
  coalesce(task_time.metadata, '{}'::jsonb) || jsonb_build_object('old_task_id', task_time.task_id),
  task_time.inserted_at,
  task_time.updated_at
from public.project_labour_task_time_entries task_time;

insert into v2.job_issues (
  id, client_id, job_id, task_id, employee_id, issue_type,
  reason, note, minutes_over, metadata, created_at
)
select
  issue.id,
  issue.client_id,
  map.job_id,
  null,
  issue.user_id,
  'job_over_budget',
  issue.reason,
  issue.note,
  case when issue.hours_over is null then null else round(issue.hours_over * 60)::integer end,
  jsonb_build_object('old_project_id', issue.companycam_project_id),
  issue.created_at
from public.project_over_budget_reasons issue
join v2.job_map map on map.old_project_id = issue.companycam_project_id
union all
select
  issue.id,
  issue.client_id,
  task.job_id,
  source_task.progress_id,
  issue.user_id,
  'task_over_budget',
  issue.reason,
  issue.note,
  case when issue.hours_over is null then null else round(issue.hours_over * 60)::integer end,
  jsonb_build_object('budget_revision', issue.budget_revision, 'old_task_id', issue.task_id),
  issue.created_at
from public.project_labour_task_over_budget_reasons issue
join public.project_labour_tasks source_task on source_task.id = issue.task_id
join v2.job_tasks task on task.id = source_task.progress_id;

insert into v2.push_tokens (
  id, employee_id, expo_push_token, platform, device_push_token,
  app_version, is_active, last_registered_at, created_at, updated_at
)
select
  token.id,
  token.user_id,
  token.expo_push_token,
  token.platform,
  token.device_push_token,
  token.app_version,
  token.is_active,
  token.last_registered_at,
  token.inserted_at,
  token.updated_at
from public.employee_push_tokens token;

insert into v2.employee_location_points (
  id, client_event_id, employee_id, time_entry_id, client_entry_id,
  job_id, latitude, longitude, accuracy_meters, speed_mps,
  heading_degrees, is_mocked, tracking_mode, event_type,
  distance_from_job_meters, is_on_site, captured_at, received_at, created_at
)
select
  point.id,
  point.client_event_id,
  point.user_id,
  point.time_entry_id,
  point.client_entry_id,
  map.job_id,
  point.latitude,
  point.longitude,
  point.accuracy_meters,
  point.speed_mps,
  point.heading_degrees,
  point.is_mocked,
  point.tracking_mode,
  point.event_type,
  point.distance_from_project_meters,
  point.is_on_site,
  point.captured_at,
  point.received_at,
  point.inserted_at
from public.employee_location_points point
left join v2.job_map map on map.old_project_id = point.companycam_project_id;

insert into v2.employee_tracking_status (
  employee_id, employee_email, employee_name, time_entry_id,
  client_entry_id, job_id, job_name, job_address, latitude,
  longitude, accuracy_meters, last_location_at, last_sync_at,
  tracking_mode, task_status, permission_foreground,
  permission_background, platform, app_version, last_error_code,
  metadata, created_at, updated_at
)
select
  tracking.user_id,
  tracking.user_email,
  tracking.user_name,
  tracking.time_entry_id,
  tracking.client_entry_id,
  map.job_id,
  tracking.project_name,
  tracking.project_address,
  tracking.latitude,
  tracking.longitude,
  tracking.accuracy_meters,
  tracking.last_location_at,
  tracking.last_sync_at,
  tracking.tracking_mode,
  tracking.task_status,
  tracking.permission_foreground,
  tracking.permission_background,
  tracking.platform,
  tracking.app_version,
  tracking.last_error_code,
  coalesce(tracking.metadata, '{}'::jsonb),
  tracking.inserted_at,
  tracking.updated_at
from public.employee_tracking_status tracking
left join v2.job_map map on map.old_project_id = tracking.companycam_project_id;

insert into v2.location_alerts (
  id, employee_id, time_entry_id, stale_since, last_notified_at,
  resolved_at, created_at, updated_at
)
select
  alert.id,
  alert.user_id,
  alert.time_entry_id,
  alert.stale_since,
  alert.last_notified_at,
  alert.resolved_at,
  alert.inserted_at,
  alert.updated_at
from public.location_tracking_alerts alert;

-- Accounting identities and documents ------------------------------------

insert into v2.contact_map (source_type, source_key, contact_id)
select
  'contractor',
  contractor.id::text,
  v2.stable_uuid('contact', 'contractor:' || contractor.id::text)
from public.labour_contractors contractor;

insert into v2.contacts (
  id, kind, name, metadata, created_at, updated_at
)
select
  mapping.contact_id,
  'contractor',
  contractor.supplier_name,
  jsonb_build_object(
    'old_contractor_id', contractor.id,
    'worker_user_id', contractor.worker_user_id,
    'is_active', contractor.is_active,
    'notes', contractor.notes,
    'tax_registrations', coalesce((
      select jsonb_agg(to_jsonb(registration) order by registration.effective_from, registration.id)
      from public.labour_contractor_tax_registrations registration
      where registration.contractor_id = contractor.id
    ), '[]'::jsonb)
  ),
  contractor.inserted_at,
  contractor.updated_at
from public.labour_contractors contractor
join v2.contact_map mapping
  on mapping.source_type = 'contractor'
 and mapping.source_key = contractor.id::text;

insert into v2.contact_map (source_type, source_key, contact_id)
select
  'customer_invoice',
  invoice.id::text,
  coalesce(
    project_job.contact_id,
    proposal_job.contact_id,
    exact_contact.contact_id,
    v2.stable_uuid('contact', 'customer-invoice:' || invoice.id::text)
  )
from public.customer_invoices invoice
left join lateral (
  select job.contact_id
  from v2.job_map map
  join v2.jobs job on job.id = map.job_id
  where map.old_project_id = invoice.companycam_project_id
  limit 1
) project_job on true
left join lateral (
  select job.contact_id
  from v2.quotes quote
  join v2.jobs job on job.accepted_quote_id = quote.id
  where quote.dripjobs_proposal_id = coalesce(invoice.external_proposal_id, invoice.external_proposal_uuid)
  limit 1
) proposal_job on true
left join lateral (
  select (array_agg(contact.id order by contact.id))[1] as contact_id
  from v2.contacts contact
  where contact.normalized_email = nullif(lower(btrim(invoice.customer_email)), '')
    and contact.normalized_phone = nullif(
      regexp_replace(coalesce(invoice.customer_phone, ''), '[^0-9]+', '', 'g'),
      ''
    )
  having count(*) = 1
) exact_contact on true;

insert into v2.contacts (
  id, kind, name, email, phone, normalized_email, normalized_phone,
  metadata, created_at, updated_at
)
select distinct on (mapping.contact_id)
  mapping.contact_id,
  'customer',
  coalesce(nullif(btrim(invoice.customer_name), ''), 'Unknown customer'),
  nullif(lower(btrim(invoice.customer_email)), ''),
  nullif(btrim(invoice.customer_phone), ''),
  nullif(lower(btrim(invoice.customer_email)), ''),
  nullif(regexp_replace(coalesce(invoice.customer_phone, ''), '[^0-9]+', '', 'g'), ''),
  jsonb_build_object('source', 'customer_invoice', 'billing_address', invoice.billing_address),
  invoice.inserted_at,
  invoice.updated_at
from public.customer_invoices invoice
join v2.contact_map mapping
  on mapping.source_type = 'customer_invoice'
 and mapping.source_key = invoice.id::text
where not exists (select 1 from v2.contacts contact where contact.id = mapping.contact_id)
order by mapping.contact_id, invoice.updated_at desc, invoice.id;

with supplier_names as (
  select supplier_name as name, inserted_at, updated_at
  from public.material_invoices
  where nullif(btrim(supplier_name), '') is not null
  union all
  select supplier_name, inserted_at, updated_at
  from public.project_labour_expenses
  where nullif(btrim(supplier_name), '') is not null
), suppliers as (
  select
    lower(btrim(name)) as source_key,
    max(name) as name,
    min(inserted_at) as created_at,
    max(updated_at) as updated_at
  from supplier_names
  group by lower(btrim(name))
)
insert into v2.contact_map (source_type, source_key, contact_id)
select
  'supplier',
  supplier.source_key,
  v2.stable_uuid('contact', 'supplier:' || supplier.source_key)
from suppliers supplier;

with supplier_names as (
  select supplier_name as name, inserted_at, updated_at
  from public.material_invoices
  where nullif(btrim(supplier_name), '') is not null
  union all
  select supplier_name, inserted_at, updated_at
  from public.project_labour_expenses
  where nullif(btrim(supplier_name), '') is not null
), suppliers as (
  select
    lower(btrim(name)) as source_key,
    max(name) as name,
    min(inserted_at) as created_at,
    max(updated_at) as updated_at
  from supplier_names
  group by lower(btrim(name))
)
insert into v2.contacts (id, kind, name, metadata, created_at, updated_at)
select
  mapping.contact_id,
  'supplier',
  supplier.name,
  jsonb_build_object('source', 'accounting_supplier'),
  supplier.created_at,
  supplier.updated_at
from suppliers supplier
join v2.contact_map mapping
  on mapping.source_type = 'supplier'
 and mapping.source_key = supplier.source_key
where not exists (select 1 from v2.contacts contact where contact.id = mapping.contact_id);

insert into v2.accounts (
  id, slug, institution, name, account_type, last_four, currency,
  is_active, current_balance_cents, available_balance_cents,
  credit_limit_cents, balance_as_of, external_provider,
  external_account_id, created_at, updated_at
)
select
  account.id,
  account.slug,
  account.institution,
  account.name,
  account.account_type,
  account.last_four,
  account.currency,
  account.is_active,
  case when account.current_balance is null then null else round(account.current_balance * 100)::bigint end,
  case when account.available_balance is null then null else round(account.available_balance * 100)::bigint end,
  case when account.credit_limit is null then null else round(account.credit_limit * 100)::bigint end,
  account.balance_as_of,
  account.external_provider,
  account.external_account_id,
  account.inserted_at,
  account.updated_at
from public.financial_accounts account;

insert into v2.document_map (source_type, old_id, document_id)
select 'financial_import', source_import.id, v2.stable_uuid('document', 'financial-import:' || source_import.id::text)
from public.financial_imports source_import
union all
select 'customer_invoice_document', document.id, v2.stable_uuid('document', 'customer:' || document.id::text)
from public.customer_invoice_documents document
union all
select 'labour_invoice_document', invoice.id, v2.stable_uuid('document', 'labour:' || invoice.id::text)
from public.labour_invoices invoice
union all
select 'material_invoice_document', document.id, v2.stable_uuid('document', 'material:' || document.id::text)
from public.material_invoice_documents document;

insert into v2.documents (
  id, kind, original_filename, mime_type, content_sha256,
  captured_at, metadata, created_at
)
select
  mapping.document_id,
  source_import.source_kind,
  source_import.original_filename,
  source_import.mime_type,
  source_import.content_sha256,
  source_import.imported_at,
  coalesce(source_import.metadata, '{}'::jsonb) || jsonb_build_object(
    'source_email_thread_id', source_import.source_email_thread_id,
    'source_message_id', source_import.source_message_id,
    'account_id', source_import.account_id,
    'period_start', source_import.period_start,
    'period_end', source_import.period_end,
    'row_count', source_import.row_count
  ),
  source_import.imported_at
from public.financial_imports source_import
join v2.document_map mapping
  on mapping.source_type = 'financial_import'
 and mapping.old_id = source_import.id
union all
select
  mapping.document_id,
  document.document_kind,
  document.original_filename,
  document.content_type,
  document.content_sha256,
  document.captured_at,
  jsonb_build_object('old_customer_invoice_id', document.customer_invoice_id),
  document.inserted_at
from public.customer_invoice_documents document
join v2.document_map mapping
  on mapping.source_type = 'customer_invoice_document'
 and mapping.old_id = document.id
union all
select
  mapping.document_id,
  coalesce(invoice.document_type, 'labour_invoice'),
  invoice.original_filename,
  invoice.mime_type,
  invoice.content_sha256,
  invoice.inserted_at,
  jsonb_build_object(
    'source_date', invoice.source_date,
    'source_label', invoice.source_label,
    'duplicate_group_id', invoice.duplicate_group_id,
    'duplicate_group_size', invoice.duplicate_group_size,
    'supporting_invoice_reference', invoice.supporting_invoice_reference,
    'text_excerpt', invoice.text_excerpt
  ),
  invoice.inserted_at
from public.labour_invoices invoice
join v2.document_map mapping
  on mapping.source_type = 'labour_invoice_document'
 and mapping.old_id = invoice.id
union all
select
  mapping.document_id,
  'material_invoice',
  document.original_filename,
  document.mime_type,
  document.content_sha256,
  document.captured_at,
  jsonb_build_object(
    'source_system', document.source_system,
    'external_message_id', document.external_message_id,
    'source_reference', document.source_reference,
    'document_date', document.document_date,
    'page_count', document.page_count,
    'extracted_text', document.extracted_text,
    'source_payload', document.source_payload
  ),
  document.inserted_at
from public.material_invoice_documents document
join v2.document_map mapping
  on mapping.source_type = 'material_invoice_document'
 and mapping.old_id = document.id;

update v2.documents target
set
  size_bytes = source.size_bytes,
  storage_bucket = source.storage_bucket,
  storage_path = source.storage_path,
  source_url = source.source_url
from public.customer_invoice_documents source
join v2.document_map mapping
  on mapping.source_type = 'customer_invoice_document'
 and mapping.old_id = source.id
where target.id = mapping.document_id;

update v2.documents target
set
  size_bytes = source.file_size,
  storage_bucket = source.storage_bucket,
  storage_path = source.storage_path
from public.labour_invoices source
join v2.document_map mapping
  on mapping.source_type = 'labour_invoice_document'
 and mapping.old_id = source.id
where target.id = mapping.document_id;

update v2.documents target
set
  size_bytes = source.file_size,
  storage_bucket = source.storage_bucket,
  storage_path = source.storage_path
from public.material_invoice_documents source
join v2.document_map mapping
  on mapping.source_type = 'material_invoice_document'
 and mapping.old_id = source.id
where target.id = mapping.document_id;

insert into v2.transactions (
  id, account_id, import_document_id, source_key, posted_on,
  transaction_on, description, counterparty, amount_cents,
  tax_cents, net_cents, currency, transaction_type, category,
  is_transfer, review_status, running_balance_cents, notes,
  metadata, created_at, updated_at
)
select
  source_transaction.id,
  source_transaction.account_id,
  mapping.document_id,
  source_transaction.source_key,
  source_transaction.posted_on,
  source_transaction.transaction_on,
  source_transaction.description,
  source_transaction.counterparty,
  round(source_transaction.amount * 100)::bigint,
  round(coalesce(source_transaction.tax_amount, 0) * 100)::bigint,
  case when source_transaction.net_amount is null then null else round(source_transaction.net_amount * 100)::bigint end,
  source_transaction.currency,
  source_transaction.transaction_type,
  source_transaction.category,
  source_transaction.is_transfer,
  source_transaction.review_status,
  case when source_transaction.running_balance is null then null else round(source_transaction.running_balance * 100)::bigint end,
  source_transaction.notes,
  coalesce(source_transaction.source_data, '{}'::jsonb),
  source_transaction.inserted_at,
  source_transaction.updated_at
from public.financial_transactions source_transaction
join v2.document_map mapping
  on mapping.source_type = 'financial_import'
 and mapping.old_id = source_transaction.import_id;

-- Unified invoices and lines ----------------------------------------------

insert into v2.invoice_map (source_type, old_id, invoice_id)
select 'customer', invoice.id, v2.stable_uuid('invoice', 'customer:' || invoice.id::text)
from public.customer_invoices invoice
union all
select 'labour', invoice.id, v2.stable_uuid('invoice', 'labour:' || invoice.id::text)
from public.labour_invoices invoice
union all
select 'material', invoice.id, v2.stable_uuid('invoice', 'material:' || invoice.id::text)
from public.material_invoices invoice
union all
select 'direct_labour', expense.id, v2.stable_uuid('invoice', 'direct-labour:' || expense.id::text)
from public.project_labour_expenses expense;

insert into v2.invoices (
  id, contact_id, direction, category, source_system, external_id,
  invoice_number, status, issued_on, due_on, currency,
  subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents,
  metadata, created_at, updated_at
)
select
  invoice_mapping.invoice_id,
  contact_mapping.contact_id,
  'receivable',
  'customer',
  invoice.source_system,
  invoice.external_invoice_id,
  invoice.invoice_number,
  coalesce(invoice.visible_status, invoice.source_status, invoice.accounting_status, 'unknown'),
  invoice.invoice_date,
  invoice.due_date,
  coalesce(invoice.currency, 'CAD'),
  round(coalesce(invoice.subtotal, 0) * 100)::bigint,
  round(coalesce(invoice.tax_amount, 0) * 100)::bigint,
  round(coalesce(invoice.total_amount, 0) * 100)::bigint,
  round(coalesce(invoice.source_paid_amount, 0) * 100)::bigint,
  round(coalesce(invoice.source_balance, invoice.total_amount - coalesce(invoice.source_paid_amount, 0), 0) * 100)::bigint,
  jsonb_build_object(
    'companycam_project_id', invoice.companycam_project_id,
    'external_proposal_id', invoice.external_proposal_id,
    'external_proposal_uuid', invoice.external_proposal_uuid,
    'customer_name', invoice.customer_name,
    'customer_email', invoice.customer_email,
    'customer_phone', invoice.customer_phone,
    'billing_address', invoice.billing_address,
    'job_name', invoice.job_name,
    'job_address', invoice.job_address,
    'salesperson', invoice.salesperson,
    'source_url', invoice.source_url,
    'is_archived_job', invoice.is_archived_job,
    'source_status', invoice.source_status,
    'accounting_status', invoice.accounting_status,
    'superseded_by_invoice_id', invoice.superseded_by_invoice_id,
    'void_reason', invoice.void_reason,
    'voided_at', invoice.voided_at,
    'source_payload', invoice.source_payload
  ),
  invoice.inserted_at,
  invoice.updated_at
from public.customer_invoices invoice
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'customer'
 and invoice_mapping.old_id = invoice.id
left join v2.contact_map contact_mapping
  on contact_mapping.source_type = 'customer_invoice'
 and contact_mapping.source_key = invoice.id::text
union all
select
  invoice_mapping.invoice_id,
  contractor_mapping.contact_id,
  'payable',
  'labour',
  'labour_import',
  invoice.id::text,
  invoice.invoice_number,
  coalesce(invoice.match_status, 'imported'),
  coalesce(invoice.invoice_date, invoice.source_date),
  null,
  coalesce(invoice.currency, 'CAD'),
  round(coalesce(invoice.amount_before_tax, 0) * 100)::bigint,
  round(coalesce(invoice.tax_amount, 0) * 100)::bigint,
  round(coalesce(invoice.amount_paid, invoice.amount_before_tax + coalesce(invoice.tax_amount, 0), 0) * 100)::bigint,
  round(coalesce(invoice.amount_paid, 0) * 100)::bigint,
  0,
  jsonb_build_object(
    'supplier_name', invoice.supplier_name,
    'payment_basis', invoice.payment_basis,
    'document_type', invoice.document_type,
    'source_label', invoice.source_label,
    'duplicate_group_id', invoice.duplicate_group_id,
    'duplicate_group_size', invoice.duplicate_group_size,
    'supporting_invoice_reference', invoice.supporting_invoice_reference
  ),
  invoice.inserted_at,
  invoice.updated_at
from public.labour_invoices invoice
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'labour'
 and invoice_mapping.old_id = invoice.id
left join v2.contact_map contractor_mapping
  on contractor_mapping.source_type = 'contractor'
 and contractor_mapping.source_key = invoice.contractor_id::text
union all
select
  invoice_mapping.invoice_id,
  supplier_mapping.contact_id,
  'payable',
  'material',
  invoice.source_system,
  invoice.external_invoice_id,
  invoice.invoice_number,
  coalesce(invoice.extraction_status, 'imported'),
  invoice.invoice_date,
  invoice.due_on,
  coalesce(invoice.currency, 'CAD'),
  round(coalesce(invoice.amount_before_tax, 0) * 100)::bigint,
  round(coalesce(invoice.tax_amount, 0) * 100)::bigint,
  round(coalesce(invoice.total_amount, 0) * 100)::bigint,
  round(coalesce((
    select sum(allocation.allocated_amount)
    from public.material_payment_allocations allocation
    where allocation.material_invoice_id = invoice.id
      and allocation.reversed_at is null
  ), 0) * 100)::bigint,
  round((
    coalesce(invoice.total_amount, 0) - coalesce((
      select sum(allocation.allocated_amount)
      from public.material_payment_allocations allocation
      where allocation.material_invoice_id = invoice.id
        and allocation.reversed_at is null
    ), 0)
  ) * 100)::bigint,
  jsonb_build_object(
    'document_id', invoice.document_id,
    'invoice_type', invoice.invoice_type,
    'account_number', invoice.account_number,
    'job_account', invoice.job_account,
    'invoice_time', invoice.invoice_time,
    'po_number', invoice.po_number,
    'order_number', invoice.order_number,
    'store_number', invoice.store_number,
    'store_address', invoice.store_address,
    'received_by', invoice.received_by,
    'source_page_start', invoice.source_page_start,
    'source_page_end', invoice.source_page_end,
    'source_text', invoice.source_text,
    'source_payload', invoice.source_payload
  ),
  invoice.inserted_at,
  invoice.updated_at
from public.material_invoices invoice
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'material'
 and invoice_mapping.old_id = invoice.id
left join v2.contact_map supplier_mapping
  on supplier_mapping.source_type = 'supplier'
 and supplier_mapping.source_key = lower(btrim(invoice.supplier_name))
union all
select
  invoice_mapping.invoice_id,
  supplier_mapping.contact_id,
  'payable',
  'labour',
  'direct_labour_expense',
  expense.id::text,
  coalesce(nullif(expense.invoice_number, ''), 'direct-' || left(expense.id::text, 8)),
  'recorded',
  expense.invoice_date,
  null,
  'CAD',
  round(coalesce(expense.amount_before_tax, 0) * 100)::bigint,
  round(coalesce(expense.tax_amount, 0) * 100)::bigint,
  round((coalesce(expense.amount_before_tax, 0) + coalesce(expense.tax_amount, 0)) * 100)::bigint,
  round((coalesce(expense.amount_before_tax, 0) + coalesce(expense.tax_amount, 0)) * 100)::bigint,
  0,
  jsonb_build_object(
    'worker_user_id', expense.worker_user_id,
    'worker_name', expense.worker_name,
    'supplier_name', expense.supplier_name,
    'notes', expense.notes,
    'old_project_id', expense.companycam_project_id
  ),
  expense.inserted_at,
  expense.updated_at
from public.project_labour_expenses expense
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'direct_labour'
 and invoice_mapping.old_id = expense.id
left join v2.contact_map supplier_mapping
  on supplier_mapping.source_type = 'supplier'
 and supplier_mapping.source_key = lower(btrim(expense.supplier_name));

insert into v2.invoice_line_map (source_type, old_id, invoice_line_id)
select 'customer', item.id, v2.stable_uuid('invoice-line', 'customer:' || item.id::text)
from public.customer_invoice_items item
union all
select 'labour', line.id, v2.stable_uuid('invoice-line', 'labour:' || line.id::text)
from public.labour_invoice_lines line
union all
select 'material', line.id, v2.stable_uuid('invoice-line', 'material:' || line.id::text)
from public.material_invoice_lines line
union all
select 'direct_labour', expense.id, v2.stable_uuid('invoice-line', 'direct-labour:' || expense.id::text)
from public.project_labour_expenses expense;

insert into v2.invoice_lines (
  id, invoice_id, line_number, description, quantity, unit,
  unit_price_cents, subtotal_cents, tax_cents, total_cents,
  source_kind, metadata, created_at, updated_at
)
select
  line_mapping.invoice_line_id,
  invoice_mapping.invoice_id,
  item.line_number,
  item.description,
  item.quantity,
  null,
  case when item.unit_price is null then null else round(item.unit_price * 100)::bigint end,
  round(coalesce(item.amount_before_tax, 0) * 100)::bigint,
  round(coalesce(item.tax_amount, 0) * 100)::bigint,
  round(coalesce(item.total_amount, item.amount_before_tax + coalesce(item.tax_amount, 0), 0) * 100)::bigint,
  item.source_system,
  jsonb_build_object(
    'external_item_id', item.external_item_id,
    'source_text', item.source_text,
    'source_url', item.source_url,
    'source_payload', item.source_payload
  ),
  item.inserted_at,
  item.updated_at
from public.customer_invoice_items item
join v2.invoice_line_map line_mapping
  on line_mapping.source_type = 'customer'
 and line_mapping.old_id = item.id
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'customer'
 and invoice_mapping.old_id = item.customer_invoice_id
union all
select
  line_mapping.invoice_line_id,
  invoice_mapping.invoice_id,
  line.line_number,
  line.description,
  coalesce(line.quantity, line.quantity_hours),
  coalesce(line.unit, case when line.quantity_hours is not null then 'hour' end),
  case when coalesce(line.unit_price, line.hourly_rate) is null then null
       else round(coalesce(line.unit_price, line.hourly_rate) * 100)::bigint end,
  round(coalesce(line.amount_before_tax, 0) * 100)::bigint,
  round(coalesce(line.tax_amount, 0) * 100)::bigint,
  round((coalesce(line.amount_before_tax, 0) + coalesce(line.tax_amount, 0)) * 100)::bigint,
  line.source_kind,
  jsonb_build_object(
    'entry_type', line.entry_type,
    'is_adjustment', line.is_adjustment,
    'source_text', line.source_text,
    'source_reference', line.source_reference,
    'needs_review', line.needs_review
  ),
  line.inserted_at,
  line.updated_at
from public.labour_invoice_lines line
join v2.invoice_line_map line_mapping
  on line_mapping.source_type = 'labour'
 and line_mapping.old_id = line.id
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'labour'
 and invoice_mapping.old_id = line.invoice_id
union all
select
  line_mapping.invoice_line_id,
  invoice_mapping.invoice_id,
  line.line_number,
  line.description,
  line.quantity,
  line.size,
  case when line.unit_price is null then null else round(line.unit_price * 100)::bigint end,
  round(coalesce(line.amount_before_tax, 0) * 100)::bigint,
  round(coalesce(line.tax_amount, 0) * 100)::bigint,
  round(coalesce(line.total_amount, line.amount_before_tax + coalesce(line.tax_amount, 0), 0) * 100)::bigint,
  line.line_type,
  jsonb_build_object(
    'sales_number', line.sales_number,
    'product_code', line.product_code,
    'color_code', line.color_code,
    'color_name', line.color_name,
    'gross_amount', line.gross_amount,
    'discount_amount', line.discount_amount,
    'source_text', line.source_text,
    'source_payload', line.source_payload,
    'needs_review', line.needs_review,
    'overhead_allocations', coalesce((
      select jsonb_agg(to_jsonb(allocation) order by allocation.inserted_at, allocation.id)
      from public.material_invoice_line_allocations allocation
      where allocation.material_invoice_line_id = line.id
        and allocation.companycam_project_id is null
    ), '[]'::jsonb)
  ),
  line.inserted_at,
  line.updated_at
from public.material_invoice_lines line
join v2.invoice_line_map line_mapping
  on line_mapping.source_type = 'material'
 and line_mapping.old_id = line.id
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'material'
 and invoice_mapping.old_id = line.material_invoice_id
union all
select
  line_mapping.invoice_line_id,
  invoice_mapping.invoice_id,
  1,
  coalesce(expense.notes, expense.worker_name, expense.supplier_name, 'Direct labour expense'),
  1,
  'expense',
  round(coalesce(expense.amount_before_tax, 0) * 100)::bigint,
  round(coalesce(expense.amount_before_tax, 0) * 100)::bigint,
  round(coalesce(expense.tax_amount, 0) * 100)::bigint,
  round((coalesce(expense.amount_before_tax, 0) + coalesce(expense.tax_amount, 0)) * 100)::bigint,
  'direct_labour_expense',
  jsonb_build_object('worker_user_id', expense.worker_user_id, 'worker_name', expense.worker_name),
  expense.inserted_at,
  expense.updated_at
from public.project_labour_expenses expense
join v2.invoice_line_map line_mapping
  on line_mapping.source_type = 'direct_labour'
 and line_mapping.old_id = expense.id
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'direct_labour'
 and invoice_mapping.old_id = expense.id;

-- Invoice/job costing, payments, credits, and source evidence -------------

insert into v2.invoice_job_allocations (
  id, invoice_id, job_id, subtotal_cents, tax_cents, total_cents,
  allocation_method, needs_review, metadata, created_at, updated_at
)
select
  v2.stable_uuid('invoice-job-allocation', 'customer:' || invoice.id::text),
  invoice_mapping.invoice_id,
  coalesce(project_job.job_id, proposal_job.id),
  round(coalesce(invoice.subtotal, 0) * 100)::bigint,
  round(coalesce(invoice.tax_amount, 0) * 100)::bigint,
  round(coalesce(invoice.total_amount, 0) * 100)::bigint,
  'source_invoice_job',
  false,
  jsonb_build_object(
    'old_project_id', invoice.companycam_project_id,
    'external_proposal_id', coalesce(invoice.external_proposal_id, invoice.external_proposal_uuid)
  ),
  invoice.inserted_at,
  invoice.updated_at
from public.customer_invoices invoice
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'customer'
 and invoice_mapping.old_id = invoice.id
left join v2.job_map project_job on project_job.old_project_id = invoice.companycam_project_id
left join v2.quotes quote
  on quote.dripjobs_proposal_id = coalesce(invoice.external_proposal_id, invoice.external_proposal_uuid)
left join v2.jobs proposal_job on proposal_job.accepted_quote_id = quote.id
where coalesce(project_job.job_id, proposal_job.id) is not null;

insert into v2.invoice_job_allocations (
  id, invoice_id, job_id, subtotal_cents, total_cents,
  allocation_method, confidence, needs_review, metadata,
  created_at, updated_at
)
select
  v2.stable_uuid(
    'invoice-job-allocation',
    'labour-invoice:' || project.invoice_id::text || ':' || project.companycam_project_id
  ),
  invoice_mapping.invoice_id,
  map.job_id,
  round(coalesce(project.allocated_amount, 0) * 100)::bigint,
  round(coalesce(project.allocated_amount, 0) * 100)::bigint,
  array_to_string(project.match_method, ','),
  case when project.match_score is null then null else project.match_score::numeric / 100 end,
  project.needs_review,
  jsonb_build_object('is_primary', project.is_primary, 'old_project_id', project.companycam_project_id),
  project.inserted_at,
  project.updated_at
from public.labour_invoice_projects project
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'labour'
 and invoice_mapping.old_id = project.invoice_id
join v2.job_map map on map.old_project_id = project.companycam_project_id;

insert into v2.invoice_job_allocations (
  id, invoice_id, invoice_line_id, job_id, subtotal_cents,
  total_cents, quantity, minutes, allocation_method,
  needs_review, metadata, created_at, updated_at
)
select
  v2.stable_uuid(
    'invoice-job-allocation',
    'labour-line:' || allocation.invoice_line_id::text || ':' || allocation.companycam_project_id
  ),
  invoice_mapping.invoice_id,
  line_mapping.invoice_line_id,
  coalesce(direct_map.job_id, linked_job.job_id),
  round(coalesce(allocation.allocated_amount, 0) * 100)::bigint,
  round(coalesce(allocation.allocated_amount, 0) * 100)::bigint,
  allocation.allocated_hours,
  case when allocation.allocated_hours is null then null else round(allocation.allocated_hours * 60)::integer end,
  array_to_string(allocation.allocation_method, ','),
  allocation.needs_review,
  jsonb_build_object(
    'old_project_id', allocation.companycam_project_id,
    'job_cost_evidence', cost_link.evidence,
    'job_cost_match_method', cost_link.match_method
  ),
  allocation.inserted_at,
  allocation.updated_at
from public.labour_invoice_line_allocations allocation
join public.labour_invoice_lines source_line on source_line.id = allocation.invoice_line_id
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'labour'
 and invoice_mapping.old_id = source_line.invoice_id
join v2.invoice_line_map line_mapping
  on line_mapping.source_type = 'labour'
 and line_mapping.old_id = allocation.invoice_line_id
left join v2.job_map direct_map on direct_map.old_project_id = allocation.companycam_project_id
left join lateral (
  select link.*
  from public.job_cost_allocation_links link
  where link.labour_invoice_line_id = allocation.invoice_line_id
  order by link.confirmed_at desc nulls last, link.updated_at desc, link.id
  limit 1
) cost_link on true
left join lateral (
  select job.id as job_id
  from v2.quotes quote
  join v2.jobs job on job.accepted_quote_id = quote.id
  where quote.dripjobs_proposal_id = cost_link.job_proposal_id
  limit 1
) linked_job on true
where coalesce(direct_map.job_id, linked_job.job_id) is not null;

insert into v2.invoice_job_allocations (
  id, invoice_id, invoice_line_id, job_id, subtotal_cents,
  tax_cents, total_cents, quantity, allocation_method,
  confidence, needs_review, metadata, created_at, updated_at
)
select
  v2.stable_uuid('invoice-job-allocation', 'material-line:' || allocation.id::text),
  invoice_mapping.invoice_id,
  line_mapping.invoice_line_id,
  coalesce(direct_map.job_id, linked_job.job_id),
  round(coalesce(allocation.allocated_before_tax, 0) * 100)::bigint,
  round(coalesce(allocation.allocated_tax, 0) * 100)::bigint,
  round(coalesce(allocation.allocated_total, 0) * 100)::bigint,
  allocation.allocated_quantity,
  allocation.allocation_method,
  allocation.confidence,
  allocation.needs_review,
  jsonb_build_object(
    'allocation_scope', allocation.allocation_scope,
    'overhead_category', allocation.overhead_category,
    'old_project_id', allocation.companycam_project_id,
    'evidence_reference', allocation.evidence_reference,
    'source_payload', allocation.source_payload,
    'reversed_at', allocation.reversed_at,
    'reversal_reason', allocation.reversal_reason,
    'job_cost_evidence', cost_link.evidence,
    'job_cost_match_method', cost_link.match_method
  ),
  allocation.inserted_at,
  allocation.updated_at
from public.material_invoice_line_allocations allocation
join public.material_invoice_lines source_line on source_line.id = allocation.material_invoice_line_id
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'material'
 and invoice_mapping.old_id = source_line.material_invoice_id
join v2.invoice_line_map line_mapping
  on line_mapping.source_type = 'material'
 and line_mapping.old_id = allocation.material_invoice_line_id
left join v2.job_map direct_map on direct_map.old_project_id = allocation.companycam_project_id
left join lateral (
  select link.*
  from public.job_cost_allocation_links link
  where link.material_line_allocation_id = allocation.id
  order by link.confirmed_at desc nulls last, link.updated_at desc, link.id
  limit 1
) cost_link on true
left join lateral (
  select job.id as job_id
  from v2.quotes quote
  join v2.jobs job on job.accepted_quote_id = quote.id
  where quote.dripjobs_proposal_id = cost_link.job_proposal_id
  limit 1
) linked_job on true
where coalesce(direct_map.job_id, linked_job.job_id) is not null;

insert into v2.invoice_job_allocations (
  id, invoice_id, invoice_line_id, job_id, subtotal_cents,
  tax_cents, total_cents, allocation_method, metadata,
  created_at, updated_at
)
select
  v2.stable_uuid('invoice-job-allocation', 'direct-labour:' || expense.id::text),
  invoice_mapping.invoice_id,
  line_mapping.invoice_line_id,
  map.job_id,
  round(coalesce(expense.amount_before_tax, 0) * 100)::bigint,
  round(coalesce(expense.tax_amount, 0) * 100)::bigint,
  round((coalesce(expense.amount_before_tax, 0) + coalesce(expense.tax_amount, 0)) * 100)::bigint,
  'direct_project_expense',
  jsonb_build_object('old_project_id', expense.companycam_project_id),
  expense.inserted_at,
  expense.updated_at
from public.project_labour_expenses expense
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'direct_labour'
 and invoice_mapping.old_id = expense.id
join v2.invoice_line_map line_mapping
  on line_mapping.source_type = 'direct_labour'
 and line_mapping.old_id = expense.id
join v2.job_map map on map.old_project_id = expense.companycam_project_id;

insert into v2.invoice_line_time_entries (
  invoice_line_id, time_entry_id, minutes, match_method,
  needs_review, metadata, created_at
)
select
  line_mapping.invoice_line_id,
  link.time_entry_id,
  round(link.allocated_hours * 60)::integer,
  array_to_string(link.match_method, ','),
  link.needs_review,
  jsonb_build_object('inserted_by', link.inserted_by, 'updated_at', link.updated_at),
  link.inserted_at
from public.labour_invoice_line_time_entries link
join v2.invoice_line_map line_mapping
  on line_mapping.source_type = 'labour'
 and line_mapping.old_id = link.invoice_line_id;

insert into v2.transaction_allocations (
  id, transaction_id, invoice_id, source_system, external_id,
  allocation_type, amount_cents, allocation_method, confidence,
  needs_review, reversed_at, reversal_reason, metadata,
  created_at, updated_at
)
select
  allocation.id,
  allocation.financial_transaction_id,
  invoice_mapping.invoice_id,
  'customer_invoice',
  allocation.source_payment_event_id::text,
  'customer_payment',
  round(coalesce(allocation.invoice_applied_amount, allocation.allocated_amount, 0) * 100)::bigint,
  array_to_string(allocation.match_method, ','),
  case allocation.confidence
    when 'high' then 1
    when 'medium' then 0.7
    when 'low' then 0.4
    else null
  end,
  false,
  allocation.reversed_at,
  allocation.reversal_reason,
  jsonb_build_object(
    'source_payment_event_id', allocation.source_payment_event_id,
    'evidence_note', allocation.evidence_note,
    'confirmed_by', allocation.confirmed_by,
    'confirmed_at', allocation.confirmed_at
  ),
  allocation.inserted_at,
  coalesce(allocation.reversed_at, allocation.inserted_at)
from public.customer_invoice_bank_allocations allocation
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'customer'
 and invoice_mapping.old_id = allocation.customer_invoice_id;

insert into v2.transaction_allocations (
  id, invoice_id, source_system, external_id, allocation_type,
  amount_cents, allocation_method, metadata, created_at, updated_at
)
select
  v2.stable_uuid('transaction-allocation', 'customer-event:' || event.id::text),
  invoice_mapping.invoice_id,
  event.source_system,
  coalesce(event.external_payment_id, event.id::text),
  'customer_payment_event',
  round(coalesce(event.amount, 0) * 100)::bigint,
  'source_payment_event',
  jsonb_build_object(
    'payment_number', event.payment_number,
    'received_on', event.received_on,
    'method', event.method,
    'reference', event.reference,
    'currency', event.currency,
    'source_statuses', event.source_statuses,
    'source_url', event.source_url,
    'source_payload', event.source_payload
  ),
  event.inserted_at,
  event.updated_at
from public.customer_invoice_payment_events event
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'customer'
 and invoice_mapping.old_id = event.customer_invoice_id
where not exists (
  select 1
  from public.customer_invoice_bank_allocations allocation
  where allocation.source_payment_event_id = event.id
);

insert into v2.transaction_allocations (
  id, transaction_id, invoice_id, source_system, external_id,
  allocation_type, amount_cents, allocation_method, needs_review,
  reversed_at, reversal_reason, metadata, created_at, updated_at
)
select
  allocation.id,
  allocation.financial_transaction_id,
  invoice_mapping.invoice_id,
  'labour_accounting',
  allocation.invoice_source_message_id,
  'labour_payment',
  round(coalesce(allocation.allocated_amount, 0) * 100)::bigint,
  array_to_string(allocation.match_method, ','),
  false,
  allocation.reversed_at,
  allocation.reversal_reason,
  jsonb_build_object(
    'payment_confirmation_message_id', allocation.payment_confirmation_message_id,
    'confirmed_by', allocation.confirmed_by,
    'confirmed_at', allocation.confirmed_at,
    'notes', allocation.notes
  ),
  allocation.inserted_at,
  allocation.updated_at
from public.labour_payment_allocations allocation
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'labour'
 and invoice_mapping.old_id = allocation.invoice_id;

insert into v2.transaction_allocations (
  id, transaction_id, job_id, contact_id, source_system,
  external_id, allocation_type, amount_cents, allocation_method,
  reversed_at, reversal_reason, metadata, created_at, updated_at
)
select
  allocation.id,
  allocation.financial_transaction_id,
  map.job_id,
  contact_mapping.contact_id,
  'labour_accounting',
  allocation.id::text,
  allocation.allocation_type,
  round(coalesce(allocation.allocated_amount, 0) * 100)::bigint,
  'manual_other_allocation',
  allocation.reversed_at,
  allocation.reversal_reason,
  jsonb_build_object('explanation', allocation.explanation, 'old_project_id', allocation.companycam_project_id),
  allocation.inserted_at,
  allocation.updated_at
from public.labour_payment_other_allocations allocation
left join v2.job_map map on map.old_project_id = allocation.companycam_project_id
left join v2.contact_map contact_mapping
  on contact_mapping.source_type = 'contractor'
 and contact_mapping.source_key = allocation.contractor_id::text;

insert into v2.transaction_allocations (
  id, transaction_id, contact_id, source_system, external_id,
  allocation_type, amount_cents, allocation_method, metadata,
  created_at, updated_at
)
select
  v2.stable_uuid('transaction-allocation', 'labour-record:' || record.financial_transaction_id::text),
  record.financial_transaction_id,
  contact_mapping.contact_id,
  'labour_accounting',
  record.financial_transaction_id::text,
  'unallocated_labour_payment',
  abs(source_transaction.amount_cents),
  record.confirmation_method,
  jsonb_build_object(
    'recipient_status', record.recipient_status,
    'confirmation_note', record.confirmation_note,
    'confirmed_by', record.confirmed_by,
    'confirmed_at', record.confirmed_at
  ),
  record.inserted_at,
  record.updated_at
from public.labour_payment_records record
join v2.transactions source_transaction on source_transaction.id = record.financial_transaction_id
left join v2.contact_map contact_mapping
  on contact_mapping.source_type = 'contractor'
 and contact_mapping.source_key = record.contractor_id::text
where not exists (
  select 1 from public.labour_payment_allocations allocation
  where allocation.financial_transaction_id = record.financial_transaction_id
)
and not exists (
  select 1 from public.labour_payment_other_allocations allocation
  where allocation.financial_transaction_id = record.financial_transaction_id
);

insert into v2.transaction_allocations (
  id, transaction_id, invoice_id, source_system, external_id,
  allocation_type, amount_cents, allocation_method, confidence,
  needs_review, reversed_at, reversal_reason, metadata,
  created_at, updated_at
)
select
  allocation.id,
  allocation.financial_transaction_id,
  invoice_mapping.invoice_id,
  'material_accounting',
  allocation.id::text,
  'material_payment',
  round(coalesce(allocation.allocated_amount, 0) * 100)::bigint,
  allocation.allocation_method,
  allocation.confidence,
  allocation.needs_review,
  allocation.reversed_at,
  allocation.reversal_reason,
  jsonb_build_object(
    'evidence_reference', allocation.evidence_reference,
    'source_payload', allocation.source_payload
  ),
  allocation.inserted_at,
  allocation.updated_at
from public.material_payment_allocations allocation
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'material'
 and invoice_mapping.old_id = allocation.material_invoice_id;

insert into v2.transaction_allocations (
  id, invoice_id, counter_invoice_id, source_system, external_id,
  allocation_type, amount_cents, allocation_method, reversed_at,
  reversal_reason, metadata, created_at, updated_at
)
select
  allocation.id,
  charge_mapping.invoice_id,
  credit_mapping.invoice_id,
  'material_accounting',
  allocation.id::text,
  'material_credit',
  round(coalesce(allocation.allocated_amount, 0) * 100)::bigint,
  allocation.allocation_method,
  allocation.reversed_at,
  allocation.reversal_reason,
  jsonb_build_object(
    'evidence_reference', allocation.evidence_reference,
    'source_payload', allocation.source_payload
  ),
  allocation.inserted_at,
  allocation.updated_at
from public.material_credit_allocations allocation
join v2.invoice_map charge_mapping
  on charge_mapping.source_type = 'material'
 and charge_mapping.old_id = allocation.charge_material_invoice_id
join v2.invoice_map credit_mapping
  on credit_mapping.source_type = 'material'
 and credit_mapping.old_id = allocation.credit_material_invoice_id;

insert into v2.evidence_links (
  id, document_id, entity_type, entity_id, evidence_role, metadata, created_at
)
select
  v2.stable_uuid('evidence-link', 'customer-document:' || document.id::text),
  document_mapping.document_id,
  'invoice',
  invoice_mapping.invoice_id,
  document.document_kind,
  '{}'::jsonb,
  document.inserted_at
from public.customer_invoice_documents document
join v2.document_map document_mapping
  on document_mapping.source_type = 'customer_invoice_document'
 and document_mapping.old_id = document.id
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'customer'
 and invoice_mapping.old_id = document.customer_invoice_id
union all
select
  v2.stable_uuid('evidence-link', 'labour-document:' || invoice.id::text),
  document_mapping.document_id,
  'invoice',
  invoice_mapping.invoice_id,
  'source_document',
  '{}'::jsonb,
  invoice.inserted_at
from public.labour_invoices invoice
join v2.document_map document_mapping
  on document_mapping.source_type = 'labour_invoice_document'
 and document_mapping.old_id = invoice.id
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'labour'
 and invoice_mapping.old_id = invoice.id
union all
select
  link.id,
  document_mapping.document_id,
  'invoice',
  invoice_mapping.invoice_id,
  link.evidence_role,
  jsonb_build_object(
    'source_page_start', link.source_page_start,
    'source_page_end', link.source_page_end,
    'evidence_label', link.evidence_label,
    'source_payload', link.source_payload
  ),
  link.inserted_at
from public.material_invoice_evidence_links link
join v2.document_map document_mapping
  on document_mapping.source_type = 'material_invoice_document'
 and document_mapping.old_id = link.document_id
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'material'
 and invoice_mapping.old_id = link.material_invoice_id;

-- Preserve explicit accounting decisions and ambiguous identity evidence.
insert into v2.verification_events (
  id, entity_type, entity_id, action, reason, old_values,
  new_values, evidence, performed_by, occurred_at
)
select
  event.id,
  event.entity_type,
  event.entity_id,
  event.action,
  event.reason,
  null,
  null,
  coalesce(event.evidence, '{}'::jsonb),
  event.actor_id,
  event.occurred_at
from public.customer_revenue_verification_events event
union all
select
  event.id,
  event.entity_type,
  event.entity_id,
  event.action,
  event.reason,
  event.old_values,
  event.new_values,
  '{}'::jsonb,
  event.performed_by,
  event.performed_at
from public.labour_verification_events event
union all
select
  link.id,
  'job_cost_allocation',
  link.allocation_key,
  'link_confirmed',
  link.match_method,
  null,
  jsonb_build_object(
    'cost_type', link.cost_type,
    'old_project_id', link.companycam_project_id,
    'job_proposal_id', link.job_proposal_id,
    'confidence', link.confidence
  ),
  coalesce(link.evidence, '{}'::jsonb),
  link.confirmed_by,
  coalesce(link.confirmed_at, link.inserted_at)
from public.job_cost_allocation_links link;

with ambiguous as (
  select
    contact.normalized_email,
    contact.normalized_phone,
    array_agg(contact.id order by contact.id) as contact_ids,
    min(contact.created_at) as occurred_at
  from v2.contacts contact
  where contact.normalized_email is not null
    and contact.normalized_phone is not null
  group by contact.normalized_email, contact.normalized_phone
  having count(*) > 1
)
insert into v2.verification_events (
  id, entity_type, entity_id, action, reason, evidence, occurred_at
)
select
  v2.stable_uuid(
    'verification',
    'ambiguous-contact:' || ambiguous.normalized_email || ':' || ambiguous.normalized_phone
  ),
  'contact_identity',
  ambiguous.normalized_email || ':' || ambiguous.normalized_phone,
  'kept_separate',
  'Multiple provider identities share the same exact normalized email and phone.',
  jsonb_build_object('contact_ids', ambiguous.contact_ids),
  ambiguous.occurred_at
from ambiguous;

insert into v2.acquisition_attributions (
  id, lead_id, source_system, raw_source, normalized_channel,
  evidence_source, evidence_reference, evidence, captured_at, created_at
)
select
  v2.stable_uuid('attribution', 'lead:' || lead.deal_id),
  v2.stable_uuid('lead', lead.deal_id),
  lead.source_system,
  lead.raw_lead_source,
  lead.normalized_channel,
  'marketing_lead_export',
  lead.source_filename || ':' || lead.source_row_number::text,
  jsonb_build_object('source_payload', lead.source_payload),
  lead.captured_at,
  lead.inserted_at
from public.marketing_leads lead;

insert into v2.acquisition_attributions (
  id, job_id, invoice_id, source_system, raw_source,
  normalized_channel, evidence_source, evidence_reference,
  evidence, captured_at, created_at
)
select
  v2.stable_uuid('attribution', 'customer-invoice:' || attribution.customer_invoice_id::text),
  coalesce(project_job.job_id, proposal_job.id),
  invoice_mapping.invoice_id,
  attribution.source_system,
  attribution.raw_lead_source,
  attribution.normalized_channel,
  attribution.evidence_source,
  attribution.evidence_reference,
  coalesce(attribution.evidence_payload, '{}'::jsonb) || jsonb_build_object(
    'external_contact_id', attribution.external_contact_id,
    'lead_created_at', attribution.lead_created_at
  ),
  attribution.captured_at,
  attribution.inserted_at
from public.customer_invoice_acquisition_attributions attribution
join public.customer_invoices source_invoice on source_invoice.id = attribution.customer_invoice_id
join v2.invoice_map invoice_mapping
  on invoice_mapping.source_type = 'customer'
 and invoice_mapping.old_id = attribution.customer_invoice_id
left join v2.job_map project_job on project_job.old_project_id = source_invoice.companycam_project_id
left join v2.quotes quote
  on quote.dripjobs_proposal_id = coalesce(source_invoice.external_proposal_id, source_invoice.external_proposal_uuid)
left join v2.jobs proposal_job on proposal_job.accepted_quote_id = quote.id;

insert into v2.marketing_performance (
  id, platform, account_id, grain, period_start, period_end,
  entity_level, entity_name, parent_campaign_name,
  parent_ad_set_name, purpose, currency, spend_cents, results,
  result_indicator, impressions, reach, metadata, captured_at, created_at
)
select
  performance.id,
  performance.platform,
  performance.account_id,
  case when performance.reporting_start = performance.reporting_end then 'daily' else 'range' end,
  performance.reporting_start,
  performance.reporting_end,
  performance.entity_level,
  performance.entity_name,
  performance.parent_campaign_name,
  performance.parent_ad_set_name,
  performance.purpose,
  performance.currency,
  round(coalesce(performance.amount_spent, 0) * 100)::bigint,
  performance.results,
  performance.result_indicator,
  coalesce(performance.impressions, 0),
  coalesce(performance.reach, 0),
  jsonb_build_object(
    'delivery_state', performance.delivery_state,
    'source_filename', performance.source_filename,
    'source_sha256', performance.source_sha256,
    'source_row_number', performance.source_row_number,
    'source_payload', performance.source_payload
  ),
  performance.captured_at,
  performance.inserted_at
from public.marketing_platform_performance performance
union all
select
  performance.id,
  performance.platform,
  performance.account_id,
  'monthly',
  performance.month_start,
  (performance.month_start + interval '1 month - 1 day')::date,
  'campaign',
  performance.campaign_name,
  performance.campaign_name,
  null,
  performance.purpose,
  performance.currency,
  round(coalesce(performance.spend, 0) * 100)::bigint,
  performance.leads,
  'leads',
  coalesce(performance.impressions, 0),
  coalesce(performance.reach, 0),
  jsonb_build_object(
    'account_name', performance.account_name,
    'campaign_id', performance.campaign_id,
    'source_filename', performance.source_filename,
    'source_sha256', performance.source_sha256,
    'source_row_number', performance.source_row_number,
    'source_payload', performance.source_payload
  ),
  performance.captured_at,
  performance.inserted_at
from public.marketing_platform_monthly_performance performance;

-- Provider event history moves into the unexposed private schema at cutover.
insert into v2.integration_events (
  id, provider, event_key, event_type, entity_type, entity_id,
  occurred_at, payload, payload_sha256, processing_status,
  error_code, is_test, attempt_count, received_at, processed_at,
  created_at, updated_at
)
select
  event.id,
  'dripjobs',
  event.event_key,
  event.event_type,
  event.entity_type,
  event.entity_id,
  event.occurred_at,
  event.payload,
  event.payload_sha256,
  event.processing_status,
  event.error_code,
  event.is_test,
  event.attempt_count,
  event.received_at,
  event.processed_at,
  event.inserted_at,
  event.updated_at
from public.dripjobs_ingest_events event
union all
select
  record.id,
  record.source_system,
  coalesce(record.record_fingerprint || ':' || record.id::text, record.id::text),
  'crm_snapshot_record',
  record.record_type,
  coalesce(record.proposal_id, record.invoice_id, record.contact_key),
  record.captured_at,
  jsonb_build_object(
    'source_filename', record.source_filename,
    'source_sha256', record.source_sha256,
    'source_row_number', record.source_row_number,
    'canonical_in_snapshot', record.canonical_in_snapshot,
    'snapshot_on', record.snapshot_on,
    'status', record.status,
    'label', record.label,
    'contact_name', record.contact_name,
    'email', record.email,
    'phone', record.phone,
    'raw_lead_source', record.raw_lead_source,
    'normalized_channel', record.normalized_channel,
    'deal_name', record.deal_name,
    'deal_stage', record.deal_stage,
    'salesperson', record.salesperson,
    'deal_amount', record.deal_amount,
    'invoice_status', record.invoice_status,
    'paid_amount', record.paid_amount,
    'balance_amount', record.balance_amount,
    'source_payload', record.source_payload
  ),
  record.source_sha256,
  'historical',
  null,
  false,
  1,
  record.inserted_at,
  record.captured_at,
  record.inserted_at,
  record.updated_at
from public.marketing_crm_records record
union all
select
  record.id,
  'material_supplier_portal',
  record.id::text,
  'supplier_portal_record',
  'material_invoice',
  record.material_invoice_id::text,
  record.last_seen_at,
  jsonb_build_object(
    'source_document_id', record.source_document_id,
    'supplier_name', record.supplier_name,
    'account_number', record.account_number,
    'store_number', record.store_number,
    'invoice_number', record.invoice_number,
    'transaction_date', record.transaction_date,
    'job_account', record.job_account,
    'total_amount', record.total_amount,
    'po_number', record.po_number,
    'portal_type', record.portal_type,
    'unit_number', record.unit_number,
    'extended_invoice', record.extended_invoice,
    'source_row_number', record.source_row_number,
    'match_status', record.match_status,
    'match_differences', record.match_differences,
    'source_payload', record.source_payload
  ),
  null,
  coalesce(record.match_status, 'historical'),
  null,
  false,
  1,
  record.first_seen_at,
  record.last_seen_at,
  record.inserted_at,
  record.updated_at
from public.material_supplier_portal_records record;

-- Hard reconciliation gate. Nothing below this point can run unless all
-- source records and financial totals have survived the conversion.
do $migration_checks$
declare
  expected_count bigint;
  actual_count bigint;
  expected_amount bigint;
  actual_amount bigint;
begin
  select count(*) into expected_count from public.marketing_leads;
  select count(*) into actual_count from v2.leads where dripjobs_deal_id is not null;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: leads % != %', actual_count, expected_count;
  end if;

  select count(*) into expected_count from public.dripjobs_jobs;
  select count(*) into actual_count
  from v2.jobs job
  join v2.quotes quote on quote.id = job.accepted_quote_id
  where quote.dripjobs_proposal_id is not null;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: DripJobs quote/job pairs % != %', actual_count, expected_count;
  end if;

  if exists (
    select quote.dripjobs_proposal_id
    from v2.quotes quote
    where quote.dripjobs_proposal_id is not null
    group by quote.dripjobs_proposal_id
    having count(*) > 1
  ) then
    raise exception 'V2 reconciliation failed: duplicate DripJobs proposal identifiers';
  end if;

  if exists (
    select lead.dripjobs_deal_id
    from v2.leads lead
    where lead.dripjobs_deal_id is not null
    group by lead.dripjobs_deal_id
    having count(*) > 1
  ) then
    raise exception 'V2 reconciliation failed: duplicate DripJobs deal identifiers';
  end if;

  select count(*) into expected_count from public.project_calculators;
  select count(*) into actual_count from v2.quotes where calculator_doc is not null;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: calculator documents % != %', actual_count, expected_count;
  end if;

  select count(*) into expected_count from public.employee_profiles;
  select count(*) into actual_count from v2.employees;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: employees % != %', actual_count, expected_count;
  end if;

  select count(*) into expected_count from public.employee_pay_rates;
  select count(*) into actual_count from v2.employee_pay_rates;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: employee pay rates % != %', actual_count, expected_count;
  end if;

  select count(*) into expected_count from public.project_assignments;
  select count(*) into actual_count from v2.job_assignments;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: job assignments % != %', actual_count, expected_count;
  end if;

  select
    (select count(*)
     from public.project_budgets budget
     join v2.job_map map on map.old_project_id = budget.companycam_project_id)
    + (select count(*)
       from public.project_labour_budgets budget
       join v2.job_map map on map.old_project_id = budget.companycam_project_id)
  into expected_count;
  select count(*) into actual_count from v2.job_budgets;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: job budgets % != %', actual_count, expected_count;
  end if;

  if exists (
    select 1
    from (
      select budget.companycam_project_id
      from public.project_budgets budget
      union
      select budget.companycam_project_id
      from public.project_labour_budgets budget
    ) source_budget
    where not exists (
      select 1 from v2.job_map map
      where map.old_project_id = source_budget.companycam_project_id
    )
      and not exists (
        select 1 from v2.quotes quote
        where quote.metadata ->> 'old_project_id' = source_budget.companycam_project_id
          and quote.calculator_doc is not null
      )
  ) then
    raise exception 'V2 reconciliation failed: an unconverted lead budget has no quote document';
  end if;

  select count(*) into expected_count from public.time_entries;
  select count(*) into actual_count from v2.time_entries;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: time entries % != %', actual_count, expected_count;
  end if;

  select coalesce(sum(extract(epoch from (ended_at - started_at))::bigint), 0)
  into expected_amount
  from public.time_entries
  where ended_at is not null;
  select coalesce(sum(extract(epoch from (ended_at - started_at))::bigint), 0)
  into actual_amount
  from v2.time_entries
  where ended_at is not null;
  if actual_amount <> expected_amount then
    raise exception 'V2 reconciliation failed: clocked seconds % != %', actual_amount, expected_amount;
  end if;

  select count(*) into expected_count from public.time_entry_lifecycle_events;
  select count(*) into actual_count from v2.time_entry_events;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: time lifecycle events % != %', actual_count, expected_count;
  end if;

  select count(distinct progress_id) into expected_count from public.project_labour_tasks;
  select count(*) into actual_count from v2.job_tasks;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: canonical tasks % != %', actual_count, expected_count;
  end if;

  select count(*) into expected_count from public.project_labour_tasks;
  select coalesce(sum(jsonb_array_length(versions)), 0) into actual_count from v2.job_tasks;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: task versions % != %', actual_count, expected_count;
  end if;

  select count(*) into expected_count from public.project_labour_task_time_entries;
  select count(*) into actual_count from v2.job_task_time_entries;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: task time entries % != %', actual_count, expected_count;
  end if;

  select
    (select count(*) from public.project_over_budget_reasons)
    + (select count(*) from public.project_labour_task_over_budget_reasons)
  into expected_count;
  select count(*) into actual_count from v2.job_issues;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: job issues % != %', actual_count, expected_count;
  end if;

  select count(*) into expected_count from public.employee_push_tokens;
  select count(*) into actual_count from v2.push_tokens;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: push tokens % != %', actual_count, expected_count;
  end if;

  select count(*) into expected_count from public.employee_location_points;
  select count(*) into actual_count from v2.employee_location_points;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: location points % != %', actual_count, expected_count;
  end if;

  select count(*) into expected_count from public.employee_tracking_status;
  select count(*) into actual_count from v2.employee_tracking_status;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: tracking status % != %', actual_count, expected_count;
  end if;

  select count(*) into expected_count from public.location_tracking_alerts;
  select count(*) into actual_count from v2.location_alerts;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: location alerts % != %', actual_count, expected_count;
  end if;

  select count(*) into expected_count from public.financial_accounts;
  select count(*) into actual_count from v2.accounts;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: financial accounts % != %', actual_count, expected_count;
  end if;

  select
    (select count(*) from public.financial_imports)
    + (select count(*) from public.customer_invoice_documents)
    + (select count(*) from public.labour_invoices)
    + (select count(*) from public.material_invoice_documents)
  into expected_count;
  select count(*) into actual_count from v2.documents;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: source documents % != %', actual_count, expected_count;
  end if;

  select count(*) into expected_count from public.financial_transactions;
  select count(*) into actual_count from v2.transactions;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: financial transactions % != %', actual_count, expected_count;
  end if;

  select coalesce(sum(round(amount * 100)::bigint), 0)
  into expected_amount from public.financial_transactions;
  select coalesce(sum(amount_cents), 0)
  into actual_amount from v2.transactions;
  if actual_amount <> expected_amount then
    raise exception 'V2 reconciliation failed: transaction cents % != %', actual_amount, expected_amount;
  end if;

  select
    (select count(*) from public.customer_invoices)
    + (select count(*) from public.labour_invoices)
    + (select count(*) from public.material_invoices)
    + (select count(*) from public.project_labour_expenses)
  into expected_count;
  select count(*) into actual_count from v2.invoices;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: invoices % != %', actual_count, expected_count;
  end if;

  select
    coalesce((select sum(round(coalesce(total_amount, 0) * 100)::bigint) from public.customer_invoices), 0)
    + coalesce((select sum(round(coalesce(amount_paid, amount_before_tax + coalesce(tax_amount, 0), 0) * 100)::bigint) from public.labour_invoices), 0)
    + coalesce((select sum(round(coalesce(total_amount, 0) * 100)::bigint) from public.material_invoices), 0)
    + coalesce((select sum(round((coalesce(amount_before_tax, 0) + coalesce(tax_amount, 0)) * 100)::bigint) from public.project_labour_expenses), 0)
  into expected_amount;
  select coalesce(sum(total_cents), 0) into actual_amount from v2.invoices;
  if actual_amount <> expected_amount then
    raise exception 'V2 reconciliation failed: invoice total cents % != %', actual_amount, expected_amount;
  end if;

  select
    coalesce((select sum(round(coalesce(tax_amount, 0) * 100)::bigint) from public.customer_invoices), 0)
    + coalesce((select sum(round(coalesce(tax_amount, 0) * 100)::bigint) from public.labour_invoices), 0)
    + coalesce((select sum(round(coalesce(tax_amount, 0) * 100)::bigint) from public.material_invoices), 0)
    + coalesce((select sum(round(coalesce(tax_amount, 0) * 100)::bigint) from public.project_labour_expenses), 0)
  into expected_amount;
  select coalesce(sum(tax_cents), 0) into actual_amount from v2.invoices;
  if actual_amount <> expected_amount then
    raise exception 'V2 reconciliation failed: invoice tax cents % != %', actual_amount, expected_amount;
  end if;

  select
    (select count(*) from public.customer_invoice_items)
    + (select count(*) from public.labour_invoice_lines)
    + (select count(*) from public.material_invoice_lines)
    + (select count(*) from public.project_labour_expenses)
  into expected_count;
  select count(*) into actual_count from v2.invoice_lines;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: invoice lines % != %', actual_count, expected_count;
  end if;

  select count(*) into expected_count from public.labour_invoice_line_time_entries;
  select count(*) into actual_count from v2.invoice_line_time_entries;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: invoice/time links % != %', actual_count, expected_count;
  end if;

  select
    (select count(*) from public.customer_invoice_bank_allocations)
    + (select count(*) from public.customer_invoice_payment_events event
       where not exists (
         select 1 from public.customer_invoice_bank_allocations allocation
         where allocation.source_payment_event_id = event.id
       ))
    + (select count(*) from public.labour_payment_allocations)
    + (select count(*) from public.labour_payment_other_allocations)
    + (select count(*) from public.labour_payment_records record
       where not exists (
         select 1 from public.labour_payment_allocations allocation
         where allocation.financial_transaction_id = record.financial_transaction_id
       )
       and not exists (
         select 1 from public.labour_payment_other_allocations allocation
         where allocation.financial_transaction_id = record.financial_transaction_id
       ))
    + (select count(*) from public.material_payment_allocations)
    + (select count(*) from public.material_credit_allocations)
  into expected_count;
  select count(*) into actual_count from v2.transaction_allocations;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: transaction allocations % != %', actual_count, expected_count;
  end if;

  select
    (select count(*) from public.customer_invoice_documents)
    + (select count(*) from public.labour_invoices)
    + (select count(*) from public.material_invoice_evidence_links)
  into expected_count;
  select count(*) into actual_count from v2.evidence_links;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: evidence links % != %', actual_count, expected_count;
  end if;

  select
    (select count(*) from public.marketing_platform_performance)
    + (select count(*) from public.marketing_platform_monthly_performance)
  into expected_count;
  select count(*) into actual_count from v2.marketing_performance;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: marketing performance % != %', actual_count, expected_count;
  end if;

  select
    (select count(*) from public.dripjobs_ingest_events)
    + (select count(*) from public.marketing_crm_records)
    + (select count(*) from public.material_supplier_portal_records)
  into expected_count;
  select count(*) into actual_count from v2.integration_events;
  if actual_count <> expected_count then
    raise exception 'V2 reconciliation failed: integration events % != %', actual_count, expected_count;
  end if;

  if exists (
    select 1
    from v2.jobs job
    join v2.quotes quote on quote.id = job.accepted_quote_id
    where quote.lead_id <> job.lead_id
  ) then
    raise exception 'V2 reconciliation failed: accepted quote and job lead mismatch';
  end if;

  if exists (
    select 1
    from public.time_entries source
    where source.companycam_project_id is not null
      and not exists (
        select 1 from v2.time_entries target
        where target.id = source.id and target.job_id is not null
      )
  ) then
    raise exception 'V2 reconciliation failed: an operational time entry has no job';
  end if;
end
$migration_checks$;

-- Atomic cutover -----------------------------------------------------------

insert into v2.app_config (
  id, schema_version, maintenance_mode, minimum_mobile_version,
  settings, updated_at
)
select
  'default',
  2,
  true,
  '1.1.0',
  jsonb_build_object(
    'calculator_rates',
    coalesce((
      select setting.rates
      from public.calculator_settings setting
      where setting.id = 'default'
    ), '{}'::jsonb)
  ),
  now();

-- CompanyCam is no longer allowed to create jobs. Keep photo evidence links
-- on jobs, but remove both its import schedule and the legacy purge schedule.
do $unschedule$
declare
  scheduled_job record;
begin
  for scheduled_job in
    select jobid
    from cron.job
    where command ilike '%sync-companycam-projects%'
       or command ilike '%purge_expired_employee_location_points%'
  loop
    perform cron.unschedule(scheduled_job.jobid);
  end loop;
end
$unschedule$;

do $drop_old_views$
declare
  old_view record;
begin
  for old_view in
    select table_schema, table_name
    from information_schema.views
    where table_schema = 'public'
  loop
    execute format(
      'drop view if exists %I.%I cascade',
      old_view.table_schema,
      old_view.table_name
    );
  end loop;
end
$drop_old_views$;

-- At this point public contains only the legacy application tables. The V2
-- tables remain isolated in v2, so an assertion failure above rolls back
-- before any legacy object is removed.
do $drop_old_tables$
declare
  old_table record;
begin
  for old_table in
    select table_schema, table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_type = 'BASE TABLE'
  loop
    execute format(
      'drop table if exists %I.%I cascade',
      old_table.table_schema,
      old_table.table_name
    );
  end loop;
end
$drop_old_tables$;

do $drop_old_routines$
declare
  old_routine record;
begin
  for old_routine in
    select
      namespace.nspname as schema_name,
      procedure.proname as routine_name,
      pg_get_function_identity_arguments(procedure.oid) as identity_arguments,
      procedure.prokind
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
  loop
    execute format(
      'drop %s if exists %I.%I(%s) cascade',
      case when old_routine.prokind = 'p' then 'procedure' else 'function' end,
      old_routine.schema_name,
      old_routine.routine_name,
      old_routine.identity_arguments
    );
  end loop;
end
$drop_old_routines$;

drop table v2.contact_map;
drop table v2.project_lead_map;
drop table v2.job_map;
drop table v2.document_map;
drop table v2.invoice_map;
drop table v2.invoice_line_map;

do $publish_v2$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_config',
    'contacts',
    'leads',
    'quotes',
    'jobs',
    'employees',
    'employee_pay_rates',
    'job_assignments',
    'job_budgets',
    'job_tasks',
    'job_task_time_entries',
    'job_issues',
    'time_entries',
    'time_entry_events',
    'push_tokens',
    'employee_location_points',
    'employee_tracking_status',
    'location_alerts',
    'accounts',
    'transactions',
    'documents',
    'evidence_links',
    'invoices',
    'invoice_lines',
    'invoice_job_allocations',
    'invoice_line_time_entries',
    'transaction_allocations',
    'verification_events',
    'acquisition_attributions',
    'marketing_performance'
  ]
  loop
    execute format('alter table v2.%I set schema public', table_name);
  end loop;
end
$publish_v2$;

alter table v2.integration_events set schema private;
drop function v2.stable_uuid(text, text);
drop schema v2;

create index contacts_normalized_identity_idx
  on public.contacts(normalized_email, normalized_phone)
  where normalized_email is not null and normalized_phone is not null;
create index leads_contact_idx on public.leads(contact_id);
create index leads_stage_idx on public.leads(status, captured_at desc);
create index leads_search_idx on public.leads using gin (
  to_tsvector('simple', coalesce(address, '') || ' ' || coalesce(postal_code, ''))
);
create index quotes_lead_idx on public.quotes(lead_id, created_at desc);
create index jobs_lead_idx on public.jobs(lead_id);
create index jobs_status_idx on public.jobs(status, updated_at desc);
create index jobs_companycam_ids_idx on public.jobs using gin(companycam_project_ids);
create index jobs_search_idx on public.jobs using gin (
  to_tsvector(
    'simple',
    coalesce(name, '') || ' ' || coalesce(formatted_address, '') || ' '
      || coalesce(city, '') || ' ' || coalesce(postal_code, '')
  )
);
create index job_assignments_employee_idx
  on public.job_assignments(employee_id, status, job_id);
create index job_budgets_job_idx
  on public.job_budgets(job_id, status, version desc);
create index job_tasks_job_idx
  on public.job_tasks(job_id, status, sort_order);
create unique index job_issues_client_id_idx
  on public.job_issues(client_id)
  where client_id is not null;
create index time_entries_employee_started_idx
  on public.time_entries(employee_id, started_at desc);
create index time_entries_job_started_idx
  on public.time_entries(job_id, started_at desc);
create unique index time_entries_one_active_per_employee_idx
  on public.time_entries(employee_id)
  where status = 'active' and ended_at is null;
create index location_points_employee_captured_idx
  on public.employee_location_points(employee_id, captured_at desc);
create index location_points_job_captured_idx
  on public.employee_location_points(job_id, captured_at desc);
create unique index location_alerts_time_entry_idx
  on public.location_alerts(time_entry_id);
create index transactions_posted_idx
  on public.transactions(posted_on desc, account_id);
create index invoices_category_date_idx
  on public.invoices(category, issued_on desc);
create index invoice_lines_invoice_idx on public.invoice_lines(invoice_id, line_number);
create index invoice_job_allocations_job_idx
  on public.invoice_job_allocations(job_id, invoice_id);
create index transaction_allocations_invoice_idx
  on public.transaction_allocations(invoice_id)
  where invoice_id is not null and reversed_at is null;
create index integration_events_status_idx
  on private.integration_events(processing_status, received_at);

-- Five read models ---------------------------------------------------------

create view public.job_feed
with (security_invoker = true)
as
select
  job.id,
  job.name,
  job.status,
  job.formatted_address,
  job.address_line_1,
  job.address_line_2,
  job.city,
  job.province,
  job.postal_code,
  job.country,
  job.latitude,
  job.longitude,
  job.companycam_project_ids,
  job.scheduled_on,
  job.started_on,
  job.completed_on,
  job.is_feed_visible,
  job.updated_at,
  budget.budget_minutes,
  usage.used_minutes,
  case
    when budget.budget_minutes is null or budget.budget_minutes = 0 then null
    else round(usage.used_minutes::numeric / budget.budget_minutes * 100, 2)
  end as budget_percent_used,
  case
    when budget.budget_minutes is null then 'not_configured'
    when usage.used_minutes > budget.budget_minutes then 'over_budget'
    when job.status = 'completed' then 'complete'
    else 'active'
  end as budget_status
from public.jobs job
left join lateral (
  select source.budget_minutes
  from public.job_budgets source
  where source.job_id = job.id
    and source.status in ('active', 'closed')
  order by (source.status = 'active') desc, source.version desc, source.updated_at desc
  limit 1
) budget on true
left join lateral (
  select coalesce(sum(
    greatest(0, extract(epoch from (coalesce(entry.ended_at, now()) - entry.started_at)) / 60)
  ), 0)::integer as used_minutes
  from public.time_entries entry
  where entry.job_id = job.id
    and entry.status <> 'deleted'
) usage on true
where job.is_feed_visible;

create view public.job_financial_summary
with (security_invoker = true)
as
with usable_allocations as (
  select allocation.*
  from public.invoice_job_allocations allocation
  where allocation.invoice_line_id is not null
     or not exists (
       select 1
       from public.invoice_job_allocations line_allocation
       where line_allocation.invoice_id = allocation.invoice_id
         and line_allocation.job_id = allocation.job_id
         and line_allocation.invoice_line_id is not null
     )
)
select
  job.id as job_id,
  job.contract_amount_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'receivable'
  ), 0)::bigint as receivable_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'payable' and invoice.category = 'labour'
  ), 0)::bigint as labour_cost_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'payable' and invoice.category = 'material'
  ), 0)::bigint as material_cost_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'payable'
  ), 0)::bigint as total_cost_cents
from public.jobs job
left join usable_allocations allocation on allocation.job_id = job.id
left join public.invoices invoice on invoice.id = allocation.invoice_id
group by job.id, job.contract_amount_cents;

create view public.invoice_balances
with (security_invoker = true)
as
select
  invoice.*,
  coalesce(allocation.allocated_cents, 0)::bigint as allocated_payment_cents,
  invoice.total_cents - coalesce(allocation.allocated_cents, invoice.paid_cents)::bigint
    as calculated_balance_cents
from public.invoices invoice
left join lateral (
  select sum(
    case
      when source.allocation_type = 'material_credit' then source.amount_cents
      else source.amount_cents
    end
  ) as allocated_cents
  from public.transaction_allocations source
  where source.invoice_id = invoice.id
    and source.reversed_at is null
) allocation on true;

create view public.marketing_summary
with (security_invoker = true)
as
select
  performance.platform,
  performance.period_start,
  performance.period_end,
  performance.purpose,
  sum(performance.spend_cents)::bigint as spend_cents,
  sum(performance.results) as results,
  sum(performance.impressions)::bigint as impressions,
  sum(performance.reach)::bigint as reach
from public.marketing_performance performance
group by
  performance.platform,
  performance.period_start,
  performance.period_end,
  performance.purpose;

create view public.accounting_exceptions
with (security_invoker = true)
as
select
  'invoice_balance'::text as exception_type,
  invoice.id as entity_id,
  invoice.invoice_number as label,
  invoice.balance_cents as amount_cents,
  jsonb_build_object('category', invoice.category, 'status', invoice.status) as details
from public.invoices invoice
where invoice.balance_cents <> 0
union all
select
  'allocation_review',
  allocation.id,
  invoice.invoice_number,
  allocation.total_cents,
  jsonb_build_object('invoice_id', allocation.invoice_id, 'job_id', allocation.job_id)
from public.invoice_job_allocations allocation
join public.invoices invoice on invoice.id = allocation.invoice_id
where allocation.needs_review
union all
select
  'transaction_review',
  allocation.id,
  source_transaction.description,
  allocation.amount_cents,
  jsonb_build_object('transaction_id', allocation.transaction_id, 'invoice_id', allocation.invoice_id)
from public.transaction_allocations allocation
join public.transactions source_transaction on source_transaction.id = allocation.transaction_id
where allocation.needs_review and allocation.reversed_at is null;

-- Least-privilege Data API grants and RLS ---------------------------------

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema private to authenticated, service_role;
grant select on all tables in schema public to authenticated;
grant select on public.app_config to anon;
grant insert, update on public.employee_pay_rates to authenticated;
grant all on all tables in schema public to service_role;
grant all on all tables in schema private to service_role;

create function private.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees employee
    where employee.id = auth.uid()
      and employee.is_active
      and employee.role in ('admin', 'manager')
  )
$$;

revoke all on function private.is_manager() from public, anon;
grant execute on function private.is_manager() to authenticated, service_role;

do $enable_rls$
declare
  table_name text;
begin
  foreach table_name in array array[
    'app_config',
    'contacts',
    'leads',
    'quotes',
    'jobs',
    'employees',
    'employee_pay_rates',
    'job_assignments',
    'job_budgets',
    'job_tasks',
    'job_task_time_entries',
    'job_issues',
    'time_entries',
    'time_entry_events',
    'push_tokens',
    'employee_location_points',
    'employee_tracking_status',
    'location_alerts',
    'accounts',
    'transactions',
    'documents',
    'evidence_links',
    'invoices',
    'invoice_lines',
    'invoice_job_allocations',
    'invoice_line_time_entries',
    'transaction_allocations',
    'verification_events',
    'acquisition_attributions',
    'marketing_performance'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end
$enable_rls$;

create policy app_config_read
on public.app_config for select
to anon, authenticated
using (true);

do $operational_read_policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'contacts',
    'leads',
    'quotes',
    'jobs',
    'employees',
    'employee_pay_rates',
    'job_assignments',
    'job_budgets',
    'job_tasks',
    'job_task_time_entries',
    'job_issues',
    'time_entries',
    'time_entry_events'
  ]
  loop
    execute format(
      'create policy authenticated_read on public.%I for select to authenticated using (auth.uid() is not null)',
      table_name
    );
  end loop;
end
$operational_read_policies$;

do $manager_read_policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'accounts',
    'transactions',
    'documents',
    'evidence_links',
    'invoices',
    'invoice_lines',
    'invoice_job_allocations',
    'invoice_line_time_entries',
    'transaction_allocations',
    'verification_events',
    'acquisition_attributions',
    'marketing_performance'
  ]
  loop
    execute format(
      'create policy manager_read on public.%I for select to authenticated using (private.is_manager())',
      table_name
    );
  end loop;
end
$manager_read_policies$;

create policy push_tokens_read
on public.push_tokens for select to authenticated
using (employee_id = auth.uid() or private.is_manager());
create policy location_points_read
on public.employee_location_points for select to authenticated
using (employee_id = auth.uid() or private.is_manager());
create policy tracking_status_read
on public.employee_tracking_status for select to authenticated
using (employee_id = auth.uid() or private.is_manager());
create policy location_alerts_read
on public.location_alerts for select to authenticated
using (employee_id = auth.uid() or private.is_manager());
create policy employee_pay_rates_manager_write
on public.employee_pay_rates for all to authenticated
using (private.is_manager())
with check (private.is_manager());

grant select on public.job_feed to authenticated;
grant select on public.job_financial_summary to authenticated;
grant select on public.invoice_balances to authenticated;
grant select on public.marketing_summary to authenticated;
grant select on public.accounting_exceptions to authenticated;

-- Explicit transactional command functions -------------------------------

create function public.record_time_entry_command(
  action text,
  command jsonb,
  next_command jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor public.employees%rowtype;
  target public.time_entries%rowtype;
  task_session public.job_task_time_entries%rowtype;
  target_id uuid;
  requested_job_id uuid;
  requested_task_id uuid;
  requested_client_id text;
  event_name text;
  result jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;

  select * into actor
  from public.employees employee
  where employee.id = actor_id and employee.is_active;
  if not found then
    raise exception 'Active employee profile required';
  end if;

  if action = 'task_start' then
    requested_client_id := nullif(btrim(command ->> 'client_entry_id'), '');
    requested_task_id := nullif(command ->> 'task_id', '')::uuid;
    if requested_client_id is null or requested_task_id is null then
      raise exception 'client_entry_id and task_id are required';
    end if;
    select * into task_session
    from public.job_task_time_entries source
    where source.client_entry_id = requested_client_id;
    if found then return to_jsonb(task_session); end if;
    if not exists (select 1 from public.job_tasks task where task.id = requested_task_id) then
      raise exception 'Task not found';
    end if;
    update public.job_task_time_entries source
    set ended_at = coalesce(nullif(command ->> 'started_at', '')::timestamptz, now()),
        status = 'completed',
        updated_at = now()
    where source.employee_id = actor_id
      and source.status = 'active'
      and source.ended_at is null;
    insert into public.job_task_time_entries (
      id, client_entry_id, task_id, employee_id, time_entry_id,
      started_at, ended_at, status, notes, metadata, created_at, updated_at
    ) values (
      extensions.gen_random_uuid(), requested_client_id, requested_task_id, actor_id,
      case when exists (
        select 1 from public.time_entries entry
        where entry.id = nullif(command ->> 'time_entry_id', '')::uuid
          and entry.employee_id = actor_id
      ) then nullif(command ->> 'time_entry_id', '')::uuid else null end,
      coalesce(nullif(command ->> 'started_at', '')::timestamptz, now()),
      null, 'active', nullif(command ->> 'note', ''),
      jsonb_build_object('source', coalesce(command ->> 'source', 'app')),
      now(), now()
    ) returning * into task_session;
    return to_jsonb(task_session);

  elsif action = 'task_stop' then
    update public.job_task_time_entries source
    set ended_at = coalesce(nullif(command ->> 'ended_at', '')::timestamptz, now()),
        status = 'completed',
        updated_at = now()
    where source.employee_id = actor_id
      and source.status = 'active'
      and source.ended_at is null;
    return coalesce((
      select jsonb_agg(to_jsonb(source))
      from public.job_task_time_entries source
      where source.employee_id = actor_id
        and source.ended_at = coalesce(nullif(command ->> 'ended_at', '')::timestamptz, source.ended_at)
    ), '[]'::jsonb);

  elsif action = 'task_adjust' then
    target_id := nullif(command ->> 'entry_id', '')::uuid;
    update public.job_task_time_entries source
    set ended_at = nullif(command ->> 'ended_at', '')::timestamptz,
        status = 'completed',
        updated_at = now()
    where source.id = target_id
      and (source.employee_id = actor_id or private.is_manager())
      and source.ended_at is not null
    returning * into task_session;
    if not found then raise exception 'Task session could not be adjusted'; end if;
    return to_jsonb(task_session);

  elsif action in ('job_issue', 'task_issue') then
    requested_task_id := nullif(command ->> 'task_id', '')::uuid;
    requested_job_id := nullif(command ->> 'job_id', '')::uuid;
    if requested_job_id is null and requested_task_id is not null then
      select task.job_id into requested_job_id
      from public.job_tasks task where task.id = requested_task_id;
    end if;
    if requested_job_id is null or not exists (
      select 1 from public.jobs job where job.id = requested_job_id
    ) then
      raise exception 'A valid job_id is required';
    end if;
    insert into public.job_issues (
      id, client_id, job_id, task_id, employee_id, issue_type,
      reason, note, minutes_over, metadata, created_at
    ) values (
      extensions.gen_random_uuid(), nullif(command ->> 'client_id', ''),
      requested_job_id, requested_task_id, actor_id,
      case when action = 'task_issue' then 'task_over_budget' else 'job_over_budget' end,
      coalesce(nullif(command ->> 'reason', ''), 'other'),
      nullif(command ->> 'note', ''),
      greatest(0, coalesce(nullif(command ->> 'minutes_over', '')::integer, 0)),
      coalesce(command -> 'metadata', '{}'::jsonb), now()
    )
    on conflict (client_id) where client_id is not null do nothing
    returning id into target_id;
    return jsonb_build_object('id', target_id, 'duplicate', target_id is null);
  end if;

  if action = 'switch' then
    result := jsonb_build_object(
      'completed_entry',
      public.record_time_entry_command('clock_out', command, null),
      'active_entry',
      public.record_time_entry_command('clock_in', next_command, null)
    );
    return result;
  end if;

  requested_client_id := nullif(btrim(command ->> 'client_entry_id'), '');

  if action = 'clock_in' then
    if requested_client_id is null then
      raise exception 'client_entry_id is required';
    end if;

    select * into target
    from public.time_entries entry
    where entry.client_entry_id = requested_client_id
    for update;
    if found then
      if target.employee_id <> actor_id and not private.is_manager() then
        raise exception 'Time entry belongs to another employee';
      end if;
      return to_jsonb(target);
    end if;

    if exists (
      select 1
      from public.time_entries entry
      where entry.employee_id = actor_id
        and entry.status = 'active'
        and entry.ended_at is null
    ) then
      raise exception 'Employee already has an active time entry';
    end if;

    requested_job_id := nullif(command ->> 'job_id', '')::uuid;
    if requested_job_id is null or not exists (
      select 1 from public.jobs job where job.id = requested_job_id
    ) then
      raise exception 'A valid job_id is required';
    end if;

    target_id := coalesce(nullif(command ->> 'server_id', '')::uuid, extensions.gen_random_uuid());
    insert into public.time_entries (
      id, client_entry_id, employee_id, job_id, employee_email,
      employee_name, job_name, job_address, original_started_at,
      started_at, status, clock_in_latitude, clock_in_longitude,
      last_distance_meters, is_on_site, segments, notes, created_at, updated_at
    )
    select
      target_id,
      requested_client_id,
      actor_id,
      job.id,
      actor.email,
      coalesce(actor.full_name, actor.email, 'Painter'),
      job.name,
      coalesce(job.formatted_address, job.address_line_1),
      coalesce(
        nullif(command ->> 'original_started_at', '')::timestamptz,
        nullif(command ->> 'started_at', '')::timestamptz,
        now()
      ),
      coalesce(nullif(command ->> 'started_at', '')::timestamptz, now()),
      'active',
      nullif(command ->> 'clock_in_latitude', '')::double precision,
      nullif(command ->> 'clock_in_longitude', '')::double precision,
      nullif(command ->> 'last_distance_meters', '')::integer,
      nullif(command ->> 'is_on_site', '')::boolean,
      coalesce(command -> 'segments', '[]'::jsonb),
      nullif(command ->> 'reason', ''),
      now(),
      now()
    from public.jobs job
    where job.id = requested_job_id
    returning * into target;
    event_name := 'clock_in';

  elsif action in ('clock_out', 'adjust', 'delete', 'observation') then
    select * into target
    from public.time_entries entry
    where (
      nullif(command ->> 'server_id', '')::uuid is not null
      and entry.id = nullif(command ->> 'server_id', '')::uuid
    ) or (
      requested_client_id is not null
      and entry.client_entry_id = requested_client_id
    )
    order by entry.started_at desc
    limit 1
    for update;

    if not found then
      if action = 'delete' then return 'false'::jsonb; end if;
      raise exception 'Time entry not found';
    end if;
    if target.employee_id <> actor_id and not private.is_manager() then
      raise exception 'Time entry belongs to another employee';
    end if;

    if action = 'clock_out' then
      if target.status = 'active' then
        update public.time_entries entry
        set
          ended_at = coalesce(nullif(command ->> 'ended_at', '')::timestamptz, now()),
          status = 'completed',
          clock_out_latitude = coalesce(
            nullif(command ->> 'clock_out_latitude', '')::double precision,
            entry.clock_out_latitude
          ),
          clock_out_longitude = coalesce(
            nullif(command ->> 'clock_out_longitude', '')::double precision,
            entry.clock_out_longitude
          ),
          last_distance_meters = coalesce(
            nullif(command ->> 'last_distance_meters', '')::integer,
            entry.last_distance_meters
          ),
          is_on_site = coalesce(
            nullif(command ->> 'is_on_site', '')::boolean,
            entry.is_on_site
          ),
          segments = coalesce(command -> 'segments', entry.segments),
          notes = coalesce(nullif(command ->> 'reason', ''), entry.notes),
          updated_at = now()
        where entry.id = target.id
        returning * into target;
      end if;
      event_name := 'clock_out';

    elsif action = 'adjust' then
      if target.employee_id <> actor_id and not private.is_manager() then
        raise exception 'Only a manager can adjust another employee time entry';
      end if;
      update public.time_entries entry
      set
        original_started_at = coalesce(entry.original_started_at, entry.started_at),
        started_at = coalesce(nullif(command ->> 'started_at', '')::timestamptz, entry.started_at),
        start_edited_at = case
          when command ? 'started_at' then now()
          else entry.start_edited_at
        end,
        ended_at = case
          when command ? 'ended_at' then nullif(command ->> 'ended_at', '')::timestamptz
          else entry.ended_at
        end,
        status = case
          when command ? 'ended_at' and nullif(command ->> 'ended_at', '') is not null
            then 'completed'
          else entry.status
        end,
        adjustment_history = entry.adjustment_history || jsonb_build_array(
          jsonb_build_object(
            'adjusted_at', now(),
            'adjusted_by', actor_id,
            'source', coalesce(command ->> 'adjustment_source', 'app'),
            'previous_started_at', entry.started_at,
            'previous_ended_at', entry.ended_at
          )
        ),
        notes = coalesce(nullif(command ->> 'reason', ''), entry.notes),
        updated_at = now()
      where entry.id = target.id
      returning * into target;
      event_name := 'adjust';

    elsif action = 'delete' then
      update public.time_entries entry
      set status = 'deleted',
          ended_at = coalesce(entry.ended_at, now()),
          updated_at = now()
      where entry.id = target.id
      returning * into target;
      event_name := 'delete';

    else
      update public.time_entries entry
      set
        clock_out_latitude = coalesce(
          nullif(command ->> 'clock_out_latitude', '')::double precision,
          entry.clock_out_latitude
        ),
        clock_out_longitude = coalesce(
          nullif(command ->> 'clock_out_longitude', '')::double precision,
          entry.clock_out_longitude
        ),
        last_distance_meters = coalesce(
          nullif(command ->> 'last_distance_meters', '')::integer,
          entry.last_distance_meters
        ),
        is_on_site = coalesce(
          nullif(command ->> 'is_on_site', '')::boolean,
          entry.is_on_site
        ),
        segments = coalesce(command -> 'segments', entry.segments),
        updated_at = now()
      where entry.id = target.id
      returning * into target;
      return to_jsonb(target);
    end if;
  else
    raise exception 'Unsupported time-entry action: %', action;
  end if;

  insert into public.time_entry_events (
    id, time_entry_id, client_entry_id, employee_id, event_type,
    captured_at, received_at, source, metadata
  ) values (
    extensions.gen_random_uuid(),
    target.id,
    target.client_entry_id,
    target.employee_id,
    event_name,
    coalesce(nullif(command ->> 'captured_at', '')::timestamptz, now()),
    now(),
    coalesce(nullif(command ->> 'source', ''), 'app'),
    jsonb_build_object('command', command - 'segments')
  );

  if action = 'delete' then return 'true'::jsonb; end if;
  return to_jsonb(target);
end
$$;

revoke all on function public.record_time_entry_command(text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_time_entry_command(text, jsonb, jsonb)
  to authenticated, service_role;

create function public.record_location_update(
  point jsonb,
  tracking jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  requested_entry_id uuid := nullif(point ->> 'time_entry_id', '')::uuid;
  requested_job_id uuid := nullif(point ->> 'job_id', '')::uuid;
begin
  if actor_id is null or not exists (
    select 1 from public.employees employee
    where employee.id = actor_id and employee.is_active
  ) then
    raise exception 'Active employee profile required';
  end if;
  if requested_entry_id is not null and not exists (
    select 1 from public.time_entries entry
    where entry.id = requested_entry_id and entry.employee_id = actor_id
  ) then
    raise exception 'Time entry does not belong to the current employee';
  end if;

  insert into public.employee_location_points (
    id, client_event_id, employee_id, time_entry_id, client_entry_id,
    job_id, latitude, longitude, accuracy_meters, speed_mps,
    heading_degrees, is_mocked, tracking_mode, event_type,
    distance_from_job_meters, is_on_site, captured_at, received_at, created_at
  ) values (
    coalesce(nullif(point ->> 'id', '')::uuid, extensions.gen_random_uuid()),
    nullif(point ->> 'client_event_id', ''),
    actor_id,
    requested_entry_id,
    nullif(point ->> 'client_entry_id', ''),
    requested_job_id,
    (point ->> 'latitude')::double precision,
    (point ->> 'longitude')::double precision,
    nullif(point ->> 'accuracy_meters', '')::double precision,
    nullif(point ->> 'speed_mps', '')::double precision,
    nullif(point ->> 'heading_degrees', '')::double precision,
    nullif(point ->> 'is_mocked', '')::boolean,
    coalesce(nullif(point ->> 'tracking_mode', ''), 'unknown'),
    coalesce(nullif(point ->> 'event_type', ''), 'location'),
    nullif(point ->> 'distance_from_job_meters', '')::integer,
    nullif(point ->> 'is_on_site', '')::boolean,
    coalesce(nullif(point ->> 'captured_at', '')::timestamptz, now()),
    now(),
    now()
  )
  on conflict (client_event_id) do nothing;

  if tracking is not null then
    insert into public.employee_tracking_status (
      employee_id, employee_email, employee_name, time_entry_id,
      client_entry_id, job_id, job_name, job_address, latitude,
      longitude, accuracy_meters, last_location_at, last_sync_at,
      tracking_mode, task_status, permission_foreground,
      permission_background, platform, app_version, last_error_code,
      metadata, created_at, updated_at
    )
    select
      actor_id,
      employee.email,
      employee.full_name,
      requested_entry_id,
      nullif(point ->> 'client_entry_id', ''),
      requested_job_id,
      job.name,
      coalesce(job.formatted_address, job.address_line_1),
      nullif(point ->> 'latitude', '')::double precision,
      nullif(point ->> 'longitude', '')::double precision,
      nullif(point ->> 'accuracy_meters', '')::double precision,
      coalesce(nullif(point ->> 'captured_at', '')::timestamptz, now()),
      now(),
      coalesce(nullif(tracking ->> 'tracking_mode', ''), 'unknown'),
      coalesce(nullif(tracking ->> 'task_status', ''), 'unknown'),
      nullif(tracking ->> 'permission_foreground', '')::boolean,
      nullif(tracking ->> 'permission_background', '')::boolean,
      nullif(tracking ->> 'platform', ''),
      nullif(tracking ->> 'app_version', ''),
      nullif(tracking ->> 'last_error_code', ''),
      coalesce(tracking -> 'metadata', '{}'::jsonb),
      now(),
      now()
    from public.employees employee
    left join public.jobs job on job.id = requested_job_id
    where employee.id = actor_id
    on conflict (employee_id) do update set
      time_entry_id = excluded.time_entry_id,
      client_entry_id = excluded.client_entry_id,
      job_id = excluded.job_id,
      job_name = excluded.job_name,
      job_address = excluded.job_address,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      accuracy_meters = excluded.accuracy_meters,
      last_location_at = excluded.last_location_at,
      last_sync_at = excluded.last_sync_at,
      tracking_mode = excluded.tracking_mode,
      task_status = excluded.task_status,
      permission_foreground = excluded.permission_foreground,
      permission_background = excluded.permission_background,
      platform = excluded.platform,
      app_version = excluded.app_version,
      last_error_code = excluded.last_error_code,
      metadata = excluded.metadata,
      updated_at = now();
  end if;
  return true;
end
$$;

create function public.register_push_token(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  result_id uuid;
begin
  if actor_id is null or not exists (
    select 1 from public.employees employee
    where employee.id = actor_id and employee.is_active
  ) then
    raise exception 'Active employee profile required';
  end if;
  insert into public.push_tokens (
    id, employee_id, expo_push_token, platform, device_push_token,
    app_version, is_active, last_registered_at, created_at, updated_at
  ) values (
    coalesce(nullif(payload ->> 'id', '')::uuid, extensions.gen_random_uuid()),
    actor_id,
    nullif(payload ->> 'expo_push_token', ''),
    coalesce(nullif(payload ->> 'platform', ''), 'unknown'),
    nullif(payload ->> 'device_push_token', ''),
    nullif(payload ->> 'app_version', ''),
    true,
    now(),
    now(),
    now()
  )
  on conflict (expo_push_token) do update set
    employee_id = actor_id,
    platform = excluded.platform,
    device_push_token = excluded.device_push_token,
    app_version = excluded.app_version,
    is_active = true,
    last_registered_at = now(),
    updated_at = now()
  returning id into result_id;
  return result_id;
end
$$;

create function public.set_job_assignment(
  requested_job_id uuid,
  requested_employee_id uuid,
  requested_active boolean
)
returns public.job_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.job_assignments%rowtype;
begin
  if not private.is_manager() then raise exception 'Manager access required'; end if;
  insert into public.job_assignments (
    id, job_id, employee_id, status, assigned_by, created_at, updated_at
  ) values (
    extensions.gen_random_uuid(),
    requested_job_id,
    requested_employee_id,
    case when requested_active then 'active' else 'inactive' end,
    auth.uid(),
    now(),
    now()
  )
  on conflict (job_id, employee_id) do update set
    status = excluded.status,
    assigned_by = auth.uid(),
    updated_at = now()
  returning * into result;
  return result;
end
$$;

create function public.save_job_budget(
  requested_job_id uuid,
  requested_budget_minutes integer,
  requested_hourly_rate_cents integer default null,
  requested_amount_including_tax_cents bigint default null,
  requested_notes text default null
)
returns public.job_budgets
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_budget public.job_budgets%rowtype;
  result public.job_budgets%rowtype;
begin
  if not private.is_manager() then raise exception 'Manager access required'; end if;
  select * into current_budget
  from public.job_budgets budget
  where budget.job_id = requested_job_id
    and budget.source = 'manual'
  order by budget.version desc
  limit 1
  for update;

  if found then
    update public.job_budgets budget
    set
      budget_minutes = requested_budget_minutes,
      hourly_rate_cents = requested_hourly_rate_cents,
      amount_including_tax_cents = requested_amount_including_tax_cents,
      notes = requested_notes,
      status = 'active',
      updated_at = now()
    where budget.id = current_budget.id
    returning * into result;
  else
    insert into public.job_budgets (
      id, job_id, version, status, budget_minutes, hourly_rate_cents,
      amount_including_tax_cents, notes, source, created_at, updated_at
    ) values (
      extensions.gen_random_uuid(),
      requested_job_id,
      1,
      'active',
      requested_budget_minutes,
      requested_hourly_rate_cents,
      requested_amount_including_tax_cents,
      requested_notes,
      'manual',
      now(),
      now()
    )
    returning * into result;
  end if;
  if requested_amount_including_tax_cents is not null then
    update public.jobs
    set contract_amount_cents = requested_amount_including_tax_cents,
        updated_at = now()
    where id = requested_job_id;
  end if;
  return result;
end
$$;

create function public.set_job_status(
  requested_job_id uuid,
  requested_status text
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.jobs%rowtype;
begin
  if not private.is_manager() then raise exception 'Manager access required'; end if;
  if requested_status not in ('scheduled', 'active', 'completed', 'cancelled', 'archived') then
    raise exception 'Invalid job status';
  end if;
  update public.jobs
  set
    status = requested_status,
    completed_on = case when requested_status = 'completed' then coalesce(completed_on, current_date) else completed_on end,
    archived_at = case when requested_status = 'archived' then coalesce(archived_at, now()) else archived_at end,
    updated_at = now()
  where id = requested_job_id
  returning * into result;
  if not found then raise exception 'Job not found'; end if;
  return result;
end
$$;

create function public.save_job_task(
  requested_job_id uuid,
  requested_task_id uuid,
  requested_title text,
  requested_notes text default null,
  requested_budget_minutes integer default null,
  requested_sort_order integer default 0
)
returns public.job_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.job_tasks%rowtype;
begin
  if not private.is_manager() then raise exception 'Manager access required'; end if;
  if nullif(btrim(requested_title), '') is null then raise exception 'Task title is required'; end if;

  if requested_task_id is not null then
    update public.job_tasks task
    set
      title = btrim(requested_title),
      notes = requested_notes,
      budget_minutes = requested_budget_minutes,
      sort_order = requested_sort_order,
      versions = task.versions || jsonb_build_array(
        jsonb_build_object(
          'changed_at', now(),
          'changed_by', auth.uid(),
          'title', task.title,
          'notes', task.notes,
          'budget_minutes', task.budget_minutes,
          'sort_order', task.sort_order
        )
      ),
      updated_at = now()
    where task.id = requested_task_id
      and task.job_id = requested_job_id
    returning * into result;
    if not found then raise exception 'Task not found'; end if;
  else
    insert into public.job_tasks (
      id, job_id, source_kind, source_item_id, title, notes,
      budget_minutes, sort_order, status, versions, metadata,
      created_at, updated_at
    ) values (
      extensions.gen_random_uuid(),
      requested_job_id,
      'manual',
      extensions.gen_random_uuid()::text,
      btrim(requested_title),
      requested_notes,
      requested_budget_minutes,
      requested_sort_order,
      'pending',
      '[]'::jsonb,
      jsonb_build_object('created_by', auth.uid()),
      now(),
      now()
    )
    returning * into result;
  end if;
  return result;
end
$$;

create function public.set_job_task_status(
  requested_task_id uuid,
  requested_status text
)
returns public.job_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  result public.job_tasks%rowtype;
begin
  if actor_id is null then raise exception 'Authentication required'; end if;
  if requested_status not in ('pending', 'in_progress', 'completed', 'cancelled') then
    raise exception 'Invalid task status';
  end if;
  if not exists (
    select 1
    from public.job_tasks task
    where task.id = requested_task_id
      and (
        private.is_manager()
        or exists (
          select 1
          from public.job_assignments assignment
          where assignment.job_id = task.job_id
            and assignment.employee_id = actor_id
            and assignment.status = 'active'
        )
      )
  ) then
    raise exception 'Task access denied';
  end if;
  update public.job_tasks task
  set
    status = requested_status,
    completed_by = case when requested_status = 'completed' then actor_id else null end,
    completed_at = case when requested_status = 'completed' then now() else null end,
    updated_at = now()
  where task.id = requested_task_id
  returning * into result;
  return result;
end
$$;

create function public.publish_quote(
  requested_lead_id uuid,
  requested_quote_id uuid,
  requested_name text,
  requested_amount_cents bigint,
  requested_calculator_doc jsonb,
  requested_status text default 'draft'
)
returns public.quotes
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.quotes%rowtype;
begin
  if not private.is_manager() then raise exception 'Manager access required'; end if;
  if requested_status not in ('draft', 'sent', 'accepted', 'declined', 'expired', 'superseded') then
    raise exception 'Invalid quote status';
  end if;
  insert into public.quotes (
    id, lead_id, name, status, amount_cents, calculator_doc,
    accepted_at, source, metadata, created_at, updated_at
  ) values (
    coalesce(requested_quote_id, extensions.gen_random_uuid()),
    requested_lead_id,
    coalesce(nullif(btrim(requested_name), ''), 'Quote'),
    requested_status,
    greatest(coalesce(requested_amount_cents, 0), 0),
    requested_calculator_doc,
    case when requested_status = 'accepted' then now() else null end,
    'app',
    jsonb_build_object('published_by', auth.uid()),
    now(),
    now()
  )
  on conflict (id) do update set
    name = excluded.name,
    amount_cents = excluded.amount_cents,
    calculator_doc = excluded.calculator_doc,
    status = excluded.status,
    accepted_at = case
      when excluded.status = 'accepted' then coalesce(public.quotes.accepted_at, now())
      else public.quotes.accepted_at
    end,
    metadata = public.quotes.metadata || jsonb_build_object('published_by', auth.uid()),
    updated_at = now()
  returning * into result;
  return result;
end
$$;

create function public.convert_lead_to_job(
  requested_lead_id uuid,
  requested_quote_id uuid,
  requested_name text default null,
  requested_scheduled_on date default null
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_lead public.leads%rowtype;
  source_quote public.quotes%rowtype;
  source_contact public.contacts%rowtype;
  result public.jobs%rowtype;
begin
  if not private.is_manager() then raise exception 'Manager access required'; end if;
  select * into source_lead from public.leads where id = requested_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;
  select * into source_quote
  from public.quotes
  where id = requested_quote_id and lead_id = requested_lead_id
  for update;
  if not found then raise exception 'Quote does not belong to the lead'; end if;
  select * into source_contact from public.contacts where id = source_lead.contact_id;

  insert into public.jobs (
    id, contact_id, lead_id, accepted_quote_id, name, status,
    contract_amount_cents, address_line_1, city, province, postal_code,
    formatted_address, scheduled_on, is_feed_visible, source,
    metadata, created_at, updated_at
  ) values (
    extensions.gen_random_uuid(),
    source_lead.contact_id,
    source_lead.id,
    source_quote.id,
    coalesce(nullif(btrim(requested_name), ''), source_quote.name, source_contact.name),
    case when requested_scheduled_on is null then 'active' else 'scheduled' end,
    source_quote.amount_cents,
    source_lead.address,
    source_lead.city,
    source_lead.province,
    source_lead.postal_code,
    source_lead.address,
    requested_scheduled_on,
    true,
    'app',
    jsonb_build_object('converted_by', auth.uid()),
    now(),
    now()
  )
  on conflict (accepted_quote_id) do update set
    name = coalesce(nullif(btrim(requested_name), ''), public.jobs.name),
    scheduled_on = coalesce(requested_scheduled_on, public.jobs.scheduled_on),
    status = case
      when requested_scheduled_on is not null and public.jobs.status = 'active' then 'scheduled'
      else public.jobs.status
    end,
    updated_at = now()
  returning * into result;

  update public.quotes
  set status = 'accepted', accepted_at = coalesce(accepted_at, now()), updated_at = now()
  where id = source_quote.id;
  update public.leads
  set status = 'won', updated_at = now()
  where id = source_lead.id;
  return result;
end
$$;

create function public.process_dripjobs_zapier_event(
  p_event_key text,
  p_event_type text,
  p_entity_id text,
  p_occurred_at timestamptz,
  p_payload jsonb,
  p_payload_sha256 text,
  p_data jsonb,
  p_is_test boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  namespace_id constant uuid := '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid;
  event_id uuid := extensions.uuid_generate_v5(namespace_id, 'integration-event:dripjobs:' || p_event_key);
  contact_id uuid;
  lead_id uuid;
  quote_id uuid;
  job_id uuid;
  deal_id text;
  contact_external_id text;
  normalized_email text;
  normalized_phone text;
  existing_status text;
begin
  if p_event_type not in ('lead.created', 'proposal.accepted') then
    raise exception 'Unsupported DripJobs event type';
  end if;

  select event.processing_status
  into existing_status
  from private.integration_events event
  where event.provider = 'dripjobs' and event.event_key = p_event_key
  for update;

  if found and existing_status in ('processed', 'ignored') then
    return jsonb_build_object(
      'ok', true,
      'status', 'duplicate',
      'event_id', event_id
    );
  elsif found then
    update private.integration_events event
    set
      attempt_count = event.attempt_count + 1,
      processing_status = 'processing',
      error_code = null,
      updated_at = now()
    where event.provider = 'dripjobs' and event.event_key = p_event_key;
  else
    insert into private.integration_events (
      id, provider, event_key, event_type, entity_type, entity_id,
      occurred_at, payload, payload_sha256, processing_status,
      is_test, attempt_count, received_at, created_at, updated_at
    ) values (
      event_id,
      'dripjobs',
      p_event_key,
      p_event_type,
      case when p_event_type = 'lead.created' then 'lead' else 'proposal' end,
      p_entity_id,
      p_occurred_at,
      coalesce(p_payload, '{}'::jsonb),
      p_payload_sha256,
      case when p_is_test then 'ignored' else 'processing' end,
      p_is_test,
      1,
      now(),
      now(),
      now()
    );
  end if;

  if p_is_test then
    return jsonb_build_object('ok', true, 'status', 'ignored', 'event_id', event_id);
  end if;

  begin
    deal_id := nullif(btrim(p_data ->> 'deal_id'), '');
    contact_external_id := nullif(btrim(p_data ->> 'contact_uuid'), '');
    normalized_email := nullif(lower(btrim(p_data ->> 'email')), '');
    normalized_phone := nullif(
      regexp_replace(coalesce(p_data ->> 'phone', ''), '[^0-9]+', '', 'g'),
      ''
    );

    if p_event_type = 'lead.created' then
      deal_id := coalesce(deal_id, p_entity_id);
    end if;

    if deal_id is null then
      raise exception 'An exact DripJobs deal_id is required';
    end if;

    if contact_external_id is not null then
      contact_id := extensions.uuid_generate_v5(
        namespace_id,
        'contact:dripjobs:' || contact_external_id
      );
    elsif normalized_email is not null and normalized_phone is not null then
      select (array_agg(contact.id order by contact.id))[1]
      into contact_id
      from public.contacts contact
      where contact.normalized_email = normalized_email
        and contact.normalized_phone = normalized_phone
      having count(*) = 1;
    end if;
    contact_id := coalesce(
      contact_id,
      extensions.uuid_generate_v5(namespace_id, 'contact:lead:' || deal_id)
    );

    insert into public.contacts (
      id, kind, dripjobs_contact_id, name, email, phone,
      normalized_email, normalized_phone, metadata, created_at, updated_at
    ) values (
      contact_id,
      'customer',
      contact_external_id,
      coalesce(nullif(btrim(p_data ->> 'contact_name'), ''), 'Unknown contact'),
      normalized_email,
      nullif(btrim(p_data ->> 'phone'), ''),
      normalized_email,
      normalized_phone,
      jsonb_build_object('source', 'dripjobs_live'),
      coalesce(p_occurred_at, now()),
      now()
    )
    on conflict (id) do update set
      dripjobs_contact_id = coalesce(public.contacts.dripjobs_contact_id, excluded.dripjobs_contact_id),
      name = case
        when excluded.name = 'Unknown contact' then public.contacts.name
        else excluded.name
      end,
      email = coalesce(excluded.email, public.contacts.email),
      phone = coalesce(excluded.phone, public.contacts.phone),
      normalized_email = coalesce(excluded.normalized_email, public.contacts.normalized_email),
      normalized_phone = coalesce(excluded.normalized_phone, public.contacts.normalized_phone),
      metadata = public.contacts.metadata || excluded.metadata,
      updated_at = now();

    lead_id := extensions.uuid_generate_v5(namespace_id, 'lead:' || deal_id);
    insert into public.leads (
      id, contact_id, dripjobs_deal_id, status, source,
      normalized_channel, address, postal_code, created_at,
      captured_at, updated_at, metadata
    ) values (
      lead_id,
      contact_id,
      deal_id,
      case when p_event_type = 'proposal.accepted' then 'won' else 'new' end,
      nullif(btrim(p_data ->> 'lead_source'), ''),
      'unknown',
      nullif(btrim(p_data ->> 'address'), ''),
      nullif(btrim(p_data ->> 'postal_code'), ''),
      coalesce(nullif(p_data ->> 'created_at', '')::timestamptz, p_occurred_at, now()),
      now(),
      now(),
      jsonb_build_object('source', 'dripjobs_live', 'last_event_id', event_id)
    )
    on conflict (dripjobs_deal_id) do update set
      contact_id = excluded.contact_id,
      status = case
        when p_event_type = 'proposal.accepted' then 'won'
        else public.leads.status
      end,
      source = coalesce(excluded.source, public.leads.source),
      address = coalesce(excluded.address, public.leads.address),
      postal_code = coalesce(excluded.postal_code, public.leads.postal_code),
      metadata = public.leads.metadata || excluded.metadata,
      updated_at = now()
    returning id into lead_id;

    if p_event_type = 'proposal.accepted' then
      quote_id := extensions.uuid_generate_v5(namespace_id, 'quote:' || p_entity_id);
      insert into public.quotes (
        id, lead_id, dripjobs_proposal_id, name, status,
        amount_cents, accepted_at, source, metadata, created_at, updated_at
      ) values (
        quote_id,
        lead_id,
        p_entity_id,
        coalesce(nullif(btrim(p_data ->> 'job_name'), ''), 'Proposal ' || p_entity_id),
        'accepted',
        round(coalesce(nullif(p_data ->> 'amount', '')::numeric, 0) * 100)::bigint,
        coalesce(nullif(p_data ->> 'accepted_at', '')::timestamptz, p_occurred_at, now()),
        'dripjobs',
        jsonb_build_object(
          'status', p_data ->> 'status',
          'label', p_data ->> 'label',
          'deal_stage', p_data ->> 'deal_stage',
          'salesperson', p_data ->> 'salesperson',
          'last_event_id', event_id
        ),
        now(),
        now()
      )
      on conflict (dripjobs_proposal_id) do update set
        lead_id = excluded.lead_id,
        name = excluded.name,
        status = 'accepted',
        amount_cents = excluded.amount_cents,
        accepted_at = coalesce(public.quotes.accepted_at, excluded.accepted_at),
        metadata = public.quotes.metadata || excluded.metadata,
        updated_at = now()
      returning id into quote_id;

      job_id := extensions.uuid_generate_v5(namespace_id, 'job:proposal:' || p_entity_id);
      insert into public.jobs (
        id, contact_id, lead_id, accepted_quote_id, name, status,
        contract_amount_cents, address_line_1, city, province,
        postal_code, country, formatted_address, companycam_project_ids,
        is_feed_visible, source, metadata, created_at, updated_at
      ) values (
        job_id,
        contact_id,
        lead_id,
        quote_id,
        coalesce(nullif(btrim(p_data ->> 'job_name'), ''), 'Job ' || p_entity_id),
        'active',
        round(coalesce(nullif(p_data ->> 'amount', '')::numeric, 0) * 100)::bigint,
        coalesce(nullif(btrim(p_data ->> 'street_address_1'), ''), nullif(btrim(p_data ->> 'address'), '')),
        nullif(btrim(p_data ->> 'city'), ''),
        nullif(btrim(p_data ->> 'state'), ''),
        nullif(btrim(p_data ->> 'postal_code'), ''),
        coalesce(nullif(btrim(p_data ->> 'country'), ''), 'CA'),
        nullif(btrim(p_data ->> 'address'), ''),
        '{}'::text[],
        true,
        'dripjobs',
        jsonb_build_object('last_event_id', event_id),
        now(),
        now()
      )
      on conflict (accepted_quote_id) do update set
        contact_id = excluded.contact_id,
        lead_id = excluded.lead_id,
        name = excluded.name,
        contract_amount_cents = excluded.contract_amount_cents,
        address_line_1 = coalesce(excluded.address_line_1, public.jobs.address_line_1),
        city = coalesce(excluded.city, public.jobs.city),
        province = coalesce(excluded.province, public.jobs.province),
        postal_code = coalesce(excluded.postal_code, public.jobs.postal_code),
        formatted_address = coalesce(excluded.formatted_address, public.jobs.formatted_address),
        metadata = public.jobs.metadata || excluded.metadata,
        updated_at = now()
      returning id into job_id;
    end if;

    update private.integration_events event
    set
      processing_status = 'processed',
      processed_at = now(),
      updated_at = now()
    where event.id = event_id;

    return jsonb_build_object(
      'ok', true,
      'status', 'processed',
      'event_id', event_id,
      'lead_id', lead_id,
      'quote_id', quote_id,
      'job_id', job_id
    );
  exception when others then
    update private.integration_events event
    set
      processing_status = 'failed',
      error_code = sqlstate,
      updated_at = now()
    where event.id = event_id;
    return jsonb_build_object(
      'ok', false,
      'status', 'failed',
      'event_id', event_id,
      'error_code', sqlstate
    );
  end;
end
$$;

create function public.save_calculator_rates(requested_rates jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_manager() then raise exception 'Manager access required'; end if;
  update public.app_config
  set
    settings = settings || jsonb_build_object('calculator_rates', coalesce(requested_rates, '{}'::jsonb)),
    updated_at = now()
  where id = 'default';
  return requested_rates;
end
$$;

create function public.get_integration_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_manager() then jsonb_build_object(
      'total_events', count(*),
      'processed_events', count(*) filter (where processing_status = 'processed'),
      'failed_events', count(*) filter (where processing_status = 'failed'),
      'ignored_test_events', count(*) filter (where is_test or processing_status = 'ignored'),
      'duplicate_deliveries', coalesce(sum(greatest(attempt_count - 1, 0)), 0),
      'live_lead_events', count(*) filter (where event_type = 'lead.created' and not is_test),
      'accepted_proposal_events', count(*) filter (where event_type = 'proposal.accepted' and not is_test),
      'last_received_at', max(received_at),
      'last_processed_at', max(processed_at)
    )
    else null
  end
  from private.integration_events
  where provider = 'dripjobs'
$$;

create function public.purge_expired_employee_location_points(
  retention_days integer default 60
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_count bigint;
begin
  if auth.role() <> 'service_role' and not private.is_manager() then
    raise exception 'Manager access required';
  end if;
  delete from public.employee_location_points
  where captured_at < now() - make_interval(days => greatest(retention_days, 1));
  get diagnostics removed_count = row_count;
  return removed_count;
end
$$;

revoke all on function public.record_location_update(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.register_push_token(jsonb)
  from public, anon, authenticated;
revoke all on function public.set_job_assignment(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.save_job_budget(uuid, integer, integer, bigint, text)
  from public, anon, authenticated;
revoke all on function public.set_job_status(uuid, text)
  from public, anon, authenticated;
revoke all on function public.save_job_task(uuid, uuid, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.set_job_task_status(uuid, text)
  from public, anon, authenticated;
revoke all on function public.publish_quote(uuid, uuid, text, bigint, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.convert_lead_to_job(uuid, uuid, text, date)
  from public, anon, authenticated;
revoke all on function public.process_dripjobs_zapier_event(
  text, text, text, timestamptz, jsonb, text, jsonb, boolean
) from public, anon, authenticated;
revoke all on function public.save_calculator_rates(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_integration_health()
  from public, anon, authenticated;
revoke all on function public.purge_expired_employee_location_points(integer)
  from public, anon, authenticated;

grant execute on function public.record_location_update(jsonb, jsonb)
  to authenticated, service_role;
grant execute on function public.register_push_token(jsonb)
  to authenticated, service_role;
grant execute on function public.set_job_assignment(uuid, uuid, boolean)
  to authenticated, service_role;
grant execute on function public.save_job_budget(uuid, integer, integer, bigint, text)
  to authenticated, service_role;
grant execute on function public.set_job_status(uuid, text)
  to authenticated, service_role;
grant execute on function public.save_job_task(uuid, uuid, text, text, integer, integer)
  to authenticated, service_role;
grant execute on function public.set_job_task_status(uuid, text)
  to authenticated, service_role;
grant execute on function public.publish_quote(uuid, uuid, text, bigint, jsonb, text)
  to authenticated, service_role;
grant execute on function public.convert_lead_to_job(uuid, uuid, text, date)
  to authenticated, service_role;
grant execute on function public.process_dripjobs_zapier_event(
  text, text, text, timestamptz, jsonb, text, jsonb, boolean
) to service_role;
grant execute on function public.save_calculator_rates(jsonb)
  to authenticated, service_role;
grant execute on function public.get_integration_health()
  to authenticated, service_role;
grant execute on function public.purge_expired_employee_location_points(integer)
  to authenticated, service_role;

select cron.schedule(
  'purge-expired-employee-location-points-v2',
  '30 3 * * *',
  'select public.purge_expired_employee_location_points(60);'
);

do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.job_tasks;
    alter publication supabase_realtime add table public.time_entries;
  end if;
end
$realtime$;

do $final_v2_shape_checks$
declare
  public_table_count integer;
  private_table_count integer;
  view_count integer;
  function_count integer;
  trigger_count integer;
  policy_count integer;
begin
  select count(*) into public_table_count
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE';
  select count(*) into private_table_count
  from information_schema.tables
  where table_schema = 'private' and table_type = 'BASE TABLE';
  select count(*) into view_count
  from information_schema.views where table_schema = 'public';
  select count(*) into function_count
  from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  where namespace.nspname in ('public', 'private');
  select count(*) into trigger_count
  from pg_trigger trigger
  join pg_class relation on relation.oid = trigger.tgrelid
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public' and not trigger.tgisinternal;
  select count(*) into policy_count
  from pg_policies where schemaname = 'public';

  if public_table_count <> 30 or private_table_count <> 1 then
    raise exception 'V2 shape failed: expected 30 public and 1 private tables, found % and %', public_table_count, private_table_count;
  end if;
  if view_count <> 5 then
    raise exception 'V2 shape failed: expected 5 public views, found %', view_count;
  end if;
  if function_count > 15 then
    raise exception 'V2 shape failed: expected no more than 15 functions, found %', function_count;
  end if;
  if trigger_count > 8 then
    raise exception 'V2 shape failed: expected no more than 8 triggers, found %', trigger_count;
  end if;
  if policy_count > 60 then
    raise exception 'V2 shape failed: expected no more than 60 policies, found %', policy_count;
  end if;
  if exists (
    select 1
    from public.quotes quote
    where quote.dripjobs_proposal_id is not null
      and quote.status = 'accepted'
      and (select count(*) from public.jobs job where job.accepted_quote_id = quote.id) <> 1
  ) then
    raise exception 'V2 shape failed: an accepted DripJobs proposal lacks exactly one job';
  end if;
  if exists (
    select 1
    from public.jobs job
    cross join lateral unnest(job.companycam_project_ids) companycam_project_id
    group by companycam_project_id
    having count(*) > 1
  ) then
    raise exception 'V2 shape failed: a CompanyCam project ID is linked to multiple jobs';
  end if;
end
$final_v2_shape_checks$;

commit;
