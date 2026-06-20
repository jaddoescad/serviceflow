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

  const columns = "user_id,email,full_name,role,is_active";

  // Return the existing profile untouched so a name the user set is never
  // overwritten by the email-prefix fallback on subsequent app loads.
  const { data: existing, error: fetchError } = await supabase
    .from("employee_profiles")
    .select(columns)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) return { profile: null, error: fetchError };
  if (existing) return { profile: existing, error: null };

  const { data, error } = await supabase
    .from("employee_profiles")
    .insert({
      user_id: user.id,
      email: user.email,
      full_name: getEmployeeDisplayName(null, user),
    })
    .select(columns)
    .single();

  return { profile: data || null, error };
}
