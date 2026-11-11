-- Customer links (proposals, change orders, invoices, the customer portal)
-- get a 12-character letters-and-digits code instead of 32 characters of
-- base64: about 71 bits, still unguessable. Links already sent keep working.
create or replace function private.new_public_token()
returns text
language sql volatile set search_path = ''
as $$
  select string_agg(
    substr('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', get_byte(r.bytes, i) % 62 + 1, 1), '')
  from (select extensions.gen_random_bytes(12) as bytes) r, generate_series(0, 11) i
$$;
revoke all on function private.new_public_token() from public, anon, authenticated;

-- Every function that opens a customer link turns away codes under 24
-- characters; lower that to 12 so the new codes open. Recreating each
-- function from its own current definition keeps its body and grants.
do $$
declare
  fn record;
  definition text;
begin
  for fn in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosrc ~ 'char_length\(requested_token\) (<|>=) 24'
  loop
    definition := replace(replace(pg_get_functiondef(fn.oid),
      'char_length(requested_token) < 24', 'char_length(requested_token) < 12'),
      'char_length(requested_token) >= 24', 'char_length(requested_token) >= 12');
    execute definition;
  end loop;
end
$$;
