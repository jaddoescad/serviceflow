import { createClient } from "@/lib/supabase/server";
import type { Appointment, TeamMember } from "@/lib/appointment-types";

export async function getAppointments(start: Date, end: Date): Promise<Appointment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_appointments", {
    range_start: start.toISOString(),
    range_end: end.toISOString(),
  });
  if (error) throw new Error(`appointments: ${error.message}`);
  return (data ?? []) as Appointment[];
}

export async function getActiveTeam(): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .select("id,full_name,email")
    .eq("is_active", true)
    .order("full_name");
  if (error) throw new Error(`team: ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id, name: row.full_name ?? row.email ?? "Team member" }));
}
