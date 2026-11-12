create or replace function private.clean_line_items(items jsonb)
returns jsonb
language plpgsql set search_path = ''
as $$
declare
  item jsonb;
  quantity numeric;
  unit_price numeric;
  is_optional boolean;
  result jsonb := '[]'::jsonb;
begin
  if items is null then
    return result;
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 200 then
    raise exception 'A document holds up to 200 line items.' using errcode = '22023';
  end if;
  for item in select value from jsonb_array_elements(items) loop
    begin
      quantity := coalesce(nullif(item ->> 'quantity', '')::numeric, 1);
      unit_price := coalesce(nullif(item ->> 'unitPriceCents', '')::numeric, 0);
      is_optional := coalesce((item ->> 'optional')::boolean, false);
    exception when others then
      raise exception 'Check the quantity and price of each line item.' using errcode = '22023';
    end;
    if nullif(btrim(item ->> 'name'), '') is null or char_length(item ->> 'name') > 200 then
      raise exception 'Each line item needs a name of up to 200 characters.' using errcode = '22023';
    end if;
    if char_length(coalesce(item ->> 'description', '')) > 20000 then
      raise exception 'A line item''s description is too long.' using errcode = '22023';
    end if;
    if item ? 'taxRatePercent' and (jsonb_typeof(item -> 'taxRatePercent') <> 'number'
      or (item ->> 'taxRatePercent')::numeric < 0 or (item ->> 'taxRatePercent')::numeric > 100) then
      raise exception 'Check the tax rate of each line item.' using errcode = '22023';
    end if;
    if quantity < 0 or quantity > 100000 or abs(unit_price) > 100000000 then
      raise exception 'Check the quantity and price of each line item.' using errcode = '22023';
    end if;
    result := result || (jsonb_build_object(
      'id', coalesce(nullif(item ->> 'id', ''), gen_random_uuid()::text),
      'name', btrim(item ->> 'name'),
      'description', coalesce(item ->> 'description', ''),
      'quantity', round(quantity, 3),
      'unitPriceCents', round(unit_price)::bigint,
      'optional', is_optional,
      'selected', case when is_optional then coalesce((item ->> 'selected')::boolean, false) else true end)
      || case when item ? 'taxRatePercent' then jsonb_build_object('taxRatePercent', (item ->> 'taxRatePercent')::numeric) else '{}'::jsonb end);
  end loop;
  return result;
end
$$;

-- Match the browser calculation. Existing documents retain subtotal-based tax.
create or replace function private.line_item_totals(
  items jsonb, tax_rate numeric, discount_percent numeric, discount_amount bigint,
  out subtotal_cents bigint, out discount_cents bigint, out tax_cents bigint, out total_cents bigint)
language sql immutable set search_path = ''
as $$
  with lines as (
    select i, round((i ->> 'quantity')::numeric * (i ->> 'unitPriceCents')::numeric) as amount,
      not coalesce((i ->> 'optional')::boolean, false) or coalesce((i ->> 'selected')::boolean, false) as included
    from jsonb_array_elements(coalesce(items, '[]'::jsonb)) i
  ), sums as (
    select coalesce(sum(amount) filter (where included), 0) as subtotal,
      coalesce(bool_or(i ? 'taxRatePercent'), false) as line_tax from lines
  ), discounted as (
    select subtotal, line_tax, greatest(0, least(subtotal,
      coalesce(discount_amount::numeric, round(subtotal * coalesce(discount_percent, 0) / 100)))) as discount from sums
  ), calculated as (
    select subtotal, discount, case when line_tax then
      (select coalesce(sum(round(l.amount * case when d.subtotal > 0 then (d.subtotal - d.discount) / d.subtotal else 1 end
        * coalesce((l.i ->> 'taxRatePercent')::numeric, tax_rate, 0) / 100)), 0) from lines l where l.included)
      else round((subtotal - discount) * coalesce(tax_rate, 0) / 100) end as tax
    from discounted d
  )
  select subtotal::bigint, discount::bigint, tax::bigint, (subtotal - discount + tax)::bigint from calculated
$$;
