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
      config: { supabaseUrl: "https://example.invalid", serviceRoleKey: "secret", actorEmail: "admin@example.com" },
      request: async (_config, _table, options) => {
        seen.push(options);
        return [
          {
            id: "entry-id",
            user_id: "scott-id",
            user_name: "Scott Madden",
            project_name: "First Job",
            started_at: "2026-08-10T12:30:00.000Z",
            ended_at: "2026-08-10T20:00:00.000Z",
            status: "completed",
          },
        ];
      },
    },
  );
  assert.deepEqual(seen[0].params.started_at, [
    "gte.2026-08-10T04:00:00.000Z",
    "lt.2026-08-11T04:00:00.000Z",
  ]);
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

test("updates one resolved entry with an optimistic filter and audit history", async () => {
  const calls = [];
  const entry = {
    id: "entry-id",
    user_id: "scott-id",
    user_name: "Scott Madden",
    project_name: "First Job",
    started_at: "2026-08-10T12:30:00.000Z",
    ended_at: "2026-08-10T20:00:00.000Z",
    status: "completed",
    original_started_at: null,
    adjustment_history: [],
  };
  const request = async (_config, table, options) => {
    calls.push({ table, options });
    if (options.method === "PATCH") return [{ ...entry, started_at: options.body.started_at }];
    return [entry];
  };

  const result = await runSetClockIn(
    parseCliArgs(["set-clock-in", "Scott", "8am", "--date", "2026-08-10", "--yes"]),
    {
      now: new Date("2026-08-10T15:00:00.000Z"),
      config: { supabaseUrl: "https://example.invalid", serviceRoleKey: "secret", actorEmail: "admin@example.com" },
      actor: { user_id: "admin-id", role: "admin" },
      request,
    },
  );

  assert.equal(result.status, "updated");
  assert.equal(result.requested_started_at, "2026-08-10T12:00:00.000Z");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].options.params.started_at, [
    "gte.2026-08-10T04:00:00.000Z",
    "lt.2026-08-11T04:00:00.000Z",
  ]);
  assert.equal(calls[1].options.method, "PATCH");
  assert.equal(calls[1].options.params.id, "eq.entry-id");
  assert.equal(calls[1].options.params.started_at, "eq.2026-08-10T12:30:00.000Z");
  assert.equal(calls[1].options.body.original_started_at, "2026-08-10T12:30:00.000Z");
  assert.equal(calls[1].options.body.started_at, "2026-08-10T12:00:00.000Z");
  assert.equal(calls[1].options.body.adjustment_history[0].source, "hermes_slack");
});
