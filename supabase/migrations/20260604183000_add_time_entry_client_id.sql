alter table public.time_entries
  add column if not exists client_entry_id text;

create unique index if not exists time_entries_client_entry_id_key
  on public.time_entries (client_entry_id);
