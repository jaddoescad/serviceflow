-- Debug, for testing Appointment workflows: wipe a test thread so the next
-- text starts a fresh card. Only works for the owner's test phone
-- (Jad Slim, +16137001531); every message in the thread must be with it.
-- Remove this once testing is done.
create or replace function public.workflow_debug_reset(requested_card uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := public.booking_staff_org();
  test_phone constant text := '+16137001531';
  card public.workflow_cards;
begin
  select * into card from public.workflow_cards where id = requested_card and org_id = company;
  if card.id is null then
    raise exception 'That card is gone.' using errcode = 'P0002';
  end if;
  if card.conversation_id is null
    or not exists (select 1 from public.conversation_messages m where m.conversation_id = card.conversation_id)
    or exists (
      select 1 from public.conversation_messages m
      where m.conversation_id = card.conversation_id
        and test_phone not in (coalesce(m.from_address, ''), coalesce(m.to_address, ''))) then
    raise exception 'Only the test phone''s thread can be cleared.' using errcode = '42501';
  end if;
  delete from public.workflow_events where card_id = card.id;
  delete from public.workflow_cards where id = card.id;
  delete from public.conversation_messages where conversation_id = card.conversation_id;
  delete from public.outbound_messages where conversation_id = card.conversation_id;
end
$$;

revoke all on function public.workflow_debug_reset(uuid) from public, anon;
grant execute on function public.workflow_debug_reset(uuid) to authenticated;
