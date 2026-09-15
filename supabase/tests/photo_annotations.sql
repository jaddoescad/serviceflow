-- Execute inside BEGIN/ROLLBACK. Fixtures and sync events never persist.
do $$
declare
  actor uuid; project uuid; photo uuid:=gen_random_uuid(); revision uuid:=gen_random_uuid();
  second_revision uuid:=gen_random_uuid(); result jsonb; doc jsonb; invalid jsonb;
  original_key text; old_revision uuid:=gen_random_uuid();
begin
  select id into actor from public.employees where is_active and role='admin' limit 1;
  select id into project from public.jobs limit 1;
  if actor is null or project is null then raise exception 'Missing test prerequisites'; end if;
  original_key:='jobs/'||project||'/'||photo||'.jpg';
  insert into public.job_media(id,job_id,object_key,media_type,mime_type,byte_size,uploaded_by,source_metadata)
    values(photo,project,original_key,'image','image/jpeg',123,actor,'{"description":"Keep description","tags":["Before"],"provenance":"keep"}');
  doc:=jsonb_build_object('version',1,'shapes',jsonb_build_array(jsonb_build_object(
    'id',gen_random_uuid(),'type','arrow','points','[{"x":0.1,"y":0.2},{"x":0.9,"y":0.8}]'::jsonb,'color','#FF0000','width',0.004)));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  result:=public.save_photo_annotations(project,photo,null,revision,doc);
  if result->'document'<>doc then raise exception 'Annotation save failed'; end if;
  if public.save_photo_annotations(project,photo,null,revision,doc)<>result then raise exception 'Retry failed'; end if;
  if (select count(*) from private.photo_annotation_history where media_id=photo)<>1 then raise exception 'Duplicate history'; end if;
  if (select object_key<>original_key or byte_size<>123 or source_metadata->>'description'<>'Keep description'
     or source_metadata->'tags'<>'["Before"]'::jsonb or source_metadata->>'provenance'<>'keep' from public.job_media where id=photo) then raise exception 'Original data changed'; end if;
  perform public.edit_photo_details(project,photo,null,old_revision,'Concurrent description',array['After']);
  perform public.save_photo_annotations(project,photo,revision::text,second_revision,'{"version":1,"shapes":[]}');
  if (select source_metadata->>'description' from public.job_media where id=photo)<>'Concurrent description' then raise exception 'Description overwritten'; end if;
  if (select count(*) from private.photo_annotation_history where media_id=photo)<>2 then raise exception 'Revision history lost'; end if;
  begin
    perform public.save_photo_annotations(project,photo,revision::text,gen_random_uuid(),doc);
    raise exception 'Stale overwrite accepted';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.save_photo_annotations(project,photo,second_revision::text,revision,doc);
    raise exception 'Old revision reused';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.save_photo_annotations(gen_random_uuid(),photo,second_revision::text,gen_random_uuid(),doc);
    raise exception 'Wrong-project mutation';
  exception when no_data_found then null; end;
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    'null'::jsonb,'{"version":2,"shapes":[]}'::jsonb,
    jsonb_set(doc,'{shapes,0,points,0,x}','2'),
    jsonb_set(doc,'{shapes,0,width}','"bad"'),
    jsonb_set(doc,'{shapes,0,type}','"script"'),
    jsonb_set(doc,'{shapes,0,color}','"url(https://example.com)"'),
    jsonb_set(doc,'{shapes}',jsonb_build_array(doc#>'{shapes,0}',doc#>'{shapes,0}')),
    doc||jsonb_build_object('unknown',repeat('x',262145)))) loop
    begin
      perform public.save_photo_annotations(project,photo,second_revision::text,gen_random_uuid(),invalid);
      raise exception 'Invalid document accepted: %',left(invalid::text,80);
    exception when invalid_parameter_value then null; end;
  end loop;
  execute 'set local role authenticated';
  result:=public.get_photo_annotations(project,photo);
  if result->>'revision'<>second_revision::text then raise exception 'Authorized read failed'; end if;
  if public.get_photo_annotations(gen_random_uuid(),photo) is not null then raise exception 'Cross-project read allowed'; end if;
  execute 'reset role';
  update public.job_media set source_metadata=source_metadata||jsonb_build_object('photo_trashed_at',now()) where id=photo;
  begin
    perform public.save_photo_annotations(project,photo,second_revision::text,gen_random_uuid(),doc);
    raise exception 'Trashed photo edited';
  exception when no_data_found then null; end;
  perform set_config('request.jwt.claims','{}',true);
  begin
    perform public.save_photo_annotations(project,photo,second_revision::text,gen_random_uuid(),doc);
    raise exception 'Anonymous write accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid(),'role','authenticated')::text,true);
  begin
    perform public.save_photo_annotations(project,photo,second_revision::text,gen_random_uuid(),doc);
    raise exception 'Non-manager write accepted';
  exception when insufficient_privilege then null; end;
  if has_function_privilege('anon','public.get_photo_annotations(uuid,uuid)','execute')
     or has_function_privilege('anon','public.save_photo_annotations(uuid,uuid,text,uuid,jsonb)','execute')
     or has_table_privilege('authenticated','private.photo_annotation_history','select') then raise exception 'Excessive privilege'; end if;
end;
$$;
