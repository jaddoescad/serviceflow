-- Durable, auditable many-to-many links between canonical DripJobs leads and
-- CompanyCam projects. Contact details may suggest a match, but are not keys.

create table if not exists public.marketing_lead_project_links (
  id uuid primary key default gen_random_uuid(),
  lead_deal_id text not null
    references public.marketing_leads(deal_id) on delete restrict,
  companycam_project_id text not null
    references public.companycam_projects(companycam_id) on delete restrict,
  relationship_type text not null default 'originated',
  link_status text not null default 'suggested',
  match_method text not null,
  confidence numeric(4,3) not null,
  evidence jsonb not null default '{}'::jsonb,
  review_note text,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint marketing_lead_project_links_pair_unique
    unique (lead_deal_id, companycam_project_id),
  constraint marketing_lead_project_links_relationship_check check (
    relationship_type in ('originated', 'related')
  ),
  constraint marketing_lead_project_links_status_check check (
    link_status in ('suggested', 'confirmed', 'rejected')
  ),
  constraint marketing_lead_project_links_method_check check (
    match_method in (
      'proposal_number',
      'companycam_relation_id',
      'dripjobs_contact_uuid',
      'email_and_phone',
      'email',
      'phone',
      'manual'
    )
  ),
  constraint marketing_lead_project_links_confidence_check check (
    confidence >= 0 and confidence <= 1
  ),
  constraint marketing_lead_project_links_confirmation_check check (
    link_status <> 'confirmed' or confirmed_at is not null
  )
);

create index if not exists marketing_lead_project_links_lead_idx
  on public.marketing_lead_project_links(lead_deal_id, link_status);
create index if not exists marketing_lead_project_links_project_idx
  on public.marketing_lead_project_links(companycam_project_id, link_status);
create index if not exists marketing_lead_project_links_review_idx
  on public.marketing_lead_project_links(link_status, confidence desc)
  where link_status = 'suggested';

-- A lead may legitimately produce several projects. A project can have only
-- one confirmed originating lead, while additional related leads remain valid.
create unique index if not exists marketing_lead_project_links_one_origin_idx
  on public.marketing_lead_project_links(companycam_project_id)
  where relationship_type = 'originated' and link_status = 'confirmed';

drop trigger if exists marketing_lead_project_links_set_updated_at
  on public.marketing_lead_project_links;
create trigger marketing_lead_project_links_set_updated_at
before update on public.marketing_lead_project_links
for each row execute function public.set_updated_at();

alter table public.marketing_lead_project_links enable row level security;

drop policy if exists "Managers can read marketing_lead_project_links"
  on public.marketing_lead_project_links;
create policy "Managers can read marketing_lead_project_links"
  on public.marketing_lead_project_links
  for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can insert marketing_lead_project_links"
  on public.marketing_lead_project_links;
create policy "Managers can insert marketing_lead_project_links"
  on public.marketing_lead_project_links
  for insert to authenticated
  with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can update marketing_lead_project_links"
  on public.marketing_lead_project_links;
create policy "Managers can update marketing_lead_project_links"
  on public.marketing_lead_project_links
  for update to authenticated
  using (public.current_employee_role() in ('admin', 'manager'))
  with check (public.current_employee_role() in ('admin', 'manager'));

drop policy if exists "Managers can delete marketing_lead_project_links"
  on public.marketing_lead_project_links;
create policy "Managers can delete marketing_lead_project_links"
  on public.marketing_lead_project_links
  for delete to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));

grant select, insert, update, delete
  on public.marketing_lead_project_links to authenticated;

comment on table public.marketing_lead_project_links is
  'Persistent lead-to-project evidence. Contact details are candidate evidence only; confirmed originating links remain one per project.';

select pg_notify('pgrst', 'reload schema');
