import assert from "node:assert/strict";
import test from "node:test";
import { resolveMetricsPeriod } from "../src/lib/metrics-period.ts";

const today = "2026-08-20";

test("calendar presets use matching prior calendar periods", () => {
  assert.deepEqual(resolveMetricsPeriod("this_month", today), {
    preset: "this_month",
    current: { start: "2026-08-01", end: "2026-08-20" },
    previous: { start: "2026-07-01", end: "2026-07-20" },
  });
  assert.deepEqual(resolveMetricsPeriod("this_week", today), {
    preset: "this_week",
    current: { start: "2026-08-17", end: "2026-08-20" },
    previous: { start: "2026-08-10", end: "2026-08-13" },
  });
  assert.deepEqual(resolveMetricsPeriod("last_month", today), {
    preset: "last_month",
    current: { start: "2026-07-01", end: "2026-07-31" },
    previous: { start: "2026-06-01", end: "2026-06-30" },
  });
});

test("rolling and custom presets use equal-length preceding periods", () => {
  assert.deepEqual(resolveMetricsPeriod("last_30_days", today), {
    preset: "last_30_days",
    current: { start: "2026-07-22", end: "2026-08-20" },
    previous: { start: "2026-06-22", end: "2026-07-21" },
  });
  assert.deepEqual(resolveMetricsPeriod("custom", today, "2026-06-10", "2026-06-19"), {
    preset: "custom",
    current: { start: "2026-06-10", end: "2026-06-19" },
    previous: { start: "2026-05-31", end: "2026-06-09" },
  });
});

test("month chips select complete past months and month-to-date for the current month", () => {
  assert.deepEqual(resolveMetricsPeriod("month", today, undefined, undefined, "2026-01"), {
    preset: "month",
    current: { start: "2026-01-01", end: "2026-01-31" },
    previous: { start: "2025-12-01", end: "2025-12-31" },
  });
  assert.deepEqual(resolveMetricsPeriod("month", today, undefined, undefined, "2026-02"), {
    preset: "month",
    current: { start: "2026-02-01", end: "2026-02-28" },
    previous: { start: "2026-01-01", end: "2026-01-31" },
  });
  assert.deepEqual(resolveMetricsPeriod("month", today, undefined, undefined, "2026-08"), {
    preset: "month",
    current: { start: "2026-08-01", end: "2026-08-20" },
    previous: { start: "2026-07-01", end: "2026-07-20" },
  });
});

test("invalid or future custom ranges fall back safely to this month", () => {
  assert.equal(resolveMetricsPeriod("custom", today, "2026-08-25", "2026-08-30").preset, "this_month");
  assert.equal(resolveMetricsPeriod("month", today, undefined, undefined, "2026-09").preset, "this_month");
  assert.equal(resolveMetricsPeriod("unknown", today).preset, "this_month");
});
