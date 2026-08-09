-- Freeze historical job accounting so later receipt/invoice searches cannot
-- rewrite work that was already reconciled. Invoices may still be archived;
-- only their attachment to locked jobs is prohibited.

create or replace function public.is_historical_job_accounting_locked(
  p_job_id uuid
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select
      job.started_on < date '2026-06-01'
      or (
        job.started_on is null
        and job.completed_on < date '2026-06-01'
      )
      or (
        job.started_on is null
        and job.completed_on is null
        and job.status in ('completed', 'archived')
      )
    from public.jobs as job
    where job.id = p_job_id
  ), false);
$$;

comment on function public.is_historical_job_accounting_locked(uuid) is
  'Returns true when job-linked accounting is frozen by the June 1, 2026 historical cutoff.';

create or replace function public.guard_historical_job_accounting_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_job_id uuid;
  new_job_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_job_id := old.job_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_job_id := new.job_id;
  end if;

  if (
    old_job_id is not null
    and public.is_historical_job_accounting_locked(old_job_id)
  ) or (
    new_job_id is not null
    and public.is_historical_job_accounting_locked(new_job_id)
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Historical job accounting is locked before 2026-06-01.',
      detail = format(
        'Table %I rejected %s for locked job %s.',
        tg_table_name,
        tg_op,
        coalesce(new_job_id, old_job_id)
      ),
      hint = 'Archive new evidence without a job allocation, or explicitly request a narrow unlock for the named job.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.guard_historical_job_accounting_write() is
  'Rejects inserts, updates, reversals, reassignment, and deletion of accounting rows tied to historical jobs.';

drop trigger if exists guard_historical_job_invoice_allocations
  on public.invoice_job_allocations;
create trigger guard_historical_job_invoice_allocations
before insert or update or delete on public.invoice_job_allocations
for each row execute function public.guard_historical_job_accounting_write();

drop trigger if exists guard_historical_job_budgets
  on public.job_budgets;
create trigger guard_historical_job_budgets
before insert or update or delete on public.job_budgets
for each row execute function public.guard_historical_job_accounting_write();

drop trigger if exists guard_historical_job_direct_transactions
  on public.transaction_allocations;
create trigger guard_historical_job_direct_transactions
before insert or update or delete on public.transaction_allocations
for each row execute function public.guard_historical_job_accounting_write();
