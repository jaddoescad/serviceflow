create or replace function public.publish_project_calculator_default(
  requested_project_id text,
  calculator_doc jsonb,
  requested_quote_id text,
  task_payloads jsonb,
  requested_amount_including_tax numeric
)
returns table (
  labour_budget_id uuid,
  companycam_project_id text,
  source_quote_id text,
  source_quote_name text,
  source_quote_updated_at timestamptz,
  budgeted_hours numeric,
  task_count integer,
  revision integer,
  published_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if requested_amount_including_tax is null
    or requested_amount_including_tax < 0 then
    raise exception 'The calculator amount must be zero or greater'
      using errcode = '22023';
  end if;

  return query
  select published.*
  from public.publish_project_labour_budget(
    requested_project_id,
    calculator_doc,
    requested_quote_id,
    task_payloads
  ) published;

  update public.project_budgets budget
  set amount_including_tax = round(requested_amount_including_tax, 2),
      updated_by = auth.uid()
  where budget.companycam_project_id = requested_project_id;

  if not found then
    raise exception 'The calculator job budget was not created'
      using errcode = 'P0002';
  end if;
end;
$$;

comment on function public.publish_project_calculator_default(text, jsonb, text, jsonb, numeric) is
  'Atomically publishes the selected calculator as the painter default and synchronizes its HST-inclusive client total to the job amount.';

revoke all on function public.publish_project_calculator_default(text, jsonb, text, jsonb, numeric)
  from public;
grant execute on function public.publish_project_calculator_default(text, jsonb, text, jsonb, numeric)
  to authenticated;
