-- Self-serve companies for the public App Store release:
--   create_company        anyone signed in starts a company and becomes its owner
--   invitations           managers invite crew with a one-time code
--   account deletion      the app lets people delete their account (Apple 5.1.1(v))
--
-- A person's profile is their public.employees row (name, email, phone); their
-- role and access come from org_members.

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

-- Create the signed-in person's profile if they don't have one yet. Returns
-- nothing; callers add the membership themselves.
create function private.ensure_my_profile(legacy_role text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  account auth.users%rowtype;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if exists (select 1 from public.employees where id = me) then
    return;
  end if;
  select * into account from auth.users where id = me;
  insert into public.employees (id, email, full_name, role, is_active)
  values (
    me,
    account.email,
    coalesce(
      nullif(btrim(account.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(account.email, ''), '@', 1), ''),
      'New member'),
    legacy_role,
    true);
end
$$;

revoke all on function private.ensure_my_profile(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Create a company
-- ---------------------------------------------------------------------------

create function public.create_company(requested_name text, requested_trade text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  clean_name text := btrim(coalesce(requested_name, ''));
  base_slug text;
  new_org public.organizations%rowtype;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if clean_name = '' or length(clean_name) > 120 then
    raise exception 'Enter a company name (up to 120 characters).' using errcode = '22023';
  end if;
  if requested_trade is not null and requested_trade not in (
    'painting', 'plumbing', 'electrical', 'hvac', 'cleaning', 'landscaping',
    'general_contracting', 'other') then
    raise exception 'Choose a trade from the list.' using errcode = '22023';
  end if;
  if (select count(*) from public.organizations where created_by = me) >= 3 then
    raise exception 'You can create up to 3 companies. Contact support for more.' using errcode = '22023';
  end if;

  base_slug := coalesce(
    nullif(trim(both '-' from regexp_replace(lower(clean_name), '[^a-z0-9]+', '-', 'g')), ''),
    'company');
  insert into public.organizations (name, slug, trade, created_by)
  values (clean_name, left(base_slug, 60) || '-' || substr(md5(extensions.gen_random_uuid()::text), 1, 6),
          requested_trade, me)
  returning * into new_org;

  -- Owners get the legacy admin role so older app versions show manager screens.
  perform private.ensure_my_profile('admin');
  insert into public.org_members (org_id, user_id, role, is_active)
  values (new_org.id, me, 'owner', true);

  return jsonb_build_object('org_id', new_org.id, 'name', new_org.name, 'role', 'owner');
end
$$;

-- ---------------------------------------------------------------------------
-- Invitations
-- ---------------------------------------------------------------------------

create table public.org_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  email text check (email is null or length(email) <= 320),
  role text not null check (role in ('admin', 'manager', 'crew')),
  code_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz
);
create index org_invitations_org_id_idx on public.org_invitations (org_id);

alter table public.org_invitations enable row level security;
revoke all on public.org_invitations from anon, authenticated;
grant select on public.org_invitations to authenticated;

-- Managers see their company's invitations; the code itself is never stored.
create policy org_manager_read on public.org_invitations for select to authenticated
  using (org_id in (select private.my_managed_org_ids()));

-- Codes look like K7QM-2XPA: 8 characters without look-alikes (0/O, 1/I/L).
create function private.normalize_invite_code(code text)
returns text
language sql immutable set search_path = ''
as $$
  select upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

create function private.invite_code_hash(code text)
returns text
language sql immutable set search_path = ''
as $$
  select encode(extensions.digest(private.normalize_invite_code(code), 'sha256'), 'hex')
$$;

create function public.create_invitation(
  requested_role text default 'crew',
  requested_email text default null,
  requested_org_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := coalesce(requested_org_id, private.acting_org_id());
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  raw_code text := '';
  random_bytes bytea := extensions.gen_random_bytes(8);
  invitation public.org_invitations%rowtype;
  i integer;
begin
  perform private.set_acting_org(company);
  if not private.is_org_manager(company) then
    raise exception 'Manager access required.' using errcode = '42501';
  end if;
  if requested_role not in ('admin', 'manager', 'crew') then
    raise exception 'Choose a role: admin, manager or crew.' using errcode = '22023';
  end if;
  if requested_role = 'admin' and private.org_role(company) not in ('owner', 'admin') then
    raise exception 'Only admins can invite admins.' using errcode = '42501';
  end if;
  if (select count(*) from public.org_invitations
      where org_id = company and created_at > now() - interval '1 day') >= 100 then
    raise exception 'Too many invitations today. Try again tomorrow.' using errcode = '22023';
  end if;

  for i in 0 .. 7 loop
    raw_code := raw_code || substr(alphabet, (get_byte(random_bytes, i) % length(alphabet)) + 1, 1);
  end loop;

  insert into public.org_invitations (org_id, email, role, code_hash, invited_by)
  values (company, nullif(lower(btrim(requested_email)), ''), requested_role,
          private.invite_code_hash(raw_code), auth.uid())
  returning * into invitation;

  return jsonb_build_object(
    'id', invitation.id,
    'code', substr(raw_code, 1, 4) || '-' || substr(raw_code, 5, 4),
    'role', invitation.role,
    'email', invitation.email,
    'expires_at', invitation.expires_at);
end
$$;

create function public.revoke_invitation(invitation_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := (select org_id from public.org_invitations where id = invitation_id);
begin
  if company is null then
    raise exception 'Invitation not found.' using errcode = 'P0002';
  end if;
  perform private.set_acting_org(company);
  if not private.is_org_manager(company) then
    raise exception 'Manager access required.' using errcode = '42501';
  end if;
  update public.org_invitations
  set revoked_at = coalesce(revoked_at, now())
  where id = invitation_id and accepted_at is null;
end
$$;

create function public.accept_invitation(code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  invitation public.org_invitations%rowtype;
  company public.organizations%rowtype;
  existing public.org_members%rowtype;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if length(private.normalize_invite_code(code)) <> 8 then
    raise exception 'Enter the 8-character code from your invitation.' using errcode = '22023';
  end if;

  select * into invitation from public.org_invitations
  where code_hash = private.invite_code_hash(code)
  for update;
  if not found or invitation.revoked_at is not null then
    raise exception 'That invitation code isn''t valid. Ask your manager for a new one.' using errcode = 'P0002';
  end if;
  if invitation.accepted_at is not null then
    raise exception 'That invitation has already been used. Ask your manager for a new one.' using errcode = '22023';
  end if;
  if invitation.expires_at < now() then
    raise exception 'That invitation has expired. Ask your manager for a new one.' using errcode = '22023';
  end if;

  select * into company from public.organizations where id = invitation.org_id;
  if company.status <> 'active' then
    raise exception 'This company isn''t active on ServiceFlow.' using errcode = '42501';
  end if;

  select * into existing from public.org_members
  where org_id = invitation.org_id and user_id = me;
  if found and existing.is_active then
    raise exception 'You''re already a member of %.', company.name using errcode = '22023';
  end if;

  perform private.ensure_my_profile(case invitation.role
    when 'crew' then 'painter' else invitation.role end);

  -- A new invitation brings back someone who was deactivated, in the invited role.
  insert into public.org_members (org_id, user_id, role, is_active)
  values (invitation.org_id, me, invitation.role, true)
  on conflict (org_id, user_id) do update
    set role = case when public.org_members.role = 'owner' then 'owner' else excluded.role end,
        is_active = true,
        updated_at = now();

  update public.org_invitations
  set accepted_at = now(), accepted_by = me
  where id = invitation.id;

  return jsonb_build_object('org_id', company.id, 'name', company.name, 'role', invitation.role);
end
$$;

-- ---------------------------------------------------------------------------
-- Account deletion
-- ---------------------------------------------------------------------------

-- Called by the delete-account edge function (service role) before it
-- soft-deletes the login. Time entries and uploaded photos stay: companies keep
-- them for payroll and project records, attributed to "Deleted user".
create function public.prepare_account_deletion(requested_user uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  blocking_company text;
begin
  -- Don't strand a team: the last owner or admin of a company that still has
  -- other active members must hand it over first.
  select o.name into blocking_company
  from public.org_members me
  join public.organizations o on o.id = me.org_id
  where me.user_id = requested_user
    and me.is_active
    and me.role in ('owner', 'admin')
    and not exists (
      select 1 from public.org_members other
      where other.org_id = me.org_id and other.user_id <> requested_user
        and other.is_active and other.role in ('owner', 'admin'))
    and exists (
      select 1 from public.org_members other
      where other.org_id = me.org_id and other.user_id <> requested_user and other.is_active)
  limit 1;
  if blocking_company is not null then
    return jsonb_build_object('ok', false, 'reason', 'last_admin', 'company', blocking_company);
  end if;

  -- Companies with no one else left are suspended rather than orphaned.
  update public.organizations o
  set status = 'suspended', updated_at = now()
  where exists (select 1 from public.org_members m where m.org_id = o.id and m.user_id = requested_user and m.is_active)
    and not exists (select 1 from public.org_members m where m.org_id = o.id and m.user_id <> requested_user and m.is_active);

  update public.org_members set is_active = false, updated_at = now() where user_id = requested_user;
  delete from public.push_tokens where employee_id = requested_user;
  delete from public.employee_location_points where employee_id = requested_user;
  delete from public.employee_tracking_status where employee_id = requested_user;
  delete from public.location_alerts where employee_id = requested_user;
  update public.employees
  set full_name = 'Deleted user', email = null, phone = null, job_title = null,
      is_active = false, updated_at = now()
  where id = requested_user;

  return jsonb_build_object('ok', true);
end
$$;

revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.create_company(text, text), public.create_invitation(text, text, uuid),
  public.revoke_invitation(uuid), public.accept_invitation(text) from public, anon;
grant execute on function public.create_company(text, text), public.create_invitation(text, text, uuid),
  public.revoke_invitation(uuid), public.accept_invitation(text) to authenticated;

revoke all on function private.normalize_invite_code(text), private.invite_code_hash(text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
