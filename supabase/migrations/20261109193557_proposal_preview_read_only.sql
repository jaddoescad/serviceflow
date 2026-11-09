-- The staff preview runs read-only (PostgREST calls stable functions in a
-- read-only transaction), so it must not create the customer's portal link
-- the way opening the customer's own link does. It shows the existing link.

create function private.proposal_document(found_quote public.quotes, create_portal boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  sums record;
  deposit bigint;
begin
  select * into sums from private.line_item_totals(found_quote.line_items, found_quote.tax_rate_percent,
    found_quote.discount_percent, found_quote.discount_cents);
  deposit := coalesce(found_quote.deposit_cents,
    round(sums.total_cents * coalesce(found_quote.deposit_percent, 0) / 100)::bigint);
  return (
    select jsonb_build_object(
      'kind', 'proposal',
      'name', found_quote.name, 'status', found_quote.status,
      'items', found_quote.line_items, 'taxRatePercent', found_quote.tax_rate_percent,
      'subtotalCents', sums.subtotal_cents, 'discountCents', sums.discount_cents,
      'taxCents', sums.tax_cents, 'totalCents', sums.total_cents,
      'discount', jsonb_build_object('percent', found_quote.discount_percent, 'cents', found_quote.discount_cents),
      'packages', found_quote.packages, 'selectedPackageId', found_quote.selected_package_id,
      'validUntil', found_quote.valid_until,
      'expired', found_quote.status = 'sent' and private.proposal_expired(found_quote.org_id, found_quote.valid_until),
      'depositPercent', found_quote.deposit_percent, 'depositCents', deposit,
      'intro', found_quote.intro, 'terms', found_quote.terms,
      'sentAt', found_quote.sent_at, 'signedName', found_quote.signed_name,
      'signedAt', found_quote.signed_at, 'signatureImage', found_quote.signature_image, 'declinedAt', found_quote.declined_at,
      'customer', jsonb_build_object('name', c.name, 'email', c.email, 'phone', c.phone,
        'address', l.address),
      'company', private.public_company(found_quote.org_id),
      'assets', private.public_assets(found_quote.id),
      'portalToken', case when create_portal then private.document_portal_token(c.id)
        else (select p.token from public.customer_portals p where p.contact_id = c.id) end,
      'depositPaid', coalesce((
        select bool_and(coalesce((select sum(p.amount_cents) from public.invoice_payments p where p.invoice_id = d.id), 0) >= d.amount_cents)
        from public.invoices d
        where d.source_quote_id = found_quote.id and d.kind = 'deposit' and d.status <> 'void'), false),
      'companyDocuments', case when found_quote.include_company_documents then coalesce((
        select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'path', d.storage_path,
          'mimeType', d.mime_type, 'byteSize', d.byte_size) order by d.name)
        from public.company_documents d where d.org_id = found_quote.org_id), '[]'::jsonb)
        else '[]'::jsonb end)
    from public.leads l
    join public.contacts c on c.id = l.contact_id
    where l.id = found_quote.lead_id);
end
$$;
revoke all on function private.proposal_document(public.quotes, boolean) from public, anon, authenticated;

create or replace function public.view_public_proposal(requested_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  found_quote public.quotes%rowtype;
begin
  if requested_token is null or char_length(requested_token) < 24 then
    return null;
  end if;
  select * into found_quote from public.quotes where public_token = requested_token;
  if not found then
    return null;
  end if;
  if found_quote.status = 'sent' and found_quote.viewed_at is null and not private.is_org_member(found_quote.org_id) then
    update public.quotes set viewed_at = now() where id = found_quote.id;
  end if;
  return private.proposal_document(found_quote, true);
end
$$;

create or replace function public.preview_proposal(requested_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  found_quote public.quotes%rowtype;
begin
  select * into found_quote from public.quotes where id = requested_id;
  if not found or not private.is_org_manager(found_quote.org_id) then
    return null;
  end if;
  return private.proposal_document(found_quote, false);
end
$$;

drop function private.proposal_document(public.quotes);
