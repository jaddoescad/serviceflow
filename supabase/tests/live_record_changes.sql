-- Run after 20261109144447_live_record_changes.sql inside a transaction and ROLLBACK.
do $$
declare
  company uuid;
  member uuid;
  outsider uuid;
  new_lead uuid := gen_random_uuid();
  -- realtime.messages stamps rows with UTC clock time.
  started timestamp := timezone('utc', clock_timestamp());
  sent int;
begin
  select l.org_id into company
  from public.leads l join public.organizations o on o.id = l.org_id and o.status = 'active'
  group by l.org_id having count(*) >= 2 limit 1;
  select m.user_id into member from public.org_members m where m.org_id = company and m.is_active limit 1;
  select m.user_id into outsider from public.org_members m
  where m.is_active and not exists (
    select 1 from public.org_members x where x.user_id = m.user_id and x.org_id = company and x.is_active
  ) limit 1;
  if company is null or member is null then raise exception 'Test prerequisites missing'; end if;

  -- A statement touching several leads sends one message for the company.
  update public.leads set captured_at = captured_at
  where id in (select id from public.leads where org_id = company limit 2);
  select count(*) into sent from realtime.messages
  where topic = 'org:' || company || ':leads' and event = 'UPDATE' and inserted_at >= started;
  if sent <> 1 then raise exception 'Expected one leads UPDATE message, got %', sent; end if;

  -- New and removed leads announce themselves too, carrying no customer data
  -- (realtime.send adds its own message id).
  insert into public.leads (id, contact_id, status, captured_at, created_at)
  select new_lead, l.contact_id, l.status, now(), now() from public.leads l where l.org_id = company limit 1;
  delete from public.leads where id = new_lead;
  if (select count(*) from realtime.messages
      where topic = 'org:' || company || ':leads' and event in ('INSERT', 'DELETE') and inserted_at >= started) <> 2 then
    raise exception 'Insert/delete messages missing';
  end if;
  if exists (select 1 from realtime.messages
             where topic = 'org:' || company || ':leads' and inserted_at >= started
               and (payload - 'table' - 'op' - 'id') <> '{}'::jsonb) then
    raise exception 'Messages leak record data';
  end if;

  update public.contacts set name = name where id = (select id from public.contacts where org_id = company limit 1);
  if not exists (select 1 from realtime.messages
                 where topic = 'org:' || company || ':contacts' and event = 'UPDATE' and inserted_at >= started) then
    raise exception 'Contact change not broadcast';
  end if;

  -- Members of the company can listen; other topics and other people can't.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', member, 'role', 'authenticated')::text, true);
  perform set_config('realtime.topic', 'org:' || company || ':leads', true);
  if not exists (select 1 from realtime.messages) then raise exception 'Member cannot hear their company'; end if;
  perform set_config('realtime.topic', 'org:' || company || ':jobs', true);
  if exists (select 1 from realtime.messages) then raise exception 'Unlisted table topic is open'; end if;
  perform set_config('realtime.topic', 'org:' || gen_random_uuid() || ':leads', true);
  if exists (select 1 from realtime.messages) then raise exception 'Another company''s topic is open'; end if;
  if outsider is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', outsider, 'role', 'authenticated')::text, true);
    perform set_config('realtime.topic', 'org:' || company || ':leads', true);
    if exists (select 1 from realtime.messages) then raise exception 'Outsider can hear the company'; end if;
  end if;
end
$$;
