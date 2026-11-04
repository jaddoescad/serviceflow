import { instant, wall, weekday } from "../_shared/zoned.ts";

// Open times: each person's hours on the day, minus their appointments and
// Google busy times. Between two appointments there is the break plus the
// drive from one address to the other. Pure, so it can be tested.

export type Hours = { day: number; start: string; end: string };
export type Person = { id: string; name: string; hours: Hours[]; maxPerDay: number | null };
/** A visit nobody is assigned to (`userId` null) is on everyone's day: whoever takes it drives there. */
export type Booked = { userId: string | null; startsAt: string; endsAt: string; location: string | null };
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
      .filter((item) => item.userId === person.id || item.userId === null)
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

/** A stretch of a day one person is free: back-to-back start times. */
export type Window = {
  day: string;
  userId: string;
  /** Every start in it, in order. */
  starts: Candidate[];
  /** The start to offer: right after the visit before, else right before the
   * visit after, else the first; in the asked-for part of the day when it can be. */
  suggested: Candidate;
  matchesDay: boolean;
  /** Some start in it is in the asked-for part of the day. */
  matchesTime: boolean;
  /** Days after (or, negative, before) the nearest asked-for day; 0 on one. */
  daysAway: number;
};

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

/**
 * Each person's free stretches, ranked against what the customer asked for:
 * on an asked-for day and part of the day first, closest to the person's
 * other visits first (a stretch next to none counts as `fallbackDrive`),
 * then the nearest other days, then the earliest.
 */
export function openWindows(
  open: { day: string; times: Map<number, Candidate[]> }[],
  preference: Preference,
  timeZone: string,
  fallbackDrive: number,
): Window[] {
  const inPart = (candidate: Candidate) => {
    if (preference.window === "any") return true;
    return (preference.window === "morning") === wall(candidate.start, timeZone).minutes < 12 * 60;
  };
  const windows: Window[] = [];
  for (const { day, times } of open) {
    const daysAway = preference.days
      .map((asked) => dayNumber(day) - dayNumber(asked))
      .reduce((nearest, gap) => (Math.abs(gap) < Math.abs(nearest) ? gap : nearest), preference.days.length ? Infinity : 0);
    const byPerson = new Map<string, Candidate[]>();
    for (const candidates of times.values()) {
      for (const candidate of candidates) byPerson.set(candidate.userId, [...(byPerson.get(candidate.userId) ?? []), candidate]);
    }
    for (const [userId, list] of byPerson) {
      list.sort((a, b) => a.start - b.start);
      const runs: Candidate[][] = [];
      for (const candidate of list) {
        const run = runs.at(-1);
        if (run && candidate.start - run.at(-1)!.start === STEP_MINUTES * 60_000) run.push(candidate);
        else runs.push([candidate]);
      }
      for (const starts of runs) {
        const fitting = starts.filter(inPart);
        const pool = fitting.length ? fitting : starts;
        const suggested = starts[0].driveBefore !== null || starts.at(-1)!.driveAfter === null ? pool[0] : pool.at(-1)!;
        windows.push({ day, userId, starts, suggested, matchesDay: daysAway === 0, matchesTime: fitting.length > 0, daysAway });
      }
    }
  }
  const near = (window: Window) => {
    const drives = [window.starts[0].driveBefore, window.starts.at(-1)!.driveAfter].filter((drive): drive is number => drive !== null);
    return drives.length ? Math.min(...drives) : fallbackDrive;
  };
  const fits = (window: Window) => window.matchesDay && window.matchesTime;
  return windows.sort(
    (a, b) =>
      Number(fits(b)) - Number(fits(a)) ||
      Math.abs(a.daysAway) - Math.abs(b.daysAway) ||
      Number(b.matchesTime) - Number(a.matchesTime) ||
      near(a) - near(b) ||
      a.starts[0].start - b.starts[0].start,
  );
}
