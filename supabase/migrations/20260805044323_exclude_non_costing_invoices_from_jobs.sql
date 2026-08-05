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
      and invoice.status not in ('not_invoice', 'overhead_unmatched', 'supporting_document')
  ), 0)::bigint as receivable_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'payable'
      and invoice.category = 'labour'
      and invoice.status not in ('not_invoice', 'overhead_unmatched', 'supporting_document')
  ), 0)::bigint as labour_cost_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'payable'
      and invoice.category = 'material'
      and invoice.status not in ('not_invoice', 'overhead_unmatched', 'supporting_document')
  ), 0)::bigint as material_cost_cents,
  coalesce(sum(allocation.total_cents) filter (
    where invoice.direction = 'payable'
      and invoice.status not in ('not_invoice', 'overhead_unmatched', 'supporting_document')
  ), 0)::bigint as total_cost_cents
from public.jobs job
left join usable_allocations allocation on allocation.job_id = job.id
left join public.invoices invoice on invoice.id = allocation.invoice_id
group by job.id, job.contract_amount_cents;

commit;
