-- The customer portal lists proposal totals after their discount, like the
-- proposal page itself.
begin;

do $$
declare
  definition text := pg_get_functiondef('public.view_customer_portal(text)'::regprocedure);
  old_call text := 'private.line_item_totals(q.line_items, q.tax_rate_percent) t';
begin
  if position(old_call in definition) = 0 then
    raise exception 'view_customer_portal changed; update this migration';
  end if;
  execute replace(definition, old_call,
    'private.line_item_totals(q.line_items, q.tax_rate_percent, q.discount_percent, q.discount_cents) t');
end
$$;

commit;
