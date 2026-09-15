create or replace function public.get_contacts_page(search_text text default '', page_number integer default 1)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
with visible_jobs as (
 select j.*,q.status as quote_status,q.accepted_at,coalesce(q.lead_id,j.lead_id) as project_lead_id,
 coalesce(coalesce(q.lead_id,j.lead_id)::text,j.id::text) as project_key
 from public.jobs j left join public.quotes q on q.id=j.accepted_quote_id
 where j.contact_id is not null and j.is_feed_visible is distinct from false
), ranked as (
 select v.*,
 row_number() over (partition by contact_id,project_key order by (quote_status is distinct from 'superseded') desc,accepted_at desc nulls last,updated_at desc nulls last,id) as canonical_rank,
 row_number() over (partition by contact_id,project_key order by (status not in ('archived','cancelled')) desc,updated_at desc nulls last,id) as fallback_rank
 from visible_jobs v
), good_canonical as (
 select * from ranked where canonical_rank=1 and quote_status is distinct from 'superseded' and status not in ('archived','cancelled')
), chosen as (
 select * from good_canonical
 union all
 select r.* from ranked r where fallback_rank=1 and not exists(select 1 from good_canonical g where g.contact_id=r.contact_id and g.project_key=r.project_key)
), projects as (
 -- Preserve existing contact-list address derivation; no project profile edits.
 select j.contact_id,j.id,'job' as kind,coalesce(j.updated_at,j.created_at) as activity,
 nullif(trim(concat_ws(', ',nullif(trim(j.city),''),nullif(trim(j.province),''),nullif(trim(j.postal_code),''))),'') as address
 from chosen j
 union all
 select l.contact_id,l.id,'lead',coalesce(l.updated_at,l.created_at),
 coalesce(nullif(trim(l.address),''),nullif(trim(concat_ws(', ',nullif(trim(l.city),''),nullif(trim(l.province),''),nullif(trim(l.postal_code),''))),''))
 from public.leads l where not exists(select 1 from chosen j where j.contact_id=l.contact_id and j.project_lead_id=l.id)
), counts as (
 select contact_id,count(*) filter(where kind='job') as jobs,count(*) filter(where kind='lead') as leads from projects group by contact_id
), latest as (
 select distinct on(contact_id) contact_id,address,activity from projects order by contact_id,activity desc nulls last,(kind='job') desc,id
), summaries as (
 select c.id,coalesce(nullif(trim(c.name),''),'Unnamed contact') as name,nullif(trim(c.email),'') as email,nullif(trim(c.phone),'') as phone,
 case when l.contact_id is not null then l.address else nullif(trim(c.metadata->>'address'),'') end as address,
 coalesce(n.jobs,0) as jobs,coalesce(n.leads,0) as leads,coalesce(l.activity,c.updated_at,c.created_at,'1970-01-01'::timestamptz) as activity
 from public.contacts c left join counts n on n.contact_id=c.id left join latest l on l.contact_id=c.id where c.kind='customer'
), matched as materialized (
 select * from summaries s where trim(coalesce(search_text,''))='' or exists(select 1 from unnest(array[s.name,s.email,s.phone,s.address]) v where strpos(lower(coalesce(v,'')),lower(trim(search_text)))>0)
), totals as(select count(*) as total from matched), page as (
 select * from matched order by activity desc,name collate "en-CA-x-icu",id limit 50
 offset (least(greatest(coalesce(page_number,1),1),greatest(1,((select total from totals)+49)/50))-1)*50
)
select jsonb_build_object('total',(select total from totals),'rows',coalesce((select jsonb_agg(jsonb_build_object(
 'id',id,'name',name,'email',email,'phone',phone,'address',address,'jobCount',jobs,'leadCount',leads,'projectCount',jobs+leads,'lastActivityAt',activity)
 order by activity desc,name collate "en-CA-x-icu",id) from page),'[]'::jsonb));
$$;
revoke all on function public.get_contacts_page(text,integer) from public,anon;
grant execute on function public.get_contacts_page(text,integer) to authenticated;
