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
- **Budgets** are stored in `project_budgets` (migration
  `20260707190000`) and written directly via RLS (admin/manager only).

No new backend was added beyond the `project_budgets` table.

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
- `/projects` — Jobs & Budgets: set hour/rate budgets, track burn, assign crew.
  “Last active” uses the latest crew time or verified contractor invoice date;
  logged hours use the higher verified total so invoices do not double-count
  clocked labour.
- `/employees` — Crew: create members, set roles, activate/deactivate.

## Deploy

Deploy as a standalone app (e.g. Vercel) with the Supabase env vars set. It is
independent of the Expo build.
