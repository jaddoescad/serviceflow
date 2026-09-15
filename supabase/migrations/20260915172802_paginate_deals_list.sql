-- Invoker rights preserve the caller's RLS policies for every joined table.
create or replace function public.get_deals_page(search_text text default '', page_number integer default 1)
returns jsonb language sql stable security invoker set search_path = public, pg_temp as $$
with matched as materialized (
 select l.id,l.updated_at,l.created_at,l.address,l.postal_code,l.source,l.normalized_channel,
 coalesce(l.dripjobs_sales_deal_id,l.dripjobs_deal_id,l.id::text) as deal_id,
 coalesce(nullif(trim(c.name),''),'Unnamed lead') as name,c.email,c.phone,j.job
 from public.leads l left join public.contacts c on c.id=l.contact_id
 left join lateral (
  select jsonb_build_object('jobId',j.id,'jobName',j.name,'status',j.status) as job
  from public.quotes q join public.jobs j on j.accepted_quote_id=q.id
  where q.lead_id=l.id and j.is_feed_visible is distinct from false and q.status is distinct from 'superseded'
  order by q.accepted_at desc nulls last,coalesce(q.updated_at,j.updated_at) desc nulls last,j.id asc limit 1
 ) j on true
 where trim(coalesce(search_text,''))='' or exists (
  select 1 from unnest(array[c.name,c.email,c.phone,l.address,l.postal_code,
    coalesce(l.dripjobs_sales_deal_id,l.dripjobs_deal_id,l.id::text),l.source,j.job->>'jobName',j.job->>'status']) v
  where strpos(lower(coalesce(v,'')),lower(trim(search_text)))>0
 )
), totals as (select count(*) as total from matched), page as (
 select * from matched order by updated_at desc,id asc limit 50
 offset (least(greatest(coalesce(page_number,1),1),greatest(1,((select total from totals)+49)/50))-1)*50
)
select jsonb_build_object('total',(select total from totals),'rows',coalesce((select jsonb_agg(jsonb_build_object(
 'leadId',id,'dealId',deal_id,'name',name,'email',email,'phone',phone,'address',address,'postalCode',postal_code,
 'rawLeadSource',source,'normalizedChannel',normalized_channel,'updatedAt',coalesce(updated_at,created_at),'job',job,
 'media','[]'::jsonb,'mediaCount',0) order by updated_at desc,id asc) from page),'[]'::jsonb));
$$;
revoke all on function public.get_deals_page(text,integer) from public,anon;
grant execute on function public.get_deals_page(text,integer) to authenticated;
