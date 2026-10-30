import { AppointmentsCalendar } from "@/components/appointments-calendar";
import { addDays, isDay, isMonth, monthWeeks } from "@/components/calendar-month-grid";
import { getReminderRules } from "@/lib/actions/reminders";
import { APPOINTMENT_KINDS, isAppointmentKind } from "@/lib/appointment-types";
import { requireStaff } from "@/lib/auth";
import { getActiveTeam, getAppointments } from "@/lib/appointments";
import { dayKey } from "@/lib/format";
import { sendsConfirmation } from "@/lib/reminder-types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * ?month=YYYY-MM, or ?view=3day&start=YYYY-MM-DD; ?type= and ?user= filter by
 * appointment type and assignee; ?new=<project> opens a booking.
 */
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string; start?: string; type?: string; user?: string; new?: string }>;
}) {
  const query = await searchParams;
  const today = dayKey(new Date());
  const view = query.view === "3day" ? "3day" : "month";
  const start = isDay(query.start) ? query.start : today;
  const month = isMonth(query.month) ? query.month : (view === "3day" ? start : today).slice(0, 7);
  const weeks = monthWeeks(month);
  const [first, days] = view === "3day" ? [start, 3] : [weeks[0], weeks.length * 7];
  // Pad the range a day each side so the Ottawa offset never drops one.
  const rangeStart = new Date(`${addDays(first, -1)}T00:00:00Z`);
  const rangeEnd = new Date(`${addDays(first, days + 1)}T00:00:00Z`);
  const supabase = await createClient();
  const [, appointments, team, rules, project] = await Promise.all([
    requireStaff(),
    getAppointments(rangeStart, rangeEnd),
    getActiveTeam(),
    getReminderRules(),
    query.new
      ? supabase.from("project_directory").select("id,name,address").eq("id", query.new).maybeSingle()
      : null,
  ]);
  const target = project?.data;
  return (
    <AppointmentsCalendar
      view={view}
      month={month}
      start={start}
      today={today}
      kind={isAppointmentKind(query.type) ? query.type : ""}
      user={query.user ?? ""}
      appointments={appointments}
      team={team}
      confirmationKinds={APPOINTMENT_KINDS.map(({ id }) => id).filter((kind) => sendsConfirmation(rules, "appointment", kind))}
      newFor={target ? { id: target.id, name: target.name, address: target.address ?? "" } : null}
    />
  );
}
