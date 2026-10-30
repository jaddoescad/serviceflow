-- Run inside BEGIN/ROLLBACK after 20261024100000_two_way_messaging. Uses the
-- Brightline demo company; every row is rolled back.
create temporary table inbox_fixture (
  org uuid, owner uuid, crew uuid, contact_a uuid, contact_b uuid, lead uuid,
  conversation_a uuid, conversation_b uuid, sms_reply uuid, email_reply uuid, deal_message uuid);
grant select, update on inbox_fixture to authenticated, anon;

insert into inbox_fixture (org, owner, crew, contact_a, lead)
values ('50e643e1-5c1e-40dd-93e8-d65743b3aa61', 'dee00000-0000-4000-8000-0000000000a1',
  'dee00000-0000-4000-8000-0000000000a2', gen_random_uuid(), gen_random_uuid());

select set_config('serviceflow.org_id', '50e643e1-5c1e-40dd-93e8-d65743b3aa61', true);
insert into public.contacts (id, kind, name, email, phone, org_id)
select contact_a, 'customer', 'Inbox Fixture', 'inbox.fixture@example.com', '(613) 555-0101', org from inbox_fixture;
insert into public.leads (id, contact_id, status, source, created_at, captured_at, org_id)
select lead, contact_a, 'new', 'Test', now(), now(), org from inbox_fixture;
insert into private.org_messaging (org_id, quo_api_key, quo_from_number)
select org, 'test-key', '+16135550000' from inbox_fixture
on conflict (org_id) do update set quo_api_key = 'test-key', quo_from_number = '+16135550000';

-- Receiving, as the webhook functions do.
do $$
declare
  f inbox_fixture%rowtype;
  result jsonb;
  stray uuid;
begin
  select * into f from inbox_fixture;
  if (public.get_quo_webhook((select quo_webhook_token from private.org_messaging where org_id = f.org)) ->> 'orgId')::uuid <> f.org then
    raise exception 'Webhook token does not find the company';
  end if;
  if public.get_quo_webhook('short') is not null then raise exception 'Short token accepted'; end if;

  result := public.receive_inbound_message(f.org, jsonb_build_object(
    'channel', 'sms', 'from', '+16135550101', 'to', '+16135550000', 'body', 'Is Tuesday ok?',
    'providerId', 'fixture-1', 'receivedAt', now() - interval '10 minutes', 'attachments', jsonb_build_array(jsonb_build_object('url', 'https://example.com/a.jpg', 'contentType', 'image/jpeg'))));
  update inbox_fixture set conversation_a = (result ->> 'conversationId')::uuid;
  if not exists (select 1 from public.conversations where id = (result ->> 'conversationId')::uuid
      and contact_id = f.contact_a and is_unread and last_message_preview = 'Is Tuesday ok?') then
    raise exception 'Text was not threaded to the customer: %', result;
  end if;
  if not exists (select 1 from public.notifications where kind = 'message_received' and user_id = f.owner
      and record_id = f.lead and link = '/inbox?c=' || (result ->> 'conversationId')) then
    raise exception 'Owner was not notified';
  end if;
  if public.receive_inbound_message(f.org, jsonb_build_object('channel', 'sms', 'from', '+16135550101',
      'body', 'Is Tuesday ok?', 'providerId', 'fixture-1')) ->> 'duplicate' is null then
    raise exception 'Webhook retry stored twice';
  end if;

  -- An unknown number gets its own conversation, then joins the customer
  -- created for it.
  result := public.receive_inbound_message(f.org, jsonb_build_object(
    'channel', 'sms', 'from', '6135550199', 'body', 'Who is this?', 'providerId', 'fixture-2'));
  stray := (result ->> 'conversationId')::uuid;
  if not exists (select 1 from public.conversations where id = stray and contact_id is null and handle = '+16135550199') then
    raise exception 'Unknown sender conversation missing';
  end if;
  update inbox_fixture set contact_b = gen_random_uuid();
  insert into public.contacts (id, kind, name, phone, org_id)
  select contact_b, 'customer', 'Second Fixture', '613-555-0199', org from inbox_fixture;
  result := public.receive_inbound_message(f.org, jsonb_build_object(
    'channel', 'sms', 'from', '+16135550199', 'body', 'It is me', 'providerId', 'fixture-3'));
  if exists (select 1 from public.conversations where id = stray) then raise exception 'Stray conversation kept'; end if;
  if (select count(*) from public.conversation_messages where conversation_id = (result ->> 'conversationId')::uuid) <> 2 then
    raise exception 'Earlier text did not join the new customer';
  end if;
  update inbox_fixture set conversation_b = (result ->> 'conversationId')::uuid;
end
$$;

-- Managing the inbox as the owner.
select set_config('request.jwt.claims', jsonb_build_object('sub', owner, 'role', 'authenticated')::text, true) from inbox_fixture;
set local role authenticated;
do $$
declare
  f inbox_fixture%rowtype;
  inbox jsonb;
  thread jsonb;
begin
  select * into f from inbox_fixture;
  inbox := public.get_inbox('all');
  if (inbox ->> 'unreadCount')::int < 2 or public.get_unread_conversation_count() < 2 then
    raise exception 'Unread count wrong: %', inbox ->> 'unreadCount';
  end if;
  if not exists (select 1 from jsonb_array_elements(inbox -> 'conversations') c where (c ->> 'id')::uuid = f.conversation_a) then
    raise exception 'Conversation missing from inbox';
  end if;
  if exists (select 1 from jsonb_array_elements(public.get_inbox('email') -> 'conversations') c where (c ->> 'id')::uuid = f.conversation_a) then
    raise exception 'Text-only conversation under Email';
  end if;

  update inbox_fixture set sms_reply = public.reply_to_conversation(f.conversation_a, 'sms', null, 'Yes, Tuesday works.');
  update inbox_fixture set email_reply = public.reply_to_conversation(f.conversation_a, 'email', 'Re: Tuesday', 'See you then.');
  update inbox_fixture set deal_message = public.queue_customer_message(f.lead, 'email', 'Your estimate', 'Attached.');
  select * into f from inbox_fixture;
  if (select is_unread from public.conversations where id = f.conversation_a) then raise exception 'Reply left it unread'; end if;
  if (select conversation_id from public.outbound_messages where id = f.deal_message) <> f.conversation_a then
    raise exception 'Deal message not in the conversation';
  end if;
  begin
    perform public.reply_to_conversation(f.conversation_a, 'email', '', 'No subject');
    raise exception 'Email without a subject accepted';
  exception when invalid_parameter_value then null; end;

  thread := public.get_conversation(f.conversation_a);
  if jsonb_array_length(thread -> 'messages') <> 4 or (thread -> 'record' ->> 'id')::uuid <> f.lead then
    raise exception 'Thread wrong: %', thread;
  end if;
  if (thread -> 'messages' -> 0 ->> 'direction') <> 'inbound'
    or jsonb_array_length(thread -> 'messages' -> 0 -> 'attachments') <> 1 then
    raise exception 'Thread order or attachments wrong';
  end if;
  if jsonb_array_length(public.get_contact_thread(f.contact_a) -> 'messages') <> 4 then
    raise exception 'Deal thread differs from inbox thread';
  end if;

  perform public.set_conversation_read(f.conversation_a, false);
  if not (select is_unread from public.conversations where id = f.conversation_a) then raise exception 'Mark unread failed'; end if;
  perform public.set_conversation_read(f.conversation_a, true);

  if not exists (select 1 from jsonb_array_elements(public.get_outbound_activity('queued')) a where (a ->> 'id')::uuid = f.sms_reply and a ->> 'kind' = 'manual') then
    raise exception 'Reply missing from activity';
  end if;
  if (public.get_inbox_setup() ->> 'quoWebhookToken') is null then raise exception 'Webhook token hidden'; end if;
  perform public.save_quo_webhook_secret('whsec');
  if not (public.get_inbox_setup() ->> 'quoWebhookSigned')::boolean then raise exception 'Secret not saved'; end if;
end
$$;
reset role;

-- Opt-outs by category, delivery and email replies, as the send/receive functions do.
do $$
declare
  f inbox_fixture%rowtype;
  drip public.outbound_messages%rowtype;
  claimed jsonb;
  result jsonb;
begin
  select * into f from inbox_fixture;
  insert into public.message_opt_outs (contact_id, channel, org_id, category) values (f.contact_a, 'email', f.org, 'drips');
  select * into drip from public.outbound_messages where id = f.email_reply;
  if private.opt_out_reason(drip) is not null then raise exception 'Drip opt-out blocked a reply'; end if;
  drip.drip_step_id := gen_random_uuid();
  if private.opt_out_reason(drip) <> 'Customer opted out of follow-up emails.' then raise exception 'Drip opt-out ignored'; end if;
  drip.drip_step_id := null;
  drip.reminder_rule_id := gen_random_uuid();
  if private.opt_out_reason(drip) is not null then raise exception 'Drip opt-out blocked a reminder'; end if;
  drip.to_override := 'staff@example.com';
  insert into public.message_opt_outs (contact_id, channel, org_id, category) values (f.contact_a, 'email', f.org, 'all');
  if private.opt_out_reason(drip) is not null then raise exception 'Opt-out blocked a test send'; end if;
  delete from public.message_opt_outs where contact_id = f.contact_a and category = 'all';

  claimed := public.claim_outbound_messages(200);
  if not exists (select 1 from jsonb_array_elements(claimed) c where (c ->> 'id')::uuid = f.email_reply
      and c ->> 'to' = 'inbox.fixture@example.com' and c ->> 'kind' = 'manual') then
    raise exception 'Reply not claimed: %', claimed;
  end if;
  perform public.complete_outbound_message(f.email_reply, 'sent', null, 'resend-fixture');
  perform public.complete_outbound_message(f.sms_reply, 'sent', null, 'quo-fixture');
  result := public.receive_inbound_message(f.org, jsonb_build_object(
    'channel', 'sms', 'direction', 'outbound', 'from', '+16135550000', 'to', '+16135550101',
    'body', 'Yes, Tuesday works.', 'providerId', 'quo-fixture'));
  if (select delivered_at from public.outbound_messages where id = f.sms_reply) is null then
    raise exception 'Delivery report not recorded: %', result;
  end if;

  result := public.receive_inbound_message(null, jsonb_build_object(
    'channel', 'email', 'from', 'someone.else@example.com', 'to', 'reply+' || replace(f.email_reply::text, '-', '') || '@in.example.com',
    'subject', 'Re: Tuesday', 'body', 'Thanks!', 'providerId', '<fixture@mail>',
    'replyToken', replace(f.email_reply::text, '-', '')));
  if (result ->> 'conversationId')::uuid <> f.conversation_a then raise exception 'Email reply not threaded: %', result; end if;
  if (select record_id from public.conversation_messages where id = (result ->> 'messageId')::uuid) <> f.lead then
    raise exception 'Email reply lost its deal';
  end if;
  if public.receive_inbound_message(null, jsonb_build_object('channel', 'email', 'from', 'x@example.com',
      'replyToken', 'ffffffffffffffffffffffffffffffff')) ->> 'ignored' is null then
    raise exception 'Unknown reply token accepted';
  end if;

  perform public.record_message_delivery('resend-fixture', 'bounced', 'Mailbox full');
  if (select status from public.outbound_messages where id = f.email_reply) <> 'failed' then raise exception 'Bounce not recorded'; end if;
end
$$;

-- The customer's preferences page.
set local role anon;
do $$
declare
  f inbox_fixture%rowtype;
  prefs jsonb;
begin
  select * into f from inbox_fixture;
  prefs := public.get_message_preferences(f.email_reply);
  if prefs ->> 'email' <> 'drips' or prefs ->> 'sms' <> 'none' then raise exception 'Preferences wrong: %', prefs; end if;
  perform public.save_message_preferences(f.email_reply, '{"email": "none", "sms": "reminders"}');
  prefs := public.get_message_preferences(f.email_reply);
  if prefs ->> 'email' <> 'none' or prefs ->> 'sms' <> 'reminders' then raise exception 'Preferences not saved: %', prefs; end if;
  begin
    perform public.save_message_preferences(f.email_reply, '{"email": "everything"}');
    raise exception 'Unknown preference accepted';
  exception when invalid_parameter_value then null; end;
end
$$;
reset role;

-- Crew can't read the inbox.
select set_config('request.jwt.claims', jsonb_build_object('sub', crew, 'role', 'authenticated')::text, true) from inbox_fixture;
set local role authenticated;
do $$
begin
  if exists (select 1 from public.conversations) then raise exception 'Crew can read conversations'; end if;
  if public.get_unread_conversation_count() <> 0 then raise exception 'Crew sees an unread count'; end if;
  begin
    perform public.get_inbox('all');
    raise exception 'Crew opened the inbox';
  exception when insufficient_privilege then null; end;
end
$$;
reset role;

select 'two_way_messaging ok' as result;
