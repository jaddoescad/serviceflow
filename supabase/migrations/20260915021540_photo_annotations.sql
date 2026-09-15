-- Annotation documents never replace original media bytes or accounting fields.
create table private.photo_annotation_history (
  media_id uuid not null references public.job_media(id),
  revision uuid not null,
  previous_revision text,
  document jsonb not null,
  actor_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(media_id,revision)
);
alter table private.photo_annotation_history enable row level security;
revoke all on private.photo_annotation_history from public, anon, authenticated;

create function private.valid_photo_annotations(document jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare shape jsonb; point jsonb; ids text[] := '{}'; kind text; count_points integer;
begin
  if document is null or jsonb_typeof(document)<>'object' or octet_length(document::text)>262144 then return false; end if;
  if document->'version' is distinct from '1'::jsonb or jsonb_typeof(document->'shapes') is distinct from 'array'
     or exists(select 1 from jsonb_object_keys(document) k where k not in ('version','shapes')) then return false; end if;
  if jsonb_array_length(document->'shapes')>200 then return false; end if;
  for shape in select value from jsonb_array_elements(document->'shapes') loop
    if jsonb_typeof(shape)<>'object' then return false; end if;
    if exists(select 1 from jsonb_object_keys(shape) k where k not in ('id','type','points','color','width','text','fontSize')) then return false; end if;
    if coalesce(shape->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (shape->>'id')=any(ids) then return false; end if;
    ids:=array_append(ids,shape->>'id');
    kind:=shape->>'type';
    if kind is null or kind not in ('arrow','line','rectangle','ellipse','draw','text') then return false; end if;
    if coalesce(shape->>'color','') !~ '^#[0-9a-fA-F]{6}$' then return false; end if;
    if jsonb_typeof(shape->'width') is distinct from 'number' then return false; end if;
    if (shape->>'width')::numeric<0.001 or (shape->>'width')::numeric>0.05 then return false; end if;
    if jsonb_typeof(shape->'points') is distinct from 'array' then return false; end if;
    count_points:=jsonb_array_length(shape->'points');
    if (kind='text' and count_points<>1) or (kind='draw' and (count_points<2 or count_points>2000))
       or (kind not in ('text','draw') and count_points<>2) then return false; end if;
    for point in select value from jsonb_array_elements(shape->'points') loop
      if jsonb_typeof(point)<>'object' then return false; end if;
      if jsonb_typeof(point->'x') is distinct from 'number' or jsonb_typeof(point->'y') is distinct from 'number'
         or exists(select 1 from jsonb_object_keys(point) k where k not in ('x','y')) then return false; end if;
      if (point->>'x')::numeric<0 or (point->>'x')::numeric>1 or (point->>'y')::numeric<0 or (point->>'y')::numeric>1 then return false; end if;
    end loop;
    if kind='text' then
      if jsonb_typeof(shape->'text') is distinct from 'string' or length(shape->>'text') not between 1 and 1000
         or jsonb_typeof(shape->'fontSize') is distinct from 'number' then return false; end if;
      if (shape->>'fontSize')::numeric<0.01 or (shape->>'fontSize')::numeric>0.2 then return false; end if;
    elsif shape ? 'text' or shape ? 'fontSize' then return false;
    end if;
  end loop;
  return true;
end;
$$;
revoke all on function private.valid_photo_annotations(jsonb) from public,anon,authenticated;

create function private.save_photo_annotations(requested_project_id uuid, requested_media_id uuid,
  expected_revision text, requested_revision uuid, requested_document jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare media public.job_media%rowtype; current_revision text;
begin
  if auth.uid() is null or not private.is_manager() then raise exception 'Only active managers can edit annotations.' using errcode='42501'; end if;
  if requested_revision is null or not private.valid_photo_annotations(requested_document) then raise exception 'Invalid annotations.' using errcode='22023'; end if;
  select * into media from public.job_media where id=requested_media_id
    and (job_id=requested_project_id or lead_id=requested_project_id) for update;
  if not found or media.media_type<>'image' or media.source_metadata->>'photo_trashed_at' is not null then
    raise exception 'Photo unavailable.' using errcode='P0002';
  end if;
  current_revision:=media.source_metadata->>'annotation_revision';
  if current_revision=requested_revision::text and media.source_metadata->'annotations'=requested_document then
    return jsonb_build_object('revision',current_revision,'document',requested_document);
  end if;
  if current_revision is distinct from expected_revision or current_revision=requested_revision::text
     or exists(select 1 from private.photo_annotation_history h where h.media_id=media.id and h.revision=requested_revision) then
    raise exception 'Annotations changed elsewhere. Reload before saving.' using errcode='PT409';
  end if;
  insert into private.photo_annotation_history(media_id,revision,previous_revision,document,actor_id)
    values(media.id,requested_revision,current_revision,requested_document,auth.uid());
  update public.job_media set source_metadata=source_metadata||jsonb_build_object(
    'annotations',requested_document,'annotation_revision',requested_revision,
    'annotation_edited_by',auth.uid(),'annotation_edited_at',clock_timestamp()),updated_at=clock_timestamp()
    where id=media.id;
  return jsonb_build_object('revision',requested_revision,'document',requested_document);
end;
$$;
revoke all on function private.save_photo_annotations(uuid,uuid,text,uuid,jsonb) from public,anon;
grant execute on function private.save_photo_annotations(uuid,uuid,text,uuid,jsonb) to authenticated;
create function public.save_photo_annotations(requested_project_id uuid, requested_media_id uuid,
  expected_revision text, requested_revision uuid, requested_document jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select private.save_photo_annotations(requested_project_id,requested_media_id,expected_revision,requested_revision,requested_document);
$$;
revoke all on function public.save_photo_annotations(uuid,uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.save_photo_annotations(uuid,uuid,text,uuid,jsonb) to authenticated;

create function public.get_photo_annotations(requested_project_id uuid, requested_media_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select jsonb_build_object('revision',source_metadata->>'annotation_revision',
    'document',coalesce(source_metadata->'annotations','{"version":1,"shapes":[]}'::jsonb))
  from public.job_media where id=requested_media_id and media_type='image'
    and (job_id=requested_project_id or lead_id=requested_project_id)
    and source_metadata->>'photo_trashed_at' is null;
$$;
revoke all on function public.get_photo_annotations(uuid,uuid) from public,anon;
grant execute on function public.get_photo_annotations(uuid,uuid) to authenticated;
