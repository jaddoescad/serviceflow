do $$
declare
  danielle_project_id text;
  anas_user_id uuid;
begin
  select companycam_id
  into strict danielle_project_id
  from public.companycam_projects
  where lower(btrim(name)) = 'danielle hards';

  select user_id
  into strict anas_user_id
  from public.employee_profiles
  where lower(btrim(email)) = 'aouf0002@algonquinlive.com';

  insert into public.project_labour_expenses (
    companycam_project_id,
    worker_user_id,
    worker_name,
    supplier_name,
    invoice_number,
    invoice_date,
    amount_before_tax,
    tax_amount,
    notes
  )
  values (
    danielle_project_id,
    anas_user_id,
    'Anas Aouf',
    'Abdellah Aouf',
    'INV-20260615-001',
    date '2026-06-15',
    104.00,
    0.00,
    'Historical fixed-price labour invoice for Danielle Hards; no HST charged.'
  )
  on conflict (companycam_project_id, supplier_name, invoice_number)
  do update set
    worker_user_id = excluded.worker_user_id,
    worker_name = excluded.worker_name,
    invoice_date = excluded.invoice_date,
    amount_before_tax = excluded.amount_before_tax,
    tax_amount = excluded.tax_amount,
    notes = excluded.notes;
end
$$;
