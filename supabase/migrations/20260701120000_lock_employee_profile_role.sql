-- Prevent privilege escalation through employee_profiles.
--
-- Row-level security lets a signed-in user read (and, in some flows, write) their
-- own profile row. Without a guard, a non-admin caller could set or change their
-- own `role` to 'admin'/'manager' or flip `is_active`, escalating privileges.
--
-- This trigger enforces that only the service role (edge functions using the
-- service key) or an existing active admin may set/change `role` or `is_active`.
-- Everyone else is forced to the safe defaults on INSERT and blocked from
-- changing those columns on UPDATE.
--
-- Detection notes:
--   * Service role bypasses RLS but NOT ordinary BEFORE triggers, so we detect it
--     explicitly. `auth.role()` (falling back to the request JWT claims) returns
--     'service_role' for service-key callers.
--   * `public.current_employee_role()` (migration 20260630150000) returns the
--     active role of the currently authenticated user, or null.

create or replace function public.enforce_employee_profile_role_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The JWT role of the caller. Service-key callers report 'service_role'.
  jwt_role text := coalesce(
    auth.role(),
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role',
    ''
  );
  -- The active employee role of the signed-in user (null when not an employee).
  caller_role text := public.current_employee_role();
  is_privileged boolean := jwt_role = 'service_role' or caller_role = 'admin';
begin
  if tg_op = 'INSERT' then
    -- Non-privileged callers can only ever create a plain, active painter.
    if not is_privileged then
      new.role := 'painter';
      new.is_active := true;
    end if;
    return new;
  end if;

  -- UPDATE: block non-privileged callers from touching role / is_active.
  if not is_privileged and (new.role <> old.role or new.is_active <> old.is_active) then
    raise exception 'Only service role or an admin may change role or is_active on employee_profiles'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_employee_profile_role_guard() from public;

drop trigger if exists enforce_employee_profile_role_guard on public.employee_profiles;
create trigger enforce_employee_profile_role_guard
before insert or update on public.employee_profiles
for each row
execute function public.enforce_employee_profile_role_guard();
