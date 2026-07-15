alter table public.project_budgets
  add column if not exists amount_including_tax numeric(12, 2)
  check (amount_including_tax is null or amount_including_tax >= 0);

comment on column public.project_budgets.amount_including_tax is
  'Original customer invoice amount in CAD, including 13% HST, used to calculate budgeted_hours.';
