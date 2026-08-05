begin;

-- Labour hours historically used 37% of the before-HST job amount at a
-- $35/hour planning rate. Keep those inputs explicit and centrally editable.
update public.app_config
set
  settings = jsonb_set(
    coalesce(settings, '{}'::jsonb),
    '{labour_budget}',
    jsonb_build_object(
      'allocation_percent', 37,
      'planning_hourly_rate_cents', 3500
    ),
    true
  ),
  updated_at = now()
where id = 'default';

-- Create or refresh a formula-derived hour budget without overwriting hours
-- explicitly published by the calculator or set by an administrator.
create or replace function private.ensure_default_job_budget(
  requested_job_id uuid,
  requested_amount_cents bigint default null
)
returns public.job_budgets
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_job public.jobs%rowtype;
  current_budget public.job_budgets%rowtype;
  published_budget public.job_budgets%rowtype;
  result public.job_budgets%rowtype;
  effective_amount_cents bigint;
  allocation_percent numeric := 37;
  planning_hourly_rate_cents integer := 3500;
  derived_minutes integer;
  next_version integer;
begin
  select * into source_job
  from public.jobs job
  where job.id = requested_job_id
  for update;

  if not found then
    raise exception 'Job not found';
  end if;

  select * into current_budget
  from public.job_budgets budget
  where budget.job_id = requested_job_id
    and budget.source in ('manual', 'project_budget')
    and budget.status in ('active', 'closed')
  order by
    (budget.status = 'active') desc,
    (budget.source = 'manual') desc,
    budget.version desc,
    budget.updated_at desc,
    budget.id
  limit 1
  for update;

  if found then
    if current_budget.budget_minutes is not null
      and current_budget.metadata ->> 'budget_minutes_source' is distinct from 'formula' then
      return current_budget;
    end if;

    effective_amount_cents := coalesce(
      requested_amount_cents,
      current_budget.amount_including_tax_cents,
      source_job.contract_amount_cents
    );
  else
    -- A published calculator budget is already explicit. Do not create a
    -- competing formula budget when it is the only configured hour budget.
    select * into published_budget
    from public.job_budgets budget
    where budget.job_id = requested_job_id
      and budget.source = 'published_labour_budget'
      and budget.status in ('active', 'closed')
      and budget.budget_minutes is not null
    order by
      (budget.status = 'active') desc,
      budget.version desc,
      budget.updated_at desc,
      budget.id
    limit 1
    for update;

    if found then
      return published_budget;
    end if;

    effective_amount_cents := coalesce(
      requested_amount_cents,
      source_job.contract_amount_cents
    );
  end if;

  if effective_amount_cents is null or effective_amount_cents <= 0 then
    return null;
  end if;

  select
    coalesce(
      nullif(config.settings #>> '{labour_budget,allocation_percent}', '')::numeric,
      37
    ),
    coalesce(
      nullif(config.settings #>> '{labour_budget,planning_hourly_rate_cents}', '')::integer,
      3500
    )
  into allocation_percent, planning_hourly_rate_cents
  from public.app_config config
  where config.id = 'default';

  allocation_percent := coalesce(allocation_percent, 37);
  planning_hourly_rate_cents := coalesce(planning_hourly_rate_cents, 3500);

  if planning_hourly_rate_cents <= 0 then
    raise exception 'The labour planning hourly rate must be greater than zero';
  end if;

  derived_minutes := round(
    effective_amount_cents::numeric
    * allocation_percent / 100
    * 60 / planning_hourly_rate_cents
  )::integer;

  if current_budget.id is not null then
    update public.job_budgets budget
    set
      budget_minutes = derived_minutes,
      hourly_rate_cents = coalesce(budget.hourly_rate_cents, planning_hourly_rate_cents),
      amount_including_tax_cents = effective_amount_cents,
      metadata = coalesce(budget.metadata, '{}'::jsonb) || jsonb_build_object(
        'budget_minutes_source', 'formula',
        'formula_allocation_percent', allocation_percent,
        'formula_hourly_rate_cents', planning_hourly_rate_cents,
        'formula_amount_cents', effective_amount_cents,
        'formula_updated_at', now()
      ),
      updated_at = now()
    where budget.id = current_budget.id
    returning * into result;

    return result;
  end if;

  select coalesce(max(budget.version), 0) + 1
  into next_version
  from public.job_budgets budget
  where budget.job_id = requested_job_id;

  insert into public.job_budgets (
    id, job_id, quote_id, version, status, budget_minutes,
    calculated_minutes, hourly_rate_cents, amount_including_tax_cents,
    labour_allocation_percent, source, metadata, created_at, updated_at
  ) values (
    extensions.gen_random_uuid(),
    source_job.id,
    source_job.accepted_quote_id,
    next_version,
    case
      when source_job.status in ('completed', 'cancelled', 'archived') then 'closed'
      else 'active'
    end,
    derived_minutes,
    derived_minutes,
    planning_hourly_rate_cents,
    effective_amount_cents,
    40,
    'project_budget',
    jsonb_build_object(
      'budget_minutes_source', 'formula',
      'formula_allocation_percent', allocation_percent,
      'formula_hourly_rate_cents', planning_hourly_rate_cents,
      'formula_amount_cents', effective_amount_cents,
      'formula_updated_at', now()
    ),
    now(),
    now()
  )
  returning * into result;

  return result;
end
$$;

revoke all on function private.ensure_default_job_budget(uuid, bigint)
  from public, anon, authenticated;

-- Prefer the canonical operational budget over migrated supporting rows.
-- This keeps an older published row from masking the current job budget.
create or replace view public.job_feed
with (security_invoker = true)
as
select
  job.id,
  job.name,
  job.status,
  job.formatted_address,
  job.address_line_1,
  job.address_line_2,
  job.city,
  job.province,
  job.postal_code,
  job.country,
  job.latitude,
  job.longitude,
  job.companycam_project_ids,
  job.scheduled_on,
  job.started_on,
  job.completed_on,
  job.is_feed_visible,
  job.updated_at,
  budget.budget_minutes,
  usage.used_minutes,
  case
    when budget.budget_minutes is null or budget.budget_minutes = 0 then null
    else round(usage.used_minutes::numeric / budget.budget_minutes * 100, 2)
  end as budget_percent_used,
  case
    when budget.budget_minutes is null then 'not_configured'
    when usage.used_minutes > budget.budget_minutes then 'over_budget'
    when job.status = 'completed' then 'complete'
    else 'active'
  end as budget_status
from public.jobs job
left join lateral (
  select source.budget_minutes
  from public.job_budgets source
  where source.job_id = job.id
    and source.status in ('active', 'closed')
  order by
    (source.status = 'active') desc,
    (source.source in ('manual', 'project_budget')) desc,
    (source.source = 'manual') desc,
    source.version desc,
    source.updated_at desc,
    source.id
  limit 1
) budget on true
left join lateral (
  select coalesce(sum(
    greatest(0, extract(epoch from (coalesce(entry.ended_at, now()) - entry.started_at)) / 60)
  ), 0)::integer as used_minutes
  from public.time_entries entry
  where entry.job_id = job.id
    and entry.status <> 'deleted'
) usage on true
where job.is_feed_visible;

-- Amount-only edits retain or recalculate formula hours. Calculator-published
-- hours become explicit and are never overwritten by the formula.
create or replace function public.save_job_budget(
  requested_job_id uuid,
  requested_budget_minutes integer,
  requested_hourly_rate_cents integer default null,
  requested_amount_including_tax_cents bigint default null,
  requested_notes text default null
)
returns public.job_budgets
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_budget public.job_budgets%rowtype;
  previous_budget public.job_budgets%rowtype;
  result public.job_budgets%rowtype;
  next_version integer;
begin
  if not private.is_manager() then raise exception 'Manager access required'; end if;

  perform private.ensure_default_job_budget(
    requested_job_id,
    requested_amount_including_tax_cents
  );

  select * into current_budget
  from public.job_budgets budget
  where budget.job_id = requested_job_id
    and budget.source = 'manual'
    and budget.status in ('active', 'closed')
  order by
    (budget.status = 'active') desc,
    budget.version desc,
    budget.updated_at desc
  limit 1
  for update;

  if found then
    update public.job_budgets budget
    set
      budget_minutes = coalesce(requested_budget_minutes, budget.budget_minutes),
      calculated_minutes = case
        when requested_budget_minutes is not null then requested_budget_minutes
        else budget.calculated_minutes
      end,
      hourly_rate_cents = coalesce(requested_hourly_rate_cents, budget.hourly_rate_cents),
      amount_including_tax_cents = coalesce(
        requested_amount_including_tax_cents,
        budget.amount_including_tax_cents
      ),
      notes = coalesce(requested_notes, budget.notes),
      metadata = case
        when requested_budget_minutes is null then budget.metadata
        else (
          coalesce(budget.metadata, '{}'::jsonb)
          - 'formula_allocation_percent'
          - 'formula_hourly_rate_cents'
          - 'formula_amount_cents'
          - 'formula_updated_at'
        ) || jsonb_build_object(
          'budget_minutes_source', 'explicit',
          'budget_minutes_updated_at', now()
        )
      end,
      updated_at = now()
    where budget.id = current_budget.id
    returning * into result;
  else
    select * into previous_budget
    from public.job_budgets budget
    where budget.job_id = requested_job_id
      and budget.source in ('project_budget', 'published_labour_budget')
      and budget.status in ('active', 'closed')
    order by
      (budget.status = 'active') desc,
      (budget.source = 'project_budget') desc,
      budget.version desc,
      budget.updated_at desc,
      budget.id
    limit 1
    for update;

    if found and previous_budget.status = 'active' then
      update public.job_budgets budget
      set
        status = 'superseded',
        updated_at = now()
      where budget.id = previous_budget.id;
    end if;

    select coalesce(max(budget.version), 0) + 1 into next_version
    from public.job_budgets budget
    where budget.job_id = requested_job_id;

    insert into public.job_budgets (
      id, job_id, quote_id, version, status, budget_minutes,
      calculated_minutes, hourly_rate_cents, amount_including_tax_cents,
      labour_allocation_percent, actual_labour_cost_cents,
      instructions, notes, closed_at, closed_by, source, metadata,
      created_at, updated_at
    )
    select
      extensions.gen_random_uuid(),
      job.id,
      job.accepted_quote_id,
      next_version,
      coalesce(previous_budget.status, 'active'),
      coalesce(requested_budget_minutes, previous_budget.budget_minutes),
      coalesce(requested_budget_minutes, previous_budget.calculated_minutes),
      coalesce(requested_hourly_rate_cents, previous_budget.hourly_rate_cents),
      coalesce(
        requested_amount_including_tax_cents,
        previous_budget.amount_including_tax_cents
      ),
      coalesce(previous_budget.labour_allocation_percent, 40),
      previous_budget.actual_labour_cost_cents,
      previous_budget.instructions,
      coalesce(requested_notes, previous_budget.notes),
      previous_budget.closed_at,
      previous_budget.closed_by,
      'manual',
      coalesce(previous_budget.metadata, '{}'::jsonb)
        || jsonb_build_object('copied_from_budget_id', previous_budget.id)
        || case
          when requested_budget_minutes is null then '{}'::jsonb
          else jsonb_build_object(
            'budget_minutes_source', 'explicit',
            'budget_minutes_updated_at', now()
          )
        end,
      now(),
      now()
    from public.jobs job
    where job.id = requested_job_id
    returning * into result;

    if not found then raise exception 'Job not found'; end if;
  end if;

  if requested_amount_including_tax_cents is not null then
    update public.jobs
    set contract_amount_cents = requested_amount_including_tax_cents,
        updated_at = now()
    where id = requested_job_id;
  end if;

  return result;
end
$$;

create or replace function public.convert_lead_to_job(
  requested_lead_id uuid,
  requested_quote_id uuid,
  requested_name text default null,
  requested_scheduled_on date default null
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_lead public.leads%rowtype;
  source_quote public.quotes%rowtype;
  source_contact public.contacts%rowtype;
  result public.jobs%rowtype;
begin
  if not private.is_manager() then raise exception 'Manager access required'; end if;
  select * into source_lead from public.leads where id = requested_lead_id for update;
  if not found then raise exception 'Lead not found'; end if;
  select * into source_quote
  from public.quotes
  where id = requested_quote_id and lead_id = requested_lead_id
  for update;
  if not found then raise exception 'Quote does not belong to the lead'; end if;
  select * into source_contact from public.contacts where id = source_lead.contact_id;

  insert into public.jobs (
    id, contact_id, lead_id, accepted_quote_id, name, status,
    contract_amount_cents, address_line_1, city, province, postal_code,
    formatted_address, scheduled_on, is_feed_visible, source,
    metadata, created_at, updated_at
  ) values (
    extensions.gen_random_uuid(),
    source_lead.contact_id,
    source_lead.id,
    source_quote.id,
    coalesce(nullif(btrim(requested_name), ''), source_quote.name, source_contact.name),
    case when requested_scheduled_on is null then 'active' else 'scheduled' end,
    source_quote.amount_cents,
    source_lead.address,
    source_lead.city,
    source_lead.province,
    source_lead.postal_code,
    source_lead.address,
    requested_scheduled_on,
    true,
    'app',
    jsonb_build_object('converted_by', auth.uid()),
    now(),
    now()
  )
  on conflict (accepted_quote_id) do update set
    name = coalesce(nullif(btrim(requested_name), ''), public.jobs.name),
    contract_amount_cents = excluded.contract_amount_cents,
    scheduled_on = coalesce(requested_scheduled_on, public.jobs.scheduled_on),
    status = case
      when requested_scheduled_on is not null and public.jobs.status = 'active' then 'scheduled'
      else public.jobs.status
    end,
    updated_at = now()
  returning * into result;

  update public.quotes
  set status = 'accepted', accepted_at = coalesce(accepted_at, now()), updated_at = now()
  where id = source_quote.id;
  update public.leads
  set status = 'won', updated_at = now()
  where id = source_lead.id;

  perform private.ensure_default_job_budget(result.id, result.contract_amount_cents);
  return result;
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
set search_path = ''
as $$
declare
  namespace_id constant uuid := '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid;
  event_id uuid := extensions.uuid_generate_v5(namespace_id, 'integration-event:dripjobs:' || p_event_key);
  contact_id uuid;
  lead_id uuid;
  quote_id uuid;
  job_id uuid;
  job_amount_cents bigint;
  deal_id text;
  contact_external_id text;
  normalized_email text;
  normalized_phone text;
  existing_status text;
begin
  if p_event_type not in ('lead.created', 'proposal.accepted') then
    raise exception 'Unsupported DripJobs event type';
  end if;

  select event.processing_status
  into existing_status
  from private.integration_events event
  where event.provider = 'dripjobs' and event.event_key = p_event_key
  for update;

  if found and existing_status in ('processed', 'ignored') then
    return jsonb_build_object(
      'ok', true,
      'status', 'duplicate',
      'event_id', event_id
    );
  elsif found then
    update private.integration_events event
    set
      attempt_count = event.attempt_count + 1,
      processing_status = 'processing',
      error_code = null,
      updated_at = now()
    where event.provider = 'dripjobs' and event.event_key = p_event_key;
  else
    insert into private.integration_events (
      id, provider, event_key, event_type, entity_type, entity_id,
      occurred_at, payload, payload_sha256, processing_status,
      is_test, attempt_count, received_at, created_at, updated_at
    ) values (
      event_id,
      'dripjobs',
      p_event_key,
      p_event_type,
      case when p_event_type = 'lead.created' then 'lead' else 'proposal' end,
      p_entity_id,
      p_occurred_at,
      coalesce(p_payload, '{}'::jsonb),
      p_payload_sha256,
      case when p_is_test then 'ignored' else 'processing' end,
      p_is_test,
      1,
      now(),
      now(),
      now()
    );
  end if;

  if p_is_test then
    return jsonb_build_object('ok', true, 'status', 'ignored', 'event_id', event_id);
  end if;

  begin
    deal_id := nullif(btrim(p_data ->> 'deal_id'), '');
    contact_external_id := nullif(btrim(p_data ->> 'contact_uuid'), '');
    normalized_email := nullif(lower(btrim(p_data ->> 'email')), '');
    normalized_phone := nullif(
      regexp_replace(coalesce(p_data ->> 'phone', ''), '[^0-9]+', '', 'g'),
      ''
    );

    if p_event_type = 'lead.created' then
      deal_id := coalesce(deal_id, p_entity_id);
    end if;

    if deal_id is null then
      raise exception 'An exact DripJobs deal_id is required';
    end if;

    if contact_external_id is not null then
      contact_id := extensions.uuid_generate_v5(
        namespace_id,
        'contact:dripjobs:' || contact_external_id
      );
    elsif normalized_email is not null and normalized_phone is not null then
      select (array_agg(contact.id order by contact.id))[1]
      into contact_id
      from public.contacts contact
      where contact.normalized_email = normalized_email
        and contact.normalized_phone = normalized_phone
      having count(*) = 1;
    end if;
    contact_id := coalesce(
      contact_id,
      extensions.uuid_generate_v5(namespace_id, 'contact:lead:' || deal_id)
    );

    insert into public.contacts (
      id, kind, dripjobs_contact_id, name, email, phone,
      normalized_email, normalized_phone, metadata, created_at, updated_at
    ) values (
      contact_id,
      'customer',
      contact_external_id,
      coalesce(nullif(btrim(p_data ->> 'contact_name'), ''), 'Unknown contact'),
      normalized_email,
      nullif(btrim(p_data ->> 'phone'), ''),
      normalized_email,
      normalized_phone,
      jsonb_build_object('source', 'dripjobs_live'),
      coalesce(p_occurred_at, now()),
      now()
    )
    on conflict (id) do update set
      dripjobs_contact_id = coalesce(public.contacts.dripjobs_contact_id, excluded.dripjobs_contact_id),
      name = case
        when excluded.name = 'Unknown contact' then public.contacts.name
        else excluded.name
      end,
      email = coalesce(excluded.email, public.contacts.email),
      phone = coalesce(excluded.phone, public.contacts.phone),
      normalized_email = coalesce(excluded.normalized_email, public.contacts.normalized_email),
      normalized_phone = coalesce(excluded.normalized_phone, public.contacts.normalized_phone),
      metadata = public.contacts.metadata || excluded.metadata,
      updated_at = now();

    lead_id := extensions.uuid_generate_v5(namespace_id, 'lead:' || deal_id);
    insert into public.leads (
      id, contact_id, dripjobs_deal_id, status, source,
      normalized_channel, address, postal_code, created_at,
      captured_at, updated_at, metadata
    ) values (
      lead_id,
      contact_id,
      deal_id,
      case when p_event_type = 'proposal.accepted' then 'won' else 'new' end,
      nullif(btrim(p_data ->> 'lead_source'), ''),
      'unknown',
      nullif(btrim(p_data ->> 'address'), ''),
      nullif(btrim(p_data ->> 'postal_code'), ''),
      coalesce(nullif(p_data ->> 'created_at', '')::timestamptz, p_occurred_at, now()),
      now(),
      now(),
      jsonb_build_object('source', 'dripjobs_live', 'last_event_id', event_id)
    )
    on conflict (dripjobs_deal_id) do update set
      contact_id = excluded.contact_id,
      status = case
        when p_event_type = 'proposal.accepted' then 'won'
        else public.leads.status
      end,
      source = coalesce(excluded.source, public.leads.source),
      address = coalesce(excluded.address, public.leads.address),
      postal_code = coalesce(excluded.postal_code, public.leads.postal_code),
      metadata = public.leads.metadata || excluded.metadata,
      updated_at = now()
    returning id into lead_id;

    if p_event_type = 'proposal.accepted' then
      quote_id := extensions.uuid_generate_v5(namespace_id, 'quote:' || p_entity_id);
      insert into public.quotes (
        id, lead_id, dripjobs_proposal_id, name, status,
        amount_cents, accepted_at, source, metadata, created_at, updated_at
      ) values (
        quote_id,
        lead_id,
        p_entity_id,
        coalesce(nullif(btrim(p_data ->> 'job_name'), ''), 'Proposal ' || p_entity_id),
        'accepted',
        round(coalesce(nullif(p_data ->> 'amount', '')::numeric, 0) * 100)::bigint,
        coalesce(nullif(p_data ->> 'accepted_at', '')::timestamptz, p_occurred_at, now()),
        'dripjobs',
        jsonb_build_object(
          'status', p_data ->> 'status',
          'label', p_data ->> 'label',
          'deal_stage', p_data ->> 'deal_stage',
          'salesperson', p_data ->> 'salesperson',
          'last_event_id', event_id
        ),
        now(),
        now()
      )
      on conflict (dripjobs_proposal_id) do update set
        lead_id = excluded.lead_id,
        name = excluded.name,
        status = 'accepted',
        amount_cents = excluded.amount_cents,
        accepted_at = coalesce(public.quotes.accepted_at, excluded.accepted_at),
        metadata = public.quotes.metadata || excluded.metadata,
        updated_at = now()
      returning id into quote_id;

      job_id := extensions.uuid_generate_v5(namespace_id, 'job:proposal:' || p_entity_id);
      insert into public.jobs (
        id, contact_id, lead_id, accepted_quote_id, name, status,
        contract_amount_cents, address_line_1, city, province,
        postal_code, country, formatted_address, companycam_project_ids,
        is_feed_visible, source, metadata, created_at, updated_at
      ) values (
        job_id,
        contact_id,
        lead_id,
        quote_id,
        coalesce(nullif(btrim(p_data ->> 'job_name'), ''), 'Job ' || p_entity_id),
        'active',
        round(coalesce(nullif(p_data ->> 'amount', '')::numeric, 0) * 100)::bigint,
        coalesce(nullif(btrim(p_data ->> 'street_address_1'), ''), nullif(btrim(p_data ->> 'address'), '')),
        nullif(btrim(p_data ->> 'city'), ''),
        nullif(btrim(p_data ->> 'state'), ''),
        nullif(btrim(p_data ->> 'postal_code'), ''),
        coalesce(nullif(btrim(p_data ->> 'country'), ''), 'CA'),
        nullif(btrim(p_data ->> 'address'), ''),
        '{}'::text[],
        true,
        'dripjobs',
        jsonb_build_object('last_event_id', event_id),
        now(),
        now()
      )
      on conflict (accepted_quote_id) do update set
        contact_id = excluded.contact_id,
        lead_id = excluded.lead_id,
        name = excluded.name,
        contract_amount_cents = excluded.contract_amount_cents,
        address_line_1 = coalesce(excluded.address_line_1, public.jobs.address_line_1),
        city = coalesce(excluded.city, public.jobs.city),
        province = coalesce(excluded.province, public.jobs.province),
        postal_code = coalesce(excluded.postal_code, public.jobs.postal_code),
        formatted_address = coalesce(excluded.formatted_address, public.jobs.formatted_address),
        metadata = public.jobs.metadata || excluded.metadata,
        updated_at = now()
      returning id, contract_amount_cents into job_id, job_amount_cents;

      perform private.ensure_default_job_budget(job_id, job_amount_cents);
    end if;

    update private.integration_events event
    set
      processing_status = 'processed',
      processed_at = now(),
      updated_at = now()
    where event.id = event_id;

    return jsonb_build_object(
      'ok', true,
      'status', 'processed',
      'event_id', event_id,
      'lead_id', lead_id,
      'quote_id', quote_id,
      'job_id', job_id
    );
  exception when others then
    update private.integration_events event
    set
      processing_status = 'failed',
      error_code = sqlstate,
      updated_at = now()
    where event.id = event_id;
    return jsonb_build_object(
      'ok', false,
      'status', 'failed',
      'event_id', event_id,
      'error_code', sqlstate
    );
  end;
end
$$;

-- Repair every amount-bearing job whose current feed has no stored hours.
-- Non-null historical, manual and calculator-published hours remain unchanged.
do $$
declare
  target record;
begin
  for target in
    select job.id
    from public.jobs job
    where job.contract_amount_cents > 0
    order by job.id
  loop
    perform private.ensure_default_job_budget(
      target.id,
      null
    );
  end loop;
end
$$;

do $$
begin
  if exists (
    select 1
    from public.jobs job
    left join public.job_feed feed on feed.id = job.id
    where job.contract_amount_cents > 0
      and job.is_feed_visible
      and feed.budget_minutes is null
  ) then
    raise exception 'A visible amount-bearing job still has no budget hours';
  end if;

  if exists (
    select 1
    from public.jobs job
    left join lateral (
      select budget.budget_minutes
      from public.job_budgets budget
      where budget.job_id = job.id
        and budget.status in ('active', 'closed')
      order by
        (budget.status = 'active') desc,
        (budget.source in ('manual', 'project_budget')) desc,
        (budget.source = 'manual') desc,
        budget.version desc,
        budget.updated_at desc,
        budget.id
      limit 1
    ) selected_budget on true
    where job.contract_amount_cents > 0
      and selected_budget.budget_minutes is null
  ) then
    raise exception 'An amount-bearing job still has no selected budget hours';
  end if;

  if exists (
    select 1
    from public.job_budgets budget
    where budget.source in ('manual', 'project_budget')
      and budget.status = 'active'
    group by budget.job_id
    having count(*) > 1
  ) then
    raise exception 'A job has multiple active operational budgets';
  end if;

  if (
    select feed.budget_minutes
    from public.job_feed feed
    where feed.id = 'ec24398b-3137-5b77-b59a-6497cd648aa9'::uuid
  ) <> 365 then
    raise exception 'Mehaly Marinakis budget should be 365 minutes';
  end if;
end
$$;

commit;
