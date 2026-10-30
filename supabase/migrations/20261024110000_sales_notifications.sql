-- Tells the deal's salesperson or project manager (or the company's managers)
-- when a customer acts: opens, accepts or declines a proposal; accepts or
-- declines a change order; opens or pays an invoice; or asks for an estimate.
-- New leads from Zapier and other outside sources tell the managers too.
-- A failed notification never stops the customer's action.
begin;

create function private.notification_money(cents bigint)
returns text
language sql immutable set search_path = ''
as $$
  select case when cents < 0 then '-' else '' end
    || to_char(abs(coalesce(cents, 0)) / 100.0, 'FM$999,999,990.00')
$$;
revoke all on function private.notification_money(bigint) from public, anon, authenticated;

-- Proposals --------------------------------------------------------------

create function private.notify_proposal_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  customer text;
  link text := '/deals/' || new.lead_id || '?tab=proposals';
begin
  begin
    select nullif(btrim(c.name), '') into customer
    from public.leads l join public.contacts c on c.id = l.contact_id
    where l.id = new.lead_id;
    customer := coalesce(customer, 'The customer');
    if old.status = 'sent' and new.status = 'accepted' then
      perform private.notify_record(new.org_id, new.lead_id, 'proposal_accepted',
        format('%s accepted %s', customer, new.name),
        concat_ws(' · ', 'Signed by ' || nullif(btrim(new.signed_name), ''),
          private.notification_money(new.amount_cents)),
        link);
    elsif old.status = 'sent' and new.status = 'declined' then
      perform private.notify_record(new.org_id, new.lead_id, 'proposal_declined',
        format('%s declined %s', customer, new.name),
        coalesce('Reason: ' || nullif(btrim(new.decline_reason), ''), 'No reason given'),
        link);
    -- A signed-in user opening the customer link is staff previewing it.
    elsif old.viewed_at is null and new.viewed_at is not null and auth.uid() is null then
      perform private.notify_record(new.org_id, new.lead_id, 'proposal_viewed',
        format('%s viewed %s', customer, new.name),
        'Proposal · ' || private.notification_money(new.amount_cents),
        link);
    end if;
  exception when others then
    raise warning 'Proposal notification failed for %: %', new.id, sqlerrm;
  end;
  return null;
end
$$;
revoke all on function private.notify_proposal_activity() from public, anon, authenticated;

create trigger notify_customer_activity
after update of status, viewed_at on public.quotes
for each row
when ((old.status = 'sent' and new.status in ('accepted', 'declined'))
  or (old.viewed_at is null and new.viewed_at is not null))
execute function private.notify_proposal_activity();

-- Change orders ----------------------------------------------------------

create function private.notify_change_order_activity()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  customer text;
  link text := format('/jobs/%s/change-orders/%s', new.job_id, new.id);
begin
  begin
    select nullif(btrim(c.name), '') into customer
    from public.jobs j join public.contacts c on c.id = j.contact_id
    where j.id = new.job_id;
    customer := coalesce(customer, 'The customer');
    if new.status = 'accepted' then
      perform private.notify_record(new.org_id, new.job_id, 'change_order_accepted',
        format('%s accepted change order #%s', customer, new.number),
        concat_ws(' · ', new.name, private.notification_money(new.amount_cents),
          'signed by ' || nullif(btrim(new.signed_name), '')),
        link);
    else
      perform private.notify_record(new.org_id, new.job_id, 'change_order_declined',
        format('%s declined change order #%s', customer, new.number),
        concat_ws(' · ', new.name,
          coalesce('Reason: ' || nullif(btrim(new.decline_reason), ''), 'No reason given')),
        link);
    end if;
  exception when others then
    raise warning 'Change order notification failed for %: %', new.id, sqlerrm;
  end;
  return null;
end
$$;
revoke all on function private.notify_change_order_activity() from public, anon, authenticated;

create trigger notify_customer_activity
after update of status on public.change_orders
for each row
when (old.status = 'sent' and new.status in ('accepted', 'declined'))
execute function private.notify_change_order_activity();

-- Invoices ---------------------------------------------------------------

create function private.notify_invoice_viewed()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  customer text;
begin
  if auth.uid() is not null then
    return null;
  end if;
  begin
    select nullif(btrim(c.name), '') into customer
    from public.jobs j join public.contacts c on c.id = j.contact_id
    where j.id = new.job_id;
    perform private.notify_record(new.org_id, new.job_id, 'invoice_viewed',
      format('%s viewed invoice #%s', coalesce(customer, 'The customer'), new.number),
      concat_ws(' · ', new.name, private.notification_money(new.amount_cents)),
      format('/jobs/%s/invoices/%s', new.job_id, new.id));
  exception when others then
    raise warning 'Invoice notification failed for %: %', new.id, sqlerrm;
  end;
  return null;
end
$$;
revoke all on function private.notify_invoice_viewed() from public, anon, authenticated;

create trigger notify_customer_activity
after update of viewed_at on public.invoices
for each row
when (old.viewed_at is null and new.viewed_at is not null)
execute function private.notify_invoice_viewed();

create function private.notify_invoice_payment()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  invoice public.invoices%rowtype;
  customer text;
  paid bigint;
begin
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
revoke all on function private.notify_invoice_payment() from public, anon, authenticated;

create trigger notify_payment_recorded
after insert on public.invoice_payments
for each row execute function private.notify_invoice_payment();

-- New leads --------------------------------------------------------------

-- Runs at commit so the customer, the request message and any assignment
-- written after the lead are there. Leads staff add themselves and old
-- records arriving through an import tell nobody.
create function private.notify_new_lead()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  lead public.leads%rowtype;
  customer text;
  details text;
  from_form boolean;
begin
  begin
    select * into lead from public.leads where id = new.id;
    if not found then
      return null;
    end if;
    from_form := coalesce(lead.source = 'Website Request'
      or lead.metadata ->> 'created_by' = 'website_request', false);
    if not from_form and (auth.uid() is not null
        or coalesce(lead.metadata ->> 'created_by', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-'
        or coalesce(lead.created_at, lead.captured_at, now()) < now() - interval '2 days') then
      return null;
    end if;
    select nullif(btrim(c.name), '') into customer from public.contacts c where c.id = lead.contact_id;
    if from_form then
      select nullif(btrim(regexp_replace(n.body, '^Request:\s*', '')), '') into details
      from public.project_notes n where n.project_id = lead.id
      order by n.created_at limit 1;
      perform private.notify_record(lead.org_id, lead.id, 'estimate_request',
        'New estimate request' || coalesce(' from ' || customer, ''),
        coalesce(details, nullif(btrim(lead.address), '')),
        '/deals/' || lead.id);
    else
      perform private.notify_record(lead.org_id, lead.id, 'new_lead',
        'New lead' || coalesce(': ' || customer, ''),
        nullif(concat_ws(' · ', nullif(btrim(lead.source), ''), nullif(btrim(lead.address), '')), ''),
        '/deals/' || lead.id);
    end if;
  exception when others then
    raise warning 'Lead notification failed for %: %', new.id, sqlerrm;
  end;
  return null;
end
$$;
revoke all on function private.notify_new_lead() from public, anon, authenticated;

create constraint trigger notify_new_lead
after insert on public.leads
deferrable initially deferred
for each row execute function private.notify_new_lead();

-- Reading and clearing -----------------------------------------------------

-- Newest first. Pass the last row's createdAt and id to get the next page.
create function public.get_my_notifications(
  requested_limit integer default 30, requested_before timestamptz default null,
  requested_unread_only boolean default false, requested_before_id uuid default null)
returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'link', n.link,
      'recordId', n.record_id, 'createdAt', n.created_at, 'readAt', n.read_at)
    order by n.created_at desc, n.id desc), '[]'::jsonb)
  from (
    select * from public.notifications
    where user_id = auth.uid()
      and (requested_before is null or created_at < requested_before
        or (created_at = requested_before and id < requested_before_id))
      and (not coalesce(requested_unread_only, false) or read_at is null)
    order by created_at desc, id desc
    limit least(greatest(coalesce(requested_limit, 30), 1), 100)
  ) n
$$;

create function public.get_my_unread_notification_count()
returns integer
language sql stable set search_path = ''
as $$
  select count(*)::integer from public.notifications where user_id = auth.uid() and read_at is null
$$;

-- No ids marks everything read. Returns what is still unread.
create function public.mark_notifications_read(requested_ids uuid[] default null)
returns integer
language plpgsql set search_path = ''
as $$
begin
  update public.notifications set read_at = now()
  where user_id = auth.uid() and read_at is null
    and (requested_ids is null or id = any(requested_ids));
  return public.get_my_unread_notification_count();
end
$$;

revoke all on function public.get_my_notifications(integer, timestamptz, boolean, uuid) from public, anon;
revoke all on function public.get_my_unread_notification_count() from public, anon;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.get_my_notifications(integer, timestamptz, boolean, uuid) to authenticated;
grant execute on function public.get_my_unread_notification_count() to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- The bell updates live; realtime applies the own_read policy per subscriber.
alter publication supabase_realtime add table public.notifications;

select pg_notify('pgrst', 'reload schema');

commit;
