begin;
alter table public.project_labels add column updated_at timestamptz not null default now();
create function public.touch_project_label() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 new.updated_at := now();
 return new;
end $$;
create trigger project_label_updated before update on public.project_labels for each row execute function public.touch_project_label();

create function public.set_project_labels(requested_id uuid, requested_labels uuid[]) returns void
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.employees where id=auth.uid() and is_active and role in ('admin','manager')) then
  raise exception 'Only managers can change project labels.';
 end if;
 if requested_labels is null or cardinality(requested_labels)>30 then raise exception 'Choose up to 30 labels.'; end if;
 insert into public.project_workspace(project_id,job_id,lead_id)
 select id,case when kind='job' then id end,case when kind='lead' then id end from public.project_directory where id=requested_id
 on conflict(project_id) do nothing;
 perform 1 from public.project_workspace where project_id=requested_id and trashed_at is null for update;
 if not found then raise exception 'Project not found or in trash.'; end if;
 delete from public.project_label_links where project_id=requested_id and not(label_id=any(requested_labels));
 insert into public.project_label_links(project_id,label_id) select requested_id,unnest(requested_labels) on conflict do nothing;
end $$;
revoke all on function public.set_project_labels(uuid,uuid[]) from public,anon;
grant execute on function public.set_project_labels(uuid,uuid[]) to authenticated;
commit;
