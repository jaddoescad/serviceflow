-- Task templates: named lists of tasks a manager adds to a job from its Tasks
-- tab (Settings › Templates), like CompanyCam checklist templates. Adding one
-- copies its tasks into the job as ordinary job_tasks rows; editing a template
-- later never changes jobs it was already added to.
begin;

create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  -- [{ "title": text, "notes": text | null }, ...] in the order they're added.
  items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 100),
  created_by uuid default auth.uid() references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index task_templates_org_idx on public.task_templates (org_id, created_at);

-- A template belongs to the company the website acts in and stays there.
create function private.task_template_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.org_id := coalesce(new.org_id, private.web_org_id());
  else
    if new.org_id <> old.org_id then
      raise exception 'Templates stay with their company.' using errcode = '42501';
    end if;
    new.updated_at := now();
  end if;
  return new;
end
$$;
revoke all on function private.task_template_guard() from public, anon, authenticated;
create trigger task_template_guard before insert or update on public.task_templates
  for each row execute function private.task_template_guard();

alter table public.task_templates enable row level security;
revoke all on public.task_templates from anon, authenticated;
grant select, insert, update, delete on public.task_templates to authenticated;
create policy org_manager_read on public.task_templates for select to authenticated
  using (org_id in (select private.my_managed_org_ids()));
create policy org_manager_insert on public.task_templates for insert to authenticated
  with check (org_id in (select private.my_managed_org_ids()));
create policy org_manager_update on public.task_templates for update to authenticated
  using (org_id in (select private.my_managed_org_ids()))
  with check (org_id in (select private.my_managed_org_ids()));
create policy org_manager_delete on public.task_templates for delete to authenticated
  using (org_id in (select private.my_managed_org_ids()));

-- Copy a template's tasks onto the end of a job's list, all or nothing.
-- save_job_task checks manager access and keeps the task in the job's company.
create function public.apply_task_template(requested_job_id uuid, requested_template_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  chosen public.task_templates%rowtype;
  job_org uuid;
  next_order integer;
  item jsonb;
  added integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into chosen from public.task_templates where id = requested_template_id;
  if not found then raise exception 'Template not found'; end if;
  select org_id into job_org from public.jobs where id = requested_job_id;
  if not found then raise exception 'Job not found'; end if;
  if chosen.org_id <> job_org then
    raise exception 'Templates only apply to jobs in their company.' using errcode = '42501';
  end if;

  select coalesce(max(task.sort_order), 0) into next_order
  from public.job_tasks task
  where task.job_id = requested_job_id;

  for item in
    select entry.value from jsonb_array_elements(chosen.items) with ordinality as entry(value, position)
    order by entry.position
  loop
    next_order := next_order + 1;
    perform public.save_job_task(
      requested_job_id, null, item->>'title', nullif(btrim(item->>'notes'), ''), null, next_order);
    added := added + 1;
  end loop;
  return added;
end
$$;
revoke all on function public.apply_task_template(uuid, uuid) from public, anon;
grant execute on function public.apply_task_template(uuid, uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
