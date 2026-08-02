-- Treat confirmed customer overpayment residuals as resolved evidence without
-- changing the physical invoice, its recorded payments, or the bank amount.

begin;

create or replace view public.customer_invoice_verification
with (security_invoker = true)
as
select
  invoice.id as customer_invoice_id,
  invoice.companycam_project_id,
  invoice.invoice_number,
  invoice.invoice_date,
  invoice.customer_name,
  invoice.currency,
  invoice.subtotal,
  invoice.tax_amount,
  invoice.total_amount,
  invoice.source_paid_amount,
  invoice.source_balance,
  invoice.source_status,
  coalesce(items.item_count, 0)::integer as item_count,
  coalesce(items.item_subtotal, 0)::numeric(14,2) as item_subtotal,
  coalesce(items.item_tax, 0)::numeric(14,2) as item_tax,
  coalesce(items.item_total, 0)::numeric(14,2) as item_total,
  (coalesce(items.item_total, 0) - invoice.total_amount)::numeric(14,2)
    as item_difference,
  coalesce(documents.document_count, 0)::integer as document_count,
  coalesce(payments.payment_event_count, 0)::integer as payment_event_count,
  coalesce(payments.payment_event_total, 0)::numeric(14,2)
    as payment_event_total,
  coalesce(bank.bank_payment_count, 0)::integer as bank_payment_count,
  coalesce(bank.invoice_paid_amount, 0)::numeric(14,2) as bank_paid_amount,
  (invoice.total_amount - coalesce(bank.invoice_paid_amount, 0))::numeric(14,2)
    as amount_remaining,
  case
    when coalesce(bank.invoice_paid_amount, 0)
      >= invoice.total_amount - 0.005 then 'paid'
    when coalesce(bank.invoice_paid_amount, 0) > 0 then 'partially_paid'
    else 'unpaid'
  end as bank_payment_status,
  case
    when coalesce(documents.document_count, 0) = 0 then 'needs_information'
    when abs(coalesce(items.item_total, 0) - invoice.total_amount) > 0.02
      then 'needs_review'
    when coalesce(bank.invoice_paid_amount, 0)
      + coalesce(overpayment.confirmed_overpayment_amount, 0)
      + 0.005 < invoice.source_paid_amount then 'needs_review'
    else 'verified'
  end as verification_status,
  coalesce(bank.bank_cash_amount, 0)::numeric(14,2) as bank_cash_amount,
  coalesce(bank.processing_fee_amount, 0)::numeric(14,2)
    as processing_fee_amount,
  coalesce(overpayment.confirmed_overpayment_amount, 0)::numeric(14,2)
    as confirmed_overpayment_amount
from public.customer_invoices invoice
left join lateral (
  select
    count(*) as item_count,
    sum(item.amount_before_tax) as item_subtotal,
    sum(item.tax_amount) as item_tax,
    sum(item.total_amount) as item_total
  from public.customer_invoice_items item
  where item.customer_invoice_id = invoice.id
) items on true
left join lateral (
  select count(*) as document_count
  from public.customer_invoice_documents document
  where document.customer_invoice_id = invoice.id
) documents on true
left join lateral (
  select
    count(*) as payment_event_count,
    sum(event.amount) as payment_event_total
  from public.customer_invoice_payment_events event
  where event.customer_invoice_id = invoice.id
) payments on true
left join lateral (
  select
    count(*) as bank_payment_count,
    sum(allocation.allocated_amount) as bank_cash_amount,
    sum(allocation.invoice_applied_amount) as invoice_paid_amount,
    sum(allocation.invoice_applied_amount - allocation.allocated_amount)
      as processing_fee_amount
  from public.customer_invoice_bank_allocations allocation
  where allocation.customer_invoice_id = invoice.id
    and allocation.reversed_at is null
) bank on true
left join lateral (
  select sum(
    greatest(transaction.amount - transaction_allocation.allocated_amount, 0)
  ) as confirmed_overpayment_amount
  from public.financial_transactions transaction
  join lateral (
    select
      sum(allocation.allocated_amount) as allocated_amount,
      count(distinct allocation.customer_invoice_id) as invoice_count,
      bool_or(allocation.customer_invoice_id = invoice.id) as includes_invoice
    from public.customer_invoice_bank_allocations allocation
    where allocation.financial_transaction_id = transaction.id
      and allocation.reversed_at is null
  ) transaction_allocation
    on transaction_allocation.invoice_count = 1
   and transaction_allocation.includes_invoice
  where transaction.source_data
      -> 'customer_revenue_exception' ->> 'status' = 'confirmed'
    and transaction.source_data
      -> 'customer_revenue_exception' ->> 'kind'
      in ('overpayment', 'rounding_overpayment')
) overpayment on true;

create or replace view public.accounting_reconciliation_exceptions
with (security_invoker = true)
as
with ranked_invoices as (
  select
    invoice.*,
    row_number() over (
      partition by coalesce(invoice.duplicate_group_id, invoice.id::text)
      order by
        coalesce(invoice.source_date, invoice.invoice_date) desc nulls last,
        coalesce(invoice.amount_paid, 0) desc,
        invoice.id desc
    ) as version_rank
  from public.labour_invoices invoice
  where invoice.document_type = 'invoice'
    and invoice.match_status <> 'supporting_document'
)
select
  'job:' || job.job_proposal_id as exception_key,
  'job'::text as exception_scope,
  job.job_proposal_id,
  job.companycam_project_id,
  'dripjobs_job'::text as source_type,
  job.job_proposal_id as source_id,
  null::numeric(14,2) as amount,
  array_to_string(job.review_reasons, ', ') as reason,
  'needs_review'::text as resolution_status
from public.job_accounting_reconciliation job
where cardinality(job.review_reasons) > 0

union all

select
  'bank-income:' || transaction.id,
  'bank_transaction',
  null,
  null,
  'financial_transaction',
  transaction.id::text,
  greatest(
    transaction.amount - coalesce(allocation.allocated_amount, 0),
    0
  )::numeric(14,2),
  'Customer bank income is not fully allocated to an invoice',
  'needs_review'
from public.financial_transactions transaction
left join lateral (
  select sum(allocation.allocated_amount) as allocated_amount
  from public.customer_invoice_bank_allocations allocation
  where allocation.financial_transaction_id = transaction.id
    and allocation.reversed_at is null
) allocation on true
where transaction.transaction_type = 'income'
  and not transaction.is_transfer
  and transaction.category = 'Painting revenue'
  and transaction.amount > coalesce(allocation.allocated_amount, 0) + 0.005
  and not (
    transaction.source_data
      -> 'customer_revenue_exception' ->> 'status' = 'confirmed'
    and coalesce(
      transaction.source_data
        -> 'customer_revenue_exception' ->> 'review',
      'false'
    ) <> 'true'
  )

union all

select
  'supplier-line:' || line.id,
  'supplier_invoice_line',
  null,
  null,
  'labour_invoice_line',
  line.id::text,
  line.amount_before_tax,
  'Supplier invoice line needs a documented job allocation',
  'needs_review'
from public.labour_invoice_lines line
join ranked_invoices invoice
  on invoice.id = line.invoice_id and invoice.version_rank = 1
left join public.labour_invoice_line_allocations allocation
  on allocation.invoice_line_id = line.id
where allocation.invoice_line_id is null
  and invoice.match_status <> 'overhead_unmatched'

union all

select
  'material-line:' || line.id,
  'material_invoice_line',
  null,
  null,
  'material_invoice_line',
  line.id::text,
  line.total_amount,
  'Material invoice line needs a job or general-supplies allocation',
  'needs_review'
from public.material_invoice_lines line
left join public.material_invoice_line_allocations allocation
  on allocation.material_invoice_line_id = line.id
 and allocation.reversed_at is null
where allocation.id is null;

comment on column public.customer_invoice_verification.confirmed_overpayment_amount
  is 'Confirmed bank residual above the invoice credit, preserved as an overpayment rather than an invoice mismatch.';

commit;
