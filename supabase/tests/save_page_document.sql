-- Run after 20261108210755_save_page_document.sql inside a transaction and ROLLBACK.
do $$
declare
  manager uuid;
  crew uuid;
  page uuid;
  opened timestamptz;
  saved timestamptz;
begin
  select d.id, d.updated_at into page, opened from public.project_documents d where d.kind = 'page' limit 1;
  select m.user_id into manager from public.org_members m join public.project_documents d on d.org_id = m.org_id
  where d.id = page and m.is_active and m.role in ('owner', 'admin', 'manager') limit 1;
  select m.user_id into crew from public.org_members m join public.project_documents d on d.org_id = m.org_id
  where d.id = page and m.is_active and m.role not in ('owner', 'admin', 'manager') limit 1;
  if page is null or manager is null then raise exception 'Test prerequisites missing'; end if;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', manager, 'role', 'authenticated')::text, true);
  saved := public.save_page_document(page, '<p>Edited on a phone</p>', opened);
  if saved is null or saved = opened then raise exception 'Save over the opened version failed'; end if;
  if (select body_html from public.project_documents where id = page) <> '<p>Edited on a phone</p>'
     or (select updated_by from public.project_documents where id = page) <> manager then
    raise exception 'Saved page lost the body or editor';
  end if;
  if public.save_page_document(page, '<p>Stale</p>', opened) is not null then
    raise exception 'Stale save was accepted';
  end if;
  begin
    perform public.save_page_document(page, repeat('x', 1000001), saved);
    raise exception 'Oversized page accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.save_page_document(gen_random_uuid(), '<p>x</p>', saved);
    raise exception 'Missing page accepted';
  exception when no_data_found then null; end;

  if crew is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', crew, 'role', 'authenticated')::text, true);
    begin
      perform public.save_page_document(page, '<p>Crew edit</p>', saved);
      raise exception 'Crew edit accepted';
    exception when insufficient_privilege then null; end;
  end if;
end
$$;
