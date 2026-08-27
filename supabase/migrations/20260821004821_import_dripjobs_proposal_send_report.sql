begin;

set local lock_timeout = '15s';
set local statement_timeout = '15min';

create table public.dripjobs_proposal_report_rows (
  source_document_id uuid not null references public.documents(id) on delete restrict,
  source_row_number integer not null check (source_row_number > 1),
  row_fingerprint text not null check (row_fingerprint ~ '^[0-9a-f]{64}$'),
  proposal_key text not null,
  proposal_id text check (proposal_id is null or proposal_id ~ '^[0-9]{7}$'),
  proposal_name text not null,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  normalized_email text,
  normalized_phone text,
  salesperson text not null,
  deal_name text not null,
  raw_source text not null,
  normalized_channel text not null,
  sent_on date not null,
  sent_by text not null,
  appointment_linked boolean not null,
  report_status text not null check (
    report_status in ('Pending', 'Cancelled', 'Completed', 'Scheduled', 'Accepted')
  ),
  proposal_value_cents bigint not null check (proposal_value_cents >= 0),
  delivery_method text not null check (delivery_method in ('Email', 'SMS', 'Not Sent')),
  is_delivered boolean not null,
  marketing_eligible boolean not null,
  exclusion_reason text check (
    exclusion_reason is null
    or exclusion_reason in ('test', 'vendor_test', 'matched_ineligible_lead', 'manual')
  ),
  matched_lead_report_document_id uuid,
  matched_lead_report_row_number integer,
  matched_lead_id uuid references public.leads(id) on delete set null,
  matched_quote_id uuid references public.quotes(id) on delete set null,
  matched_job_id uuid references public.jobs(id) on delete set null,
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
  foreign key (matched_lead_report_document_id, matched_lead_report_row_number)
    references public.dripjobs_lead_report_rows(source_document_id, source_row_number)
    on delete set null,
  constraint dripjobs_proposal_report_delivery_check check (
    is_delivered = (delivery_method in ('Email', 'SMS'))
  ),
  constraint dripjobs_proposal_report_eligibility_check check (
    (marketing_eligible and exclusion_reason is null)
    or (not marketing_eligible and exclusion_reason is not null)
  ),
  constraint dripjobs_proposal_report_match_check check (
    (
      match_status = 'matched'
      and (
        matched_lead_id is not null
        or (
          matched_lead_report_document_id is not null
          and matched_lead_report_row_number is not null
        )
      )
    )
    or match_status in ('unmatched', 'ambiguous', 'excluded')
  ),
  constraint dripjobs_proposal_report_lead_report_match_check check (
    (matched_lead_report_document_id is null) = (matched_lead_report_row_number is null)
  )
);

create index dripjobs_proposal_report_rows_sent_idx
  on public.dripjobs_proposal_report_rows(sent_on desc, normalized_channel);
create index dripjobs_proposal_report_rows_key_idx
  on public.dripjobs_proposal_report_rows(proposal_key, sent_on, source_row_number);
create index dripjobs_proposal_report_rows_proposal_id_idx
  on public.dripjobs_proposal_report_rows(proposal_id)
  where proposal_id is not null;
create index dripjobs_proposal_report_rows_lead_idx
  on public.dripjobs_proposal_report_rows(matched_lead_id)
  where matched_lead_id is not null;
create index dripjobs_proposal_report_rows_lead_report_idx
  on public.dripjobs_proposal_report_rows(
    matched_lead_report_document_id,
    matched_lead_report_row_number
  )
  where matched_lead_report_document_id is not null;
create index dripjobs_proposal_report_rows_quote_idx
  on public.dripjobs_proposal_report_rows(matched_quote_id)
  where matched_quote_id is not null;
create index dripjobs_proposal_report_rows_funnel_idx
  on public.dripjobs_proposal_report_rows(sent_on desc, proposal_key)
  where is_delivered and marketing_eligible;

alter table public.dripjobs_proposal_report_rows enable row level security;

create policy "manager_read"
  on public.dripjobs_proposal_report_rows for select to authenticated
  using (private.is_manager());

revoke all on public.dripjobs_proposal_report_rows from anon, authenticated;
grant select on public.dripjobs_proposal_report_rows to authenticated;
grant select, insert, update on public.dripjobs_proposal_report_rows to service_role;

create view public.dripjobs_proposal_report_latest
with (security_invoker = true)
as
with latest_document as (
  select document.id
  from public.documents document
  where document.kind = 'dripjobs_proposal_sent_report'
    and document.metadata ->> 'validation_status' = 'accepted'
  order by document.captured_at desc, document.created_at desc, document.id desc
  limit 1
)
select report.*
from public.dripjobs_proposal_report_rows report
join latest_document on latest_document.id = report.source_document_id;

create view public.marketing_proposal_delivery_events
with (security_invoker = true)
as
select
  report.source_document_id,
  report.source_row_number,
  report.row_fingerprint,
  report.proposal_key,
  report.proposal_id,
  report.proposal_name,
  report.matched_lead_report_document_id,
  report.matched_lead_report_row_number,
  report.matched_lead_id as lead_id,
  report.matched_quote_id as imported_quote_id,
  report.matched_job_id as imported_job_id,
  report.sent_on,
  report.proposal_value_cents,
  report.delivery_method,
  report.report_status,
  report.raw_source,
  report.normalized_channel,
  report.salesperson,
  report.match_status,
  report.match_method,
  report.match_confidence,
  report.captured_at
from public.dripjobs_proposal_report_latest report
where report.is_delivered
  and report.marketing_eligible;

create view public.marketing_proposal_facts
with (security_invoker = true)
as
with delivered as (
  select
    event.*,
    row_number() over (
      partition by event.proposal_key
      order by event.sent_on, event.source_row_number
    ) as delivery_rank,
    count(*) over (partition by event.proposal_key) as delivery_event_count,
    min(event.proposal_value_cents) over (partition by event.proposal_key) as minimum_reported_value_cents,
    max(event.proposal_value_cents) over (partition by event.proposal_key) as maximum_reported_value_cents
  from public.marketing_proposal_delivery_events event
)
select
  delivered.source_document_id,
  delivered.source_row_number,
  delivered.row_fingerprint,
  delivered.proposal_key,
  delivered.proposal_id,
  delivered.proposal_name,
  coalesce(quote.lead_id, delivered.lead_id) as lead_id,
  quote.id as quote_id,
  job.id as job_id,
  delivered.sent_on as first_sent_on,
  delivered.delivery_method as first_delivery_method,
  delivered.delivery_event_count,
  delivered.proposal_value_cents,
  delivered.minimum_reported_value_cents,
  delivered.maximum_reported_value_cents,
  delivered.minimum_reported_value_cents <> delivered.maximum_reported_value_cents as has_value_conflict,
  delivered.raw_source,
  delivered.normalized_channel,
  delivered.salesperson,
  quote.accepted_at,
  (quote.accepted_at is not null and job.id is not null) as is_accepted,
  delivered.match_status,
  delivered.match_method,
  delivered.match_confidence,
  delivered.captured_at
from delivered
left join public.quotes quote
  on quote.dripjobs_proposal_id = delivered.proposal_id
left join public.jobs job
  on job.accepted_quote_id = quote.id
where delivered.delivery_rank = 1;

revoke all on public.dripjobs_proposal_report_latest from anon, authenticated;
revoke all on public.marketing_proposal_delivery_events from anon, authenticated;
revoke all on public.marketing_proposal_facts from anon, authenticated;
grant select on public.dripjobs_proposal_report_latest to authenticated;
grant select on public.marketing_proposal_delivery_events to authenticated;
grant select on public.marketing_proposal_facts to authenticated;

comment on table public.dripjobs_proposal_report_rows is
  'Lossless DripJobs Total Proposals Sent report snapshots. Report status is preserved as source evidence but is not treated as won/lost authority.';
comment on column public.dripjobs_proposal_report_rows.proposal_key is
  'Stable funnel identity: exact seven-digit DripJobs proposal number when present, otherwise a contact/name/value fingerprint.';
comment on column public.dripjobs_proposal_report_rows.proposal_value_cents is
  'Proposal Value exactly as exported by DripJobs. Tax inclusion is intentionally not inferred from this report.';
comment on view public.marketing_proposal_delivery_events is
  'All eligible Email/SMS delivery events from the latest accepted proposal report; resends remain visible.';
comment on view public.marketing_proposal_facts is
  'One first-delivery row per proposal key for funnel conversion. Acceptance is joined from canonical DripJobs quotes and jobs, never inferred from report status.';

select pg_notify('pgrst', 'reload schema');

commit;
