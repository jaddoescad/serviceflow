import { instant, wall, weekday } from "../_shared/zoned.ts";

// Open times: each person's hours on the day, minus their appointments and
// Google busy times. Between two appointments there is the break plus the
// drive from one address to the other. Pure, so it can be tested.

export type Hours = { day: number; start: string; end: string };
export type Person = { id: string; name: string; hours: Hours[]; maxPerDay: number | null };
export type Booked = { userId: string; startsAt: string; endsAt: string; location: string | null };
export type Busy = { userId: string; startsAt: string; endsAt: string };

export type Context = {
  timezone: string;
  bufferMinutes: number;
  people: Person[];
  appointments: Booked[];
  busy: Busy[];
};

/** Minutes to drive between two addresses (either may be unknown). */
export type Travel = (from: string | null, to: string | null) => number;

export type Candidate = {
  userId: string;
  start: number;
  end: number;
  /** Drive from the appointment before, that day; null when there is none. */
  driveBefore: number | null;
  /** Drive to the appointment after, that day; null when there is none. */
  driveAfter: number | null;
  beforeLocation: string | null;
  afterLocation: string | null;
  /** Their appointments that day. */
  dayCount: number;
};

export const STEP_MINUTES = 30;

const toMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

/**
 * Every person who can take an appointment of `minutes` at `address`, by
 * start time, on one day; the best fit first (least driving, then the
 * quietest day). Starts before `earliest` are left out.
 */
export function openTimes(
  context: Context,
  day: string,
  minutes: number,
  address: string | null,
  earliest: number,
  travel: Travel,
): Map<number, Candidate[]> {
  const zone = context.timezone;
  const buffer = context.bufferMinutes * 60_000;
  const length = minutes * 60_000;
  const dayStart = instant(day, 0, zone);
  const dayEnd = instant(day, 24 * 60, zone);
  const byStart = new Map<number, Candidate[]>();

  for (const person of context.people) {
    const windows = person.hours.filter((hours) => hours.day === weekday(day));
    if (!windows.length) continue;
    const booked = context.appointments
      .filter((item) => item.userId === person.id)
      .map((item) => ({ start: Date.parse(item.startsAt), end: Date.parse(item.endsAt), location: item.location }));
    const dayCount = booked.filter((item) => wall(item.start, zone).day === day).length;
    if (person.maxPerDay && dayCount >= person.maxPerDay) continue;
    const busy = context.busy
      .filter((item) => item.userId === person.id)
      .map((item) => ({ start: Date.parse(item.startsAt), end: Date.parse(item.endsAt) }));
    // Drive times to and from this address, once per appointment.
    const drives = booked.map((item) => ({
      ...item,
      to: travel(item.location, address) * 60_000,
      from: travel(address, item.location) * 60_000,
    }));

    for (const window of windows) {
      const close = instant(day, toMinutes(window.end), zone);
      for (let at = toMinutes(window.start); ; at += STEP_MINUTES) {
        const start = instant(day, at, zone);
        const end = start + length;
        if (end > close) break;
        if (start < earliest) continue;
        const clear =
          drives.every((item) => item.end + buffer + item.to <= start || end + buffer + item.from <= item.start) &&
          busy.every((item) => item.end + buffer <= start || end + buffer <= item.start);
        if (!clear) continue;
        const before = drives
          .filter((item) => item.end <= start && item.end > dayStart)
          .sort((a, b) => b.end - a.end)[0];
        const after = drives
          .filter((item) => item.start >= end && item.start < dayEnd)
          .sort((a, b) => a.start - b.start)[0];
        const candidate: Candidate = {
          userId: person.id,
          start,
          end,
          driveBefore: before ? Math.round(before.to / 60_000) : null,
          driveAfter: after ? Math.round(after.from / 60_000) : null,
          beforeLocation: before?.location ?? null,
          afterLocation: after?.location ?? null,
          dayCount,
        };
        byStart.set(start, [...(byStart.get(start) ?? []), candidate]);
      }
    }
  }

  const driving = (candidate: Candidate) => (candidate.driveBefore ?? 0) + (candidate.driveAfter ?? 0);
  for (const candidates of byStart.values()) {
    candidates.sort((a, b) => driving(a) - driving(b) || a.dayCount - b.dayCount);
  }
  return new Map([...byStart].sort((a, b) => a[0] - b[0]));
}

/** Lowercase with single spaces: how addresses are matched and cached. */
export const addressKey = (address: string) => address.trim().toLowerCase().replace(/\s+/g, " ");

export type Preference = {
  /** Days the customer asked for; none means any day. */
  days: string[];
  /** Part of the day: morning starts before noon. */
  window: "any" | "morning" | "afternoon";
};

export type Suggestion = Candidate & {
  day: string;
  matchesDay: boolean;
  matchesTime: boolean;
  /** Days after (or, negative, before) the nearest asked-for day; 0 on one. */
  daysAway: number;
};

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

/** Up to `perDay` from each day, `total` in all, in the list's order. */
function spread(list: Suggestion[], perDay: number, total: number): Suggestion[] {
  const counts = new Map<string, number>();
  const picked: Suggestion[] = [];
  for (const option of list) {
    if (picked.length >= total) break;
    const count = counts.get(option.day) ?? 0;
    if (count >= perDay) continue;
    counts.set(option.day, count + 1);
    picked.push(option);
  }
  return picked;
}

/**
 * The best person for each open time, ranked against what the customer asked
 * for. `best`: on an asked-for day and part of the day, closest to the
 * person's other visits first (a day with none counts as `fallbackDrive`).
 * `other`: the nearest days to the request, then the right part of the day.
 */
export function rankTimes(
  open: { day: string; times: Map<number, Candidate[]> }[],
  preference: Preference,
  timeZone: string,
  fallbackDrive: number,
): { best: Suggestion[]; other: Suggestion[] } {
  const options: Suggestion[] = [];
  for (const { day, times } of open) {
    for (const [start, [candidate]] of times) {
      const minutes = wall(start, timeZone).minutes;
      const matchesTime = preference.window === "any" || (preference.window === "morning") === minutes < 12 * 60;
      const daysAway = preference.days
        .map((asked) => dayNumber(day) - dayNumber(asked))
        .reduce((nearest, gap) => (Math.abs(gap) < Math.abs(nearest) ? gap : nearest), preference.days.length ? Infinity : 0);
      options.push({ ...candidate, day, matchesDay: daysAway === 0, matchesTime, daysAway });
    }
  }
  const near = (option: Suggestion) => {
    const drives = [option.driveBefore, option.driveAfter].filter((drive): drive is number => drive !== null);
    return drives.length ? Math.min(...drives) : fallbackDrive;
  };
  const matching = options
    .filter((option) => option.matchesDay && option.matchesTime)
    .sort((a, b) => near(a) - near(b) || a.start - b.start);
  const rest = options
    .filter((option) => !(option.matchesDay && option.matchesTime))
    .sort(
      (a, b) =>
        Math.abs(a.daysAway) - Math.abs(b.daysAway) ||
        Number(b.matchesTime) - Number(a.matchesTime) ||
        near(a) - near(b) ||
        a.start - b.start,
    );
  return { best: spread(matching, 3, 6), other: spread(rest, 2, 4) };
}
