import assert from "node:assert/strict";
import test from "node:test";

import { selectCurrentOperationalBudgets } from "../src/lib/job-budget-selection.ts";

const row = (overrides) => ({
  job_id: "job-1",
  source: "project_budget",
  status: "active",
  version: 1,
  updated_at: "2026-07-01T00:00:00.000Z",
  ...overrides,
});

test("ignores published task budgets when selecting the job amount and closure", () => {
  const selected = selectCurrentOperationalBudgets([
    row({ id: "job-budget" }),
    row({ id: "task-budget", source: "published_labour_budget", version: 99, updated_at: "2026-08-01T00:00:00.000Z" }),
  ]);
  assert.equal(selected.get("job-1")?.id, "job-budget");
});

test("prefers the latest manual override over the migrated budget", () => {
  const selected = selectCurrentOperationalBudgets([
    row({ id: "migrated", version: 8 }),
    row({ id: "manual", source: "manual", updated_at: "2026-08-02T00:00:00.000Z" }),
  ]);
  assert.equal(selected.get("job-1")?.id, "manual");
});

test("does not infer labour closure from unrelated budget rows", () => {
  const selected = selectCurrentOperationalBudgets([
    row({ id: "current", status: "closed" }),
    row({ id: "superseded", status: "superseded", updated_at: "2026-08-03T00:00:00.000Z" }),
  ]);
  assert.equal(selected.get("job-1")?.id, "current");
});
