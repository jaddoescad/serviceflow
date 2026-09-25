-- Phase 1 follow-up. Permissions come from company membership, not the global
-- employees row. employees is the person's profile (name, email, phone);
-- employees.role and employees.is_active remain only as Ottawa Painters'
-- legacy fields for the admin team page and existing tools.
--
-- 1. New employee rows join a company only when created inside that
--    company's action, or server-side by Ottawa Painters' existing tools
--    (admin "create team member", office script). A person who signs up on
--    their own joins no company. Legacy role/active changes sync to the
--    Ottawa Painters membership only, and never demote an owner.
-- 2. "Active employee", "manager" and "admin" checks inside functions read
--    the membership of the company the call acts in.
-- 3. manage_team_account changes the membership in its company, and mirrors
--    to the legacy employees fields only for Ottawa Painters.

-- Active member of the company this call acts in. Unlike acting_org_id(),
-- never raises, so callers keep their own error messages.
create function private.acting_member()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.is_org_member(coalesce(
    nullif(current_setting('serviceflow.org_id', true), '')::uuid,
    (select case when count(*) = 1 then (array_agg(o))[1] end from private.my_org_ids() o)
  )), false)
$$;

revoke all on function private.acting_member() from public, anon;
grant execute on function private.acting_member() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Employee rows and memberships
-- ---------------------------------------------------------------------------

create or replace function private.mirror_employee_membership()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  context_org uuid := nullif(current_setting('serviceflow.org_id', true), '')::uuid;
  target_org uuid;
begin
  if tg_op = 'INSERT' then
    target_org := case
      when context_org is not null then context_org
      when auth.uid() is null then private.legacy_default_org_id()
    end;
    if target_org is not null then
      insert into public.org_members (org_id, user_id, role, is_active, job_title)
      values (target_org, new.id, private.employee_org_role(new.role, new.email),
              new.is_active, new.job_title)
      on conflict (org_id, user_id) do nothing;
    end if;
    return new;
  end if;

  update public.org_members m
  set role = case
        when new.role is not distinct from old.role then m.role
        when m.role = 'owner' and new.role = 'admin' then 'owner'
        else private.employee_org_role(new.role, new.email)
      end,
      is_active = new.is_active,
      job_title = new.job_title,
      updated_at = now()
  where m.org_id = private.legacy_default_org_id()
    and m.user_id = new.id
    and (new.role is distinct from old.role
      or new.is_active is distinct from old.is_active
      or new.job_title is distinct from old.job_title);
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Membership-based checks inside existing functions
-- ---------------------------------------------------------------------------

-- Each pattern must match exactly once, or the migration stops.
do $$
declare
  patch record;
  definition text;
  patched text;
begin
  for patch in
    select * from (values
      ('private.create_workspace_project__unscoped(uuid,text,uuid,text)'::regprocedure,
       $p$exists\s*\(\s*select\s+1\s+from\s+public\.employees\s+where\s+id\s*=\s*auth\.uid\(\)\s+and\s+is_active\s+and\s+role\s+in\s*\(\s*'admin'\s*,\s*'manager'\s*\)\s*\)$p$,
       'private.is_manager()'),
      ('public.set_project_labels(uuid,uuid[])'::regprocedure,
       $p$exists\s*\(\s*select\s+1\s+from\s+public\.employees\s+where\s+id\s*=\s*auth\.uid\(\)\s+and\s+is_active\s+and\s+role\s+in\s*\(\s*'admin'\s*,\s*'manager'\s*\)\s*\)$p$,
       'private.is_manager()'),
      ('private.save_project_profile__unscoped(uuid,text,text,text,text,text,text,text,text)'::regprocedure,
       $p$exists\s*\(\s*select\s+1\s+from\s+public\.employees\s+e\s+where\s+e\.id\s*=\s*auth\.uid\(\)\s+and\s+e\.is_active\s+and\s+e\.role\s+in\s*\(\s*'admin'\s*,\s*'manager'\s*\)\s*\)$p$,
       'private.is_manager()'),
      ('private.ensure_lead_clock_in_job__unscoped(uuid)'::regprocedure,
       $p$not\s+exists\s*\(\s*select\s+1\s+from\s+public\.employees\s+employee\s+where\s+employee\.id\s*=\s*actor_id\s+and\s+employee\.is_active\s*\)$p$,
       'not private.acting_member()'),
      ('private.record_location_update__unscoped(jsonb,jsonb)'::regprocedure,
       $p$not\s+exists\s*\(\s*select\s+1\s+from\s+public\.employees\s+employee\s+where\s+employee\.id\s*=\s*actor_id\s+and\s+employee\.is_active\s*\)$p$,
       'not private.acting_member()'),
      ('public.register_push_token(jsonb)'::regprocedure,
       $p$not\s+exists\s*\(\s*select\s+1\s+from\s+public\.employees\s+employee\s+where\s+employee\.id\s*=\s*actor_id\s+and\s+employee\.is_active\s*\)$p$,
       'not exists (select 1 from private.my_org_ids())'),
      ('private.record_time_entry_command__unscoped(text,jsonb,jsonb)'::regprocedure,
       $p$where\s+employee\.id\s*=\s*actor_id\s+and\s+employee\.is_active$p$,
       'where employee.id = actor_id and private.acting_member()'),
      ('private.set_photo_trash__unscoped(uuid,uuid,boolean,text,uuid)'::regprocedure,
       $p$not\s+exists\s*\(\s*select\s+1\s+from\s+public\.employees\s+where\s+id\s*=\s*actor\s+and\s+is_active\s*\)$p$,
       'not private.acting_member()'),
      ('private.edit_team_profile__unscoped(uuid,text,text,text,timestamptz)'::regprocedure,
       $p$if\s+not\s+found\s+or\s+not\s+actor\.is_active\s+or\s+actor\.role\s*<>\s*'admin'\s+then$p$,
       $r$if not found or coalesce(private.org_role(private.acting_org_id()) not in ('owner', 'admin'), true) then$r$)
    ) as t(fn, pattern, replacement)
  loop
    definition := pg_get_functiondef(patch.fn);
    if (select count(*) from regexp_matches(definition, patch.pattern, 'g')) <> 1 then
      raise exception 'Expected exactly one match in %', patch.fn;
    end if;
    patched := regexp_replace(definition, patch.pattern, patch.replacement);
    execute patched;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Team account changes inside a company
-- ---------------------------------------------------------------------------

-- Same inputs and output as before, with the legacy role names the admin
-- sends (admin / manager / painter). The wrapper has already put the call in
-- the company both people share.
create or replace function private.manage_team_account__unscoped(
  requested_actor uuid, requested_user uuid,
  requested_role text default null, requested_active boolean default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.acting_org_id();
  actor public.org_members%rowtype;
  target public.org_members%rowtype;
  profile public.employees%rowtype;
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
  select * into actor from public.org_members
  where org_id = company and user_id = requested_actor for update;
  if not found or not actor.is_active or actor.role not in ('owner','admin','manager') then
    raise exception 'Manager access required.' using errcode='42501';
  end if;
  select * into target from public.org_members
  where org_id = company and user_id = requested_user for update;
  if not found then raise exception 'Employee not found.' using errcode='P0002'; end if;

  next_role := case
    when requested_role is null then target.role
    when requested_role = 'painter' then 'crew'
    when requested_role = 'admin' and target.role = 'owner' then 'owner'
    else requested_role
  end;
  next_active := coalesce(requested_active, target.is_active);

  if actor.role not in ('owner','admin') and (target.role in ('owner','admin') or next_role = 'admin') then
    raise exception 'Only admins can manage admin accounts.' using errcode='42501';
  end if;
  if target.role = 'owner' and (next_role <> 'owner' or not next_active) then
    raise exception 'The company owner''s account can''t be changed here.' using errcode='42501';
  end if;
  if actor.user_id = target.user_id and (next_role <> target.role or not next_active) then
    raise exception 'Another admin must change your role or deactivate your account.' using errcode='42501';
  end if;
  if target.role in ('owner','admin') and target.is_active
    and (next_role not in ('owner','admin') or not next_active)
    and not exists (
      select 1 from public.org_members
      where org_id = company and role in ('owner','admin') and is_active and user_id <> target.user_id
    ) then
    raise exception 'Keep at least one active admin.' using errcode='22023';
  end if;

  update public.org_members
  set role = next_role, is_active = next_active, updated_at = now()
  where org_id = company and user_id = target.user_id
  returning * into target;

  if company = private.legacy_default_org_id() then
    update public.employees
    set role = case target.role when 'crew' then 'painter' when 'owner' then 'admin' else target.role end,
        is_active = target.is_active,
        updated_at = clock_timestamp()
    where id = target.user_id;
  end if;

  select * into profile from public.employees where id = target.user_id;
  return jsonb_build_object('id', target.user_id, 'full_name', profile.full_name, 'email', profile.email,
    'role', case target.role when 'crew' then 'painter' when 'owner' then 'admin' else target.role end,
    'is_active', target.is_active);
end
$$;

revoke all on function private.manage_team_account__unscoped(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
