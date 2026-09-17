import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TeamDirectory } from "@/components/team-directory";
export const dynamic = "force-dynamic";
export default async function TeamPage() {
  const profile = await requireMember();
  const client = await createClient();
  const { data, error } = await client
    .from("employees")
    .select("id,full_name,email,role,is_active,phone,job_title,updated_at")
    .order("full_name");
  if (error) throw new Error("Could not load team.");
  return (
    <TeamDirectory
      members={data ?? []}
      actorId={profile.user_id}
      canManage={profile.role === "admin"}
    />
  );
}
