-- Without a salesperson filter the "unassigned" flag was null, which dropped
-- every customer that has a salesperson from the list.
begin;

do $$
declare
  definition text := pg_get_functiondef(
    'public.get_customer_list(text, jsonb, text, boolean, integer, integer)'::regprocedure);
  old_line text := 'filters ->> ''salesperson'' = ''none'' as unassigned';
begin
  if position(old_line in definition) = 0 then
    raise exception 'get_customer_list changed; update this migration';
  end if;
  execute replace(definition, old_line,
    'coalesce(filters ->> ''salesperson'' = ''none'', false) as unassigned');
end
$$;

commit;
