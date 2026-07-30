-- Make settlement guards fire at the end of each statement, not transaction
-- commit, so invalid allocations can never appear temporarily.

begin;

drop trigger if exists validate_labour_payment_allocation_totals
  on public.labour_payment_allocations;
create trigger validate_labour_payment_allocation_totals
after insert or update or delete on public.labour_payment_allocations
for each row execute function public.validate_labour_allocation_totals();

drop trigger if exists validate_labour_bonus_payment_allocation_totals
  on public.labour_bonus_payment_allocations;
create trigger validate_labour_bonus_payment_allocation_totals
after insert or update or delete on public.labour_bonus_payment_allocations
for each row execute function public.validate_labour_allocation_totals();

drop trigger if exists validate_labour_other_payment_allocation_totals
  on public.labour_payment_other_allocations;
create trigger validate_labour_other_payment_allocation_totals
after insert or update or delete on public.labour_payment_other_allocations
for each row execute function public.validate_labour_allocation_totals();

drop trigger if exists validate_labour_invoice_line_job_total
  on public.labour_invoice_line_allocations;
create trigger validate_labour_invoice_line_job_total
after insert or update or delete on public.labour_invoice_line_allocations
for each row execute function public.validate_labour_invoice_line_job_total();

drop trigger if exists validate_line_existing_job_allocations
  on public.labour_invoice_lines;
create trigger validate_line_existing_job_allocations
after update of amount_before_tax on public.labour_invoice_lines
for each row execute function public.validate_line_existing_job_allocations();

drop trigger if exists validate_labour_time_entry_allocation
  on public.labour_invoice_line_time_entries;
create trigger validate_labour_time_entry_allocation
after insert or update or delete on public.labour_invoice_line_time_entries
for each row execute function public.validate_labour_time_entry_allocation();

drop trigger if exists validate_time_entry_existing_allocations
  on public.time_entries;
create trigger validate_time_entry_existing_allocations
after update of user_id, started_at, ended_at on public.time_entries
for each row execute function public.validate_time_entry_existing_allocations();

drop trigger if exists validate_invoice_existing_payments
  on public.labour_invoices;
create trigger validate_invoice_existing_payments
after update of amount_paid, amount_before_tax, tax_amount, contractor_id, currency
on public.labour_invoices
for each row execute function public.validate_invoice_existing_payments();

drop trigger if exists validate_payment_existing_allocations
  on public.financial_transactions;
create trigger validate_payment_existing_allocations
after update of amount, currency, transaction_type, is_transfer
on public.financial_transactions
for each row execute function public.validate_payment_existing_allocations();

drop trigger if exists validate_payment_record_contractor
  on public.labour_payment_records;
create trigger validate_payment_record_contractor
after insert or update on public.labour_payment_records
for each row execute function public.validate_payment_record_contractor();

commit;
