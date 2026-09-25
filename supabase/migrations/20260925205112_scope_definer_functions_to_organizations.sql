-- Phase 1, step 4 of multi-company ServiceFlow. SECURITY DEFINER functions
-- bypass row-level security, so they get company scoping of their own:
--
-- 1. Company context. Each exposed definer function is wrapped: the wrapper
--    finds the company of the row the call acts on (job, lead, photo,
--    contact, time entry), refuses callers who are not members of it, and
--    records it for the rest of the transaction. private.is_manager() then
--    means "manager of that company", and new rows default to it. The
--    original bodies move unchanged to private.<name>__unscoped, callable only
--    through the wrappers.
-- 2. Children inherit their parent's company (a task its job's, a time entry
--    its job's, a photo its job's or lead's) through a trigger, so no writer
--    can create a cross-company reference.
-- 3. New top-level rows (a contact, a pay rate) default to the caller's
--    company instead of always Ottawa Painters. Server-side callers with no
--    signed-in user (DripJobs intake, cron jobs) still default to Ottawa
--    Painters, whose integrations they are.
--
-- For everyone at Ottawa Painters the resolved company is Ottawa Painters, so
-- behaviour is unchanged.
--
-- Not wrapped, deliberately: the Ottawa Painters sync RPCs (they check sync
-- credentials), process_dripjobs_zapier_event and manage_team_account's
-- service-only callers are handled below or run without a user,
-- purge_expired_employee_location_points (retention across all companies),
-- register_push_token (a device, not company data) and
-- private.ensure_default_job_budget (internal, not callable).

-- ---------------------------------------------------------------------------
-- Company context
-- ---------------------------------------------------------------------------

create function private.try_uuid(value text)
returns uuid
language sql immutable set search_path = ''
as $$
  select case
    when value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then value::uuid
  end
$$;

create function private.org_of_project(project_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select org_id from public.jobs where id = project_id),
    (select org_id from public.leads where id = project_id)
  )
$$;

-- The company this call acts in: the context a wrapper set, else the caller's
-- only company. Server-side callers without a user act for Ottawa Painters.
create function private.acting_org_id()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  context_org text := nullif(current_setting('serviceflow.org_id', true), '');
  membership_count integer;
  only_org uuid;
begin
  if context_org is not null then
    return context_org::uuid;
  end if;
  if auth.uid() is null then
    return private.legacy_default_org_id();
  end if;
  select count(*), (array_agg(org_id))[1] into membership_count, only_org
  from private.my_org_ids() org_id;
  if membership_count = 1 then
    return only_org;
  elsif membership_count = 0 then
    raise exception 'You are not an active member of a company.' using errcode = '42501';
  end if;
  raise exception 'Choose which company this is for.' using errcode = '22023';
end
$$;

-- Enter a company for the rest of the transaction. A null company leaves the
-- context alone so the wrapped function can report its own "not found".
create function private.set_acting_org(requested_org_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  context_org text := nullif(current_setting('serviceflow.org_id', true), '');
begin
  if requested_org_id is null then
    return;
  end if;
  if context_org is not null and context_org::uuid <> requested_org_id then
    raise exception 'This action spans two companies.' using errcode = '42501';
  end if;
  if auth.uid() is not null and not private.is_org_member(requested_org_id) then
    raise exception 'You do not have access to this company.' using errcode = '42501';
  end if;
  perform set_config('serviceflow.org_id', requested_org_id::text, true);
end
$$;

-- Manager of the company in context; without context, manager of any company
-- (only reached by callers that act on no particular row).
create or replace function private.is_manager()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when nullif(current_setting('serviceflow.org_id', true), '') is not null
      then private.is_org_manager(current_setting('serviceflow.org_id', true)::uuid)
    else exists (select 1 from private.my_managed_org_ids())
  end
$$;

revoke all on function private.try_uuid(text), private.org_of_project(uuid),
  private.acting_org_id(), private.set_acting_org(uuid) from public, anon;
grant execute on function private.try_uuid(text), private.org_of_project(uuid),
  private.acting_org_id(), private.set_acting_org(uuid) to authenticated, service_role;

do $$
declare
  target regclass;
begin
  foreach target in array array[
    'public.contacts', 'public.leads', 'public.quotes', 'public.jobs',
    'public.job_budgets', 'public.job_assignments', 'public.job_tasks',
    'public.job_issues', 'public.job_media', 'public.time_entries',
    'public.time_entry_events', 'public.employee_pay_rates',
    'public.employee_location_points', 'public.employee_tracking_status',
    'public.location_alerts', 'public.project_workspace',
    'public.project_labels', 'public.project_label_links',
    'public.media_creator_links', 'private.integration_events',
    'private.photo_annotation_history'
  ]::regclass[] loop
    execute format('alter table %s alter column org_id set default private.acting_org_id()', target);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Children inherit their parent's company
-- ---------------------------------------------------------------------------

create function private.inherit_org_id()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  parent_org uuid;
begin
  case tg_table_name
    when 'leads' then
      select org_id into parent_org from public.contacts where id = new.contact_id;
    when 'quotes' then
      select org_id into parent_org from public.leads where id = new.lead_id;
    when 'jobs' then
      parent_org := coalesce(
        (select org_id from public.leads where id = new.lead_id),
        (select org_id from public.contacts where id = new.contact_id));
    when 'job_budgets', 'job_tasks', 'job_assignments', 'job_issues', 'time_entries' then
      select org_id into parent_org from public.jobs where id = new.job_id;
    when 'job_media' then
      parent_org := coalesce(
        (select org_id from public.jobs where id = new.job_id),
        (select org_id from public.leads where id = new.lead_id));
    when 'time_entry_events', 'location_alerts' then
      select org_id into parent_org from public.time_entries where id = new.time_entry_id;
    when 'employee_location_points', 'employee_tracking_status' then
      parent_org := coalesce(
        (select org_id from public.time_entries where id = new.time_entry_id),
        (select org_id from public.jobs where id = new.job_id));
    when 'project_workspace' then
      parent_org := coalesce(
        (select org_id from public.jobs where id = coalesce(new.job_id, new.project_id)),
        (select org_id from public.leads where id = coalesce(new.lead_id, new.project_id)));
    when 'project_label_links' then
      parent_org := private.org_of_project(new.project_id);
      if exists (select 1 from public.project_labels where id = new.label_id and org_id <> parent_org) then
        raise exception 'Labels belong to one company.' using errcode = '42501';
      end if;
    when 'photo_annotation_history' then
      select org_id into parent_org from public.job_media where id = new.media_id;
  end case;

  if parent_org is null or parent_org = new.org_id then
    return new;
  end if;
  -- One row per employee that follows whichever shift is current.
  if tg_table_name = 'employee_tracking_status' then
    new.org_id := parent_org;
    return new;
  end if;
  -- Server-side writers adopt the parent's company; signed-in writers whose
  -- company differs from the parent's are refused.
  if tg_op = 'INSERT' and auth.uid() is null then
    new.org_id := parent_org;
    return new;
  end if;
  raise exception 'Records can only link within one company.' using errcode = '42501';
end
$$;

create trigger inherit_org_id before insert or update of contact_id, org_id on public.leads
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of lead_id, org_id on public.quotes
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of lead_id, contact_id, org_id on public.jobs
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of job_id, org_id on public.job_budgets
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of job_id, org_id on public.job_tasks
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of job_id, org_id on public.job_assignments
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of job_id, org_id on public.job_issues
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of job_id, lead_id, org_id on public.job_media
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of job_id, org_id on public.time_entries
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of time_entry_id, org_id on public.time_entry_events
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of time_entry_id, job_id, org_id on public.employee_location_points
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of time_entry_id, job_id, org_id on public.employee_tracking_status
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of time_entry_id, org_id on public.location_alerts
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of project_id, job_id, lead_id, org_id on public.project_workspace
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of project_id, label_id, org_id on public.project_label_links
  for each row execute function private.inherit_org_id();
create trigger inherit_org_id before insert or update of media_id, org_id on private.photo_annotation_history
  for each row execute function private.inherit_org_id();

-- ---------------------------------------------------------------------------
-- Wrappers. Each original moves to private.<name>__unscoped, unreachable from
-- the API, and a wrapper with the same signature takes its place.
-- ---------------------------------------------------------------------------

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature, n.nspname as schema_name, p.proname as name
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (
      ('private', 'create_workspace_project'), ('private', 'edit_photo_details'),
      ('private', 'get_photo_trash'), ('private', 'move_project_media'),
      ('private', 'save_photo_annotations'), ('private', 'set_photo_trash'),
      ('public', 'convert_lead_to_job'), ('public', 'create_customer_contact'),
      ('public', 'duplicate_project_media'), ('public', 'edit_team_profile'),
      ('public', 'ensure_lead_clock_in_job'), ('public', 'get_integration_health'),
      ('public', 'manage_team_account'), ('public', 'publish_quote'),
      ('public', 'record_location_update'), ('public', 'record_time_entry_command'),
      ('public', 'save_calculator_rates'), ('public', 'save_job_budget'),
      ('public', 'save_job_task'), ('public', 'save_project_profile'),
      ('public', 'set_job_assignment'), ('public', 'set_job_status'),
      ('public', 'set_job_task_status'), ('public', 'update_customer_contact'))
  loop
    execute format('alter function %s rename to %I', fn.signature, fn.name || '__unscoped');
    if fn.schema_name = 'public' then
      execute format('alter function public.%I%s set schema private',
        fn.name || '__unscoped', substring(fn.signature::text from '\(.*\)$'));
    end if;
  end loop;
end
$$;

do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure from pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname like '%\_\_unscoped'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end
$$;

-- Photos and projects (called through the public SQL wrappers of the same name).

create function private.create_workspace_project(
  requested_id uuid, requested_name text, requested_contact uuid, requested_address text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  target_org uuid := coalesce(
    (select org_id from public.contacts where id = requested_contact),
    private.acting_org_id());
begin
  if auth.uid() is not null and not private.is_org_manager(target_org) then
    raise exception 'Only active managers can create projects.' using errcode = '42501';
  end if;
  if exists (select 1 from public.jobs where id = requested_id and org_id <> target_org) then
    raise exception 'Records can only link within one company.' using errcode = '42501';
  end if;
  perform private.set_acting_org(target_org);
  return private.create_workspace_project__unscoped(
    requested_id, requested_name, requested_contact, requested_address);
end
$$;

create function private.edit_photo_details(
  requested_project_id uuid, requested_media_id uuid, expected_revision text,
  requested_revision uuid, requested_description text, requested_tags text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform private.set_acting_org(coalesce(
    (select org_id from public.job_media where id = requested_media_id),
    private.org_of_project(requested_project_id)));
  return private.edit_photo_details__unscoped(
    requested_project_id, requested_media_id, expected_revision,
    requested_revision, requested_description, requested_tags);
end
$$;

create function private.get_photo_trash(requested_project_id uuid, requested_media_id uuid)
returns setof public.job_media language plpgsql security definer set search_path = ''
as $$
begin
  perform private.set_acting_org(coalesce(
    (select org_id from public.job_media where id = requested_media_id),
    private.org_of_project(requested_project_id)));
  return query select * from private.get_photo_trash__unscoped(requested_project_id, requested_media_id);
end
$$;

create function private.move_project_media(
  requested_media uuid, requested_source uuid, requested_destination uuid,
  expected_revision text, requested_revision uuid, commit_move boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  media_org uuid := (select org_id from public.job_media where id = requested_media);
  destination_org uuid := private.org_of_project(requested_destination);
begin
  if media_org is not null and destination_org is not null and media_org <> destination_org then
    raise exception 'Photos can only move within one company.' using errcode = '42501';
  end if;
  perform private.set_acting_org(coalesce(media_org, destination_org));
  return private.move_project_media__unscoped(
    requested_media, requested_source, requested_destination,
    expected_revision, requested_revision, commit_move);
end
$$;

create function private.save_photo_annotations(
  requested_project_id uuid, requested_media_id uuid, expected_revision text,
  requested_revision uuid, requested_document jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform private.set_acting_org(coalesce(
    (select org_id from public.job_media where id = requested_media_id),
    private.org_of_project(requested_project_id)));
  return private.save_photo_annotations__unscoped(
    requested_project_id, requested_media_id, expected_revision,
    requested_revision, requested_document);
end
$$;

create function private.set_photo_trash(
  requested_project_id uuid, requested_media_id uuid, requested_trashed boolean,
  expected_revision text, requested_revision uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform private.set_acting_org(coalesce(
    (select org_id from public.job_media where id = requested_media_id),
    private.org_of_project(requested_project_id)));
  return private.set_photo_trash__unscoped(
    requested_project_id, requested_media_id, requested_trashed,
    expected_revision, requested_revision);
end
$$;

-- Leads, quotes, jobs and contacts.

create function public.convert_lead_to_job(
  requested_lead_id uuid, requested_quote_id uuid,
  requested_name text default null, requested_scheduled_on date default null)
returns public.jobs language plpgsql security definer set search_path = ''
as $$
begin
  perform private.set_acting_org((select org_id from public.leads where id = requested_lead_id));
  return private.convert_lead_to_job__unscoped(
    requested_lead_id, requested_quote_id, requested_name, requested_scheduled_on);
end
$$;

create function public.create_customer_contact(
  request_id uuid, contact_name text, contact_email text default null,
  contact_phone text default null, contact_address text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
begin
  perform private.set_acting_org(private.acting_org_id());
  return private.create_customer_contact__unscoped(
    request_id, contact_name, contact_email, contact_phone, contact_address);
end
$$;

create function public.update_customer_contact(
  contact_id uuid, expected_updated_at timestamptz, contact_name text,
  contact_email text, contact_phone text, contact_address text)
returns uuid language plpgsql security definer set search_path = ''
as $$
begin
  perform private.set_acting_org((select c.org_id from public.contacts c where c.id = contact_id));
  return private.update_customer_contact__unscoped(
    contact_id, expected_updated_at, contact_name, contact_email, contact_phone, contact_address);
end
$$;

create function public.publish_quote(
  requested_lead_id uuid, requested_quote_id uuid, requested_name text,
  requested_amount_cents bigint, requested_calculator_doc jsonb,
  requested_status text default 'draft')
returns public.quotes language plpgsql security definer set search_path = ''
as $$
declare
  lead_org uuid := (select org_id from public.leads where id = requested_lead_id);
begin
  if exists (select 1 from public.quotes where id = requested_quote_id and org_id <> lead_org) then
    raise exception 'Records can only link within one company.' using errcode = '42501';
  end if;
  perform private.set_acting_org(lead_org);
  return private.publish_quote__unscoped(
    requested_lead_id, requested_quote_id, requested_name, requested_amount_cents,
    requested_calculator_doc, requested_status);
end
$$;

create function public.ensure_lead_clock_in_job(requested_lead_id uuid)
returns public.jobs language plpgsql security definer set search_path = ''
as $$
begin
  perform private.set_acting_org((select org_id from public.leads where id = requested_lead_id));
  return private.ensure_lead_clock_in_job__unscoped(requested_lead_id);
end
$$;

create function public.save_project_profile(
  requested_project_id uuid, requested_section text, requested_name text default null,
  requested_email text default null, requested_phone text default null,
  requested_address text default null, requested_customer_notes text default null,
  requested_description text default null, requested_project_notes text default null)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  project_org uuid := private.org_of_project(requested_project_id);
begin
  if project_org is not null and auth.uid() is not null and not private.is_org_manager(project_org) then
    raise exception 'Manager access required.' using errcode = '42501';
  end if;
  perform private.set_acting_org(project_org);
  return private.save_project_profile__unscoped(
    requested_project_id, requested_section, requested_name, requested_email,
    requested_phone, requested_address, requested_customer_notes,
    requested_description, requested_project_notes);
end
$$;

create function public.duplicate_project_media(
  requested_media uuid, requested_copy uuid, requested_project uuid,
  expected_key text, requested_attempt uuid, commit_copy boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  media_org uuid := (select org_id from public.job_media where id = requested_media);
  destination_org uuid := private.org_of_project(requested_project);
begin
  if media_org is not null and destination_org is not null and media_org <> destination_org then
    raise exception 'Photos can only be copied within one company.' using errcode = '42501';
  end if;
  perform private.set_acting_org(coalesce(media_org, destination_org));
  return private.duplicate_project_media__unscoped(
    requested_media, requested_copy, requested_project, expected_key,
    requested_attempt, commit_copy);
end
$$;

create function public.set_job_status(requested_job_id uuid, requested_status text)
returns public.jobs language plpgsql security definer set search_path = ''
as $$
begin
  perform private.set_acting_org((select org_id from public.jobs where id = requested_job_id));
  return private.set_job_status__unscoped(requested_job_id, requested_status);
end
$$;

create function public.save_job_budget(
  requested_job_id uuid, requested_budget_minutes integer,
  requested_hourly_rate_cents integer default null,
  requested_amount_including_tax_cents bigint default null,
  requested_notes text default null)
returns public.job_budgets language plpgsql security definer set search_path = ''
as $$
begin
  perform private.set_acting_org((select org_id from public.jobs where id = requested_job_id));
  return private.save_job_budget__unscoped(
    requested_job_id, requested_budget_minutes, requested_hourly_rate_cents,
    requested_amount_including_tax_cents, requested_notes);
end
$$;

create function public.save_job_task(
  requested_job_id uuid, requested_task_id uuid, requested_title text,
  requested_notes text default null, requested_budget_minutes integer default null,
  requested_sort_order integer default 0)
returns public.job_tasks language plpgsql security definer set search_path = ''
as $$
declare
  job_org uuid := (select org_id from public.jobs where id = requested_job_id);
begin
  if exists (select 1 from public.job_tasks where id = requested_task_id and org_id <> job_org) then
    raise exception 'Records can only link within one company.' using errcode = '42501';
  end if;
  perform private.set_acting_org(job_org);
  return private.save_job_task__unscoped(
    requested_job_id, requested_task_id, requested_title, requested_notes,
    requested_budget_minutes, requested_sort_order);
end
$$;

create function public.set_job_task_status(requested_task_id uuid, requested_status text)
returns public.job_tasks language plpgsql security definer set search_path = ''
as $$
begin
  perform private.set_acting_org((select org_id from public.job_tasks where id = requested_task_id));
  return private.set_job_task_status__unscoped(requested_task_id, requested_status);
end
$$;

create function public.set_job_assignment(
  requested_job_id uuid, requested_employee_id uuid, requested_active boolean)
returns public.job_assignments language plpgsql security definer set search_path = ''
as $$
declare
  job_org uuid := (select org_id from public.jobs where id = requested_job_id);
begin
  if job_org is not null and not exists (
    select 1 from public.org_members where org_id = job_org and user_id = requested_employee_id
  ) then
    raise exception 'That person is not on this company''s team.' using errcode = '22023';
  end if;
  perform private.set_acting_org(job_org);
  return private.set_job_assignment__unscoped(requested_job_id, requested_employee_id, requested_active);
end
$$;

-- Time and location, from the mobile app.

create function public.record_time_entry_command(
  action text, command jsonb, next_command jsonb default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  requested_job uuid := private.try_uuid(command ->> 'job_id');
  requested_task uuid := private.try_uuid(command ->> 'task_id');
  entry_org uuid;
  job_org uuid;
begin
  if requested_job is null and requested_task is not null then
    select job_id into requested_job from public.job_tasks where id = requested_task;
  end if;
  select org_id into job_org from public.jobs where id = requested_job;
  select org_id into entry_org from public.time_entries
  where id = private.try_uuid(command ->> 'server_id')
     or client_entry_id = nullif(btrim(command ->> 'client_entry_id'), '')
  limit 1;
  if entry_org is not null and job_org is not null and entry_org <> job_org then
    raise exception 'This action spans two companies.' using errcode = '42501';
  end if;
  perform private.set_acting_org(coalesce(entry_org, job_org));
  return private.record_time_entry_command__unscoped(action, command, next_command);
end
$$;

create function public.record_location_update(point jsonb, tracking jsonb default null)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  perform private.set_acting_org(coalesce(
    (select org_id from public.time_entries
      where id = private.try_uuid(point ->> 'time_entry_id')
         or client_entry_id = nullif(btrim(point ->> 'client_entry_id'), '')
      limit 1),
    (select org_id from public.jobs where id = private.try_uuid(point ->> 'job_id'))));
  return private.record_location_update__unscoped(point, tracking);
end
$$;

-- Team management.

create function public.edit_team_profile(
  requested_user uuid, requested_name text, requested_phone text,
  requested_job_title text, expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  shared_org uuid;
begin
  select m.org_id into shared_org
  from public.org_members m
  where m.user_id = requested_user
    and private.org_role(m.org_id) in ('owner', 'admin')
  limit 1;
  if shared_org is null and auth.uid() is not null then
    raise exception 'Admin access required.' using errcode = '42501';
  end if;
  perform private.set_acting_org(shared_org);
  return private.edit_team_profile__unscoped(
    requested_user, requested_name, requested_phone, requested_job_title, expected_updated_at);
end
$$;

-- Service-role only: the edge function names the acting manager explicitly.
create function public.manage_team_account(
  requested_actor uuid, requested_user uuid,
  requested_role text default null, requested_active boolean default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  shared_org uuid;
begin
  select target.org_id into shared_org
  from public.org_members target
  join public.org_members actor
    on actor.org_id = target.org_id
   and actor.user_id = requested_actor
   and actor.is_active
   and actor.role in ('owner', 'admin', 'manager')
  where target.user_id = requested_user
  limit 1;
  if shared_org is null then
    raise exception 'Manager access required.' using errcode = '42501';
  end if;
  perform private.set_acting_org(shared_org);
  return private.manage_team_account__unscoped(
    requested_actor, requested_user, requested_role, requested_active);
end
$$;

-- Ottawa Painters-only settings and integrations.

create function public.save_calculator_rates(requested_rates jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform private.set_acting_org(private.legacy_default_org_id());
  return private.save_calculator_rates__unscoped(requested_rates);
end
$$;

create function public.get_integration_health()
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_org_manager(private.legacy_default_org_id()) then
    return null;
  end if;
  perform private.set_acting_org(private.legacy_default_org_id());
  return private.get_integration_health__unscoped();
end
$$;

-- Wrappers keep the originals' grants.
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (
      ('private', 'create_workspace_project'), ('private', 'edit_photo_details'),
      ('private', 'get_photo_trash'), ('private', 'move_project_media'),
      ('private', 'save_photo_annotations'), ('private', 'set_photo_trash'),
      ('public', 'convert_lead_to_job'), ('public', 'create_customer_contact'),
      ('public', 'duplicate_project_media'), ('public', 'edit_team_profile'),
      ('public', 'ensure_lead_clock_in_job'), ('public', 'get_integration_health'),
      ('public', 'manage_team_account'), ('public', 'publish_quote'),
      ('public', 'record_location_update'), ('public', 'record_time_entry_command'),
      ('public', 'save_calculator_rates'), ('public', 'save_job_budget'),
      ('public', 'save_job_task'), ('public', 'save_project_profile'),
      ('public', 'set_job_assignment'), ('public', 'set_job_status'),
      ('public', 'set_job_task_status'), ('public', 'update_customer_contact'))
  loop
    execute format('revoke all on function %s from public, anon', fn);
    if fn::text like 'manage_team_account(%' then
      execute format('grant execute on function %s to service_role', fn);
    elsif fn::text like 'private.%' then
      execute format('grant execute on function %s to authenticated', fn);
    else
      execute format('grant execute on function %s to authenticated, service_role', fn);
    end if;
  end loop;
end
$$;

notify pgrst, 'reload schema';
