import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EmployeeProfile } from "@/lib/types";

/**
 * Loads the signed-in user's employee profile and enforces the admin/manager
 * gate. Painters (or users with no profile) are bounced to a not-authorized
 * screen. Returns the profile for use in the layout/header.
 */
export const requireStaff = cache(async function requireStaff(): Promise<EmployeeProfile> {
  const supabase = await createClient();
  // Middleware has already verified the JWT for this request. Read the
  // refreshed cookie locally here so the layout does not call Auth a second
  // time and does not depend on a custom forwarded request header.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user.id;
  if (!userId) redirect("/login");

  const { data: profile } = await supabase
    .from("employees")
    .select("id,email,full_name,role,is_active")
    .eq("id", userId)
    .maybeSingle();

  if (!profile || !profile.is_active || !["admin", "manager"].includes(profile.role)) {
    redirect("/not-authorized");
  }

  return { ...profile, user_id: profile.id } as EmployeeProfile;
});

export async function getSessionToken(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
