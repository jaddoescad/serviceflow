# Implementation plan: persist over-budget reasons

Audience: an implementing model/engineer with no prior context on this repo.
Read `docs/project-labour-tasks.md` and `AGENTS.md` first.

## What already exists (do not rebuild)

The UI shipped on 2026-07-23 as a preview:

- `src/components/OverBudgetReasonSheet.js` — modal shown after a painter stops
  a task timer. Exports `OVER_BUDGET_REASONS` (keys: `budget_unrealistic`,
  `extra_prep`, `moving_furniture`, `waiting`, `other`). "Other" requires a free
  text note (max 280 chars). Calls `onSubmit({ reason, note })` or `onSkip()`.
  `onSubmit` may be async; the sheet shows a spinner until it resolves.
- `src/components/ProjectLabourTasksPanel.js` — the Stop handler computes
  whether the task is over budget and sets `reasonPrompt`; the sheet renders at
  the bottom of the panel. A `PREVIEW_OVER_BUDGET_REASON = true` flag currently
  forces the sheet to appear after **every** stop so the owner could preview it.
- Both `onSubmit` and `onSkip` currently just close the sheet. **Nothing is
  persisted.** That is the gap this plan closes.

## Goal

1. Persist the painter's answer (reason key + optional note + context) to
   Supabase, with the same offline-queue resilience as the other task
   mutations.
2. Only prompt when the task is genuinely over budget, and don't nag: at most
   one prompt per painter per task per budget revision.
3. Flip `PREVIEW_OVER_BUDGET_REASON` to `false`.

## Repo conventions you must follow

- Plain JavaScript, no TypeScript in `src/`.
- DB changes go in `supabase/migrations/<UTC timestamp>_<slug>.sql`. Look at
  `20260721190000_add_labour_task_hour_overrides.sql` and
  `20260630150000_scope_operational_rls.sql` for RLS style.
- Mobile task mutations live in `src/lib/projectLabourTasks.js` and use an
  AsyncStorage offline queue: build an `operation` object, try
  `executeTaskOperation`, and if `shouldQueueTaskOperation(error)` returns true,
  `enqueueTaskOperation` it for retry. Client-generated IDs make retries
  idempotent. Mirror `startProjectLabourTaskTimer` exactly.
- The hook layer is `src/lib/useProjectLabourTasks.js` (optimistic updates,
  `friendlyTaskError`, `syncNotice` copy style: "…It will sync when ServiceFlow
  reconnects.").
- Painter-facing reads go through painter-safe RPCs (`list_project_labour_tasks`
  / `list_project_labour_tasks_live`), never raw manager tables.
- QA scripts are node scripts under `scripts/qa-*.mjs`, wired into
  `qa:preflight` in `package.json`. `scripts/qa-project-labour-tasks-mobile.mjs`
  is the closest model.

## Phase 1 — schema

New migration `create_labour_task_over_budget_reasons`:

```sql
create table public.project_labour_task_over_budget_reasons (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,                 -- idempotency key from the device
  task_id uuid not null references public.project_labour_tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  reason text not null check (reason in
    ('budget_unrealistic','extra_prep','moving_furniture','waiting','other')),
  note text check (char_length(note) <= 280),
  hours_over numeric not null default 0 check (hours_over >= 0),
  budget_revision integer,                 -- plan revision at the time of answer
  created_at timestamptz not null default now(),
  unique (client_id)
);
```

Notes:

- Confirm the real name/PK of the tasks table before writing the FK — the
  mobile app only sees RPC output (`task_id`), so read the earlier labour-task
  migrations (`20260721150000_publish_calculator_labour_budgets.sql` etc.) to
  find the physical table. If tasks use a "stable job-item identity" that
  survives republishing (they do — see docs), reference that identity so
  reasons survive budget republishes.
- `note` must only ever be non-null when reason is `other`? No — allow notes on
  any reason (future UI may add them), but the check on length stays.
- RLS: enable RLS. Painters may `insert` a row only for themselves
  (`user_id = auth.uid()`) and only for tasks on projects they are assigned to
  (reuse the assignment predicate from the existing task RLS in
  `scope_operational_rls` / labour-task migrations). Painters may `select`
  **their own** rows for the prompted-already check (or expose that flag via
  the RPC — see Phase 3 option B). Managers/admin read everything (follow the
  existing manager-role predicate used by other operational tables).
- No `update`/`delete` policies for painters. Answers are append-only.

## Phase 2 — client write path

In `src/lib/projectLabourTasks.js`:

- Add `REASON_TABLE = "project_labour_task_over_budget_reasons"`.
- Add `submitOverBudgetReason({ taskId, userId, reason, note, hoursOver, budgetRevision, clientId = operationId("obr") })`
  following the `startProjectLabourTaskTimer` pattern: build an operation
  `{ id, action: "over_budget_reason", clientId, taskId, userId, reason, note, hoursOver, budgetRevision, createdAt }`,
  execute, queue on retryable failure.
- In `executeTaskOperation`, handle the new action with an insert; treat a
  unique-violation on `client_id` (Postgres code 23505) as success so queued
  retries stay idempotent.
- Confirm the queue serializer/validator (wherever `enqueueTaskOperation` and
  the flush loop validate `action` values) accepts the new action — read
  `flushPendingProjectLabourTaskWrites`/`performFlush` before assuming.

In `src/lib/useProjectLabourTasks.js`:

- Add `submitOverBudgetReason(task, { reason, note, hoursOver })` wrapping the
  lib call with the standard pattern: on `queued`, set `syncNotice`
  ("Thanks — your note is saved on this device. It will sync when ServiceFlow
  reconnects."); on hard error, `setError(friendlyTaskError(error))`; on
  success, clear error. No optimistic plan mutation is needed (reasons don't
  change hours), but record locally that this task was answered (Phase 3).
- Pass `plan.budget?.revision` as `budgetRevision`.
- Export it from the hook's return object.

## Phase 3 — prompt gating (don't nag)

Requirement: prompt at most once per painter per task per budget revision, and
only when actually over budget.

- In `ProjectLabourTasksPanel.js`, delete `PREVIEW_OVER_BUDGET_REASON` and its
  comment block; the Stop handler keeps only the real `over` condition plus the
  "not already answered" check.
- Skip counts as answered (persist a local-only marker for skips; do not write
  a row). A painter who skipped is not re-asked for the same task+revision.
- Implementation options for "already answered":
  - **Option A (recommended, simplest):** AsyncStorage key per
    `userId:taskId:budgetRevision` written on submit *and* on skip. Storage
    helpers live in `src/lib/timeTrackingStorage.js` — follow its key-prefix
    conventions. Downside: reinstalling re-prompts; acceptable.
  - **Option B:** add `my_over_budget_reason_submitted boolean` to the
    `list_project_labour_tasks_live` RPC output and normalize it in
    `src/lib/projectLabourTaskModel.js`. More work (SQL function change +
    model + tests) but survives reinstall and covers multi-device. Only do
    this if touching the RPC is otherwise low-risk.
- Edge cases the gating must handle:
  - Stopping a timer that was *already* over budget before this session
    started (crossed over on a previous day): still prompt if unanswered.
  - Task with `budgetedHours === 0`: never prompt.
  - The whole-shift clock-out path also stops task timers
    (`src/lib/timeTracking*`; "Task timers stop when the whole shift is clocked
    out"). Do **not** try to prompt from that path in this iteration — the
    painter is leaving. Only the explicit per-task Stop button prompts.

## Phase 4 — wire the sheet

In `ProjectLabourTasksPanel.js`:

- `onSubmit` → `await tracking.submitOverBudgetReason(reasonPrompt.task, answer)`
  then close. The sheet already spinners while the promise is pending; make
  sure a queued/offline result still closes the sheet (it does not throw).
- `onSkip` → mark answered locally (Phase 3) and close.

## Phase 5 — QA + docs

- New `scripts/qa-labour-task-over-budget-reasons.mjs` modeled on
  `scripts/qa-project-labour-tasks-mobile.mjs`: verify table + RLS (painter can
  insert own row on assigned project, cannot insert for another user or an
  unassigned project, cannot update/delete; manager can read; duplicate
  `client_id` conflicts). Add as `qa:labour-task-reasons` in `package.json` and
  append to `qa:preflight`.
- Update `docs/project-labour-tasks.md` with a short "Over-budget reasons"
  section (behaviour + backend boundary).
- Manual test script (device): under-budget stop → no prompt; over-budget stop
  → prompt; submit "other" without note → Send disabled; skip → no re-prompt on
  next stop; airplane mode submit → syncNotice shown, row appears after
  reconnect; second device re-prompt behaviour matches the chosen Option A/B.

## Phase 6 — ship

- OTA only (no native changes): `npx eas-cli update --branch production
  --message "Persist over-budget reasons"`. Runtime version stays `1.1.0`.
- Apply the migration to the linked Supabase project **before** publishing the
  OTA update, since the client will start inserting immediately.

## Out of scope (deliberately)

- Admin/manager reporting UI for reasons (query the table directly for now).
- Prompting on shift clock-out or task-switch auto-stops.
- Pausing timers at budget (the "pause when over budget" behaviour mentioned by
  the owner does not exist yet anywhere; do not invent it here).
