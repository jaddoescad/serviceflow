import { createClient } from "@/lib/supabase/server";
import type { Appointment, CalendarEvent, TeamMember } from "@/lib/appointment-types";
import { getBookingSettings } from "@/lib/actions/booking";

export async function getAppointments(start: Date, end: Date): Promise<Appointment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_appointments", {
    range_start: start.toISOString(),
    range_end: end.toISOString(),
  });
  if (error) throw new Error(`appointments: ${error.message}`);
  return (data ?? []) as Appointment[];
}

/** Events on the team's connected Google Calendars; none for people who aren't managers. */
export async function getCalendarEvents(start: Date, end: Date): Promise<CalendarEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_calendar_events", {
    requested_from: start.toISOString(),
    requested_to: end.toISOString(),
  });
  if (error) {
    console.error(JSON.stringify({ message: "calendar events", error: error.message }));
    return [];
  }
  return (data ?? []) as CalendarEvent[];
}

/** Who appointments go to: the people who take appointments (Settings › Availability), or everyone while nobody is set. */
export async function getAppointmentTeam(): Promise<TeamMember[]> {
  const [team, settings] = await Promise.all([getActiveTeam(), getBookingSettings().catch(() => null)]);
  const takes = new Set(settings?.people.filter((person) => person.takesBookings).map((person) => person.id));
  return takes.size ? team.filter((member) => takes.has(member.id)) : team;
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
