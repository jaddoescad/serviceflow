"use server";

import { staffRead, staffWrite } from "./rpc";

/** The signed-in person's own Google Calendar connection. */
export type CalendarConnection =
  | { connected: false }
  | {
      connected: true;
      googleEmail: string | null;
      status: "connected" | "error" | "disconnecting";
      syncAppointments: boolean;
      syncJobs: boolean;
      lastError: string | null;
      pending: number;
    };

export async function getMyCalendarConnection(): Promise<CalendarConnection> {
  return staffRead<CalendarConnection>("get_my_calendar_connection");
}

export async function setMyCalendarSync(input: { appointments: boolean; jobs: boolean }) {
  return staffWrite(
    "set_my_calendar_sync",
    { requested_appointments: input.appointments, requested_jobs: input.jobs },
    ["/settings"],
  );
}

/** ServiceFlow's events are removed from the calendar, then the connection. */
export async function disconnectMyCalendar() {
  return staffWrite("disconnect_my_calendar", {}, ["/settings"]);
}
