-- Correct the lifecycle state for unconverted leads that have historical
-- CompanyCam evidence. Evidence links remain untouched; the app's preferred
-- identity becomes the DripJobs lifecycle projection until proposal approval.

begin;

-- CompanyCam's label-normalization trigger owns is_lead for ordinary imported
-- projects. Local DripJobs lifecycle rows instead derive their state from
-- whether an accepted proposal is attached. This trigger runs after the
-- CompanyCam normalizer by name and only affects local lifecycle projections.
create or replace function public.enforce_dripjobs_lifecycle_project_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.raw ->> 'source' = 'dripjobs_lifecycle_projection' then
    new.is_lead := new.operational_job_proposal_id is null;
  end if;
  return new;
end
$$;

drop trigger if exists zz_enforce_dripjobs_lifecycle_state_before_write
  on public.companycam_projects;
create trigger zz_enforce_dripjobs_lifecycle_state_before_write
before insert or update of raw, labels, is_lead, operational_job_proposal_id
on public.companycam_projects
for each row execute function public.enforce_dripjobs_lifecycle_project_state();

-- Ensure every unconverted lead has its own local lifecycle row. Existing
-- CompanyCam project rows and evidence links are deliberately preserved.
with unconverted_leads as (
  select lead.*
  from public.marketing_leads lead
  where not exists (
    select 1
    from public.marketing_lead_job_links link
    where link.lead_deal_id = lead.deal_id
      and link.relationship_type = 'originated'
      and link.link_status = 'confirmed'
  )
)
insert into public.companycam_projects (
  companycam_id,
  name,
  formatted_address,
  postal_code,
  is_archived,
  raw,
  labels,
  is_lead,
  companycam_status,
  is_deleted,
  last_synced_at,
  companycam_updated_at,
  is_job_feed_visible
)
select
  'dripjobs-deal-' || lead.deal_id,
  coalesce(nullif(btrim(lead.contact_name), ''), 'DripJobs lead ' || lead.deal_id),
  nullif(btrim(lead.address), ''),
  nullif(btrim(lead.postal_code), ''),
  false,
  jsonb_build_object(
    'source', 'dripjobs_lifecycle_projection',
    'deal_id', lead.deal_id,
    'corrected_from_project_id', case
      when lead.operational_project_id <> 'dripjobs-deal-' || lead.deal_id
        then lead.operational_project_id
      else null
    end
  ),
  jsonb_build_array(jsonb_build_object('name', 'Lead')),
  true,
  'dripjobs_lead',
  false,
  coalesce(lead.last_live_received_at, lead.captured_at, now()),
  coalesce(lead.last_live_received_at, lead.captured_at, now()),
  true
from unconverted_leads lead
on conflict (companycam_id) do update set
  name = coalesce(nullif(public.companycam_projects.name, ''), excluded.name),
  formatted_address = coalesce(
    public.companycam_projects.formatted_address,
    excluded.formatted_address
  ),
  postal_code = coalesce(public.companycam_projects.postal_code, excluded.postal_code),
  raw = case
    when public.companycam_projects.raw ->> 'source' = 'dripjobs_lifecycle_projection'
      then public.companycam_projects.raw
    else excluded.raw
  end,
  labels = excluded.labels,
  is_lead = true,
  is_archived = false,
  is_deleted = false,
  companycam_status = 'dripjobs_lead',
  is_job_feed_visible = true;

-- Nine historical unconverted leads currently have calculators on their
-- supporting CompanyCam evidence rows. Reattach a copy to the stable lifecycle
-- key without deleting or changing the original calculator.
with unconverted_leads as (
  select
    lead.deal_id,
    lead.operational_project_id as previous_project_id,
    'dripjobs-deal-' || lead.deal_id as lifecycle_project_id
  from public.marketing_leads lead
  where not exists (
    select 1
    from public.marketing_lead_job_links link
    where link.lead_deal_id = lead.deal_id
      and link.relationship_type = 'originated'
      and link.link_status = 'confirmed'
  )
)
insert into public.project_calculators (
  companycam_project_id,
  doc,
  updated_by,
  updated_at
)
select
  lead.lifecycle_project_id,
  calculator.doc,
  calculator.updated_by,
  calculator.updated_at
from unconverted_leads lead
join public.project_calculators calculator
  on calculator.companycam_project_id = lead.previous_project_id
where lead.previous_project_id <> lead.lifecycle_project_id
on conflict (companycam_project_id) do nothing;

-- Once the DripJobs lifecycle row becomes the preferred app identity, hide
-- its unconverted CompanyCam evidence cards from the shared feed so the lead
-- is not listed twice. The evidence rows and relationships stay intact. Never
-- hide a project that is an accepted job or is used by another lead.
with supporting_evidence as (
  select
    lead.deal_id,
    evidence.companycam_project_id as evidence_project_id,
    'dripjobs-deal-' || lead.deal_id as lifecycle_project_id
  from public.marketing_leads lead
  join public.marketing_lead_project_links evidence
    on evidence.lead_deal_id = lead.deal_id
   and evidence.relationship_type = 'originated'
   and evidence.link_status = 'confirmed'
  where evidence.companycam_project_id <> 'dripjobs-deal-' || lead.deal_id
    and not exists (
      select 1
      from public.marketing_lead_job_links link
      where link.lead_deal_id = lead.deal_id
        and link.relationship_type = 'originated'
        and link.link_status = 'confirmed'
    )
)
update public.companycam_projects project
set
  is_job_feed_visible = false,
  raw = coalesce(project.raw, '{}'::jsonb) || jsonb_build_object(
    'supporting_evidence_for', evidence.lifecycle_project_id,
    'hidden_from_feed_at', now()
  ),
  updated_at = now()
from supporting_evidence evidence
where project.companycam_id = evidence.evidence_project_id
  and project.companycam_id <> evidence.lifecycle_project_id
  and project.operational_job_proposal_id is null
  and not exists (
    select 1
    from public.job_project_links project_link
    where project_link.companycam_project_id = project.companycam_id
      and project_link.link_role = 'canonical'
      and project_link.link_status = 'confirmed'
  )
  and not exists (
    select 1
    from public.marketing_leads other_lead
    where other_lead.deal_id <> evidence.deal_id
      and other_lead.operational_project_id = project.companycam_id
  );

update public.marketing_leads lead
set operational_project_id = 'dripjobs-deal-' || lead.deal_id
where not exists (
  select 1
  from public.marketing_lead_job_links link
  where link.lead_deal_id = lead.deal_id
    and link.relationship_type = 'originated'
    and link.link_status = 'confirmed'
);

-- Force existing lifecycle rows through the new state trigger.
update public.companycam_projects project
set
  labels = jsonb_build_array(jsonb_build_object('name', 'Lead')),
  is_lead = true,
  is_archived = false,
  is_deleted = false,
  companycam_status = 'dripjobs_lead',
  is_job_feed_visible = true
from public.marketing_leads lead
where project.companycam_id = lead.operational_project_id
  and project.raw ->> 'source' = 'dripjobs_lifecycle_projection'
  and not exists (
    select 1
    from public.marketing_lead_job_links link
    where link.lead_deal_id = lead.deal_id
      and link.relationship_type = 'originated'
      and link.link_status = 'confirmed'
  );

comment on function public.enforce_dripjobs_lifecycle_project_state() is
  'Keeps local DripJobs lifecycle projections in lead state until an accepted proposal is attached.';

select pg_notify('pgrst', 'reload schema');

commit;
