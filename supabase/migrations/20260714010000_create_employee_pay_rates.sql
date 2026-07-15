-- Track historical employee pay rates so labour cost calculations remain
-- stable when a painter's hourly rate changes. Job amounts stay in their
-- existing tax-inclusive column; the dashboard removes HST at calculation
-- time so change orders only require one amount update.

create table if not exists public.employee_pay_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.employee_profiles(user_id) on delete cascade,
  hourly_rate numeric(10, 2) not null check (hourly_rate > 0),
  effective_from date not null,
  notes text,
  inserted_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint employee_pay_rates_user_effective_key unique (user_id, effective_from)
);

create index if not exists employee_pay_rates_user_effective_idx
  on public.employee_pay_rates(user_id, effective_from desc);

drop trigger if exists set_employee_pay_rates_updated_at on public.employee_pay_rates;
create trigger set_employee_pay_rates_updated_at
before update on public.employee_pay_rates
for each row execute function public.set_updated_at();

alter table public.employee_pay_rates enable row level security;

drop policy if exists "Managers can read employee pay rates" on public.employee_pay_rates;
create policy "Managers can read employee pay rates"
on public.employee_pay_rates
for select
to authenticated
using (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can insert employee pay rates" on public.employee_pay_rates;
create policy "Managers can insert employee pay rates"
on public.employee_pay_rates
for insert
to authenticated
with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can update employee pay rates" on public.employee_pay_rates;
create policy "Managers can update employee pay rates"
on public.employee_pay_rates
for update
to authenticated
using (public.current_employee_role() in ('admin', 'manager'))
with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Admins can delete employee pay rates" on public.employee_pay_rates;
create policy "Admins can delete employee pay rates"
on public.employee_pay_rates
for delete
to authenticated
using (public.current_employee_role() = 'admin');

-- The stated starting rates apply from each matching employee's earliest
-- recorded time entry. A later raise is added as a new effective-dated row.
with initial_rates as (
  select
    profile.user_id,
    case
      when lower(trim(profile.full_name)) ~ '^scott[[:space:]]+madden([[:space:]]|$)' then 35::numeric
      when lower(trim(profile.full_name)) ~ '^(michael|micheal|bilal)([[:space:]]|$)' then 30::numeric
      else null
    end as hourly_rate,
    coalesce(
      (
        select min(entry.started_at::date)
        from public.time_entries entry
        where entry.user_id = profile.user_id
      ),
      current_date
    ) as effective_from
  from public.employee_profiles profile
)
insert into public.employee_pay_rates (user_id, hourly_rate, effective_from, notes)
select user_id, hourly_rate, effective_from, 'Initial rate supplied July 2026'
from initial_rates
where hourly_rate is not null
on conflict (user_id, effective_from) do nothing;

do $$
declare
  seeded_count integer;
begin
  select count(*)
  into seeded_count
  from public.employee_pay_rates rate
  join public.employee_profiles profile on profile.user_id = rate.user_id
  where
    lower(trim(profile.full_name)) ~ '^scott[[:space:]]+madden([[:space:]]|$)'
    or lower(trim(profile.full_name)) ~ '^(michael|micheal|bilal)([[:space:]]|$)';

  if seeded_count <> 3 then
    raise exception 'Expected initial pay rates for Michael, Bilal, and Scott Madden; found % matching rates', seeded_count;
  end if;
end
$$;

comment on table public.employee_pay_rates is
  'Effective-dated employee hourly pay rates used to price historical time entries.';
