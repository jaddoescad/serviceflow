-- A normal clock-out is terminal and first-write-wins. Background retries or
-- an older app build must not reopen the row or replace its end time. A person
-- may still make a deliberate correction because all supported edit paths add
-- an adjustment_history record in the same update.

create or replace function public.protect_time_entry_lifecycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  old_history_length integer := case
    when jsonb_typeof(old.adjustment_history) = 'array'
      then jsonb_array_length(old.adjustment_history)
    else 0
  end;
  new_history_length integer := case
    when jsonb_typeof(new.adjustment_history) = 'array'
      then jsonb_array_length(new.adjustment_history)
    else 0
  end;
  lifecycle_changed boolean;
  caller_jwt_role text := coalesce(
    auth.role(),
    nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role'
  );
begin
  if old.status <> 'complete' or old.ended_at is null then
    return new;
  end if;

  lifecycle_changed :=
    new.status is distinct from old.status
    or new.ended_at is distinct from old.ended_at;

  -- Ordinary employee clients never need to reopen a completed shift. Keep
  -- that operation service-only even when a stale client happens to carry a
  -- longer adjustment history. The admin edge function uses service_role and
  -- records the audited correction before intentionally reopening a row.
  if lifecycle_changed
    and (new.status <> 'complete' or new.ended_at is null)
    and caller_jwt_role is distinct from 'service_role' then
    raise exception
      'Only the administrative service may reopen a completed time entry'
      using errcode = '23514';
  end if;

  if lifecycle_changed and new_history_length <= old_history_length then
    raise exception
      'Completed time entries require an audited adjustment before changing the clock-out state'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_time_entry_lifecycle on public.time_entries;
create trigger protect_time_entry_lifecycle
before update on public.time_entries
for each row execute function public.protect_time_entry_lifecycle();

drop trigger if exists set_time_entries_updated_at on public.time_entries;
create trigger set_time_entries_updated_at
before update on public.time_entries
for each row execute function public.set_updated_at();

comment on function public.protect_time_entry_lifecycle() is
  'Prevents background retries from reopening or extending a completed shift unless the update adds adjustment history.';
