# Ottawa Painters — Admin Dashboard

Desktop web dashboard (Next.js 15, App Router) for reviewing crew timesheets,
managing employees and job assignments, and tracking hours against per-job
budgets. It reads from and writes to the same Supabase project as the mobile
app.

## How it fits together

- **Reads** run under the signed-in admin/manager's Supabase session. RLS
  (migration `20260630150000`) grants admins/managers read access to every
  crew member's profiles, assignments, and time entries.
- **Timesheet edits, approvals, deletes** call the existing
  `admin-time-entries` edge function with the user's JWT.
- **Employee create / role / active / assignments** call the existing
  `project-assignments` edge function.
- **Financial budgets** are stored in `project_budgets` (migration
  `20260707190000`) and written directly via RLS (admin/manager only).
- **Calculator labour budgets** are versioned in `project_labour_budgets`.
  The first calculator is the default automatically. Opening another quote
  does not change it; selecting **Make default** explicitly chooses that quote
  and materializes its rooms/exterior lines as `project_labour_tasks`. Later
  edits to the default quote republish those tasks through autosave. Replacing
  the selection keeps older task and timer history inactive instead of
  deleting it.
- **Painter task time** is stored separately in
  `project_labour_task_time_entries`, with offline-safe client IDs and an
  optional link to the painter's existing whole-shift `time_entries` row.
  Assigned painters can read the safe task payload and aggregate hours through
  `list_project_labour_tasks`; calculator prices and rates remain staff-only.

## Access

Only active `admin` or `manager` employee profiles can sign in. Everyone else
is redirected to a not-authorized screen. `info@paintersottawa.com` is an admin.

## Setup

```bash
cd admin-dashboard
npm install
cp .env.example .env.local   # fill in Supabase URL + publishable key
npm run dev                  # http://localhost:3100
```

Environment variables (`.env.local`):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key)
- `NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL` (optional; defaults to `<url>/functions/v1`)

## Pages

- `/` — Overview: live shift board, KPIs, hours/day, hours by crew & job,
  approval status, budget health, a crew/job map, daily clock-in activity, and
  off-site clock-in attention. The map refreshes every minute and loads each
  active shift's unique `employee_location_points` as a selectable movement
  trail. It reports GPS freshness separately from the app heartbeat, shows the
  latest coordinate/accuracy/distance, and marks the 250 m job area. A
  clock-in position is used when there are no later updates; employees with no
  recorded coordinates are not placed at the job address.
- `/timesheets` — filter, edit, approve, and delete time entries.
  Active shifts have a dedicated **Clock out** action with Now, 5:00 PM, and
  6:00 PM shortcuts. **Fix time** provides an Ottawa-time editor, duration
  preview, correction notes, and a clear warning when a completed shift would
  be reopened.
- `/projects` — Jobs & Budgets: set job amounts, track labour, assign crew,
  build multiple calculator options, and publish one option as the painter
  task budget.
  A job with a default calculator gets its amount from that calculator
  automatically. The table shows the same pre-HST client price; the manual
  amount pencil remains only for jobs without a default calculator.
  “Last active” uses the latest crew time or verified contractor invoice date;
  logged hours use the higher verified total so invoices do not double-count
  clocked labour.
- `/employees` — Crew: create members, set roles, activate/deactivate.

## Clock-out CLI

Use the CLI when you already know the painter and end time:

```bash
# Review the matched active shift, then confirm interactively.
npm run clock-out -- "Michael Matambo" 6pm

# Skip the prompt when using the command in a trusted admin workflow.
npm run clock-out -- --employee "Michael Matambo" --at 18:00 --yes

# Inspect the match without changing production data.
npm run clock-out -- "Michael" now --dry-run
```

The command accepts `now`, friendly times such as `6pm`, 24-hour times such as
`18:00`, and ISO timestamps. Time-only values use `America/Toronto`; add
`--date YYYY-MM-DD` for another day or `--project` to disambiguate a name.

The CLI needs `SUPABASE_URL` and the server-only
`SUPABASE_SERVICE_ROLE_KEY`. It loads normal environment variables and local
`.env.local` files, including the adjacent mobile-app `.env.local` in this
workspace. Set `TIME_ENTRY_ADMIN_EMAIL` (or pass `--actor-email`) to choose the
admin/manager recorded in the audit history. The service-role key is never
used by the dashboard's browser bundle.

## Deploy

Deploy as a standalone app (e.g. Vercel) with the Supabase env vars set. It is
independent of the Expo build.
