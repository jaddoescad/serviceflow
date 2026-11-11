import { strict as assert } from "node:assert";
import { instant } from "../_shared/zoned.ts";
import { type Context, openTimes, openWindows, type Travel } from "./slots.ts";

const zone = "America/Toronto";
// Tuesday, November 3, 2026 (Eastern Standard Time).
const day = "2026-11-03";
const at = (hour: number, minute = 0) => instant(day, hour * 60 + minute, zone);
const iso = (hour: number, minute = 0) => new Date(at(hour, minute)).toISOString();
const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });

const scott = { id: "scott", name: "Scott", hours: [{ day: 2, start: "09:00", end: "13:00" }], maxPerDay: null };
const jad = { id: "jad", name: "Jad", hours: [{ day: 2, start: "09:00", end: "13:00" }], maxPerDay: null };
const base: Context = { timezone: zone, bufferMinutes: 0, people: [scott], appointments: [], busy: [] };
const flat = (minutes: number): Travel => (from, to) => (from && to && from === to ? 0 : minutes);
const starts = (map: Map<number, unknown[]>) => [...map.keys()].map(clock);

Deno.test("hours give a start every half hour that fits the appointment", () => {
  const times = openTimes(base, day, 60, "1 Main St", 0, flat(30));
  assert.deepEqual(starts(times), ["9:00 AM", "9:30 AM", "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM", "12:00 PM"]);
  assert.equal(openTimes(base, "2026-11-04", 60, "1 Main St", 0, flat(30)).size, 0);
});

Deno.test("starts before the earliest allowed time are left out", () => {
  const times = openTimes(base, day, 60, "1 Main St", at(11, 15), flat(30));
  assert.deepEqual(starts(times), ["11:30 AM", "12:00 PM"]);
});

Deno.test("an appointment blocks its own time; a start too close to drive is offered as tight", () => {
  const context = {
    ...base,
    appointments: [{ userId: "scott", startsAt: iso(10), endsAt: iso(11), location: "9 Elm St" }],
  };
  // 20 minutes each way: 9:30 and 11:00 are offered, short of the drive.
  const times = openTimes(context, day, 30, "1 Main St", 0, flat(20));
  assert.deepEqual(starts(times), ["9:00 AM", "9:30 AM", "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM"]);
  const [after] = times.get(at(11, 30))!;
  assert.equal(after.driveBefore, 20);
  assert.equal(after.beforeEnd, at(11));
  assert.equal(after.driveAfter, null);
  assert.equal(after.shortfall, 0);
  assert.equal(times.get(at(11))![0].shortfall, 20);
  assert.equal(times.get(at(9, 30))![0].shortfall, 20);
  const [before] = times.get(at(9))!;
  assert.equal(before.driveAfter, 20);
  assert.equal(before.afterStart, at(10));
  assert.equal(before.shortfall, 0);
});

Deno.test("the break between appointments applies to Google busy times too", () => {
  const context = {
    ...base,
    bufferMinutes: 30,
    busy: [{ userId: "scott", startsAt: iso(11), endsAt: iso(12) }],
  };
  const times = openTimes(context, day, 60, "1 Main St", 0, flat(0));
  assert.deepEqual(starts(times), ["9:00 AM", "9:30 AM"]);
});

Deno.test("a full day is left out", () => {
  const context = {
    ...base,
    people: [{ ...scott, maxPerDay: 1 }],
    appointments: [{ userId: "scott", startsAt: iso(9), endsAt: iso(10), location: "1 Main St" }],
  };
  assert.equal(openTimes(context, day, 60, "1 Main St", 0, flat(0)).size, 0);
});

Deno.test("the person with the shortest drive comes first", () => {
  const context = {
    ...base,
    people: [scott, jad],
    appointments: [
      { userId: "scott", startsAt: iso(9), endsAt: iso(10), location: "far" },
      { userId: "jad", startsAt: iso(9), endsAt: iso(10), location: "near" },
    ],
  };
  const travel: Travel = (from, to) => (from === "far" || to === "far" ? 45 : 5);
  const times = openTimes(context, day, 60, "1 Main St", 0, travel);
  assert.deepEqual(times.get(at(11))!.map((candidate) => candidate.userId), ["jad", "scott"]);
  // Only Jad is back in time for 10:30; Scott is offered too, 15 minutes short.
  assert.deepEqual(times.get(at(10, 30))!.map((candidate) => [candidate.userId, candidate.shortfall]), [
    ["jad", 0],
    ["scott", 15],
  ]);
});

Deno.test("a visit nobody is assigned to counts for everyone", () => {
  const context = {
    ...base,
    people: [scott, jad],
    appointments: [{ userId: null, startsAt: iso(10), endsAt: iso(11), location: "1 Main St" }],
  };
  const times = openTimes(context, day, 60, "1 Main St", 0, flat(30));
  // Next door to it, so right after it, for either person.
  assert.deepEqual(times.get(at(11))!.map((candidate) => [candidate.userId, candidate.driveBefore]), [
    ["scott", 0],
    ["jad", 0],
  ]);
  assert.equal(times.has(at(10)), false);
});

Deno.test("hours ending at midnight and split days both work", () => {
  const context = {
    ...base,
    people: [{ ...scott, hours: [{ day: 2, start: "08:00", end: "09:00" }, { day: 2, start: "23:00", end: "24:00" }] }],
  };
  assert.deepEqual(starts(openTimes(context, day, 60, null, 0, flat(30))), ["8:00 AM", "11:00 PM"]);
});

const span = (window: { starts: { start: number; end: number }[] }) =>
  `${clock(window.starts[0].start)}–${clock(window.starts.at(-1)!.end)}`;

Deno.test("free time comes as stretches around visits, asked-for ones first", () => {
  const context = {
    ...base,
    people: [{ ...scott, hours: [{ day: 2, start: "09:00", end: "17:00" }, { day: 3, start: "09:00", end: "17:00" }] }],
    appointments: [{ userId: "scott", startsAt: iso(14), endsAt: iso(15), location: "next door" }],
  };
  const travel: Travel = (from, to) => (from === "next door" || to === "next door" ? 5 : 30);
  const open = [day, "2026-11-04"].map((date) => ({ day: date, times: openTimes(context, date, 60, "1 Main St", 0, travel) }));
  const windows = openWindows(open, { days: [day], window: "afternoon" }, zone, 30);
  // Tuesday: free until the 2 PM visit, and again after it.
  assert.deepEqual(windows.map((window) => [window.day === day ? "Tue" : "Wed", span(window)]), [
    ["Tue", "9:00 AM–2:00 PM"],
    ["Tue", "3:00 PM–5:00 PM"],
    ["Wed", "9:00 AM–5:00 PM"],
  ]);
  // Before a visit, the afternoon start closest to it that leaves the drive; after one, the first after the drive.
  assert.equal(clock(windows[0].suggested.start), "12:30 PM");
  assert.equal(clock(windows[1].suggested.start), "3:30 PM");
  assert.equal(clock(windows[2].suggested.start), "12:00 PM");
  assert.deepEqual(windows.map((window) => window.daysAway), [0, 0, 1]);
});

Deno.test("an empty day is one stretch with the first start offered", () => {
  const context = { ...base, people: [{ ...scott, hours: [{ day: 2, start: "09:00", end: "17:00" }] }] };
  const open = [{ day, times: openTimes(context, day, 60, "1 Main St", 0, flat(30)) }];
  const [only, ...rest] = openWindows(open, { days: [], window: "any" }, zone, 30);
  assert.equal(rest.length, 0);
  assert.equal(span(only), "9:00 AM–5:00 PM");
  assert.equal(only.starts.length, 15);
  assert.equal(clock(only.suggested.start), "9:00 AM");
});

Deno.test("each person gets their own stretches", () => {
  const context = {
    ...base,
    people: [scott, { ...jad, hours: [{ day: 2, start: "11:00", end: "13:00" }] }],
  };
  const open = [{ day, times: openTimes(context, day, 60, "1 Main St", 0, flat(30)) }];
  const windows = openWindows(open, { days: [day], window: "morning" }, zone, 30);
  assert.deepEqual(windows.map((window) => [window.userId, span(window)]), [
    ["scott", "9:00 AM–1:00 PM"],
    ["jad", "11:00 AM–1:00 PM"],
  ]);
});

Deno.test("a day with tight openings comes before a free day later on", () => {
  const context = {
    ...base,
    people: [{ ...scott, hours: [{ day: 2, start: "10:00", end: "14:00" }, { day: 3, start: "10:00", end: "14:00" }] }],
    appointments: [
      { userId: "scott", startsAt: iso(10), endsAt: iso(11), location: "far" },
      { userId: "scott", startsAt: iso(13, 15), endsAt: iso(14, 15), location: "far" },
    ],
  };
  const travel: Travel = (from, to) => (from === "far" || to === "far" ? 50 : 30);
  const open = [day, "2026-11-04"].map((date) => ({ day: date, times: openTimes(context, date, 60, "1 Main St", 0, travel) }));
  const windows = openWindows(open, { days: [], window: "any" }, zone, 30);
  assert.deepEqual(windows.map((window) => [window.day === day ? "Tue" : "Wed", span(window)]), [
    ["Tue", "11:00 AM–1:00 PM"],
    ["Wed", "10:00 AM–2:00 PM"],
  ]);
  // Nothing leaves both 50-minute drives; 11:30 comes closest (20 + 5 minutes short).
  assert.equal(clock(windows[0].suggested.start), "11:30 AM");
  assert.equal(windows[0].suggested.shortfall, 25);
});
