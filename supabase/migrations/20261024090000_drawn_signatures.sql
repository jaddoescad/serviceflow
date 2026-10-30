-- Customers sign proposals and change orders by drawing their signature, the
-- way they did in DripJobs. The drawing is kept as a small PNG data URL on the
-- document (not synced to Ottawa Painters) and shown on the signed copy.
begin;

alter table public.quotes add column signature_image text;
alter table public.change_orders add column signature_image text;

create function private.valid_signature_image(image text)
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(
    image ~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' and char_length(image) between 200 and 300000,
    false)
$$;
revoke all on function private.valid_signature_image(text) from public, anon, authenticated;

-- The existing accept functions keep doing the work; the public ones now also
-- require and store the drawn signature.
alter function public.accept_public_proposal(text, text, text[]) set schema private;
alter function private.accept_public_proposal(text, text, text[]) rename to accept_proposal;
revoke all on function private.accept_proposal(text, text, text[]) from public, anon, authenticated;
alter function public.accept_public_change_order(text, text, text[]) set schema private;
alter function private.accept_public_change_order(text, text, text[]) rename to accept_change_order;
revoke all on function private.accept_change_order(text, text, text[]) from public, anon, authenticated;

create function public.accept_public_proposal(
  requested_token text, requested_signer text, requested_selected text[] default '{}',
  requested_signature text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.valid_signature_image(requested_signature) and not exists (
    select 1 from public.quotes where public_token = requested_token and status = 'accepted') then
    raise exception 'Draw your signature to accept.' using errcode = '22023';
  end if;
  perform private.accept_proposal(requested_token, requested_signer, requested_selected);
  update public.quotes set signature_image = requested_signature
  where public_token = requested_token and char_length(requested_token) >= 24
    and status = 'accepted' and signature_image is null
    and private.valid_signature_image(requested_signature);
end
$$;

create function public.accept_public_change_order(
  requested_token text, requested_signer text, requested_selected text[] default '{}',
  requested_signature text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.valid_signature_image(requested_signature) and not exists (
    select 1 from public.change_orders where public_token = requested_token and status = 'accepted') then
    raise exception 'Draw your signature to accept.' using errcode = '22023';
  end if;
  perform private.accept_change_order(requested_token, requested_signer, requested_selected);
  update public.change_orders set signature_image = requested_signature
  where public_token = requested_token and char_length(requested_token) >= 24
    and status = 'accepted' and signature_image is null
    and private.valid_signature_image(requested_signature);
end
$$;

revoke all on function public.accept_public_proposal(text, text, text[], text) from public;
grant execute on function public.accept_public_proposal(text, text, text[], text) to anon, authenticated;
revoke all on function public.accept_public_change_order(text, text, text[], text) from public;
grant execute on function public.accept_public_change_order(text, text, text[], text) to anon, authenticated;

-- The customer pages return the signature with the signer's name.
do $$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.view_public_proposal(text)'::regprocedure);
  if position('''signedAt'', found_quote.signed_at,' in definition) = 0 then
    raise exception 'view_public_proposal changed; update this migration';
  end if;
  execute replace(definition, '''signedAt'', found_quote.signed_at,',
    '''signedAt'', found_quote.signed_at, ''signatureImage'', found_quote.signature_image,');

  definition := pg_get_functiondef('public.view_public_change_order(text)'::regprocedure);
  if position('''signedAt'', found_order.signed_at,' in definition) = 0 then
    raise exception 'view_public_change_order changed; update this migration';
  end if;
  execute replace(definition, '''signedAt'', found_order.signed_at,',
    '''signedAt'', found_order.signed_at, ''signatureImage'', found_order.signature_image,');
end
$$;

select pg_notify('pgrst', 'reload schema');

commit;
