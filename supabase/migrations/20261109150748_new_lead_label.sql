-- "New" label on deals. A lead that arrives from outside the app (website,
-- Zapier, API) stays new until someone in the company opens it. Leads added by
-- staff, staff imports and old records arriving late count as opened from the
-- start (the same rule as the new-lead notification), and so does every lead
-- that existed before this change.

create table public.lead_openings (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  opened_by uuid,
  opened_at timestamptz not null default now()
);
alter table public.lead_openings enable row level security;
create policy org_member_read on public.lead_openings
  for select to authenticated
  using (org_id in (select private.my_org_ids()));
revoke insert, update, delete, truncate on public.lead_openings from anon, authenticated;

insert into public.lead_openings (lead_id, org_id)
select id, org_id from public.leads;

create function private.open_staff_added_leads()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.lead_openings (lead_id, org_id, opened_by)
    select n.id, n.org_id, auth.uid()
    from new_rows n
    where auth.uid() is not null
       or coalesce(n.metadata ->> 'created_by', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-'
       or coalesce(n.created_at, n.captured_at, now()) < now() - interval '2 days'
    on conflict (lead_id) do nothing;
  exception when others then
    raise warning 'Could not mark staff-added leads as opened: %', sqlerrm;
  end;
  return null;
end
$$;
revoke all on function private.open_staff_added_leads() from public, anon, authenticated;
create trigger open_staff_added_leads after insert on public.leads
  referencing new table as new_rows
  for each statement execute function private.open_staff_added_leads();

-- The deal page records the first opening by anyone in the company.
create function public.mark_lead_opened(requested_lead uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.lead_openings (lead_id, org_id, opened_by)
  select l.id, l.org_id, auth.uid()
  from public.leads l
  where l.id = requested_lead and l.org_id in (select private.my_org_ids())
  on conflict (lead_id) do nothing;
$$;
revoke all on function public.mark_lead_opened(uuid) from public, anon;
grant execute on function public.mark_lead_opened(uuid) to authenticated;

-- Leads in the signed-in person's company that nobody has opened yet.
create function public.get_new_lead_ids()
returns setof uuid
language sql
stable
set search_path = ''
as $$
  select l.id
  from public.leads l
  where l.org_id = private.home_org_id()
    and not exists (select 1 from public.lead_openings o where o.lead_id = l.id);
$$;
revoke all on function public.get_new_lead_ids() from public, anon;
grant execute on function public.get_new_lead_ids() to authenticated;

-- Openings announce themselves on the company's leads topic, so teammates'
-- boards drop the label live. A trigger argument names the topic table.
create or replace function private.broadcast_record_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  companies uuid[];
  company uuid;
  topic_table text := coalesce(tg_argv[0], tg_table_name);
begin
  begin
    if tg_op = 'INSERT' then
      select array_agg(distinct org_id) into companies from new_rows;
    elsif tg_op = 'UPDATE' then
      select array_agg(distinct org_id) into companies
      from (select org_id from new_rows union select org_id from old_rows) changed;
    else
      select array_agg(distinct org_id) into companies from old_rows;
    end if;

    foreach company in array coalesce(companies, '{}') loop
      continue when company is null;
      perform realtime.send(
        jsonb_build_object('table', topic_table, 'op', tg_op),
        tg_op,
        'org:' || company || ':' || topic_table,
        true
      );
    end loop;
  exception when others then
    -- A missed live update must never block saving a lead or contact.
    raise warning 'Live update broadcast failed for %: %', topic_table, sqlerrm;
  end;
  return null;
end
$$;

create trigger broadcast_inserts after insert on public.lead_openings
  referencing new table as new_rows
  for each statement execute function private.broadcast_record_changes('leads');
