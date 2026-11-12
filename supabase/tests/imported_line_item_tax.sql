do $$
declare result record; cleaned jsonb;
begin
  cleaned := private.clean_line_items('[{"name":"Doors","quantity":1,"unitPriceCents":15000,"taxRatePercent":13},{"name":"Wallpaper","quantity":1,"unitPriceCents":150000,"taxRatePercent":0}]'::jsonb);
  select * into result from private.line_item_totals(cleaned,13,null,null);
  if result.subtotal_cents<>165000 or result.tax_cents<>1950 or result.total_cents<>166950 then raise exception 'Joseph mismatch: %',row_to_json(result);end if;
  cleaned := private.clean_line_items('[{"name":"Prep","quantity":1,"unitPriceCents":60000,"taxRatePercent":13},{"name":"Paint","quantity":1,"unitPriceCents":190000,"taxRatePercent":13},{"name":"Discount","quantity":1,"unitPriceCents":-20000,"taxRatePercent":0}]'::jsonb);
  select * into result from private.line_item_totals(cleaned,13,null,null);
  if result.subtotal_cents<>230000 or result.tax_cents<>32500 or result.total_cents<>262500 then raise exception 'Gerry mismatch: %',row_to_json(result);end if;
  cleaned := private.clean_line_items('[{"name":"Work","quantity":1,"unitPriceCents":68700,"taxRatePercent":13},{"name":"Optional","quantity":1,"unitPriceCents":73500,"taxRatePercent":0,"optional":true,"selected":false}]'::jsonb);
  select * into result from private.line_item_totals(cleaned,13,null,null);
  if result.total_cents<>77631 then raise exception 'Excluded option mismatch: %',row_to_json(result);end if;
  cleaned := jsonb_set(cleaned,'{1,selected}','true'::jsonb);
  select * into result from private.line_item_totals(cleaned,13,null,null);
  if result.total_cents<>151131 then raise exception 'Selected option mismatch: %',row_to_json(result);end if;
  cleaned := private.clean_line_items('[{"name":"Ceilings","quantity":1,"unitPriceCents":101400,"taxRatePercent":13},{"name":"Walls","quantity":1,"unitPriceCents":491000,"taxRatePercent":13},{"name":"Trim","quantity":1,"unitPriceCents":106400,"taxRatePercent":13},{"name":"Doors","quantity":1,"unitPriceCents":108500,"taxRatePercent":13},{"name":"Discount","quantity":1,"unitPriceCents":-56511,"taxRatePercent":13}]'::jsonb);
  select * into result from private.line_item_totals(cleaned,13,null,null);
  if result.subtotal_cents<>750789 or result.tax_cents<>97603 or result.total_cents<>848392 then raise exception 'Silver package mismatch: %',row_to_json(result);end if;
  cleaned := private.clean_line_items('[{"name":"Ordinary","quantity":1,"unitPriceCents":10000}]'::jsonb);
  select * into result from private.line_item_totals(cleaned,13,null,null);
  if result.total_cents<>11300 then raise exception 'Ordinary mismatch: %',row_to_json(result);end if;
  cleaned := private.clean_line_items('[{"name":"Default taxable","quantity":1,"unitPriceCents":10000},{"name":"Explicitly untaxed","quantity":1,"unitPriceCents":20000,"taxRatePercent":0}]'::jsonb);
  select * into result from private.line_item_totals(cleaned,13,null,null);
  if result.tax_cents<>1300 or result.total_cents<>31300 then raise exception 'Default tax mismatch: %',row_to_json(result);end if;
  begin perform private.clean_line_items('[{"name":"Bad rate","taxRatePercent":101}]'::jsonb);raise exception 'Invalid rate accepted';exception when sqlstate '22023' then null;end;
end $$;
