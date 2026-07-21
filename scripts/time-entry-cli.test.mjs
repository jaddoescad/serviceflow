import assert from "node:assert/strict";
import test from "node:test";
import { parseCliArgs, parseClockOutAt, selectActiveShift } from "./time-entry-cli.mjs";

test("parses the short clock-out command", () => {
  const args = parseCliArgs(["clock-out", "Michael Matambo", "6pm", "--yes"]);
  assert.equal(args.command, "clock-out");
  assert.equal(args.employee, "Michael Matambo");
  assert.equal(args.at, "6pm");
  assert.equal(args.yes, true);
});

test("converts Toronto local times to UTC", () => {
  const result = parseClockOutAt("6pm", {
    date: "2026-07-17",
    timeZone: "America/Toronto",
    now: new Date("2026-07-17T21:00:00.000Z"),
  });
  assert.equal(result.toISOString(), "2026-07-17T22:00:00.000Z");
});

test("accepts an explicit offset timestamp unchanged", () => {
  const result = parseClockOutAt("2026-07-17T18:00:00-04:00");
  assert.equal(result.toISOString(), "2026-07-17T22:00:00.000Z");
});

test("selects one active shift by a partial employee name", () => {
  const shift = selectActiveShift(
    [
      { user_name: "Michael Matambo", project_name: "Anjou Delplancke" },
      { user_name: "Scott Madden", project_name: "Anjou Delplancke" },
    ],
    "michael",
  );
  assert.equal(shift.user_name, "Michael Matambo");
});

test("requires project disambiguation when names collide", () => {
  assert.throws(
    () =>
      selectActiveShift(
        [
          { user_name: "Michael Matambo", project_name: "Project One" },
          { user_name: "Michael Matambo", project_name: "Project Two" },
        ],
        "Michael Matambo",
      ),
    /Add --project/,
  );
});
