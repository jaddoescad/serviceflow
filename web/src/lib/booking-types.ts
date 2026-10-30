/** One stretch of a weekday someone takes appointments; day 0 is Sunday. */
export type WeeklyHours = { day: number; start: string; end: string };

export type BookingPerson = {
  id: string;
  name: string;
  takesBookings: boolean;
  hours: WeeklyHours[];
  maxPerDay: number | null;
  calendarConnected: boolean;
};

export type BookingRules = {
  bufferMinutes: number;
  /** Drive time between visits when Google can't estimate it. */
  travelMinutes: number;
};

export type BookingSettings = BookingRules & { people: BookingPerson[] };

export type TimeOfDay = "any" | "morning" | "afternoon";

export type SuggestedTime = {
  start: string;
  end: string;
  /** Its day, YYYY-MM-DD in company time. */
  date: string;
  userId: string;
  name: string | null;
  matchesDay: boolean;
  matchesTime: boolean;
  /** Days after (negative: before) the nearest day the customer asked for. */
  daysAway: number;
  /** The closer of the person's visits before and after it that day. */
  nearby: { address: string; minutes: number; meters: number | null; side: "before" | "after" } | null;
};

export type SuggestedTimes = {
  timezone: string;
  minutes: number;
  /** On an asked-for day and part of the day, best route first. */
  best: SuggestedTime[];
  /** The nearest other times. */
  other: SuggestedTime[];
  /** Whether drive times come from Google. */
  driveTimes: boolean;
  fallbackDriveMinutes: number;
  /** Nobody (or not this person) takes appointments. */
  reason?: "no_hours";
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
