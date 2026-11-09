-- A calculator quote (source 'app' or 'calculator') is the calculator's own
-- working record, not a proposal: the deal page's proposal list leaves it out.
-- Line item descriptions may now hold rich text, so they get more room and
-- their own message when too long.
do $$
declare
  definition text := pg_get_functiondef('public.get_deal_overview(uuid)'::regprocedure);
  listed constant text := E'        order by q.created_at desc)\n      from public.quotes q where q.lead_id = deal_lead and q.status <> ''superseded'')';
begin
  if position(listed in definition) = 0 then
    raise exception 'get_deal_overview no longer lists proposals the way this migration expects';
  end if;
  execute replace(definition, listed,
    E'        order by q.created_at desc)\n      from public.quotes q where q.lead_id = deal_lead and q.status <> ''superseded''\n        and q.source not in (''app'', ''calculator''))');
end $$;

do $$
declare
  definition text := pg_get_functiondef('private.clean_line_items(jsonb)'::regprocedure);
  checked constant text := E'    if nullif(btrim(item ->> ''name''), '''') is null or char_length(item ->> ''name'') > 200\n      or char_length(coalesce(item ->> ''description'', '''')) > 4000 then\n      raise exception ''Each line item needs a name of up to 200 characters.'' using errcode = ''22023'';\n    end if;';
begin
  if position(checked in definition) = 0 then
    raise exception 'clean_line_items no longer checks names the way this migration expects';
  end if;
  execute replace(definition, checked,
    E'    if nullif(btrim(item ->> ''name''), '''') is null or char_length(item ->> ''name'') > 200 then\n      raise exception ''Each line item needs a name of up to 200 characters.'' using errcode = ''22023'';\n    end if;\n    if char_length(coalesce(item ->> ''description'', '''')) > 20000 then\n      raise exception ''A line item''''s description is too long.'' using errcode = ''22023'';\n    end if;');
end $$;
