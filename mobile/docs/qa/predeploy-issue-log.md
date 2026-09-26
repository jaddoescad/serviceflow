# Web Pre-Deploy Issue Log

Use this log for issues found by the web QA sweep. Keep production tests limited to dedicated QA employees and QA-safe projects.

## Open Findings

| ID | Severity | Status | Area | Issue | Evidence | Next action | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WEB-P2-004 | P2 | Open | Backend/Deployment | App calls `geocode-companycam-projects`, but that function is not deployed. | `supabase functions list` shows only `sync-companycam-projects`, `companycam-project-photos`, and `project-assignments`. `src/lib/projectRepository.js` still invokes `geocode-companycam-projects` after sync. | Deploy the function with proper auth or remove the call and UX copy. Add a function-deployment check to QA. | Unassigned |
| WEB-P2-006 | P2 | Open | Accessibility | Many web tappable controls render as generic clickable divs instead of accessible controls. | Manual DOM inspection showed bottom nav, project cards, filter chips, timesheet rows, edit controls, and sign-out under generic elements with pointer cursors, no button/tab role, and weak or missing labels. Example artifacts: `qa-artifacts/manual-2026-06-30T16-55/07-mobile-projects.png`, plus manual DOM audit on Projects, Timesheet, and More. | Add `accessibilityRole`, labels, selected state, and keyboard-focus behavior for tab navigation, cards, filters, timesheet edit buttons, and sign-out on web. | Unassigned |
| WEB-P2-007 | P2 | Open | Projects/Photos | Photos tab shows a raw Edge Function error for QA/stale CompanyCam project IDs. | Manual browser test opened the QA fixture project's Photos tab and showed `Photos unavailable` with `Edge Function returned a non-2xx status code`; direct function probe returned CompanyCam `404 Not found` for `qa-web-smoke-project` while a real CompanyCam project returned `200`. Screenshot: `qa-artifacts/manual-2026-06-30T16-55/05-project-photos.png`. | Map unlinked/stale CompanyCam 404s to a friendly empty/not-linked state in the function or UI; keep non-404 upstream failures retryable. | Unassigned |

## Resolved Findings

| ID | Severity | Status | Area | Issue | Evidence | Resolution | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WEB-P0-001 | P0 | Mitigated | Secrets | `.env` was tracked and contained deploy-sensitive values. | `.env` is removed from the git index; hardcoded Supabase app fallbacks were removed; `ASSIGNMENT_ADMIN_TOKEN` was rotated in Supabase; the old committed token is rejected. | Keep `.env` ignored and do not publish old history without rewriting it. | Unassigned |
| WEB-P1-001 | P1 | Resolved | QA automation | No repeatable web preflight/smoke commands existed. | Added `qa:*` scripts and smoke harness. Latest authenticated smoke passed 17 checks, failed 0, skipped 1 destructive write check. | Use generated reports under ignored `qa-artifacts/`. | Unassigned |
| WEB-P1-002 | P1 | Resolved | Dependencies | `npm run qa:audit` failed with 15 advisories, including high-severity `undici`. | Added targeted npm overrides and removed unused `@expo/ngrok`; `npm run qa:audit` now reports 0 vulnerabilities. | Keep overrides until Expo transitive dependencies catch up. | Unassigned |
| WEB-P1-003 | P1 | Resolved | QA data | Authenticated web QA paths were not covered. | Created dedicated QA employee and configured ignored `.env.local`; authenticated smoke now passes login, tabs, project search, projects, timesheet, more, reload, and responsive checks. | Destructive write coverage remains tracked separately as WEB-P1-004. | Unassigned |
| WEB-P2-003 | P2 | Resolved | Tooling | Local npm install used unsupported Node 21.2.0. | Added `.nvmrc`, `engines.node`, and `qa:node`; `qa:preflight` passes under Node 22.23.1 and fails fast on Node 21. | Switch shell/CI to Node 20 LTS or 22+ before running full `qa:preflight`. | Unassigned |
| WEB-P2-001 | P2 | Resolved | Web runtime | Web emitted RN Web `shadow*` deprecation warnings. | Web-loaded styles now use `boxShadow` on web; latest smoke has no shadow warning. | Native shadows remain on native platforms. | Unassigned |
| WEB-P2-002 | P2 | Resolved | Web runtime | Expo Notifications push-token listener was unsupported on web. | Added a web no-op notification module so web bundles do not import `expo-notifications`; latest smoke has no notifications warning. | Native notification behavior remains in the native module. | Unassigned |
| WEB-P1-004 | P1 | Resolved | QA data | Destructive clock-in/out testing was blocked because there was no QA-safe project. | Added QA fixture project migration, assigned it to `qa-web-smoke@paintersottawa.com`, and ran `QA_ALLOW_DESTRUCTIVE=1 npm run qa:smoke:web`: 19 passed, 0 failed, 0 skipped. | Keep QA project labeled and isolated from real customer work. | Unassigned |
| WEB-P1-005 | P1 | Resolved | Clock-in | Web crashed after clock-out because Expo Location web watcher cleanup threw `_LocationEventEmitter.LocationEventEmitter.removeSubscription is not a function`. | Destructive smoke report `web-smoke-2026-06-29T17-03-01-844Z` captured the page error. | Web now uses a no-op active location watcher; destructive smoke passes without page errors. | Unassigned |
| WEB-P1-006 | P1 | Resolved | Backend/RLS | RLS update protection for time entries needed verification. | `npm run qa:rls`: another authenticated QA user cannot update the QA smoke user's time entry. | Keep RLS check in the QA suite after destructive smoke. | Unassigned |
| WEB-P0-002 | P0 | Resolved | Backend/Security | Unauthenticated callers could fetch CompanyCam project photos with only the public anon key. | Before fix, `companycam-project-photos` returned `200` with no `Authorization` header and `painterPhotoCount: 1`; UI opened 26 photos for a live non-QA project. | Deployed `companycam-project-photos` with an active-employee auth gate. Verification: missing auth returns `401`, anon JWT returns `401`, signed-in QA employee returns `200`. | Unassigned |
| WEB-P1-009 | P1 | Resolved | Backend/RLS | Painter accounts could read non-project operational data that should stay scoped. | Before fix, QA painter could read 3 employee profiles and 10 other-user time entries through the public client. Project/customer-address visibility is accepted for now. | Added scoped RLS for employee profiles, project assignments, and time entries. Verification: `npm run qa:rls` confirms painters can read projects but cannot read/update another painter's operational rows. | Unassigned |
| WEB-P1-008 | P1 | Resolved | Backend/CompanyCam | CompanyCam sync controls were visible to painters and the sync function was not role-gated. | Before fix, Projects header showed `Sync` for QA painter and `sync-companycam-projects` used service-role/CompanyCam secrets without caller role checks. | Hid Sync for painters and deployed a manager/admin auth gate in `sync-companycam-projects`. Verification: missing auth returns `401`, painter auth returns `403`; web smoke passed 19/19. | Unassigned |
| WEB-P2-005 | P2 | Resolved | Web UX | Browser location-denied state used native/iOS recovery copy and an `Open Settings` action that was not appropriate for web. | In-app browser login landed on `Location denied` with copy: `iOS will not show the prompt again. Turn location back on in Settings.` | Web permission UI now uses browser/site-settings copy, session-tracking labels, and `Check again` instead of native Settings actions. Verification: `npm run qa:preflight` passed. | Unassigned |

## New Issue Template

| ID | Severity | Status | Area | Issue | Evidence | Next action | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WEB-000 | P0/P1/P2/P3 | Open | Auth/Clock/Projects/Timesheet/Backend/UX | Short title | Repro steps, screenshot path, console/network output, Supabase row/function evidence | Concrete fix or investigation step | Name |

## Running The Sweep

1. Put QA-only credentials in `.env.local` or the shell, never in `.env` committed to git:
   - `QA_EMAIL`
   - `QA_PASSWORD`
   - `QA_PROJECT_SEARCH`
2. Use Node 20 LTS or Node 22+.
3. Start web: `npm run qa:web`.
4. In a second terminal run preflight checks: `npm run qa:preflight`.
5. Run browser smoke: `npm run qa:smoke:web`.
6. For QA-only write-path testing, run `QA_ALLOW_DESTRUCTIVE=1 npm run qa:smoke:web`.
7. Run `npm run qa:rls` after destructive smoke to verify another QA user cannot update the smoke user's time entry.
8. Attach generated `qa-artifacts/web-smoke-*/report.json` and screenshots to any issue rows above.
