-- Run after the two photo migrations inside a transaction and ROLLBACK.
-- All media fixtures and outbox changes are rolled back; no files are uploaded.
do $$
declare
  actor uuid;
  project uuid;
  photo uuid := gen_random_uuid();
  revision uuid := gen_random_uuid();
  result jsonb;
begin
  select id into actor from public.employees where is_active and role = 'admin' limit 1;
  select id into project from public.jobs limit 1;
  if actor is null or project is null then raise exception 'Test prerequisites missing'; end if;
  insert into public.job_media(id,job_id,object_key,media_type,mime_type,byte_size,uploaded_by,source_metadata)
  values(photo,project,'jobs/'||project||'/'||photo||'~'||gen_random_uuid()||'.jpg',
         'image','image/jpeg',1,actor,'{"import_provenance":"retain-me"}');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  result := public.edit_photo_details(project,photo,null,revision,' QA description ',array['Before','Before',' After ']);
  if result->>'description' <> 'QA description' or result->'tags' <> '["After","Before"]'::jsonb
     or result->>'import_provenance' <> 'retain-me' then raise exception 'Metadata edit lost data'; end if;
  if public.edit_photo_details(project,photo,null,revision,'QA description',array['After','Before']) <> result then
    raise exception 'Idempotent retry failed';
  end if;
  begin
    perform public.edit_photo_details(project,photo,null,gen_random_uuid(),'stale overwrite','{}');
    raise exception 'Stale write was accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.edit_photo_details(project,photo,revision::text,revision,'revision reuse','{}');
    raise exception 'Revision reused with different content';
  exception when serialization_failure then null; end;
  begin
    perform public.edit_photo_details(gen_random_uuid(),photo,revision::text,gen_random_uuid(),'wrong project','{}');
    raise exception 'Cross-project edit accepted';
  exception when no_data_found then null; end;
  begin
    perform public.edit_photo_details(project,photo,revision::text,gen_random_uuid(),repeat('x',10001),'{}');
    raise exception 'Oversized edit accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update public.job_media set object_key='jobs/'||gen_random_uuid()||'/'||photo||'.jpg' where id=photo;
    raise exception 'Cross-project storage key accepted';
  exception when check_violation then null; end;
  begin
    update public.job_media set object_key='jobs/'||project||'/'||gen_random_uuid()||'.jpg' where id=photo;
    raise exception 'Wrong media ID in storage key accepted';
  exception when check_violation then null; end;
  begin
    update public.job_media set object_key='jobs/'||project||'/'||photo||'.png' where id=photo;
    raise exception 'Wrong MIME extension accepted';
  exception when check_violation then null; end;
  -- Legacy mobile keys remain valid.
  update public.job_media set object_key='jobs/'||project||'/'||photo||'.jpg' where id=photo;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.edit_photo_details(project,photo,revision::text,gen_random_uuid(),'anonymous edit','{}');
    raise exception 'Anonymous edit accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  begin
    perform public.edit_photo_details(project,photo,revision::text,gen_random_uuid(),'unregistered user','{}');
    raise exception 'Unregistered user edit accepted';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('anon','public.edit_photo_details(uuid,uuid,text,uuid,text,text[])','EXECUTE') then
    raise exception 'Anonymous RPC grant';
  end if;
  if has_table_privilege('authenticated','public.job_media','UPDATE') then
    raise exception 'Direct metadata update grant';
  end if;
end;
$$;
select 'photo metadata and storage-key checks passed' as result;
