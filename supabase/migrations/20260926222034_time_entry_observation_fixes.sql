-- Time-entry location fixes for record_time_entry_command:
--
-- 1. Clock-in coordinates were never stored: the app only knows where a shift
--    started a few seconds after clock-in, and later commands only updated the
--    clock-out columns. Observations and clock-outs now fill clock_in_* when
--    they are still empty (never overwriting an existing value).
-- 2. A late observation could overwrite a completed entry's clock-out location
--    and segments. Observations now only touch active entries.
--
-- The function body is patched in place so everything else stays identical;
-- the block fails if either anchor text is missing.
do $migration$
declare
  definition text := pg_get_functiondef('private.record_time_entry_command__unscoped(text,jsonb,jsonb)'::regprocedure);
  patched text;
  observation_anchor constant text := E'    else\n      update public.time_entries entry\n      set\n        clock_out_latitude = coalesce(';
  clock_out_anchor constant text := E'          status = ''completed'',\n';
begin
  if position(observation_anchor in definition) = 0 or position(clock_out_anchor in definition) = 0 then
    raise exception 'record_time_entry_command__unscoped has changed; update this migration';
  end if;

  patched := replace(definition, observation_anchor, E'    else\n'
    || E'      if target.status <> ''active'' then\n'
    || E'        return to_jsonb(target);\n'
    || E'      end if;\n'
    || E'      update public.time_entries entry\n'
    || E'      set\n'
    || E'        clock_in_latitude = coalesce(entry.clock_in_latitude, nullif(command ->> ''clock_in_latitude'', '''')::double precision),\n'
    || E'        clock_in_longitude = coalesce(entry.clock_in_longitude, nullif(command ->> ''clock_in_longitude'', '''')::double precision),\n'
    || E'        clock_out_latitude = coalesce(');

  patched := replace(patched, clock_out_anchor, clock_out_anchor
    || E'          clock_in_latitude = coalesce(entry.clock_in_latitude, nullif(command ->> ''clock_in_latitude'', '''')::double precision),\n'
    || E'          clock_in_longitude = coalesce(entry.clock_in_longitude, nullif(command ->> ''clock_in_longitude'', '''')::double precision),\n');

  execute patched;
end
$migration$;
