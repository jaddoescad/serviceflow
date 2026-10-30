import { strict as assert } from "node:assert";
import { instant } from "../_shared/zoned.ts";
import { type Context, openTimes, rankTimes, type Travel } from "./slots.ts";

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

Deno.test("an appointment blocks its time plus the drive to and from it", () => {
  const context = {
    ...base,
    appointments: [{ userId: "scott", startsAt: iso(10), endsAt: iso(11), location: "9 Elm St" }],
  };
  // 20 minutes each way: free until 9:40, from 11:20 (next half hour 11:30).
  const times = openTimes(context, day, 30, "1 Main St", 0, flat(20));
  assert.deepEqual(starts(times), ["9:00 AM", "11:30 AM", "12:00 PM", "12:30 PM"]);
  const [after] = times.get(at(11, 30))!;
  assert.equal(after.driveBefore, 20);
  assert.equal(after.driveAfter, null);
  const [before] = times.get(at(9))!;
  assert.equal(before.driveAfter, 20);
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
  // Only Jad is back in time for 10:30.
  assert.deepEqual(times.get(at(10, 30))!.map((candidate) => candidate.userId), ["jad"]);
});

Deno.test("hours ending at midnight and split days both work", () => {
  const context = {
    ...base,
    people: [{ ...scott, hours: [{ day: 2, start: "08:00", end: "09:00" }, { day: 2, start: "23:00", end: "24:00" }] }],
  };
  assert.deepEqual(starts(openTimes(context, day, 60, null, 0, flat(30))), ["8:00 AM", "11:00 PM"]);
});

Deno.test("asked-for times come first, closest to other visits first", () => {
  const context = {
    ...base,
    people: [{ ...scott, hours: [{ day: 2, start: "09:00", end: "17:00" }, { day: 3, start: "09:00", end: "17:00" }] }],
    appointments: [{ userId: "scott", startsAt: iso(14), endsAt: iso(15), location: "next door" }],
  };
  const travel: Travel = (from, to) => (from === "next door" || to === "next door" ? 5 : 30);
  const open = [day, "2026-11-04"].map((date) => ({ day: date, times: openTimes(context, date, 60, "1 Main St", 0, travel) }));
  const { best, other } = rankTimes(open, { days: [day], window: "afternoon" }, zone, 30);
  // Tuesday afternoon around the 2–3 PM visit five minutes away (1 PM would run into it).
  assert.deepEqual(best.map((option) => clock(option.start)), ["12:00 PM", "12:30 PM", "3:30 PM"]);
  assert.ok(best.every((option) => option.matchesDay && option.matchesTime && (option.driveAfter ?? option.driveBefore) === 5));
  // Then Tuesday morning (the asked-for day), then Wednesday afternoon.
  assert.deepEqual(other.map((option) => [option.day, option.daysAway, option.matchesTime]), [
    [day, 0, false],
    [day, 0, false],
    ["2026-11-04", 1, true],
    ["2026-11-04", 1, true],
  ]);
});

Deno.test("no asked-for days means any day, earliest first among equals", () => {
  const open = [{ day, times: openTimes(base, day, 60, "1 Main St", 0, flat(30)) }];
  const { best, other } = rankTimes(open, { days: [], window: "morning" }, zone, 30);
  assert.deepEqual(best.map((option) => clock(option.start)), ["9:00 AM", "9:30 AM", "10:00 AM"]);
  assert.ok(best.every((option) => option.daysAway === 0));
  assert.deepEqual(other.map((option) => clock(option.start)), ["12:00 PM"]);
});
