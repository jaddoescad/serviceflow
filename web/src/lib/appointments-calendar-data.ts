import { addDays, isDay, isMonth, monthWeeks } from "@/components/calendar-month-grid";
import { getMyCalendarConnection } from "@/lib/actions/calendar";
import { getBookingMessages } from "@/lib/actions/reminders";
import { isAppointmentKind } from "@/lib/appointment-types";
import { getAppointmentTeam, getAppointments, getCalendarEvents } from "@/lib/appointments";
import { dayKey } from "@/lib/format";

export type CalendarQuery = { view?: string; month?: string; start?: string; type?: string; user?: string };

/** What the appointments calendar draws for ?view=, ?month=, ?start=, ?type= and ?user=
 * (Appointments, and Appointment workflows' Calendar tab). */
export async function getAppointmentsCalendarData(query: CalendarQuery, defaultView: "month" | "3day" = "month") {
  const today = dayKey(new Date());
  const view = query.view === "3day" || query.view === "month" ? query.view : defaultView;
  const start = isDay(query.start) ? query.start : today;
  const month = isMonth(query.month) ? query.month : (view === "3day" ? start : today).slice(0, 7);
  const weeks = monthWeeks(month);
  const [first, days] = view === "3day" ? [start, 3] : [weeks[0], weeks.length * 7];
  // Pad the range a day each side so the Ottawa offset never drops one.
  const rangeStart = new Date(`${addDays(first, -1)}T00:00:00Z`);
  const rangeEnd = new Date(`${addDays(first, days + 1)}T00:00:00Z`);
  const [appointments, events, team, messages, calendar] = await Promise.all([
    getAppointments(rangeStart, rangeEnd),
    getCalendarEvents(rangeStart, rangeEnd),
    getAppointmentTeam(),
    getBookingMessages(),
    getMyCalendarConnection(),
  ]);
  return {
    view,
    month,
    start,
    today,
    kind: isAppointmentKind(query.type) ? query.type : ("" as const),
    user: query.user ?? "",
    appointments,
    events,
    team,
    messages,
    calendar,
  };
}
