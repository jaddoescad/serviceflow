begin;

set local lock_timeout = '15s';
set local statement_timeout = '5min';

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
), summarized as (
  select
    job.id as job_id,
    job.contract_amount_cents,
    coalesce(sum(allocation.subtotal_cents) filter (
      where invoice.direction = 'receivable'
    ), 0)::bigint as customer_invoiced_before_hst_cents,
    coalesce(sum(allocation.tax_cents) filter (
      where invoice.direction = 'receivable'
    ), 0)::bigint as customer_hst_cents,
    coalesce(sum(allocation.total_cents) filter (
      where invoice.direction = 'receivable'
    ), 0)::bigint as customer_invoiced_including_hst_cents,
    coalesce(sum(allocation.subtotal_cents) filter (
      where invoice.direction = 'payable'
        and invoice.category = 'labour'
    ), 0)::bigint as labour_cost_before_hst_cents,
    coalesce(sum(allocation.tax_cents) filter (
      where invoice.direction = 'payable'
        and invoice.category = 'labour'
    ), 0)::bigint as labour_hst_cents,
    coalesce(sum(allocation.total_cents) filter (
      where invoice.direction = 'payable'
        and invoice.category = 'labour'
    ), 0)::bigint as labour_cost_including_hst_cents,
    coalesce(sum(allocation.subtotal_cents) filter (
      where invoice.direction = 'payable'
        and invoice.category = 'material'
    ), 0)::bigint as material_cost_before_hst_cents,
    coalesce(sum(allocation.tax_cents) filter (
      where invoice.direction = 'payable'
        and invoice.category = 'material'
    ), 0)::bigint as material_hst_cents,
    coalesce(sum(allocation.total_cents) filter (
      where invoice.direction = 'payable'
        and invoice.category = 'material'
    ), 0)::bigint as material_cost_including_hst_cents,
    coalesce(sum(allocation.subtotal_cents) filter (
      where invoice.direction = 'payable'
        and invoice.category = 'other'
    ), 0)::bigint as other_direct_cost_before_hst_cents,
    coalesce(sum(allocation.tax_cents) filter (
      where invoice.direction = 'payable'
        and invoice.category = 'other'
    ), 0)::bigint as other_direct_hst_cents,
    coalesce(sum(allocation.total_cents) filter (
      where invoice.direction = 'payable'
        and invoice.category = 'other'
    ), 0)::bigint as other_direct_cost_including_hst_cents,
    coalesce(sum(allocation.subtotal_cents) filter (
      where invoice.direction = 'payable'
    ), 0)::bigint as direct_cost_before_hst_cents,
    coalesce(sum(allocation.tax_cents) filter (
      where invoice.direction = 'payable'
    ), 0)::bigint as input_hst_cents,
    coalesce(sum(allocation.total_cents) filter (
      where invoice.direction = 'payable'
    ), 0)::bigint as direct_cost_including_hst_cents
  from public.jobs job
  left join costing_allocations allocation on allocation.job_id = job.id
  left join public.invoices invoice on invoice.id = allocation.invoice_id
  group by job.id, job.contract_amount_cents
)
select
  summary.job_id,
  summary.contract_amount_cents,
  summary.customer_invoiced_including_hst_cents as receivable_cents,
  summary.labour_cost_including_hst_cents as labour_cost_cents,
  summary.material_cost_including_hst_cents as material_cost_cents,
  summary.direct_cost_including_hst_cents as total_cost_cents,
  summary.contract_amount_cents as contract_revenue_before_hst_cents,
  summary.customer_invoiced_before_hst_cents,
  summary.customer_hst_cents,
  summary.customer_invoiced_including_hst_cents,
  summary.labour_cost_before_hst_cents,
  summary.labour_hst_cents,
  summary.labour_cost_including_hst_cents,
  summary.material_cost_before_hst_cents,
  summary.material_hst_cents,
  summary.material_cost_including_hst_cents,
  summary.other_direct_cost_before_hst_cents,
  summary.other_direct_hst_cents,
  summary.other_direct_cost_including_hst_cents,
  summary.direct_cost_before_hst_cents,
  summary.input_hst_cents,
  summary.direct_cost_including_hst_cents,
  summary.customer_hst_cents - summary.input_hst_cents as net_hst_cents,
  case
    when summary.contract_amount_cents is null then null
    else summary.contract_amount_cents - summary.direct_cost_before_hst_cents
  end as gross_profit_cents,
  case
    when coalesce(summary.contract_amount_cents, 0) = 0 then null
    else round(
      100.0
      * (summary.contract_amount_cents - summary.direct_cost_before_hst_cents)
      / summary.contract_amount_cents,
      2
    )
  end as gross_margin_percent
from summarized summary;

comment on view public.job_financial_summary is
  'One row per job. Legacy cost columns are HST-inclusive for compatibility; use the explicitly named before-HST fields for gross profit and margin.';

comment on column public.job_financial_summary.contract_amount_cents is
  'Legacy DripJobs-authoritative contract revenue before HST.';
comment on column public.job_financial_summary.receivable_cents is
  'Legacy alias for customer_invoiced_including_hst_cents; this is invoiced value, not outstanding AR.';
comment on column public.job_financial_summary.labour_cost_cents is
  'Legacy HST-inclusive labour cost. Use labour_cost_before_hst_cents for profitability.';
comment on column public.job_financial_summary.material_cost_cents is
  'Legacy HST-inclusive material cost. Use material_cost_before_hst_cents for profitability.';
comment on column public.job_financial_summary.total_cost_cents is
  'Legacy HST-inclusive direct cost. Use direct_cost_before_hst_cents for profitability.';
comment on column public.job_financial_summary.contract_revenue_before_hst_cents is
  'DripJobs-authoritative job contract amount before HST.';
comment on column public.job_financial_summary.customer_invoiced_before_hst_cents is
  'Customer invoice allocations before HST; provided for invoice reconciliation, not as job amount authority.';
comment on column public.job_financial_summary.customer_hst_cents is
  'HST allocated from customer invoices.';
comment on column public.job_financial_summary.labour_cost_before_hst_cents is
  'Allocated direct labour invoice subtotal before HST.';
comment on column public.job_financial_summary.material_cost_before_hst_cents is
  'Allocated direct material invoice subtotal before HST.';
comment on column public.job_financial_summary.direct_cost_before_hst_cents is
  'All usable allocated payable invoice subtotals before HST.';
comment on column public.job_financial_summary.input_hst_cents is
  'HST recorded on usable allocated direct costs; recoverability must follow the applicable tax rules.';
comment on column public.job_financial_summary.net_hst_cents is
  'Allocated customer HST less HST recorded on usable allocated direct costs.';
comment on column public.job_financial_summary.gross_profit_cents is
  'Contract revenue before HST less allocated direct costs before HST; null when contract revenue is missing.';
comment on column public.job_financial_summary.gross_margin_percent is
  'Gross profit divided by contract revenue before HST, expressed as a percentage; null when contract revenue is missing or zero.';

revoke all on public.job_financial_summary from anon;
grant select on public.job_financial_summary to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
