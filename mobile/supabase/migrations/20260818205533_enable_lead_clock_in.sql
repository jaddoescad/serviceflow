-- An accepted quote is not required for field work to begin. This guarded RPC
-- promotes an unconverted lead into an operational zero-value job only when an
-- active employee actually clocks into it.
create or replace function public.ensure_lead_clock_in_job(requested_lead_id uuid)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  source_lead public.leads%rowtype;
  source_contact public.contacts%rowtype;
  result public.jobs%rowtype;
begin
  if actor_id is null or not exists (
    select 1
    from public.employees employee
    where employee.id = actor_id
      and employee.is_active
  ) then
    raise exception 'Active employee profile required' using errcode = '42501';
  end if;

  if requested_lead_id is null then
    raise exception 'Lead id is required' using errcode = '22023';
  end if;

  -- Lock the lead so two nearly simultaneous clock-ins cannot create two jobs.
  select * into source_lead
  from public.leads lead
  where lead.id = requested_lead_id
  for update;
  if not found then
    raise exception 'Lead not found' using errcode = 'P0002';
  end if;

  -- A stale lead search result may already have been converted. Reuse its
  -- operational job instead of creating another project.
  select * into result
  from public.jobs job
  where job.lead_id = source_lead.id
    and job.status in ('scheduled', 'active')
  order by
    (job.accepted_quote_id is not null) desc,
    (job.status = 'active') desc,
    job.created_at asc
  limit 1
  for update;
  if found then
    return result;
  end if;

  select * into source_contact
  from public.contacts contact
  where contact.id = source_lead.contact_id;

  insert into public.jobs (
    id,
    contact_id,
    lead_id,
    accepted_quote_id,
    name,
    status,
    contract_amount_cents,
    address_line_1,
    city,
    province,
    postal_code,
    formatted_address,
    started_on,
    is_feed_visible,
    source,
    metadata,
    created_at,
    updated_at
  ) values (
    extensions.gen_random_uuid(),
    source_lead.contact_id,
    source_lead.id,
    null,
    coalesce(nullif(btrim(source_contact.name), ''), 'Project'),
    'active',
    0,
    source_lead.address,
    source_lead.city,
    source_lead.province,
    source_lead.postal_code,
    source_lead.address,
    current_date,
    true,
    'app',
    jsonb_build_object(
      'created_from', 'lead_clock_in',
      'created_by', actor_id
    ),
    now(),
    now()
  )
  returning * into result;

  return result;
end;
$$;

revoke all on function public.ensure_lead_clock_in_job(uuid) from public;
revoke all on function public.ensure_lead_clock_in_job(uuid) from anon;
grant execute on function public.ensure_lead_clock_in_job(uuid) to authenticated;

-- When a quote is accepted later, attach it to the job that field staff already
-- started instead of producing a second job for the same project.
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
  if not private.is_manager() then
    raise exception 'Manager access required' using errcode = '42501';
  end if;

  select * into source_lead
  from public.leads lead
  where lead.id = requested_lead_id
  for update;
  if not found then raise exception 'Lead not found'; end if;

  select * into source_quote
  from public.quotes quote
  where quote.id = requested_quote_id
    and quote.lead_id = requested_lead_id
  for update;
  if not found then raise exception 'Quote does not belong to the lead'; end if;

  select * into source_contact
  from public.contacts contact
  where contact.id = source_lead.contact_id;

  -- Prefer the quote-less job created by the first field clock-in.
  select * into result
  from public.jobs job
  where job.lead_id = source_lead.id
    and job.accepted_quote_id is null
    and job.status in ('scheduled', 'active')
  order by (job.status = 'active') desc, job.created_at asc
  limit 1
  for update;

  if found then
    update public.jobs job
    set
      accepted_quote_id = source_quote.id,
      name = coalesce(
        nullif(btrim(requested_name), ''),
        nullif(btrim(source_quote.name), ''),
        nullif(btrim(source_contact.name), ''),
        job.name
      ),
      contract_amount_cents = source_quote.amount_cents,
      scheduled_on = coalesce(requested_scheduled_on, job.scheduled_on),
      status = case
        when job.status = 'active' then 'active'
        when requested_scheduled_on is null then 'active'
        else 'scheduled'
      end,
      metadata = coalesce(job.metadata, '{}'::jsonb) || jsonb_build_object(
        'converted_by', auth.uid(),
        'converted_from_prequote_job', true
      ),
      updated_at = now()
    where job.id = result.id
    returning * into result;
  else
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
  end if;

  update public.quotes quote
  set status = 'accepted',
      accepted_at = coalesce(quote.accepted_at, now()),
      updated_at = now()
  where quote.id = source_quote.id;

  update public.leads lead
  set status = 'won', updated_at = now()
  where lead.id = source_lead.id;

  perform private.ensure_default_job_budget(result.id, result.contract_amount_cents);
  return result;
end;
$$;

revoke all on function public.convert_lead_to_job(uuid, uuid, text, date) from public;
revoke all on function public.convert_lead_to_job(uuid, uuid, text, date) from anon;
grant execute on function public.convert_lead_to_job(uuid, uuid, text, date) to authenticated;
