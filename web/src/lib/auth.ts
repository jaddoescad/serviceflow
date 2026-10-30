import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EmployeeProfile } from "@/lib/types";

/** All active team members can browse shared projects and media. */
export const requireMember = cache(
  async function requireMember(): Promise<EmployeeProfile> {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    const userId =
      !error && typeof data?.claims?.sub === "string" ? data.claims.sub : null;
    if (!userId) redirect("/login");

    const { data: profile } = await supabase
      .from("employees")
      .select("id,email,full_name,role,is_active")
      .eq("id", userId)
      .maybeSingle();

    if (!profile || !profile.is_active) {
      redirect("/not-authorized");
    }

    return { ...profile, user_id: profile.id } as EmployeeProfile;
  },
);

/** The company the web admin shows: the person's first active company, as
 * private.home_org_id() picks it. Other companies they belong to (e.g. the
 * Google Play testing company) stay out of company-wide pages. */
export const getHomeOrgId = cache(async function getHomeOrgId(): Promise<string | null> {
  const profile = await requireMember();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("org_members")
    .select("org_id, organizations!inner(status)")
    .eq("user_id", profile.user_id)
    .eq("is_active", true)
    .eq("organizations.status", "active")
    .order("created_at")
    .order("org_id")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`home company: ${error.message}`);
  return data?.org_id ?? null;
});

export async function getSessionToken(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

/** Financial and administrative mutations remain manager-only. */
export const requireStaff = cache(
  async function requireStaff(): Promise<EmployeeProfile> {
    const profile = await requireMember();
    if (!["admin", "manager"].includes(profile.role))
      redirect("/not-authorized");
    return profile;
  },
);
