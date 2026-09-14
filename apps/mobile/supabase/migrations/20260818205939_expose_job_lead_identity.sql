-- Keep the lead UUID on operational project records so clients can present
-- media captured before the first clock-in alongside later job media.
create or replace view public.job_feed
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
    when budget.budget_minutes is null or budget.budget_minutes = 0 then null::numeric
    else round(
      usage.used_minutes::numeric / budget.budget_minutes::numeric * 100::numeric,
      2
    )
  end as budget_percent_used,
  case
    when budget.budget_minutes is null then 'not_configured'::text
    when usage.used_minutes > budget.budget_minutes then 'over_budget'::text
    when job.status = 'completed'::text then 'complete'::text
    else 'active'::text
  end as budget_status,
  job.lead_id
from public.jobs job
left join lateral (
  select source.budget_minutes
  from public.job_budgets source
  where source.job_id = job.id
    and source.status = any (array['active'::text, 'closed'::text])
  order by
    (source.status = 'active'::text) desc,
    (source.source = any (array['manual'::text, 'project_budget'::text])) desc,
    (source.source = 'manual'::text) desc,
    source.version desc,
    source.updated_at desc,
    source.id
  limit 1
) budget on true
left join lateral (
  select coalesce(
    sum(
      greatest(
        0::numeric,
        extract(epoch from coalesce(entry.ended_at, now()) - entry.started_at) / 60::numeric
      )
    ),
    0::numeric
  )::integer as used_minutes
  from public.time_entries entry
  where entry.job_id = job.id
    and entry.status <> 'deleted'::text
) usage on true
where job.is_feed_visible;

revoke all on public.job_feed from anon;
grant select on public.job_feed to authenticated;
