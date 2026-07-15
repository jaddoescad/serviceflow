-- Supabase projects can have explicit default EXECUTE grants for API roles.
-- Revoke those grants from anonymous callers and keep internal helpers private.

revoke all on function public._require_time_entry_actor()
  from public, anon, authenticated;
revoke all on function public._record_time_entry_lifecycle_event(
  public.time_entries,
  text,
  timestamptz,
  jsonb
) from public, anon, authenticated;

revoke all on function public.clock_in_time_entry(jsonb) from public, anon;
revoke all on function public.clock_out_time_entry(jsonb) from public, anon;
revoke all on function public.switch_time_entry(jsonb, jsonb) from public, anon;
revoke all on function public.record_time_entry_observation(jsonb) from public, anon;
revoke all on function public.adjust_time_entry(jsonb) from public, anon;
revoke all on function public.delete_time_entry(jsonb) from public, anon;

grant execute on function public.clock_in_time_entry(jsonb) to authenticated;
grant execute on function public.clock_out_time_entry(jsonb) to authenticated;
grant execute on function public.switch_time_entry(jsonb, jsonb) to authenticated;
grant execute on function public.record_time_entry_observation(jsonb) to authenticated;
grant execute on function public.adjust_time_entry(jsonb) to authenticated;
grant execute on function public.delete_time_entry(jsonb) to authenticated;
