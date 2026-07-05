create table if not exists public.employee_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('android', 'ios')),
  device_push_token text,
  app_version text,
  is_active boolean not null default true,
  last_registered_at timestamptz not null default timezone('utc', now()),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, expo_push_token)
);

create index if not exists employee_push_tokens_user_idx
  on public.employee_push_tokens (user_id);

create index if not exists employee_push_tokens_active_idx
  on public.employee_push_tokens (is_active, last_registered_at desc);

drop trigger if exists set_employee_push_tokens_updated_at on public.employee_push_tokens;
create trigger set_employee_push_tokens_updated_at
before update on public.employee_push_tokens
for each row execute function public.set_updated_at();

alter table public.employee_push_tokens enable row level security;

drop policy if exists "Users can read own push tokens" on public.employee_push_tokens;
create policy "Users can read own push tokens"
on public.employee_push_tokens
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can create own push tokens" on public.employee_push_tokens;
create policy "Users can create own push tokens"
on public.employee_push_tokens
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can update own push tokens" on public.employee_push_tokens;
create policy "Users can update own push tokens"
on public.employee_push_tokens
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can delete own push tokens" on public.employee_push_tokens;
create policy "Users can delete own push tokens"
on public.employee_push_tokens
for delete
to authenticated
using (user_id = auth.uid());
