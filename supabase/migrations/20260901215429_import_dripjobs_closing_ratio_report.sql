begin;

set local lock_timeout = '15s';
set local statement_timeout = '15min';

create table public.dripjobs_closing_ratio_snapshots (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  qualified_proposals_count integer not null check (qualified_proposals_count >= 0),
  accepted_proposals_count integer not null check (accepted_proposals_count >= 0),
  jobs_won_count integer not null check (jobs_won_count >= 0),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_rows jsonb not null check (
    jsonb_typeof(source_rows) = 'array'
    and jsonb_array_length(source_rows) > 0
  ),
  metadata jsonb not null default '{"validation_status":"pending"}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
  ),
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint dripjobs_closing_ratio_period_check check (period_start <= period_end),
  constraint dripjobs_closing_ratio_accepted_check check (
    accepted_proposals_count <= qualified_proposals_count
  ),
  constraint dripjobs_closing_ratio_validation_status_check check (
    coalesce(metadata ->> 'validation_status', '') in ('pending', 'accepted', 'rejected')
  ),
  unique (period_start, period_end, source_sha256)
);

create index dripjobs_closing_ratio_period_idx
  on public.dripjobs_closing_ratio_snapshots(period_start, period_end, captured_at desc);

alter table public.dripjobs_closing_ratio_snapshots enable row level security;

create policy "manager_read"
  on public.dripjobs_closing_ratio_snapshots for select to authenticated
  using ((select private.is_manager()));

revoke all on public.dripjobs_closing_ratio_snapshots
  from public, anon, authenticated, service_role;
grant select on public.dripjobs_closing_ratio_snapshots to authenticated;
grant select, insert on public.dripjobs_closing_ratio_snapshots to service_role;

create view public.dripjobs_closing_ratio_latest
with (security_invoker = true)
as
select distinct on (snapshot.period_start, snapshot.period_end)
  snapshot.id,
  snapshot.period_start,
  snapshot.period_end,
  snapshot.qualified_proposals_count,
  snapshot.accepted_proposals_count,
  snapshot.jobs_won_count,
  snapshot.source_sha256,
  snapshot.captured_at
from public.dripjobs_closing_ratio_snapshots snapshot
where snapshot.metadata ->> 'validation_status' = 'accepted'
order by
  snapshot.period_start,
  snapshot.period_end,
  snapshot.captured_at desc,
  snapshot.created_at desc,
  snapshot.id desc;

revoke all on public.dripjobs_closing_ratio_latest from public, anon, authenticated;
grant select on public.dripjobs_closing_ratio_latest to authenticated;

insert into public.dripjobs_closing_ratio_snapshots (
  period_start,
  period_end,
  qualified_proposals_count,
  accepted_proposals_count,
  jobs_won_count,
  source_sha256,
  source_rows,
  metadata,
  captured_at
)
values
  (
    date '2026-07-01',
    date '2026-07-31',
    54,
    12,
    15,
    '175acd91c3af0c0a78abd8b3740549b04a9016eaadad07f9564c9183ae16c179',
    '[
      {"metric":"qualified_proposals","count":54},
      {"metric":"accepted_proposals","count":12},
      {"metric":"jobs_won","count":15}
    ]'::jsonb,
    jsonb_build_object(
      'validation_status', 'accepted',
      'source_type', 'dripjobs_metrics_closing_ratio_v1',
      'source_url', 'https://app.dripjobs.com/metrics?start=07%2F01%2F2026&end=07%2F31%2F2026',
      'source_hash_basis', 'UTF-8 JSON.stringify({period_start,period_end,qualified_proposals_count,accepted_proposals_count,jobs_won_count,source_rows}) in listed property and stored row order',
      'company_timezone', 'America/Toronto',
      'capture_method', 'authenticated_metrics_page_previous_period_comparison',
      'closing_ratio_percent', 22.2,
      'qualified_definition', 'Qualified proposals are the denominator reported by DripJobs; accepted proposals are the accepted subset of that exact cohort.',
      'jobs_won_definition', 'Accepted proposals in the selected period regardless of proposal sent date; this is separate from the closing-ratio cohort.'
    ),
    timestamptz '2026-09-01T21:37:00Z'
  ),
  (
    date '2026-08-01',
    date '2026-08-31',
    75,
    13,
    18,
    '6fd27410a962ed6dae992e3659e34e2481fca76848ddd69f2eed970cb2e09169',
    '[
      {"status":"accepted_signed","count":11},
      {"status":"accepted_no_signature","count":2},
      {"status":"accepted_on_site","count":0},
      {"status":"pending","count":62},
      {"status":"rejected","count":0}
    ]'::jsonb,
    jsonb_build_object(
      'validation_status', 'accepted',
      'source_type', 'dripjobs_metrics_closing_ratio_v1',
      'source_url', 'https://app.dripjobs.com/metrics?start=08%2F01%2F2026&end=08%2F31%2F2026',
      'source_hash_basis', 'UTF-8 JSON.stringify({period_start,period_end,qualified_proposals_count,accepted_proposals_count,jobs_won_count,source_rows}) in listed property and stored row order',
      'company_timezone', 'America/Toronto',
      'capture_method', 'authenticated_metrics_page_and_breakdown',
      'closing_ratio_percent', 17.3,
      'qualified_definition', 'Qualified proposals are the denominator reported by DripJobs; accepted proposals are the accepted subset of that exact cohort.',
      'jobs_won_definition', 'Accepted proposals in the selected period regardless of proposal sent date; this is separate from the closing-ratio cohort.'
    ),
    timestamptz '2026-09-01T21:37:00Z'
  )
on conflict (period_start, period_end, source_sha256) do nothing;

comment on table public.dripjobs_closing_ratio_snapshots is
  'Validated DripJobs closing-ratio snapshots. Qualified and accepted counts preserve the exact same proposal cohort; Jobs Won is stored separately.';
comment on column public.dripjobs_closing_ratio_snapshots.accepted_proposals_count is
  'Accepted proposals from the exact qualified-proposal cohort used by DripJobs Closing Ratio.';
comment on column public.dripjobs_closing_ratio_snapshots.jobs_won_count is
  'DripJobs Jobs Won for the selected period. This is not the closing-ratio numerator.';
comment on view public.dripjobs_closing_ratio_latest is
  'Latest accepted DripJobs closing-ratio snapshot for each exact reporting period.';

select pg_notify('pgrst', 'reload schema');

commit;
