begin;

set local lock_timeout = '15s';
set local statement_timeout = '15min';

create table public.dripjobs_sales_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  sales_count integer not null check (sales_count >= 0),
  gross_sales_cents bigint not null check (gross_sales_cents >= 0),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_rows jsonb not null default '[]'::jsonb check (jsonb_typeof(source_rows) = 'array'),
  metadata jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint dripjobs_sales_report_period_check check (period_start <= period_end),
  constraint dripjobs_sales_report_row_count_check check (jsonb_array_length(source_rows) = sales_count),
  unique (period_start, period_end, source_sha256)
);

create index dripjobs_sales_report_period_idx
  on public.dripjobs_sales_report_snapshots(period_start, period_end, captured_at desc);

alter table public.dripjobs_sales_report_snapshots enable row level security;

create policy "manager_read"
  on public.dripjobs_sales_report_snapshots for select to authenticated
  using ((select private.is_manager()));

revoke all on public.dripjobs_sales_report_snapshots from anon, authenticated, service_role;
grant select on public.dripjobs_sales_report_snapshots to authenticated;
grant select, insert on public.dripjobs_sales_report_snapshots to service_role;

create view public.dripjobs_sales_report_latest
with (security_invoker = true)
as
select distinct on (snapshot.period_start, snapshot.period_end)
  snapshot.id,
  snapshot.period_start,
  snapshot.period_end,
  snapshot.sales_count,
  snapshot.gross_sales_cents,
  snapshot.source_sha256,
  snapshot.captured_at
from public.dripjobs_sales_report_snapshots snapshot
where snapshot.metadata ->> 'validation_status' = 'accepted'
order by
  snapshot.period_start,
  snapshot.period_end,
  snapshot.captured_at desc,
  snapshot.created_at desc,
  snapshot.id desc;

revoke all on public.dripjobs_sales_report_latest from anon, authenticated;
grant select on public.dripjobs_sales_report_latest to authenticated;

comment on table public.dripjobs_sales_report_snapshots is
  'Validated DripJobs Metrics > Sales period snapshots. Values preserve DripJobs report membership and include HST exactly as reported.';
comment on column public.dripjobs_sales_report_snapshots.gross_sales_cents is
  'Pipeline plus manual-invoice sales including HST, exactly as reported by DripJobs for the selected period.';
comment on view public.dripjobs_sales_report_latest is
  'Latest accepted DripJobs Sales snapshot for each exact reporting period.';

select pg_notify('pgrst', 'reload schema');

commit;
