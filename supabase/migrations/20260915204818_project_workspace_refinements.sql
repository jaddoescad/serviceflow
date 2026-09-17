begin;

-- Preserve an explicitly empty description instead of reviving an imported value.
alter table public.project_workspace add column description text;
create or replace function public.save_workspace_project(requested_id uuid, requested_name text, requested_contact_name text, requested_email text, requested_phone text, requested_address text, requested_description text, requested_notes text, requested_labels uuid[])
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if nullif(btrim(requested_name),'') is null or length(requested_name)>200 then raise exception 'Enter a project name (up to 200 characters).'; end if;
 if length(requested_description)>10000 or cardinality(requested_labels)>30 then raise exception 'Project details exceed the limit.'; end if;
 insert into public.project_workspace(project_id,job_id,lead_id)
 select id,case when kind='job' then id end,case when kind='lead' then id end from public.project_directory where id=requested_id on conflict do nothing;
 perform 1 from public.project_workspace where project_id=requested_id and trashed_at is null for update;
 if not found then raise exception 'Project not found or in trash.'; end if;
 perform public.save_project_profile(requested_id,'contact',requested_contact_name,requested_email,requested_phone,requested_address,requested_notes,null);
 perform public.save_project_profile(requested_id,'description',null,null,null,null,null,requested_description);
 update public.project_workspace set name=btrim(requested_name),description=btrim(coalesce(requested_description,'')) where project_id=requested_id;
 delete from public.project_label_links where project_id=requested_id;
 insert into public.project_label_links(project_id,label_id) select requested_id,unnest(requested_labels) on conflict do nothing;
end $$;

-- Creation needs one atomic insert into the existing manager-owned jobs table.
create or replace function private.create_workspace_project(requested_id uuid, requested_name text, requested_contact uuid, requested_address text)
returns uuid language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.employees where id=auth.uid() and is_active and role in ('admin','manager')) then raise exception 'Only active managers can create projects.' using errcode='42501'; end if;
 if requested_id is null or nullif(btrim(requested_name),'') is null or length(requested_name)>200 or length(requested_address)>500 then raise exception 'Enter a project name and address.'; end if;
 if not exists(select 1 from public.contacts where id=requested_contact and nullif(btrim(name),'') is not null) then raise exception 'A contact is required.'; end if;
 if exists(select 1 from public.jobs where id=requested_id) then
  if not exists(select 1 from public.jobs where id=requested_id and source='serviceflow_workspace' and metadata->>'created_by'=auth.uid()::text) then raise exception 'Project ID already exists.'; end if;
  return requested_id;
 end if;
 insert into public.jobs(id,contact_id,name,status,source,formatted_address,metadata)
 values(requested_id,requested_contact,btrim(requested_name),'scheduled','serviceflow_workspace',nullif(btrim(requested_address),''),jsonb_build_object('created_by',auth.uid()));
 return requested_id;
end $$;
revoke all on function private.create_workspace_project(uuid,text,uuid,text) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.create_workspace_project(uuid,text,uuid,text) to authenticated;
create function public.create_workspace_project(requested_id uuid, requested_name text, requested_contact uuid, requested_address text default '')
returns uuid language sql security invoker set search_path='' as $$ select private.create_workspace_project(requested_id,requested_name,requested_contact,requested_address); $$;
revoke all on function public.create_workspace_project(uuid,text,uuid,text) from public,anon;
grant execute on function public.create_workspace_project(uuid,text,uuid,text) to authenticated;

create or replace view public.admin_photo_feed with (security_invoker=true) as
select m.id,coalesce(m.job_id,m.lead_id) as owner_id,case when m.job_id is not null then 'job' else 'lead' end as owner_kind,
coalesce(w.name,case when m.job_id is not null then coalesce(nullif(btrim(j.name),''),'Unnamed job') else coalesce(nullif(btrim(c.name),''),'Unnamed lead') end) as project_name,
case when m.job_id is not null then coalesce(nullif(btrim(j.formatted_address),''),nullif(btrim(j.address_line_1),''))
 else coalesce(case when lower(btrim(l.address)) not in ('ca','canada') then nullif(btrim(l.address),'') end,nullif(concat_ws(', ',nullif(btrim(l.city),''),nullif(btrim(l.province),''),nullif(btrim(l.postal_code),'')),'')) end as address,
case when m.media_type='video' then 'video' else 'image' end as media_type,coalesce(nullif(btrim(m.mime_type),''),'image/jpeg') as mime_type,m.duration_ms,
coalesce(m.captured_at,m.created_at) as display_at,m.captured_at,m.created_at,
coalesce(nullif(btrim(m.source_metadata->>'creator_name'),''),nullif(btrim(e.full_name),''),nullif(btrim(e.email),''),'Ottawa Painters') as creator_name,
nullif(btrim(m.source_metadata->>'description'),'') as description
from public.job_media m left join public.project_workspace w on w.project_id=coalesce(m.job_id,m.lead_id) left join public.jobs j on j.id=m.job_id left join public.leads l on l.id=m.lead_id left join public.contacts c on c.id=l.contact_id left join public.employees e on e.id=m.uploaded_by
where coalesce(m.job_id,m.lead_id) is not null and coalesce(m.captured_at,m.created_at) is not null;
revoke all on public.admin_photo_feed from public,anon;
grant select on public.admin_photo_feed to authenticated;


create function public.save_workspace_description(requested_id uuid, requested_description text)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if length(requested_description)>20000 then raise exception 'Description is too long.'; end if;
 insert into public.project_workspace(project_id,job_id,lead_id)
 select id,case when kind='job' then id end,case when kind='lead' then id end from public.project_directory where id=requested_id on conflict do nothing;
 perform 1 from public.project_workspace where project_id=requested_id and trashed_at is null for update;
 if not found then raise exception 'Project not found or in trash.'; end if;
 perform public.save_project_profile(requested_id,'description',null,null,null,null,null,requested_description);
 update public.project_workspace set description=btrim(coalesce(requested_description,'')) where project_id=requested_id;
end $$;
revoke all on function public.save_workspace_description(uuid,text) from public,anon;
grant execute on function public.save_workspace_description(uuid,text) to authenticated;
commit;
