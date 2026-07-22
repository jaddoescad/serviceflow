# Project labour tasks

## Mobile behaviour

- After a painter clocks in, the active **Clock In** screen puts the labour
  budget, checklist, and task timers directly below the compact shift controls.
- There is no separate Tasks tab; the plan is part of the painter's primary
  clocked-in workflow.
- The screen reads only the active/default calculator snapshot published through
  `list_project_labour_tasks`.
- Painters see task names, notes, checklist state, task-hour budgets, and
  aggregate team hours. Calculator prices and labour rates never enter the
  mobile query or local cache.
- Managers can override an individual task's painter-hour budget in the admin
  calculator without changing quote pricing. The database retains the latest
  calculator-derived hours separately, and Reset restores that value.
- A manual override follows the same quote task into a new budget revision by
  its stable source ID. Once reset, older historical overrides do not return.
- Checklist status and timer history belong to a permanent job-item progress
  identity, not a single calculator revision. Editing the default calculator or
  switching away and back therefore preserves completed work and spent hours.
- Publishing is rejected when the new scope would omit a task with a running
  timer. A timer remains live through republishing when its stable task is
  still present.
- Publishing a default calculator also synchronizes its HST-inclusive client
  total to `project_budgets.amount_including_tax` in the same transaction. The
  admin job list therefore shows the calculator's pre-HST client price without
  a second amount entry step.
- Checklist changes use `set_project_labour_task_status` and are optimistic.
- A painter can run one task timer at a time while clocked into that project.
  Starting another task stops the previous timer.
- Task timers stop when the whole shift is clocked out, switched, deleted, or
  found completed by the server.

## Realtime collaboration

- Assigned painters subscribe only to the current job's painter-safe live task
  state through Supabase Realtime.
- When a painter starts or stops a task timer, everyone viewing that job sees
  the painter's first name on the task and the team-hour budget continues live.
- Checklist changes also trigger an immediate refresh for the assigned crew.
- Raw timer history remains private. The realtime table contains only stable
  task identity, checklist status, and the names/start times of currently active
  painters. If Realtime is unavailable, the existing 30-second refresh remains
  as a fallback.

## Connectivity

Task lists are cached per signed-in user and project. Checklist and timer
mutations that fail because the device is offline are queued in AsyncStorage and
retried when the task list refreshes, the app returns to the foreground, or the
regular time-tracking sync runs. `client_entry_id` makes timer creation
idempotent after a response is lost.

Permanent authorization, validation, and schema errors are not queued. The last
successful task list remains visible with an actionable error message.

## Backend boundary

The mobile app uses the painter-safe functions and tables created by
`20260721150000_publish_calculator_labour_budgets.sql` and stabilized by
`20260721210000_stabilize_labour_task_progress.sql`. Admin publishing uses the
atomic wrapper in `20260721220000_sync_calculator_job_amount.sql`:

- `list_project_labour_tasks(text)`
- `set_project_labour_task_status(uuid, text)`
- `project_labour_task_progress`
- `project_labour_task_time_entries`
- `set_project_labour_task_budget_hours(text, uuid, numeric)` (manager-only;
  `null` resets the task)

Assigned-project RLS remains the access boundary. The client uses the signed-in
employee JWT and publishable key; it never uses a service-role key.
