-- Managers add a deal to the sales pipeline for an existing customer. The
-- request id makes a retried submit return the same lead.
create function public.create_lead(
  requested_id uuid, requested_contact uuid, requested_address text default '', requested_source text default '')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  target_org uuid := (select org_id from public.contacts where id = requested_contact);
begin
  if target_org is null then
    raise exception 'Choose a customer.' using errcode = 'P0002';
  end if;
  if not private.is_org_manager(target_org) then
    raise exception 'Only managers can add deals.' using errcode = '42501';
  end if;
  if requested_id is null or length(requested_address) > 500 or length(requested_source) > 120 then
    raise exception 'Enter a shorter address or source.' using errcode = '22023';
  end if;
  perform private.set_acting_org(target_org);
  if exists (select 1 from public.leads where id = requested_id) then
    if not exists (select 1 from public.leads where id = requested_id
      and contact_id = requested_contact and metadata ->> 'created_by' = auth.uid()::text) then
      raise exception 'Deal ID already exists.' using errcode = '23505';
    end if;
    return requested_id;
  end if;
  insert into public.leads (id, contact_id, status, source, address, created_at, captured_at, metadata)
  values (requested_id, requested_contact, 'new', nullif(btrim(requested_source), ''),
    nullif(btrim(requested_address), ''), now(), now(),
    jsonb_build_object('created_by', auth.uid()));
  return requested_id;
end
$$;
revoke all on function public.create_lead(uuid, uuid, text, text) from public, anon;
grant execute on function public.create_lead(uuid, uuid, text, text) to authenticated;

select pg_notify('pgrst', 'reload schema');
