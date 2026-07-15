-- Admin timesheet review: mark entries approved for payroll by an admin/manager.
-- Editing/approving other people's entries is done by the service-role
-- `admin-time-entries` edge function (RLS blocks non-service callers from
-- updating rows they don't own).

alter table public.time_entries
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null;

comment on column public.time_entries.approved_at is 'When an admin/manager approved this entry for payroll.';
comment on column public.time_entries.approved_by is 'Admin/manager (auth.users.id) who approved the entry.';
