#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const modelSource = await readFile(new URL("src/lib/projectLabourTaskModel.js", root), "utf8");
const model = await import(
  `data:text/javascript;base64,${Buffer.from(modelSource).toString("base64")}`
);

const fetchedAt = Date.parse("2026-07-21T12:30:00.000Z");
const plan = {
  ...model.normalizeProjectLabourTaskRows([
    {
      labour_budget_id: "11111111-1111-4111-8111-111111111111",
      companycam_project_id: "job-1",
      source_quote_id: "quote-1",
      source_quote_name: "Main scope",
      instructions: "Protect the floors.",
      total_budgeted_hours: "6.25",
      budget_revision: 2,
      published_at: "2026-07-21T12:00:00.000Z",
      task_id: "22222222-2222-4222-8222-222222222222",
      source_kind: "room",
      title: "Living room",
      notes: "Patch north wall",
      task_budgeted_hours: "4.25",
      hours_spent: "1.50",
      status: "in_progress",
      sort_order: 0,
      metadata: { section: "interior" },
      my_active_started_at: "2026-07-21T12:00:00.000Z",
      active_painters: [
        {
          user_id: "44444444-4444-4444-8444-444444444444",
          display_name: "Pat Painter",
          started_at: "2026-07-21T12:00:00.000Z",
        },
      ],
    },
    {
      labour_budget_id: "11111111-1111-4111-8111-111111111111",
      companycam_project_id: "job-1",
      source_quote_id: "quote-1",
      source_quote_name: "Main scope",
      total_budgeted_hours: "6.25",
      budget_revision: 2,
      task_id: "33333333-3333-4333-8333-333333333333",
      source_kind: "exterior",
      title: "Soffits",
      task_budgeted_hours: "2",
      hours_spent: "0.5",
      status: "completed",
      sort_order: 1,
      metadata: {},
    },
  ]),
  fetchedAt,
};

assert.equal(plan.budget.sourceQuoteName, "Main scope");
assert.equal(plan.budget.totalBudgetedHours, 6.25);
assert.deepEqual(plan.tasks.map((task) => task.title), ["Living room", "Soffits"]);
assert.equal(plan.tasks[0].budgetedHours, 4.25);
assert.equal(plan.tasks[1].status, "completed");
assert.equal(plan.tasks[0].activePainters[0].displayName, "Pat Painter");
assert.deepEqual(plan.tasks[1].activePainters, []);

const summary = model.projectLabourTaskSummary(
  plan,
  fetchedAt + 30 * 60 * 1000,
);
assert.equal(summary.taskCount, 2);
assert.equal(summary.completedCount, 1);
assert.equal(summary.budgetedHours, 6.25);
assert.equal(summary.spentHours, 2.5, "active task time should advance from the fetch snapshot");

assert.equal(
  model.isSameLabourTaskProject(
    { companycam_id: "job-1" },
    { project: { companycam_id: "job-1" } },
  ),
  true,
);
assert.equal(
  model.isSameLabourTaskProject(
    { companycam_id: "job-1" },
    { project: { companycam_id: "job-2" } },
  ),
  false,
);

const repositorySource = await readFile(new URL("src/lib/projectLabourTasks.js", root), "utf8");
assert.match(repositorySource, /rpc\(["']list_project_labour_tasks["']/);
assert.match(repositorySource, /list_project_labour_tasks_live/);
assert.match(repositorySource, /project_labour_task_live_state/);
assert.match(repositorySource, /postgres_changes/);
assert.match(repositorySource, /removeChannel/);
assert.match(repositorySource, /withoutRealtimePresence/);
assert.match(repositorySource, /rpc\(["']set_project_labour_task_status["']/);
assert.match(repositorySource, /project_labour_task_time_entries/);
assert.match(repositorySource, /client_entry_id/);
assert.match(repositorySource, /flushPendingProjectLabourTaskWrites/);
assert.match(repositorySource, /timer_adjust/);
assert.match(repositorySource, /getMyLatestTaskSession/);
assert.match(repositorySource, /not\("ended_at", "is", null\)/);
assert.doesNotMatch(repositorySource, /project_calculators|calculator_(?:price|rate)|service_role/);

const stableProgressMigration = await readFile(
  new URL(
    "supabase/migrations/20260721210000_stabilize_labour_task_progress.sql",
    root,
  ),
  "utf8",
);
assert.match(stableProgressMigration, /create table public\.project_labour_task_progress/);
assert.match(stableProgressMigration, /timer\.progress_id = progress\.id/);
assert.match(stableProgressMigration, /A painter is timing a task that is not in this calculator/);
assert.match(stableProgressMigration, /where task\.id = requested_task_id;/);
assert.match(stableProgressMigration, /public\.can_start_project_labour_task_timer\(task_id\)/);

const realtimeMigration = await readFile(
  new URL(
    "supabase/migrations/20260721230000_enable_labour_task_realtime.sql",
    root,
  ),
  "utf8",
);
assert.match(realtimeMigration, /create table public\.project_labour_task_live_state/);
assert.match(realtimeMigration, /public\.can_access_project_labour_job\(companycam_project_id\)/);
assert.match(realtimeMigration, /alter publication supabase_realtime/);
assert.match(realtimeMigration, /active_painters jsonb/);
assert.doesNotMatch(realtimeMigration, /calculator_(?:price|rate)|service_role/);

const amountSyncMigration = await readFile(
  new URL(
    "supabase/migrations/20260721220000_sync_calculator_job_amount.sql",
    root,
  ),
  "utf8",
);
assert.match(amountSyncMigration, /public\.publish_project_calculator_default/);
assert.match(amountSyncMigration, /public\.publish_project_labour_budget/);
assert.match(amountSyncMigration, /amount_including_tax = round\(requested_amount_including_tax, 2\)/);
assert.match(amountSyncMigration, /to authenticated/);

const clockScreenSource = await readFile(new URL("src/screens/ClockInScreen.js", root), "utf8");
const activeClockSource = await readFile(
  new URL("src/screens/clock-in/ActiveClockInBody.js", root),
  "utf8",
);
const projectScreenSource = await readFile(
  new URL("src/screens/ProjectDetailScreen.js", root),
  "utf8",
);
const panelSource = await readFile(
  new URL("src/components/ProjectLabourTasksPanel.js", root),
  "utf8",
);
assert.match(clockScreenSource, /useProjectLabourTasks\(getProjectId\(displayProject\)/);
assert.match(clockScreenSource, /labourTasks=\{labourTasks\}/);
assert.match(activeClockSource, /<ProjectLabourTasksPanel/);
assert.match(activeClockSource, /activeShift=\{activeShift\}/);
assert.doesNotMatch(projectScreenSource, /accessibilityLabel=["']Tasks["']/);
assert.doesNotMatch(projectScreenSource, /<ProjectLabourTasksPanel/);
assert.match(panelSource, /Start timer for/);
assert.match(panelSource, /Stop timer for/);
assert.match(panelSource, /is on this task/);
assert.doesNotMatch(panelSource, />Live</);
assert.match(panelSource, /of \$\{formatHours\(budgetedHours\)\}|of \{formatHours/);
assert.doesNotMatch(panelSource, /accessibilityRole=["']checkbox["']/);
assert.match(panelSource, /Adjust time for/);
assert.match(panelSource, /adjustSession/);
assert.doesNotMatch(panelSource, /\bprice\b|hourly rate|labour rate/i);

const timeTrackingSource = await readFile(new URL("src/lib/timeTracking.js", root), "utf8");
assert.match(timeTrackingSource, /stopActiveProjectLabourTaskTimer\(\{ userId: shift\.userId, endedAt \}\)/);
assert.match(timeTrackingSource, /flushPendingProjectLabourTaskWrites\(\)/);

console.log(
  "Mobile labour-task checks passed: painter-safe realtime presence, live hour totals, active Clock In task UI, offline write queue, and shift-linked timer cleanup.",
);
