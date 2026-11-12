do $$
declare
  packages jsonb := '[{"id":"bronze","name":"Bronze"},{"id":"silver","name":"Silver"}]'::jsonb;
  items jsonb := '[{"name":"Bronze work","quantity":1,"unitPriceCents":736600,"packageId":"bronze"},{"name":"Silver work","quantity":1,"unitPriceCents":750789,"packageId":"silver"}]'::jsonb;
  cleaned jsonb;
  sums record;
begin
  if private.chosen_package(packages, null) <> 'bronze' then raise exception 'Default selection changed'; end if;
  if private.chosen_package(packages, '__unselected__') <> '__unselected__' then raise exception 'Unselected state lost'; end if;
  cleaned := private.clean_proposal_items(items, packages, private.chosen_package(packages, '__unselected__'));
  select * into sums from private.line_item_totals(cleaned, 13, null, null);
  if sums.total_cents <> 0 or (cleaned -> 0 ->> 'selected')::boolean or (cleaned -> 1 ->> 'selected')::boolean then
    raise exception 'Unselected packages counted: %', row_to_json(sums);
  end if;
  cleaned := private.clean_proposal_items(items, packages, private.chosen_package(packages, 'bronze'));
  select * into sums from private.line_item_totals(cleaned, 13, null, null);
  if sums.total_cents <> 832358 or not (cleaned -> 0 ->> 'selected')::boolean or (cleaned -> 1 ->> 'selected')::boolean then
    raise exception 'Selected package mismatch: %', row_to_json(sums);
  end if;
end $$;
