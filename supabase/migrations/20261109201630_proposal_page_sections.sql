-- The customer proposal page is now built from sections the company adds
-- itself (settings.proposal_page.blocks). An image section's file, like the
-- cover, must sit in the company's own folder.
create or replace function public.save_proposal_page(requested_page jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  company uuid := private.web_org_id();
begin
  if company is null or not private.is_org_manager(company) then
    raise exception 'Only managers can change the proposal page.' using errcode = '42501';
  end if;
  if jsonb_typeof(requested_page) is distinct from 'object' or pg_column_size(requested_page) > 300000 then
    raise exception 'These proposal page settings are not valid.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from (
      select requested_page ->> 'heroPath' as path
      union all
      select block ->> 'path'
      from jsonb_array_elements(
        case when jsonb_typeof(requested_page -> 'blocks') = 'array' then requested_page -> 'blocks' else '[]'::jsonb end
      ) as block
    ) files
    where coalesce(files.path, '') <> '' and split_part(files.path, '/', 1) <> company::text
  ) then
    raise exception 'An image on this page is stored under another company.' using errcode = '42501';
  end if;
  update public.organizations
  set settings = settings || jsonb_build_object('proposal_page', requested_page), updated_at = now()
  where id = company;
end
$$;
