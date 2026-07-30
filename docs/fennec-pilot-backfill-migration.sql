-- Exact Fennec/Bilal pilot backfill.
-- Preserves invoice #1's printed $3,690 total and its $3,705 listed shifts.

begin;

do $$
declare
  invoice_count integer;
  time_count integer;
begin
  select count(*)
  into invoice_count
  from public.labour_invoices
  where id in (
    '78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid,
    'af699bde-0989-4108-9430-8f083ebbf0c5'::uuid
  )
    and supplier_name = 'Fennec Contracting';

  if invoice_count <> 2 then
    raise exception 'Expected both Fennec pilot invoices';
  end if;

  select count(*)
  into time_count
  from public.time_entries
  where id in (
    'db290d29-ff99-40b5-8488-d3737924067d'::uuid,
    'eeceb8a6-ecb6-4931-ac77-289f4e1781ac'::uuid,
    'c8d3fb40-c593-4e33-8532-ffa73657e128'::uuid,
    '83cd0e19-18d4-4667-9d37-40df54b40d38'::uuid,
    'b033ed6a-2376-4490-8ede-d3ea13579f6e'::uuid,
    '6d71b526-30fd-4a33-8117-52117df8a590'::uuid,
    '334b1be8-e42a-4311-b9c4-8af3b1de47b9'::uuid,
    '4808210f-8c4f-4915-9a2b-b939895b1af7'::uuid,
    'a72a2447-cb9f-43d7-8ff5-fd6d88941068'::uuid,
    '720d920c-4035-427d-941a-228dcdcdb5bf'::uuid,
    'fc9ec543-9b7b-4a82-8c81-50283109e45e'::uuid,
    '86078a2d-bfe6-4a7c-ab3f-49759a70e278'::uuid,
    'cc4f1224-a09a-465b-afd8-04dcc825e146'::uuid,
    '1b55c189-3bd6-4d40-89e6-3d48ac112471'::uuid,
    '9d4e345b-42fd-48b8-bc81-9830ac17ec19'::uuid,
    '0491340a-b2ca-4b05-94a8-9b5430486eac'::uuid,
    'a18e3d45-3aac-45d6-a0e2-26f19878101f'::uuid,
    '7b763e84-b498-4076-9558-6daf595d5ac8'::uuid,
    'd3423525-8ff1-4a4d-a588-4c82b93b8d2d'::uuid
  );

  if time_count <> 19 then
    raise exception 'Expected all 19 Fennec pilot time entries; found %', time_count;
  end if;
end
$$;

update public.labour_contractors
set worker_user_id = 'b0ef9587-2448-4cad-8b8c-61300106ecee'::uuid
where lower(trim(supplier_name)) = 'fennec contracting'
  and worker_user_id is null;

insert into public.labour_invoice_lines (
  invoice_id,
  line_number,
  description,
  service_started_on,
  service_ended_on,
  quantity_hours,
  hourly_rate,
  amount_before_tax,
  source_kind,
  source_text
)
values
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 1,
    '25 Bearbrook Rd — Wednesday, June 24',
    '2026-06-24', '2026-06-24', 5, 30, 150,
    'extracted', 'Wednesday, Jun 24. (5 hrs)'
  ),
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 2,
    '25 Bearbrook Rd — Thursday, June 25',
    '2026-06-25', '2026-06-25', 6.25, 30, 187.50,
    'extracted', 'Thursday, Jun 25 (6hrs 15min)'
  ),
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 3,
    '25 Bearbrook Rd — Friday, June 26',
    '2026-06-26', '2026-06-26', 9, 30, 270,
    'extracted', 'Friday, Jun 26 (9h)'
  ),
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 4,
    '1313 Turner Crescent — Monday, June 29',
    '2026-06-29', '2026-06-29', 9, 30, 270,
    'extracted', 'Monday, June 29 (9hrs)'
  ),
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 5,
    '1313 Turner Crescent — Tuesday, June 30',
    '2026-06-30', '2026-06-30', 7, 30, 210,
    'extracted', 'Tuesday, June 20 (7h); interpreted as June 30 from sequence'
  ),
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 6,
    '2033 Scully Way — Thursday, July 2',
    '2026-07-02', '2026-07-02', 9, 30, 270,
    'extracted', 'Thursday, July 2 (9h)'
  ),
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 7,
    '2033 Scully Way — Friday, July 3',
    '2026-07-03', '2026-07-03', 9.25, 30, 277.50,
    'extracted', 'Friday, July 3 (9h 15min)'
  ),
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 8,
    'Diane Benoit — Monday, July 6',
    '2026-07-06', '2026-07-06', 9, 30, 270,
    'extracted', 'Monday, July 6 (9h)'
  ),
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 9,
    'Diane Benoit — Tuesday, July 7',
    '2026-07-07', '2026-07-07', 9, 30, 270,
    'extracted', 'Tuesday, July 7 (9h)'
  ),
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 10,
    'Phil Anido — Wednesday, July 8',
    '2026-07-08', '2026-07-08', 9, 30, 270,
    'extracted', 'Wednesday, July 8 (9h)'
  ),
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 11,
    'Daniel Leung — Thursday, July 9',
    '2026-07-09', '2026-07-09', 9, 30, 270,
    'extracted', 'Thursday, July 9 (9h)'
  ),
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 12,
    'Phil Anido — Friday, July 10',
    '2026-07-10', '2026-07-10', 9, 30, 270,
    'extracted', 'Friday, July 10 (9h)'
  ),
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 13,
    'Daniel Leung — Saturday, July 11',
    '2026-07-11', '2026-07-11', 8, 30, 240,
    'extracted', 'Saturday, July 11 (8h)'
  ),
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 14,
    'Sally Bidal — Monday, July 13',
    '2026-07-13', '2026-07-13', 7, 30, 210,
    'extracted', 'Monday, July 13 (7h)'
  ),
  (
    '78da62ba-8904-49aa-92a9-46f695be4d8c', 15,
    'Sally Bidal — Tuesday, July 14',
    '2026-07-14', '2026-07-14', 9, 30, 270,
    'extracted', 'Tuesday, July 14 (9h)'
  ),
  (
    'af699bde-0989-4108-9430-8f083ebbf0c5', 1,
    'Sally Bidal — Wednesday, July 15',
    '2026-07-15', '2026-07-15', 10.75, 30, 322.50,
    'extracted', 'Wednesday, July 15 (10h45min)'
  ),
  (
    'af699bde-0989-4108-9430-8f083ebbf0c5', 2,
    'Phil Anido — Thursday, July 16',
    '2026-07-16', '2026-07-16', 8, 30, 240,
    'extracted', 'Thursday, July 16 (8h)'
  ),
  (
    'af699bde-0989-4108-9430-8f083ebbf0c5', 3,
    'Anjou Delplancke — Friday, July 17',
    '2026-07-17', '2026-07-17', 7, 30, 210,
    'extracted', 'Friday, July 17 (7h)'
  ),
  (
    'af699bde-0989-4108-9430-8f083ebbf0c5', 4,
    'Sue Deluney — Tuesday, July 28',
    '2026-07-28', '2026-07-28', 8.75, 30, 262.50,
    'extracted', 'Tuesday, July 28 (8h 45min)'
  )
on conflict (invoice_id, line_number) do nothing;

with allocation_source (
  invoice_id,
  line_number,
  companycam_project_id,
  allocated_amount,
  allocated_hours
) as (
  values
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 1, '99920990', 150.00, 5.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 2, '99920990', 187.50, 6.2500),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 3, '99920990', 270.00, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 4, '106938970', 270.00, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 5, '106938970', 210.00, 7.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 6, '96770884', 270.00, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 7, '96770884', 277.50, 9.2500),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 8, '108859223', 270.00, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 9, '108859223', 270.00, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 10, '106305548', 270.00, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 11, '106923203', 270.00, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 12, '106305548', 270.00, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 13, '106923203', 240.00, 8.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 14, '108379671', 210.00, 7.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 15, '108379671', 270.00, 9.0000),
    ('af699bde-0989-4108-9430-8f083ebbf0c5'::uuid, 1, '108379671', 322.50, 10.7500),
    ('af699bde-0989-4108-9430-8f083ebbf0c5'::uuid, 2, '106305548', 240.00, 8.0000),
    ('af699bde-0989-4108-9430-8f083ebbf0c5'::uuid, 3, '109570018', 210.00, 7.0000),
    ('af699bde-0989-4108-9430-8f083ebbf0c5'::uuid, 4, '99548034', 262.50, 8.7500)
)
insert into public.labour_invoice_line_allocations (
  invoice_line_id,
  companycam_project_id,
  allocated_amount,
  allocated_hours,
  allocation_method
)
select
  line.id,
  source.companycam_project_id,
  source.allocated_amount,
  source.allocated_hours,
  array['invoice_entry', 'job_name', 'service_date']::text[]
from allocation_source source
join public.labour_invoice_lines line
  on line.invoice_id = source.invoice_id
  and line.line_number = source.line_number
on conflict (invoice_line_id, companycam_project_id) do nothing;

with time_source (
  invoice_id,
  line_number,
  time_entry_id,
  allocated_hours
) as (
  values
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 1, 'db290d29-ff99-40b5-8488-d3737924067d'::uuid, 5.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 2, 'eeceb8a6-ecb6-4931-ac77-289f4e1781ac'::uuid, 6.2500),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 3, 'c8d3fb40-c593-4e33-8532-ffa73657e128'::uuid, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 4, '83cd0e19-18d4-4667-9d37-40df54b40d38'::uuid, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 5, 'b033ed6a-2376-4490-8ede-d3ea13579f6e'::uuid, 7.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 6, '6d71b526-30fd-4a33-8117-52117df8a590'::uuid, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 7, '334b1be8-e42a-4311-b9c4-8af3b1de47b9'::uuid, 9.2500),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 8, '4808210f-8c4f-4915-9a2b-b939895b1af7'::uuid, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 9, 'a72a2447-cb9f-43d7-8ff5-fd6d88941068'::uuid, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 10, '720d920c-4035-427d-941a-228dcdcdb5bf'::uuid, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 11, 'fc9ec543-9b7b-4a82-8c81-50283109e45e'::uuid, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 12, '86078a2d-bfe6-4a7c-ab3f-49759a70e278'::uuid, 9.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 13, 'cc4f1224-a09a-465b-afd8-04dcc825e146'::uuid, 8.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 14, '1b55c189-3bd6-4d40-89e6-3d48ac112471'::uuid, 7.0000),
    ('78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid, 15, '9d4e345b-42fd-48b8-bc81-9830ac17ec19'::uuid, 9.0000),
    ('af699bde-0989-4108-9430-8f083ebbf0c5'::uuid, 1, '0491340a-b2ca-4b05-94a8-9b5430486eac'::uuid, 10.6847),
    ('af699bde-0989-4108-9430-8f083ebbf0c5'::uuid, 2, 'a18e3d45-3aac-45d6-a0e2-26f19878101f'::uuid, 8.1088),
    ('af699bde-0989-4108-9430-8f083ebbf0c5'::uuid, 3, '7b763e84-b498-4076-9558-6daf595d5ac8'::uuid, 6.2238),
    ('af699bde-0989-4108-9430-8f083ebbf0c5'::uuid, 4, 'd3423525-8ff1-4a4d-a588-4c82b93b8d2d'::uuid, 8.7931)
)
insert into public.labour_invoice_line_time_entries (
  invoice_line_id,
  time_entry_id,
  allocated_hours,
  match_method
)
select
  line.id,
  source.time_entry_id,
  source.allocated_hours,
  array['worker', 'project', 'service_date']::text[]
from time_source source
join public.labour_invoice_lines line
  on line.invoice_id = source.invoice_id
  and line.line_number = source.line_number
on conflict (invoice_line_id, time_entry_id) do nothing;

do $$
declare
  line_count integer;
  job_count integer;
  time_count integer;
  test_line_id uuid;
  other_contractor_id uuid;
  invoice_one_payment text;
  invoice_one_verification text;
  invoice_two_payment text;
  invoice_two_verification text;
begin
  select count(*)
  into line_count
  from public.labour_invoice_lines
  where invoice_id in (
    '78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid,
    'af699bde-0989-4108-9430-8f083ebbf0c5'::uuid
  );

  select count(*)
  into job_count
  from public.labour_invoice_line_allocations allocation
  join public.labour_invoice_lines line on line.id = allocation.invoice_line_id
  where line.invoice_id in (
    '78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid,
    'af699bde-0989-4108-9430-8f083ebbf0c5'::uuid
  );

  select count(*)
  into time_count
  from public.labour_invoice_line_time_entries link
  join public.labour_invoice_lines line on line.id = link.invoice_line_id
  where line.invoice_id in (
    '78da62ba-8904-49aa-92a9-46f695be4d8c'::uuid,
    'af699bde-0989-4108-9430-8f083ebbf0c5'::uuid
  );

  if line_count <> 19 or job_count <> 19 or time_count <> 19 then
    raise exception
      'Unexpected Fennec pilot counts: % lines, % jobs, % time links',
      line_count,
      job_count,
      time_count;
  end if;

  -- Guard test 1: a fully allocated payment cannot pay an extra invoice cent.
  begin
    insert into public.labour_payment_allocations (
      financial_transaction_id,
      invoice_id,
      allocated_amount,
      match_method,
      notes
    )
    values (
      '446f0988-87f9-4c16-b2f2-df529aa18641',
      'af699bde-0989-4108-9430-8f083ebbf0c5',
      0.01,
      array['guard_test'],
      'This insert must be rejected.'
    );
    raise exception 'GUARD_TEST_FAILED: overallocated payment was accepted';
  exception
    when others then
      if sqlerrm like 'GUARD_TEST_FAILED:%' then
        raise;
      end if;
      if sqlerrm not like
        'Payment allocations % exceed bank payment %' then
        raise;
      end if;
  end;

  -- Guard test 2: job allocations cannot exceed their invoice line.
  select id
  into test_line_id
  from public.labour_invoice_lines
  where invoice_id = '78da62ba-8904-49aa-92a9-46f695be4d8c'
    and line_number = 1;

  begin
    insert into public.labour_invoice_line_allocations (
      invoice_line_id,
      companycam_project_id,
      allocated_amount,
      allocation_method
    )
    values (
      test_line_id,
      '106938970',
      0.01,
      array['guard_test']
    );
    raise exception 'GUARD_TEST_FAILED: overallocated invoice line was accepted';
  exception
    when others then
      if sqlerrm like 'GUARD_TEST_FAILED:%' then
        raise;
      end if;
      if sqlerrm not like
        'Job allocations % exceed invoice line amount %' then
        raise;
      end if;
  end;

  -- Guard test 3: a completed shift cannot be used beyond its actual hours.
  begin
    insert into public.labour_invoice_line_time_entries (
      invoice_line_id,
      time_entry_id,
      allocated_hours,
      match_method
    )
    values (
      test_line_id,
      'd3423525-8ff1-4a4d-a588-4c82b93b8d2d',
      0.0010,
      array['guard_test']
    );
    raise exception 'GUARD_TEST_FAILED: duplicated shift hours were accepted';
  exception
    when others then
      if sqlerrm like 'GUARD_TEST_FAILED:%' then
        raise;
      end if;
      if sqlerrm not like
        'Allocated hours % exceed completed shift hours %' then
        raise;
      end if;
  end;

  -- Guard test 4: confirmed payment recipient must match its allocations.
  select id
  into other_contractor_id
  from public.labour_contractors
  where lower(trim(supplier_name)) <> 'fennec contracting'
  order by supplier_name
  limit 1;

  begin
    update public.labour_payment_records
    set contractor_id = other_contractor_id
    where financial_transaction_id =
      '446f0988-87f9-4c16-b2f2-df529aa18641';
    raise exception 'GUARD_TEST_FAILED: mismatched contractor was accepted';
  exception
    when others then
      if sqlerrm like 'GUARD_TEST_FAILED:%' then
        raise;
      end if;
      if sqlerrm <>
        'Payment recipient and allocated contractor do not match' then
        raise;
      end if;
  end;

  select payment_status, verification_status
  into invoice_one_payment, invoice_one_verification
  from public.labour_invoice_verification
  where invoice_id = '78da62ba-8904-49aa-92a9-46f695be4d8c';

  select payment_status, verification_status
  into invoice_two_payment, invoice_two_verification
  from public.labour_invoice_verification
  where invoice_id = 'af699bde-0989-4108-9430-8f083ebbf0c5';

  if invoice_one_payment <> 'paid'
    or invoice_one_verification <> 'needs_review'
    or invoice_two_payment <> 'unpaid'
    or invoice_two_verification <> 'needs_review' then
    raise exception
      'Unexpected pilot statuses: invoice 1 %/%, invoice 2 %/%',
      invoice_one_payment,
      invoice_one_verification,
      invoice_two_payment,
      invoice_two_verification;
  end if;
end
$$;

commit;
