begin;

set local lock_timeout = '15s';
set local statement_timeout = '15min';

create table if not exists public.dripjobs_set_rate_snapshots (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  contacts_created_count integer not null check (contacts_created_count >= 0),
  booked_contacts_count integer not null check (booked_contacts_count >= 0),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_rows jsonb not null default '[]'::jsonb check (jsonb_typeof(source_rows) = 'array'),
  metadata jsonb not null check (jsonb_typeof(metadata) = 'object'),
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint dripjobs_set_rate_period_check check (period_start <= period_end),
  constraint dripjobs_set_rate_booked_check check (
    booked_contacts_count <= contacts_created_count
  ),
  constraint dripjobs_set_rate_validation_status_check check (
    metadata ->> 'validation_status' in ('pending', 'accepted', 'rejected')
  ),
  unique (period_start, period_end, source_sha256)
);

create index if not exists dripjobs_set_rate_period_idx
  on public.dripjobs_set_rate_snapshots(period_start, period_end, captured_at desc);

alter table public.dripjobs_set_rate_snapshots enable row level security;

do $policy$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'dripjobs_set_rate_snapshots'
      and policyname = 'manager_read'
  ) then
    create policy "manager_read"
      on public.dripjobs_set_rate_snapshots for select to authenticated
      using ((select private.is_manager()));
  end if;
end
$policy$;

revoke all on public.dripjobs_set_rate_snapshots from anon, authenticated, service_role;
grant select on public.dripjobs_set_rate_snapshots to authenticated;
grant select, insert on public.dripjobs_set_rate_snapshots to service_role;

create or replace view public.dripjobs_set_rate_latest
with (security_invoker = true)
as
select distinct on (snapshot.period_start, snapshot.period_end)
  snapshot.id,
  snapshot.period_start,
  snapshot.period_end,
  snapshot.contacts_created_count,
  snapshot.booked_contacts_count,
  snapshot.source_sha256,
  snapshot.captured_at
from public.dripjobs_set_rate_snapshots snapshot
where snapshot.metadata ->> 'validation_status' = 'accepted'
order by
  snapshot.period_start,
  snapshot.period_end,
  snapshot.captured_at desc,
  snapshot.created_at desc,
  snapshot.id desc;

revoke all on public.dripjobs_set_rate_latest from anon, authenticated;
grant select on public.dripjobs_set_rate_latest to authenticated;

comment on table public.dripjobs_set_rate_snapshots is
  'Validated DripJobs Metrics > Leads To Appointments cohort snapshots. Contacts are grouped by creation period and counted as booked regardless of booking date.';
comment on column public.dripjobs_set_rate_snapshots.booked_contacts_count is
  'Contacts created in the selected period that eventually booked, regardless of the appointment date.';
comment on view public.dripjobs_set_rate_latest is
  'Latest accepted DripJobs set-rate snapshot for each exact reporting period.';

select pg_notify('pgrst', 'reload schema');

commit;
