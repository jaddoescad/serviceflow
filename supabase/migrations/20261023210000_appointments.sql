-- Appointments: estimate visits and other bookings on a deal or job. Booking
-- one for an early deal moves it to Estimate Scheduled and records its date
-- on the lead, which the sales pipeline card shows.
begin;

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  assigned_to uuid references public.employees(id) on delete set null,
  location text check (char_length(location) <= 500),
  notes text check (char_length(notes) <= 4000),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'cancelled')),
  created_by uuid default auth.uid() references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '7 days')
);
create index appointments_org_time_idx on public.appointments (org_id, starts_at);
create index appointments_project_idx on public.appointments (project_id, starts_at);

alter table public.appointments enable row level security;
revoke all on public.appointments from anon, authenticated;
grant select on public.appointments to authenticated;
create policy org_member_read on public.appointments for select to authenticated
  using (org_id in (select private.my_org_ids()));

create function public.save_appointment(
  requested_id uuid, requested_project uuid, requested_title text, requested_starts_at timestamptz,
  requested_ends_at timestamptz, requested_assigned_to uuid, requested_location text,
  requested_notes text, requested_status text default 'scheduled')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.org_of_project(requested_project);
  existing public.appointments%rowtype;
begin
  if company is null then
    raise exception 'Deal or job not found.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(company) then
    raise exception 'Only managers can book appointments.' using errcode = '42501';
  end if;
  if requested_assigned_to is not null and not exists (
    select 1 from public.org_members
    where org_id = company and user_id = requested_assigned_to and is_active) then
    raise exception 'Assign someone on your team.' using errcode = '22023';
  end if;
  if requested_status not in ('scheduled', 'completed', 'cancelled') then
    raise exception 'Unknown appointment status.' using errcode = '22023';
  end if;
  perform private.set_acting_org(company);

  select * into existing from public.appointments where id = requested_id for update;
  if found and existing.org_id <> company then
    raise exception 'Appointment belongs to another company.' using errcode = '42501';
  end if;
  insert into public.appointments as a (
    id, org_id, project_id, title, starts_at, ends_at, assigned_to, location, notes, status)
  values (
    requested_id, company, requested_project, btrim(requested_title), requested_starts_at,
    requested_ends_at, requested_assigned_to, nullif(btrim(requested_location), ''),
    nullif(btrim(requested_notes), ''), requested_status)
  on conflict (id) do update set
    project_id = excluded.project_id, title = excluded.title, starts_at = excluded.starts_at,
    ends_at = excluded.ends_at, assigned_to = excluded.assigned_to, location = excluded.location,
    notes = excluded.notes, status = excluded.status, updated_at = now();

  -- The lead card shows its next estimate visit.
  update public.leads l set
    status = case when l.status in ('new', 'contacted') then 'estimate_scheduled' else l.status end,
    estimate_appointment_on = (
      select min((a.starts_at at time zone o.timezone)::date)
      from public.appointments a
      join public.organizations o on o.id = a.org_id
      where a.project_id = l.id and a.status = 'scheduled' and a.starts_at >= now() - interval '1 day'),
    updated_at = now()
  where l.id = requested_project;
  return requested_id;
end
$$;
revoke all on function public.save_appointment(uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text) from public, anon;
grant execute on function public.save_appointment(uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text) to authenticated;

create function public.get_appointments(range_start timestamptz, range_end timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see appointments.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'projectId', a.project_id, 'title', a.title, 'startsAt', a.starts_at,
      'endsAt', a.ends_at, 'assignedTo', a.assigned_to, 'assigneeName', e.full_name,
      'location', a.location, 'notes', a.notes, 'status', a.status,
      'projectName', d.name, 'projectAddress', d.address) order by a.starts_at)
    from public.appointments a
    left join public.employees e on e.id = a.assigned_to
    left join public.project_directory d on d.id = a.project_id
    where a.org_id = company and a.starts_at < range_end and a.ends_at > range_start
  ), '[]'::jsonb);
end
$$;
revoke all on function public.get_appointments(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_appointments(timestamptz, timestamptz) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
