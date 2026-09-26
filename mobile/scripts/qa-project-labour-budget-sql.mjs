#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const MANAGER_ID = "11111111-1111-4111-8111-111111111111";
const PAINTER_ID = "22222222-2222-4222-8222-222222222222";
const OUTSIDER_ID = "33333333-3333-4333-8333-333333333333";
const CREW_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "job-1";
const migrationUrl = new URL(
  "../supabase/migrations/20260721150000_publish_calculator_labour_budgets.sql",
  import.meta.url,
);
const overrideMigrationUrl = new URL(
  "../supabase/migrations/20260721190000_add_labour_task_hour_overrides.sql",
  import.meta.url,
);
const stableProgressMigrationUrl = new URL(
  "../supabase/migrations/20260721210000_stabilize_labour_task_progress.sql",
  import.meta.url,
);
const realtimeMigrationUrl = new URL(
  "../supabase/migrations/20260721230000_enable_labour_task_realtime.sql",
  import.meta.url,
);
const amountSyncMigrationUrl = new URL(
  "../supabase/migrations/20260721220000_sync_calculator_job_amount.sql",
  import.meta.url,
);

const db = new PGlite();

await db.exec(`
  create role anon;
  create role authenticated;
  create schema auth;

  create function auth.uid()
  returns uuid
  language sql
  stable
  as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  create table auth.users (id uuid primary key);

  create table public.employee_profiles (
    user_id uuid primary key references auth.users(id),
    email text,
    full_name text,
    role text not null,
    is_active boolean not null default true
  );

  create table public.companycam_projects (
    companycam_id text primary key
  );

  create table public.project_assignments (
    id uuid primary key default gen_random_uuid(),
    companycam_project_id text not null references public.companycam_projects(companycam_id),
    user_id uuid not null references auth.users(id),
    status text not null
  );

  create table public.time_entries (
    id uuid primary key default gen_random_uuid()
  );

  create table public.project_budgets (
    companycam_project_id text primary key references public.companycam_projects(companycam_id),
    budgeted_hours numeric(10, 2),
    amount_including_tax numeric(12, 2) check (amount_including_tax is null or amount_including_tax >= 0),
    updated_by uuid references auth.users(id)
  );

  create table public.project_calculators (
    companycam_project_id text primary key,
    doc jsonb not null,
    updated_by uuid references auth.users(id),
    updated_at timestamptz not null default now()
  );

  create function public.set_updated_at()
  returns trigger
  language plpgsql
  as $$
  begin
    new.updated_at = timezone('utc', now());
    return new;
  end;
  $$;

  create function public.current_employee_role()
  returns text
  language sql
  stable
  security definer
  set search_path = public
  as $$
    select profile.role
    from public.employee_profiles profile
    where profile.user_id = auth.uid()
      and profile.is_active = true
    limit 1
  $$;

  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;

  insert into auth.users (id) values
    ('${MANAGER_ID}'),
    ('${PAINTER_ID}'),
    ('${OUTSIDER_ID}'),
    ('${CREW_ID}');
  insert into public.employee_profiles (user_id, email, full_name, role) values
    ('${MANAGER_ID}', 'manager@example.com', 'Morgan Manager', 'manager'),
    ('${PAINTER_ID}', 'painter@example.com', 'Pat Painter', 'painter'),
    ('${OUTSIDER_ID}', 'outsider@example.com', 'Olivia Outsider', 'painter'),
    ('${CREW_ID}', 'crew@example.com', 'Casey Crew', 'painter');
  insert into public.companycam_projects (companycam_id) values ('${PROJECT_ID}'), ('job-empty');
  insert into public.project_assignments (companycam_project_id, user_id, status)
  values
    ('${PROJECT_ID}', '${PAINTER_ID}', 'active'),
    ('${PROJECT_ID}', '${CREW_ID}', 'active');
`);

const migrationSql = (await readFile(migrationUrl, "utf8")).replace(
  "create extension if not exists pgcrypto;",
  "-- pgcrypto is already installed in Supabase; PGlite provides gen_random_uuid() directly.",
);
await db.exec(migrationSql);
await db.exec(await readFile(overrideMigrationUrl, "utf8"));
await db.exec(await readFile(stableProgressMigrationUrl, "utf8"));
await db.exec(await readFile(amountSyncMigrationUrl, "utf8"));
await db.exec(await readFile(realtimeMigrationUrl, "utf8"));
await db.exec(`set "request.jwt.claim.sub" = '${MANAGER_ID}'`);

const quoteOne = {
  version: 2,
  activeQuoteId: "quote-1",
  quotes: [
    {
      id: "quote-1",
      name: "Original scope",
      notes: "Protect the hardwood floors.",
      updatedAt: "2026-07-21T15:00:00.000Z",
    },
  ],
};
const firstTasks = [
  {
    sourceKind: "room",
    sourceItemId: "room-1",
    title: "Living room",
    notes: "Patch north wall",
    budgetedHours: 4.25,
    sortOrder: 0,
    metadata: { section: "interior" },
  },
  {
    sourceKind: "exterior",
    sourceItemId: "line-1",
    title: "Soffits",
    notes: null,
    budgetedHours: 2,
    sortOrder: 1,
    metadata: { section: "trim" },
  },
];

const emptyDefault = await publish(quoteOne, "quote-1", [], "job-empty");
assert.equal(emptyDefault.source_quote_id, "quote-1");
assert.equal(Number(emptyDefault.budgeted_hours), 0);
assert.equal(Number(emptyDefault.task_count), 0);
assert.equal(Number(emptyDefault.revision), 1);

let published = await publish(quoteOne, "quote-1", firstTasks);
assert.equal(published.source_quote_name, "Original scope");
assert.equal(Number(published.budgeted_hours), 6.25);
assert.equal(Number(published.task_count), 2);
assert.equal(Number(published.revision), 1);

let [{ budgeted_hours: legacyHours }] = (
  await db.query(
    "select budgeted_hours from public.project_budgets where companycam_project_id = $1",
    [PROJECT_ID],
  )
).rows;
assert.equal(Number(legacyHours), 6.25);
let [{ amount_including_tax: calculatorAmount }] = (
  await db.query(
    "select amount_including_tax from public.project_budgets where companycam_project_id = $1",
    [PROJECT_ID],
  )
).rows;
assert.equal(Number(calculatorAmount), 1130);
await assert.rejects(
  publish(quoteOne, "quote-1", firstTasks, PROJECT_ID, -1),
  /calculator amount must be zero or greater/i,
);

let activeTasks = (
  await db.query(
    "select id, source_item_id, status, calculated_hours, manual_budgeted_hours, budgeted_hours from public.project_labour_tasks where companycam_project_id = $1 and is_active order by sort_order",
    [PROJECT_ID],
  )
).rows;
assert.deepEqual(activeTasks.map((task) => task.source_item_id), ["room-1", "line-1"]);
assert.equal(Number(activeTasks[0].calculated_hours), 4.25);
assert.equal(activeTasks[0].manual_budgeted_hours, null);
assert.equal(Number(activeTasks[0].budgeted_hours), 4.25);
await assert.rejects(
  db.query(
    "select * from public.set_project_labour_task_budget_hours($1, $2::uuid, $3::numeric)",
    ["job-empty", activeTasks[0].id, 5.5],
  ),
  /Active task not found/,
);
await assert.rejects(
  db.query(
    "update public.project_labour_tasks set calculated_hours = 9 where id = $1::uuid",
    [activeTasks[0].id],
  ),
  /Calculated task hours require a new budget revision/,
);

let [overriddenTask] = (
  await db.query(
    "select * from public.set_project_labour_task_budget_hours($1, $2::uuid, $3::numeric)",
    [PROJECT_ID, activeTasks[0].id, 5.5],
  )
).rows;
assert.equal(Number(overriddenTask.calculated_hours), 4.25);
assert.equal(Number(overriddenTask.manual_budgeted_hours), 5.5);
assert.equal(Number(overriddenTask.budgeted_hours), 5.5);
assert.equal(Number(overriddenTask.total_budgeted_hours), 7.5);

[{ budgeted_hours: legacyHours }] = (
  await db.query(
    "select budgeted_hours from public.project_budgets where companycam_project_id = $1",
    [PROJECT_ID],
  )
).rows;
assert.equal(Number(legacyHours), 7.5);

let [resetTask] = (
  await db.query(
    "select * from public.set_project_labour_task_budget_hours($1, $2::uuid, null)",
    [PROJECT_ID, activeTasks[0].id],
  )
).rows;
assert.equal(Number(resetTask.calculated_hours), 4.25);
assert.equal(resetTask.manual_budgeted_hours, null);
assert.equal(Number(resetTask.budgeted_hours), 4.25);
assert.equal(Number(resetTask.total_budgeted_hours), 6.25);

await db.exec(`
  set role authenticated;
  set "request.jwt.claim.sub" = '${PAINTER_ID}';
`);
const painterBudgetRows = (
  await db.query(
    "select source_quote_id from public.project_labour_budgets where companycam_project_id = $1",
    [PROJECT_ID],
  )
).rows;
assert.equal(painterBudgetRows.length, 1);
await assert.rejects(
  db.query(
    "select * from public.set_project_labour_task_budget_hours($1, $2::uuid, $3::numeric)",
    [PROJECT_ID, activeTasks[0].id, 8],
  ),
  /Only active admins and managers/,
);

await db.query(
  "select * from public.set_project_labour_task_status($1::uuid, 'completed')",
  [activeTasks[0].id],
);
await db.query(
  `insert into public.project_labour_task_time_entries
    (client_entry_id, task_id, user_id, started_at, ended_at, status)
   values ($1, $2::uuid, $3::uuid, $4::timestamptz, $5::timestamptz, 'complete')`,
  [
    "timer-1",
    activeTasks[0].id,
    PAINTER_ID,
    "2026-07-21T12:00:00Z",
    "2026-07-21T13:30:00Z",
  ],
);

let painterTasks = (
  await db.query("select * from public.list_project_labour_tasks($1)", [PROJECT_ID])
).rows;
assert.equal(painterTasks.length, 2);
assert.equal(painterTasks[0].status, "completed");
assert.equal(Number(painterTasks[0].hours_spent), 1.5);
assert.equal(painterTasks[0].instructions, "Protect the hardwood floors.");

await db.exec(`
  reset role;
  set "request.jwt.claim.sub" = '${OUTSIDER_ID}';
  set role authenticated;
`);
const outsiderBudgetRows = (
  await db.query(
    "select source_quote_id from public.project_labour_budgets where companycam_project_id = $1",
    [PROJECT_ID],
  )
).rows;
assert.equal(outsiderBudgetRows.length, 0);
await assert.rejects(
  db.query("select * from public.list_project_labour_tasks($1)", [PROJECT_ID]),
  /not assigned/,
);

await db.exec(`
  reset role;
  set "request.jwt.claim.sub" = '${MANAGER_ID}';
`);
const quoteTwo = {
  version: 2,
  activeQuoteId: "quote-2",
  quotes: [
    ...quoteOne.quotes,
    {
      id: "quote-2",
      name: "Reduced scope",
      notes: "Upstairs only.",
      updatedAt: "2026-07-21T16:00:00.000Z",
    },
  ],
};
published = await publish(quoteTwo, "quote-2", [
  {
    sourceKind: "room",
    sourceItemId: "room-2",
    title: "Bedroom",
    notes: null,
    budgetedHours: 3,
    sortOrder: 0,
    metadata: { section: "interior" },
  },
]);
assert.equal(published.source_quote_id, "quote-2");
assert.equal(Number(published.revision), 2);

const budgetHistory = (
  await db.query(
    "select source_quote_id, revision, is_active from public.project_labour_budgets where companycam_project_id = $1 order by revision",
    [PROJECT_ID],
  )
).rows;
assert.deepEqual(
  budgetHistory.map((budget) => [budget.source_quote_id, Number(budget.revision), budget.is_active]),
  [
    ["quote-1", 1, false],
    ["quote-2", 2, true],
  ],
);

const taskHistory = (
  await db.query(
    "select id, source_quote_id, source_item_id, is_active, status from public.project_labour_tasks where companycam_project_id = $1 order by inserted_at, source_item_id",
    [PROJECT_ID],
  )
).rows;
assert.equal(taskHistory.length, 3);
assert.equal(taskHistory.filter((task) => task.is_active).length, 1);
assert.equal(
  taskHistory.find((task) => task.source_item_id === "room-1").status,
  "completed",
);

await assert.rejects(
  db.query(
    "update public.project_labour_task_time_entries set task_id = $1::uuid where client_entry_id = 'timer-1'",
    [taskHistory.find((task) => task.source_item_id === "room-2").id],
  ),
  /identity fields cannot be changed/,
);

const activeQuoteTwoTask = taskHistory.find(
  (task) => task.source_item_id === "room-2" && task.is_active,
);
await db.query(
  "select * from public.set_project_labour_task_budget_hours($1, $2::uuid, $3::numeric)",
  [PROJECT_ID, activeQuoteTwoTask.id, 4.5],
);

const quoteTwoUpdated = {
  ...quoteTwo,
  quotes: quoteTwo.quotes.map((quote) =>
    quote.id === "quote-2"
      ? { ...quote, updatedAt: "2026-07-21T17:00:00.000Z" }
      : quote,
  ),
};
published = await publish(quoteTwoUpdated, "quote-2", [
  {
    sourceKind: "room",
    sourceItemId: "room-2",
    title: "Bedroom",
    notes: null,
    budgetedHours: 3.25,
    sortOrder: 0,
    metadata: { section: "interior" },
  },
]);
assert.equal(Number(published.revision), 3);
assert.equal(Number(published.budgeted_hours), 4.5);

const [carriedOverride] = (
  await db.query(
    "select id, calculated_hours, manual_budgeted_hours, budgeted_hours from public.project_labour_tasks where companycam_project_id = $1 and is_active",
    [PROJECT_ID],
  )
).rows;
assert.equal(Number(carriedOverride.calculated_hours), 3.25);
assert.equal(Number(carriedOverride.manual_budgeted_hours), 4.5);
assert.equal(Number(carriedOverride.budgeted_hours), 4.5);

[resetTask] = (
  await db.query(
    "select * from public.set_project_labour_task_budget_hours($1, $2::uuid, null)",
    [PROJECT_ID, carriedOverride.id],
  )
).rows;
assert.equal(resetTask.manual_budgeted_hours, null);
assert.equal(Number(resetTask.budgeted_hours), 3.25);
assert.equal(Number(resetTask.total_budgeted_hours), 3.25);

published = await publish(
  {
    ...quoteTwoUpdated,
    quotes: quoteTwoUpdated.quotes.map((quote) =>
      quote.id === "quote-2"
        ? { ...quote, updatedAt: "2026-07-21T18:00:00.000Z" }
        : quote,
    ),
  },
  "quote-2",
  [
    {
      sourceKind: "room",
      sourceItemId: "room-2",
      title: "Bedroom",
      notes: null,
      budgetedHours: 3.5,
      sortOrder: 0,
      metadata: { section: "interior" },
    },
  ],
);
assert.equal(Number(published.revision), 4);
assert.equal(Number(published.budgeted_hours), 3.5);

const [postResetPublication] = (
  await db.query(
    "select calculated_hours, manual_budgeted_hours, budgeted_hours from public.project_labour_tasks where companycam_project_id = $1 and is_active",
    [PROJECT_ID],
  )
).rows;
assert.equal(Number(postResetPublication.calculated_hours), 3.5);
assert.equal(postResetPublication.manual_budgeted_hours, null);
assert.equal(Number(postResetPublication.budgeted_hours), 3.5);

const budgetTotals = (
  await db.query(
    "select revision, calculated_hours, budgeted_hours from public.project_labour_budgets where companycam_project_id = $1 order by revision",
    [PROJECT_ID],
  )
).rows;
assert.deepEqual(
  budgetTotals.map((budget) => [
    Number(budget.revision),
    Number(budget.calculated_hours),
    Number(budget.budgeted_hours),
  ]),
  [
    [1, 6.25, 6.25],
    [2, 3, 4.5],
    [3, 3.25, 3.25],
    [4, 3.5, 3.5],
  ],
);

// A running timer survives an automatic republication of the same stable
// task, but blocks switching to a scope that would make that task disappear.
const [quoteTwoTaskBeforeAutoPublish] = (
  await db.query(
    "select id, progress_id from public.project_labour_tasks where companycam_project_id = $1 and is_active",
    [PROJECT_ID],
  )
).rows;

await db.exec(`
  reset role;
  set "request.jwt.claim.sub" = '${PAINTER_ID}';
  set role authenticated;
`);
await db.query(
  `insert into public.project_labour_task_time_entries
    (client_entry_id, task_id, user_id, started_at, ended_at, status)
   values ($1, $2::uuid, $3::uuid, $4::timestamptz, null, 'active')`,
  [
    "timer-active-room-2",
    quoteTwoTaskBeforeAutoPublish.id,
    PAINTER_ID,
    "2026-07-21T19:00:00Z",
  ],
);

await db.exec(`
  reset role;
  set "request.jwt.claim.sub" = '${MANAGER_ID}';
`);
const quoteTwoAutoPublish = {
  ...quoteTwoUpdated,
  quotes: quoteTwoUpdated.quotes.map((quote) =>
    quote.id === "quote-2"
      ? { ...quote, updatedAt: "2026-07-21T19:00:00.000Z" }
      : quote,
  ),
};
published = await publish(quoteTwoAutoPublish, "quote-2", [
  {
    sourceKind: "room",
    sourceItemId: "room-2",
    title: "Bedroom",
    notes: null,
    budgetedHours: 3.75,
    sortOrder: 0,
    metadata: { section: "interior" },
  },
]);
assert.equal(Number(published.revision), 5);

const [quoteTwoTaskAfterAutoPublish] = (
  await db.query(
    "select id, progress_id from public.project_labour_tasks where companycam_project_id = $1 and is_active",
    [PROJECT_ID],
  )
).rows;
assert.notEqual(quoteTwoTaskAfterAutoPublish.id, quoteTwoTaskBeforeAutoPublish.id);
assert.equal(quoteTwoTaskAfterAutoPublish.progress_id, quoteTwoTaskBeforeAutoPublish.progress_id);

await db.exec(`
  reset role;
  set "request.jwt.claim.sub" = '${PAINTER_ID}';
  set role authenticated;
`);
painterTasks = (
  await db.query("select * from public.list_project_labour_tasks_live($1)", [PROJECT_ID])
).rows;
assert.equal(painterTasks.length, 1);
assert.equal(painterTasks[0].source_quote_id, "quote-2");
assert.equal(
  new Date(painterTasks[0].my_active_started_at).toISOString(),
  "2026-07-21T19:00:00.000Z",
);
assert.equal(painterTasks[0].active_painters.length, 1);
assert.equal(painterTasks[0].active_painters[0].display_name, "Pat Painter");

await db.exec(`
  reset role;
  set "request.jwt.claim.sub" = '${CREW_ID}';
  set role authenticated;
`);
const crewTasks = (
  await db.query("select * from public.list_project_labour_tasks_live($1)", [PROJECT_ID])
).rows;
assert.equal(crewTasks.length, 1);
assert.equal(crewTasks[0].my_active_started_at, null);
assert.equal(crewTasks[0].active_painters[0].display_name, "Pat Painter");

const painterLiveStateRows = (
  await db.query(
    "select active_painters from public.project_labour_task_live_state where companycam_project_id = $1",
    [PROJECT_ID],
  )
).rows;
assert.equal(painterLiveStateRows.length, 3);
assert.equal(
  painterLiveStateRows.filter((row) => row.active_painters.length > 0).length,
  1,
);
const painterDirectProgressRows = (
  await db.query("select id from public.project_labour_task_progress")
).rows;
assert.equal(
  painterDirectProgressRows.length,
  0,
  "stable progress internals must remain hidden behind painter-safe RPCs",
);

await db.exec(`
  reset role;
  set "request.jwt.claim.sub" = '${OUTSIDER_ID}';
  set role authenticated;
`);
const outsiderLiveStateRows = (
  await db.query("select progress_id from public.project_labour_task_live_state")
).rows;
assert.equal(outsiderLiveStateRows.length, 0);
await assert.rejects(
  db.query("select * from public.list_project_labour_tasks_live($1)", [PROJECT_ID]),
  /not assigned/,
);

await db.exec(`
  reset role;
  set "request.jwt.claim.sub" = '${MANAGER_ID}';
`);
await assert.rejects(
  publish(quoteTwoAutoPublish, "quote-1", firstTasks, PROJECT_ID, 2260),
  /A painter is timing a task that is not in this calculator/,
);
[{ amount_including_tax: calculatorAmount }] = (
  await db.query(
    "select amount_including_tax from public.project_budgets where companycam_project_id = $1",
    [PROJECT_ID],
  )
).rows;
assert.equal(Number(calculatorAmount), 1130, "a blocked default switch must not change the job amount");

await db.exec(`
  set role authenticated;
  set "request.jwt.claim.sub" = '${PAINTER_ID}';
`);
await db.query(
  `update public.project_labour_task_time_entries
   set ended_at = $1::timestamptz, status = 'complete'
   where client_entry_id = 'timer-active-room-2'`,
  ["2026-07-21T19:30:00Z"],
);
await db.query(
  `insert into public.project_labour_task_time_entries
    (client_entry_id, task_id, user_id, started_at, ended_at, status)
   values ($1, $2::uuid, $3::uuid, $4::timestamptz, null, 'active')`,
  [
    "timer-offline-old-revision",
    quoteTwoTaskBeforeAutoPublish.id,
    PAINTER_ID,
    "2026-07-21T19:30:00Z",
  ],
);
await db.query(
  `update public.project_labour_task_time_entries
   set ended_at = $1::timestamptz, status = 'complete'
   where client_entry_id = 'timer-offline-old-revision'`,
  ["2026-07-21T19:45:00Z"],
);

await db.exec(`
  reset role;
  set "request.jwt.claim.sub" = '${MANAGER_ID}';
`);
published = await publish(quoteTwoAutoPublish, "quote-1", firstTasks);
assert.equal(Number(published.revision), 6);

await db.exec(`
  set role authenticated;
  set "request.jwt.claim.sub" = '${PAINTER_ID}';
`);
painterTasks = (
  await db.query("select * from public.list_project_labour_tasks($1)", [PROJECT_ID])
).rows;
const returnedLivingRoom = painterTasks.find((task) => task.title === "Living room");
assert.ok(returnedLivingRoom);
assert.equal(returnedLivingRoom.status, "completed");
assert.equal(Number(returnedLivingRoom.hours_spent), 1.5);

// An offline checklist write carrying an old revision's task id updates the
// permanent progress identity and is visible on the current revision.
const historicalLivingRoom = taskHistory.find((task) => task.source_item_id === "room-1");
await db.query(
  "select * from public.set_project_labour_task_status($1::uuid, 'skipped')",
  [historicalLivingRoom.id],
);
painterTasks = (
  await db.query("select * from public.list_project_labour_tasks($1)", [PROJECT_ID])
).rows;
assert.equal(painterTasks.find((task) => task.title === "Living room").status, "skipped");

await db.exec(`
  reset role;
  set "request.jwt.claim.sub" = '${MANAGER_ID}';
`);
published = await publish(quoteTwoAutoPublish, "quote-2", [
  {
    sourceKind: "room",
    sourceItemId: "room-2",
    title: "Bedroom",
    notes: null,
    budgetedHours: 3.75,
    sortOrder: 0,
    metadata: { section: "interior" },
  },
]);
assert.equal(Number(published.revision), 7);

await db.exec(`
  set role authenticated;
  set "request.jwt.claim.sub" = '${PAINTER_ID}';
`);
painterTasks = (
  await db.query("select * from public.list_project_labour_tasks($1)", [PROJECT_ID])
).rows;
assert.equal(painterTasks.length, 1);
assert.equal(painterTasks[0].source_quote_id, "quote-2");
assert.equal(Number(painterTasks[0].hours_spent), 0.75);

console.log(
  "Labour budget SQL checks passed: cross-painter realtime presence with outsider isolation, stable progress across revisions, atomic calculator amount synchronization, active-timer switch guards, offline historical writes, manager overrides, and legacy-hour synchronization.",
);

async function publish(
  calculatorDoc,
  quoteId,
  tasks,
  projectId = PROJECT_ID,
  amountIncludingTax = 1130,
) {
  const result = await db.query(
    "select * from public.publish_project_calculator_default($1, $2::jsonb, $3, $4::jsonb, $5::numeric)",
    [
      projectId,
      JSON.stringify(calculatorDoc),
      quoteId,
      JSON.stringify(tasks),
      amountIncludingTax,
    ],
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}
