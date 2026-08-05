begin;

create or replace view public.job_financial_summary
with (security_invoker = true)
as
with active_allocations as (
  select allocation.*
  from public.invoice_job_allocations allocation
  where nullif(allocation.metadata ->> 'reversed_at', '') is null
), usable_allocations as (
  select allocation.*
  from active_allocations allocation
  where allocation.invoice_line_id is not null
     or not exists (
       select 1
       from active_allocations line_allocation
       where line_allocation.invoice_id = allocation.invoice_id
         and line_allocation.job_id = allocation.job_id
         and line_allocation.invoice_line_id is not null
     )
)
select
  job.id as job_id,
  job.contract_amount_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'receivable'
      and invoice.status <> 'supporting_document'
  ), 0)::bigint as receivable_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'payable'
      and invoice.category = 'labour'
      and invoice.status <> 'supporting_document'
  ), 0)::bigint as labour_cost_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'payable'
      and invoice.category = 'material'
      and invoice.status <> 'supporting_document'
  ), 0)::bigint as material_cost_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'payable'
      and invoice.status <> 'supporting_document'
  ), 0)::bigint as total_cost_cents
from public.jobs job
left join usable_allocations allocation on allocation.job_id = job.id
left join public.invoices invoice on invoice.id = allocation.invoice_id
group by job.id, job.contract_amount_cents;

-- Editing a job amount or publishing a calculator must not silently reopen a
-- labour-closed budget or erase fields supplied by the other workflow.
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

  select * into current_budget
  from public.job_budgets budget
  where budget.job_id = requested_job_id
    and budget.source = 'manual'
  order by budget.version desc
  limit 1
  for update;

  if found then
    update public.job_budgets budget
    set
      budget_minutes = coalesce(requested_budget_minutes, budget.budget_minutes),
      hourly_rate_cents = coalesce(requested_hourly_rate_cents, budget.hourly_rate_cents),
      amount_including_tax_cents = coalesce(
        requested_amount_including_tax_cents,
        budget.amount_including_tax_cents
      ),
      notes = coalesce(requested_notes, budget.notes),
      updated_at = now()
    where budget.id = current_budget.id
    returning * into result;
  else
    select * into previous_budget
    from public.job_budgets budget
    where budget.job_id = requested_job_id
      and budget.source = 'project_budget'
      and budget.status in ('active', 'closed')
    order by budget.updated_at desc, budget.version desc
    limit 1;

    select coalesce(max(budget.version), 0) + 1 into next_version
    from public.job_budgets budget
    where budget.job_id = requested_job_id
      and budget.source = 'manual';

    insert into public.job_budgets (
      id, job_id, quote_id, version, status, budget_minutes,
      hourly_rate_cents, amount_including_tax_cents, notes,
      closed_at, closed_by, source, metadata, created_at, updated_at
    )
    select
      extensions.gen_random_uuid(),
      job.id,
      job.accepted_quote_id,
      next_version,
      coalesce(previous_budget.status, 'active'),
      coalesce(requested_budget_minutes, previous_budget.budget_minutes),
      coalesce(requested_hourly_rate_cents, previous_budget.hourly_rate_cents),
      coalesce(
        requested_amount_including_tax_cents,
        previous_budget.amount_including_tax_cents
      ),
      coalesce(requested_notes, previous_budget.notes),
      previous_budget.closed_at,
      previous_budget.closed_by,
      'manual',
      jsonb_build_object('copied_from_budget_id', previous_budget.id),
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

-- Operational completion and labour-finalization happen together when an
-- admin uses the existing Mark job completed/Reopen labour control. Imported
-- DripJobs completion alone does not retroactively finalize labour costing.
create or replace function public.set_job_status(
  requested_job_id uuid,
  requested_status text
)
returns public.jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_budget public.job_budgets%rowtype;
  result public.jobs%rowtype;
  next_version integer;
begin
  if not private.is_manager() then raise exception 'Manager access required'; end if;
  if requested_status not in ('scheduled', 'active', 'completed', 'cancelled', 'archived') then
    raise exception 'Invalid job status';
  end if;

  update public.jobs
  set
    status = requested_status,
    completed_on = case
      when requested_status = 'completed' then coalesce(completed_on, current_date)
      else completed_on
    end,
    archived_at = case
      when requested_status = 'archived' then coalesce(archived_at, now())
      else archived_at
    end,
    updated_at = now()
  where id = requested_job_id
  returning * into result;

  if not found then raise exception 'Job not found'; end if;

  if requested_status in ('active', 'completed') then
    select * into current_budget
    from public.job_budgets budget
    where budget.job_id = requested_job_id
      and budget.source in ('manual', 'project_budget')
      and budget.status in ('active', 'closed')
    order by
      budget.updated_at desc,
      (budget.source = 'manual') desc,
      budget.version desc
    limit 1
    for update;

    if found then
      update public.job_budgets budget
      set
        status = case when requested_status = 'completed' then 'closed' else 'active' end,
        closed_at = case
          when requested_status = 'completed' then coalesce(budget.closed_at, now())
          else null
        end,
        closed_by = case
          when requested_status = 'completed' then coalesce(budget.closed_by, auth.uid())
          else null
        end,
        updated_at = now()
      where budget.id = current_budget.id;
    else
      select coalesce(max(budget.version), 0) + 1 into next_version
      from public.job_budgets budget
      where budget.job_id = requested_job_id
        and budget.source = 'manual';

      insert into public.job_budgets (
        id, job_id, quote_id, version, status,
        amount_including_tax_cents, closed_at, closed_by,
        source, metadata, created_at, updated_at
      ) values (
        extensions.gen_random_uuid(),
        result.id,
        result.accepted_quote_id,
        next_version,
        case when requested_status = 'completed' then 'closed' else 'active' end,
        nullif(result.contract_amount_cents, 0),
        case when requested_status = 'completed' then now() else null end,
        case when requested_status = 'completed' then auth.uid() else null end,
        'manual',
        jsonb_build_object('created_by', 'set_job_status'),
        now(),
        now()
      );
    end if;
  end if;

  return result;
end
$$;

commit;
