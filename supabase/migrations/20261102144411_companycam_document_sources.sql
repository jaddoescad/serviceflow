-- Retain import identity when a filled One Pager replaces a blank template,
-- and after the crew edits that page. Existing document RLS remains in force.
alter table public.project_documents
  add column source_provider text,
  add column source_id text,
  add constraint project_document_source_check check (
    (source_provider is null and source_id is null)
    or (source_provider = 'companycam' and source_id is not null and char_length(source_id) between 1 and 120)
  );
create unique index project_documents_source_identity_idx
  on public.project_documents (org_id, source_provider, source_id)
  where source_id is not null;
select pg_notify('pgrst', 'reload schema');
