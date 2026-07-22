-- A task timer is a breakdown of its parent whole-shift time entry. When an
-- administrator deletes the parent timesheet row, remove the linked task
-- breakdown as part of the same database transaction instead of orphaning it.
alter table public.project_labour_task_time_entries
  drop constraint if exists project_labour_task_time_entries_time_entry_id_fkey;

alter table public.project_labour_task_time_entries
  add constraint project_labour_task_time_entries_time_entry_id_fkey
  foreign key (time_entry_id)
  references public.time_entries(id)
  on delete cascade;
