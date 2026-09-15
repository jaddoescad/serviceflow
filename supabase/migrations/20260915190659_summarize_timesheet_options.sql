create or replace function public.get_timesheet_options()
returns jsonb language sql stable security invoker set search_path=public,pg_temp as $$
select jsonb_build_object('employees',coalesce((select jsonb_agg(jsonb_build_object('user_id',id,'full_name',full_name,'email',email) order by full_name nulls last,id) from public.employees),'[]'::jsonb),
'projects',coalesce((select jsonb_agg(jsonb_build_object('companycam_id',j.id,'name',j.name) order by j.updated_at desc,j.id) from public.jobs j where j.is_feed_visible and not(coalesce(j.source,'')='legacy_companycam' and coalesce(j.contract_amount_cents,0)=0 and j.accepted_quote_id is null and j.id not in('38b6208e-12dd-5e62-b963-591a89868d91'::uuid,'99a4cb86-ec09-54c1-8a95-ffac416cf844'::uuid) and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(j.metadata->'labels')='array' then j.metadata->'labels' else '[]'::jsonb end)l where lower(btrim(coalesce(l->>'display_value',l->>'value',''))) in('lead','proposal sent')))),'[]'::jsonb));
$$;
revoke all on function public.get_timesheet_options() from public,anon;
grant execute on function public.get_timesheet_options() to authenticated;
