begin;
alter table public.employees add column phone text, add column job_title text;
create function public.edit_team_profile(
  requested_user uuid, requested_name text, requested_phone text,
  requested_job_title text, expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.employees%rowtype;
  target public.employees%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(917263541);
  select * into actor from public.employees where id=auth.uid();
  if not found or not actor.is_active or actor.role <> 'admin' then
    raise exception 'Admin access required.' using errcode='42501';
  end if;
  if nullif(btrim(requested_name),'') is null or length(btrim(requested_name))>120
    or length(coalesce(requested_phone,''))>60 or length(coalesce(requested_job_title,''))>120 then
    raise exception 'Check the profile fields.' using errcode='22023';
  end if;
  select * into target from public.employees where id=requested_user for update;
  if not found then raise exception 'User not found.' using errcode='P0002'; end if;
  if target.updated_at is distinct from expected_updated_at then
    raise exception 'This profile changed. Close and reopen it before saving.' using errcode='PT409';
  end if;
  update public.employees set full_name=btrim(requested_name),phone=nullif(btrim(requested_phone),''),
    job_title=nullif(btrim(requested_job_title),''),updated_at=clock_timestamp()
    where id=requested_user returning * into target;
  return jsonb_build_object('id',target.id,'full_name',target.full_name,'phone',target.phone,
    'job_title',target.job_title,'updated_at',target.updated_at);
end;
$$;
revoke all on function public.edit_team_profile(uuid,text,text,text,timestamptz) from public,anon;
grant execute on function public.edit_team_profile(uuid,text,text,text,timestamptz) to authenticated;
commit;
