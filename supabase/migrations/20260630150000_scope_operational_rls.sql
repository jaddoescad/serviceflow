create or replace function public.current_employee_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select profile.role
  from public.employee_profiles profile
  where profile.user_id = auth.uid()
    and profile.is_active = true
  limit 1
$$;

revoke all on function public.current_employee_role() from public;
grant execute on function public.current_employee_role() to authenticated;

drop policy if exists "Authenticated users can read employee profiles" on public.employee_profiles;
drop policy if exists "Users can read own employee profile" on public.employee_profiles;
create policy "Users can read own employee profile"
on public.employee_profiles
for select
to authenticated
using (
  user_id = auth.uid()
  or public.current_employee_role() in ('admin', 'manager')
);

drop policy if exists "Authenticated users can read project assignments" on public.project_assignments;
drop policy if exists "Users can read own project assignments" on public.project_assignments;
create policy "Users can read own project assignments"
on public.project_assignments
for select
to authenticated
using (
  user_id = auth.uid()
  or public.current_employee_role() in ('admin', 'manager')
);

drop policy if exists "Authenticated users can read time entries" on public.time_entries;
drop policy if exists "Users can read own time entries" on public.time_entries;
create policy "Users can read own time entries"
on public.time_entries
for select
to authenticated
using (
  user_id = auth.uid()
  or public.current_employee_role() in ('admin', 'manager')
);
