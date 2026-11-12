-- Preserve an explicit unselected package state on imported proposals while
-- retaining the first-package default for ordinary new proposals.
create or replace function private.chosen_package(packages jsonb, requested text)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when requested = '__unselected__' and jsonb_array_length(coalesce(packages, '[]'::jsonb)) > 0
      then '__unselected__'
    else coalesce(
      (select p ->> 'id' from jsonb_array_elements(coalesce(packages, '[]'::jsonb)) p where p ->> 'id' = requested limit 1),
      coalesce(packages, '[]'::jsonb) -> 0 ->> 'id')
  end
$$;
