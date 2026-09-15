-- Resolve contact relationships in the database instead of a large UUID URL filter.
create or replace function public.get_contact_project_records(contact_uuid uuid)
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
with contact_leads as materialized(select id,contact_id,dripjobs_deal_id,status,source,address,city,province,postal_code,created_at,updated_at,metadata from public.leads where contact_id=contact_uuid),
contact_jobs as(
 select j.id,j.contact_id,j.lead_id,j.name,j.status,j.contract_amount_cents,j.formatted_address,j.address_line_1,j.city,j.province,j.postal_code,j.started_on,j.created_at,j.updated_at,j.is_feed_visible,j.source,
 case when q.id is not null then jsonb_build_object('id',q.id,'lead_id',q.lead_id,'dripjobs_proposal_id',q.dripjobs_proposal_id,'status',q.status,'accepted_at',q.accepted_at) end accepted_quote
 from public.jobs j left join public.quotes q on q.id=j.accepted_quote_id where j.contact_id=contact_uuid or j.lead_id in(select id from contact_leads)
)
select jsonb_build_object('leads',coalesce((select jsonb_agg(to_jsonb(l) order by updated_at desc,id) from contact_leads l),'[]'::jsonb),'jobs',coalesce((select jsonb_agg(to_jsonb(j) order by updated_at desc,id) from contact_jobs j),'[]'::jsonb));
$$;
revoke all on function public.get_contact_project_records(uuid) from public,anon;
grant execute on function public.get_contact_project_records(uuid) to authenticated;
