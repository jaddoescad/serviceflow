-- Two-way messaging. Customers' texts (Quo webhooks) and email replies land in
-- a shared inbox with one conversation per customer; an unknown number or
-- address gets its own conversation until it matches a customer. Staff
-- replies, drips, reminders and document sends stay in outbound_messages and
-- show in the same thread. Customers choose, per channel, which kinds of
-- message they still get, and the queue honours it.
begin;

-- Receiving settings ----------------------------------------------------------

-- Each company pastes its own webhook URL into Quo; the token in it is the
-- credential, and Quo's signing secret is checked when saved.
alter table private.org_messaging
  add column quo_webhook_token text not null default encode(extensions.gen_random_bytes(18), 'hex'),
  add column quo_webhook_secret text,
  add column last_text_received_at timestamptz,
  add column last_email_received_at timestamptz;
create unique index org_messaging_quo_webhook_token_idx on private.org_messaging (quo_webhook_token);

-- Conversations ---------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  -- An unknown sender's number (E.164) or email address.
  handle text,
  is_unread boolean not null default false,
  -- Null until someone writes in or staff message the customer directly;
  -- only then does the conversation show in the inbox.
  last_message_at timestamptz,
  last_message_preview text,
  last_message_channel text check (last_message_channel in ('email', 'sms')),
  last_message_direction text check (last_message_direction in ('inbound', 'outbound')),
  created_at timestamptz not null default now(),
  check (contact_id is not null or handle is not null)
);
create unique index conversations_contact_idx on public.conversations (org_id, contact_id) where contact_id is not null;
create unique index conversations_handle_idx on public.conversations (org_id, handle) where contact_id is null;
create index conversations_inbox_idx on public.conversations (org_id, is_unread desc, last_message_at desc)
  where last_message_at is not null;

-- Messages that arrive, plus texts staff send from the Quo app itself.
-- Messages sent from ServiceFlow live in outbound_messages.
create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  channel text not null check (channel in ('email', 'sms')),
  from_address text,
  to_address text,
  subject text check (char_length(subject) <= 500),
  body text not null default '' check (char_length(body) <= 20000),
  -- [{name, contentType, size, url | path}]; a path is in the message-attachments bucket.
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  record_id uuid,
  reply_to_message uuid references public.outbound_messages(id) on delete set null,
  provider_message_id text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index conversation_messages_provider_idx
  on public.conversation_messages (org_id, channel, provider_message_id) where provider_message_id is not null;
create index conversation_messages_thread_idx on public.conversation_messages (conversation_id, received_at desc);

alter table public.outbound_messages
  add column conversation_id uuid references public.conversations(id) on delete set null,
  add column delivered_at timestamptz;
create index outbound_messages_contact_idx on public.outbound_messages (contact_id, scheduled_for desc)
  where contact_id is not null;
create index outbound_messages_conversation_idx on public.outbound_messages (conversation_id)
  where conversation_id is not null;
create index outbound_messages_provider_idx on public.outbound_messages (provider_message_id)
  where provider_message_id is not null;

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
revoke all on public.conversations, public.conversation_messages from anon, authenticated;
grant select on public.conversations, public.conversation_messages to authenticated;
create policy org_manager_read on public.conversations for select to authenticated
  using (org_id in (select private.my_managed_org_ids()));
create policy org_manager_read on public.conversation_messages for select to authenticated
  using (org_id in (select private.my_managed_org_ids()));

-- Email attachments are copied here by the inbound-email function, under
-- <org id>/<message>/<file>.
insert into storage.buckets (id, name, public, file_size_limit)
values ('message-attachments', 'message-attachments', false, 26214400)
on conflict (id) do nothing;
create policy "Company managers read message attachments" on storage.objects for select to authenticated
  using (bucket_id = 'message-attachments'
    and private.try_uuid((storage.foldername(name))[1]) in (select private.my_managed_org_ids()));

-- Helpers ---------------------------------------------------------------------

-- What kind of message a queued row is; opt-outs and the activity list use it.
create function private.message_kind(m public.outbound_messages)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when m.drip_step_id is not null or m.enrollment_id is not null then 'drip'
    when m.reminder_rule_id is not null or m.appointment_id is not null then 'reminder'
    when m.document_kind is not null then 'document'
    else 'manual' end
$$;

-- Why the customer won't get this message, or null. 'all' blocks everything
-- on the channel; 'drips' and 'reminders' block only those. Test sends to
-- someone else are never blocked.
create function private.opt_out_reason(m public.outbound_messages)
returns text
language sql stable security definer set search_path = ''
as $$
  select 'Customer opted out of '
    || case o.category when 'drips' then 'follow-up ' when 'reminders' then 'reminder ' else '' end
    || case m.channel when 'email' then 'emails.' else 'texts.' end
  from public.message_opt_outs o
  where m.to_override is null and o.contact_id = m.contact_id and o.channel = m.channel
    and (o.category = 'all'
      or o.category = case private.message_kind(m) when 'drip' then 'drips' when 'reminder' then 'reminders' end)
  order by o.category = 'all' desc
  limit 1
$$;

-- North American numbers without a country code get +1.
create function private.e164(value text)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when d ~ '^[0-9]{10}$' then '+1' || d
    when d ~ '^1[0-9]{10}$' then '+' || d
    when btrim(value) like '+%' and length(d) between 8 and 15 then '+' || d
    else nullif(d, '') end
  from (select regexp_replace(coalesce(value, ''), '\D', '', 'g') as d) x
$$;

create function private.phone_key(value text)
returns text
language sql immutable set search_path = ''
as $$
  select case when length(d) >= 7 then right(d, 10) end
  from (select regexp_replace(coalesce(value, ''), '\D', '', 'g') as d) x
$$;

-- The company's customer with this email address or phone number.
create function private.match_contact(company uuid, requested_channel text, address text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select c.id from public.contacts c
  where c.org_id = company and nullif(btrim(address), '') is not null
    and case when requested_channel = 'email'
      then lower(btrim(c.email)) = lower(btrim(address)) or c.normalized_email = lower(btrim(address))
      else private.phone_key(c.phone) = private.phone_key(address)
        or right(c.normalized_phone, 10) = private.phone_key(address) end
  order by (c.kind = 'customer') desc, c.updated_at desc
  limit 1
$$;

-- The customer's most recent deal or job.
create function private.latest_record_for_contact(requested_contact uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select d.id from public.project_directory d
  where d.contact_id = requested_contact and d.trashed_at is null
  order by (d.archived_at is null) desc, d.created_at desc
  limit 1
$$;

create function private.message_preview(requested_body text, requested_subject text, has_attachments boolean)
returns text
language sql immutable set search_path = ''
as $$
  select coalesce(
    nullif(left(btrim(regexp_replace(coalesce(requested_body, ''), '\s+', ' ', 'g')), 160), ''),
    nullif(btrim(requested_subject), ''),
    case when has_attachments then 'Attachment' end,
    '')
$$;

-- Finds or starts a customer's conversation. Earlier messages from their
-- number or address, from before they were a customer, join it.
create function private.conversation_for(company uuid, requested_contact uuid, requested_handle text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  conversation uuid;
  stray public.conversations%rowtype;
begin
  if requested_contact is null then
    insert into public.conversations (org_id, handle) values (company, requested_handle)
    on conflict (org_id, handle) where contact_id is null do nothing;
    select id into conversation from public.conversations
    where org_id = company and contact_id is null and handle = requested_handle;
    return conversation;
  end if;

  insert into public.conversations (org_id, contact_id) values (company, requested_contact)
  on conflict (org_id, contact_id) where contact_id is not null do nothing;
  select id into conversation from public.conversations
  where org_id = company and contact_id = requested_contact;

  if requested_handle is not null then
    select * into stray from public.conversations
    where org_id = company and contact_id is null and handle = requested_handle
    for update;
    if found then
      update public.conversation_messages set conversation_id = conversation where conversation_id = stray.id;
      update public.outbound_messages set conversation_id = conversation where conversation_id = stray.id;
      update public.conversations c set
        is_unread = c.is_unread or stray.is_unread,
        last_message_at = greatest(c.last_message_at, stray.last_message_at),
        last_message_preview = case when stray.last_message_at > coalesce(c.last_message_at, '-infinity')
          then stray.last_message_preview else c.last_message_preview end,
        last_message_channel = case when stray.last_message_at > coalesce(c.last_message_at, '-infinity')
          then stray.last_message_channel else c.last_message_channel end,
        last_message_direction = case when stray.last_message_at > coalesce(c.last_message_at, '-infinity')
          then stray.last_message_direction else c.last_message_direction end
      where c.id = conversation;
      delete from public.conversations where id = stray.id;
    end if;
  end if;
  return conversation;
end
$$;

-- Records a conversation's latest message. requested_unread: true marks it
-- unread, false read, null leaves it.
create function private.touch_conversation(
  requested_conversation uuid, requested_channel text, requested_direction text,
  requested_preview text, requested_at timestamptz, requested_unread boolean)
returns void
language sql security definer set search_path = ''
as $$
  update public.conversations set
    last_message_preview = case when requested_at >= coalesce(last_message_at, '-infinity')
      then requested_preview else last_message_preview end,
    last_message_channel = case when requested_at >= coalesce(last_message_at, '-infinity')
      then requested_channel else last_message_channel end,
    last_message_direction = case when requested_at >= coalesce(last_message_at, '-infinity')
      then requested_direction else last_message_direction end,
    last_message_at = greatest(coalesce(last_message_at, requested_at), requested_at),
    is_unread = coalesce(requested_unread, is_unread)
  where id = requested_conversation
$$;

-- A customer's thread, oldest first: what they sent, texts staff sent from
-- Quo, and every message queued to them (drips, reminders, documents and
-- replies). Future drips stay off it until they are due.
create function private.thread_items(company uuid, requested_contact uuid, requested_conversation uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(item order by at, id), '[]'::jsonb)
  from (
    select * from (
      select cm.id, cm.received_at as at, jsonb_build_object(
          'id', cm.id, 'direction', cm.direction, 'channel', cm.channel, 'subject', cm.subject,
          'body', cm.body, 'attachments', cm.attachments, 'at', cm.received_at,
          'status', case when cm.direction = 'inbound' then 'received' else 'sent' end,
          'kind', case when cm.direction = 'outbound' then 'quo' end,
          'error', null, 'deliveredAt', null, 'authorName', null,
          'from', cm.from_address, 'to', cm.to_address) as item
      from public.conversation_messages cm
      where requested_conversation is not null and cm.conversation_id = requested_conversation
      union all
      select m.id, coalesce(m.sent_at, m.scheduled_for), jsonb_build_object(
          'id', m.id, 'direction', 'outbound', 'channel', m.channel,
          'subject', private.fill_placeholders(m.subject, c.name, o.name, o.phone),
          'body', private.fill_placeholders(m.body, c.name, o.name, o.phone),
          'attachments', '[]'::jsonb, 'at', coalesce(m.sent_at, m.scheduled_for),
          'status', m.status, 'kind', private.message_kind(m), 'error', m.error,
          'deliveredAt', m.delivered_at, 'authorName', e.full_name,
          'from', null, 'to', coalesce(m.to_override, case m.channel when 'email' then c.email else c.phone end))
      from public.outbound_messages m
      join public.organizations o on o.id = m.org_id
      left join public.contacts c on c.id = m.contact_id
      left join public.employees e on e.id = m.created_by
      where m.org_id = company and m.status <> 'cancelled'
        and m.scheduled_for <= now() + interval '5 minutes'
        and ((requested_contact is not null and m.contact_id = requested_contact and m.to_override is null)
          or (requested_conversation is not null and m.conversation_id = requested_conversation))
    ) everything
    order by at desc, id
    limit 300
  ) recent
$$;

-- Header and messages for one conversation, or a customer with none yet.
create function private.thread(company uuid, requested_conversation uuid, requested_contact uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', v.id,
    'isUnread', coalesce(v.is_unread, false),
    'handle', v.handle,
    'contact', case when ct.id is not null then jsonb_build_object(
      'id', ct.id, 'name', ct.name, 'email', nullif(btrim(ct.email), ''), 'phone', nullif(btrim(ct.phone), '')) end,
    'record', (select jsonb_build_object('id', d.id, 'kind', d.kind, 'name', d.name)
      from public.project_directory d where d.id = private.latest_record_for_contact(ct.id)),
    'optOuts', coalesce((select jsonb_agg(jsonb_build_object('channel', oo.channel, 'category', oo.category))
      from public.message_opt_outs oo where oo.contact_id = ct.id), '[]'::jsonb),
    'quoConnected', exists (select 1 from private.org_messaging s
      where s.org_id = company and s.quo_api_key is not null and s.quo_from_number is not null),
    'messages', private.thread_items(company, ct.id, v.id))
  from (select requested_conversation as wanted, requested_contact as wanted_contact) w
  left join public.conversations v on v.id = w.wanted
    or (w.wanted is null and v.org_id = company and v.contact_id = w.wanted_contact)
  left join public.contacts ct on ct.id = coalesce(v.contact_id, w.wanted_contact)
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'message_kind(public.outbound_messages)',
    'opt_out_reason(public.outbound_messages)',
    'e164(text)',
    'phone_key(text)',
    'match_contact(uuid, text, text)',
    'latest_record_for_contact(uuid)',
    'message_preview(text, text, boolean)',
    'conversation_for(uuid, uuid, text)',
    'touch_conversation(uuid, text, text, text, timestamptz, boolean)',
    'thread_items(uuid, uuid, uuid)',
    'thread(uuid, uuid, uuid)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, authenticated', fn);
  end loop;
end
$$;

-- Inbox (managers) --------------------------------------------------------------

create function public.get_inbox(requested_filter text default 'all')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can open the inbox.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'unreadCount', (select count(*) from public.conversations
      where org_id = company and is_unread and last_message_at is not null),
    'conversations', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', v.id, 'contactId', v.contact_id, 'name', nullif(btrim(ct.name), ''),
          'handle', coalesce(v.handle, nullif(btrim(ct.phone), ''), nullif(btrim(ct.email), '')),
          'preview', v.last_message_preview, 'channel', v.last_message_channel,
          'direction', v.last_message_direction, 'at', v.last_message_at, 'isUnread', v.is_unread)
        order by v.is_unread desc, v.last_message_at desc)
      from (
        select * from public.conversations c
        where c.org_id = company and c.last_message_at is not null
          and case requested_filter
            when 'unread' then c.is_unread
            when 'sms' then exists (select 1 from public.conversation_messages cm
                where cm.conversation_id = c.id and cm.channel = 'sms')
              or exists (select 1 from public.outbound_messages m where m.conversation_id = c.id and m.channel = 'sms')
            when 'email' then exists (select 1 from public.conversation_messages cm
                where cm.conversation_id = c.id and cm.channel = 'email')
              or exists (select 1 from public.outbound_messages m where m.conversation_id = c.id and m.channel = 'email')
            else true end
        order by c.is_unread desc, c.last_message_at desc
        limit 300
      ) v
      left join public.contacts ct on ct.id = v.contact_id
    ), '[]'::jsonb));
end
$$;

create function public.get_conversation(requested_conversation uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := (select org_id from public.conversations where id = requested_conversation);
begin
  if company is null then
    return null;
  end if;
  if not private.is_org_manager(company) then
    raise exception 'Only managers can read messages.' using errcode = '42501';
  end if;
  return private.thread(company, requested_conversation, null);
end
$$;

-- The deal page's Communications tab: the customer's whole thread.
create function public.get_contact_thread(requested_contact uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := (select org_id from public.contacts where id = requested_contact);
begin
  if company is null then
    return null;
  end if;
  if not private.is_org_manager(company) then
    raise exception 'Only managers can read messages.' using errcode = '42501';
  end if;
  return private.thread(company, null, requested_contact);
end
$$;

create function public.set_conversation_read(requested_conversation uuid, requested_read boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_org_manager((select org_id from public.conversations where id = requested_conversation)) then
    raise exception 'Only managers can update the inbox.' using errcode = '42501';
  end if;
  update public.conversations set is_unread = not coalesce(requested_read, true)
  where id = requested_conversation;
end
$$;

-- For the sidebar badge. Never raises, so the nav renders for everyone.
create function public.get_unread_conversation_count()
returns integer
language sql stable security definer set search_path = ''
as $$
  select case when private.is_org_manager(private.home_org_id()) then (
    select count(*)::integer from public.conversations
    where org_id = private.home_org_id() and is_unread and last_message_at is not null)
  else 0 end
$$;

-- Replies go through the outbound queue like every other message. An unknown
-- sender is answered at their own number or address.
create function public.reply_to_conversation(
  requested_conversation uuid, requested_channel text, requested_subject text, requested_body text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  conversation public.conversations%rowtype;
  customer public.contacts%rowtype;
  destination text;
  message_id uuid := gen_random_uuid();
  clean_subject text := nullif(btrim(requested_subject), '');
begin
  select * into conversation from public.conversations where id = requested_conversation;
  if not found or not private.is_org_manager(conversation.org_id) then
    raise exception 'Only managers can message customers.' using errcode = '42501';
  end if;
  if requested_channel not in ('email', 'sms') or nullif(btrim(requested_body), '') is null then
    raise exception 'Write a message to send.' using errcode = '22023';
  end if;
  if conversation.contact_id is not null then
    select * into customer from public.contacts where id = conversation.contact_id;
    destination := nullif(btrim(case requested_channel when 'email' then customer.email else customer.phone end), '');
  elsif (requested_channel = 'email') = (conversation.handle like '%@%') then
    destination := conversation.handle;
  end if;
  if destination is null then
    raise exception '%', case requested_channel when 'email' then 'There is no email address to reply to.'
      else 'There is no phone number to text.' end using errcode = '22023';
  end if;
  if requested_channel = 'sms' and not exists (
    select 1 from private.org_messaging where org_id = conversation.org_id
      and quo_api_key is not null and quo_from_number is not null) then
    raise exception 'Connect Quo in Settings to send texts.' using errcode = '22023';
  end if;
  if requested_channel = 'email' and clean_subject is null then
    raise exception 'Add a subject.' using errcode = '22023';
  end if;

  insert into public.outbound_messages (
    id, org_id, record_id, contact_id, conversation_id, channel, subject, body, to_override)
  values (
    message_id, conversation.org_id,
    case when conversation.contact_id is not null then private.latest_record_for_contact(conversation.contact_id) end,
    conversation.contact_id, conversation.id, requested_channel,
    case when requested_channel = 'email' then left(clean_subject, 200) end,
    btrim(requested_body),
    case when conversation.contact_id is null then destination end);
  perform private.touch_conversation(conversation.id, requested_channel, 'outbound',
    private.message_preview(requested_body, clean_subject, false), now(), false);
  return message_id;
end
$$;

-- A message from the deal page now also starts or continues the customer's
-- conversation, so it shows in the inbox.
create or replace function public.queue_customer_message(
  requested_record uuid, requested_channel text, requested_subject text, requested_body text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.org_of_project(requested_record);
  message_id uuid := gen_random_uuid();
  customer uuid;
  conversation uuid;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can message customers.' using errcode = '42501';
  end if;
  if requested_channel not in ('email', 'sms') or nullif(btrim(requested_body), '') is null then
    raise exception 'Write a message to send.' using errcode = '22023';
  end if;
  if requested_channel = 'sms' and not exists (
    select 1 from private.org_messaging where org_id = company and quo_api_key is not null and quo_from_number is not null) then
    raise exception 'Connect Quo in Settings to send texts.' using errcode = '22023';
  end if;
  customer := coalesce((select contact_id from public.leads where id = requested_record),
    (select contact_id from public.jobs where id = requested_record));
  if customer is not null then
    conversation := private.conversation_for(company, customer, null);
  end if;
  insert into public.outbound_messages (id, org_id, record_id, contact_id, conversation_id, channel, subject, body)
  values (message_id, company, requested_record, customer, conversation,
    requested_channel, nullif(btrim(requested_subject), ''), btrim(requested_body));
  if conversation is not null then
    perform private.touch_conversation(conversation, requested_channel, 'outbound',
      private.message_preview(requested_body, requested_subject, false), now(), false);
  end if;
  return message_id;
end
$$;

-- Everything the queue has sent or tried to send, newest first, so failures
-- are visible. 'queued' lists what goes out next first; cancelled drips
-- (the deal moved on) show only under 'skipped'.
create function public.get_outbound_activity(requested_status text default 'all')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see messages.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', m.id, 'channel', m.channel, 'kind', private.message_kind(m), 'status', m.status,
        'error', m.error, 'subject', private.fill_placeholders(m.subject, c.name, o.name, o.phone),
        'preview', left(btrim(regexp_replace(private.fill_placeholders(m.body, c.name, o.name, o.phone), '\s+', ' ', 'g')), 200),
        'scheduledFor', m.scheduled_for, 'sentAt', m.sent_at, 'deliveredAt', m.delivered_at,
        'customerName', nullif(btrim(c.name), ''), 'contactId', m.contact_id, 'recordId', m.record_id,
        'conversationId', coalesce(m.conversation_id, v.id),
        'to', coalesce(m.to_override, nullif(btrim(case m.channel when 'email' then c.email else c.phone end), '')),
        'isTest', m.to_override is not null and m.conversation_id is null)
      order by case when requested_status = 'queued' then m.scheduled_for end,
        coalesce(m.sent_at, m.scheduled_for) desc)
    from (
      select * from public.outbound_messages q
      where q.org_id = company
        and case requested_status
          when 'queued' then q.status in ('queued', 'sending')
          when 'sent' then q.status = 'sent'
          when 'failed' then q.status = 'failed'
          when 'skipped' then q.status in ('skipped', 'cancelled')
          else q.status <> 'cancelled' and (q.status not in ('queued', 'sending') or q.scheduled_for <= now()) end
      order by case when requested_status = 'queued' then q.scheduled_for end,
        coalesce(q.sent_at, q.scheduled_for) desc
      limit 300
    ) m
    join public.organizations o on o.id = m.org_id
    left join public.contacts c on c.id = m.contact_id
    left join public.conversations v on v.org_id = m.org_id and v.contact_id = m.contact_id
      and v.last_message_at is not null and m.to_override is null
  ), '[]'::jsonb);
end
$$;

-- Settings: the company's Quo webhook and whether anything has arrived yet.
create function public.get_inbox_setup()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  settings private.org_messaging%rowtype;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can see messaging settings.' using errcode = '42501';
  end if;
  select * into settings from private.org_messaging where org_id = company;
  return jsonb_build_object(
    'quoWebhookToken', case when settings.quo_api_key is not null then settings.quo_webhook_token end,
    'quoWebhookSigned', settings.quo_webhook_secret is not null,
    'lastTextReceivedAt', settings.last_text_received_at,
    'lastEmailReceivedAt', settings.last_email_received_at);
end
$$;

-- An empty secret stops checking signatures.
create function public.save_quo_webhook_secret(requested_secret text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can change messaging settings.' using errcode = '42501';
  end if;
  update private.org_messaging set quo_webhook_secret = nullif(btrim(requested_secret), ''), updated_at = now()
  where org_id = company;
  if not found then
    raise exception 'Connect Quo first.' using errcode = '22023';
  end if;
end
$$;

-- Receiving (service role only) ---------------------------------------------------

create function public.get_quo_webhook(requested_token text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('orgId', org_id, 'secret', quo_webhook_secret)
  from private.org_messaging
  where quo_webhook_token = requested_token and length(requested_token) >= 24
$$;

-- reply+<token>@ addresses carry the id of the email being answered.
create function public.resolve_reply_token(requested_token text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select org_id from public.outbound_messages
  where requested_token ~ '^[0-9a-f]{32}$' and id = requested_token::uuid
$$;

-- Stores a text or email that arrived (or a text staff sent from the Quo app),
-- threads it to the customer and tells the people on their deal. Delivery
-- reports for texts sent from here mark them delivered instead. requested_org
-- may be null for email; the reply token then names the company.
create function public.receive_inbound_message(requested_org uuid, requested_message jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  msg_channel text := requested_message ->> 'channel';
  msg_direction text := coalesce(requested_message ->> 'direction', 'inbound');
  provider_id text := nullif(btrim(requested_message ->> 'providerId'), '');
  reply_token text := lower(nullif(btrim(requested_message ->> 'replyToken'), ''));
  sender text := nullif(btrim(requested_message ->> 'from'), '');
  recipient text := nullif(btrim(requested_message ->> 'to'), '');
  msg_body text := left(coalesce(requested_message ->> 'body', ''), 20000);
  msg_subject text := left(nullif(btrim(requested_message ->> 'subject'), ''), 500);
  msg_attachments jsonb := coalesce(requested_message -> 'attachments', '[]'::jsonb);
  msg_at timestamptz := coalesce(nullif(requested_message ->> 'receivedAt', '')::timestamptz, now());
  company uuid := requested_org;
  replied public.outbound_messages%rowtype;
  ours uuid;
  counterpart text;
  handle text;
  customer uuid;
  record uuid;
  conversation uuid;
  message_id uuid;
  preview text;
  who text;
begin
  if msg_channel is null or msg_channel not in ('email', 'sms')
    or msg_direction not in ('inbound', 'outbound') then
    raise exception 'Unknown message.' using errcode = '22023';
  end if;
  if jsonb_typeof(msg_attachments) <> 'array' then
    msg_attachments := '[]'::jsonb;
  end if;
  if msg_at > now() + interval '1 hour' then
    msg_at := now();
  end if;

  if reply_token ~ '^[0-9a-f]{32}$' then
    select * into replied from public.outbound_messages
    where id = reply_token::uuid and (company is null or org_id = company);
    company := coalesce(company, replied.org_id);
  end if;
  if company is null then
    return jsonb_build_object('ignored', 'Unknown recipient.');
  end if;
  if provider_id is not null and exists (
    select 1 from public.conversation_messages
    where org_id = company and channel = msg_channel and provider_message_id = provider_id) then
    return jsonb_build_object('duplicate', true);
  end if;

  if msg_direction = 'outbound' then
    -- A text sent from here: by Quo's id, the opt-out link in it, or (when the
    -- report beats our own bookkeeping) the same words to the same number.
    select m.id into ours from public.outbound_messages m
    where m.org_id = company and m.channel = msg_channel
      and (m.provider_message_id = provider_id
        or m.id = private.try_uuid(substring(msg_body from '/u/([0-9a-fA-F-]{36})')))
    limit 1;
    if ours is null then
      select m.id into ours from public.outbound_messages m
      left join public.contacts c on c.id = m.contact_id
      where m.org_id = company and m.channel = msg_channel and m.status in ('sending', 'sent')
        and m.scheduled_for > now() - interval '1 day'
        and private.phone_key(coalesce(m.to_override, c.phone)) = private.phone_key(recipient)
        and position(btrim(m.body) in msg_body) > 0
      order by m.scheduled_for desc
      limit 1;
    end if;
    if ours is not null then
      update public.outbound_messages set delivered_at = coalesce(delivered_at, msg_at),
        provider_message_id = coalesce(provider_message_id, provider_id)
      where id = ours;
      return jsonb_build_object('delivered', ours);
    end if;
    counterpart := recipient;
  else
    counterpart := sender;
  end if;
  if counterpart is null then
    return jsonb_build_object('ignored', 'No sender.');
  end if;
  handle := case when msg_channel = 'email' then lower(counterpart) else coalesce(private.e164(counterpart), counterpart) end;

  -- An email reply belongs to the thread it answers; otherwise match the
  -- sender to a customer.
  if replied.id is not null and replied.to_override is null and replied.contact_id is not null then
    customer := replied.contact_id;
  end if;
  customer := coalesce(customer, private.match_contact(company, msg_channel, counterpart));
  if customer is null and replied.conversation_id is not null then
    conversation := replied.conversation_id;
  end if;
  conversation := coalesce(conversation, private.conversation_for(company, customer, handle));
  record := coalesce(replied.record_id, case when customer is not null then private.latest_record_for_contact(customer) end);

  insert into public.conversation_messages (
    org_id, conversation_id, direction, channel, from_address, to_address, subject, body,
    attachments, record_id, reply_to_message, provider_message_id, received_at)
  values (
    company, conversation, msg_direction, msg_channel, sender, recipient, msg_subject, msg_body,
    msg_attachments, record, replied.id, provider_id, msg_at)
  on conflict (org_id, channel, provider_message_id) where provider_message_id is not null do nothing
  returning id into message_id;
  if message_id is null then
    return jsonb_build_object('duplicate', true);
  end if;

  preview := private.message_preview(msg_body, msg_subject, jsonb_array_length(msg_attachments) > 0);
  perform private.touch_conversation(conversation, msg_channel, msg_direction, preview, msg_at,
    case when msg_direction = 'inbound' then true end);

  if msg_direction = 'inbound' then
    insert into private.org_messaging as s (org_id, last_text_received_at, last_email_received_at)
    values (company, case when msg_channel = 'sms' then now() end, case when msg_channel = 'email' then now() end)
    on conflict (org_id) do update set
      last_text_received_at = coalesce(excluded.last_text_received_at, s.last_text_received_at),
      last_email_received_at = coalesce(excluded.last_email_received_at, s.last_email_received_at);
    who := coalesce((select nullif(btrim(name), '') from public.contacts where id = customer), counterpart);
    perform private.notify_record(company, record, 'message_received',
      case msg_channel when 'sms' then 'New text from ' else 'New email from ' end || who,
      preview, '/inbox?c=' || conversation);
  end if;
  return jsonb_build_object('conversationId', conversation, 'messageId', message_id);
end
$$;

-- Delivery reports for sent email (Resend webhooks). A spam complaint stops
-- all email to that customer.
create function public.record_message_delivery(
  requested_provider_id text, requested_event text, requested_detail text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  message public.outbound_messages%rowtype;
begin
  select * into message from public.outbound_messages
  where provider_message_id = requested_provider_id and requested_provider_id is not null
  limit 1;
  if not found then
    return;
  end if;
  if requested_event = 'delivered' then
    update public.outbound_messages set delivered_at = coalesce(delivered_at, now()) where id = message.id;
  elsif requested_event in ('bounced', 'failed', 'complained') then
    update public.outbound_messages set status = 'failed',
      error = left(case requested_event when 'bounced' then 'Bounced' when 'complained' then 'Marked as spam'
        else 'Not delivered' end || coalesce(': ' || nullif(btrim(requested_detail), ''), '') || '.', 1000)
    where id = message.id and status in ('sending', 'sent');
    if requested_event = 'complained' and message.contact_id is not null and message.to_override is null then
      insert into public.message_opt_outs (contact_id, channel, org_id, category)
      values (message.contact_id, message.channel, message.org_id, 'all')
      on conflict do nothing;
    end if;
  end if;
end
$$;

-- Delivery (service role only) ------------------------------------------------------

-- Claims due messages for the send-messages function and fills in the
-- customer and company placeholders. Opted-out customers and missing
-- addresses are skipped here; a test send goes to to_override instead.
create or replace function public.claim_outbound_messages(batch_size integer default 50)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  result jsonb;
begin
  update public.outbound_messages m set status = 'skipped', error = r.reason
  from (
    select q.id, coalesce(private.opt_out_reason(q), case
      when nullif(btrim(coalesce(q.to_override, case q.channel when 'email' then c.email else c.phone end)), '') is null
        then case q.channel when 'email' then 'Customer has no email address.' else 'Customer has no mobile number.' end
      end) as reason
    from public.outbound_messages q
    left join public.contacts c on c.id = q.contact_id
    where q.status = 'queued' and q.scheduled_for <= now()
  ) r
  where m.id = r.id and r.reason is not null;

  with due as (
    select id from public.outbound_messages
    where (status = 'queued' and scheduled_for <= now())
      or (status = 'sending' and lease_until < now())
    order by scheduled_for
    limit greatest(1, least(batch_size, 200))
    for update skip locked
  ), claimed as (
    update public.outbound_messages m set status = 'sending', lease_until = now() + interval '5 minutes'
    from due where m.id = due.id
    returning m.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'channel', m.channel, 'kind', private.message_kind(m::public.outbound_messages),
      'to', btrim(coalesce(m.to_override, case when m.channel = 'email' then c.email else c.phone end)),
      'subject', private.fill_placeholders(m.subject, c.name, o.name, o.phone),
      'body', private.fill_placeholders(m.body, c.name, o.name, o.phone),
      'proposalToken', (
        select q.public_token from public.quotes q
        where q.lead_id = coalesce(
            (select id from public.leads where id = m.record_id),
            (select lead_id from public.jobs where id = m.record_id))
          and q.status in ('sent', 'accepted') and q.public_token is not null
        order by q.sent_at desc nulls last limit 1),
      'documentPath', case m.document_kind
        when 'proposal' then (select '/p/' || public_token from public.quotes where id = m.document_id)
        when 'change_order' then (select '/co/' || public_token from public.change_orders where id = m.document_id)
        when 'invoice' then (select '/i/' || public_token from public.invoices where id = m.document_id)
      end,
      -- An email reply threads under the customer's latest email.
      'inReplyTo', case when m.channel = 'email' and m.conversation_id is not null then (
        select cm.provider_message_id from public.conversation_messages cm
        where cm.conversation_id = m.conversation_id and cm.channel = 'email' and cm.direction = 'inbound'
          and cm.provider_message_id like '<%>'
        order by cm.received_at desc limit 1) end,
      'companyName', o.name,
      'replyTo', s.reply_to_email,
      'quoApiKey', s.quo_api_key,
      'quoFrom', s.quo_from_number)), '[]'::jsonb)
  into result
  from claimed m
  left join public.contacts c on c.id = m.contact_id
  join public.organizations o on o.id = m.org_id
  left join private.org_messaging s on s.org_id = m.org_id;
  return result;
end
$$;

-- A message that went out becomes the latest in the customer's conversation,
-- if they have one in the inbox.
create or replace function public.complete_outbound_message(
  requested_id uuid, requested_status text, requested_error text default null,
  requested_provider_id text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  done public.outbound_messages%rowtype;
  conversation uuid;
begin
  update public.outbound_messages set
    status = requested_status,
    error = left(requested_error, 1000),
    provider_message_id = requested_provider_id,
    sent_at = case when requested_status = 'sent' then now() else sent_at end,
    lease_until = null
  where id = requested_id and status = 'sending'
    and requested_status in ('sent', 'failed', 'skipped')
  returning * into done;
  if not found or requested_status <> 'sent' then
    return;
  end if;
  select v.id into conversation from public.conversations v
  where v.last_message_at is not null and (v.id = done.conversation_id
    or (done.to_override is null and v.org_id = done.org_id and v.contact_id = done.contact_id))
  order by (v.id = done.conversation_id) desc
  limit 1;
  if conversation is not null then
    perform private.touch_conversation(conversation, done.channel, 'outbound',
      private.message_preview(
        private.fill_placeholders(done.body, c.name, o.name, o.phone), done.subject, false), now(), null)
    from public.organizations o
    left join public.contacts c on c.id = done.contact_id
    where o.id = done.org_id;
  end if;
end
$$;

-- Communication preferences (from a message's link) ----------------------------------

-- 'none' gets everything; 'drips', 'reminders' or 'all' is what they stopped.
create function private.preference_choice(requested_contact uuid, requested_channel text)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select category from public.message_opt_outs
    where contact_id = requested_contact and channel = requested_channel
    order by category = 'all' desc, category
    limit 1), 'none')
$$;
revoke all on function private.preference_choice(uuid, text) from public, anon, authenticated;

create function public.get_message_preferences(requested_message uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'company', o.name,
    'channel', m.channel,
    'email', case when nullif(btrim(c.email), '') is not null or m.channel = 'email'
      then private.preference_choice(c.id, 'email') end,
    'sms', case when nullif(btrim(c.phone), '') is not null or m.channel = 'sms'
      then private.preference_choice(c.id, 'sms') end)
  from public.outbound_messages m
  join public.contacts c on c.id = m.contact_id
  join public.organizations o on o.id = m.org_id
  where m.id = requested_message and m.to_override is null
$$;

-- requested_preferences: {"email": choice, "sms": choice}; a missing channel is left alone.
create function public.save_message_preferences(requested_message uuid, requested_preferences jsonb)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  message public.outbound_messages%rowtype;
  channel_name text;
  choice text;
begin
  select * into message from public.outbound_messages where id = requested_message and to_override is null;
  if not found or message.contact_id is null then
    return null;
  end if;
  foreach channel_name in array array['email', 'sms'] loop
    choice := requested_preferences ->> channel_name;
    if choice is null then
      continue;
    end if;
    if choice not in ('none', 'drips', 'reminders', 'all') then
      raise exception 'Unknown preference.' using errcode = '22023';
    end if;
    delete from public.message_opt_outs where contact_id = message.contact_id and channel = channel_name;
    if choice <> 'none' then
      insert into public.message_opt_outs (contact_id, channel, org_id, category)
      values (message.contact_id, channel_name, message.org_id, choice);
    end if;
  end loop;
  return (select name from public.organizations where id = message.org_id);
end
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'get_inbox(text)',
    'get_conversation(uuid)',
    'get_contact_thread(uuid)',
    'set_conversation_read(uuid, boolean)',
    'get_unread_conversation_count()',
    'reply_to_conversation(uuid, text, text, text)',
    'get_outbound_activity(text)',
    'get_inbox_setup()',
    'save_quo_webhook_secret(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  foreach fn in array array[
    'get_quo_webhook(text)',
    'resolve_reply_token(text)',
    'receive_inbound_message(uuid, jsonb)',
    'record_message_delivery(text, text, text)',
    'claim_outbound_messages(integer)',
    'complete_outbound_message(uuid, text, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
  foreach fn in array array['get_message_preferences(uuid)', 'save_message_preferences(uuid, jsonb)'] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('grant execute on function public.%s to anon, authenticated', fn);
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
