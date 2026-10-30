-- The public estimate request form was removed, so a lead from outside
-- (DripJobs, the lead-intake webhook, the customer portal) is just a new lead.
-- Card payments taken online announce themselves with their own notification
-- (kind 'payment'), so the payment trigger leaves those alone.
begin;

create or replace function private.notify_new_lead()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  lead public.leads%rowtype;
  customer text;
begin
  begin
    select * into lead from public.leads where id = new.id;
    -- Staff-added leads, imports by staff and old records arriving late tell nobody.
    if not found or auth.uid() is not null
        or coalesce(lead.metadata ->> 'created_by', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-'
        or coalesce(lead.created_at, lead.captured_at, now()) < now() - interval '2 days' then
      return null;
    end if;
    select nullif(btrim(c.name), '') into customer from public.contacts c where c.id = lead.contact_id;
    perform private.notify_record(lead.org_id, lead.id, 'new_lead',
      'New lead' || coalesce(': ' || customer, ''),
      nullif(concat_ws(' · ', nullif(btrim(lead.source), ''), nullif(btrim(lead.address), '')), ''),
      '/deals/' || lead.id);
  exception when others then
    raise warning 'Lead notification failed for %: %', new.id, sqlerrm;
  end;
  return null;
end
$$;

create or replace function private.notify_invoice_payment()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
  customer text;
  paid bigint;
begin
  if to_jsonb(new) ->> 'source' = 'stripe' then
    return null;
  end if;
  begin
    select * into invoice from public.invoices where id = new.invoice_id;
    select nullif(btrim(c.name), '') into customer
    from public.jobs j join public.contacts c on c.id = j.contact_id
    where j.id = invoice.job_id;
    paid := (select coalesce(sum(amount_cents), 0) from public.invoice_payments where invoice_id = invoice.id);
    perform private.notify_record(invoice.org_id, invoice.job_id, 'invoice_paid',
      format('%s paid invoice #%s', coalesce(customer, 'The customer'), invoice.number),
      concat_ws(' · ',
        private.notification_money(new.amount_cents)
          || case when new.method = 'other' then '' else ' by ' || new.method end,
        case when paid >= invoice.amount_cents then 'Paid in full'
          else private.notification_money(invoice.amount_cents - paid) || ' still owing' end),
      format('/jobs/%s/invoices/%s', invoice.job_id, invoice.id));
  exception when others then
    raise warning 'Payment notification failed for %: %', new.id, sqlerrm;
  end;
  return null;
end
$$;

commit;
