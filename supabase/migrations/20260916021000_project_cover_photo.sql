begin;

alter table public.project_workspace add column cover_media_id uuid
  references public.job_media(id) on delete set null;

create function public.validate_project_cover() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.cover_media_id is null then return new; end if;
  if new.trashed_at is not null or not exists (
    select 1 from public.job_media m where m.id=new.cover_media_id
      and coalesce(m.job_id,m.lead_id)=new.project_id
      and m.media_type='image' and m.source_metadata->>'photo_trashed_at' is null
  ) then raise exception 'Choose an available photo from this project.'; end if;
  return new;
end $$;
create trigger validate_project_cover before insert or update of cover_media_id
on public.project_workspace for each row execute function public.validate_project_cover();

create function public.set_project_cover(requested_project uuid, requested_media uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if not private.is_manager() then raise exception 'Only active managers can change the project cover.' using errcode='42501'; end if;
  insert into public.project_workspace(project_id,job_id,lead_id)
  select id,case when kind='job' then id end,case when kind='lead' then id end
  from public.project_directory where id=requested_project on conflict do nothing;
  perform 1 from public.project_workspace where project_id=requested_project and trashed_at is null for update;
  if not found then raise exception 'Project not found or in trash.'; end if;
  update public.project_workspace set cover_media_id=requested_media where project_id=requested_project;
end $$;
revoke all on function public.set_project_cover(uuid,uuid) from public,anon;
grant execute on function public.set_project_cover(uuid,uuid) to authenticated;

-- Fetch only the chosen cover and the latest three indexed media rows. Invalid
-- covers (moved, trashed or deleted) fall back to the latest visible media.
create or replace function public.project_directory_previews(requested_ids uuid[])
returns table(project_id uuid,id uuid,media_type text)
language sql stable security invoker set search_path='' as $$
  select p.project_id,m.id,m.media_type
  from unnest(requested_ids[1:40]) p(project_id)
  left join public.project_workspace w on w.project_id=p.project_id
  cross join lateral (
    select candidates.id,candidates.media_type from (
      select m.id,m.media_type,m.captured_at,m.created_at from public.job_media m
      where m.id=w.cover_media_id and coalesce(m.job_id,m.lead_id)=p.project_id
        and m.media_type='image' and m.source_metadata->>'photo_trashed_at' is null
      union
      (select m.id,m.media_type,m.captured_at,m.created_at from public.job_media m
       where (m.job_id=p.project_id or m.lead_id=p.project_id)
         and m.source_metadata->>'photo_trashed_at' is null
       order by m.captured_at desc nulls last,m.created_at desc,m.id desc limit 3)
    ) candidates
    order by coalesce(candidates.id=w.cover_media_id,false) desc,
      candidates.captured_at desc nulls last,candidates.created_at desc,candidates.id desc
    limit 3
  ) m;
$$;
commit;
