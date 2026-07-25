#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const MANAGER_ID = "11111111-1111-4111-8111-111111111111";
const PAINTER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_PAINTER_ID = "33333333-3333-4333-8333-333333333333";
const ASSIGNED_PROGRESS_ID = "44444444-4444-4444-8444-444444444444";
const UNASSIGNED_PROGRESS_ID = "55555555-5555-4555-8555-555555555555";
const ASSIGNED_TASK_ID = "66666666-6666-4666-8666-666666666666";
const UNASSIGNED_TASK_ID = "77777777-7777-4777-8777-777777777777";
const migrationUrl = new URL(
  "../supabase/migrations/20260723131833_create_labour_task_over_budget_reasons.sql",
  import.meta.url,
);
const root = new URL("../", import.meta.url);
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
    role text not null,
    is_active boolean not null default true
  );
  create table public.companycam_projects (companycam_id text primary key);
  create table public.project_assignments (
    companycam_project_id text not null references public.companycam_projects(companycam_id),
    user_id uuid not null references auth.users(id),
    status text not null
  );
  create table public.project_labour_task_progress (
    id uuid primary key,
    companycam_project_id text not null references public.companycam_projects(companycam_id)
  );
  create table public.project_labour_tasks (
    id uuid primary key,
    progress_id uuid not null references public.project_labour_task_progress(id),
    companycam_project_id text not null references public.companycam_projects(companycam_id)
  );

  create function public.current_employee_role()
  returns text
  language sql
  stable
  security definer
  set search_path = ''
  as $$
    select profile.role
    from public.employee_profiles profile
    where profile.user_id = auth.uid()
      and profile.is_active = true
    limit 1
  $$;

  create function public.can_access_project_labour_job(requested_project_id text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
  as $$
    select exists (
      select 1
      from public.employee_profiles profile
      where profile.user_id = auth.uid()
        and profile.is_active = true
        and (
          profile.role in ('admin', 'manager')
          or exists (
            select 1
            from public.project_assignments assignment
            where assignment.companycam_project_id = requested_project_id
              and assignment.user_id = auth.uid()
              and assignment.status = 'active'
          )
        )
    )
  $$;

  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;

  insert into auth.users (id) values
    ('${MANAGER_ID}'),
    ('${PAINTER_ID}'),
    ('${OTHER_PAINTER_ID}');
  insert into public.employee_profiles (user_id, role) values
    ('${MANAGER_ID}', 'manager'),
    ('${PAINTER_ID}', 'painter'),
    ('${OTHER_PAINTER_ID}', 'painter');
  insert into public.companycam_projects (companycam_id)
  values ('assigned-job'), ('unassigned-job');
  insert into public.project_assignments (companycam_project_id, user_id, status)
  values ('assigned-job', '${PAINTER_ID}', 'active');
  insert into public.project_labour_task_progress (id, companycam_project_id) values
    ('${ASSIGNED_PROGRESS_ID}', 'assigned-job'),
    ('${UNASSIGNED_PROGRESS_ID}', 'unassigned-job');
  insert into public.project_labour_tasks (id, progress_id, companycam_project_id) values
    ('${ASSIGNED_TASK_ID}', '${ASSIGNED_PROGRESS_ID}', 'assigned-job'),
    ('${UNASSIGNED_TASK_ID}', '${UNASSIGNED_PROGRESS_ID}', 'unassigned-job');
`);

await db.exec(await readFile(migrationUrl, "utf8"));
await db.exec(`
  set role authenticated;
  set "request.jwt.claim.sub" = '${PAINTER_ID}';
`);

await db.query(
  `insert into public.project_labour_task_over_budget_reasons
    (client_id, task_id, user_id, reason, note, hours_over, budget_revision)
   values ($1, $2::uuid, $3::uuid, $4, $5, $6, $7)`,
  [
    "reason-1",
    ASSIGNED_TASK_ID,
    PAINTER_ID,
    "extra_prep",
    "Unexpected drywall repair",
    1.25,
    3,
  ],
);

const [ownReason] = (
  await db.query(
    `select client_id, task_id, user_id, reason, note, hours_over, budget_revision
     from public.project_labour_task_over_budget_reasons`,
  )
).rows;
assert.equal(ownReason.task_id, ASSIGNED_PROGRESS_ID);
assert.equal(ownReason.user_id, PAINTER_ID);
assert.equal(Number(ownReason.hours_over), 1.25);
assert.equal(Number(ownReason.budget_revision), 3);

await assert.rejects(
  db.query(
    `insert into public.project_labour_task_over_budget_reasons
      (client_id, task_id, user_id, reason)
     values ('reason-spoof', $1::uuid, $2::uuid, 'waiting')`,
    [ASSIGNED_TASK_ID, OTHER_PAINTER_ID],
  ),
  /row-level security policy|permission denied/i,
);

await assert.rejects(
  db.query(
    `insert into public.project_labour_task_over_budget_reasons
      (client_id, task_id, user_id, reason)
     values ('reason-unassigned', $1::uuid, $2::uuid, 'waiting')`,
    [UNASSIGNED_TASK_ID, PAINTER_ID],
  ),
  /row-level security policy|permission denied/i,
);

await assert.rejects(
  db.query(
    `insert into public.project_labour_task_over_budget_reasons
      (client_id, task_id, user_id, reason)
     values ('reason-1', $1::uuid, $2::uuid, 'waiting')`,
    [ASSIGNED_TASK_ID, PAINTER_ID],
  ),
  /duplicate key|unique constraint/i,
);

await assert.rejects(
  db.query(
    `update public.project_labour_task_over_budget_reasons
     set note = 'Changed' where client_id = 'reason-1'`,
  ),
  /permission denied/i,
);
await assert.rejects(
  db.query(
    `delete from public.project_labour_task_over_budget_reasons
     where client_id = 'reason-1'`,
  ),
  /permission denied/i,
);

await db.exec(`
  reset role;
  set "request.jwt.claim.sub" = '${OTHER_PAINTER_ID}';
  set role authenticated;
`);
const otherPainterRows = (
  await db.query("select id from public.project_labour_task_over_budget_reasons")
).rows;
assert.equal(otherPainterRows.length, 0);

await db.exec(`
  reset role;
  set "request.jwt.claim.sub" = '${MANAGER_ID}';
  set role authenticated;
`);
const managerRows = (
  await db.query(
    "select client_id from public.project_labour_task_over_budget_reasons",
  )
).rows;
assert.deepEqual(managerRows.map((row) => row.client_id), ["reason-1"]);

const repositorySource = await readFile(
  new URL("src/lib/projectLabourTasks.js", root),
  "utf8",
);
assert.match(repositorySource, /action:\s*["']over_budget_reason["']/);
assert.match(repositorySource, /project_labour_task_over_budget_reasons/);
assert.match(repositorySource, /inserted\.error\?\.code === ["']23505["']/);
assert.match(repositorySource, /enqueueTaskOperation\(operation\)/);

const hookSource = await readFile(
  new URL("src/lib/useProjectLabourTasks.js", root),
  "utf8",
);
assert.match(hookSource, /submitOverBudgetReason/);
assert.match(hookSource, /budget\?\.revision/);
assert.match(hookSource, /It will sync when ServiceFlow reconnects/);

const jobOverBudgetSource = await readFile(
  new URL("src/lib/jobOverBudget.js", root),
  "utf8",
);
assert.match(jobOverBudgetSource, /evaluateJobOverBudget/);
assert.match(jobOverBudgetSource, /hasAnsweredJobOverBudgetReason/);
assert.match(jobOverBudgetSource, /markJobOverBudgetReasonAnswered/);
assert.match(jobOverBudgetSource, /project_over_budget_reasons/);

const clockScreenSource = await readFile(
  new URL("src/screens/ClockInScreen.js", root),
  "utf8",
);
const projectScreenSource = await readFile(
  new URL("src/screens/ProjectDetailScreen.js", root),
  "utf8",
);
for (const source of [clockScreenSource, projectScreenSource]) {
  assert.match(source, /<OverBudgetReasonSheet/);
  assert.match(source, /evaluateJobOverBudget/);
  assert.match(source, /submitJobOverBudgetReason/);
  assert.match(source, /markJobOverBudgetReasonAnswered/);
}

const storageSource = await readFile(
  new URL("src/lib/timeTrackingStorage.js", root),
  "utf8",
);
assert.match(storageSource, /labourTaskOverBudgetReasonAnswered/);
assert.match(storageSource, /userId.*taskId.*budgetRevision/s);

console.log(
  "Over-budget reason checks passed: stable task mapping, assigned-job RLS, append-only answers, offline queue wiring, and job-level one-prompt clock-out gating.",
);
