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

/** A visit next to a free stretch, and the drive between it and the new address. */
export type NearbyVisit = {
  address: string;
  minutes: number;
  meters: number | null;
  /** When the visit before ends, or the visit after starts. */
  at: string;
};

/** A stretch of a day one person is free. */
export type OpenWindow = {
  /** YYYY-MM-DD in company time. */
  date: string;
  userId: string;
  name: string | null;
  /** From the first start to the end of a visit at the last one. */
  start: string;
  end: string;
  /** Every start in it, half an hour apart. */
  starts: string[];
  /** The start to offer: next to the visit before or after it. */
  suggested: string;
  before: NearbyVisit | null;
  after: NearbyVisit | null;
};

/** A drive, from Google or the company's fallback minutes (then no distance). */
export type Drive = { minutes: number; meters: number | null };

/** A visit already on an opened day. */
export type DayVisit = {
  start: string;
  end: string;
  /** The deal or job, or the calendar event's title. */
  title: string | null;
  address: string | null;
  /** The drive on to the next visit; null for the last one. */
  next: Drive | null;
};

/** An open block one appointment long, with the drive from the visit before it and to the one after (indexes into the day's visits). */
export type DayBlock = {
  start: string;
  end: string;
  before: (Drive & { visit: number }) | null;
  after: (Drive & { visit: number }) | null;
};

/** One person's day with room for the appointment, as the dialog draws it. */
export type DrawnDay = {
  /** YYYY-MM-DD in company time. */
  date: string;
  userId: string;
  name: string | null;
  /** Their hours that day. */
  open: string;
  close: string;
  visits: DayVisit[];
  blocks: DayBlock[];
};

export type SuggestedTimes = {
  timezone: string;
  minutes: number;
  /** Best first: closest to the person's other visits, then the earliest. */
  windows: OpenWindow[];
  /** Days with open blocks, best first. */
  days: DrawnDay[];
  /** Whether drive times come from Google. */
  driveTimes: boolean;
  fallbackDriveMinutes: number;
  /** Nobody (or not this person) takes appointments. */
  reason?: "no_hours";
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
