-- Proposals imported from DripJobs (or anywhere else) are ordinary
-- ServiceFlow proposals: an unsent one can be deleted and any can be copied.
-- Accepted proposals stay locked by save_proposal.

create or replace function public.delete_proposal(requested_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  existing public.quotes%rowtype;
begin
  select * into existing from public.quotes where id = requested_id for update;
  if not found then
    return;
  end if;
  if not private.is_org_manager(existing.org_id) then
    raise exception 'Only managers can delete proposals.' using errcode = '42501';
  end if;
  if existing.status <> 'draft' then
    raise exception 'Only unsent proposals can be deleted.' using errcode = '22023';
  end if;
  perform private.set_acting_org(existing.org_id);
  delete from public.quotes where id = requested_id;
end
$function$;

create or replace function public.duplicate_proposal(requested_id uuid, requested_lead uuid default null::uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  source_quote public.quotes%rowtype;
  target_lead public.leads%rowtype;
  copy_id uuid := gen_random_uuid();
  sums record;
begin
  select * into source_quote from public.quotes where id = requested_id;
  if not found then
    raise exception 'Proposal not found.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(source_quote.org_id) then
    raise exception 'Only managers can copy proposals.' using errcode = '42501';
  end if;
  select * into target_lead from public.leads
  where id = coalesce(requested_lead, source_quote.lead_id) for update;
  if not found or target_lead.org_id <> source_quote.org_id then
    raise exception 'Deal not found.' using errcode = 'P0002';
  end if;
  perform private.set_acting_org(source_quote.org_id);
  select * into sums from private.line_item_totals(source_quote.line_items, source_quote.tax_rate_percent,
    source_quote.discount_percent, source_quote.discount_cents);

  insert into public.quotes (
    id, lead_id, name, status, amount_cents, tax_cents, source, line_items, tax_rate_percent,
    deposit_percent, deposit_cents, intro, terms, template_id, include_company_documents,
    packages, selected_package_id, discount_percent, discount_cents, valid_until,
    metadata, created_at, updated_at)
  values (
    copy_id, target_lead.id,
    left(case when target_lead.id = source_quote.lead_id then source_quote.name || ' (copy)' else source_quote.name end, 120),
    'draft', sums.total_cents, sums.tax_cents, 'proposal', source_quote.line_items,
    source_quote.tax_rate_percent, source_quote.deposit_percent, source_quote.deposit_cents,
    source_quote.intro, source_quote.terms, source_quote.template_id, source_quote.include_company_documents,
    source_quote.packages, source_quote.selected_package_id, source_quote.discount_percent,
    source_quote.discount_cents,
    case when source_quote.valid_until is null then null
      else (now() at time zone coalesce(
        (select nullif(o.timezone, '') from public.organizations o where o.id = source_quote.org_id),
        'America/Toronto'))::date + 30 end,
    jsonb_build_object('created_by', auth.uid(), 'copied_from', source_quote.id), now(), now());

  insert into public.document_assets (
    document_kind, document_id, kind, name, storage_path, mime_type, byte_size, position, created_by)
  select 'proposal', copy_id, a.kind, a.name, a.storage_path, a.mime_type, a.byte_size, a.position, a.created_by
  from public.document_assets a
  where a.document_kind = 'proposal' and a.document_id = source_quote.id;

  if target_lead.status in ('new', 'contacted', 'estimate_scheduled') then
    update public.leads set status = 'estimated', updated_at = now() where id = target_lead.id;
  end if;
  return copy_id;
end
$function$;
