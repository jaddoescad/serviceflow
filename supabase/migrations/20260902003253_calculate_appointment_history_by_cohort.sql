begin;

set local lock_timeout = '15s';
set local statement_timeout = '15min';

-- Proposal sends are events. Keep each event's newest captured version instead of
-- replacing all history with whichever filtered export happened to be imported last.
create or replace view public.dripjobs_proposal_report_latest
with (security_invoker = true)
as
with accepted_documents as (
  select
    document.id,
    document.captured_at,
    document.created_at
  from public.documents document
  where document.kind = 'dripjobs_proposal_sent_report'
    and document.metadata ->> 'validation_status' = 'accepted'
)
select report.*
from public.dripjobs_proposal_report_rows report
join accepted_documents source_document
  on source_document.id = report.source_document_id
where not exists (
  select 1
  from public.dripjobs_proposal_report_rows newer_report
  join accepted_documents newer_document
    on newer_document.id = newer_report.source_document_id
  where newer_report.proposal_key = report.proposal_key
    and newer_report.sent_on = report.sent_on
    and newer_report.delivery_method = report.delivery_method
    and (
      newer_document.captured_at,
      newer_document.created_at,
      newer_document.id
    ) > (
      source_document.captured_at,
      source_document.created_at,
      source_document.id
    )
);

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
    and count(*) filter (where cohort_row.is_accepted)
      = snapshot.accepted_proposals_count
), latest_reconciled as (
  select distinct on (snapshot.period_start, snapshot.period_end)
    snapshot.*
  from reconciled_snapshots snapshot
  order by
    snapshot.period_start,
    snapshot.period_end,
    snapshot.captured_at desc,
    snapshot.created_at desc,
    snapshot.id desc
), cohort_rows as (
  select
    snapshot.period_start,
    snapshot.period_end,
    cohort_row.*
  from latest_reconciled snapshot
  join public.dripjobs_closing_ratio_snapshot_rows cohort_row
    on cohort_row.snapshot_id = snapshot.id
), candidate_scores as (
  select
    cohort_row.snapshot_id,
    cohort_row.source_row_number,
    report.source_document_id,
    report.source_row_number as proposal_source_row_number,
    case
      when cohort_row.proposal_id is not null
        and report.proposal_id = cohort_row.proposal_id
        and report.sent_on = cohort_row.sent_on
        and report.delivery_method = cohort_row.delivery_method
        and report.proposal_value_cents = cohort_row.proposal_value_cents
        then 1
      when cohort_row.proposal_id is not null
        and report.proposal_id = cohort_row.proposal_id
        and report.sent_on = cohort_row.sent_on
        and report.delivery_method = cohort_row.delivery_method
        then 2
      when cohort_row.proposal_id is not null
        and report.proposal_id = cohort_row.proposal_id
        and report.proposal_value_cents = cohort_row.proposal_value_cents
        then 3
      when cohort_row.proposal_id is not null
        and report.proposal_id = cohort_row.proposal_id
        then 4
      when report.sent_on = cohort_row.sent_on
        and report.proposal_value_cents = cohort_row.proposal_value_cents
        and report.raw_source = cohort_row.raw_source
        and report.delivery_method = cohort_row.delivery_method
        then 5
    end as match_score
  from cohort_rows cohort_row
  join public.dripjobs_proposal_report_latest report
    on (
      cohort_row.proposal_id is not null
      and report.proposal_id = cohort_row.proposal_id
    ) or (
      report.sent_on = cohort_row.sent_on
      and report.proposal_value_cents = cohort_row.proposal_value_cents
      and report.raw_source = cohort_row.raw_source
      and report.delivery_method = cohort_row.delivery_method
    )
), ranked_candidates as (
  select
    candidate.*,
    min(candidate.match_score) over (
      partition by candidate.snapshot_id, candidate.source_row_number
    ) as best_score
  from candidate_scores candidate
), unique_matches as (
  select
    candidate.snapshot_id,
    candidate.source_row_number,
    (array_agg(candidate.source_document_id))[1] as source_document_id,
    min(candidate.proposal_source_row_number) as proposal_source_row_number
  from ranked_candidates candidate
  where candidate.match_score = candidate.best_score
  group by candidate.snapshot_id, candidate.source_row_number
  having count(*) = 1
), classified as (
  select
    cohort_row.snapshot_id,
    cohort_row.source_row_number,
    cohort_row.is_accepted,
    proposal.source_document_id is not null as proposal_matched,
    coalesce(appointment.identity_matched, false) as identity_matched,
    coalesce(appointment.had_appointment, false) as had_appointment
  from cohort_rows cohort_row
  left join unique_matches proposal_match
    on proposal_match.snapshot_id = cohort_row.snapshot_id
    and proposal_match.source_row_number = cohort_row.source_row_number
  left join public.dripjobs_proposal_report_latest proposal
    on proposal.source_document_id = proposal_match.source_document_id
    and proposal.source_row_number = proposal_match.proposal_source_row_number
  left join lateral (
    select
      true as identity_matched,
      bool_or(
        lead_report.booking_status = 'Scheduled'
        and lead_report.appointment_on is not null
      ) as had_appointment
    from public.dripjobs_lead_report_latest lead_report
    where lead_report.marketing_eligible
      and lead_report.created_on <= cohort_row.sent_on
      and (
        (
          proposal.matched_lead_id is not null
          and lead_report.matched_lead_id = proposal.matched_lead_id
        ) or (
          proposal.normalized_email is not null
          and proposal.normalized_phone is not null
          and lead_report.normalized_email = proposal.normalized_email
          and lead_report.normalized_phone = proposal.normalized_phone
        ) or (
          proposal.normalized_phone is not null
          and lead_report.normalized_phone = proposal.normalized_phone
          and (
            proposal.normalized_email is null
            or lead_report.normalized_email is null
          )
        )
      )
    having count(*) > 0
  ) appointment on true
), appointment_history as (
  select
    classified.snapshot_id,
    count(*) filter (
      where classified.proposal_matched and classified.identity_matched
    )::integer as matched_proposals_count,
    count(*) filter (
      where classified.proposal_matched
        and classified.identity_matched
        and classified.is_accepted
    )::integer as matched_accepted_count,
    count(*) filter (
      where classified.proposal_matched
        and classified.identity_matched
        and classified.had_appointment
    )::integer as appointment_proposals_count,
    count(*) filter (
      where classified.proposal_matched
        and classified.identity_matched
        and classified.had_appointment
        and classified.is_accepted
    )::integer as appointment_accepted_count
  from classified
  group by classified.snapshot_id
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
  history.matched_proposals_count
    as appointment_history_matched_proposals_count,
  history.matched_accepted_count
    as appointment_history_matched_accepted_count,
  history.appointment_proposals_count
    as appointment_history_proposals_count,
  history.appointment_accepted_count
    as appointment_history_accepted_count
from latest_reconciled snapshot
left join appointment_history history
  on history.snapshot_id = snapshot.id;

revoke all on public.dripjobs_proposal_report_latest
  from public, anon, authenticated, service_role;
grant select on public.dripjobs_proposal_report_latest
  to authenticated, service_role;

revoke all on public.dripjobs_closing_ratio_row_metrics
  from public, anon, authenticated, service_role;
grant select on public.dripjobs_closing_ratio_row_metrics
  to authenticated, service_role;

comment on view public.dripjobs_proposal_report_latest is
  'Newest captured version of every DripJobs proposal-send event across accepted full and date-filtered exports.';
comment on view public.dripjobs_closing_ratio_row_metrics is
  'Latest validated qualified-proposal cohort for every period, with appointment history calculated by row-level proposal and customer matching.';
comment on column public.dripjobs_closing_ratio_row_metrics.appointment_history_matched_proposals_count is
  'Cohort proposal rows uniquely matched to proposal and customer appointment-history evidence.';
comment on column public.dripjobs_closing_ratio_row_metrics.appointment_history_proposals_count is
  'Matched cohort proposal rows whose customer had Scheduled appointment history on or before the proposal sent date.';

select pg_notify('pgrst', 'reload schema');

commit;
