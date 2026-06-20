alter table public.time_entries
  add column if not exists adjustment_history jsonb not null default '[]'::jsonb;
