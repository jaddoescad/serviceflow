begin;
-- Called only by the authenticated account-management Edge Function.
create function public.manage_team_account(
  requested_actor uuid, requested_user uuid,
  requested_role text default null, requested_active boolean default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor public.employees%rowtype;
  target public.employees%rowtype;
  next_role text;
  next_active boolean;
begin
  if requested_role is null and requested_active is null then
    raise exception 'Choose an account change.' using errcode='22023';
  end if;
  if requested_role is not null and requested_role not in ('admin','manager','painter') then
    raise exception 'Invalid role.' using errcode='22023';
  end if;
  -- All account updates share the lock so actor/target privileges cannot race.
  perform pg_catalog.pg_advisory_xact_lock(917263541);
  select * into actor from public.employees where id=requested_actor for update;
  if not found or not actor.is_active or actor.role not in ('admin','manager') then
    raise exception 'Manager access required.' using errcode='42501';
  end if;
  select * into target from public.employees where id=requested_user for update;
  if not found then raise exception 'Employee not found.' using errcode='P0002'; end if;
  next_role := coalesce(requested_role,target.role);
  next_active := coalesce(requested_active,target.is_active);
  if actor.role <> 'admin' and (target.role='admin' or next_role='admin') then
    raise exception 'Only admins can manage admin accounts.' using errcode='42501';
  end if;
  if actor.id=target.id and (next_role<>target.role or not next_active) then
    raise exception 'Another admin must change your role or deactivate your account.' using errcode='42501';
  end if;
  if target.role='admin' and target.is_active and (next_role<>'admin' or not next_active)
    and not exists(select 1 from public.employees where role='admin' and is_active and id<>target.id) then
    raise exception 'Keep at least one active admin.' using errcode='22023';
  end if;
  update public.employees set role=next_role,is_active=next_active,updated_at=clock_timestamp()
    where id=target.id returning * into target;
  return jsonb_build_object('id',target.id,'full_name',target.full_name,'email',target.email,
    'role',target.role,'is_active',target.is_active);
end;
$$;
revoke all on function public.manage_team_account(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.manage_team_account(uuid,uuid,text,boolean) to service_role;
commit;
