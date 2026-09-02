begin;

set local lock_timeout = '15s';
set local statement_timeout = '15min';

create table public.dripjobs_closing_ratio_appointment_snapshots (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  qualified_proposals_count integer not null check (qualified_proposals_count >= 0),
  accepted_proposals_count integer not null check (accepted_proposals_count >= 0),
  identity_matched_proposals_count integer not null check (
    identity_matched_proposals_count >= 0
  ),
  identity_matched_accepted_count integer not null check (
    identity_matched_accepted_count >= 0
  ),
  appointment_history_proposals_count integer not null check (
    appointment_history_proposals_count >= 0
  ),
  appointment_history_accepted_count integer not null check (
    appointment_history_accepted_count >= 0
  ),
  email_phone_match_count integer not null check (email_phone_match_count >= 0),
  phone_only_match_count integer not null check (phone_only_match_count >= 0),
  proposal_report_sha256 text not null check (
    proposal_report_sha256 ~ '^[0-9a-f]{64}$'
  ),
  lead_report_sha256 text not null check (
    lead_report_sha256 ~ '^[0-9a-f]{64}$'
  ),
  metadata jsonb not null default '{"validation_status":"pending"}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
  ),
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint dripjobs_closing_appointment_period_check check (
    period_start <= period_end
  ),
  constraint dripjobs_closing_appointment_validation_check check (
    coalesce(metadata ->> 'validation_status', '') in ('pending', 'accepted', 'rejected')
  ),
  constraint dripjobs_closing_appointment_totals_check check (
    accepted_proposals_count <= qualified_proposals_count
    and identity_matched_proposals_count <= qualified_proposals_count
    and identity_matched_accepted_count <= accepted_proposals_count
    and appointment_history_proposals_count <= identity_matched_proposals_count
    and appointment_history_accepted_count <= identity_matched_accepted_count
    and appointment_history_accepted_count <= appointment_history_proposals_count
    and email_phone_match_count + phone_only_match_count
      = identity_matched_proposals_count
  ),
  unique (
    period_start,
    period_end,
    proposal_report_sha256,
    lead_report_sha256
  )
);

create index dripjobs_closing_appointment_period_idx
  on public.dripjobs_closing_ratio_appointment_snapshots (
    period_start,
    period_end,
    captured_at desc
  );

alter table public.dripjobs_closing_ratio_appointment_snapshots
  enable row level security;

create policy "manager_read"
  on public.dripjobs_closing_ratio_appointment_snapshots
  for select to authenticated
  using ((select private.is_manager()));

revoke all on public.dripjobs_closing_ratio_appointment_snapshots
  from public, anon, authenticated, service_role;
grant select on public.dripjobs_closing_ratio_appointment_snapshots
  to authenticated;
grant select, insert on public.dripjobs_closing_ratio_appointment_snapshots
  to service_role;

insert into public.dripjobs_closing_ratio_appointment_snapshots (
  period_start,
  period_end,
  qualified_proposals_count,
  accepted_proposals_count,
  identity_matched_proposals_count,
  identity_matched_accepted_count,
  appointment_history_proposals_count,
  appointment_history_accepted_count,
  email_phone_match_count,
  phone_only_match_count,
  proposal_report_sha256,
  lead_report_sha256,
  metadata,
  captured_at
)
values (
  date '2026-08-01',
  date '2026-08-31',
  75,
  13,
  75,
  13,
  39,
  9,
  73,
  2,
  '8988fd0755961c5188a83df8041cb6c11c3a7be2587c68f04bb84b8622cc648c',
  'affdf258acd781e4c7218b0f0e127171eff8da2946e4d29e4af87f0570f76014',
  jsonb_build_object(
    'validation_status', 'accepted',
    'proposal_source_filename', 'TotalProposalsSent (4).csv',
    'lead_source_filename', 'Leads (14).csv',
    'match_rule', 'Exact normalized email plus phone; phone-only only when an email was blank. Lead record must have been created on or before proposal sent date.',
    'appointment_rule', 'At least one matched lead row has Status Scheduled and a nonblank appointment date.',
    'accepted_rule', 'Acceptance comes from the validated DripJobs 75-qualified-proposal cohort, not the proposal-list workflow status.',
    'reconciliation_result', '75 of 75 proposal rows matched: 73 by email plus phone and 2 by phone-only.'
  ),
  timestamptz '2026-09-02T00:10:34Z'
)
on conflict (
  period_start,
  period_end,
  proposal_report_sha256,
  lead_report_sha256
) do nothing;

create or replace view public.dripjobs_closing_ratio_row_metrics
with (security_invoker = true)
as
with reconciled_snapshots as (
  select
    snapshot.id,
    snapshot.period_start,
    snapshot.period_end,
    snapshot.qualified_proposals_count,
    snapshot.accepted_proposals_count,
    count(*) filter (where cohort_row.appointment_linked)::integer
      as appointment_linked_proposals_count,
    count(*) filter (
      where cohort_row.appointment_linked and cohort_row.is_accepted
    )::integer as appointment_linked_accepted_count,
    count(*) filter (
      where cohort_row.normalized_channel = 'paid_social'
    )::integer as paid_social_proposals_count,
    count(*) filter (
      where cohort_row.normalized_channel = 'paid_social'
        and cohort_row.is_accepted
    )::integer as paid_social_accepted_count,
    snapshot.captured_at,
    snapshot.created_at
  from public.dripjobs_closing_ratio_snapshots snapshot
  join public.dripjobs_closing_ratio_snapshot_rows cohort_row
    on cohort_row.snapshot_id = snapshot.id
  where snapshot.metadata ->> 'validation_status' = 'accepted'
  group by
    snapshot.id,
    snapshot.period_start,
    snapshot.period_end,
    snapshot.qualified_proposals_count,
    snapshot.accepted_proposals_count,
    snapshot.captured_at,
    snapshot.created_at
  having count(*) = snapshot.qualified_proposals_count
    and count(*) filter (
      where cohort_row.is_accepted
    ) = snapshot.accepted_proposals_count
),
latest_reconciled as (
  select distinct on (snapshot.period_start, snapshot.period_end)
    snapshot.*
  from reconciled_snapshots snapshot
  order by
    snapshot.period_start,
    snapshot.period_end,
    snapshot.captured_at desc,
    snapshot.created_at desc,
    snapshot.id desc
),
latest_appointment_history as (
  select distinct on (history.period_start, history.period_end)
    history.*
  from public.dripjobs_closing_ratio_appointment_snapshots history
  where history.metadata ->> 'validation_status' = 'accepted'
  order by
    history.period_start,
    history.period_end,
    history.captured_at desc,
    history.created_at desc,
    history.id desc
)
select
  snapshot.id as snapshot_id,
  snapshot.period_start,
  snapshot.period_end,
  snapshot.qualified_proposals_count,
  snapshot.accepted_proposals_count,
  snapshot.appointment_linked_proposals_count,
  snapshot.appointment_linked_accepted_count,
  snapshot.paid_social_proposals_count,
  snapshot.paid_social_accepted_count,
  snapshot.captured_at,
  history.identity_matched_proposals_count
    as appointment_history_matched_proposals_count,
  history.identity_matched_accepted_count
    as appointment_history_matched_accepted_count,
  history.appointment_history_proposals_count,
  history.appointment_history_accepted_count
from latest_reconciled snapshot
left join latest_appointment_history history
  on history.period_start = snapshot.period_start
  and history.period_end = snapshot.period_end
  and history.qualified_proposals_count = snapshot.qualified_proposals_count
  and history.accepted_proposals_count = snapshot.accepted_proposals_count;

revoke all on public.dripjobs_closing_ratio_row_metrics
  from public, anon, authenticated, service_role;
grant select on public.dripjobs_closing_ratio_row_metrics
  to authenticated, service_role;

comment on table public.dripjobs_closing_ratio_appointment_snapshots is
  'Audited, non-PII appointment-history aggregates for an exact validated DripJobs qualified-proposal cohort.';
comment on view public.dripjobs_closing_ratio_row_metrics is
  'Latest validated DripJobs qualified-proposal cohort with native appointment-link counts and separately audited customer appointment-history counts.';
comment on column public.dripjobs_closing_ratio_row_metrics.appointment_history_matched_proposals_count is
  'Proposal rows matched to the appointment-history source. The comparison is valid only when this equals qualified_proposals_count.';
comment on column public.dripjobs_closing_ratio_row_metrics.appointment_history_proposals_count is
  'Matched proposal rows whose customer had Scheduled appointment history under the source snapshot match rule.';

select pg_notify('pgrst', 'reload schema');

commit;
