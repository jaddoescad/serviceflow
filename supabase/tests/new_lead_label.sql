-- Run after 20261109150748_new_lead_label.sql inside a transaction and ROLLBACK.
do $$
declare
  company uuid;
  member uuid;
  outsider uuid;
  contact uuid;
  from_web uuid := gen_random_uuid();
  by_staff uuid := gen_random_uuid();
  started timestamp := timezone('utc', clock_timestamp());
begin
  -- A member whose home company is the one under test.
  select m.org_id, m.user_id into company, member
  from public.org_members m
  join public.organizations o on o.id = m.org_id and o.status = 'active'
  where m.is_active
    and exists (select 1 from public.leads l where l.org_id = m.org_id)
    and m.org_id = (
      select m2.org_id from public.org_members m2 join public.organizations o2 on o2.id = m2.org_id
      where m2.user_id = m.user_id and m2.is_active and o2.status = 'active'
      order by m2.created_at, m2.org_id limit 1)
  limit 1;
  select m.user_id into outsider from public.org_members m
  where m.is_active and not exists (
    select 1 from public.org_members x where x.user_id = m.user_id and x.org_id = company and x.is_active
  ) limit 1;
  select l.contact_id into contact from public.leads l where l.org_id = company limit 1;
  if company is null or member is null or contact is null then raise exception 'Test prerequisites missing'; end if;

  if exists (select 1 from public.leads l where not exists (select 1 from public.lead_openings o where o.lead_id = l.id)
             and l.created_at < timezone('utc', started)) then
    raise exception 'Existing leads were not all marked opened';
  end if;

  -- A lead from outside (no signed-in user) is new; one a staff member adds is not.
  perform set_config('request.jwt.claims', '', true);
  insert into public.leads (id, contact_id, status, captured_at, created_at)
  select from_web, contact, l.status, now(), now() from public.leads l where l.org_id = company limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', member, 'role', 'authenticated')::text, true);
  insert into public.leads (id, contact_id, status, captured_at, created_at)
  select by_staff, contact, l.status, now(), now() from public.leads l where l.org_id = company limit 1;

  perform set_config('role', 'authenticated', true);
  if not exists (select 1 from public.get_new_lead_ids() id where id = from_web) then raise exception 'Outside lead is not new'; end if;
  if exists (select 1 from public.get_new_lead_ids() id where id = by_staff) then raise exception 'Staff-added lead shows as new'; end if;

  -- Someone outside the company can't clear it; opening the deal does.
  if outsider is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', outsider, 'role', 'authenticated')::text, true);
    perform public.mark_lead_opened(from_web);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', member, 'role', 'authenticated')::text, true);
    if not exists (select 1 from public.get_new_lead_ids() id where id = from_web) then raise exception 'Outsider cleared the label'; end if;
  end if;
  perform public.mark_lead_opened(from_web);
  if exists (select 1 from public.get_new_lead_ids() id where id = from_web) then raise exception 'Opening did not clear the label'; end if;
  perform set_config('role', 'none', true);
  if (select opened_by from public.lead_openings where lead_id = from_web) is distinct from member then
    raise exception 'Opening not credited to the member';
  end if;

  -- Openings refresh teammates' boards on the company's leads topic.
  if (select count(*) from realtime.messages
      where topic = 'org:' || company || ':leads' and event = 'INSERT' and payload ->> 'table' = 'leads'
        and inserted_at >= started) < 3 then
    raise exception 'Lead and opening inserts were not all broadcast';
  end if;
end
$$;
