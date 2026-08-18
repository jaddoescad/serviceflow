-- Supabase may retain an explicit anon execute grant even after PUBLIC is
-- revoked. Close the RPC at the role layer as well as inside its staff guard.
revoke all on function public.save_project_profile(
  uuid, text, text, text, text, text, text, text, text
) from anon;
