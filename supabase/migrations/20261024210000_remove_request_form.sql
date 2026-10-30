-- The public estimate request form was removed from the admin. Existing leads
-- and notes it created are kept.
begin;

drop function if exists public.get_request_form(text);
drop function if exists public.submit_estimate_request(text, text, text, text, text, text);

select pg_notify('pgrst', 'reload schema');

commit;
