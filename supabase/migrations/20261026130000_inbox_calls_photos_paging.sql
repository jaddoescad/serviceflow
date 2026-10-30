-- Inbox follow-ups to connecting Quo: calls and voicemails in each customer's
-- thread, photos with the messages staff send (Quo's API can't send picture
-- messages, so a text carries a link; an email attaches them), turning a
-- number that isn't a customer into one, and paging through long inboxes and
-- threads.
begin;

-- Calls ------------------------------------------------------------------------------

alter table public.conversation_messages
  drop constraint conversation_messages_channel_check,
  add constraint conversation_messages_channel_check check (channel in ('email', 'sms', 'call')),
  -- A call: {status, duration (seconds), answered, recorded, voicemail: {duration, transcript}}.
  add column call jsonb;
alter table public.conversations
  drop constraint conversations_last_message_channel_check,
  add constraint conversations_last_message_channel_check check (last_message_channel in ('email', 'sms', 'call'));

-- Quo signs call events with the calls webhook's own key.
alter table private.org_messaging
  add column quo_call_webhook_id text,
  add column quo_call_webhook_secret text;

create or replace function public.quo_connection(requested_org uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  settings private.org_messaging%rowtype;
begin
  insert into private.org_messaging (org_id) values (requested_org) on conflict (org_id) do nothing;
  select * into settings from private.org_messaging where org_id = requested_org;
  return jsonb_build_object(
    'apiKey', settings.quo_api_key,
    'phoneNumberId', settings.quo_phone_number_id,
    'webhookIds', to_jsonb(array_remove(array[settings.quo_webhook_id, settings.quo_call_webhook_id], null)),
    'webhookToken', settings.quo_webhook_token);
end
$$;

create or replace function public.save_quo_connection(requested_org uuid, requested_connection jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update private.org_messaging set
    quo_api_key = nullif(btrim(requested_connection ->> 'apiKey'), ''),
    quo_phone_number_id = requested_connection ->> 'phoneNumberId',
    quo_from_number = requested_connection ->> 'number',
    quo_line_name = left(nullif(btrim(requested_connection ->> 'lineName'), ''), 200),
    quo_webhook_id = requested_connection ->> 'webhookId',
    quo_webhook_secret = nullif(requested_connection ->> 'webhookSecret', ''),
    quo_call_webhook_id = requested_connection ->> 'callWebhookId',
    quo_call_webhook_secret = nullif(requested_connection ->> 'callWebhookSecret', ''),
    quo_sync_status = 'running',
    quo_sync_cursor = null,
    quo_sync_since = null,
    quo_sync_started_at = now(),
    quo_sync_finished_at = null,
    quo_sync_error = null,
    quo_sync_lease_until = null,
    quo_synced_conversations = 0,
    updated_at = now()
  where org_id = requested_org;
end
$$;

create or replace function public.clear_quo_connection(requested_org uuid)
returns void
language sql security definer set search_path = ''
as $$
  update private.org_messaging set
    quo_api_key = null, quo_phone_number_id = null, quo_from_number = null, quo_line_name = null,
    quo_webhook_id = null, quo_webhook_secret = null, quo_call_webhook_id = null, quo_call_webhook_secret = null,
    quo_sync_status = null, quo_sync_cursor = null, quo_sync_since = null, quo_sync_started_at = null,
    quo_sync_finished_at = null, quo_sync_error = null, quo_sync_lease_until = null, quo_synced_conversations = 0,
    updated_at = now()
  where org_id = requested_org
$$;

-- Either webhook's key can sign a request to the company's URL.
create or replace function public.get_quo_webhook(requested_token text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('orgId', org_id,
    'secrets', to_jsonb(array_remove(array[quo_webhook_secret, quo_call_webhook_secret], null)))
  from private.org_messaging
  where quo_webhook_token = requested_token and length(requested_token) >= 24
$$;

-- "Missed call", "Voicemail: …", "Incoming call · 4 min".
create function private.call_preview(requested_direction text, requested_call jsonb)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when nullif(btrim(requested_call #>> '{voicemail,transcript}'), '') is not null
      then 'Voicemail: ' || left(btrim(requested_call #>> '{voicemail,transcript}'), 140)
    when jsonb_typeof(requested_call -> 'voicemail') = 'object' then 'Voicemail'
    when not coalesce((requested_call ->> 'answered')::boolean, false)
      then case requested_direction when 'inbound' then 'Missed call' else 'Call not answered' end
    else case requested_direction when 'inbound' then 'Incoming call' else 'Outgoing call' end
      || case
        when coalesce((requested_call ->> 'duration')::integer, 0) <= 0 then ''
        when (requested_call ->> 'duration')::integer < 60 then ' · ' || (requested_call ->> 'duration') || ' sec'
        else ' · ' || round((requested_call ->> 'duration')::integer / 60.0) || ' min' end
  end
$$;

-- The inbox line for a stored message or call.
create function private.stored_message_preview(m public.conversation_messages)
returns text
language sql immutable set search_path = ''
as $$
  select case when m.channel = 'call' then private.call_preview(m.direction, m.call)
    else private.message_preview(m.body, m.subject, jsonb_array_length(m.attachments) > 0) end
$$;

-- Adds a Quo call to a conversation, or adds what a later report knows (a
-- recording, the voicemail) to one already there. True when it's new.
create function private.upsert_quo_call(company uuid, conversation uuid, record uuid, requested_call jsonb)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  provider_id text := nullif(btrim(requested_call ->> 'id'), '');
  details jsonb := jsonb_strip_nulls(jsonb_build_object(
    'status', nullif(btrim(requested_call ->> 'status'), ''),
    'duration', case when jsonb_typeof(requested_call -> 'duration') = 'number'
      then greatest(round((requested_call ->> 'duration')::numeric), 0)::integer end,
    'answered', case when jsonb_typeof(requested_call -> 'answered') = 'boolean' then (requested_call ->> 'answered')::boolean end,
    'recorded', case when (requested_call ->> 'recorded') = 'true' then true end,
    'voicemail', case when jsonb_typeof(requested_call -> 'voicemail') = 'object' then requested_call -> 'voicemail' end));
  transcript text := left(nullif(btrim(requested_call #>> '{voicemail,transcript}'), ''), 20000);
begin
  if provider_id is null then
    return false;
  end if;
  update public.conversation_messages set
    call = coalesce(call, '{}'::jsonb) || details,
    body = coalesce(transcript, body)
  where org_id = company and channel = 'call' and provider_message_id = provider_id;
  if found then
    return false;
  end if;
  insert into public.conversation_messages (
    org_id, conversation_id, direction, channel, from_address, to_address, body, record_id,
    provider_message_id, received_at, call)
  values (
    company, conversation, case when requested_call ->> 'direction' = 'incoming' then 'inbound' else 'outbound' end,
    'call', nullif(btrim(requested_call ->> 'from'), ''), nullif(btrim(requested_call ->> 'to'), ''),
    coalesce(transcript, ''), record, provider_id,
    least(coalesce(private.try_timestamptz(requested_call ->> 'createdAt'), now()), now()), details)
  on conflict (org_id, channel, provider_message_id) where provider_message_id is not null do nothing;
  return found;
end
$$;

-- Imports now carry the conversation's calls as well as its texts.
create or replace function public.import_quo_conversation(requested_org uuid, requested_conversation jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  participant text := private.e164(requested_conversation ->> 'participant');
  quo_name text := left(nullif(btrim(requested_conversation ->> 'name'), ''), 200);
  messages jsonb := case when jsonb_typeof(requested_conversation -> 'messages') = 'array'
    then requested_conversation -> 'messages' else '[]'::jsonb end;
  calls jsonb := case when jsonb_typeof(requested_conversation -> 'calls') = 'array'
    then requested_conversation -> 'calls' else '[]'::jsonb end;
  customer uuid;
  conversation uuid;
  record uuid;
  latest public.conversation_messages%rowtype;
  call_item jsonb;
  added integer;
begin
  if participant is null or jsonb_array_length(messages) + jsonb_array_length(calls) = 0 then
    return 0;
  end if;
  customer := private.match_contact(requested_org, 'sms', participant);
  conversation := private.conversation_for(requested_org, customer, participant);
  if customer is null and quo_name is not null then
    update public.conversations set name = quo_name where id = conversation and name is distinct from quo_name;
  end if;
  record := case when customer is not null then private.latest_record_for_contact(customer) end;

  with incoming as (
    select m ->> 'id' as provider_id,
      case when m ->> 'direction' = 'incoming' then 'inbound' else 'outbound' end as direction,
      nullif(btrim(m ->> 'from'), '') as from_address,
      nullif(btrim(m ->> 'to'), '') as to_address,
      left(coalesce(m ->> 'text', ''), 20000) as body,
      coalesce((
        select jsonb_agg(jsonb_build_object('url', a ->> 'url', 'contentType', a ->> 'type', 'name', null))
        from jsonb_array_elements(case when jsonb_typeof(m -> 'media') = 'array' then m -> 'media' else '[]'::jsonb end) a
        where nullif(a ->> 'url', '') is not null), '[]'::jsonb) as attachments,
      least(coalesce(private.try_timestamptz(m ->> 'createdAt'), now()), now()) as at
    from jsonb_array_elements(messages) m
    where nullif(m ->> 'id', '') is not null
  ), inserted as (
    insert into public.conversation_messages (
      org_id, conversation_id, direction, channel, from_address, to_address, body, attachments,
      record_id, provider_message_id, received_at)
    select requested_org, conversation, i.direction, 'sms', i.from_address, i.to_address, i.body, i.attachments,
      record, i.provider_id, i.at
    from incoming i
    where not exists (select 1 from public.outbound_messages om
      where om.org_id = requested_org and om.provider_message_id = i.provider_id)
    on conflict (org_id, channel, provider_message_id) where provider_message_id is not null do nothing
    returning 1
  )
  select count(*) into added from inserted;

  for call_item in select value from jsonb_array_elements(calls) loop
    if private.upsert_quo_call(requested_org, conversation, record, call_item) then
      added := added + 1;
    end if;
  end loop;

  select * into latest from public.conversation_messages
  where conversation_id = conversation order by received_at desc limit 1;
  if found then
    perform private.touch_conversation(conversation, latest.channel, latest.direction,
      private.stored_message_preview(latest), latest.received_at, null);
  end if;
  return added;
end
$$;

-- A call Quo reports as it happens (service role, from quo-webhook). A missed
-- call marks the conversation unread.
create function public.receive_quo_call(requested_org uuid, requested_call jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  incoming boolean := requested_call ->> 'direction' = 'incoming';
  counterpart text := private.e164(case when incoming then requested_call ->> 'from' else requested_call ->> 'to' end);
  customer uuid;
  conversation uuid;
  record uuid;
  added boolean;
  stored public.conversation_messages%rowtype;
begin
  if counterpart is null then
    return jsonb_build_object('ignored', 'No number.');
  end if;
  customer := private.match_contact(requested_org, 'sms', counterpart);
  conversation := private.conversation_for(requested_org, customer, counterpart);
  record := case when customer is not null then private.latest_record_for_contact(customer) end;
  added := private.upsert_quo_call(requested_org, conversation, record, requested_call);

  select * into stored from public.conversation_messages
  where org_id = requested_org and channel = 'call' and provider_message_id = requested_call ->> 'id';
  if found then
    perform private.touch_conversation(conversation, 'call', stored.direction, private.stored_message_preview(stored),
      stored.received_at,
      case when added and incoming and not coalesce((stored.call ->> 'answered')::boolean, false) then true end);
  end if;
  return jsonb_build_object('conversationId', conversation, 'added', added);
end
$$;

-- A call the company's manager is about to play (service role, from the quo
-- function): what's known about it, and the voicemail once Quo has it.
create function public.quo_call(requested_org uuid, requested_id text, requested_voicemail jsonb default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  stored public.conversation_messages%rowtype;
begin
  select * into stored from public.conversation_messages
  where org_id = requested_org and channel = 'call' and provider_message_id = requested_id;
  if not found then
    return null;
  end if;
  if jsonb_typeof(requested_voicemail) = 'object' then
    perform private.upsert_quo_call(requested_org, stored.conversation_id, stored.record_id,
      jsonb_build_object('id', requested_id, 'voicemail', requested_voicemail));
    select * into stored from public.conversation_messages where id = stored.id;
    perform private.touch_conversation(stored.conversation_id, 'call', stored.direction,
      private.stored_message_preview(stored), stored.received_at, null);
  end if;
  return jsonb_build_object('direction', stored.direction, 'call', stored.call);
end
$$;

-- Photos with sent messages ----------------------------------------------------------

alter table public.outbound_messages
  add column attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array');

-- Removing an upload goes through the Storage API, which only deletes what the
-- person can also read; the bucket is public, so this exposes nothing new.
create policy "Company managers read document assets" on storage.objects for select to authenticated
  using (bucket_id = 'document-assets'
    and private.try_uuid((storage.foldername(name))[1]) in (select private.my_managed_org_ids()));

-- Up to five photos the company uploaded to its public document assets:
-- [{url, name, contentType}].
create function private.clean_attachments(company uuid, requested jsonb)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  cleaned jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'url', a ->> 'url', 'name', left(nullif(btrim(a ->> 'name'), ''), 200),
      'contentType', left(nullif(btrim(a ->> 'contentType'), ''), 100))), '[]'::jsonb)
  into cleaned
  from jsonb_array_elements(case when jsonb_typeof(requested) = 'array' then requested else '[]'::jsonb end) a
  where a ->> 'url' like 'https://%/storage/v1/object/public/document-assets/' || company::text || '/%';
  if jsonb_array_length(cleaned) > 5 then
    raise exception 'Attach up to five photos.' using errcode = '22023';
  end if;
  return cleaned;
end
$$;

drop function public.reply_to_conversation(uuid, text, text, text);
create function public.reply_to_conversation(
  requested_conversation uuid, requested_channel text, requested_subject text, requested_body text,
  requested_attachments jsonb default '[]'::jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  conversation public.conversations%rowtype;
  customer public.contacts%rowtype;
  destination text;
  message_id uuid := gen_random_uuid();
  clean_subject text := nullif(btrim(requested_subject), '');
  photos jsonb;
begin
  select * into conversation from public.conversations where id = requested_conversation;
  if not found or not private.is_org_manager(conversation.org_id) then
    raise exception 'Only managers can message customers.' using errcode = '42501';
  end if;
  photos := private.clean_attachments(conversation.org_id, requested_attachments);
  if requested_channel not in ('email', 'sms')
    or (nullif(btrim(requested_body), '') is null and jsonb_array_length(photos) = 0) then
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
    id, org_id, record_id, contact_id, conversation_id, channel, subject, body, to_override, attachments)
  values (
    message_id, conversation.org_id,
    case when conversation.contact_id is not null then private.latest_record_for_contact(conversation.contact_id) end,
    conversation.contact_id, conversation.id, requested_channel,
    case when requested_channel = 'email' then left(clean_subject, 200) end,
    btrim(requested_body),
    case when conversation.contact_id is null then destination end,
    photos);
  perform private.touch_conversation(conversation.id, requested_channel, 'outbound',
    private.message_preview(requested_body, clean_subject, jsonb_array_length(photos) > 0), now(), false);
  return message_id;
end
$$;

drop function public.queue_customer_message(uuid, text, text, text);
create function public.queue_customer_message(
  requested_record uuid, requested_channel text, requested_subject text, requested_body text,
  requested_attachments jsonb default '[]'::jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.org_of_project(requested_record);
  message_id uuid := gen_random_uuid();
  customer uuid;
  conversation uuid;
  photos jsonb;
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can message customers.' using errcode = '42501';
  end if;
  photos := private.clean_attachments(company, requested_attachments);
  if requested_channel not in ('email', 'sms')
    or (nullif(btrim(requested_body), '') is null and jsonb_array_length(photos) = 0) then
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
  insert into public.outbound_messages (id, org_id, record_id, contact_id, conversation_id, channel, subject, body, attachments)
  values (message_id, company, requested_record, customer, conversation,
    requested_channel, nullif(btrim(requested_subject), ''), btrim(requested_body), photos);
  if conversation is not null then
    perform private.touch_conversation(conversation, requested_channel, 'outbound',
      private.message_preview(requested_body, requested_subject, jsonb_array_length(photos) > 0), now(), false);
  end if;
  return message_id;
end
$$;

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
      'attachments', m.attachments,
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
        private.fill_placeholders(done.body, c.name, o.name, o.phone), done.subject,
        jsonb_array_length(done.attachments) > 0), now(), null)
    from public.organizations o
    left join public.contacts c on c.id = done.contact_id
    where o.id = done.org_id;
  end if;
end
$$;

-- Threads: calls, sent photos, and earlier pages --------------------------------------

drop function private.thread_items(uuid, uuid, uuid);
create function private.thread_items(
  company uuid, requested_contact uuid, requested_conversation uuid, requested_before timestamptz default null)
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
          'kind', case when cm.direction = 'outbound' and cm.channel <> 'call' then 'quo' end,
          'error', null, 'deliveredAt', null, 'authorName', null,
          'from', cm.from_address, 'to', cm.to_address,
          -- Quo's call id, to fetch its recording or voicemail.
          'call', case when cm.channel = 'call'
            then coalesce(cm.call, '{}'::jsonb) || jsonb_build_object('id', cm.provider_message_id) end) as item
      from public.conversation_messages cm
      where requested_conversation is not null and cm.conversation_id = requested_conversation
        and (requested_before is null or cm.received_at < requested_before)
      union all
      select m.id, coalesce(m.sent_at, m.scheduled_for), jsonb_build_object(
          'id', m.id, 'direction', 'outbound', 'channel', m.channel,
          'subject', private.fill_placeholders(m.subject, c.name, o.name, o.phone),
          'body', private.fill_placeholders(m.body, c.name, o.name, o.phone),
          'attachments', m.attachments, 'at', coalesce(m.sent_at, m.scheduled_for),
          'status', m.status, 'kind', private.message_kind(m), 'error', m.error,
          'deliveredAt', m.delivered_at, 'authorName', e.full_name,
          'from', null, 'to', coalesce(m.to_override, case m.channel when 'email' then c.email else c.phone end),
          'call', null)
      from public.outbound_messages m
      join public.organizations o on o.id = m.org_id
      left join public.contacts c on c.id = m.contact_id
      left join public.employees e on e.id = m.created_by
      where m.org_id = company and m.status <> 'cancelled'
        and m.scheduled_for <= now() + interval '5 minutes'
        and (requested_before is null or coalesce(m.sent_at, m.scheduled_for) < requested_before)
        and ((requested_contact is not null and m.contact_id = requested_contact and m.to_override is null)
          or (requested_conversation is not null and m.conversation_id = requested_conversation))
    ) everything
    order by at desc, id
    limit 300
  ) recent
$$;

create or replace function private.thread(company uuid, requested_conversation uuid, requested_contact uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', v.id,
    'orgId', company,
    'isUnread', coalesce(v.is_unread, false),
    'handle', v.handle,
    'name', v.name,
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

-- The page of a thread before the oldest message showing, for a conversation
-- (the inbox) or a customer (a deal's Communications tab).
create function public.get_earlier_messages(
  requested_conversation uuid, requested_contact uuid, requested_before timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := coalesce(
    (select org_id from public.conversations where id = requested_conversation),
    (select org_id from public.contacts where id = requested_contact));
  conversation uuid;
  customer uuid;
begin
  if company is null or requested_before is null then
    return '[]'::jsonb;
  end if;
  if not private.is_org_manager(company) then
    raise exception 'Only managers can read messages.' using errcode = '42501';
  end if;
  select v.id, coalesce(v.contact_id, requested_contact) into conversation, customer
  from (select 1) x
  left join public.conversations v on v.id = requested_conversation
    or (requested_conversation is null and v.org_id = company and v.contact_id = requested_contact);
  return private.thread_items(company, customer, conversation, requested_before);
end
$$;

-- Inbox: longer lists ------------------------------------------------------------------

drop function public.get_inbox(text, text);
create function public.get_inbox(
  requested_filter text default 'all', requested_search text default null, requested_limit integer default 300)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
  term text := nullif(btrim(requested_search), '');
  digits text := nullif(regexp_replace(coalesce(requested_search, ''), '\D', '', 'g'), '');
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can open the inbox.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'unreadCount', (select count(*) from public.conversations
      where org_id = company and is_unread and last_message_at is not null),
    'conversations', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', v.id, 'contactId', v.contact_id, 'name', coalesce(nullif(btrim(v.contact_name), ''), v.name),
          'handle', coalesce(v.handle, nullif(btrim(v.contact_phone), ''), nullif(btrim(v.contact_email), '')),
          'preview', v.last_message_preview, 'channel', v.last_message_channel,
          'direction', v.last_message_direction, 'at', v.last_message_at, 'isUnread', v.is_unread)
        order by v.is_unread desc, v.last_message_at desc)
      from (
        select c.*, ct.name as contact_name, ct.phone as contact_phone, ct.email as contact_email
        from public.conversations c
        left join public.contacts ct on ct.id = c.contact_id
        where c.org_id = company and c.last_message_at is not null
          and case requested_filter
            when 'unread' then c.is_unread
            when 'sms' then exists (select 1 from public.conversation_messages cm
                where cm.conversation_id = c.id and cm.channel = 'sms')
              or exists (select 1 from public.outbound_messages m where m.conversation_id = c.id and m.channel = 'sms')
            when 'email' then exists (select 1 from public.conversation_messages cm
                where cm.conversation_id = c.id and cm.channel = 'email')
              or exists (select 1 from public.outbound_messages m where m.conversation_id = c.id and m.channel = 'email')
            when 'calls' then exists (select 1 from public.conversation_messages cm
                where cm.conversation_id = c.id and cm.channel = 'call')
            else true end
          and (term is null
            or ct.name ilike '%' || term || '%' or c.name ilike '%' || term || '%'
            or ct.email ilike '%' || term || '%' or c.handle ilike '%' || term || '%'
            or c.last_message_preview ilike '%' || term || '%'
            or (length(digits) >= 3 and regexp_replace(coalesce(ct.phone, c.handle, ''), '\D', '', 'g') like '%' || digits || '%'))
        order by c.is_unread desc, c.last_message_at desc
        limit least(greatest(coalesce(requested_limit, 300), 1), 3000)
      ) v
    ), '[]'::jsonb));
end
$$;

-- A number that isn't a customer yet becomes one ---------------------------------------

-- Moves an unknown number's conversation onto a customer (just created from
-- it). Returns the customer's conversation, which the messages now live in.
create function public.link_conversation_contact(requested_conversation uuid, requested_contact uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  conversation public.conversations%rowtype;
  linked uuid;
begin
  select * into conversation from public.conversations where id = requested_conversation;
  if not found or not private.is_org_manager(conversation.org_id) then
    raise exception 'Only managers can change conversations.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.contacts where id = requested_contact and org_id = conversation.org_id) then
    raise exception 'Choose a customer.' using errcode = '22023';
  end if;
  if conversation.contact_id is not null then
    return conversation.id;
  end if;
  linked := private.conversation_for(conversation.org_id, requested_contact, conversation.handle);
  update public.conversation_messages
  set record_id = private.latest_record_for_contact(requested_contact)
  where conversation_id = linked and record_id is null;
  update public.outbound_messages set contact_id = requested_contact, to_override = null
  where conversation_id = linked and contact_id is null;
  return linked;
end
$$;

-- Grants ---------------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'call_preview(text, jsonb)',
    'stored_message_preview(public.conversation_messages)',
    'upsert_quo_call(uuid, uuid, uuid, jsonb)',
    'clean_attachments(uuid, jsonb)',
    'thread_items(uuid, uuid, uuid, timestamptz)'
  ] loop
    execute format('revoke all on function private.%s from public, anon, authenticated', fn);
  end loop;
  foreach fn in array array[
    'reply_to_conversation(uuid, text, text, text, jsonb)',
    'queue_customer_message(uuid, text, text, text, jsonb)',
    'get_earlier_messages(uuid, uuid, timestamptz)',
    'get_inbox(text, text, integer)',
    'link_conversation_contact(uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  foreach fn in array array['receive_quo_call(uuid, jsonb)', 'quo_call(uuid, text, jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
