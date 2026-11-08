-- Managers edit a job's written page in the crew app. The save only lands on
-- the version the editor opened: it returns the new version, or null when
-- someone else saved first. The web sanitizes page HTML whenever it shows it.
create function public.save_page_document(
  requested_document_id uuid,
  requested_body text,
  expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path to ''
as $$
declare
  company uuid;
  body text := coalesce(requested_body, '');
  saved timestamptz;
begin
  select d.org_id into company
  from public.project_documents d
  where d.id = requested_document_id and d.kind = 'page';
  if company is null then
    raise exception 'Page not found' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(company) then
    raise exception 'Only managers can edit pages.' using errcode = '42501';
  end if;
  if char_length(body) > 1000000 then
    raise exception 'This page is too long to save.' using errcode = '22023';
  end if;
  update public.project_documents
  set body_html = body, byte_size = char_length(body)
  where id = requested_document_id and updated_at = expected_updated_at
  returning updated_at into saved;
  return saved;
end
$$;
revoke execute on function public.save_page_document(uuid, text, timestamptz) from public, anon;
grant execute on function public.save_page_document(uuid, text, timestamptz) to authenticated;
