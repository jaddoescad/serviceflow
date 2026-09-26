#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const modelSource = await readFile(new URL("src/lib/projectLabourTaskModel.js", root), "utf8");
const model = await import(
  `data:text/javascript;base64,${Buffer.from(modelSource).toString("base64")}`
);

const plan = model.normalizeProjectLabourTaskRows([
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
    status: "in_progress",
    sort_order: 0,
    metadata: { section: "interior" },
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
    status: "completed",
    sort_order: 1,
    metadata: {},
  },
]);

assert.equal(plan.budget.sourceQuoteName, "Main scope");
assert.equal(plan.budget.totalBudgetedHours, 6.25);
assert.deepEqual(plan.tasks.map((task) => task.title), ["Living room", "Soffits"]);
assert.equal(plan.tasks[0].budgetedHours, 4.25);
assert.equal(plan.tasks[1].status, "completed");
assert.equal("hoursSpent" in plan.tasks[0], false);
assert.equal("activePainters" in plan.tasks[0], false);
assert.equal("myActiveStartedAt" in plan.tasks[0], false);

const summary = model.projectLabourTaskSummary(plan);
assert.equal(summary.taskCount, 2);
assert.equal(summary.completedCount, 1);
assert.equal(summary.budgetedHours, 6.25);
assert.equal("spentHours" in summary, false);
assert.equal("hoursPercent" in summary, false);

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
assert.match(repositorySource, /from\(["']job_tasks["']\)/);
assert.match(repositorySource, /from\(["']job_budgets["']\)/);
assert.match(repositorySource, /rpc\(["']set_job_task_status["']/);
assert.match(repositorySource, /runTaskCommand\(["']task_issue["']/);
assert.match(repositorySource, /postgres_changes/);
assert.match(repositorySource, /removeChannel/);
assert.match(repositorySource, /flushPendingProjectLabourTaskWrites/);
assert.match(repositorySource, /withoutTaskTimerState/);
assert.doesNotMatch(
  repositorySource,
  /job_task_time_entries|task_start|task_stop|task_adjust|timer_start|timer_stop|timer_adjust/,
);
assert.doesNotMatch(repositorySource, /project_calculators|calculator_(?:price|rate)|service_role/);

const hookSource = await readFile(new URL("src/lib/useProjectLabourTasks.js", root), "utf8");
assert.match(hookSource, /toggleCompleted/);
assert.doesNotMatch(
  hookSource,
  /startTimer|stopTimer|fetchLastSession|adjustSession|myActiveStartedAt|hoursSpent/,
);

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
assert.doesNotMatch(projectScreenSource, /accessibilityLabel=["']Tasks["']/);
assert.match(projectScreenSource, /<ProjectLabourTasksPanel/);
assert.match(projectScreenSource, /tracking=\{labourTasks\}/);
assert.match(projectScreenSource, /showHoursMeter=\{false\}/);
assert.match(panelSource, /accessibilityRole=["']checkbox["']/);
assert.match(panelSource, /tracking\.toggleCompleted\(task\)/);
assert.match(panelSource, /<BudgetBurnMeter/);
assert.match(panelSource, /summary\.completedCount/);
assert.match(panelSource, /summary\.budgetedHours/);
assert.doesNotMatch(panelSource, /\bprice\b|hourly rate|labour rate/i);

const timeTrackingSource = await readFile(new URL("src/lib/timeTracking.js", root), "utf8");
assert.match(timeTrackingSource, /flushPendingProjectLabourTaskWrites\(\)/);
assert.doesNotMatch(timeTrackingSource, /stopActiveProjectLabourTaskTimer/);

console.log(
  "Mobile labour-task checks passed: checklist tasks, planned hours, realtime refresh, and offline status writes without task-level timers.",
);
