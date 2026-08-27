-- Live migration version: 20260820200704.
alter table public.marketing_performance
  add column if not exists clicks bigint not null default 0,
  add column if not exists link_clicks bigint not null default 0,
  add column if not exists landing_page_views bigint not null default 0;

update public.marketing_performance
set entity_id = case entity_level
  when 'campaign' then coalesce(
    metadata #>> '{source_payload,campaign_id}',
    metadata ->> 'campaign_id'
  )
  when 'ad_set' then coalesce(
    metadata #>> '{source_payload,adset_id}',
    metadata ->> 'adset_id'
  )
  when 'ad' then coalesce(
    metadata #>> '{source_payload,ad_id}',
    metadata ->> 'ad_id'
  )
  else entity_id
end
where platform = 'meta'
  and entity_id is null
  and entity_level in ('campaign', 'ad_set', 'ad');

alter table public.marketing_performance
  add constraint marketing_performance_period_order_check
    check (period_start <= period_end),
  add constraint marketing_performance_nonnegative_metrics_check
    check (
      spend_cents >= 0
      and impressions >= 0
      and reach >= 0
      and clicks >= 0
      and link_clicks >= 0
      and landing_page_views >= 0
    );

create unique index marketing_performance_entity_period_key
  on public.marketing_performance (
    platform,
    account_id,
    grain,
    period_start,
    period_end,
    entity_level,
    entity_id
  );

create index marketing_performance_daily_campaign_period_idx
  on public.marketing_performance (period_start, account_id, purpose)
  where grain = 'daily' and entity_level = 'campaign';

create or replace view public.marketing_summary
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
where performance.entity_level = 'campaign'
group by
  performance.platform,
  performance.period_start,
  performance.period_end,
  performance.purpose;

create or replace view public.marketing_daily_summary
with (security_invoker = true)
as
select
  performance.platform,
  performance.account_id,
  performance.period_start as report_date,
  performance.purpose,
  sum(performance.spend_cents)::bigint as spend_cents,
  sum(performance.results) as leads,
  case
    when sum(performance.results) > 0
      then round(sum(performance.spend_cents)::numeric / sum(performance.results), 2)
    else null
  end as cost_per_lead_cents,
  sum(performance.impressions)::bigint as impressions,
  sum(performance.clicks)::bigint as clicks,
  sum(performance.link_clicks)::bigint as link_clicks,
  sum(performance.landing_page_views)::bigint as landing_page_views,
  sum(performance.reach)::bigint as campaign_reach_sum,
  max(performance.captured_at) as captured_at
from public.marketing_performance performance
where performance.grain = 'daily'
  and performance.entity_level = 'campaign'
group by
  performance.platform,
  performance.account_id,
  performance.period_start,
  performance.purpose;

alter table public.marketing_performance enable row level security;

revoke all on public.marketing_performance from anon;
revoke all on public.marketing_summary from anon;
revoke all on public.marketing_daily_summary from anon;

grant select on public.marketing_performance to authenticated;
grant select on public.marketing_summary to authenticated;
grant select on public.marketing_daily_summary to authenticated;
grant select, insert, update on public.marketing_performance to service_role;

comment on table public.marketing_performance is
  'Canonical ad-platform facts. Meta daily rows are refreshed by stable account/date/entity identity; raw actions and API provenance are retained in metadata.';
comment on view public.marketing_daily_summary is
  'Dashboard-safe daily campaign totals for Meta spend, leads, CPL inputs, and traffic. campaign_reach_sum is not deduplicated account reach.';

select pg_notify('pgrst', 'reload schema');
