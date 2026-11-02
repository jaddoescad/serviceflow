-- Document templates: rich text pages every new job starts with a copy of in
-- its Documents (Settings › Document templates), like a job start one pager.
-- Copies are ordinary pages; editing a template later changes only the jobs
-- created after. Managers read and edit templates; everyone in the company
-- reads the copies like any other job document.
begin;

create table public.project_document_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  body_html text not null default '' check (char_length(body_html) <= 1000000),
  created_by uuid default auth.uid() references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index project_document_templates_org_idx
  on public.project_document_templates (org_id, created_at);

-- A template belongs to the company the website acts in and stays there.
create function private.project_document_template_guard()
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
revoke all on function private.project_document_template_guard() from public, anon, authenticated;
create trigger project_document_template_guard before insert or update on public.project_document_templates
  for each row execute function private.project_document_template_guard();

alter table public.project_document_templates enable row level security;
revoke all on public.project_document_templates from anon, authenticated;
grant select, insert, update, delete on public.project_document_templates to authenticated;
create policy org_manager_read on public.project_document_templates for select to authenticated
  using (org_id in (select private.my_managed_org_ids()));
create policy org_manager_insert on public.project_document_templates for insert to authenticated
  with check (org_id in (select private.my_managed_org_ids()));
create policy org_manager_update on public.project_document_templates for update to authenticated
  using (org_id in (select private.my_managed_org_ids()))
  with check (org_id in (select private.my_managed_org_ids()));
create policy org_manager_delete on public.project_document_templates for delete to authenticated
  using (org_id in (select private.my_managed_org_ids()));

-- A new job that isn't already finished gets a copy of each of its company's
-- templates, however it was created (proposal accepted, DripJobs, by hand).
create function private.add_job_document_templates()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.archived_at is null and new.status not in ('completed', 'archived', 'cancelled') then
    insert into public.project_documents (project_id, name, kind, body_html, mime_type, byte_size, created_by, updated_by)
    select new.id, t.name, 'page', t.body_html, 'text/html', char_length(t.body_html), null, null
    from public.project_document_templates t
    where t.org_id = new.org_id
    order by t.created_at;
  end if;
  return null;
end
$$;
revoke all on function private.add_job_document_templates() from public, anon, authenticated;
create trigger add_document_templates after insert on public.jobs
  for each row execute function private.add_job_document_templates();

select pg_notify('pgrst', 'reload schema');

commit;
