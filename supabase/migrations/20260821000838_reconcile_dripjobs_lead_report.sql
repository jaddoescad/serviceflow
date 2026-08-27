begin;

set local lock_timeout = '15s';
set local statement_timeout = '15min';

alter table public.leads
  add column if not exists marketing_eligible boolean not null default true,
  add column if not exists marketing_exclusion_reason text;

alter table public.leads
  drop constraint if exists leads_marketing_exclusion_reason_check;
alter table public.leads
  add constraint leads_marketing_exclusion_reason_check check (
    (marketing_eligible and marketing_exclusion_reason is null)
    or (
      not marketing_eligible
      and marketing_exclusion_reason in (
        'test',
        'vendor_test',
        'migration_batch',
        'legacy_companycam',
        'manual'
      )
    )
  );

update public.leads
set
  marketing_eligible = false,
  marketing_exclusion_reason = 'legacy_companycam'
where source = 'legacy_companycam';

create index if not exists leads_marketing_eligible_created_idx
  on public.leads(created_at desc)
  where marketing_eligible;

comment on column public.leads.marketing_eligible is
  'Whether this row may be used as a marketing lead denominator. Operational fallback leads remain visible but can be excluded from CAC/CPL.';
comment on column public.leads.marketing_exclusion_reason is
  'Auditable reason a lead is excluded from marketing metrics; exclusion never deletes the operational record.';

create table public.dripjobs_lead_report_rows (
  source_document_id uuid not null references public.documents(id) on delete restrict,
  source_row_number integer not null check (source_row_number > 1),
  row_fingerprint text not null check (row_fingerprint ~ '^[0-9a-f]{64}$'),
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  normalized_email text,
  normalized_phone text,
  raw_source text not null,
  normalized_channel text not null,
  label text,
  salesperson text not null,
  deal_name text,
  created_on date not null,
  appointment_at_local timestamp without time zone,
  appointment_on date generated always as (appointment_at_local::date) stored,
  booking_status text not null check (booking_status in ('Scheduled', 'Not Booked')),
  marketing_eligible boolean not null,
  exclusion_reason text check (
    exclusion_reason is null
    or exclusion_reason in ('test', 'vendor_test', 'migration_batch')
  ),
  matched_lead_id uuid references public.leads(id) on delete set null,
  match_status text not null check (
    match_status in ('matched', 'unmatched', 'ambiguous', 'excluded')
  ),
  match_method text,
  match_confidence numeric(4,3) check (
    match_confidence is null
    or (match_confidence >= 0 and match_confidence <= 1)
  ),
  source_payload jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (source_document_id, source_row_number),
  constraint dripjobs_lead_report_eligibility_check check (
    (marketing_eligible and exclusion_reason is null)
    or (not marketing_eligible and exclusion_reason is not null)
  ),
  constraint dripjobs_lead_report_match_check check (
    (match_status = 'matched' and matched_lead_id is not null)
    or (match_status = 'excluded')
    or (match_status in ('unmatched', 'ambiguous') and matched_lead_id is null)
  )
);

create index dripjobs_lead_report_rows_created_idx
  on public.dripjobs_lead_report_rows(created_on desc, normalized_channel);
create index dripjobs_lead_report_rows_eligible_idx
  on public.dripjobs_lead_report_rows(created_on desc)
  where marketing_eligible;
create index dripjobs_lead_report_rows_matched_idx
  on public.dripjobs_lead_report_rows(matched_lead_id)
  where matched_lead_id is not null;
create index dripjobs_lead_report_rows_fingerprint_idx
  on public.dripjobs_lead_report_rows(row_fingerprint);

alter table public.dripjobs_lead_report_rows enable row level security;

create policy "manager_read"
  on public.dripjobs_lead_report_rows for select to authenticated
  using (private.is_manager());

revoke all on public.dripjobs_lead_report_rows from anon, authenticated;
grant select on public.dripjobs_lead_report_rows to authenticated;
grant select, insert, update on public.dripjobs_lead_report_rows to service_role;

create or replace view public.dripjobs_lead_report_latest
with (security_invoker = true)
as
with latest_document as (
  select document.id
  from public.documents document
  where document.kind = 'dripjobs_lead_report'
    and document.metadata ->> 'validation_status' = 'accepted'
  order by document.captured_at desc, document.created_at desc, document.id desc
  limit 1
)
select report.*
from public.dripjobs_lead_report_rows report
join latest_document on latest_document.id = report.source_document_id;

create or replace view public.marketing_lead_facts
with (security_invoker = true)
as
select
  report.source_document_id,
  report.source_row_number,
  report.row_fingerprint,
  report.matched_lead_id as lead_id,
  report.created_on,
  report.appointment_on,
  report.appointment_at_local,
  report.booking_status,
  report.raw_source,
  report.normalized_channel,
  report.salesperson,
  report.marketing_eligible,
  report.exclusion_reason,
  report.match_status,
  report.captured_at
from public.dripjobs_lead_report_latest report;

revoke all on public.dripjobs_lead_report_latest from anon, authenticated;
revoke all on public.marketing_lead_facts from anon, authenticated;
grant select on public.dripjobs_lead_report_latest to authenticated;
grant select on public.marketing_lead_facts to authenticated;

comment on table public.dripjobs_lead_report_rows is
  'Lossless DripJobs Leads.csv snapshot rows. Test and migration rows are retained with explicit metric eligibility; matching never relies on email alone.';
comment on view public.dripjobs_lead_report_latest is
  'Every row from the latest accepted DripJobs lead report snapshot, including excluded and unmatched evidence.';
comment on view public.marketing_lead_facts is
  'Dashboard-safe lead and appointment facts from the latest accepted DripJobs report. Filter marketing_eligible for CPL/CAC denominators.';

select pg_notify('pgrst', 'reload schema');

commit;
