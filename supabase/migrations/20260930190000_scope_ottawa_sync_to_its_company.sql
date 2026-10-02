-- Only Ottawa Painters' own company syncs to Ottawa Painters. Before this,
-- every row from every company was queued, and the payload carries no org_id,
-- so another company's jobs, crews and hours would land in Ottawa Painters.
-- Employees have no org_id: they sync while they belong to Ottawa Painters.
-- Deletes of records that were synced before still go through.
create or replace function sync_private.capture()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  ottawa constant uuid := 'fa66dad2-0401-400d-a504-dafba2ebf71b';
  row_data jsonb := to_jsonb(case when tg_op='DELETE' then old else new end);
  synced_before boolean := exists(
    select 1 from sync_private.record_versions
    where table_name=tg_table_name and record_id=(row_data->>'id')::uuid);
  ottawa_row boolean := case
    when tg_table_name='employees' then exists(
      select 1 from public.org_members where user_id=(row_data->>'id')::uuid and org_id=ottawa)
    else (row_data->>'org_id')::uuid is not distinct from ottawa end;
begin
  if not (ottawa_row or synced_before) then return null; end if;
  if tg_op='DELETE' then perform sync_private.enqueue(tg_table_name,to_jsonb(old),'delete'); return old; end if;
  if tg_table_name='contacts' and tg_op='UPDATE' and to_jsonb(old)->>'kind'='customer' and to_jsonb(new)->>'kind'<>'customer' then
   perform sync_private.enqueue(tg_table_name,to_jsonb(old),'delete');
  else perform sync_private.enqueue(tg_table_name,to_jsonb(new),'upsert'); end if;
  return new;
end $$;

-- A new employee row usually exists before its membership; sync it once the
-- person joins Ottawa Painters.
create or replace function sync_private.capture_ottawa_member()
returns trigger language plpgsql security definer set search_path='' as $$
declare employee jsonb;
begin
  if new.org_id <> 'fa66dad2-0401-400d-a504-dafba2ebf71b'::uuid then return null; end if;
  select to_jsonb(e) into employee from public.employees e where e.id=new.user_id;
  if employee is not null then perform sync_private.enqueue('employees',employee,'upsert'); end if;
  return null;
end $$;

drop trigger if exists capture_ottawa_member on public.org_members;
create trigger capture_ottawa_member after insert on public.org_members
  for each row execute function sync_private.capture_ottawa_member();
