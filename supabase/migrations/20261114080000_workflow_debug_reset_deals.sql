-- Debug: "Clear test thread" also clears the test phone's sent texts and
-- emails and its test deals (with their visits and notes) that have no
-- proposal, job or workspace, so each test starts as a brand-new customer.
-- Only for the owner's test phone (Jad Slim, +16137001531). Remove once
-- testing is done.
create or replace function public.workflow_debug_reset(requested_card uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := public.booking_staff_org();
  test_phone constant text := '+16137001531';
  card public.workflow_cards;
  person uuid;
  deals uuid[];
begin
  select * into card from public.workflow_cards where id = requested_card and org_id = company;
  if card.id is null then
    raise exception 'That card is gone.' using errcode = 'P0002';
  end if;
  person := coalesce(
    (select l.contact_id from public.leads l where l.id = card.lead_id),
    (select cv.contact_id from public.conversations cv where cv.id = card.conversation_id));
  -- The card must be the test phone's: its contact (or thread) is that number,
  -- and nobody else is in the thread.
  if not (
      (person is not null and exists (select 1 from public.contacts c where c.id = person
        and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = right(test_phone, 10)))
      or exists (select 1 from public.conversations cv where cv.id = card.conversation_id
        and right(regexp_replace(coalesce(cv.handle, ''), '\D', '', 'g'), 10) = right(test_phone, 10)))
    or exists (
      select 1 from public.conversation_messages m
      where m.conversation_id = card.conversation_id
        and test_phone not in (coalesce(m.from_address, ''), coalesce(m.to_address, ''))) then
    raise exception 'Only the test phone''s thread can be cleared.' using errcode = '42501';
  end if;

  deals := array(
    select l.id from public.leads l
    where l.org_id = company and (l.id = card.lead_id or (person is not null and l.contact_id = person))
      and not exists (select 1 from public.quotes q where q.lead_id = l.id)
      and not exists (select 1 from public.jobs j where j.lead_id = l.id)
      and not exists (select 1 from public.project_workspace w where w.lead_id = l.id));

  delete from public.workflow_events e using public.workflow_cards w
  where e.card_id = w.id and (w.id = card.id or w.lead_id = any(deals));
  delete from public.workflow_cards w where w.id = card.id or w.lead_id = any(deals);
  delete from public.conversation_messages where conversation_id = card.conversation_id;
  delete from public.outbound_messages
  where org_id = company and (conversation_id = card.conversation_id or (person is not null and contact_id = person));
  delete from public.appointments where org_id = company and project_id = any(deals);
  delete from public.project_notes where org_id = company and project_id = any(deals);
  delete from public.leads where id = any(deals);
end
$$;
