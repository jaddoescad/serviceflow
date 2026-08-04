-- Give every DripJobs lead one stable operational identity. The same row is
-- searchable as a lead, stores its calculator, and becomes the operational
-- job when a proposal is accepted. Existing confirmed CompanyCam/job links
-- remain the preferred identity for historical records.

begin;

alter table public.marketing_leads
  add column if not exists operational_project_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.marketing_leads'::regclass
      and conname = 'marketing_leads_operational_project_fk'
  ) then
    alter table public.marketing_leads
      add constraint marketing_leads_operational_project_fk
      foreign key (operational_project_id)
      references public.companycam_projects(companycam_id)
      on delete restrict;
  end if;
end
$$;

create index if not exists marketing_leads_operational_project_idx
  on public.marketing_leads(operational_project_id)
  where operational_project_id is not null;

-- If a lead already has confirmed CompanyCam evidence, preserve that row as
-- its stable operational identity. Prefer a CompanyCam lead row because an
-- estimate/calculator may already be attached to it.
with ranked_direct_links as (
  select
    link.lead_deal_id,
    link.companycam_project_id,
    row_number() over (
      partition by link.lead_deal_id
      order by
        project.is_lead desc,
        link.confirmed_at desc nulls last,
        link.id
    ) as candidate_rank
  from public.marketing_lead_project_links link
  join public.companycam_projects project
    on project.companycam_id = link.companycam_project_id
  where link.relationship_type = 'originated'
    and link.link_status = 'confirmed'
)
update public.marketing_leads lead
set operational_project_id = candidate.companycam_project_id
from ranked_direct_links candidate
where lead.deal_id = candidate.lead_deal_id
  and lead.operational_project_id is null
  and candidate.candidate_rank = 1;

-- Converted historical leads should open their already-confirmed operational
-- job rather than creating a duplicate lifecycle row.
with job_candidates as (
  select
    link.lead_deal_id,
    coalesce(canonical.companycam_project_id, projected.companycam_id)
      as companycam_project_id,
    job.proposal_signed_on,
    job.proposal_id
  from public.marketing_lead_job_links link
  join public.dripjobs_jobs job
    on job.proposal_id = link.job_proposal_id
  left join lateral (
    select project_link.companycam_project_id
    from public.job_project_links project_link
    where project_link.job_proposal_id = job.proposal_id
      and project_link.link_role = 'canonical'
      and project_link.link_status = 'confirmed'
    order by project_link.confirmed_at desc nulls last, project_link.id
    limit 1
  ) canonical on true
  left join lateral (
    select project.companycam_id
    from public.companycam_projects project
    where project.operational_job_proposal_id = job.proposal_id
    order by project.companycam_id
    limit 1
  ) projected on true
  where link.relationship_type = 'originated'
    and link.link_status = 'confirmed'
), ranked_job_candidates as (
  select
    candidate.*,
    row_number() over (
      partition by candidate.lead_deal_id
      order by
        candidate.proposal_signed_on desc nulls last,
        candidate.proposal_id desc
    ) as candidate_rank
  from job_candidates candidate
  where candidate.companycam_project_id is not null
)
update public.marketing_leads lead
set operational_project_id = candidate.companycam_project_id
from ranked_job_candidates candidate
where lead.deal_id = candidate.lead_deal_id
  and lead.operational_project_id is null
  and candidate.candidate_rank = 1;

-- Leads with no historical operational row receive a local lifecycle key.
-- This does not create anything in CompanyCam.
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
    'deal_id', lead.deal_id
  ),
  jsonb_build_array(jsonb_build_object('name', 'Lead')),
  true,
  'dripjobs_lead',
  false,
  coalesce(lead.last_live_received_at, lead.captured_at, now()),
  coalesce(lead.last_live_received_at, lead.captured_at, now()),
  true
from public.marketing_leads lead
where lead.operational_project_id is null
on conflict (companycam_id) do update set
  name = coalesce(nullif(public.companycam_projects.name, ''), excluded.name),
  formatted_address = coalesce(
    public.companycam_projects.formatted_address,
    excluded.formatted_address
  ),
  postal_code = coalesce(public.companycam_projects.postal_code, excluded.postal_code),
  is_deleted = false,
  is_job_feed_visible = true;

update public.marketing_leads lead
set operational_project_id = 'dripjobs-deal-' || lead.deal_id
where lead.operational_project_id is null;

-- Enforce the invariant for every future insert, including imports that do not
-- pass through the Zapier RPC. The project row is created first, then its key
-- is stored on the lead in the same transaction.
create or replace function public.set_marketing_lead_operational_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stable_project_id text;
  lifecycle_at timestamptz;
begin
  stable_project_id := coalesce(
    nullif(btrim(new.operational_project_id), ''),
    'dripjobs-deal-' || new.deal_id
  );
  lifecycle_at := coalesce(new.last_live_received_at, new.captured_at, now());

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
  ) values (
    stable_project_id,
    coalesce(nullif(btrim(new.contact_name), ''), 'DripJobs lead ' || new.deal_id),
    nullif(btrim(new.address), ''),
    nullif(btrim(new.postal_code), ''),
    false,
    jsonb_build_object(
      'source', 'dripjobs_lifecycle_projection',
      'deal_id', new.deal_id,
      'event_id', new.last_live_event_id
    ),
    jsonb_build_array(jsonb_build_object('name', 'Lead')),
    true,
    'dripjobs_lead',
    false,
    lifecycle_at,
    lifecycle_at,
    true
  )
  on conflict (companycam_id) do update set
    name = coalesce(nullif(public.companycam_projects.name, ''), excluded.name),
    formatted_address = coalesce(
      public.companycam_projects.formatted_address,
      excluded.formatted_address
    ),
    postal_code = coalesce(public.companycam_projects.postal_code, excluded.postal_code),
    is_deleted = false,
    is_job_feed_visible = true;

  new.operational_project_id := stable_project_id;
  return new;
end
$$;

drop trigger if exists marketing_leads_set_operational_project
  on public.marketing_leads;
create trigger marketing_leads_set_operational_project
before insert on public.marketing_leads
for each row execute function public.set_marketing_lead_operational_project();

alter table public.marketing_leads
  alter column operational_project_id set not null;

comment on column public.marketing_leads.operational_project_id is
  'Stable app identity for the lead-to-job lifecycle. DripJobs proposal and optional CompanyCam identities attach to this row.';

-- Create (or return) the stable operational identity for one exact Deal ID.
create or replace function public.ensure_dripjobs_lead_operational_project(
  requested_deal_id text,
  requested_event_id uuid default null,
  requested_at timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  stable_project_id text;
begin
  select lead.operational_project_id
  into stable_project_id
  from public.marketing_leads lead
  where lead.deal_id = requested_deal_id
  for update;

  if not found then
    return null;
  end if;

  if stable_project_id is null then
    stable_project_id := 'dripjobs-deal-' || requested_deal_id;

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
      stable_project_id,
      coalesce(nullif(btrim(lead.contact_name), ''), 'DripJobs lead ' || lead.deal_id),
      nullif(btrim(lead.address), ''),
      nullif(btrim(lead.postal_code), ''),
      false,
      jsonb_build_object(
        'source', 'dripjobs_lifecycle_projection',
        'deal_id', lead.deal_id,
        'event_id', requested_event_id
      ),
      jsonb_build_array(jsonb_build_object('name', 'Lead')),
      true,
      'dripjobs_lead',
      false,
      requested_at,
      requested_at,
      true
    from public.marketing_leads lead
    where lead.deal_id = requested_deal_id
    on conflict (companycam_id) do update set
      name = coalesce(nullif(public.companycam_projects.name, ''), excluded.name),
      formatted_address = coalesce(
        public.companycam_projects.formatted_address,
        excluded.formatted_address
      ),
      postal_code = coalesce(
        public.companycam_projects.postal_code,
        excluded.postal_code
      ),
      is_deleted = false,
      is_job_feed_visible = true,
      last_synced_at = greatest(
        public.companycam_projects.last_synced_at,
        excluded.last_synced_at
      );

    update public.marketing_leads
    set operational_project_id = stable_project_id
    where deal_id = requested_deal_id;
  else
    update public.companycam_projects
    set
      is_deleted = false,
      is_job_feed_visible = true
    where companycam_id = stable_project_id;
  end if;

  return stable_project_id;
end
$$;

-- Attach an accepted proposal to the same lifecycle row. The short-lived
-- proposal projection produced by the previous ingest function is retained as
-- a hidden alias, so no data is deleted and no duplicate job reaches the app.
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

  select project.companycam_id, project.raw ->> 'source'
  into existing_holder_id, existing_holder_source
  from public.companycam_projects project
  where project.operational_job_proposal_id = requested_proposal_id
  limit 1;

  -- A confirmed real operational project remains authoritative for historical
  -- jobs. Only the old local proposal projection is superseded.
  if existing_holder_id is not null
    and existing_holder_id <> stable_project_id
    and existing_holder_source is distinct from 'dripjobs_operational_projection' then
    stable_project_id := existing_holder_id;
    update public.marketing_leads
    set operational_project_id = stable_project_id
    where deal_id = requested_deal_id;
  end if;

  if legacy_projection_id <> stable_project_id then
    update public.companycam_projects
    set
      operational_job_proposal_id = null,
      is_job_feed_visible = false,
      is_archived = true,
      companycam_status = 'superseded_by_dripjobs_lifecycle',
      raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
        'superseded_by', stable_project_id,
        'superseded_at', requested_at
      ),
      updated_at = requested_at
    where companycam_id = legacy_projection_id
      and raw ->> 'source' = 'dripjobs_operational_projection';
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

  -- New lifecycle projections become the canonical operational project for
  -- accounting/read models. Existing confirmed canonical mappings are never
  -- replaced.
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
    'The accepted proposal remains attached to the originating lead operational identity.',
    requested_at
  where not exists (
    select 1
    from public.job_project_links link
    where link.job_proposal_id = requested_proposal_id
      and link.link_role = 'canonical'
      and link.link_status = 'confirmed'
  )
  on conflict do nothing;

  return stable_project_id;
end
$$;

-- Keep the audited/idempotent source processor intact, then wrap it with the
-- lifecycle bridge. This reduces migration risk and preserves its event log.
alter function public.process_dripjobs_zapier_event(
  text, text, text, timestamptz, jsonb, text, jsonb, boolean
) rename to process_dripjobs_zapier_event_source;

create function public.process_dripjobs_zapier_event(
  p_event_key text,
  p_event_type text,
  p_entity_id text,
  p_occurred_at timestamptz,
  p_payload jsonb,
  p_payload_sha256 text,
  p_data jsonb,
  p_is_test boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_result jsonb;
  source_status text;
  resolved_deal_id text;
  resolved_event_id uuid;
  proposal_row record;
begin
  source_result := public.process_dripjobs_zapier_event_source(
    p_event_key,
    p_event_type,
    p_entity_id,
    p_occurred_at,
    p_payload,
    p_payload_sha256,
    p_data,
    p_is_test
  );

  source_status := source_result ->> 'status';
  if p_is_test or source_status = 'ignored' then
    return source_result;
  end if;

  resolved_event_id := nullif(source_result ->> 'event_id', '')::uuid;

  if p_event_type = 'lead.created' then
    resolved_deal_id := nullif(btrim(p_data ->> 'deal_id'), '');
    perform public.ensure_dripjobs_lead_operational_project(
      resolved_deal_id,
      resolved_event_id,
      now()
    );

    -- Repair exact out-of-order deliveries: a proposal may arrive before the
    -- matching lead Zap. Exact Deal ID is the only automatic key used here.
    for proposal_row in
      select job.proposal_id
      from public.dripjobs_jobs job
      where job.originating_deal_id = resolved_deal_id
      order by job.proposal_signed_on, job.proposal_id
    loop
      insert into public.marketing_lead_job_links (
        lead_deal_id,
        job_proposal_id,
        relationship_type,
        link_status,
        match_method,
        confidence,
        evidence,
        review_note,
        confirmed_at
      )
      select
        resolved_deal_id,
        proposal_row.proposal_id,
        'originated',
        'confirmed',
        'dripjobs_deal_id',
        1,
        jsonb_build_object(
          'source', 'dripjobs_out_of_order_lifecycle_repair',
          'deal_id', resolved_deal_id,
          'proposal_id', proposal_row.proposal_id,
          'event_id', resolved_event_id
        ),
        'Proposal arrived before the exact matching DripJobs lead.',
        now()
      where not exists (
        select 1
        from public.marketing_lead_job_links existing
        where existing.job_proposal_id = proposal_row.proposal_id
          and existing.relationship_type = 'originated'
          and existing.link_status = 'confirmed'
      )
      on conflict do nothing;

      update public.dripjobs_jobs
      set
        lead_resolution_status = 'confirmed',
        lead_resolution_note = 'Originating lead linked by exact DripJobs Deal ID after out-of-order delivery.',
        lead_resolved_at = coalesce(lead_resolved_at, now())
      where proposal_id = proposal_row.proposal_id
        and exists (
          select 1
          from public.marketing_lead_job_links link
          where link.job_proposal_id = proposal_row.proposal_id
            and link.lead_deal_id = resolved_deal_id
            and link.relationship_type = 'originated'
            and link.link_status = 'confirmed'
        );

      perform public.attach_dripjobs_proposal_to_operational_project(
        resolved_deal_id,
        proposal_row.proposal_id,
        resolved_event_id,
        p_data,
        now()
      );
    end loop;
  elsif p_event_type = 'proposal.accepted' then
    select link.lead_deal_id
    into resolved_deal_id
    from public.marketing_lead_job_links link
    where link.job_proposal_id = p_entity_id
      and link.relationship_type = 'originated'
      and link.link_status = 'confirmed'
    order by link.confirmed_at desc nulls last, link.id
    limit 1;

    if resolved_deal_id is null and exists (
      select 1
      from public.marketing_leads lead
      where lead.deal_id = nullif(btrim(p_data ->> 'deal_id'), '')
    ) then
      resolved_deal_id := nullif(btrim(p_data ->> 'deal_id'), '');
    end if;

    if resolved_deal_id is not null then
      perform public.attach_dripjobs_proposal_to_operational_project(
        resolved_deal_id,
        p_entity_id,
        resolved_event_id,
        p_data,
        now()
      );
    end if;
  end if;

  return source_result;
end
$$;

revoke all on function public.ensure_dripjobs_lead_operational_project(
  text, uuid, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.set_marketing_lead_operational_project()
  from public, anon, authenticated, service_role;
revoke all on function public.attach_dripjobs_proposal_to_operational_project(
  text, text, uuid, jsonb, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.process_dripjobs_zapier_event_source(
  text, text, text, timestamptz, jsonb, text, jsonb, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.process_dripjobs_zapier_event(
  text, text, text, timestamptz, jsonb, text, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.process_dripjobs_zapier_event(
  text, text, text, timestamptz, jsonb, text, jsonb, boolean
) to service_role;

comment on function public.process_dripjobs_zapier_event(
  text, text, text, timestamptz, jsonb, text, jsonb, boolean
) is 'Idempotent DripJobs ingest plus a stable lead-to-operational-job lifecycle identity.';

select pg_notify('pgrst', 'reload schema');

commit;
