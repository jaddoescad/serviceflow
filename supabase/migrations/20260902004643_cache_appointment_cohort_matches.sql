begin;

set local lock_timeout = '15s';
set local statement_timeout = '15min';

-- Keep the exact row-level calculation available for refreshes, but do not run
-- its customer-identity joins during every dashboard request.
alter view public.dripjobs_closing_ratio_row_metrics set schema private;
alter view private.dripjobs_closing_ratio_row_metrics
  rename to dripjobs_closing_ratio_row_metrics_calculated;

revoke all on private.dripjobs_closing_ratio_row_metrics_calculated
  from public, anon, authenticated, service_role;

create table public.dripjobs_closing_ratio_appointment_metrics_cache (
  snapshot_id uuid primary key
    references public.dripjobs_closing_ratio_snapshots(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  qualified_proposals_count integer not null check (qualified_proposals_count >= 0),
  accepted_proposals_count integer not null check (accepted_proposals_count >= 0),
  appointment_linked_proposals_count integer not null check (appointment_linked_proposals_count >= 0),
  appointment_linked_accepted_count integer not null check (appointment_linked_accepted_count >= 0),
  paid_social_proposals_count integer not null check (paid_social_proposals_count >= 0),
  paid_social_accepted_count integer not null check (paid_social_accepted_count >= 0),
  captured_at timestamptz not null,
  appointment_history_matched_proposals_count integer,
  appointment_history_matched_accepted_count integer,
  appointment_history_proposals_count integer,
  appointment_history_accepted_count integer,
  computed_at timestamptz not null default now(),
  constraint dripjobs_closing_appointment_cache_period_check check (
    period_start <= period_end
  )
);

create index dripjobs_closing_appointment_cache_period_idx
  on public.dripjobs_closing_ratio_appointment_metrics_cache (
    period_start,
    period_end
  );

alter table public.dripjobs_closing_ratio_appointment_metrics_cache
  enable row level security;

create policy "manager_read"
  on public.dripjobs_closing_ratio_appointment_metrics_cache
  for select to authenticated
  using ((select private.is_manager()));

revoke all on public.dripjobs_closing_ratio_appointment_metrics_cache
  from public, anon, authenticated, service_role;
grant select on public.dripjobs_closing_ratio_appointment_metrics_cache
  to authenticated;
grant select, insert, update, delete
  on public.dripjobs_closing_ratio_appointment_metrics_cache
  to service_role;

create or replace function public.refresh_dripjobs_closing_ratio_appointment_metrics()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  refreshed_count integer;
begin
  delete from public.dripjobs_closing_ratio_appointment_metrics_cache;

  insert into public.dripjobs_closing_ratio_appointment_metrics_cache (
    snapshot_id,
    period_start,
    period_end,
    qualified_proposals_count,
    accepted_proposals_count,
    appointment_linked_proposals_count,
    appointment_linked_accepted_count,
    paid_social_proposals_count,
    paid_social_accepted_count,
    captured_at,
    appointment_history_matched_proposals_count,
    appointment_history_matched_accepted_count,
    appointment_history_proposals_count,
    appointment_history_accepted_count,
    computed_at
  )
  select
    metric.snapshot_id,
    metric.period_start,
    metric.period_end,
    metric.qualified_proposals_count,
    metric.accepted_proposals_count,
    metric.appointment_linked_proposals_count,
    metric.appointment_linked_accepted_count,
    metric.paid_social_proposals_count,
    metric.paid_social_accepted_count,
    metric.captured_at,
    metric.appointment_history_matched_proposals_count,
    metric.appointment_history_matched_accepted_count,
    metric.appointment_history_proposals_count,
    metric.appointment_history_accepted_count,
    now()
  from private.dripjobs_closing_ratio_row_metrics_calculated metric;

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;

revoke all on function public.refresh_dripjobs_closing_ratio_appointment_metrics()
  from public, anon, authenticated, service_role;
grant execute on function public.refresh_dripjobs_closing_ratio_appointment_metrics()
  to service_role;

select public.refresh_dripjobs_closing_ratio_appointment_metrics();

create view public.dripjobs_closing_ratio_row_metrics
with (security_invoker = true)
as
select
  cache.snapshot_id,
  cache.period_start,
  cache.period_end,
  cache.qualified_proposals_count,
  cache.accepted_proposals_count,
  cache.appointment_linked_proposals_count,
  cache.appointment_linked_accepted_count,
  cache.paid_social_proposals_count,
  cache.paid_social_accepted_count,
  cache.captured_at,
  cache.appointment_history_matched_proposals_count,
  cache.appointment_history_matched_accepted_count,
  cache.appointment_history_proposals_count,
  cache.appointment_history_accepted_count
from public.dripjobs_closing_ratio_appointment_metrics_cache cache;

revoke all on public.dripjobs_closing_ratio_row_metrics
  from public, anon, authenticated, service_role;
grant select on public.dripjobs_closing_ratio_row_metrics
  to authenticated, service_role;

comment on table public.dripjobs_closing_ratio_appointment_metrics_cache is
  'Precomputed results of the generic row-level proposal/customer/appointment reconciliation for every validated cohort snapshot.';
comment on function public.refresh_dripjobs_closing_ratio_appointment_metrics() is
  'Atomically recalculates appointment-history metrics for every validated DripJobs qualified-proposal cohort.';
comment on view public.dripjobs_closing_ratio_row_metrics is
  'Fast dashboard view of precomputed generic appointment-history cohort metrics.';

select pg_notify('pgrst', 'reload schema');

commit;
