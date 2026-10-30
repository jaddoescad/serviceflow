"use server";

import { requireStaff } from "@/lib/auth";
import type { BookingRules, BookingSettings, SuggestedTimes, TimeOfDay, WeeklyHours } from "@/lib/booking-types";
import { callEdge } from "./edge";
import { staffRead, staffWrite, type ActionResult } from "./rpc";

/** Settings › Availability: the break, the fallback drive time and everyone's hours. */
export async function getBookingSettings(): Promise<BookingSettings> {
  return staffRead<BookingSettings>("get_booking_settings");
}

export async function saveBookingRules(rules: BookingRules): Promise<ActionResult> {
  return staffWrite(
    "save_booking_settings",
    { requested_buffer_minutes: rules.bufferMinutes, requested_travel_minutes: rules.travelMinutes },
    ["/settings"],
  );
}

export async function saveAvailability(input: {
  userId: string;
  takesBookings: boolean;
  hours: WeeklyHours[];
  maxPerDay: number | null;
}): Promise<ActionResult> {
  return staffWrite(
    "save_team_availability",
    {
      requested_user: input.userId,
      requested_takes_bookings: input.takesBookings,
      requested_hours: input.hours,
      requested_max_per_day: input.maxPerDay,
    },
    ["/settings"],
  );
}

/** Open times ranked against the days and part of the day the customer asked
 * for, with the drive from the person's other visits. `appointmentId` is the visit being moved. */
export async function suggestTimes(input: {
  address: string;
  minutes: number;
  userId: string | null;
  appointmentId: string | null;
  days: string[];
  window: TimeOfDay;
}): Promise<SuggestedTimes | { error: string }> {
  await requireStaff();
  try {
    return await callEdge<SuggestedTimes>("booking", { ...input, address: input.address.trim() || null });
  } catch (reason) {
    return { error: reason instanceof Error ? reason.message : "Times couldn't load. Try again." };
  }
}
