-- Run inside BEGIN/ROLLBACK after the trash migration. Fixture bytes are never
-- uploaded and all rows/outbox events are rolled back.
create temporary table photo_trash_fixture as select
  gen_random_uuid() as photo, gen_random_uuid() as revision,
  (select id from public.jobs limit 1) as project,
  (select id from public.employees where is_active and role='admin' limit 1) as actor;
grant select on photo_trash_fixture to authenticated;
insert into public.job_media(id,job_id,object_key,media_type,mime_type,byte_size,uploaded_by)
select photo,project,'jobs/'||project||'/'||photo||'.jpg','image','image/jpeg',1,actor
from photo_trash_fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true)
from photo_trash_fixture;
set local role authenticated;
do $$
declare
  f record;
  result jsonb;
  restored_revision uuid:=gen_random_uuid();
begin
  select * into f from photo_trash_fixture;
  result:=public.set_photo_trash(f.project,f.photo,true,null,f.revision);
  if result->>'photo_trashed_at' is null then raise exception 'Trash flag missing'; end if;
  if exists(select 1 from public.job_media where id=f.photo) then raise exception 'Trashed photo leaked into normal gallery'; end if;
  if not exists(select 1 from public.get_photo_trash(f.project,f.photo)) then raise exception 'Manager cannot retrieve trash'; end if;
  if public.set_photo_trash(f.project,f.photo,true,null,f.revision) <> result then raise exception 'Trash retry failed'; end if;
  perform public.set_photo_trash(f.project,f.photo,false,f.revision::text,restored_revision);
  if not exists(select 1 from public.job_media where id=f.photo) then raise exception 'Restore not visible'; end if;
  if exists(select 1 from public.get_photo_trash(f.project,f.photo)) then raise exception 'Restored photo remains in trash'; end if;
  begin
    perform public.set_photo_trash(f.project,f.photo,true,null,f.revision);
    raise exception 'Delayed trash request undid restore';
  exception when serialization_failure then null; end;
  begin
    perform public.set_photo_trash(gen_random_uuid(),f.photo,true,restored_revision::text,gen_random_uuid());
    raise exception 'Wrong project accepted';
  exception when no_data_found then null; end;
  begin
    update public.job_media set source_metadata='{}' where id=f.photo;
    raise exception 'Direct metadata update allowed';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  begin
    perform public.get_photo_trash(f.project,f.photo);
    raise exception 'Non-manager trash access accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_photo_trash(f.project,f.photo,true,restored_revision::text,gen_random_uuid());
    raise exception 'Non-owner deletion accepted';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;
select 'authenticated trash/restore and stale-request tests passed' as result;
