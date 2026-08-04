-- Prefer the existing operational CompanyCam project when a historical
-- DripJobs proposal projection has exactly one confirmed supporting project
-- that already owns operational evidence. The synthetic ID remains a durable
-- redirect; no project, budget, invoice, allocation, or time record is deleted.

begin;

create temporary table unique_operational_project_candidates (
  job_proposal_id text primary key,
  synthetic_project_id text not null unique,
  operational_project_id text not null unique,
  supporting_match_method text not null,
  supporting_confidence numeric(4,3) not null
) on commit drop;

insert into unique_operational_project_candidates (
  job_proposal_id,
  synthetic_project_id,
  operational_project_id,
  supporting_match_method,
  supporting_confidence
)
with confirmed_synthetic_canonical as (
  select
    link.job_proposal_id,
    link.companycam_project_id as synthetic_project_id
  from public.job_project_links link
  where link.link_role = 'canonical'
    and link.link_status = 'confirmed'
    and link.companycam_project_id like 'dripjobs-%'
), confirmed_operational_evidence as (
  select
    canonical.job_proposal_id,
    canonical.synthetic_project_id,
    supporting.companycam_project_id as operational_project_id,
    supporting.match_method,
    supporting.confidence,
    count(*) over (
      partition by canonical.job_proposal_id
    ) as operational_candidate_count
  from confirmed_synthetic_canonical canonical
  join public.job_project_links supporting
    on supporting.job_proposal_id = canonical.job_proposal_id
   and supporting.link_role = 'supporting'
   and supporting.link_status = 'confirmed'
   and supporting.companycam_project_id not like 'dripjobs-%'
  where
    exists (
      select 1
      from public.project_budgets budget
      where budget.companycam_project_id = supporting.companycam_project_id
    )
    or exists (
      select 1
      from public.time_entries entry
      where entry.companycam_project_id = supporting.companycam_project_id
    )
    or exists (
      select 1
      from public.labour_invoice_projects invoice_project
      where invoice_project.companycam_project_id = supporting.companycam_project_id
    )
    or exists (
      select 1
      from public.material_invoice_line_allocations allocation
      where allocation.companycam_project_id = supporting.companycam_project_id
        and allocation.reversed_at is null
    )
    or exists (
      select 1
      from public.customer_invoices invoice
      where invoice.companycam_project_id = supporting.companycam_project_id
    )
)
select
  candidate.job_proposal_id,
  candidate.synthetic_project_id,
  candidate.operational_project_id,
  candidate.match_method,
  candidate.confidence
from confirmed_operational_evidence candidate
where candidate.operational_candidate_count = 1;

-- Abort before changing anything if an operational project is already owned
-- by a different proposal or if moving a unique-keyed record would collide.
do $$
begin
  if exists (
    select 1
    from unique_operational_project_candidates candidate
    join public.companycam_projects project
      on project.companycam_id = candidate.operational_project_id
    where project.operational_job_proposal_id is not null
      and project.operational_job_proposal_id <> candidate.job_proposal_id
  ) then
    raise exception 'Operational project already belongs to another DripJobs proposal';
  end if;

  if exists (
    select 1
    from unique_operational_project_candidates candidate
    join public.job_project_links other_link
      on other_link.companycam_project_id = candidate.operational_project_id
     and other_link.job_proposal_id <> candidate.job_proposal_id
     and other_link.link_role = 'canonical'
     and other_link.link_status = 'confirmed'
  ) then
    raise exception 'Operational project is canonical for another DripJobs proposal';
  end if;

  if exists (
    select 1
    from unique_operational_project_candidates candidate
    join public.labour_invoice_line_allocations source
      on source.companycam_project_id = candidate.synthetic_project_id
    join public.labour_invoice_line_allocations target
      on target.invoice_line_id = source.invoice_line_id
     and target.companycam_project_id = candidate.operational_project_id
  ) then
    raise exception 'Labour invoice line allocation collision during identity merge';
  end if;

  if exists (
    select 1
    from unique_operational_project_candidates candidate
    join public.labour_invoice_projects source
      on source.companycam_project_id = candidate.synthetic_project_id
    join public.labour_invoice_projects target
      on target.invoice_id = source.invoice_id
     and target.companycam_project_id = candidate.operational_project_id
  ) then
    raise exception 'Labour invoice project collision during identity merge';
  end if;

  if exists (
    select 1
    from unique_operational_project_candidates candidate
    join public.job_cost_allocation_links source
      on source.companycam_project_id = candidate.synthetic_project_id
     and source.cost_type = 'labour'
    join public.job_cost_allocation_links target
      on target.allocation_key =
        'labour:' || source.labour_invoice_line_id::text || ':'
        || candidate.operational_project_id
  ) then
    raise exception 'Job cost allocation collision during identity merge';
  end if;
end
$$;

do $$
declare
  candidate record;
begin
  for candidate in
    select *
    from unique_operational_project_candidates
    order by job_proposal_id
  loop
    perform public.merge_operational_project_identity(
      candidate.synthetic_project_id,
      candidate.operational_project_id,
      candidate.job_proposal_id,
      'unique_confirmed_operational_evidence',
      now()
    );
  end loop;
end
$$;

-- A converted lead and the job list must now open the same operational row.
update public.marketing_leads lead
set operational_project_id = candidate.operational_project_id
from unique_operational_project_candidates candidate
where lead.operational_project_id = candidate.synthetic_project_id;

-- Preserve the real project name/address and promote only its lifecycle flags.
update public.companycam_projects project
set
  labels = case
    when project.is_lead
      and not coalesce(project.labels, '[]'::jsonb)
        @> '[{"name":"Job"}]'::jsonb
      then coalesce(project.labels, '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object('name', 'Job'))
    else project.labels
  end,
  is_archived = false,
  is_deleted = false,
  is_lead = false,
  companycam_status = 'dripjobs_accepted',
  operational_job_proposal_id = candidate.job_proposal_id,
  is_job_feed_visible = true,
  last_synced_at = now(),
  raw = coalesce(project.raw, '{}'::jsonb) || jsonb_build_object(
    'operational_identity_reconciliation', jsonb_build_object(
      'proposal_id', candidate.job_proposal_id,
      'supersedes_project_id', candidate.synthetic_project_id,
      'method', candidate.supporting_match_method,
      'confidence', candidate.supporting_confidence,
      'reconciled_at', now()
    )
  ),
  updated_at = now()
from unique_operational_project_candidates candidate
where project.companycam_id = candidate.operational_project_id;

-- Demote the projection before promoting the real row so the partial unique
-- index always observes at most one confirmed canonical link per proposal.
update public.job_project_links link
set
  link_role = 'supporting',
  evidence = link.evidence || jsonb_build_object(
    'canonical_superseded_by', candidate.operational_project_id,
    'canonical_superseded_at', now()
  ),
  review_note = concat_ws(
    ' ',
    nullif(btrim(link.review_note), ''),
    'Synthetic projection retained as an identity alias.'
  ),
  updated_at = now()
from unique_operational_project_candidates candidate
where link.job_proposal_id = candidate.job_proposal_id
  and link.companycam_project_id = candidate.synthetic_project_id
  and link.link_role = 'canonical'
  and link.link_status = 'confirmed';

update public.job_project_links link
set
  link_role = 'canonical',
  evidence = link.evidence || jsonb_build_object(
    'promoted_from_operational_evidence', true,
    'superseded_project_id', candidate.synthetic_project_id,
    'promoted_at', now()
  ),
  review_note = concat_ws(
    ' ',
    nullif(btrim(link.review_note), ''),
    'Canonical operational project; synthetic projection resolves here.'
  ),
  confirmed_at = coalesce(link.confirmed_at, now()),
  updated_at = now()
from unique_operational_project_candidates candidate
where link.job_proposal_id = candidate.job_proposal_id
  and link.companycam_project_id = candidate.operational_project_id
  and link.link_status = 'confirmed';

comment on table public.project_identity_aliases is
  'Durable redirects from superseded project IDs to canonical operational project IDs.';

commit;
