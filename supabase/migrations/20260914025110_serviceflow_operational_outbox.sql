begin;
create schema if not exists sync_private;
revoke all on schema sync_private from public,anon,authenticated;
create table sync_private.allowed_tables(table_name text primary key, columns text[] not null, priority integer not null);
create table sync_private.credentials(id boolean primary key default true check(id), token_hash text not null);
create table sync_private.record_versions(table_name text not null, record_id uuid not null, version bigint not null, primary key(table_name,record_id));
create table sync_private.outbox(
 id bigint generated always as identity primary key,
 table_name text not null references sync_private.allowed_tables,
 record_id uuid not null, version bigint not null, operation text not null check(operation in ('upsert','delete')),
 payload jsonb not null, created_at timestamptz not null default clock_timestamp(),
 lease_id uuid, lease_until timestamptz, delivered_at timestamptz,
 attempts integer not null default 0, last_error text
);
create index outbox_pending on sync_private.outbox(id) where delivered_at is null;
insert into sync_private.allowed_tables values('contacts',array['id','kind','dripjobs_contact_id','name','email','phone','normalized_email','normalized_phone','metadata','created_at','updated_at'],0);
insert into sync_private.allowed_tables values('leads',array['id','contact_id','dripjobs_deal_id','status','pipeline_stage_raw','source','normalized_channel','address','city','province','postal_code','estimate_scheduled_on','estimate_appointment_on','is_interior','is_exterior','is_cabinets','created_at','captured_at','updated_at','metadata','dripjobs_sales_deal_id','marketing_eligible','marketing_exclusion_reason'],1);
insert into sync_private.allowed_tables values('quotes',array['id','lead_id','dripjobs_proposal_id','name','status','amount_cents','tax_cents','calculator_doc','accepted_at','valid_until','source','metadata','created_at','updated_at'],2);
insert into sync_private.allowed_tables values('jobs',array['id','contact_id','lead_id','accepted_quote_id','name','status','contract_amount_cents','address_line_1','address_line_2','city','province','postal_code','country','formatted_address','latitude','longitude','companycam_project_ids','scheduled_on','started_on','completed_on','archived_at','is_feed_visible','source','metadata','created_at','updated_at','production_month','scheduled_end_on'],3);
insert into sync_private.allowed_tables values('employees',array['id','email','full_name','role','is_active','created_at','updated_at'],4);
insert into sync_private.allowed_tables values('employee_pay_rates',array['id','employee_id','hourly_rate_cents','effective_from','notes','created_by','created_at','updated_at'],5);
insert into sync_private.allowed_tables values('job_budgets',array['id','job_id','quote_id','version','status','budget_minutes','calculated_minutes','hourly_rate_cents','amount_including_tax_cents','labour_allocation_percent','instructions','notes','closed_at','closed_by','source','metadata','created_at','updated_at','production_month'],6);
insert into sync_private.allowed_tables values('job_assignments',array['id','job_id','employee_id','status','assigned_by','created_at','updated_at'],7);
insert into sync_private.allowed_tables values('job_tasks',array['id','job_id','budget_id','source_kind','source_item_id','title','notes','budget_minutes','calculated_minutes','sort_order','status','completed_by','completed_at','versions','metadata','created_at','updated_at'],8);
insert into sync_private.allowed_tables values('job_issues',array['id','client_id','job_id','task_id','employee_id','issue_type','reason','note','minutes_over','metadata','created_at'],9);
insert into sync_private.allowed_tables values('time_entries',array['id','client_entry_id','employee_id','job_id','employee_email','employee_name','job_name','job_address','original_started_at','started_at','start_edited_at','ended_at','status','segments','adjustment_history','notes','approved_at','approved_by','created_at','updated_at'],10);
insert into sync_private.allowed_tables values('time_entry_events',array['id','time_entry_id','client_entry_id','employee_id','event_type','captured_at','received_at','source','metadata'],11);
insert into sync_private.allowed_tables values('job_media',array['id','job_id','object_key','media_type','mime_type','original_filename','byte_size','width','height','duration_ms','captured_at','uploaded_by','created_at','updated_at','source_provider','source_id','source_project_id','source_metadata','lead_id'],12);

-- A capability token grants only the explicitly defined sync RPCs. No source
-- service-role key, login session, or general database credential is shared.
create function sync_private.authorize() returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from sync_private.credentials where token_hash=encode(extensions.digest(coalesce(current_setting('request.headers',true)::jsonb->>'x-sync-token',''),'sha256'),'hex')) then
  raise exception 'Invalid sync capability' using errcode='42501';
 end if;
end $$;
create function sync_private.sanitize(value jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb; k text; v jsonb;
begin
 if jsonb_typeof(value)='object' then
  result='{}';
  for k,v in select * from jsonb_each(value) loop
   if k !~* '(password|secret|token|latitude|longitude|location|distance|invoice|bank|payment|accounting)' then
    result=result || jsonb_build_object(k,sync_private.sanitize(v));
   end if;
  end loop;
  return result;
 elsif jsonb_typeof(value)='array' then
  select coalesce(jsonb_agg(sync_private.sanitize(e)),'[]') into result from jsonb_array_elements(value)e;
  return result;
 end if;
 return value;
end $$;
create function sync_private.enqueue(t text, row_data jsonb, op text) returns void language plpgsql security definer set search_path='' as $$
declare v bigint; cols text[]; body jsonb;
begin
 select columns into strict cols from sync_private.allowed_tables where table_name=t;
 if t='contacts' and row_data->>'kind'<>'customer' then return; end if;
 select jsonb_object_agg(key,case when jsonb_typeof(value) in ('object','array') then sync_private.sanitize(value) else value end) into body from jsonb_each(row_data) where key=any(cols);
 insert into sync_private.record_versions as rv values(t,(row_data->>'id')::uuid,1)
 on conflict(table_name,record_id) do update set version=rv.version+1 returning version into v;
 insert into sync_private.outbox(table_name,record_id,version,operation,payload) values(t,(row_data->>'id')::uuid,v,op,body);
end $$;
create function sync_private.capture() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then perform sync_private.enqueue(tg_table_name,to_jsonb(old),'delete'); return old; end if;
 if tg_table_name='contacts' and tg_op='UPDATE' and to_jsonb(old)->>'kind'='customer' and to_jsonb(new)->>'kind'<>'customer' then
  perform sync_private.enqueue(tg_table_name,to_jsonb(old),'delete');
 else perform sync_private.enqueue(tg_table_name,to_jsonb(new),'upsert'); end if;
 return new;
end $$;
create function public.claim_serviceflow_sync(batch_size integer default 200) returns jsonb language plpgsql security definer set search_path='' as $$
declare token uuid=gen_random_uuid(); result jsonb;
begin
 perform sync_private.authorize();
 with claimed as (
 select o.id from sync_private.outbox o join sync_private.allowed_tables a using(table_name)
 where delivered_at is null and (lease_until is null or lease_until<clock_timestamp())
 order by a.priority,o.id limit least(greatest(batch_size,1),500) for update of o skip locked
 ), updated as (
 update sync_private.outbox o set lease_id=token,lease_until=clock_timestamp()+interval '3 minutes',attempts=attempts+1
 from claimed c where o.id=c.id returning o.*
 ) select coalesce(jsonb_agg(jsonb_build_object('event_id',id::text,'table_name',table_name,'record_id',record_id,'version',version::text,'operation',operation,'payload',payload,'lease_id',lease_id) order by id),'[]') into result from updated;
 return result;
end $$;
create function public.ack_serviceflow_sync(event_ids bigint[], delivery_lease uuid) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 perform sync_private.authorize();
 update sync_private.outbox set delivered_at=clock_timestamp(),last_error=null where id=any(event_ids) and lease_id=delivery_lease and delivered_at is null;
 get diagnostics n=row_count;return n;
end $$;
create function public.serviceflow_sync_backlog() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform sync_private.authorize();
 return (select jsonb_build_object('pending',count(*),'oldest_pending',min(created_at),'retrying',count(*) filter(where attempts>1)) from sync_private.outbox where delivered_at is null);
end $$;
create trigger capture_ottawa_sync after insert or update or delete on public.contacts for each row execute function sync_private.capture();
create trigger capture_ottawa_sync after insert or update or delete on public.leads for each row execute function sync_private.capture();
create trigger capture_ottawa_sync after insert or update or delete on public.quotes for each row execute function sync_private.capture();
create trigger capture_ottawa_sync after insert or update or delete on public.jobs for each row execute function sync_private.capture();
create trigger capture_ottawa_sync after insert or update or delete on public.employees for each row execute function sync_private.capture();
create trigger capture_ottawa_sync after insert or update or delete on public.employee_pay_rates for each row execute function sync_private.capture();
create trigger capture_ottawa_sync after insert or update or delete on public.job_budgets for each row execute function sync_private.capture();
create trigger capture_ottawa_sync after insert or update or delete on public.job_assignments for each row execute function sync_private.capture();
create trigger capture_ottawa_sync after insert or update or delete on public.job_tasks for each row execute function sync_private.capture();
create trigger capture_ottawa_sync after insert or update or delete on public.job_issues for each row execute function sync_private.capture();
create trigger capture_ottawa_sync after insert or update or delete on public.time_entries for each row execute function sync_private.capture();
create trigger capture_ottawa_sync after insert or update or delete on public.time_entry_events for each row execute function sync_private.capture();
create trigger capture_ottawa_sync after insert or update or delete on public.job_media for each row execute function sync_private.capture();
alter table sync_private.allowed_tables enable row level security;
alter table sync_private.credentials enable row level security;
alter table sync_private.record_versions enable row level security;
alter table sync_private.outbox enable row level security;
revoke all on all functions in schema sync_private from public,anon,authenticated,service_role;
revoke all on all tables in schema sync_private from public,anon,authenticated,service_role;
revoke all on function public.claim_serviceflow_sync(integer),public.ack_serviceflow_sync(bigint[],uuid),public.serviceflow_sync_backlog() from public;
grant execute on function public.claim_serviceflow_sync(integer),public.ack_serviceflow_sync(bigint[],uuid),public.serviceflow_sync_backlog() to anon;
notify pgrst,'reload schema';
commit;
