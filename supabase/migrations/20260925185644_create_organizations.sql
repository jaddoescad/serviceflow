-- Phase 1, step 1 of multi-company ServiceFlow (see
-- ottawa-painters-app/docs/multi-company-plan.md). Adds companies and
-- memberships alongside the existing single-company model. Nothing reads these
-- tables yet, so app and admin behaviour is unchanged. Until the cutover,
-- public.employees stays the source of truth and a trigger mirrors it into
-- Ottawa Painters memberships.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  trade text,
  timezone text not null default 'America/Toronto',
  phone text,
  address text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Role is per company: the same person can manage one company and work crew
-- at another.
create table public.org_members (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'manager', 'crew')),
  is_active boolean not null default true,
  job_title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_id_idx on public.org_members (user_id);

-- ServiceFlow staff. Deliberately separate from company roles.
create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create function private.my_org_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.org_id
  from public.org_members m
  join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid() and m.is_active and o.status = 'active'
$$;

create function private.org_role(requested_org_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select m.role
  from public.org_members m
  join public.organizations o on o.id = m.org_id
  where m.org_id = requested_org_id
    and m.user_id = auth.uid()
    and m.is_active
    and o.status = 'active'
$$;

create function private.is_org_member(requested_org_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.org_role(requested_org_id) is not null
$$;

create function private.is_org_manager(requested_org_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.org_role(requested_org_id) in ('owner', 'admin', 'manager'), false)
$$;

create function private.is_platform_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

revoke all on function private.my_org_ids(), private.org_role(uuid),
  private.is_org_member(uuid), private.is_org_manager(uuid),
  private.is_platform_admin() from public, anon;
grant execute on function private.my_org_ids(), private.org_role(uuid),
  private.is_org_member(uuid), private.is_org_manager(uuid),
  private.is_platform_admin() to authenticated;

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.platform_admins enable row level security;

-- Reads only. Writes go through RPCs added with invites and company signup.
revoke all on public.organizations, public.org_members, public.platform_admins
  from anon, authenticated;
grant select on public.organizations, public.org_members to authenticated;

create policy organizations_member_read on public.organizations
  for select to authenticated
  using (id in (select private.my_org_ids()) or (select private.is_platform_admin()));

create policy org_members_same_org_read on public.org_members
  for select to authenticated
  using (org_id in (select private.my_org_ids()) or (select private.is_platform_admin()));

-- Ottawa Painters is the first company; every existing employee joins it.
insert into public.organizations (name, slug, trade, timezone, created_by)
select 'Ottawa Painters', 'ottawa-painters', 'painting', 'America/Toronto', e.id
from public.employees e
where e.email = 'info@paintersottawa.com' and e.role = 'admin';

insert into public.platform_admins (user_id)
select e.id from public.employees e
where e.email = 'info@paintersottawa.com' and e.role = 'admin';

create function private.employee_org_role(employee_role text, employee_email text)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when employee_email = 'info@paintersottawa.com' and employee_role = 'admin' then 'owner'
    when employee_role in ('admin', 'manager') then employee_role
    else 'crew'
  end
$$;

insert into public.org_members (org_id, user_id, role, is_active, job_title, created_at)
select o.id, e.id, private.employee_org_role(e.role, e.email), e.is_active, e.job_title, e.created_at
from public.employees e
cross join public.organizations o
where o.slug = 'ottawa-painters';

-- Keep Ottawa Painters memberships in step with employees until the apps
-- manage memberships directly (manage_team_account, office create-employee).
create function private.mirror_employee_membership()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.org_members (org_id, user_id, role, is_active, job_title)
  select o.id, new.id, private.employee_org_role(new.role, new.email), new.is_active, new.job_title
  from public.organizations o
  where o.slug = 'ottawa-painters'
  on conflict (org_id, user_id) do update
    set role = excluded.role,
        is_active = excluded.is_active,
        job_title = excluded.job_title,
        updated_at = now();
  return new;
end
$$;

create trigger employees_mirror_membership
  after insert or update of role, is_active, job_title, email on public.employees
  for each row execute function private.mirror_employee_membership();
