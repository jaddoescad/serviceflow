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
), costing_allocations as (
  select allocation.*
  from usable_allocations allocation
  join public.invoices invoice on invoice.id = allocation.invoice_id
  where invoice.status not in ('not_invoice', 'overhead_unmatched', 'supporting_document')
    and not (
      invoice.category = 'labour'
      and invoice.source_system = 'direct_labour_expense'
      and exists (
        select 1
        from usable_allocations archived_allocation
        join public.invoices archived_invoice
          on archived_invoice.id = archived_allocation.invoice_id
        where archived_allocation.job_id = allocation.job_id
          and archived_invoice.category = 'labour'
          and archived_invoice.source_system <> 'direct_labour_expense'
          and archived_invoice.status not in (
            'not_invoice', 'overhead_unmatched', 'supporting_document'
          )
      )
    )
)
select
  job.id as job_id,
  job.contract_amount_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'receivable'
  ), 0)::bigint as receivable_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'payable'
      and invoice.category = 'labour'
  ), 0)::bigint as labour_cost_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'payable'
      and invoice.category = 'material'
  ), 0)::bigint as material_cost_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'payable'
  ), 0)::bigint as total_cost_cents
from public.jobs job
left join costing_allocations allocation on allocation.job_id = job.id
left join public.invoices invoice on invoice.id = allocation.invoice_id
group by job.id, job.contract_amount_cents;

commit;
