import { supabase } from "./supabase";

export function getEmployeeDisplayName(profile, user) {
  return (
    profile?.full_name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email?.split("@")[0] ||
    "Painter"
  );
}

export async function upsertEmployeeProfileForUser(user) {
  if (!user) return { profile: null, error: null };

  const columns = "id,email,full_name,role,is_active";

  // Return the existing profile untouched so a name the user set is never
  // overwritten by the email-prefix fallback on subsequent app loads.
  const { data: existing, error: fetchError } = await supabase
    .from("employees")
    .select(columns)
    .eq("id", user.id)
    .maybeSingle();

  if (fetchError) return { profile: null, error: fetchError };
  if (existing) return { profile: { ...existing, user_id: existing.id }, error: null };

  return {
    profile: null,
    error: new Error("Your employee profile has not been activated. Ask an administrator for access."),
  };
}
