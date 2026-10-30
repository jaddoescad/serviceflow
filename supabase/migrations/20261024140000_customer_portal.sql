-- Customer portal: one private link per customer (customer_portals) listing
-- their sent proposals, change orders and invoices and their upcoming visits.
-- From it the customer can ask for an appointment (kept as a request row and a
-- note on their deal, and the office is notified) and choose which messages
-- they get per channel (message_opt_outs categories). Like the document links,
-- the token is the only credential. None of these tables sync to Ottawa Painters.
begin;

create table public.customer_portals (
  contact_id uuid primary key references public.contacts(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  token text not null unique,
  created_by uuid default auth.uid() references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.appointment_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  -- The deal or job the request was filed on, when the customer has one.
  project_id uuid,
  -- [{ "date": "2026-10-30", "window": "morning" | "afternoon" | "evening" | "anytime" }]
  preferred_times jsonb not null default '[]'::jsonb,
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index appointment_requests_contact_idx on public.appointment_requests (contact_id, created_at desc);
create index appointment_requests_org_idx on public.appointment_requests (org_id, created_at desc);

alter table public.customer_portals enable row level security;
alter table public.appointment_requests enable row level security;
revoke all on public.customer_portals, public.appointment_requests from anon, authenticated;
grant select on public.appointment_requests to authenticated;
create policy org_member_read on public.appointment_requests for select to authenticated
  using (org_id in (select private.my_org_ids()));

-- Up to three distinct visit times from today to six months out, in the
-- company's time zone. Raises on anything else.
create function private.clean_preferred_times(requested jsonb, company_timezone text)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  today date := (now() at time zone coalesce(company_timezone, 'America/Toronto'))::date;
  cleaned jsonb;
begin
  if requested is null or requested = 'null'::jsonb then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(requested) <> 'array' or jsonb_array_length(requested) > 3 then
    raise exception 'Choose up to 3 times.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(requested) t
    where jsonb_typeof(t) <> 'object'
      or coalesce(t ->> 'window', '') not in ('morning', 'afternoon', 'evening', 'anytime')
      or coalesce(t ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or not pg_input_is_valid(t ->> 'date', 'date')
      or (t ->> 'date')::date not between today and today + 180) then
    raise exception 'Choose dates from today on.' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('date', day, 'window', slot) order by day,
      array_position(array['morning', 'afternoon', 'evening', 'anytime'], slot)), '[]'::jsonb)
  into cleaned
  from (select distinct t ->> 'date' as day, t ->> 'window' as slot from jsonb_array_elements(requested) t) picked;
  return cleaned;
end
$$;
revoke all on function private.clean_preferred_times(jsonb, text) from public, anon, authenticated;

-- "Thu Oct 30 morning; Fri Oct 31 any time" for staff notes.
create function private.describe_preferred_times(times jsonb)
returns text
language sql immutable set search_path = ''
as $$
  select string_agg(to_char((t ->> 'date')::date, 'Dy Mon FMDD') || ' '
      || case t ->> 'window' when 'anytime' then 'any time' else t ->> 'window' end, '; ' order by n)
  from jsonb_array_elements(coalesce(times, '[]'::jsonb)) with ordinality as x(t, n)
$$;
revoke all on function private.describe_preferred_times(jsonb) from public, anon, authenticated;

-- Staff get (and on first use create) a customer's portal link token.
create function public.get_customer_portal_token(requested_contact uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := (select org_id from public.contacts where id = requested_contact and kind = 'customer');
begin
  if company is null then
    raise exception 'Customer not found.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(company) then
    raise exception 'Only managers can share the customer portal.' using errcode = '42501';
  end if;
  insert into public.customer_portals (contact_id, org_id, token)
  values (requested_contact, company, private.new_public_token())
  on conflict (contact_id) do nothing;
  return (select token from public.customer_portals where contact_id = requested_contact);
end
$$;

create function private.portal_contact(requested_token text)
returns public.contacts
language sql stable security definer set search_path = ''
as $$
  select c.* from public.customer_portals p
  join public.contacts c on c.id = p.contact_id and c.org_id = p.org_id
  where requested_token is not null and char_length(requested_token) >= 24 and p.token = requested_token
$$;
revoke all on function private.portal_contact(text) from public, anon, authenticated;

-- How a channel's opt-out rows read to the customer.
create function private.portal_channel_mode(requested_contact uuid, requested_channel text)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when bool_or(category = 'all') then 'none'
    when bool_or(category = 'drips') then 'no_drips'
    when bool_or(category = 'reminders') then 'no_reminders'
    else 'all' end
  from public.message_opt_outs
  where contact_id = requested_contact and channel = requested_channel
$$;
revoke all on function private.portal_channel_mode(uuid, text) from public, anon, authenticated;

-- Everything the portal shows: only documents that were sent (they carry a
-- private link) and only this customer's deals and jobs. Appointments show
-- their kind, time and place, never staff titles or notes.
create function public.view_customer_portal(requested_token text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  person public.contacts%rowtype;
  lead_ids uuid[];
  job_ids uuid[];
begin
  person := private.portal_contact(requested_token);
  if person.id is null then
    return null;
  end if;
  select coalesce(array_agg(id), '{}') into lead_ids from public.leads
  where contact_id = person.id and org_id = person.org_id;
  select coalesce(array_agg(id), '{}') into job_ids from public.jobs
  where org_id = person.org_id and (contact_id = person.id or lead_id = any(lead_ids));

  return jsonb_build_object(
    'company', private.public_company(person.org_id)
      || jsonb_build_object('timezone', (select timezone from public.organizations where id = person.org_id)),
    'customer', jsonb_build_object('name', person.name, 'email', person.email, 'phone', person.phone,
      'language', person.preferred_language),
    'proposals', coalesce((
      select jsonb_agg(jsonb_build_object('name', q.name, 'status', q.status, 'totalCents', t.total_cents,
          'sentAt', q.sent_at, 'token', q.public_token, 'address', l.address)
        order by coalesce(q.sent_at, q.created_at) desc)
      from public.quotes q
      join public.leads l on l.id = q.lead_id
      cross join lateral private.line_item_totals(q.line_items, q.tax_rate_percent) t
      where q.lead_id = any(lead_ids) and q.public_token is not null
        and q.status in ('sent', 'accepted', 'declined', 'expired')), '[]'::jsonb),
    'changeOrders', coalesce((
      select jsonb_agg(jsonb_build_object('number', co.number, 'name', co.name, 'status', co.status,
          'totalCents', t.total_cents, 'sentAt', co.sent_at, 'token', co.public_token)
        order by coalesce(co.sent_at, co.created_at) desc)
      from public.change_orders co
      cross join lateral private.line_item_totals(co.line_items, co.tax_rate_percent) t
      where co.job_id = any(job_ids) and co.public_token is not null and co.status <> 'draft'), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object('number', i.number, 'name', i.name,
          'status', private.invoice_state(i.status, i.amount_cents, paid.cents, i.due_on),
          'totalCents', i.amount_cents, 'balanceCents', i.amount_cents - paid.cents,
          'dueOn', i.due_on, 'sentAt', coalesce(i.sent_at, i.issued_on::timestamptz), 'token', i.public_token)
        order by i.issued_on desc, i.number desc)
      from public.invoices i
      cross join lateral (select coalesce(sum(p.amount_cents), 0)::bigint as cents
        from public.invoice_payments p where p.invoice_id = i.id) paid
      where i.job_id = any(job_ids) and i.public_token is not null and i.status <> 'draft'), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object('kind', a.kind, 'startsAt', a.starts_at, 'endsAt', a.ends_at,
          'location', a.location) order by a.starts_at)
      from (select * from public.appointments
        where project_id = any(lead_ids || job_ids) and org_id = person.org_id
          and status = 'scheduled' and ends_at > now()
        order by starts_at limit 10) a), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('startOn', j.scheduled_on, 'endOn', j.scheduled_end_on,
          'address', coalesce(j.formatted_address, j.address_line_1)) order by j.scheduled_on)
      from public.jobs j
      where j.id = any(job_ids) and j.status in ('scheduled', 'active') and j.archived_at is null
        and j.scheduled_on is not null and coalesce(j.scheduled_end_on, j.scheduled_on) >= current_date), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('createdAt', r.created_at, 'preferredTimes', r.preferred_times,
          'note', r.note) order by r.created_at desc)
      from (select * from public.appointment_requests
        where contact_id = person.id and created_at > now() - interval '60 days'
        order by created_at desc limit 5) r), '[]'::jsonb),
    'preferences', jsonb_build_object(
      'email', private.portal_channel_mode(person.id, 'email'),
      'sms', private.portal_channel_mode(person.id, 'sms')));
end
$$;

-- The customer asks for a visit. Kept on their open deal (or latest job) as
-- a note and a request row, and the people on that deal are notified.
-- At most three a day per customer.
create function public.request_portal_appointment(
  requested_token text, requested_times jsonb, requested_note text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  person public.contacts%rowtype;
  times jsonb;
  clean_note text := nullif(btrim(coalesce(requested_note, '')), '');
  project uuid;
  project_kind text;
  summary text;
begin
  person := private.portal_contact(requested_token);
  if person.id is null then
    raise exception 'This link is not available.' using errcode = 'P0002';
  end if;
  times := private.clean_preferred_times(requested_times,
    (select timezone from public.organizations where id = person.org_id));
  if char_length(coalesce(clean_note, '')) > 1000 then
    raise exception 'Shorten your note to 1000 characters.' using errcode = '22023';
  end if;
  if jsonb_array_length(times) = 0 and clean_note is null then
    raise exception 'Choose a time or add a note.' using errcode = '22023';
  end if;
  if (select count(*) from public.appointment_requests
      where contact_id = person.id and created_at > now() - interval '1 day') >= 3 then
    raise exception 'You already sent a few requests today. We will be in touch.' using errcode = '54000';
  end if;
  perform set_config('serviceflow.org_id', person.org_id::text, true);

  select id, kind into project, project_kind from (
    select id, 'lead' as kind, 0 as rank, created_at from public.leads
    where contact_id = person.id and org_id = person.org_id and status not in ('won', 'lost', 'cancelled')
    union all
    select id, 'job', 1, created_at from public.jobs
    where org_id = person.org_id and (contact_id = person.id
        or lead_id in (select id from public.leads where contact_id = person.id))
      and status <> 'cancelled' and archived_at is null
    union all
    select id, 'lead', 2, created_at from public.leads where contact_id = person.id and org_id = person.org_id
  ) candidates
  order by rank, created_at desc
  limit 1;

  insert into public.appointment_requests (org_id, contact_id, project_id, preferred_times, note)
  values (person.org_id, person.id, project, times, clean_note);

  summary := concat_ws(' · ',
    case when jsonb_array_length(times) > 0 then 'Prefers ' || private.describe_preferred_times(times) end,
    clean_note);
  if project is not null then
    insert into public.project_notes (org_id, project_id, body, created_by)
    values (person.org_id, project, 'Appointment request from the customer portal: ' || summary, null);
  end if;
  perform private.notify_record(person.org_id, coalesce(project, person.id), 'appointment_request',
    'Appointment request from ' || person.name, left(summary, 1000),
    case when project is null then '/contacts/' || person.id
      when project_kind = 'job' then '/jobs/' || project
      else '/deals/' || project end);
end
$$;

-- Per channel: 'all' messages, 'no_drips', 'no_reminders' or 'none'. Queued
-- messages the customer no longer wants are cancelled.
create function public.save_portal_preferences(
  requested_token text, requested_email text, requested_sms text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  person public.contacts%rowtype;
  channel_name text;
  mode text;
  category_name text;
begin
  person := private.portal_contact(requested_token);
  if person.id is null then
    raise exception 'This link is not available.' using errcode = 'P0002';
  end if;
  if requested_email is null or requested_email not in ('all', 'no_drips', 'no_reminders', 'none')
    or requested_sms is null or requested_sms not in ('all', 'no_drips', 'no_reminders', 'none') then
    raise exception 'Choose a setting for email and texts.' using errcode = '22023';
  end if;
  foreach channel_name in array array['email', 'sms'] loop
    mode := case channel_name when 'email' then requested_email else requested_sms end;
    category_name := case mode when 'none' then 'all' when 'no_drips' then 'drips'
      when 'no_reminders' then 'reminders' end;
    delete from public.message_opt_outs
    where contact_id = person.id and channel = channel_name
      and category is distinct from category_name;
    if category_name is not null then
      insert into public.message_opt_outs (contact_id, channel, org_id, category)
      values (person.id, channel_name, person.org_id, category_name)
      on conflict do nothing;
      update public.outbound_messages set status = 'cancelled', error = 'Customer opted out.'
      where contact_id = person.id and channel = channel_name and status = 'queued'
        and (category_name = 'all'
          or (category_name = 'drips' and drip_step_id is not null)
          or (category_name = 'reminders' and reminder_rule_id is not null));
    end if;
  end loop;
end
$$;

create function public.set_portal_language(requested_token text, requested_language text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  person public.contacts%rowtype;
begin
  person := private.portal_contact(requested_token);
  if person.id is null or requested_language is null or requested_language not in ('en', 'fr') then
    return;
  end if;
  if person.preferred_language is distinct from requested_language then
    perform set_config('serviceflow.org_id', person.org_id::text, true);
    update public.contacts set preferred_language = requested_language, updated_at = now() where id = person.id;
  end if;
end
$$;

do $$
declare
  fn text;
begin
  execute 'revoke all on function public.get_customer_portal_token(uuid) from public, anon';
  execute 'grant execute on function public.get_customer_portal_token(uuid) to authenticated';
  foreach fn in array array[
    'view_customer_portal(text)',
    'request_portal_appointment(text, jsonb, text)',
    'save_portal_preferences(text, text, text)',
    'set_portal_language(text, text)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to anon, authenticated', fn);
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
