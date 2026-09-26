#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/lib/projectClockInSummary.js", import.meta.url),
  "utf8",
);
const presenter = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
);

const rawJadEntry = {
  id: "jad-clock-in",
  durationMs: 125 * 60_000,
  onSite: false,
};
const jadSegments = [
  segment("jad-clock-in", "off", 20, rawJadEntry),
  segment("jad-clock-in", "unknown", 0, rawJadEntry),
  segment("jad-clock-in", "off", 80, rawJadEntry),
  segment("jad-clock-in", "unknown", 0, rawJadEntry),
  segment("jad-clock-in", "off", 25, rawJadEntry),
];
const rawMichaelEntry = {
  id: "michael-clock-in",
  durationMs: 300 * 60_000,
  onSite: null,
};

const summaries = presenter.buildPainterClockInSummaries([
  {
    id: "2026-07-16",
    label: "Thursday",
    dateLabel: "Jul 16, 2026",
    painters: [
      {
        name: "Jad Slim",
        initials: "JS",
        isYou: true,
        segments: jadSegments,
      },
      {
        name: "Michael Matambo",
        initials: "MM",
        isYou: false,
        segments: [segment("michael-clock-in", "unknown", 300, rawMichaelEntry)],
      },
    ],
  },
]);

const jad = summaries.find((summary) => summary.name === "Jad Slim");
assert.equal(jad.clockInCount, 1, "five GPS segments must remain one clock-in");
assert.equal(jad.days[0].clockIns.length, 1);
assert.equal(jad.days[0].clockIns[0].gpsSegments.length, 5, "all GPS segments must be retained");
assert.equal(jad.days[0].clockIns[0].status, "off");
assert.equal(jad.offSiteCount, 1);
assert.equal(jad.onSiteCount, 0);
assert.equal(jad.unknownLocationCount, 0);
assert.equal(jad.totalMinutes, 125);

const michael = summaries.find((summary) => summary.name === "Michael Matambo");
assert.equal(michael.clockInCount, 1);
assert.equal(michael.unknownLocationCount, 1);
assert.equal(michael.onSiteCount, 0, "missing GPS must not be presented as on site");
assert.equal(michael.days[0].clockIns[0].status, "unknown");

console.log(
  "Project clock-in summary checks passed: time entries are counted once, GPS segments remain attached, and missing GPS stays unknown.",
);

function segment(entryId, status, minutes, raw) {
  return {
    entryId,
    status,
    durationMs: minutes * 60_000,
    duration: `${Math.floor(minutes / 60)}h ${minutes % 60}m`,
    start: "2:00 PM",
    end: "4:05 PM",
    startSrc: "GPS",
    endSrc: "GPS",
    distanceLabel: status === "off" ? "19.3 km from site" : null,
    raw,
    isCurrentUser: raw.id === "jad-clock-in",
  };
}
