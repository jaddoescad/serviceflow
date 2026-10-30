-- Connecting Quo the way a person would: paste an API key, pick one of the
-- company's Quo lines, and ServiceFlow adds its own webhook for that line and
-- imports the line's past texts into the inbox. The quo function makes the
-- Quo calls; pg_cron keeps a running import going until it finishes. Texts
-- staff send now go out right away instead of on the next minute's run.
begin;

-- Connection and import state --------------------------------------------------

alter table private.org_messaging
  add column quo_phone_number_id text,
  add column quo_line_name text,
  add column quo_webhook_id text,
  add column quo_sync_status text check (quo_sync_status in ('running', 'done', 'failed')),
  -- Where a running import is: {"pageToken": ..., "skip": n}.
  add column quo_sync_cursor jsonb,
  -- Set for a "Sync now" after a finished import: only what changed since.
  add column quo_sync_since timestamptz,
  add column quo_sync_started_at timestamptz,
  add column quo_sync_finished_at timestamptz,
  add column quo_sync_error text,
  add column quo_sync_lease_until timestamptz,
  add column quo_synced_conversations integer not null default 0;

-- The name Quo shows for a number that isn't a customer yet.
alter table public.conversations add column name text check (char_length(name) <= 200);

-- Settings (managers) --------------------------------------------------------------

drop function public.save_messaging_settings(text, text, text);
drop function public.save_quo_webhook_secret(text);
drop function public.get_inbox_setup();

create or replace function public.get_messaging_settings()
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
    'quoConnected', settings.quo_api_key is not null and settings.quo_from_number is not null,
    'quoFromNumber', settings.quo_from_number,
    'quoLineName', settings.quo_line_name,
    'quoSync', case when settings.quo_api_key is not null then jsonb_build_object(
      'status', settings.quo_sync_status,
      'conversations', settings.quo_synced_conversations,
      'texts', (select count(*) from public.conversation_messages
        where org_id = company and channel = 'sms'),
      'calls', (select count(*) from public.conversation_messages
        where org_id = company and channel = 'call'),
      'startedAt', settings.quo_sync_started_at,
      'finishedAt', settings.quo_sync_finished_at,
      'error', settings.quo_sync_error) end,
    'lastTextReceivedAt', settings.last_text_received_at,
    'lastEmailReceivedAt', settings.last_email_received_at,
    'replyToEmail', settings.reply_to_email);
end
$$;

create function public.save_reply_to_email(requested_reply_to_email text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can change messaging settings.' using errcode = '42501';
  end if;
  insert into private.org_messaging as m (org_id, reply_to_email)
  values (company, nullif(btrim(requested_reply_to_email), ''))
  on conflict (org_id) do update set reply_to_email = excluded.reply_to_email, updated_at = now();
end
$$;

-- The signed-in manager's company, for the quo function.
create function public.quo_manager_org()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  company uuid := private.home_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can connect Quo.' using errcode = '42501';
  end if;
  return company;
end
$$;

-- Connecting (service role only) -----------------------------------------------------

-- The company's current Quo connection, creating its messaging row (and so its
-- webhook token) the first time.
create function public.quo_connection(requested_org uuid)
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
    'webhookId', settings.quo_webhook_id,
    'webhookToken', settings.quo_webhook_token);
end
$$;

-- Saves the key, line and webhook, and starts importing the line's texts.
create function public.save_quo_connection(requested_org uuid, requested_connection jsonb)
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

-- Imported texts stay in the inbox.
create function public.clear_quo_connection(requested_org uuid)
returns void
language sql security definer set search_path = ''
as $$
  update private.org_messaging set
    quo_api_key = null, quo_phone_number_id = null, quo_from_number = null, quo_line_name = null,
    quo_webhook_id = null, quo_webhook_secret = null,
    quo_sync_status = null, quo_sync_cursor = null, quo_sync_since = null, quo_sync_started_at = null,
    quo_sync_finished_at = null, quo_sync_error = null, quo_sync_lease_until = null, quo_synced_conversations = 0,
    updated_at = now()
  where org_id = requested_org
$$;

-- Importing (service role only) ------------------------------------------------------

-- "Sync now": after a finished import, only conversations with activity since
-- it began; otherwise the whole line again (texts already here are skipped).
create function public.start_quo_sync(requested_org uuid)
returns void
language sql security definer set search_path = ''
as $$
  update private.org_messaging set
    quo_sync_since = case when quo_sync_status = 'done' then quo_sync_started_at - interval '10 minutes' end,
    quo_sync_status = 'running',
    quo_sync_cursor = null,
    quo_sync_started_at = now(),
    quo_sync_finished_at = null,
    quo_sync_error = null,
    quo_sync_lease_until = null,
    quo_synced_conversations = 0
  where org_id = requested_org and quo_api_key is not null and quo_sync_status is distinct from 'running'
$$;

-- Takes a running import (one company's, or any) for a few minutes so two
-- runs never work the same line at once.
create function public.claim_quo_sync(requested_org uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  claimed private.org_messaging%rowtype;
begin
  update private.org_messaging s set quo_sync_lease_until = now() + interval '3 minutes'
  where s.org_id = (
    select org_id from private.org_messaging
    where quo_sync_status = 'running' and quo_api_key is not null and quo_phone_number_id is not null
      and (quo_sync_lease_until is null or quo_sync_lease_until < now())
      and (requested_org is null or org_id = requested_org)
    order by quo_sync_started_at
    limit 1
    for update skip locked)
  returning * into claimed;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'orgId', claimed.org_id,
    'apiKey', claimed.quo_api_key,
    'phoneNumberId', claimed.quo_phone_number_id,
    'number', claimed.quo_from_number,
    'cursor', claimed.quo_sync_cursor,
    'since', claimed.quo_sync_since);
end
$$;

-- {cursor, conversations (added), status: running | done | failed, error,
-- release}. Ignored once the import was stopped (Quo disconnected).
create function public.save_quo_sync_progress(requested_org uuid, requested_progress jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  next_status text := coalesce(requested_progress ->> 'status', 'running');
begin
  if next_status not in ('running', 'done', 'failed') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  update private.org_messaging set
    quo_sync_status = next_status,
    quo_sync_cursor = case when next_status = 'running' then requested_progress -> 'cursor' end,
    quo_synced_conversations = quo_synced_conversations
      + greatest(coalesce((requested_progress ->> 'conversations')::integer, 0), 0),
    quo_sync_error = case when next_status = 'failed' then left(requested_progress ->> 'error', 500) end,
    quo_sync_finished_at = case when next_status <> 'running' then now() end,
    quo_sync_lease_until = case when next_status = 'running' and not coalesce((requested_progress ->> 'release')::boolean, false)
      then now() + interval '3 minutes' end
  where org_id = requested_org and quo_sync_status = 'running';
end
$$;

-- A timestamp, or null when the text isn't one.
create function private.try_timestamptz(value text)
returns timestamptz
language plpgsql stable set search_path = ''
as $$
begin
  return value::timestamptz;
exception when others then
  return null;
end
$$;
revoke all on function private.try_timestamptz(text) from public, anon, authenticated;

-- Stores one Quo conversation's texts, threaded to the customer with that
-- number (or kept under the number, with Quo's name for it). Texts already
-- here, or sent from ServiceFlow, are skipped; nothing is marked unread and
-- nobody is notified. Returns how many texts were added.
create function public.import_quo_conversation(requested_org uuid, requested_conversation jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  participant text := private.e164(requested_conversation ->> 'participant');
  quo_name text := left(nullif(btrim(requested_conversation ->> 'name'), ''), 200);
  customer uuid;
  conversation uuid;
  record uuid;
  latest public.conversation_messages%rowtype;
  added integer;
begin
  if participant is null or jsonb_typeof(requested_conversation -> 'messages') is distinct from 'array'
    or jsonb_array_length(requested_conversation -> 'messages') = 0 then
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
    from jsonb_array_elements(requested_conversation -> 'messages') m
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

  select * into latest from public.conversation_messages
  where conversation_id = conversation order by received_at desc limit 1;
  if found then
    perform private.touch_conversation(conversation, latest.channel, latest.direction,
      private.message_preview(latest.body, latest.subject, jsonb_array_length(latest.attachments) > 0),
      latest.received_at, null);
  end if;
  return added;
end
$$;

-- Inbox: Quo's names for unknown numbers, and search -------------------------------

drop function public.get_inbox(text);
create function public.get_inbox(requested_filter text default 'all', requested_search text default null)
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
            else true end
          and (term is null
            or ct.name ilike '%' || term || '%' or c.name ilike '%' || term || '%'
            or ct.email ilike '%' || term || '%' or c.handle ilike '%' || term || '%'
            or c.last_message_preview ilike '%' || term || '%'
            or (length(digits) >= 3 and regexp_replace(coalesce(ct.phone, c.handle, ''), '\D', '', 'g') like '%' || digits || '%'))
        order by c.is_unread desc, c.last_message_at desc
        limit 300
      ) v
    ), '[]'::jsonb));
end
$$;

create or replace function private.thread(company uuid, requested_conversation uuid, requested_contact uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', v.id,
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

-- Sending right away -------------------------------------------------------------------

-- A message due now wakes send-messages instead of waiting for the next
-- minute's run. The run still happens if this can't.
create function private.send_messages_now()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  base text;
  secret text;
begin
  if not exists (select 1 from inserted where status = 'queued' and scheduled_for <= now()) then
    return null;
  end if;
  select decrypted_secret into base from vault.decrypted_secrets where name = 'project_url' limit 1;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'messages_cron_secret' limit 1;
  if base is null or secret is null then
    return null;
  end if;
  perform net.http_post(
    url := base || '/functions/v1/send-messages',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || secret),
    body := '{}'::jsonb);
  return null;
end
$$;
revoke all on function private.send_messages_now() from public, anon, authenticated;

create trigger outbound_messages_send_now
  after insert on public.outbound_messages
  referencing new table as inserted
  for each statement execute function private.send_messages_now();

-- Grants ---------------------------------------------------------------------------------

do $$
declare
  fn text;
begin
  foreach fn in array array['save_reply_to_email(text)', 'quo_manager_org()', 'get_inbox(text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
  foreach fn in array array[
    'quo_connection(uuid)',
    'save_quo_connection(uuid, jsonb)',
    'clear_quo_connection(uuid)',
    'start_quo_sync(uuid)',
    'claim_quo_sync(uuid)',
    'save_quo_sync_progress(uuid, jsonb)',
    'import_quo_conversation(uuid, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end
$$;

-- Keeps a running import going: one call a minute, only while one is running.
select cron.schedule(
  'quo-sync',
  '* * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
      limit 1
    ) || '/functions/v1/quo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'messages_cron_secret'
        limit 1
      )
    ),
    body := '{}'::jsonb
  )
  where exists (select 1 from private.org_messaging where quo_sync_status = 'running');
  $$
);

select pg_notify('pgrst', 'reload schema');

commit;
