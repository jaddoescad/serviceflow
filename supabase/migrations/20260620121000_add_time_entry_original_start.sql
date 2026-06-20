alter table public.time_entries
  add column if not exists original_started_at timestamptz,
  add column if not exists start_edited_at timestamptz;

update public.time_entries
set original_started_at = started_at
where original_started_at is null;
