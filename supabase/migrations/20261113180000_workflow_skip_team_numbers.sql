-- Appointment workflows: an unknown number is only a new inquiry when they
-- reach out first. Texts and calls from the team's own phones, and numbers we
-- were already texting with (a painter about a job, a supplier), aren't leads.
-- Skip them, and remove the cards they made.
begin;

create function private.workflow_is_team_number(company uuid, handle text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select char_length(regexp_replace(coalesce(handle, ''), '\D', '', 'g')) >= 10
    and exists (
      select 1 from public.org_members m
      join public.employees e on e.id = m.user_id
      where m.org_id = company
        and char_length(regexp_replace(coalesce(e.phone, ''), '\D', '', 'g')) >= 10
        and right(regexp_replace(e.phone, '\D', '', 'g'), 10) = right(regexp_replace(handle, '\D', '', 'g'), 10))
$$;
revoke all on function private.workflow_is_team_number(uuid, text) from public, anon, authenticated;

-- We had already written to them (from ServiceFlow or the Quo app) before this.
create function private.workflow_already_talking(conversation uuid, before timestamptz)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.outbound_messages o
      where o.conversation_id = conversation and not o.sent_by_agent and o.created_at < before)
    or exists (select 1 from public.conversation_messages m
      where m.conversation_id = conversation and m.direction = 'outbound' and m.received_at < before)
$$;
revoke all on function private.workflow_already_talking(uuid, timestamptz) from public, anon, authenticated;

create or replace function private.workflow_message_arrived()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  conversation public.conversations%rowtype;
  what text;
begin
  if new.direction <> 'inbound' or new.channel not in ('sms', 'call') then
    return null;
  end if;
  if tg_op = 'UPDATE' and (new.call -> 'voicemail') is not distinct from (old.call -> 'voicemail') then
    return null;
  end if;
  select * into conversation from public.conversations where id = new.conversation_id;
  what := case
    when new.channel = 'sms' then 'text'
    when jsonb_typeof(new.call -> 'voicemail') = 'object' then 'voicemail'
    when not coalesce((new.call ->> 'answered')::boolean, false) then 'missed_call'
    else 'call' end;

  if conversation.contact_id is null then
    if conversation.handle is null or conversation.handle like '%@%'
      or private.workflow_is_team_number(conversation.org_id, conversation.handle) then
      return null;
    end if;
    if not exists (select 1 from public.workflow_cards w where w.conversation_id = conversation.id)
      and private.workflow_already_talking(conversation.id, new.received_at) then
      return null;
    end if;
    insert into public.workflow_cards as w (org_id, conversation_id, kind, activity_at)
    values (conversation.org_id, conversation.id, what, new.received_at)
    on conflict (conversation_id) do update set
      kind = case when excluded.kind = 'voicemail' and w.kind in ('missed_call', 'call')
        then 'voicemail' else w.kind end,
      stage = case when w.stage = 'waiting' then 'new' else w.stage end,
      suggestion = case when w.stage in ('new', 'waiting') then null else w.suggestion end,
      suggested_at = case when w.stage in ('new', 'waiting') then null else w.suggested_at end,
      activity_at = greatest(w.activity_at, excluded.activity_at),
      updated_at = now();
  else
    update public.workflow_cards w set
      stage = case when w.stage = 'waiting' then 'new' else w.stage end,
      suggestion = case when w.stage in ('new', 'waiting') then null else w.suggestion end,
      suggested_at = case when w.stage in ('new', 'waiting') then null else w.suggested_at end,
      activity_at = greatest(w.activity_at, new.received_at),
      updated_at = now()
    where w.org_id = conversation.org_id
      and w.stage in ('new', 'waiting', 'needs_you')
      and (w.conversation_id = conversation.id
        or w.lead_id in (select l.id from public.leads l where l.contact_id = conversation.contact_id));
  end if;
  return null;
end
$$;
delete from public.workflow_cards w
using public.conversations cv
where cv.id = w.conversation_id and w.lead_id is null
  and (private.workflow_is_team_number(w.org_id, cv.handle)
    or private.workflow_already_talking(cv.id, w.created_at - interval '1 minute'));

commit;
