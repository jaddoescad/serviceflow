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

export type SuggestedTimes = {
  timezone: string;
  minutes: number;
  /** Best first: closest to the person's other visits, then the earliest. */
  windows: OpenWindow[];
  /** Whether drive times come from Google. */
  driveTimes: boolean;
  fallbackDriveMinutes: number;
  /** Nobody (or not this person) takes appointments. */
  reason?: "no_hours";
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
