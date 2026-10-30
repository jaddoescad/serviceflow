-- Online card payments through each company's own Stripe account. A customer
-- pays an invoice's balance, or an accepted proposal's deposit invoice, on
-- Stripe Checkout; Stripe's signed webhook then records the payment like a
-- manual one (method 'card', the payment intent as its reference). The Stripe
-- keys never leave the database except to the server's checkout and webhook
-- routes, which call in with the service role. Jobs locked by the June 1, 2026
-- accounting cutoff take no online payments, and a payment that arrives for
-- one is left unrecorded for staff to review in Stripe.
begin;

create table private.org_stripe (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  secret_key text check (secret_key ~ '^(sk|rk)_(test|live)_[A-Za-z0-9]{16,}$'),
  webhook_secret text check (webhook_secret ~ '^whsec_[A-Za-z0-9+/=]{16,}$'),
  accept_cards boolean not null default false,
  card_fee_percent numeric(4,2) not null default 0 check (card_fee_percent between 0 and 10),
  updated_at timestamptz not null default now(),
  check (not accept_cards or (secret_key is not null and webhook_secret is not null))
);
revoke all on private.org_stripe from public, anon, authenticated;

-- Stripe events already handled, so a redelivered event records nothing twice.
create table private.stripe_events (
  event_id text primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete set null,
  outcome text not null
    check (outcome in ('pending', 'recorded', 'already_recorded', 'void', 'locked', 'not_found', 'invalid')),
  received_at timestamptz not null default now()
);
revoke all on private.stripe_events from public, anon, authenticated;

-- An online payment keeps the card fee the customer paid on top; the fee is
-- not part of the invoice.
alter table public.invoice_payments
  add column source text not null default 'manual' check (source in ('manual', 'stripe')),
  add column fee_cents bigint not null default 0 check (fee_cents >= 0);
create unique index invoice_payments_stripe_reference_idx
  on public.invoice_payments (org_id, reference) where source = 'stripe';

-- The one place a payment is added to an invoice, manual or online.
create function private.apply_invoice_payment(
  target public.invoices, amount bigint, received_on date, payment_method text,
  payment_reference text, payment_note text, payment_source text default 'manual',
  card_fee bigint default 0)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  payment_id uuid := gen_random_uuid();
begin
  insert into public.invoice_payments (
    id, org_id, invoice_id, amount_cents, paid_on, method, reference, note, source, fee_cents)
  values (payment_id, target.org_id, target.id, amount, coalesce(received_on, current_date), payment_method,
    nullif(btrim(payment_reference), ''), nullif(btrim(payment_note), ''), payment_source,
    greatest(coalesce(card_fee, 0), 0));
  -- Recording a payment means the customer has the invoice.
  if target.status = 'draft' then
    update public.invoices set status = 'sent', sent_at = coalesce(sent_at, now()),
      public_token = coalesce(public_token, private.new_public_token()), updated_at = now()
    where id = target.id;
  else
    update public.invoices set updated_at = now() where id = target.id;
  end if;
  return payment_id;
end
$$;
revoke all on function private.apply_invoice_payment(public.invoices, bigint, date, text, text, text, text, bigint)
  from public, anon, authenticated;

create or replace function public.record_invoice_payment(
  requested_invoice uuid, requested_amount_cents bigint, requested_paid_on date,
  requested_method text, requested_reference text default '', requested_note text default '')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.invoices%rowtype := private.invoice_for_manager(requested_invoice);
  paid bigint := (select coalesce(sum(amount_cents), 0) from public.invoice_payments where invoice_id = requested_invoice);
begin
  if existing.status = 'void' then
    raise exception 'Void invoices can''t take payments.' using errcode = '22023';
  end if;
  if requested_amount_cents is null or requested_amount_cents <= 0 then
    raise exception 'Enter the amount received.' using errcode = '22023';
  end if;
  if paid + requested_amount_cents > existing.amount_cents then
    raise exception 'That is more than the % still owing.',
      to_char((existing.amount_cents - paid) / 100.0, 'FM$999,999,990.00') using errcode = '22023';
  end if;
  return private.apply_invoice_payment(existing, requested_amount_cents, requested_paid_on,
    requested_method, requested_reference, requested_note);
end
$$;

-- Settings ---------------------------------------------------------------

create function public.get_payment_settings(requested_org uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := coalesce(requested_org, private.home_org_id());
  settings private.org_stripe%rowtype;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see payment settings.' using errcode = '42501';
  end if;
  select * into settings from private.org_stripe where org_id = company;
  return jsonb_build_object(
    'orgId', company,
    'canEdit', coalesce(private.org_role(company) in ('owner', 'admin'), false),
    'keyConnected', settings.secret_key is not null,
    'keyEnding', right(settings.secret_key, 4),
    'testMode', coalesce(settings.secret_key like '%\_test\_%', false),
    'webhookConnected', settings.webhook_secret is not null,
    'webhookEnding', right(settings.webhook_secret, 4),
    'acceptCards', coalesce(settings.accept_cards, false),
    'cardFeePercent', coalesce(settings.card_fee_percent, 0));
end
$$;

-- A null key keeps the saved one; an empty one removes it. Changing where
-- customers' money goes is for owners and admins only.
create function public.save_payment_settings(
  requested_secret_key text, requested_webhook_secret text,
  requested_accept_cards boolean, requested_card_fee_percent numeric)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  saved private.org_stripe%rowtype;
  new_key text := btrim(requested_secret_key);
  new_webhook text := btrim(requested_webhook_secret);
begin
  if company is null or coalesce(private.org_role(company) not in ('owner', 'admin'), true) then
    raise exception 'Only owners and admins can change payment settings.' using errcode = '42501';
  end if;
  if new_key like 'pk\_%' then
    raise exception 'That is the publishable key. Paste the secret key (sk_…) or a restricted key (rk_…).'
      using errcode = '22023';
  end if;
  if new_key <> '' and new_key !~ '^(sk|rk)_(test|live)_[A-Za-z0-9]{16,}$' then
    raise exception 'That doesn''t look like a Stripe secret key (sk_live_… or rk_live_…).' using errcode = '22023';
  end if;
  if new_webhook <> '' and new_webhook !~ '^whsec_[A-Za-z0-9+/=]{16,}$' then
    raise exception 'The webhook signing secret starts with whsec_.' using errcode = '22023';
  end if;
  if requested_card_fee_percent is null or requested_card_fee_percent < 0 or requested_card_fee_percent > 10 then
    raise exception 'The card fee must be between 0%% and 10%%.' using errcode = '22023';
  end if;
  select * into saved from private.org_stripe where org_id = company for update;
  new_key := case when new_key is null then saved.secret_key else nullif(new_key, '') end;
  new_webhook := case when new_webhook is null then saved.webhook_secret else nullif(new_webhook, '') end;
  if requested_accept_cards and (new_key is null or new_webhook is null) then
    raise exception 'Add the Stripe secret key and webhook signing secret before accepting cards.'
      using errcode = '22023';
  end if;
  insert into private.org_stripe as s (org_id, secret_key, webhook_secret, accept_cards, card_fee_percent)
  values (company, new_key, new_webhook, coalesce(requested_accept_cards, false),
    round(requested_card_fee_percent, 2))
  on conflict (org_id) do update set
    secret_key = excluded.secret_key,
    webhook_secret = excluded.webhook_secret,
    accept_cards = excluded.accept_cards,
    card_fee_percent = excluded.card_fee_percent,
    updated_at = now();
end
$$;

-- What a customer link pays --------------------------------------------

-- The invoice behind a customer link: a sent invoice's own token, or an
-- accepted proposal's deposit invoice (which may still be a draft).
create function private.payable_invoice(requested_token text)
returns public.invoices
language sql stable security definer set search_path = ''
as $$
  select i.* from public.invoices i
  where char_length(requested_token) >= 24
    and ((i.public_token = requested_token and i.status <> 'draft')
      or i.id = (
        select d.id from public.quotes q
        join public.invoices d on d.source_quote_id = q.id and d.kind = 'deposit'
        where q.public_token = requested_token and q.status = 'accepted'
        order by d.created_at limit 1))
  limit 1
$$;
revoke all on function private.payable_invoice(text) from public, anon, authenticated;

-- The balance a card payment would settle, the fee on top, or why it can't be paid.
create function private.payment_offer(target public.invoices, fee_percent numeric)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  paid bigint := (select coalesce(sum(amount_cents), 0) from public.invoice_payments where invoice_id = target.id);
  balance bigint := greatest(target.amount_cents - paid, 0);
  fee bigint := round(balance * coalesce(fee_percent, 0) / 100)::bigint;
  reason text := case
    when target.status = 'void' then 'void'
    when balance = 0 then 'paid'
    when public.is_historical_job_accounting_locked(target.job_id) then 'locked'
  end;
begin
  return jsonb_build_object(
    'payable', reason is null, 'reason', reason,
    'invoiceNumber', target.number, 'invoiceName', target.name, 'invoiceKind', target.kind,
    'balanceCents', balance, 'paidCents', paid,
    'feePercent', coalesce(fee_percent, 0),
    'feeCents', case when reason is null then fee else 0 end,
    'chargeCents', case when reason is null then balance + fee else 0 end);
end
$$;
revoke all on function private.payment_offer(public.invoices, numeric) from public, anon, authenticated;

-- For the customer's Pay button: null when the company doesn't take cards.
create function public.get_public_payment_options(requested_token text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  target public.invoices%rowtype;
  fee_percent numeric;
begin
  if requested_token is null or char_length(requested_token) < 24 then
    return null;
  end if;
  select * into target from private.payable_invoice(requested_token);
  if target.id is null then
    return null;
  end if;
  select s.card_fee_percent into fee_percent from private.org_stripe s
  where s.org_id = target.org_id and s.accept_cards;
  if not found then
    return null;
  end if;
  return private.payment_offer(target, fee_percent);
end
$$;

-- Server routes (service role) -------------------------------------------

-- Everything the checkout route needs, including the company's secret key.
create function public.stripe_checkout_context(requested_token text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  target public.invoices%rowtype;
  settings private.org_stripe%rowtype;
begin
  if requested_token is null or char_length(requested_token) < 24 then
    return null;
  end if;
  select * into target from private.payable_invoice(requested_token);
  if target.id is null then
    return null;
  end if;
  select * into settings from private.org_stripe where org_id = target.org_id;
  if not coalesce(settings.accept_cards, false) then
    return jsonb_build_object('payable', false, 'reason', 'off');
  end if;
  return private.payment_offer(target, settings.card_fee_percent) || (
    select jsonb_build_object(
      'orgId', target.org_id, 'invoiceId', target.id, 'jobId', target.job_id,
      'returnPath', case when target.public_token = requested_token then '/i/' else '/p/' end || requested_token,
      'secretKey', settings.secret_key,
      'companyName', o.name,
      'customerEmail', nullif(btrim(c.email), ''))
    from public.jobs j
    join public.organizations o on o.id = j.org_id
    left join public.contacts c on c.id = j.contact_id
    where j.id = target.job_id);
end
$$;

create function public.stripe_webhook_secret(requested_org uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select webhook_secret from private.org_stripe where org_id = requested_org
$$;

-- Records a paid Checkout Session once per event and once per payment intent,
-- and tells the staff responsible for the job.
create function public.record_stripe_payment(
  requested_org uuid, requested_event text, requested_invoice uuid, requested_amount_cents bigint,
  requested_fee_cents bigint, requested_payment_intent text, requested_paid_at timestamptz)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  target public.invoices%rowtype;
  paid bigint;
  result text;
  customer text;
  amount_text text := to_char(coalesce(requested_amount_cents, 0) / 100.0, 'FM$999,999,990.00');
begin
  if nullif(btrim(requested_event), '') is null or requested_org is null then
    raise exception 'Missing event.' using errcode = '22023';
  end if;
  insert into private.stripe_events (event_id, org_id, outcome)
  values (requested_event, requested_org, 'pending')
  on conflict (event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;
  perform set_config('serviceflow.org_id', requested_org::text, true);

  select * into target from public.invoices
  where id = requested_invoice and org_id = requested_org
  for update;
  if not found then
    result := 'not_found';
  elsif coalesce(requested_amount_cents, 0) <= 0 or nullif(btrim(requested_payment_intent), '') is null then
    result := 'invalid';
  elsif exists (
    select 1 from public.invoice_payments
    where org_id = requested_org and source = 'stripe' and reference = btrim(requested_payment_intent)) then
    result := 'already_recorded';
  elsif target.status = 'void' then
    result := 'void';
  elsif public.is_historical_job_accounting_locked(target.job_id) then
    result := 'locked';
  else
    paid := (select coalesce(sum(amount_cents), 0) from public.invoice_payments where invoice_id = target.id);
    perform private.apply_invoice_payment(target, requested_amount_cents,
      (coalesce(requested_paid_at, now()) at time zone coalesce(
        (select timezone from public.organizations where id = requested_org), 'America/Toronto'))::date,
      'card', btrim(requested_payment_intent), 'Paid online with Stripe', 'stripe', requested_fee_cents);
    result := 'recorded';
  end if;
  update private.stripe_events set outcome = result, invoice_id = target.id where event_id = requested_event;

  if result in ('recorded', 'void', 'locked', 'not_found') then
    customer := (select c.name from public.jobs j join public.contacts c on c.id = j.contact_id where j.id = target.job_id);
    perform private.notify_record(
      requested_org, target.job_id, 'payment',
      case when result = 'recorded' then 'Card payment received' else 'Card payment needs review' end,
      case result
        when 'recorded' then concat_ws(' · ', amount_text || ' on invoice #' || target.number, customer,
          case when paid + requested_amount_cents > target.amount_cents then
            'Overpaid by ' || to_char((paid + requested_amount_cents - target.amount_cents) / 100.0, 'FM$999,999,990.00')
            || '; refund the difference in Stripe' end)
        when 'void' then amount_text || ' was paid online for void invoice #' || target.number
          || '. It wasn''t recorded; refund it in Stripe.'
        when 'locked' then amount_text || ' was paid online for invoice #' || target.number
          || ', whose job is locked by the June 1, 2026 accounting cutoff. It wasn''t recorded; review it in Stripe ('
          || btrim(requested_payment_intent) || ').'
        else amount_text || ' was paid online for an invoice that no longer exists. Review it in Stripe ('
          || coalesce(btrim(requested_payment_intent), requested_event) || ').'
      end,
      case when target.id is not null
        then '/jobs/' || target.job_id || '/invoices/' || target.id end);
  end if;
  return result;
end
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array['get_payment_settings(uuid)', 'save_payment_settings(text, text, boolean, numeric)'] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  execute 'revoke all on function public.get_public_payment_options(text) from public';
  execute 'grant execute on function public.get_public_payment_options(text) to anon, authenticated';
  foreach fn in array array[
    'stripe_checkout_context(text)',
    'stripe_webhook_secret(uuid)',
    'record_stripe_payment(uuid, text, uuid, bigint, bigint, text, timestamptz)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
