begin;

-- Project lifecycle is independent of financial/job status.
alter table public.jobs alter column contact_id set not null;
create table public.project_workspace (
  project_id uuid primary key,
  job_id uuid unique references public.jobs(id) on delete restrict,
  lead_id uuid unique references public.leads(id) on delete restrict,
  name text check (length(name) between 1 and 200),
  archived_at timestamptz,
  trashed_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((job_id is not null)::int + (lead_id is not null)::int = 1),
  check (project_id = coalesce(job_id, lead_id)),
  check (trashed_at is null or archived_at is not null)
);
create table public.project_labels (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  color text not null default '#f9dd50' check (color ~ '^#[0-9a-fA-F]{6}$')
);
create unique index project_labels_name on public.project_labels(lower(btrim(name)));
create table public.project_label_links (
  project_id uuid not null references public.project_workspace(project_id) on delete cascade,
  label_id uuid not null references public.project_labels(id) on delete cascade,
  primary key (project_id,label_id)
);

alter table public.project_workspace enable row level security;
alter table public.project_labels enable row level security;
alter table public.project_label_links enable row level security;
revoke all on public.project_workspace,public.project_labels,public.project_label_links from public,anon,authenticated;
grant select,insert,update on public.project_workspace to authenticated;
grant select,insert,update,delete on public.project_labels,public.project_label_links to authenticated;
create policy workspace_read on public.project_workspace for select to authenticated using (auth.uid() is not null);
create policy workspace_insert on public.project_workspace for insert to authenticated with check (exists(select 1 from public.employees where id=auth.uid() and is_active and role in ('admin','manager')));
create policy workspace_update on public.project_workspace for update to authenticated using (exists(select 1 from public.employees where id=auth.uid() and is_active and role in ('admin','manager'))) with check (exists(select 1 from public.employees where id=auth.uid() and is_active and role in ('admin','manager')));
create policy labels_read on public.project_labels for select to authenticated using (auth.uid() is not null);
create policy labels_write on public.project_labels for all to authenticated using (exists(select 1 from public.employees where id=auth.uid() and is_active and role in ('admin','manager'))) with check (exists(select 1 from public.employees where id=auth.uid() and is_active and role in ('admin','manager')));
create policy label_links_read on public.project_label_links for select to authenticated using (auth.uid() is not null);
create policy label_links_write on public.project_label_links for all to authenticated using (exists(select 1 from public.employees where id=auth.uid() and is_active and role in ('admin','manager'))) with check (exists(select 1 from public.employees where id=auth.uid() and is_active and role in ('admin','manager')));

-- This trigger also protects direct API writes and concurrent lifecycle changes.
create function public.guard_project_workspace() returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if tg_op='INSERT' and new.trashed_at is not null then raise exception 'Archive the project before moving it to trash.'; end if;
 if tg_op='UPDATE' then
  if new.project_id<>old.project_id or new.job_id is distinct from old.job_id or new.lead_id is distinct from old.lead_id then raise exception 'Project identity cannot change.'; end if;
  if old.trashed_at is not null then
   if old.trashed_at <= now()-interval '90 days' then raise exception 'The 90-day restore period has ended.'; end if;
   if new.trashed_at is not null and new.trashed_at<>old.trashed_at then raise exception 'Trash retention cannot be extended.'; end if;
  elsif new.trashed_at is not null and old.archived_at is null then raise exception 'Archive the project before moving it to trash.'; end if;
 end if;
 new.updated_at:=now();
 return new;
end $$;
create trigger guard_project_workspace before insert or update on public.project_workspace for each row execute function public.guard_project_workspace();

create view public.project_directory with (security_invoker=true) as
with projects as (
 select j.id, 'job'::text kind, j.contact_id, j.name, coalesce(j.formatted_address,j.address_line_1) address,j.created_at,j.updated_at
 from public.jobs j where j.is_feed_visible
 union all
 select l.id,'lead',l.contact_id,c.name,l.address,l.created_at,l.updated_at
 from public.leads l join public.contacts c on c.id=l.contact_id
 where not exists(select 1 from public.jobs j where j.lead_id=l.id and j.is_feed_visible)
 and not exists(select 1 from public.quotes q join public.jobs j on j.accepted_quote_id=q.id where q.lead_id=l.id and j.is_feed_visible)
)
select p.id,p.kind,p.contact_id,coalesce(w.name,p.name) name,p.address,p.created_at,p.updated_at,w.archived_at,w.trashed_at,
 coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'color',l.color) order by l.name) from public.project_label_links x join public.project_labels l on l.id=x.label_id where x.project_id=p.id),'[]'::jsonb) labels
from projects p left join public.project_workspace w on w.project_id=p.id;
revoke all on public.project_directory from public,anon;
grant select on public.project_directory to authenticated;

create function public.set_project_lifecycle(requested_id uuid, requested_action text) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare current_row public.project_workspace;
begin
 insert into public.project_workspace(project_id,job_id,lead_id)
 select id,case when kind='job' then id end,case when kind='lead' then id end from public.project_directory where id=requested_id
 on conflict(project_id) do nothing;
 select * into current_row from public.project_workspace where project_id=requested_id for update;
 if not found then raise exception 'Project not found.'; end if;
 if requested_action='archive' and current_row.trashed_at is null then
  update public.project_workspace set archived_at=coalesce(archived_at,now()) where project_id=requested_id;
 elsif requested_action='unarchive' and current_row.trashed_at is null then
  update public.project_workspace set archived_at=null where project_id=requested_id;
 elsif requested_action='trash' and current_row.archived_at is not null then
  update public.project_workspace set trashed_at=coalesce(trashed_at,now()) where project_id=requested_id;
 elsif requested_action='restore' and current_row.trashed_at>now()-interval '90 days' then
  update public.project_workspace set trashed_at=null where project_id=requested_id;
 else raise exception 'Archive before deleting. Trashed projects can be restored for 90 days.';
 end if;
end $$;
revoke all on function public.set_project_lifecycle(uuid,text) from public,anon;
grant execute on function public.set_project_lifecycle(uuid,text) to authenticated;

create function public.save_workspace_project(requested_id uuid, requested_name text, requested_contact_name text, requested_email text, requested_phone text, requested_address text, requested_description text, requested_notes text, requested_labels uuid[])
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if nullif(btrim(requested_name),'') is null or length(requested_name)>200 then raise exception 'Enter a project name (up to 200 characters).'; end if;
 insert into public.project_workspace(project_id,job_id,lead_id)
 select id,case when kind='job' then id end,case when kind='lead' then id end from public.project_directory where id=requested_id on conflict do nothing;
 perform 1 from public.project_workspace where project_id=requested_id and trashed_at is null for update;
 if not found then raise exception 'Project not found or in trash.'; end if;
 perform public.save_project_profile(requested_id,'contact',requested_contact_name,requested_email,requested_phone,requested_address,requested_notes,null);
 perform public.save_project_profile(requested_id,'description',null,null,null,null,null,requested_description);
 update public.project_workspace set name=btrim(requested_name) where project_id=requested_id;
 delete from public.project_label_links where project_id=requested_id;
 insert into public.project_label_links(project_id,label_id) select requested_id,unnest(requested_labels) on conflict do nothing;
end $$;
revoke all on function public.save_workspace_project(uuid,text,text,text,text,text,text,text,uuid[]) from public,anon;
grant execute on function public.save_workspace_project(uuid,text,text,text,text,text,text,text,uuid[]) to authenticated;

-- Project trash hides media from galleries and direct authenticated media reads.
create policy project_media_hide_project_trash on public.job_media as restrictive for select to authenticated
using (not exists(select 1 from public.project_workspace w where w.project_id=coalesce(job_media.job_id,job_media.lead_id) and w.trashed_at is not null));
create function public.project_directory_previews(requested_ids uuid[]) returns table(project_id uuid,id uuid,media_type text)
language sql stable security invoker set search_path=public,pg_temp as $$
 select p.project_id,m.id,m.media_type from unnest(requested_ids[1:40]) p(project_id)
 cross join lateral (
  select m.id,m.media_type from public.job_media m where m.job_id=p.project_id or m.lead_id=p.project_id
  order by m.captured_at desc nulls last,m.created_at desc,m.id desc limit 3
 ) m;
$$;
revoke all on function public.project_directory_previews(uuid[]) from public,anon;
grant execute on function public.project_directory_previews(uuid[]) to authenticated;
create or replace function public.get_workspace_photo_feed_page(project_filter uuid default null, creator_filter text default null, media_filter text default null, since_filter timestamptz default null, until_filter date default null, after_cursor jsonb default null)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp set plan_cache_mode=force_custom_plan as $$
begin
return (with batch as materialized (
 select * from public.admin_photo_feed p
 where (project_filter is null or p.owner_id=project_filter) and (creator_filter is null or p.creator_name=creator_filter)
 and (media_filter is null or p.media_type=media_filter) and (since_filter is null or p.display_at>=since_filter) and (until_filter is null or p.display_at < ((until_filter+1)::timestamp at time zone 'America/Toronto'))
 and (after_cursor is null or
  (coalesce(p.captured_at,'-infinity'::timestamptz),p.created_at,p.id) <
  (coalesce((after_cursor->>'capturedAt')::timestamptz,'-infinity'::timestamptz),(after_cursor->>'createdAt')::timestamptz,(after_cursor->>'id')::uuid))
 order by p.captured_at desc nulls last,p.created_at desc,p.id desc limit 61
), page as materialized(select * from batch order by captured_at desc nulls last,created_at desc,id desc limit 60)
select jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
 'id',id,'ownerProjectId',owner_id,'ownerKind',owner_kind,'projectName',project_name,'address',address,'mediaType',media_type,'mimeType',mime_type,'durationMs',duration_ms,'capturedAt',display_at,'creatorName',creator_name,'description',description
 ) order by captured_at desc nulls last,created_at desc,id desc) from page),'[]'::jsonb),
 'nextCursor',case when (select count(*) from batch)>60 then (select jsonb_build_object('capturedAt',captured_at,'createdAt',created_at,'id',id) from page order by captured_at asc nulls first,created_at asc,id asc limit 1) end));
end;
$$;
create or replace function public.get_workspace_photo_feed_summary(project_filter uuid default null, creator_filter text default null, media_filter text default null, since_filter timestamptz default null, until_filter date default null, include_options boolean default true)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp set plan_cache_mode=force_custom_plan as $$
begin
return (select jsonb_build_object('total',(select count(*) from public.admin_photo_feed p where (project_filter is null or p.owner_id=project_filter) and (creator_filter is null or p.creator_name=creator_filter) and (media_filter is null or p.media_type=media_filter) and (since_filter is null or p.display_at>=since_filter) and (until_filter is null or p.display_at < ((until_filter+1)::timestamp at time zone 'America/Toronto'))),
'projects',case when include_options then coalesce((select jsonb_agg(jsonb_build_array(owner_id,project_name) order by project_name collate "en-CA-x-icu",owner_id) from (select distinct owner_id,project_name from public.admin_photo_feed)p),'[]'::jsonb) end,
'creators',case when include_options then coalesce((select jsonb_agg(jsonb_build_array(creator_name,n) order by creator_name collate "en-CA-x-icu") from(select creator_name,count(*) n from public.admin_photo_feed group by creator_name)p),'[]'::jsonb) end));
end;
$$;

revoke all on function public.get_workspace_photo_feed_page(uuid,text,text,timestamptz,date,jsonb),public.get_workspace_photo_feed_summary(uuid,text,text,timestamptz,date,boolean) from public,anon;
grant execute on function public.get_workspace_photo_feed_page(uuid,text,text,timestamptz,date,jsonb),public.get_workspace_photo_feed_summary(uuid,text,text,timestamptz,date,boolean) to authenticated;

commit;
