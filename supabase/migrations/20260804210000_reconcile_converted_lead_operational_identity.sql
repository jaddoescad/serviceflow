-- Reconcile historical DripJobs leads that converted while their app pointer
-- still referenced a separate CompanyCam lead card. One lead lifecycle now
-- resolves to one operational job, while every superseded ID remains an
-- auditable alias and no source row is deleted.

begin;

create table if not exists public.project_identity_aliases (
  alias_project_id text primary key
    references public.companycam_projects(companycam_id) on delete restrict,
  canonical_project_id text not null
    references public.companycam_projects(companycam_id) on delete restrict,
  job_proposal_id text
    references public.dripjobs_jobs(proposal_id) on delete restrict,
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_identity_aliases_not_self check (
    alias_project_id <> canonical_project_id
  )
);

create index if not exists project_identity_aliases_canonical_idx
  on public.project_identity_aliases(canonical_project_id);

drop trigger if exists project_identity_aliases_set_updated_at
  on public.project_identity_aliases;
create trigger project_identity_aliases_set_updated_at
before update on public.project_identity_aliases
for each row execute function public.set_updated_at();

alter table public.project_identity_aliases enable row level security;

drop policy if exists "Authenticated users can resolve project aliases"
  on public.project_identity_aliases;
create policy "Authenticated users can resolve project aliases"
  on public.project_identity_aliases for select to authenticated
  using (auth.uid() is not null);

grant select on public.project_identity_aliases to authenticated;

create or replace function public.resolve_operational_project_id(
  requested_project_id text
)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  current_project_id text := requested_project_id;
  next_project_id text;
begin
  if nullif(btrim(requested_project_id), '') is null then
    return requested_project_id;
  end if;

  for hop in 1..8 loop
    select alias.canonical_project_id
    into next_project_id
    from public.project_identity_aliases alias
    where alias.alias_project_id = current_project_id;

    exit when not found or next_project_id = current_project_id;
    current_project_id := next_project_id;
  end loop;

  return current_project_id;
end
$$;

grant execute on function public.resolve_operational_project_id(text)
  to authenticated, service_role;

-- Move project-scoped operational records to the canonical identity. Rows
-- that may contain deliberate manual values (calculator and project budget)
-- are copied only when the canonical job has no value; the source is retained.
create or replace function public.merge_operational_project_identity(
  requested_alias_project_id text,
  requested_canonical_project_id text,
  requested_job_proposal_id text,
  requested_reason text,
  requested_at timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  material_allocation record;
  replacement_material_allocation_id uuid;
begin
  if requested_alias_project_id is null
    or requested_canonical_project_id is null
    or requested_alias_project_id = requested_canonical_project_id then
    return requested_canonical_project_id;
  end if;

  if not exists (
    select 1 from public.companycam_projects
    where companycam_id = requested_alias_project_id
  ) or not exists (
    select 1 from public.companycam_projects
    where companycam_id = requested_canonical_project_id
  ) then
    raise exception 'Cannot merge missing project identity % -> %',
      requested_alias_project_id, requested_canonical_project_id;
  end if;

  insert into public.project_identity_aliases (
    alias_project_id,
    canonical_project_id,
    job_proposal_id,
    reason,
    evidence,
    inserted_at,
    updated_at
  ) values (
    requested_alias_project_id,
    requested_canonical_project_id,
    requested_job_proposal_id,
    requested_reason,
    jsonb_build_object(
      'source', 'operational_identity_reconciliation',
      'merged_at', requested_at
    ),
    requested_at,
    requested_at
  )
  on conflict (alias_project_id) do update set
    canonical_project_id = excluded.canonical_project_id,
    job_proposal_id = excluded.job_proposal_id,
    reason = excluded.reason,
    evidence = public.project_identity_aliases.evidence || excluded.evidence,
    updated_at = excluded.updated_at;

  insert into public.project_calculators (
    companycam_project_id,
    doc,
    updated_by,
    updated_at
  )
  select
    requested_canonical_project_id,
    calculator.doc,
    calculator.updated_by,
    calculator.updated_at
  from public.project_calculators calculator
  where calculator.companycam_project_id = requested_alias_project_id
  on conflict (companycam_project_id) do nothing;

  insert into public.project_budgets (
    companycam_project_id,
    budgeted_hours,
    amount_including_tax,
    hourly_rate,
    notes,
    inserted_at,
    updated_at,
    updated_by,
    labour_closed_at,
    labour_closed_by,
    labour_allocation_percent,
    actual_labour_cost_override,
    labour_invoice_job_started_on
  )
  select
    requested_canonical_project_id,
    budget.budgeted_hours,
    budget.amount_including_tax,
    budget.hourly_rate,
    budget.notes,
    budget.inserted_at,
    budget.updated_at,
    budget.updated_by,
    budget.labour_closed_at,
    budget.labour_closed_by,
    budget.labour_allocation_percent,
    budget.actual_labour_cost_override,
    budget.labour_invoice_job_started_on
  from public.project_budgets budget
  where budget.companycam_project_id = requested_alias_project_id
  on conflict (companycam_project_id) do nothing;

  update public.time_entries
  set companycam_project_id = requested_canonical_project_id,
      updated_at = requested_at
  where companycam_project_id = requested_alias_project_id;

  update public.employee_location_points
  set companycam_project_id = requested_canonical_project_id
  where companycam_project_id = requested_alias_project_id;

  update public.employee_tracking_status
  set companycam_project_id = requested_canonical_project_id,
      updated_at = requested_at
  where companycam_project_id = requested_alias_project_id;

  update public.customer_invoices
  set companycam_project_id = requested_canonical_project_id,
      updated_at = requested_at
  where companycam_project_id = requested_alias_project_id;

  -- Material allocations are intentionally append-only. Preserve the source
  -- allocation as a reversed audit row, create its canonical replacement, and
  -- repoint the explicit proposal-cost identity to the replacement UUID.
  for material_allocation in
    select allocation.*
    from public.material_invoice_line_allocations allocation
    where allocation.companycam_project_id = requested_alias_project_id
      and allocation.reversed_at is null
    order by allocation.inserted_at, allocation.id
  loop
    update public.material_invoice_line_allocations
    set
      reversed_at = requested_at,
      reversal_reason = 'Replaced by canonical project identity '
        || requested_canonical_project_id,
      updated_at = requested_at
    where id = material_allocation.id;

    insert into public.material_invoice_line_allocations (
      material_invoice_line_id,
      allocation_scope,
      companycam_project_id,
      overhead_category,
      allocated_quantity,
      allocated_before_tax,
      allocated_tax,
      allocated_total,
      allocation_method,
      evidence_reference,
      confidence,
      needs_review,
      source_payload,
      inserted_at,
      inserted_by,
      updated_at
    ) values (
      material_allocation.material_invoice_line_id,
      material_allocation.allocation_scope,
      requested_canonical_project_id,
      material_allocation.overhead_category,
      material_allocation.allocated_quantity,
      material_allocation.allocated_before_tax,
      material_allocation.allocated_tax,
      material_allocation.allocated_total,
      material_allocation.allocation_method,
      material_allocation.evidence_reference,
      material_allocation.confidence,
      material_allocation.needs_review,
      coalesce(material_allocation.source_payload, '{}'::jsonb)
        || jsonb_build_object(
          'replaces_allocation_id', material_allocation.id,
          'project_identity_alias', requested_alias_project_id,
          'project_identity_merged_at', requested_at
        ),
      material_allocation.inserted_at,
      material_allocation.inserted_by,
      requested_at
    )
    returning id into replacement_material_allocation_id;

    update public.job_cost_allocation_links
    set
      material_line_allocation_id = replacement_material_allocation_id,
      companycam_project_id = requested_canonical_project_id,
      allocation_key = 'material:' || replacement_material_allocation_id::text,
      evidence = evidence || jsonb_build_object(
        'replaces_material_allocation_id', material_allocation.id,
        'project_identity_alias', requested_alias_project_id,
        'project_identity_merged_at', requested_at
      ),
      updated_at = requested_at
    where cost_type = 'material'
      and material_line_allocation_id = material_allocation.id;
  end loop;

  update public.labour_invoice_line_allocations source
  set companycam_project_id = requested_canonical_project_id,
      updated_at = requested_at
  where source.companycam_project_id = requested_alias_project_id
    and not exists (
      select 1
      from public.labour_invoice_line_allocations target
      where target.invoice_line_id = source.invoice_line_id
        and target.companycam_project_id = requested_canonical_project_id
    );

  update public.labour_invoice_projects source
  set companycam_project_id = requested_canonical_project_id,
      updated_at = requested_at
  where source.companycam_project_id = requested_alias_project_id
    and not exists (
      select 1
      from public.labour_invoice_projects target
      where target.invoice_id = source.invoice_id
        and target.companycam_project_id = requested_canonical_project_id
    );

  update public.job_cost_allocation_links
  set companycam_project_id = requested_canonical_project_id,
      allocation_key = case
        when cost_type = 'labour'
          then 'labour:' || labour_invoice_line_id::text || ':' || requested_canonical_project_id
        else allocation_key
      end,
      evidence = evidence || jsonb_build_object(
        'project_identity_alias', requested_alias_project_id,
        'project_identity_merged_at', requested_at
      ),
      updated_at = requested_at
  where companycam_project_id = requested_alias_project_id;

  update public.companycam_projects
  set
    operational_job_proposal_id = null,
    is_job_feed_visible = false,
    is_archived = true,
    companycam_status = 'superseded_by_canonical_job',
    raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
      'superseded_by', requested_canonical_project_id,
      'superseded_at', requested_at,
      'superseded_reason', requested_reason
    ),
    updated_at = requested_at
  where companycam_id = requested_alias_project_id;

  return requested_canonical_project_id;
end
$$;

revoke all on function public.merge_operational_project_identity(
  text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.merge_operational_project_identity(
  text, text, text, text, timestamptz
) to service_role;

-- Future accepted proposals are merged immediately after the original event
-- processor creates its accounting projection. The originating lead row (or
-- an already-confirmed real operational project) remains the stable page.
create or replace function public.attach_dripjobs_proposal_to_operational_project(
  requested_deal_id text,
  requested_proposal_id text,
  requested_event_id uuid,
  requested_data jsonb,
  requested_at timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  stable_project_id text;
  initial_project_id text;
  existing_holder_id text;
  existing_holder_source text;
  legacy_projection_id text := 'dripjobs-' || requested_proposal_id;
begin
  stable_project_id := public.ensure_dripjobs_lead_operational_project(
    requested_deal_id,
    requested_event_id,
    requested_at
  );
  if stable_project_id is null then
    return null;
  end if;
  initial_project_id := stable_project_id;

  select project.companycam_id, project.raw ->> 'source'
  into existing_holder_id, existing_holder_source
  from public.companycam_projects project
  where project.operational_job_proposal_id = requested_proposal_id
  limit 1;

  if existing_holder_id is not null
    and existing_holder_id <> stable_project_id
    and existing_holder_source not in (
      'dripjobs_operational_projection',
      'dripjobs_accounting_job'
    ) then
    stable_project_id := existing_holder_id;
    update public.marketing_leads
    set operational_project_id = stable_project_id
    where deal_id = requested_deal_id;
  end if;

  if initial_project_id <> stable_project_id then
    perform public.merge_operational_project_identity(
      initial_project_id,
      stable_project_id,
      requested_proposal_id,
      'confirmed_operational_holder',
      requested_at
    );
  end if;

  if legacy_projection_id <> stable_project_id
    and exists (
      select 1 from public.companycam_projects
      where companycam_id = legacy_projection_id
    ) then
    perform public.merge_operational_project_identity(
      legacy_projection_id,
      stable_project_id,
      requested_proposal_id,
      'dripjobs_proposal_projection',
      requested_at
    );
  end if;

  update public.companycam_projects project
  set
    name = case
      when project.raw ->> 'source' = 'dripjobs_lifecycle_projection'
        then coalesce(
          nullif(btrim(requested_data ->> 'job_name'), ''),
          nullif(btrim(requested_data ->> 'contact_name'), ''),
          project.name
        )
      else project.name
    end,
    street_address_1 = coalesce(
      project.street_address_1,
      nullif(btrim(requested_data ->> 'street_address_1'), '')
    ),
    city = coalesce(project.city, nullif(btrim(requested_data ->> 'city'), '')),
    state = coalesce(project.state, nullif(btrim(requested_data ->> 'state'), '')),
    postal_code = coalesce(
      project.postal_code,
      nullif(btrim(requested_data ->> 'postal_code'), '')
    ),
    formatted_address = coalesce(
      project.formatted_address,
      nullif(btrim(requested_data ->> 'address'), '')
    ),
    labels = case
      when project.is_lead
        then coalesce(project.labels, '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object('name', 'Job'))
      else project.labels
    end,
    is_archived = false,
    is_deleted = false,
    is_lead = false,
    companycam_status = 'dripjobs_accepted',
    operational_job_proposal_id = requested_proposal_id,
    is_job_feed_visible = true,
    last_synced_at = requested_at,
    companycam_updated_at = requested_at,
    raw = coalesce(project.raw, '{}'::jsonb) || jsonb_build_object(
      'dripjobs_lifecycle', jsonb_build_object(
        'deal_id', requested_deal_id,
        'current_proposal_id', requested_proposal_id,
        'event_id', requested_event_id
      )
    ),
    updated_at = requested_at
  where project.companycam_id = stable_project_id;

  update public.job_project_links
  set
    link_role = 'supporting',
    evidence = evidence || jsonb_build_object(
      'canonical_superseded_by', stable_project_id,
      'canonical_superseded_at', requested_at
    ),
    updated_at = requested_at
  where job_proposal_id = requested_proposal_id
    and link_role = 'canonical'
    and link_status = 'confirmed'
    and companycam_project_id <> stable_project_id;

  insert into public.job_project_links (
    job_proposal_id,
    companycam_project_id,
    link_role,
    link_status,
    match_method,
    confidence,
    evidence,
    review_note,
    confirmed_at
  ) values (
    requested_proposal_id,
    stable_project_id,
    'canonical',
    'confirmed',
    'confirmed_lead_bridge',
    1,
    jsonb_build_object(
      'source', 'dripjobs_lifecycle',
      'deal_id', requested_deal_id,
      'proposal_id', requested_proposal_id,
      'event_id', requested_event_id
    ),
    'Accepted proposal attached to the originating operational lifecycle.',
    requested_at
  )
  on conflict (job_proposal_id, companycam_project_id) do update set
    link_role = excluded.link_role,
    link_status = excluded.link_status,
    match_method = excluded.match_method,
    confidence = excluded.confidence,
    evidence = public.job_project_links.evidence || excluded.evidence,
    review_note = excluded.review_note,
    confirmed_at = excluded.confirmed_at,
    updated_at = requested_at;

  return stable_project_id;
end
$$;

-- Historical repair: only converted leads whose preferred row is still a
-- lead card are candidates. A real CompanyCam job is selected automatically
-- only when exact normalized name + postal code are unique in both directions
-- and that project already contains operational evidence.
create temporary table resolved_converted_lead_identity (
  deal_id text primary key,
  contact_name text,
  source_project_id text not null,
  target_project_id text not null,
  job_proposal_id text not null,
  resolution_method text not null
) on commit drop;

insert into resolved_converted_lead_identity (
  deal_id,
  contact_name,
  source_project_id,
  target_project_id,
  job_proposal_id,
  resolution_method
)
with split_jobs as (
  select
    lead.deal_id,
    lead.contact_name,
    lead.postal_code,
    lead.operational_project_id as source_project_id,
    job_link.job_proposal_id,
    row_number() over (
      partition by lead.deal_id
      order by job.proposal_signed_on desc nulls last, job.proposal_id desc
    ) as job_rank
  from public.marketing_leads lead
  join public.companycam_projects source_project
    on source_project.companycam_id = lead.operational_project_id
   and source_project.is_lead = true
  join public.marketing_lead_job_links job_link
    on job_link.lead_deal_id = lead.deal_id
   and job_link.relationship_type = 'originated'
   and job_link.link_status = 'confirmed'
  join public.dripjobs_jobs job
    on job.proposal_id = job_link.job_proposal_id
), latest_split as (
  select * from split_jobs where job_rank = 1
), real_candidate_rows as (
  select
    lead.deal_id,
    project.companycam_id,
    count(*) over (partition by lead.deal_id) as lead_candidate_count,
    count(*) over (partition by project.companycam_id) as project_claim_count
  from latest_split lead
  join public.companycam_projects project
    on regexp_replace(lower(coalesce(project.name, '')), '[^a-z0-9]+', '', 'g')
       = regexp_replace(lower(coalesce(lead.contact_name, '')), '[^a-z0-9]+', '', 'g')
   and regexp_replace(upper(coalesce(project.postal_code, '')), '[^A-Z0-9]+', '', 'g')
       = regexp_replace(upper(coalesce(lead.postal_code, '')), '[^A-Z0-9]+', '', 'g')
  where project.is_lead = false
    and project.companycam_id not like 'dripjobs-%'
    and coalesce(project.raw ->> 'source', '') not like 'dripjobs%'
    and nullif(
      regexp_replace(upper(coalesce(lead.postal_code, '')), '[^A-Z0-9]+', '', 'g'),
      ''
    ) is not null
    and (
      exists (select 1 from public.project_budgets x where x.companycam_project_id = project.companycam_id)
      or exists (select 1 from public.time_entries x where x.companycam_project_id = project.companycam_id)
      or exists (select 1 from public.labour_invoice_projects x where x.companycam_project_id = project.companycam_id)
      or exists (select 1 from public.material_invoice_line_allocations x where x.companycam_project_id = project.companycam_id and x.reversed_at is null)
      or exists (select 1 from public.customer_invoices x where x.companycam_project_id = project.companycam_id)
    )
), unique_real_candidate as (
  select deal_id, companycam_id
  from real_candidate_rows
  where lead_candidate_count = 1
    and project_claim_count = 1
), confirmed_canonical as (
  select
    lead.deal_id,
    project_link.companycam_project_id,
    row_number() over (
      partition by lead.deal_id
      order by project_link.confirmed_at desc nulls last, project_link.id
    ) as canonical_rank
  from latest_split lead
  join public.job_project_links project_link
    on project_link.job_proposal_id = lead.job_proposal_id
   and project_link.link_role = 'canonical'
   and project_link.link_status = 'confirmed'
)
select
  lead.deal_id,
  lead.contact_name,
  lead.source_project_id,
  coalesce(
    real.companycam_id,
    canonical.companycam_project_id,
    projection.companycam_id,
    lead.source_project_id
  ) as target_project_id,
  lead.job_proposal_id,
  case
    when real.companycam_id is not null
      then 'unique_exact_name_postal_companycam_job'
    when canonical.companycam_project_id is not null
      then 'existing_confirmed_canonical'
    when projection.companycam_id is not null
      then 'existing_dripjobs_projection'
    else 'promote_current_lead_row'
  end as resolution_method
from latest_split lead
left join unique_real_candidate real
  on real.deal_id = lead.deal_id
left join confirmed_canonical canonical
  on canonical.deal_id = lead.deal_id
 and canonical.canonical_rank = 1
left join public.companycam_projects projection
  on projection.companycam_id = 'dripjobs-' || lead.job_proposal_id;

update public.marketing_leads lead
set operational_project_id = resolved.target_project_id
from resolved_converted_lead_identity resolved
where lead.deal_id = resolved.deal_id
  and lead.operational_project_id <> resolved.target_project_id;

create temporary table converted_identity_moves (
  alias_project_id text primary key,
  canonical_project_id text not null,
  job_proposal_id text not null,
  reason text not null
) on commit drop;

insert into converted_identity_moves
select
  source_project_id,
  target_project_id,
  job_proposal_id,
  'converted_lead_split:' || resolution_method
from resolved_converted_lead_identity
where source_project_id <> target_project_id
on conflict (alias_project_id) do nothing;

insert into converted_identity_moves
select
  projection.companycam_id,
  resolved.target_project_id,
  resolved.job_proposal_id,
  'redundant_latest_dripjobs_projection'
from resolved_converted_lead_identity resolved
join public.companycam_projects projection
  on projection.companycam_id = 'dripjobs-' || resolved.job_proposal_id
where projection.companycam_id <> resolved.target_project_id
on conflict (alias_project_id) do update set
  canonical_project_id = excluded.canonical_project_id,
  job_proposal_id = excluded.job_proposal_id,
  reason = excluded.reason;

do $$
declare
  move record;
begin
  for move in
    select * from converted_identity_moves order by reason, alias_project_id
  loop
    perform public.merge_operational_project_identity(
      move.alias_project_id,
      move.canonical_project_id,
      move.job_proposal_id,
      move.reason,
      now()
    );
  end loop;
end
$$;

update public.companycam_projects project
set
  labels = case
    when project.is_lead
      then coalesce(project.labels, '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('name', 'Job'))
    else project.labels
  end,
  is_lead = false,
  is_archived = false,
  is_deleted = false,
  is_job_feed_visible = true,
  companycam_status = 'dripjobs_accepted',
  operational_job_proposal_id = resolved.job_proposal_id,
  raw = coalesce(project.raw, '{}'::jsonb) || jsonb_build_object(
    'dripjobs_lifecycle', jsonb_build_object(
      'deal_id', resolved.deal_id,
      'current_proposal_id', resolved.job_proposal_id,
      'historical_resolution_method', resolved.resolution_method
    )
  ),
  updated_at = now()
from resolved_converted_lead_identity resolved
where project.companycam_id = resolved.target_project_id;

update public.job_project_links link
set
  link_role = 'supporting',
  evidence = link.evidence || jsonb_build_object(
    'canonical_superseded_by', resolved.target_project_id,
    'canonical_superseded_at', now()
  ),
  updated_at = now()
from resolved_converted_lead_identity resolved
where link.job_proposal_id = resolved.job_proposal_id
  and link.link_role = 'canonical'
  and link.link_status = 'confirmed'
  and link.companycam_project_id <> resolved.target_project_id;

insert into public.job_project_links (
  job_proposal_id,
  companycam_project_id,
  link_role,
  link_status,
  match_method,
  confidence,
  evidence,
  review_note,
  confirmed_at
)
select
  resolved.job_proposal_id,
  resolved.target_project_id,
  'canonical',
  'confirmed',
  'confirmed_lead_bridge',
  1,
  jsonb_build_object(
    'source', 'converted_lead_identity_reconciliation',
    'deal_id', resolved.deal_id,
    'proposal_id', resolved.job_proposal_id,
    'resolution_method', resolved.resolution_method
  ),
  'Converted lead and operational job reconciled to one canonical page.',
  now()
from resolved_converted_lead_identity resolved
on conflict (job_proposal_id, companycam_project_id) do update set
  link_role = excluded.link_role,
  link_status = excluded.link_status,
  match_method = excluded.match_method,
  confidence = excluded.confidence,
  evidence = public.job_project_links.evidence || excluded.evidence,
  review_note = excluded.review_note,
  confirmed_at = excluded.confirmed_at,
  updated_at = now();

comment on table public.project_identity_aliases is
  'Durable, non-destructive redirects from superseded project IDs to the one canonical operational job.';
comment on function public.resolve_operational_project_id(text) is
  'Resolves old CompanyCam or DripJobs projection IDs to the canonical operational job ID.';
comment on function public.merge_operational_project_identity(text, text, text, text, timestamptz) is
  'Audits an alias, reattaches operational records, and hides the superseded project without deleting it.';

select pg_notify('pgrst', 'reload schema');

commit;
