-- Return only the visible page. Work and alert totals include the full RLS-visible set.
create or replace function public.get_labour_budgets_page(search_text text default '', page_number integer default 1, calculated_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
with work as materialized (
 select * from jsonb_to_recordset(public.get_job_work_summary(calculated_at)->'rows') as w("projectId" uuid,hours double precision,wages double precision,"unpricedHours" double precision,"lastClockIn" timestamptz,name text,"assignedCount" bigint)
), visible as (
 select j.* from public.jobs j where j.is_feed_visible and not (
 j.id not in ('38b6208e-12dd-5e62-b963-591a89868d91'::uuid,'99a4cb86-ec09-54c1-8a95-ffac416cf844'::uuid)
 and coalesce(j.source,'')='legacy_companycam' and coalesce(j.contract_amount_cents,0)=0 and j.accepted_quote_id is null
 and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(j.metadata->'labels')='array' then j.metadata->'labels' else '[]'::jsonb end) l where lower(btrim(coalesce(l->>'display_value',l->>'value',''))) in ('lead','proposal sent'))
 )
), base as materialized (
 select j.id,case when v.id is not null then v.name else w.name end as name,
 case when v.id is not null then coalesce(v.formatted_address,v.address_line_1) end as address,
 v.started_on,v.production_month,b.closed_at,
 b.budget_minutes::double precision/60 as budget_hours,b.hourly_rate_cents::double precision/100 as hourly_rate,
 case when b.amount_including_tax_cents>0 then b.amount_including_tax_cents::double precision/100 when j.contract_amount_cents>0 then j.contract_amount_cents::double precision/100 end as amount,
 coalesce(w.hours,0) as hours,coalesce(w.wages,0) as wages,coalesce(w."unpricedHours",0) as unpriced,w."lastClockIn" as last_clock,coalesce(w."assignedCount",0) as assigned
 from public.jobs j left join visible v on v.id=j.id left join work w on w."projectId"=j.id
 left join lateral(select * from public.job_budgets b where b.job_id=j.id and b.source in ('manual','project_budget') and b.status in ('active','closed') order by b.updated_at desc,(b.source='manual') desc,b.version desc limit 1)b on true
 where (v.id is not null or w.name is not null)
), filtered as materialized (
 select * from base where nullif(btrim(name),'') is not null and strpos(lower(btrim(name)),lower(coalesce(search_text,'')))>0
), totals as (
 select count(*) as total,
 count(*) filter(where amount>0 and wages>0 and wages/amount*100>=40) as over_count,
 count(*) filter(where amount>0 and wages>0 and closed_at is null and last_clock<=calculated_at-interval '720 hours') as ready_count from filtered
), page as (
 select * from filtered order by (closed_at is null and last_clock is not null) desc,
 case when closed_at is null then last_clock end desc nulls last,coalesce(started_on,'1970-01-01'::date) desc,btrim(name) collate "en-CA-x-icu",id
 limit 50 offset (least(greatest(coalesce(page_number,1),1),greatest(1,(select ceil(total/50.0)::integer from totals)))-1)*50
)
select jsonb_build_object('total',t.total,'calculatedAt',calculated_at,'totals',jsonb_build_object('overCount',t.over_count,'readyToCloseCount',t.ready_count),
'rows',coalesce((select jsonb_agg(jsonb_build_object(
 'projectId',p.id,'name',btrim(p.name),'address',p.address,'startedOn',p.started_on,'productionMonth',p.production_month,
 'budgetedHours',p.budget_hours,'hourlyRate',p.hourly_rate,'amount',p.amount,'closedAt',p.closed_at,
 'hours',p.hours,'wages',p.wages,'unpricedHours',p.unpriced,'lastClockIn',p.last_clock,'assignedCount',p.assigned)) from page p),'[]'::jsonb)) from totals t;
$$;
revoke all on function public.get_labour_budgets_page(text,integer,timestamptz) from public,anon;
grant execute on function public.get_labour_budgets_page(text,integer,timestamptz) to authenticated;
