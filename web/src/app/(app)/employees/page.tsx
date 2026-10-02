import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TeamDirectory } from "@/components/team-directory";
export const dynamic = "force-dynamic";
export default async function TeamPage() {
  const client = await createClient();
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Toronto",
  });
  const [profile, { data, error }, rates] = await Promise.all([
    requireMember(),
    client
      .from("employees")
      .select("id,full_name,email,role,is_active,phone,job_title,updated_at")
      .order("full_name"),
    client
      .from("employee_pay_rates")
      .select("employee_id,hourly_rate_cents")
      .lte("effective_from", today)
      .order("effective_from", { ascending: false }),
  ]);
  if (error || rates.error) throw new Error("Could not load team.");
  const showRates = profile.role !== "painter";
  const currentRate = new Map<string, number>();
  for (const rate of rates.data ?? [])
    if (!currentRate.has(rate.employee_id))
      currentRate.set(rate.employee_id, rate.hourly_rate_cents / 100);
  return (
    <TeamDirectory
      members={(data ?? []).map((member) => ({
        ...member,
        hourly_rate: showRates ? (currentRate.get(member.id) ?? null) : null,
      }))}
      showRates={showRates}
      actorId={profile.user_id}
      canManage={profile.role === "admin"}
    />
  );
}
