create table if not exists public.companycam_projects (
  companycam_id text primary key,
  name text not null,
  street_address_1 text,
  street_address_2 text,
  city text,
  state text,
  postal_code text,
  country text,
  formatted_address text,
  latitude double precision,
  longitude double precision,
  is_archived boolean not null default false,
  companycam_created_at timestamptz,
  companycam_updated_at timestamptz,
  raw jsonb not null,
  last_synced_at timestamptz not null default timezone('utc', now()),
  inserted_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists companycam_projects_name_idx on public.companycam_projects using btree (name);
create index if not exists companycam_projects_updated_idx on public.companycam_projects using btree (companycam_updated_at desc nulls last);

alter table public.companycam_projects enable row level security;

drop policy if exists "Authenticated users can read CompanyCam projects" on public.companycam_projects;
create policy "Authenticated users can read CompanyCam projects"
  on public.companycam_projects
  for select
  to authenticated
  using (true);
