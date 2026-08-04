-- Continue the audited DripJobs export with idempotent Zapier events.
-- Historical leads, jobs, and confirmed relationships remain authoritative.

begin;

create table if not exists public.dripjobs_ingest_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  entity_type text not null,
  entity_id text not null,
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  payload_sha256 text not null,
  processing_status text not null default 'pending',
  error_code text,
  is_test boolean not null default false,
  attempt_count integer not null default 1,
  last_attempt_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  inserted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dripjobs_ingest_events_type_check check (
    event_type in ('lead.created', 'proposal.accepted')
  ),
  constraint dripjobs_ingest_events_entity_type_check check (
    entity_type in ('lead', 'proposal')
  ),
  constraint dripjobs_ingest_events_status_check check (
    processing_status in ('pending', 'processed', 'failed', 'ignored')
  ),
  constraint dripjobs_ingest_events_attempt_check check (attempt_count > 0),
  constraint dripjobs_ingest_events_hash_check check (
    payload_sha256 ~ '^[0-9a-f]{64}$'
  )
);

create index if not exists dripjobs_ingest_events_received_idx
  on public.dripjobs_ingest_events(received_at desc);
create index if not exists dripjobs_ingest_events_status_idx
  on public.dripjobs_ingest_events(processing_status, received_at desc);
create index if not exists dripjobs_ingest_events_entity_idx
  on public.dripjobs_ingest_events(entity_type, entity_id, received_at desc);

drop trigger if exists dripjobs_ingest_events_set_updated_at
  on public.dripjobs_ingest_events;
create trigger dripjobs_ingest_events_set_updated_at
before update on public.dripjobs_ingest_events
for each row execute function public.set_updated_at();

alter table public.dripjobs_ingest_events enable row level security;

drop policy if exists "Managers can read dripjobs_ingest_events"
  on public.dripjobs_ingest_events;
create policy "Managers can read dripjobs_ingest_events"
  on public.dripjobs_ingest_events
  for select to authenticated
  using (public.current_employee_role() in ('admin', 'manager'));

grant select on public.dripjobs_ingest_events to authenticated;

-- Spreadsheet provenance remains populated on all historical rows. Live rows
-- use first/last event references instead of fake filenames and row numbers.
alter table public.marketing_leads
  alter column source_filename drop not null,
  alter column source_spreadsheet_id drop not null,
  alter column source_sheet_name drop not null,
  alter column source_row_number drop not null,
  alter column source_sha256 drop not null,
  add column if not exists dripjobs_contact_uuid text,
  add column if not exists first_live_event_id uuid
    references public.dripjobs_ingest_events(id) on delete restrict,
  add column if not exists last_live_event_id uuid
    references public.dripjobs_ingest_events(id) on delete restrict,
  add column if not exists last_live_received_at timestamptz;

alter table public.marketing_leads
  drop constraint if exists marketing_leads_source_row_check,
  drop constraint if exists marketing_leads_source_hash_check;
alter table public.marketing_leads
  add constraint marketing_leads_source_row_check check (
    source_row_number is null or source_row_number > 1
  ),
  add constraint marketing_leads_source_hash_check check (
    source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'
  );

create index if not exists marketing_leads_contact_uuid_idx
  on public.marketing_leads(dripjobs_contact_uuid)
  where dripjobs_contact_uuid is not null;
create index if not exists marketing_leads_live_received_idx
  on public.marketing_leads(last_live_received_at desc)
  where last_live_received_at is not null;

alter table public.dripjobs_jobs
  alter column source_crm_record_id drop not null,
  alter column source_filename drop not null,
  alter column source_sha256 drop not null,
  alter column source_row_number drop not null,
  add column if not exists originating_deal_id text,
  add column if not exists dripjobs_contact_uuid text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postal_code text,
  add column if not exists first_live_event_id uuid
    references public.dripjobs_ingest_events(id) on delete restrict,
  add column if not exists last_live_event_id uuid
    references public.dripjobs_ingest_events(id) on delete restrict,
  add column if not exists last_live_received_at timestamptz;

alter table public.dripjobs_jobs
  drop constraint if exists dripjobs_jobs_source_row_check,
  drop constraint if exists dripjobs_jobs_source_hash_check;
alter table public.dripjobs_jobs
  add constraint dripjobs_jobs_source_row_check check (
    source_row_number is null or source_row_number > 1
  ),
  add constraint dripjobs_jobs_source_hash_check check (
    source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'
  );

create index if not exists dripjobs_jobs_originating_deal_idx
  on public.dripjobs_jobs(originating_deal_id)
  where originating_deal_id is not null;

-- Existing app workflows use companycam_id as their stable project key. Keep
-- that internal key without treating it as a CompanyCam relationship. Rows
-- already visible at cutover remain visible; future CompanyCam-only imports
-- default to hidden until they are deliberately attached to a DripJobs job.
alter table public.companycam_projects
  add column if not exists operational_job_proposal_id text
    references public.dripjobs_jobs(proposal_id) on delete restrict,
  add column if not exists is_job_feed_visible boolean not null default false;

update public.companycam_projects
set is_job_feed_visible = true
where is_job_feed_visible = false;

update public.companycam_projects project
set operational_job_proposal_id = job.proposal_id
from public.dripjobs_jobs job
where project.operational_job_proposal_id is null
  and project.companycam_id = 'dripjobs-' || job.proposal_id;

create unique index if not exists companycam_projects_operational_job_idx
  on public.companycam_projects(operational_job_proposal_id)
  where operational_job_proposal_id is not null;

drop policy if exists "Authenticated users can read CompanyCam projects"
  on public.companycam_projects;
drop policy if exists "Authenticated users can read operational job projects"
  on public.companycam_projects;
create policy "Authenticated users can read operational job projects"
  on public.companycam_projects
  for select to authenticated
  using (is_job_feed_visible = true);

alter table public.marketing_lead_job_links
  drop constraint if exists marketing_lead_job_links_method_check;
alter table public.marketing_lead_job_links
  add constraint marketing_lead_job_links_method_check check (
    match_method in (
      'proposal_number',
      'dripjobs_deal_id',
      'dripjobs_contact_uuid',
      'email_and_phone',
      'email',
      'phone',
      'manual'
    )
  );

create or replace function public.normalize_dripjobs_lead_channel(raw_source text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when lower(btrim(coalesce(raw_source, ''))) = 'meta-perspective'
      then 'paid_social'
    when lower(btrim(coalesce(raw_source, ''))) in ('facebook', 'instagram')
      then 'organic_social'
    when lower(btrim(coalesce(raw_source, ''))) = '/'
      or lower(btrim(coalesce(raw_source, ''))) like '/%'
      then 'website'
    when lower(btrim(coalesce(raw_source, ''))) = 'phone call'
      then 'phone'
    when lower(btrim(coalesce(raw_source, ''))) = 'mail'
      then 'mail'
    when lower(btrim(coalesce(raw_source, ''))) = 'word of mouth'
      then 'referral'
    when lower(btrim(coalesce(raw_source, ''))) = 'google'
      then 'organic_search'
    when lower(btrim(coalesce(raw_source, ''))) = 'other'
      then 'other'
    else 'unknown'
  end
$$;

create or replace function public.process_dripjobs_zapier_event(
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
set search_path = public, pg_temp
as $$
declare
  event_row public.dripjobs_ingest_events%rowtype;
  received_at_value timestamptz := now();
  event_entity_type text;
  created_at_value timestamptz;
  accepted_at_value timestamptz;
  raw_source_value text;
  normalized_channel_value text;
  deal_id_value text;
  proposal_id_value text;
  project_id_value text;
  existing_origin_lead_id text;
  existing_operational_project_id text;
  requested_lead_exists boolean := false;
begin
  if p_event_type not in ('lead.created', 'proposal.accepted') then
    raise exception 'Unsupported DripJobs event type' using errcode = '22023';
  end if;
  if nullif(btrim(p_event_key), '') is null
    or nullif(btrim(p_entity_id), '') is null then
    raise exception 'Missing DripJobs event identity' using errcode = '22023';
  end if;
  if p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid DripJobs payload hash' using errcode = '22023';
  end if;

  event_entity_type := case
    when p_event_type = 'lead.created' then 'lead'
    else 'proposal'
  end;

  select * into event_row
  from public.dripjobs_ingest_events
  where event_key = p_event_key
  for update;

  if found and event_row.processing_status in ('processed', 'ignored') then
    update public.dripjobs_ingest_events
    set
      attempt_count = attempt_count + 1,
      last_attempt_at = received_at_value
    where id = event_row.id;

    return jsonb_build_object(
      'ok', true,
      'status', 'duplicate',
      'event_id', event_row.id,
      'event_type', event_row.event_type,
      'entity_id', event_row.entity_id
    );
  end if;

  insert into public.dripjobs_ingest_events (
    event_key,
    event_type,
    entity_type,
    entity_id,
    occurred_at,
    payload,
    payload_sha256,
    processing_status,
    error_code,
    is_test,
    attempt_count,
    last_attempt_at,
    received_at
  ) values (
    p_event_key,
    p_event_type,
    event_entity_type,
    p_entity_id,
    p_occurred_at,
    coalesce(p_payload, '{}'::jsonb),
    p_payload_sha256,
    'pending',
    null,
    p_is_test,
    case when event_row.id is null then 1 else event_row.attempt_count + 1 end,
    received_at_value,
    coalesce(event_row.received_at, received_at_value)
  )
  on conflict (event_key) do update set
    occurred_at = excluded.occurred_at,
    payload = excluded.payload,
    payload_sha256 = excluded.payload_sha256,
    processing_status = 'pending',
    error_code = null,
    is_test = excluded.is_test,
    attempt_count = excluded.attempt_count,
    last_attempt_at = excluded.last_attempt_at
  returning * into event_row;

  if p_is_test then
    update public.dripjobs_ingest_events
    set processing_status = 'ignored', processed_at = received_at_value
    where id = event_row.id;

    return jsonb_build_object(
      'ok', true,
      'status', 'ignored',
      'event_id', event_row.id,
      'event_type', event_row.event_type,
      'entity_id', event_row.entity_id
    );
  end if;

  if p_event_type = 'lead.created' then
    deal_id_value := nullif(btrim(p_data ->> 'deal_id'), '');
    if deal_id_value is null or deal_id_value <> p_entity_id then
      raise exception 'Lead Deal ID does not match event identity' using errcode = '22023';
    end if;

    created_at_value := coalesce(
      nullif(p_data ->> 'created_at', '')::timestamptz,
      p_occurred_at
    );
    raw_source_value := nullif(btrim(p_data ->> 'lead_source'), '');
    normalized_channel_value := public.normalize_dripjobs_lead_channel(
      raw_source_value
    );

    insert into public.marketing_leads (
      deal_id,
      created_on,
      created_at_local,
      created_at_precision,
      contact_name,
      email,
      phone,
      raw_lead_source,
      normalized_channel,
      address,
      postal_code,
      estimate_scheduled_on,
      estimate_appointment_on,
      proposal_number,
      proposal_amount,
      proposal_on,
      job_crew,
      is_interior,
      is_exterior,
      is_cabinets,
      source_system,
      source_filename,
      source_spreadsheet_id,
      source_sheet_name,
      source_row_number,
      source_sha256,
      source_payload,
      captured_at,
      dripjobs_contact_uuid,
      first_live_event_id,
      last_live_event_id,
      last_live_received_at
    ) values (
      deal_id_value,
      (created_at_value at time zone 'America/Toronto')::date,
      created_at_value at time zone 'America/Toronto',
      'timestamp',
      nullif(btrim(p_data ->> 'contact_name'), ''),
      nullif(btrim(p_data ->> 'email'), ''),
      nullif(btrim(p_data ->> 'phone'), ''),
      raw_source_value,
      normalized_channel_value,
      nullif(btrim(p_data ->> 'address'), ''),
      nullif(btrim(p_data ->> 'postal_code'), ''),
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      false,
      false,
      'dripjobs_zapier',
      null,
      null,
      null,
      null,
      null,
      coalesce(p_payload, '{}'::jsonb),
      received_at_value,
      nullif(btrim(p_data ->> 'contact_uuid'), ''),
      event_row.id,
      event_row.id,
      received_at_value
    )
    on conflict (deal_id) do update set
      contact_name = coalesce(marketing_leads.contact_name, excluded.contact_name),
      email = coalesce(marketing_leads.email, excluded.email),
      phone = coalesce(marketing_leads.phone, excluded.phone),
      raw_lead_source = coalesce(
        marketing_leads.raw_lead_source,
        excluded.raw_lead_source
      ),
      normalized_channel = case
        when marketing_leads.normalized_channel = 'unknown'
          and excluded.normalized_channel <> 'unknown'
          then excluded.normalized_channel
        else marketing_leads.normalized_channel
      end,
      address = coalesce(marketing_leads.address, excluded.address),
      postal_code = coalesce(marketing_leads.postal_code, excluded.postal_code),
      dripjobs_contact_uuid = coalesce(
        marketing_leads.dripjobs_contact_uuid,
        excluded.dripjobs_contact_uuid
      ),
      first_live_event_id = coalesce(
        marketing_leads.first_live_event_id,
        excluded.first_live_event_id
      ),
      last_live_event_id = excluded.last_live_event_id,
      last_live_received_at = excluded.last_live_received_at;
  else
    proposal_id_value := nullif(btrim(p_data ->> 'proposal_id'), '');
    if proposal_id_value is null or proposal_id_value <> p_entity_id then
      raise exception 'Proposal ID does not match event identity' using errcode = '22023';
    end if;

    deal_id_value := nullif(btrim(p_data ->> 'deal_id'), '');
    accepted_at_value := coalesce(
      nullif(p_data ->> 'accepted_at', '')::timestamptz,
      p_occurred_at
    );
    select exists (
      select 1 from public.marketing_leads where deal_id = deal_id_value
    ) into requested_lead_exists;

    select link.lead_deal_id into existing_origin_lead_id
    from public.marketing_lead_job_links link
    where link.job_proposal_id = proposal_id_value
      and link.relationship_type = 'originated'
      and link.link_status = 'confirmed'
    limit 1;

    select link.companycam_project_id into existing_operational_project_id
    from public.job_project_links link
    where link.job_proposal_id = proposal_id_value
      and link.link_role = 'canonical'
      and link.link_status = 'confirmed'
    limit 1;

    insert into public.dripjobs_jobs (
      proposal_id,
      source_crm_record_id,
      invoice_id,
      job_name,
      contact_name,
      email,
      phone,
      status,
      label,
      deal_stage,
      salesperson,
      amount,
      invoice_status,
      paid_amount,
      balance_amount,
      proposal_signed_on,
      job_start_on,
      job_scheduled_on,
      job_completion_on,
      lead_resolution_status,
      lead_resolution_note,
      lead_resolved_at,
      source_filename,
      source_sha256,
      source_row_number,
      source_payload,
      captured_at,
      originating_deal_id,
      dripjobs_contact_uuid,
      address,
      city,
      state,
      postal_code,
      first_live_event_id,
      last_live_event_id,
      last_live_received_at
    ) values (
      proposal_id_value,
      null,
      null,
      coalesce(
        nullif(btrim(p_data ->> 'job_name'), ''),
        nullif(btrim(p_data ->> 'contact_name'), ''),
        'DripJobs proposal ' || proposal_id_value
      ),
      nullif(btrim(p_data ->> 'contact_name'), ''),
      nullif(btrim(p_data ->> 'email'), ''),
      nullif(btrim(p_data ->> 'phone'), ''),
      coalesce(nullif(btrim(p_data ->> 'status'), ''), 'Proposal Accepted'),
      nullif(btrim(p_data ->> 'label'), ''),
      coalesce(nullif(btrim(p_data ->> 'deal_stage'), ''), 'Project Accepted'),
      nullif(btrim(p_data ->> 'salesperson'), ''),
      coalesce(nullif(p_data ->> 'amount', '')::numeric, 0),
      null,
      0,
      0,
      (accepted_at_value at time zone 'America/Toronto')::date,
      null,
      null,
      null,
      case
        when existing_origin_lead_id is not null or requested_lead_exists
          then 'confirmed'
        else 'needs_review'
      end,
      case
        when existing_origin_lead_id is not null
          then 'Existing confirmed originating lead relationship preserved.'
        when requested_lead_exists
          then 'Originating lead linked by exact DripJobs Deal ID.'
        else 'Proposal event did not resolve to an existing exact DripJobs Deal ID.'
      end,
      case
        when existing_origin_lead_id is not null or requested_lead_exists
          then received_at_value
        else null
      end,
      null,
      null,
      null,
      coalesce(p_payload, '{}'::jsonb),
      received_at_value,
      coalesce(existing_origin_lead_id, deal_id_value),
      nullif(btrim(p_data ->> 'contact_uuid'), ''),
      nullif(btrim(p_data ->> 'address'), ''),
      nullif(btrim(p_data ->> 'city'), ''),
      nullif(btrim(p_data ->> 'state'), ''),
      nullif(btrim(p_data ->> 'postal_code'), ''),
      event_row.id,
      event_row.id,
      received_at_value
    )
    on conflict (proposal_id) do update set
      invoice_id = coalesce(dripjobs_jobs.invoice_id, excluded.invoice_id),
      contact_name = coalesce(dripjobs_jobs.contact_name, excluded.contact_name),
      email = coalesce(dripjobs_jobs.email, excluded.email),
      phone = coalesce(dripjobs_jobs.phone, excluded.phone),
      label = coalesce(dripjobs_jobs.label, excluded.label),
      salesperson = coalesce(dripjobs_jobs.salesperson, excluded.salesperson),
      amount = case
        when dripjobs_jobs.amount = 0 and excluded.amount > 0 then excluded.amount
        else dripjobs_jobs.amount
      end,
      proposal_signed_on = coalesce(
        dripjobs_jobs.proposal_signed_on,
        excluded.proposal_signed_on
      ),
      originating_deal_id = coalesce(
        dripjobs_jobs.originating_deal_id,
        excluded.originating_deal_id
      ),
      dripjobs_contact_uuid = coalesce(
        dripjobs_jobs.dripjobs_contact_uuid,
        excluded.dripjobs_contact_uuid
      ),
      address = coalesce(dripjobs_jobs.address, excluded.address),
      city = coalesce(dripjobs_jobs.city, excluded.city),
      state = coalesce(dripjobs_jobs.state, excluded.state),
      postal_code = coalesce(dripjobs_jobs.postal_code, excluded.postal_code),
      first_live_event_id = coalesce(
        dripjobs_jobs.first_live_event_id,
        excluded.first_live_event_id
      ),
      last_live_event_id = excluded.last_live_event_id,
      last_live_received_at = excluded.last_live_received_at;

    if existing_origin_lead_id is null and requested_lead_exists then
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
      ) values (
        deal_id_value,
        proposal_id_value,
        'originated',
        'confirmed',
        'dripjobs_deal_id',
        1,
        jsonb_build_object(
          'source', 'dripjobs_zapier_proposal_accepted',
          'event_id', event_row.id,
          'deal_id', deal_id_value,
          'proposal_id', proposal_id_value
        ),
        'Exact Deal ID supplied by the DripJobs Proposal Accepted event.',
        received_at_value
      )
      on conflict (lead_deal_id, job_proposal_id) do update set
        relationship_type = excluded.relationship_type,
        link_status = excluded.link_status,
        match_method = excluded.match_method,
        confidence = excluded.confidence,
        evidence = excluded.evidence,
        review_note = excluded.review_note,
        confirmed_at = excluded.confirmed_at;

      update public.dripjobs_jobs
      set
        lead_resolution_status = 'confirmed',
        lead_resolution_note = 'Originating lead linked by exact DripJobs Deal ID.',
        lead_resolved_at = coalesce(lead_resolved_at, received_at_value)
      where proposal_id = proposal_id_value;
    elsif existing_origin_lead_id is not null then
      update public.dripjobs_jobs
      set
        lead_resolution_status = 'confirmed',
        lead_resolution_note = coalesce(
          lead_resolution_note,
          'Existing confirmed originating lead relationship preserved.'
        ),
        lead_resolved_at = coalesce(lead_resolved_at, received_at_value)
      where proposal_id = proposal_id_value;
    end if;

    -- The mobile/admin workflows still require a stable project key for time,
    -- assignments, budgets, and labour tasks. This is a local DripJobs
    -- projection only: it does not create a job_project_links relationship and
    -- does not claim that a CompanyCam project exists.
    if existing_operational_project_id is null then
      project_id_value := 'dripjobs-' || proposal_id_value;
      insert into public.companycam_projects (
      companycam_id,
      name,
      street_address_1,
      city,
      state,
      postal_code,
      country,
      formatted_address,
      is_archived,
      raw,
      labels,
      is_lead,
      companycam_status,
      is_deleted,
      last_synced_at,
      operational_job_proposal_id,
      is_job_feed_visible
      ) values (
      project_id_value,
      coalesce(
        nullif(btrim(p_data ->> 'job_name'), ''),
        nullif(btrim(p_data ->> 'contact_name'), ''),
        'DripJobs proposal ' || proposal_id_value
      ),
      nullif(btrim(p_data ->> 'street_address_1'), ''),
      nullif(btrim(p_data ->> 'city'), ''),
      nullif(btrim(p_data ->> 'state'), ''),
      nullif(btrim(p_data ->> 'postal_code'), ''),
      coalesce(nullif(btrim(p_data ->> 'country'), ''), 'Canada'),
      nullif(btrim(p_data ->> 'address'), ''),
      false,
      jsonb_build_object(
        'source', 'dripjobs_operational_projection',
        'proposal_id', proposal_id_value,
        'event_id', event_row.id
      ),
      jsonb_build_array(jsonb_build_object('name', 'DripJobs job')),
      false,
      'dripjobs_accepted',
      false,
      received_at_value,
      proposal_id_value,
      true
      )
      on conflict (companycam_id) do update set
        name = coalesce(nullif(companycam_projects.name, ''), excluded.name),
        street_address_1 = coalesce(
          companycam_projects.street_address_1,
          excluded.street_address_1
        ),
        city = coalesce(companycam_projects.city, excluded.city),
        state = coalesce(companycam_projects.state, excluded.state),
        postal_code = coalesce(
          companycam_projects.postal_code,
          excluded.postal_code
        ),
        formatted_address = coalesce(
          companycam_projects.formatted_address,
          excluded.formatted_address
        ),
        is_deleted = false,
        is_lead = false,
        operational_job_proposal_id = coalesce(
          companycam_projects.operational_job_proposal_id,
          excluded.operational_job_proposal_id
        ),
        is_job_feed_visible = true,
        last_synced_at = excluded.last_synced_at;
    end if;

  end if;

  update public.dripjobs_ingest_events
  set
    processing_status = 'processed',
    error_code = null,
    processed_at = received_at_value
  where id = event_row.id;

  return jsonb_build_object(
    'ok', true,
    'status', 'processed',
    'event_id', event_row.id,
    'event_type', event_row.event_type,
    'entity_id', event_row.entity_id
  );
end
$$;

revoke all on function public.process_dripjobs_zapier_event(
  text, text, text, timestamptz, jsonb, text, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.process_dripjobs_zapier_event(
  text, text, text, timestamptz, jsonb, text, jsonb, boolean
) to service_role;

-- Preserve the feed contract used by the mobile app while excluding future
-- CompanyCam-only imports. New jobs enter this feed only through the DripJobs
-- projection created above.
create or replace function public.list_project_feed(
  requested_page integer default 0,
  requested_page_size integer default 20,
  requested_search text default '',
  requested_project_ids text[] default null
)
returns table (
  companycam_id text,
  name text,
  formatted_address text,
  street_address_1 text,
  street_address_2 text,
  city text,
  state text,
  postal_code text,
  country text,
  latitude double precision,
  longitude double precision,
  is_archived boolean,
  is_deleted boolean,
  companycam_status text,
  is_lead boolean,
  last_synced_at timestamptz,
  companycam_updated_at timestamptz,
  budget_percent_used numeric,
  budget_hours_used numeric,
  budget_status text,
  budget_is_complete boolean,
  budget_calculated_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  search_term text := btrim(coalesce(requested_search, ''));
  page_offset bigint;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.employee_profiles profile
    where profile.user_id = auth.uid()
      and profile.is_active = true
  ) then
    raise exception 'Only active employees can view the project feed'
      using errcode = '42501';
  end if;

  if requested_page is null or requested_page < 0 then
    raise exception 'Project page must be zero or greater'
      using errcode = '22023';
  end if;

  if requested_page_size is null
    or requested_page_size < 1
    or requested_page_size > 100 then
    raise exception 'Project page size must be between 1 and 100'
      using errcode = '22023';
  end if;

  if coalesce(array_length(requested_project_ids, 1), 0) > 1000 then
    raise exception 'Project feed filtering is limited to 1000 project IDs'
      using errcode = '22023';
  end if;

  page_offset := requested_page::bigint * requested_page_size::bigint;

  return query
  with matching_projects as (
    select project.*
    from public.companycam_projects project
    where project.is_job_feed_visible = true
      and project.is_deleted = false
      and project.companycam_id <> 'qa-web-smoke-project'
      and (
        search_term <> ''
        or (project.is_archived = false and project.is_lead = false)
      )
      and (
        search_term <> ''
        or requested_project_ids is null
        or project.companycam_id = any(requested_project_ids)
      )
      and (
        search_term = ''
        or position(
          lower(search_term) in lower(concat_ws(
            ' ',
            project.name,
            project.formatted_address,
            project.city,
            project.state,
            project.postal_code
          ))
        ) > 0
      )
  ),
  page_projects as (
    select
      project.*,
      count(*) over () as matched_count
    from matching_projects project
    order by
      project.companycam_updated_at desc nulls last,
      project.name,
      project.companycam_id
    offset page_offset
    limit requested_page_size
  ),
  budget_progress as (
    select progress.*
    from public.get_project_budget_progress(
      coalesce(
        (select array_agg(project.companycam_id) from page_projects project),
        array[]::text[]
      )
    ) progress
  )
  select
    project.companycam_id,
    project.name,
    project.formatted_address,
    project.street_address_1,
    project.street_address_2,
    project.city,
    project.state,
    project.postal_code,
    project.country,
    project.latitude,
    project.longitude,
    project.is_archived,
    project.is_deleted,
    project.companycam_status,
    project.is_lead,
    project.last_synced_at,
    project.companycam_updated_at,
    progress.percent_used,
    progress.hours_used,
    progress.budget_status,
    progress.is_complete,
    progress.calculated_at,
    project.matched_count
  from page_projects project
  left join budget_progress progress
    on progress.companycam_project_id = project.companycam_id
  order by
    project.companycam_updated_at desc nulls last,
    project.name,
    project.companycam_id;
end;
$$;

comment on function public.list_project_feed(integer, integer, text, text[]) is
  'DripJobs-first project feed with preserved legacy project identifiers.';

revoke all on function public.list_project_feed(integer, integer, text, text[])
  from public, anon;
grant execute on function public.list_project_feed(integer, integer, text, text[])
  to authenticated;

create or replace function public.read_dripjobs_sync_health()
returns table (
  total_events bigint,
  processed_events bigint,
  failed_events bigint,
  ignored_test_events bigint,
  duplicate_deliveries bigint,
  live_lead_events bigint,
  accepted_proposal_events bigint,
  last_received_at timestamptz,
  last_processed_at timestamptz
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*)::bigint,
    count(*) filter (where processing_status = 'processed')::bigint,
    count(*) filter (where processing_status = 'failed')::bigint,
    count(*) filter (where processing_status = 'ignored')::bigint,
    coalesce(sum(greatest(attempt_count - 1, 0)), 0)::bigint,
    count(*) filter (
      where event_type = 'lead.created' and processing_status = 'processed'
    )::bigint,
    count(*) filter (
      where event_type = 'proposal.accepted' and processing_status = 'processed'
    )::bigint,
    max(received_at),
    max(processed_at)
  from public.dripjobs_ingest_events
$$;

grant execute on function public.read_dripjobs_sync_health() to authenticated;

comment on table public.dripjobs_ingest_events is
  'Idempotency and delivery ledger for DripJobs events received from Zapier.';
comment on function public.process_dripjobs_zapier_event is
  'Service-role-only continuation of the audited DripJobs lead/job export.';

select pg_notify('pgrst', 'reload schema');

commit;
