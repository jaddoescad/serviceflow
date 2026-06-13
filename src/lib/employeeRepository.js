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

  const fullName = getEmployeeDisplayName(null, user);
  const { data, error } = await supabase
    .from("employee_profiles")
    .upsert(
      {
        user_id: user.id,
        email: user.email,
        full_name: fullName,
      },
      { onConflict: "user_id" },
    )
    .select("user_id,email,full_name,role,is_active")
    .single();

  return { profile: data || null, error };
}
