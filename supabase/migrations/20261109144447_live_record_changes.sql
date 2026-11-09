-- Open pipeline and customer pages update themselves when a company's leads or
-- contacts change, whatever made the change (Zapier and other integrations,
-- imports, teammates). Each write statement broadcasts one small message per
-- affected company on the private topic `org:<company>:<table>`; pages re-fetch
-- when they hear it. Imports and syncs that touch many rows still send one
-- message per company, and the message carries no customer data.

create function private.broadcast_record_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  companies uuid[];
  company uuid;
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
        jsonb_build_object('table', tg_table_name, 'op', tg_op),
        tg_op,
        'org:' || company || ':' || tg_table_name,
        true
      );
    end loop;
  exception when others then
    -- A missed live update must never block saving a lead or contact.
    raise warning 'Live update broadcast failed for %: %', tg_table_name, sqlerrm;
  end;
  return null;
end
$$;
revoke all on function private.broadcast_record_changes() from public, anon, authenticated;

create trigger broadcast_inserts after insert on public.leads
  referencing new table as new_rows
  for each statement execute function private.broadcast_record_changes();
create trigger broadcast_updates after update on public.leads
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.broadcast_record_changes();
create trigger broadcast_deletes after delete on public.leads
  referencing old table as old_rows
  for each statement execute function private.broadcast_record_changes();

create trigger broadcast_inserts after insert on public.contacts
  referencing new table as new_rows
  for each statement execute function private.broadcast_record_changes();
create trigger broadcast_updates after update on public.contacts
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.broadcast_record_changes();
create trigger broadcast_deletes after delete on public.contacts
  referencing old table as old_rows
  for each statement execute function private.broadcast_record_changes();

-- Only active members of that company may listen. Nobody may send on these
-- topics from a browser (no insert policy), so updates can't be spoofed.
create policy "company members hear lead and contact changes"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and split_part((select realtime.topic()), ':', 1) = 'org'
  and split_part((select realtime.topic()), ':', 3) in ('leads', 'contacts')
  and split_part((select realtime.topic()), ':', 2) in (select org_id::text from private.my_org_ids() as org_id)
);
