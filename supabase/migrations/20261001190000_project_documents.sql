-- Project Documents tab: uploaded files and rich text pages attached to a job
-- or lead, optionally grouped in folders. Every company member can read;
-- managers create, edit, rename, move and delete.
-- Bytes live in the private `project-documents` bucket under <project_id>/...
-- (uploaded files at <project_id>/<uuid>/<name>, page images at
-- <project_id>/pages/<document_id>/<image_id>).
begin;

create table public.project_document_folders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_by uuid default auth.uid() references public.employees(id) on delete set null,
  updated_by uuid default auth.uid() references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index project_document_folders_project_idx
  on public.project_document_folders (project_id);

create table public.project_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  -- A folder with documents in it cannot be deleted; move or delete them first.
  folder_id uuid references public.project_document_folders(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  kind text not null default 'file' check (kind in ('file', 'page')),
  -- Uploaded files point at storage; pages keep sanitized HTML in the row.
  storage_path text unique,
  body_html text check (char_length(body_html) <= 1000000),
  mime_type text,
  byte_size bigint not null default 0 check (byte_size >= 0),
  created_by uuid default auth.uid() references public.employees(id) on delete set null,
  updated_by uuid default auth.uid() references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'file' and storage_path is not null and body_html is null)
    or (kind = 'page' and storage_path is null)
  )
);
create index project_documents_project_idx
  on public.project_documents (project_id, folder_id);

-- Company comes from the project; documents never change project or file.
create function private.project_document_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.org_id := private.org_of_project(new.project_id);
    if new.org_id is null then
      raise exception 'Project not found.' using errcode = 'P0002';
    end if;
  else
    if new.project_id <> old.project_id or new.org_id <> old.org_id then
      raise exception 'Documents stay with their project.' using errcode = '42501';
    end if;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;

  if tg_table_name = 'project_documents' then
    if tg_op = 'INSERT' and new.storage_path is not null
      and split_part(new.storage_path, '/', 1) <> new.project_id::text then
      raise exception 'File is stored under another project.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (
      new.storage_path is distinct from old.storage_path or new.kind <> old.kind
    ) then
      raise exception 'A document keeps its file.' using errcode = '42501';
    end if;
    if new.folder_id is not null and not exists (
      select 1 from public.project_document_folders f
      where f.id = new.folder_id and f.project_id = new.project_id
    ) then
      raise exception 'Folder belongs to another project.' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke all on function private.project_document_guard() from public, anon, authenticated;

create trigger project_document_guard before insert or update on public.project_document_folders
  for each row execute function private.project_document_guard();
create trigger project_document_guard before insert or update on public.project_documents
  for each row execute function private.project_document_guard();

alter table public.project_document_folders enable row level security;
alter table public.project_documents enable row level security;
revoke all on public.project_document_folders, public.project_documents from anon, authenticated;
grant select, insert, update, delete
  on public.project_document_folders, public.project_documents to authenticated;

create policy org_member_read on public.project_document_folders for select to authenticated
  using (org_id in (select private.my_org_ids()));
create policy org_manager_insert on public.project_document_folders for insert to authenticated
  with check (org_id in (select private.my_managed_org_ids()));
create policy org_manager_update on public.project_document_folders for update to authenticated
  using (org_id in (select private.my_managed_org_ids()))
  with check (org_id in (select private.my_managed_org_ids()));
create policy org_manager_delete on public.project_document_folders for delete to authenticated
  using (org_id in (select private.my_managed_org_ids()));

create policy org_member_read on public.project_documents for select to authenticated
  using (org_id in (select private.my_org_ids()));
create policy org_manager_insert on public.project_documents for insert to authenticated
  with check (org_id in (select private.my_managed_org_ids()));
create policy org_manager_update on public.project_documents for update to authenticated
  using (org_id in (select private.my_managed_org_ids()))
  with check (org_id in (select private.my_managed_org_ids()));
create policy org_manager_delete on public.project_documents for delete to authenticated
  using (org_id in (select private.my_managed_org_ids()));

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-documents', 'project-documents', false, 52428800)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

create policy "Company members read project documents" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-documents'
    and private.org_of_project(private.try_uuid((storage.foldername(name))[1]))
      in (select private.my_org_ids())
  );
create policy "Company managers upload project documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-documents'
    and private.org_of_project(private.try_uuid((storage.foldername(name))[1]))
      in (select private.my_managed_org_ids())
  );
create policy "Company managers delete project documents" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-documents'
    and private.org_of_project(private.try_uuid((storage.foldername(name))[1]))
      in (select private.my_managed_org_ids())
  );

select pg_notify('pgrst', 'reload schema');

commit;
