import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EmployeeProfile } from "@/lib/types";

/**
 * Loads the signed-in user's employee profile and enforces the admin/manager
 * gate. Painters (or users with no profile) are bounced to a not-authorized
 * screen. Returns the profile for use in the layout/header.
 */
export async function requireStaff(): Promise<EmployeeProfile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("employee_profiles")
    .select("user_id,email,full_name,role,is_active")
    .eq("user_id", user.id)
    .maybeSingle<EmployeeProfile>();

  if (!profile || !profile.is_active || !["admin", "manager"].includes(profile.role)) {
    redirect("/not-authorized");
  }

  return profile;
}

export async function getSessionToken(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
