import assert from "node:assert/strict";
import test from "node:test";

import {
  localDayRange,
  parseCliArgs,
  parseClockInAt,
  resolveLocalDate,
  runSetClockIn,
  selectClockInEntry,
} from "./hermes-time-entry-cli.mjs";

test("parses the natural short set-clock-in command", () => {
  const args = parseCliArgs(["set-clock-in", "Scott", "8am", "--yes", "--json"]);
  assert.equal(args.command, "set-clock-in");
  assert.equal(args.employee, "Scott");
  assert.equal(args.at, "8am");
  assert.equal(args.timeZone, "America/Toronto");
  assert.equal(args.yes, true);
  assert.equal(args.json, true);
});

test("defaults the date to today in Toronto", () => {
  const now = new Date("2026-08-10T02:30:00.000Z");
  assert.equal(resolveLocalDate(null, { now }), "2026-08-09");
  assert.equal(resolveLocalDate("yesterday", { now }), "2026-08-08");
});

test("converts 8am Toronto summer time to UTC", () => {
  const result = parseClockInAt("8am", {
    date: "2026-08-10",
    now: new Date("2026-08-10T14:00:00.000Z"),
  });
  assert.equal(result.toISOString(), "2026-08-10T12:00:00.000Z");
});

test("converts 8am Toronto winter time to UTC", () => {
  const result = parseClockInAt("8am", {
    date: "2026-12-10",
    now: new Date("2026-12-10T14:00:00.000Z"),
  });
  assert.equal(result.toISOString(), "2026-12-10T13:00:00.000Z");
});

test("builds a Toronto local day range", () => {
  const summer = localDayRange("2026-08-10");
  assert.equal(summer.start.toISOString(), "2026-08-10T04:00:00.000Z");
  assert.equal(summer.end.toISOString(), "2026-08-11T04:00:00.000Z");
});

test("uses an embedded local date when --date is omitted", async () => {
  const seen = [];
  await runSetClockIn(
    parseCliArgs(["set-clock-in", "Scott", "2026-08-10T8am", "--dry-run"]),
    {
      now: new Date("2026-08-12T15:00:00.000Z"),
      config: { supabaseUrl: "https://example.invalid", timeEntryToken: "secret" },
      request: async (_config, body) => {
        seen.push(body);
        return {
          entryId: "entry-id",
          employeeName: "Scott Madden",
          projectName: "First Job",
          previousStartedAt: "2026-08-10T12:30:00.000Z",
          requestedStartedAt: body.startedAt,
          status: "dry_run",
        };
      },
    },
  );
  assert.equal(seen[0].rangeStart, "2026-08-10T04:00:00.000Z");
  assert.equal(seen[0].rangeEnd, "2026-08-11T04:00:00.000Z");
});

test("selects the earliest clock-in for one uniquely matched employee", () => {
  const entry = selectClockInEntry(
    [
      {
        id: "later",
        user_id: "scott-id",
        user_name: "Scott Madden",
        project_name: "Second Job",
        started_at: "2026-08-10T17:00:00.000Z",
        status: "completed",
      },
      {
        id: "first",
        user_id: "scott-id",
        user_name: "Scott Madden",
        project_name: "First Job",
        started_at: "2026-08-10T12:30:00.000Z",
        status: "completed",
      },
    ],
    "Scott",
  );
  assert.equal(entry.id, "first");
});

test("uses a supplied project to select a later project clock-in", () => {
  const entry = selectClockInEntry(
    [
      {
        id: "first",
        user_id: "scott-id",
        user_name: "Scott Madden",
        project_name: "First Job",
        started_at: "2026-08-10T12:30:00.000Z",
        status: "completed",
      },
      {
        id: "later",
        user_id: "scott-id",
        user_name: "Scott Madden",
        project_name: "Second Job",
        started_at: "2026-08-10T17:00:00.000Z",
        status: "completed",
      },
    ],
    "Scott",
    "Second",
  );
  assert.equal(entry.id, "later");
});

test("rejects an employee-name collision", () => {
  assert.throws(
    () =>
      selectClockInEntry(
        [
          {
            id: "one",
            user_id: "one-id",
            user_name: "Scott Madden",
            project_name: "First Job",
            started_at: "2026-08-10T12:30:00.000Z",
            status: "completed",
          },
          {
            id: "two",
            user_id: "two-id",
            user_name: "Scott MacEwen",
            project_name: "Other Job",
            started_at: "2026-08-10T13:00:00.000Z",
            status: "completed",
          },
        ],
        "Scott",
      ),
    /More than one employee matched/,
  );
});

test("previews, confirms, and applies through the narrow endpoint", async () => {
  const calls = [];
  const request = async (_config, body) => {
    calls.push(body);
    return {
      entryId: "entry-id",
      employeeName: "Scott Madden",
      projectName: "First Job",
      previousStartedAt: "2026-08-10T12:30:00.000Z",
      requestedStartedAt: body.startedAt,
      status: body.apply ? "updated" : "dry_run",
    };
  };

  const result = await runSetClockIn(
    parseCliArgs(["set-clock-in", "Scott", "8am", "--date", "2026-08-10", "--yes"]),
    {
      now: new Date("2026-08-10T15:00:00.000Z"),
      config: { supabaseUrl: "https://example.invalid", timeEntryToken: "secret" },
      request,
    },
  );

  assert.equal(result.status, "updated");
  assert.equal(result.requested_started_at, "2026-08-10T12:00:00.000Z");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].rangeStart, "2026-08-10T04:00:00.000Z");
  assert.equal(calls[0].rangeEnd, "2026-08-11T04:00:00.000Z");
  assert.equal(calls[0].apply, false);
  assert.equal(calls[1].startedAt, "2026-08-10T12:00:00.000Z");
  assert.equal(calls[1].apply, true);
});
