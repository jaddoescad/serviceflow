begin;
create function public.create_customer_contact(request_id uuid, contact_name text, contact_email text default null, contact_phone text default null, contact_address text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare existing public.contacts; email_value text := nullif(lower(btrim(contact_email)), ''); phone_value text := nullif(btrim(contact_phone), '');
begin
 if not private.is_manager() then raise exception 'Admin or manager access required' using errcode='42501'; end if;
 if request_id is null or nullif(btrim(contact_name),'') is null or length(btrim(contact_name))>160 then raise exception 'Enter a name of 160 characters or fewer'; end if;
 if length(email_value)>320 or (email_value is not null and email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$') then raise exception 'Enter a valid email address'; end if;
 if length(phone_value)>60 or length(btrim(contact_address))>500 then raise exception 'Phone or address is too long'; end if;
 insert into public.contacts(id,kind,name,email,phone,normalized_email,normalized_phone,metadata)
 values(request_id,'customer',btrim(contact_name),email_value,phone_value,email_value,nullif(regexp_replace(phone_value,'[^0-9]','','g'),''),jsonb_build_object('source','manual','created_by',auth.uid(),'address',nullif(btrim(contact_address),'')))
 on conflict(id) do nothing;
 select * into existing from public.contacts where id=request_id;
 if existing.kind<>'customer' or existing.metadata->>'source' is distinct from 'manual' or existing.metadata->>'created_by' is distinct from auth.uid()::text then raise exception 'Contact request conflict'; end if;
 return request_id;
end $$;
revoke all on function public.create_customer_contact(uuid,text,text,text,text) from public,anon;
grant execute on function public.create_customer_contact(uuid,text,text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
