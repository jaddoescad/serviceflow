-- Prevent source syncs and one-off repair scripts from changing the identity,
-- dates, value, or metadata of jobs covered by the historical accounting lock.
-- A timestamp-only update is harmless and remains allowed for idempotent upserts.

create or replace function public.guard_historical_job_row_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  new_is_historical boolean;
begin
  if tg_op in ('INSERT', 'UPDATE') then
    new_is_historical :=
      new.started_on < date '2026-06-01'
      or (
        new.started_on is null
        and new.completed_on < date '2026-06-01'
      )
      or (
        new.started_on is null
        and new.completed_on is null
        and new.status in ('completed', 'archived')
      );
  end if;

  if tg_op = 'INSERT' and new_is_historical then
    raise exception using
      errcode = 'P0001',
      message = 'Creating historical jobs is locked before 2026-06-01.',
      detail = format('Rejected INSERT for job %s.', new.id),
      hint = 'Only jobs on or after the cutoff may be created without an explicit, named historical unlock.';
  end if;

  if tg_op = 'DELETE' and public.is_historical_job_accounting_locked(old.id) then
    raise exception using
      errcode = 'P0001',
      message = 'Historical job records are locked before 2026-06-01.',
      detail = format('Rejected DELETE for job %s.', old.id),
      hint = 'Do not delete historical jobs.';
  end if;

  if tg_op = 'UPDATE' then
    if public.is_historical_job_accounting_locked(old.id) then
      if (to_jsonb(new) - 'updated_at') is distinct from
         (to_jsonb(old) - 'updated_at') then
        raise exception using
          errcode = 'P0001',
          message = 'Historical job records are locked before 2026-06-01.',
          detail = format('Rejected substantive UPDATE for job %s.', old.id),
          hint = 'Do not change historical job identity, dates, values, status, visibility, or metadata.';
      end if;
    elsif new_is_historical then
      raise exception using
        errcode = 'P0001',
        message = 'Moving a job behind the historical cutoff is locked.',
        detail = format('Rejected UPDATE for job %s.', old.id),
        hint = 'A current job cannot be converted into a locked historical job without an explicit, named repair.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.guard_historical_job_row_write() is
  'Freezes substantive job-row changes for the June 1, 2026 historical cutoff.';

drop trigger if exists guard_historical_job_rows on public.jobs;
create trigger guard_historical_job_rows
before insert or update or delete on public.jobs
for each row execute function public.guard_historical_job_row_write();
