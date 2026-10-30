-- Job Schedule (dated jobs on a calendar, plus accepted jobs waiting for
-- dates), sales Metrics, tabular Reports and Job Costing (contract against
-- invoiced, paid and crew wages from clocked hours).
begin;

-- Dating a job takes it out of a manual "scheduled" column so the board shows
-- it as Project Scheduled; clearing the dates puts it back with accepted jobs.
create function public.schedule_job(requested_job uuid, requested_start date, requested_end date)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  job public.jobs%rowtype;
begin
  select * into job from public.jobs where id = requested_job for update;
  if not found then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(job.org_id) then
    raise exception 'Only managers can schedule jobs.' using errcode = '42501';
  end if;
  if requested_start is null and requested_end is not null then
    raise exception 'Choose a start date.' using errcode = '22023';
  end if;
  if requested_end < requested_start then
    raise exception 'The end date is before the start date.' using errcode = '22023';
  end if;
  perform private.set_acting_org(job.org_id);
  update public.jobs set scheduled_on = requested_start,
    scheduled_end_on = coalesce(requested_end, requested_start), updated_at = now()
  where id = requested_job;
  delete from public.pipeline_placements p
  using public.pipeline_stages s
  where p.record_id = requested_job and s.id = p.stage_id and s.record_status = 'scheduled';
end
$$;

create function public.get_job_schedule(range_start date, range_end date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see the schedule.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id, 'name', j.name, 'address', coalesce(j.formatted_address, j.address_line_1),
        'startOn', j.scheduled_on, 'endOn', coalesce(j.scheduled_end_on, j.scheduled_on),
        'status', j.status, 'valueCents', j.contract_amount_cents,
        'stageName', s.name,
        'crew', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.full_name) order by e.full_name)
          from public.job_assignments a join public.employees e on e.id = a.employee_id
          where a.job_id = j.id and a.status = 'active'), '[]'::jsonb))
        order by j.scheduled_on, j.name)
      from public.jobs j
      left join public.pipeline_stages s on s.id = private.current_pipeline_stage(j.id)
      where j.org_id = company and j.archived_at is null and j.is_feed_visible is not false
        and j.status in ('scheduled', 'active', 'completed')
        and j.scheduled_on <= range_end and coalesce(j.scheduled_end_on, j.scheduled_on) >= range_start
    ), '[]'::jsonb),
    'pending', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id, 'name', j.name, 'proposalName', q.name, 'valueCents', j.contract_amount_cents,
        'acceptedAt', coalesce(q.accepted_at, j.created_at)) order by coalesce(q.accepted_at, j.created_at) desc)
      from public.jobs j
      left join public.quotes q on q.id = j.accepted_quote_id
      where j.org_id = company and j.archived_at is null and j.is_feed_visible is not false
        and j.status = 'scheduled' and j.scheduled_on is null
    ), '[]'::jsonb),
    'crew', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', coalesce(e.full_name, e.email)) order by e.full_name)
      from public.org_members m join public.employees e on e.id = m.user_id
      where m.org_id = company and m.is_active
    ), '[]'::jsonb));
end
$$;

-- Sales metrics for a date range, the way DripJobs defines them: sales and
-- jobs won from accepted proposals, closing ratio over proposals sent, set
-- rate as new leads that reached an estimate.
create function public.get_sales_metrics(range_start date, range_end date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  zone text;
  from_ts timestamptz;
  to_ts timestamptz;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see metrics.' using errcode = '42501';
  end if;
  select timezone into zone from public.organizations where id = company;
  from_ts := range_start::timestamp at time zone zone;
  to_ts := (range_end + 1)::timestamp at time zone zone;

  return (
    with won as (
      select q.amount_cents, l.source
      from public.quotes q join public.leads l on l.id = q.lead_id
      where q.org_id = company and q.status = 'accepted'
        and coalesce(q.signed_at, q.accepted_at) >= from_ts and coalesce(q.signed_at, q.accepted_at) < to_ts
    ), sent as (
      select count(*) as n from public.quotes q
      where q.org_id = company and q.status in ('sent', 'accepted', 'declined', 'expired')
        and coalesce(q.sent_at, q.created_at) >= from_ts and coalesce(q.sent_at, q.created_at) < to_ts
    ), new_leads as (
      select l.id, l.source,
        l.status in ('estimate_scheduled', 'estimated', 'proposal_sent', 'won')
          or l.estimate_appointment_on is not null
          or exists (select 1 from public.appointments a where a.project_id = l.id) as booked
      from public.leads l
      where l.org_id = company and l.created_at >= from_ts and l.created_at < to_ts
    )
    select jsonb_build_object(
      'salesCents', (select coalesce(sum(amount_cents), 0) from won),
      'jobsWon', (select count(*) from won),
      'proposalsSent', (select n from sent),
      'leads', (select count(*) from new_leads),
      'booked', (select count(*) from new_leads where booked),
      'appointments', (select count(*) from public.appointments a
        where a.org_id = company and a.status <> 'cancelled' and a.starts_at >= from_ts and a.starts_at < to_ts),
      'bySource', coalesce((
        select jsonb_agg(jsonb_build_object('source', src, 'leads', leads, 'booked', booked, 'jobsWon', jobs_won,
          'salesCents', sales) order by sales desc, leads desc)
        from (
          select src, sum(leads) as leads, sum(booked) as booked, sum(jobs_won) as jobs_won, sum(sales) as sales
          from (
            select coalesce(nullif(btrim(source), ''), 'No source'), count(*),
              count(*) filter (where booked), 0::bigint, 0::bigint
            from new_leads group by 1
            union all
            select coalesce(nullif(btrim(source), ''), 'No source'), 0, 0, count(*), sum(amount_cents)
            from won group by 1
          ) parts(src, leads, booked, jobs_won, sales)
          group by src
        ) totals
      ), '[]'::jsonb)
    ));
end
$$;

create function public.get_report(requested_kind text, range_start date, range_end date)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  zone text;
  from_ts timestamptz;
  to_ts timestamptz;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can run reports.' using errcode = '42501';
  end if;
  select timezone into zone from public.organizations where id = company;
  from_ts := range_start::timestamp at time zone zone;
  to_ts := (range_end + 1)::timestamp at time zone zone;

  if requested_kind = 'leads' then
    return coalesce((select jsonb_agg(jsonb_build_object(
        'Date', to_char(l.created_at at time zone zone, 'YYYY-MM-DD'), 'Customer', c.name, 'Email', c.email,
        'Phone', c.phone, 'Source', l.source, 'Status', l.status, 'Stage', s.name) order by l.created_at desc)
      from public.leads l
      left join public.contacts c on c.id = l.contact_id
      left join public.pipeline_stages s on s.id = private.current_pipeline_stage(l.id)
      where l.org_id = company and l.created_at >= from_ts and l.created_at < to_ts), '[]'::jsonb);
  elsif requested_kind = 'closed_deals' then
    return coalesce((select jsonb_agg(jsonb_build_object(
        'Date', to_char(coalesce(q.signed_at, q.accepted_at) at time zone zone, 'YYYY-MM-DD'), 'Customer', c.name,
        'Proposal', q.name, 'Amount', round(q.amount_cents / 100.0, 2), 'Source', l.source)
        order by coalesce(q.signed_at, q.accepted_at) desc)
      from public.quotes q
      join public.leads l on l.id = q.lead_id
      left join public.contacts c on c.id = l.contact_id
      where q.org_id = company and q.status = 'accepted'
        and coalesce(q.signed_at, q.accepted_at) >= from_ts and coalesce(q.signed_at, q.accepted_at) < to_ts), '[]'::jsonb);
  elsif requested_kind = 'sales' then
    return coalesce((select jsonb_agg(row_data order by (row_data ->> 'Sales')::numeric desc)
      from (
        select jsonb_build_object('Source', coalesce(nullif(btrim(l.source), ''), 'No source'),
          'Jobs won', count(*), 'Sales', round(sum(q.amount_cents) / 100.0, 2),
          'Average job', round(avg(q.amount_cents) / 100.0, 2)) as row_data
        from public.quotes q join public.leads l on l.id = q.lead_id
        where q.org_id = company and q.status = 'accepted'
          and coalesce(q.signed_at, q.accepted_at) >= from_ts and coalesce(q.signed_at, q.accepted_at) < to_ts
        group by coalesce(nullif(btrim(l.source), ''), 'No source')) grouped), '[]'::jsonb);
  elsif requested_kind = 'production' then
    return coalesce((select jsonb_agg(jsonb_build_object(
        'Completed', j.completed_on, 'Job', j.name, 'Started', j.started_on,
        'Amount', round(j.contract_amount_cents / 100.0, 2)) order by j.completed_on desc)
      from public.jobs j
      where j.org_id = company and j.status = 'completed'
        and j.completed_on between range_start and range_end), '[]'::jsonb);
  elsif requested_kind = 'proposals_sent' then
    return coalesce((select jsonb_agg(jsonb_build_object(
        'Sent', to_char(coalesce(q.sent_at, q.created_at) at time zone zone, 'YYYY-MM-DD'), 'Customer', c.name,
        'Proposal', q.name, 'Status', q.status, 'Amount', round(q.amount_cents / 100.0, 2))
        order by coalesce(q.sent_at, q.created_at) desc)
      from public.quotes q
      join public.leads l on l.id = q.lead_id
      left join public.contacts c on c.id = l.contact_id
      where q.org_id = company and q.status in ('sent', 'accepted', 'declined', 'expired')
        and coalesce(q.sent_at, q.created_at) >= from_ts and coalesce(q.sent_at, q.created_at) < to_ts), '[]'::jsonb);
  end if;
  raise exception 'Unknown report.' using errcode = '22023';
end
$$;

-- Per job: contract (with accepted change orders), invoiced, paid, and crew
-- wages from clocked hours at each person's pay rate. Materials are not
-- tracked here, so profit is after labour only.
create function public.get_job_costing()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see job costing.' using errcode = '42501';
  end if;
  return coalesce((
    with work as (
      select (w ->> 'projectId')::uuid as job_id, (w ->> 'hours')::numeric as hours,
        (w ->> 'wages')::numeric as wages, (w ->> 'unpricedHours')::numeric as unpriced
      from jsonb_array_elements(public.get_job_work_summary(now()) -> 'rows') w
    )
    select jsonb_agg(jsonb_build_object(
      'id', j.id, 'name', j.name, 'status', j.status, 'stageName', s.name,
      'startedOn', j.started_on, 'completedOn', j.completed_on,
      'revenueCents', j.contract_amount_cents,
      'invoicedCents', coalesce(inv.invoiced, 0), 'paidCents', coalesce(inv.paid, 0),
      'hours', round(coalesce(w.hours, 0), 2), 'labourCents', round(coalesce(w.wages, 0) * 100),
      'unpricedHours', round(coalesce(w.unpriced, 0), 2))
      order by coalesce(j.completed_on, j.started_on, j.created_at::date) desc)
    from public.jobs j
    left join work w on w.job_id = j.id
    left join public.pipeline_stages s on s.id = private.current_pipeline_stage(j.id)
    left join lateral (
      select sum(i.amount_cents) as invoiced,
        sum((select coalesce(sum(p.amount_cents), 0) from public.invoice_payments p where p.invoice_id = i.id)) as paid
      from public.invoices i where i.job_id = j.id and i.status <> 'void'
    ) inv on true
    where j.org_id = company and j.archived_at is null and j.is_feed_visible is not false
      and j.status in ('scheduled', 'active', 'completed')
  ), '[]'::jsonb);
end
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'schedule_job(uuid, date, date)',
    'get_job_schedule(date, date)',
    'get_sales_metrics(date, date)',
    'get_report(text, date, date)',
    'get_job_costing()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
