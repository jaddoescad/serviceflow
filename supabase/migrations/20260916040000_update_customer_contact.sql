begin;
create function public.update_customer_contact(
  contact_id uuid, expected_updated_at timestamptz, contact_name text,
  contact_email text, contact_phone text, contact_address text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  email_value text := nullif(lower(btrim(contact_email)), '');
  phone_value text := nullif(btrim(contact_phone), '');
  saved_id uuid;
begin
  if not private.is_manager() then
    raise exception 'Admin or manager access required' using errcode = '42501';
  end if;
  if nullif(btrim(contact_name), '') is null or length(btrim(contact_name)) > 160 then
    raise exception 'Enter a name of 160 characters or fewer';
  end if;
  if length(email_value) > 320 or (email_value is not null and email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then
    raise exception 'Enter a valid email address';
  end if;
  if length(phone_value) > 60 or length(btrim(contact_address)) > 500 then
    raise exception 'Phone or address is too long';
  end if;
  update public.contacts c set
    name = btrim(contact_name), email = email_value, phone = phone_value,
    normalized_email = email_value,
    normalized_phone = nullif(regexp_replace(phone_value, '[^0-9]', '', 'g'), ''),
    metadata = coalesce(c.metadata, '{}'::jsonb) || jsonb_build_object('address', nullif(btrim(contact_address), '')),
    updated_at = clock_timestamp()
  where c.id = contact_id and c.kind = 'customer' and c.updated_at = expected_updated_at
  returning c.id into saved_id;
  if saved_id is null then
    raise exception 'Customer changed or is unavailable. Review the latest details and try again.';
  end if;
  return saved_id;
end;
$$;
revoke all on function public.update_customer_contact(uuid,timestamptz,text,text,text,text) from public,anon;
grant execute on function public.update_customer_contact(uuid,timestamptz,text,text,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
