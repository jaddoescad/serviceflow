-- Proposal controls: discount totals, packages, valid-until expiry, copying
-- and the customer's language. Runs on the Brightline demo company inside a
-- transaction that is rolled back; nothing is kept and no files are uploaded.
begin;
do $$
declare
  company uuid := '50e643e1-5c1e-40dd-93e8-d65743b3aa61';
  owner uuid := 'dee00000-0000-4000-8000-0000000000a1';
  customer uuid := gen_random_uuid();
  deal uuid := gen_random_uuid();
  proposal uuid := gen_random_uuid();
  expiring uuid := gen_random_uuid();
  copy uuid;
  token text;
  expiring_token text;
  signature text := 'data:image/png;base64,' || repeat('A', 300);
  sums record;
  doc jsonb;
  saved public.quotes%rowtype;
  items jsonb := jsonb_build_array(
    jsonb_build_object('id', 'base', 'name', 'Prep', 'quantity', 1, 'unitPriceCents', 50000),
    jsonb_build_object('id', 'good', 'name', 'One coat', 'quantity', 1, 'unitPriceCents', 100000, 'packageId', 'p-good'),
    jsonb_build_object('id', 'better', 'name', 'Two coats', 'quantity', 1, 'unitPriceCents', 150000, 'packageId', 'p-better'),
    jsonb_build_object('id', 'addon', 'name', 'Trim', 'quantity', 1, 'unitPriceCents', 20000, 'optional', true));
  package_list jsonb := '[{"id":"p-good","name":"Good"},{"id":"p-better","name":"Better","description":"Most popular"}]';
  today date := (now() at time zone 'America/Toronto')::date;
begin
  -- Same figures as web/scripts/line-items.test.mjs.
  select * into sums from private.line_item_totals(
    '[{"quantity":1,"unitPriceCents":150000,"optional":false,"selected":true},
      {"quantity":2,"unitPriceCents":25050,"optional":false,"selected":true},
      {"quantity":1,"unitPriceCents":40000,"optional":true,"selected":false}]', 13);
  if (sums.subtotal_cents, sums.tax_cents, sums.total_cents) <> (200100::bigint, 26013::bigint, 226113::bigint) then
    raise exception 'Totals without a discount changed: %', row_to_json(sums);
  end if;
  select * into sums from private.line_item_totals(
    '[{"quantity":1,"unitPriceCents":150000,"optional":false,"selected":true},
      {"quantity":2,"unitPriceCents":25050,"optional":false,"selected":true}]', 13, 10, null);
  if (sums.subtotal_cents, sums.discount_cents, sums.tax_cents, sums.total_cents)
    <> (200100::bigint, 20010::bigint, 23412::bigint, 203502::bigint) then
    raise exception 'Percent discount totals: %', row_to_json(sums);
  end if;
  select * into sums from private.line_item_totals(
    '[{"quantity":1,"unitPriceCents":150000,"optional":false,"selected":true},
      {"quantity":2,"unitPriceCents":25050,"optional":false,"selected":true}]', 13, null, 50000);
  if (sums.discount_cents, sums.tax_cents, sums.total_cents) <> (50000::bigint, 19513::bigint, 169613::bigint) then
    raise exception 'Amount discount totals: %', row_to_json(sums);
  end if;
  select * into sums from private.line_item_totals(
    '[{"quantity":1,"unitPriceCents":1000,"optional":false,"selected":true}]', 13, null, 5000);
  if (sums.discount_cents, sums.total_cents) <> (1000::bigint, 0::bigint) then
    raise exception 'A discount above the subtotal was not capped: %', row_to_json(sums);
  end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true);
  insert into public.contacts (id, kind, name, email, org_id)
  values (customer, 'customer', 'QA Proposal Controls', 'qa-proposal-controls@example.com', company);
  insert into public.leads (id, contact_id, status, created_at, captured_at, org_id)
  values (deal, customer, 'new', now(), now(), company);

  perform public.save_proposal(proposal, deal, 'Packages QA', items, 13, 25, null, '', '', null,
    package_list, 'p-better', 10, null, today + 5);
  select * into saved from public.quotes where id = proposal;
  -- Prep 500 + Better 1500 = 2000, less 10% = 1800, plus 13% tax.
  if saved.amount_cents <> 203400 or saved.selected_package_id <> 'p-better'
    or saved.valid_until <> today + 5 or jsonb_array_length(saved.packages) <> 2 then
    raise exception 'Saved proposal: % % %', saved.amount_cents, saved.selected_package_id, saved.valid_until;
  end if;
  if (select (i ->> 'selected')::boolean from jsonb_array_elements(saved.line_items) i where i ->> 'id' = 'good')
    or not (select (i ->> 'selected')::boolean and (i ->> 'optional')::boolean
      from jsonb_array_elements(saved.line_items) i where i ->> 'id' = 'better') then
    raise exception 'Package items not selected by package: %', saved.line_items;
  end if;
  begin
    perform public.save_proposal(proposal, deal, 'Bad', items, 13, null, null, '', '', null, '[]', null, 10, 100);
    raise exception 'Two discount kinds accepted';
  exception when invalid_parameter_value then null; end;

  token := public.send_proposal(proposal);
  doc := public.view_public_proposal(token);
  if (doc ->> 'totalCents')::bigint <> 203400 or (doc ->> 'discountCents')::bigint <> 20000
    or (doc ->> 'expired')::boolean or doc -> 'discount' ->> 'percent' <> '10'
    or doc ->> 'selectedPackageId' <> 'p-better' then
    raise exception 'Customer view: %', doc;
  end if;
  -- That was the owner previewing: not the customer's first view.
  if (select viewed_at from public.quotes where id = proposal) is not null then
    raise exception 'A staff preview marked the proposal viewed';
  end if;
  perform set_config('request.jwt.claims', '', true);
  perform public.view_public_proposal(token);
  if (select viewed_at from public.quotes where id = proposal) is null then
    raise exception 'The customer''s view was not recorded';
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true);

  begin
    perform public.accept_public_proposal(token, 'QA Customer', '{}', signature, 'p-missing');
    raise exception 'Accepted without a valid package';
  exception when invalid_parameter_value then null; end;
  perform public.accept_public_proposal(token, 'QA Customer', array['addon'], signature, 'p-good');
  select * into saved from public.quotes where id = proposal;
  -- Prep 500 + Good 1000 + Trim 200 = 1700, less 10% = 1530, plus 13% tax.
  if saved.status <> 'accepted' or saved.selected_package_id <> 'p-good' or saved.amount_cents <> 172890 then
    raise exception 'Accepted proposal: % % %', saved.status, saved.selected_package_id, saved.amount_cents;
  end if;
  if (select count(*) from jsonb_array_elements(saved.line_items) i
      where not (i ->> 'optional')::boolean or (i ->> 'selected')::boolean) <> 3 then
    raise exception 'Accepted lines: %', saved.line_items;
  end if;
  if (select contract_amount_cents from public.jobs where accepted_quote_id = proposal) <> 172890 then
    raise exception 'Job amount does not match the accepted total';
  end if;

  -- The page links to the customer's portal and says when the deposit is paid.
  doc := public.view_public_proposal(token);
  if doc ->> 'portalToken' is null or (doc ->> 'depositPaid')::boolean then
    raise exception 'Portal link or deposit state: %', doc;
  end if;
  update public.invoices set status = 'sent', public_token = private.new_public_token()
  where source_quote_id = proposal and kind = 'deposit';
  insert into public.invoice_payments (org_id, invoice_id, amount_cents, paid_on, method, reference, source)
  select org_id, id, amount_cents, current_date, 'e-transfer', 'QA-1', 'manual'
  from public.invoices where source_quote_id = proposal and kind = 'deposit';
  if not (public.view_public_proposal(token) ->> 'depositPaid')::boolean then
    raise exception 'Paid deposit not shown as paid';
  end if;
  doc := public.view_public_invoice((select public_token from public.invoices where source_quote_id = proposal and kind = 'deposit'));
  if doc ->> 'invoiceKind' <> 'deposit' or jsonb_array_length(doc -> 'payments') <> 1
    or doc -> 'payments' -> 0 ->> 'reference' <> 'QA-1'
    or doc ->> 'portalToken' <> public.view_public_proposal(token) ->> 'portalToken' then
    raise exception 'Invoice view: %', doc;
  end if;

  -- Copying keeps the lines, packages, discount and attachments as a new draft.
  insert into public.document_assets (document_kind, document_id, kind, name, storage_path, created_by)
  values ('proposal', proposal, 'file', 'Scope.pdf', company || '/qa-proposal-controls-scope.pdf', owner);
  copy := public.duplicate_proposal(proposal);
  select * into saved from public.quotes where id = copy;
  if saved.status <> 'draft' or saved.lead_id <> deal or saved.name <> 'Packages QA (copy)'
    or saved.packages <> (select packages from public.quotes where id = proposal)
    or saved.discount_percent <> 10 or saved.valid_until <> today + 30
    or (select count(*) from public.document_assets where document_id = copy
        and storage_path = company || '/qa-proposal-controls-scope.pdf') <> 1 then
    raise exception 'Copy: % % % %', saved.status, saved.name, saved.discount_percent, saved.valid_until;
  end if;

  -- After the valid-until date, approving is refused and the page says so.
  perform public.save_proposal(expiring, deal, 'Expiring QA', items, 13, null, null, '', '', null,
    '[]', null, null, null, today);
  expiring_token := public.send_proposal(expiring);
  update public.quotes set valid_until = today - 1 where id = expiring;
  if not (public.view_public_proposal(expiring_token) ->> 'expired')::boolean then
    raise exception 'Expired proposal not shown as expired';
  end if;
  begin
    perform public.accept_public_proposal(expiring_token, 'QA Customer', '{}', signature, null);
    raise exception 'Expired proposal accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.send_proposal(expiring);
    raise exception 'Sent with a past valid-until date';
  exception when invalid_parameter_value then null; end;
  perform public.save_proposal(expiring, deal, 'Expiring QA', items, 13, null, null, '', '', null,
    '[]', null, null, null, today + 7);
  if (public.view_public_proposal(expiring_token) ->> 'expired')::boolean then
    raise exception 'Extending the date did not reopen the proposal';
  end if;

  perform public.set_deal_customer_language(deal, 'fr');
  if public.view_public_document_language('proposal', token) is distinct from 'fr' then
    raise exception 'Customer language not returned';
  end if;
  begin
    perform public.set_deal_customer_language(deal, 'de');
    raise exception 'Unsupported language accepted';
  exception when invalid_parameter_value then null; end;
end
$$;
select 'proposal controls ok' as result;
rollback;
