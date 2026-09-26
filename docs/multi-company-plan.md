# Plan: multi-company ServiceFlow and public App Store release

Written 2026-09-25. Goal: turn ServiceFlow from Ottawa Painters' internal app
into a product any trades company (painting, plumbing, electrical, cleaning, …)
can sign up for, and ship it publicly on
the App Store. The native iOS rewrite waits until this is done (see Phase 7).

## Where things stand today

- **One company everywhere.** The Service Flow Supabase project
  (`bwbckdkouqghdadpkjvn`) has no company column on any table. `employees.id` is
  the auth user id, so one person maps to exactly one employee row.
- **Row-level security (RLS) only checks that someone is logged in.**
  `contacts`, `leads`, `jobs`, `quotes`, `time_entries`, `employees`,
  `employee_pay_rates` and `job_budgets` all have
  `authenticated_read: auth.uid() IS NOT NULL`. Manager-only tables use
  `private.is_manager()`, which knows nothing about companies.
  **Once public signup is on, any stranger could read all Ottawa Painters data.**
  The security work in Phase 1 must ship before signup is enabled.
- **About 70 public functions**, many `SECURITY DEFINER`
  (`record_time_entry_command`, `record_location_update`, `save_job_budget`,
  `manage_team_account`, `publish_quote`, …). They bypass RLS, so each one
  needs its own company check.
- **Ottawa Painters leftovers were archived on 2026-09-25.** Migration
  `20260925184249_archive_ottawa_painters_business_tables` moved 18 tables,
  16 views and 2 functions (the DripJobs report tables, `marketing_*`,
  `meta_audience_*`, `acquisition_attributions`, `documents`,
  `evidence_links`, `verification_events`) into the `ottawa_painters_archive`
  schema, which the API can't reach. Their foreign keys to live tables were
  dropped. The Ottawa Painters project has the same rows, or more. Once nothing
  has been missed, drop the schema with `drop schema ottawa_painters_archive cascade`.
- **Ottawa Painters integrations that are still live in ServiceFlow.** These are
  kept on purpose because they act on Ottawa Painters' own ServiceFlow data.
  Phase 1 scopes them to the Ottawa Painters org:
  - `dripjobs-events` → `process_dripjobs_zapier_event`: the Zapier intake
    that creates Ottawa Painters' contacts, leads, quotes and jobs. Last ran
    2026-09-24.
  - `get_integration_health` (DripJobs sync health in the web admin).
  - `hermes_*` read-only report functions and `hermes-time-entries` (the
    Hermes assistant).
- **Edge functions deleted on 2026-09-25:** `meta-audience-events` (source
  saved to `ottawa-painters-admin/supabase/functions/meta-audience-events`)
  and the old ServiceFlow copy of `hermes-contractor-invoices`, which only
  returned a "moved to Ottawa Painters" (410) response.
- **Outbox sync to the Ottawa Painters Supabase project**
  (`pyzejfhsdewpnvmtqtlw`) uses `claim_serviceflow_sync`. It must only ever
  carry Ottawa Painters rows.
- **Media**: the Cloudflare R2 worker (`mobile/cloudflare/project-media-worker`)
  authorizes access through `job_media`/`jobs` visibility.
- **Repository layout:** one repo, `jaddoescad/serviceflow`: the admin
  website in `web/`, the mobile app in `mobile/`, and the Supabase backend in
  `supabase/` (`migrations`, `functions`).
- **Login** is email + password. Accounts are created by an admin
  (`scripts/office.cjs create-employee`, `manage_team_account`).

## Target model

```
organizations        id, name, slug, timezone, address, phone, logo, status
                     (active|suspended), created_by, created_at
org_members          org_id, user_id, role, is_active, job_title, joined_at
                     PK (org_id, user_id)
org_invitations      id, org_id, email, phone, role, code_hash, invited_by,
                     expires_at, accepted_at, accepted_by, revoked_at
profiles (employees) user_id, full_name, phone, avatar   -- the person, global
platform_admins      user_id                              -- ServiceFlow staff
audit_log            id, org_id, actor_id, action, target, details, at
```

- **Roles** (per company): `owner`, `admin`, `manager`, `painter`. Existing
  `admin/manager/painter` map directly, and the Ottawa Painters owner becomes
  `owner`. "Job lead" stays a per-job assignment attribute, not a role.
- **Every company-owned table gets `org_id uuid not null references organizations`**,
  plus an index on it. Unique constraints become per company
  (`unique (org_id, …)`).
- **Pay rates, role, active flag and job title move to `org_members`.** A person
  can be `manager` at one company and `painter` at another.
- **Helpers** (in the `private` schema, `security definer`, `stable`):
  - `private.my_org_ids()`
  - `private.org_role(org_id)`
  - `private.is_org_member(org_id)`
  - `private.is_org_manager(org_id)`
  - `private.is_platform_admin()`

  These replace `private.is_manager()`.
- **Standard policy:** `using (org_id in (select private.my_org_ids()))`, plus
  role checks where needed. Location, pay and marketing tables additionally
  require `private.is_org_manager(org_id)` or `employee_id = auth.uid()`.

### Contractors in several companies

- One login, several `org_members` rows. The app shows a **company switcher**
  and remembers the active company on the device.
- The client passes `org_id` explicitly on every query and RPC. RLS lets a
  user see all their companies, so without the filter the lists would mix.
- Don't put the active company in the JWT. Switching would then need a token
  refresh, and stale tokens cause confusing bugs.
- **Only one active shift at a time across all companies.** Enforce it with a
  partial unique index on `time_entries (employee_id) where <active>`. Clocking
  in for Company B while clocked in for A returns a clear error.
- **Location privacy:** every `employee_location_points` and
  `employee_tracking_status` row carries the `org_id` and `time_entry_id` of
  the shift that produced it. Company A can never see location recorded during
  a Company B shift, and nobody sees location outside a shift.

## Phase 1: Company foundation in the database (must ship before signup)

**Progress (2026-09-25):**
- Step 1 done (`20260925185644_create_organizations`): `organizations`,
  `org_members`, `platform_admins`, and the `private.my_org_ids` / `org_role` /
  `is_org_member` / `is_org_manager` / `is_platform_admin` helpers. Ottawa
  Painters org created with all 17 employees (Jad = owner, `painter` → `crew`).
  A trigger on `employees` keeps memberships in sync.
- Step 2 done (`20260925190546_add_org_id_to_company_tables`): `org_id` on 21
  tables. The default `private.legacy_default_org_id()` means Ottawa Painters.
  Tables left out on purpose: `employees`, `push_tokens`, `app_config`.
- Step 3 done (`20260925201731_scope_rls_to_organizations`): every access
  rule is scoped by company, using `private.my_org_ids()` /
  `my_managed_org_ids()`. Tested before and after inside a rolled-back
  transaction: the owner and crew see identical counts, deactivated employees
  lose access, and a fake second company sees none of Ottawa Painters' data
  (and the reverse). Photos can't be attached to another company's job.
- Found along the way, to fix in later steps:
  - `project_labels.name` is unique across all companies; it should be unique
    per company.
  - `employee_pay_rates` is readable by every crew member of the company
    (as it was before); restrict it to managers and the employee themselves.
  - The storage buckets `labour-invoices`, `customer-invoices` and
    `material-invoices` hold Ottawa Painters accounting files; move them to
    the Ottawa Painters project.
- Step 4 done (`20260925205112_scope_definer_functions_to_organizations`):
  - 24 elevated-rights (SECURITY DEFINER) functions are wrapped. Each wrapper
    finds the company of the row it acts on, refuses non-members, and sets
    `serviceflow.org_id` for the transaction, so `private.is_manager()` means
    "manager of that company". The originals are now
    `private.<name>__unscoped`, which the API can't call.
  - Children inherit their parent's company through the `inherit_org_id`
    trigger, and cross-company links are refused.
  - New top-level rows default to `private.acting_org_id()`: the caller's
    company, or Ottawa Painters for server-side callers with no user.
  - Tested in rolled-back transactions: a crew member's full shift,
    owner actions, and a fake second company refused on every Ottawa
    Painters action while working normally inside its own company.
- Follow-up done (`20260925210514_membership_based_permissions`):
  - `employees` is now the person's profile. Roles and active status come
    from `org_members`; `employees.role` / `is_active` are kept only as
    Ottawa Painters' legacy fields for the admin team page.
  - New employee rows join a company only inside that company's action, or
    server-side from Ottawa Painters' existing tools. Self-signups join
    none. Legacy role/active edits sync to the Ottawa Painters membership
    only and never demote an owner.
  - Every permission check inside functions reads the membership
    (`private.acting_member()`, `private.is_manager()`, `org_role`).
  - `manage_team_account` changes the membership in its company, protects the
    owner, and keeps at least one admin per company.
- Still open:
  - A person in two companies must pass the company explicitly for new
    top-level rows (company switcher, Phase 5).
  - The mobile app (`mobile/App.js` `canManageProjects`) and the
    `project-assignments` edge function (`authorize`) still read
    `employees.role` to decide what to show / who may call it. That's fine for
    Ottawa Painters; switch them to the membership role in Phase 5 / Phase 2.
  - `get_crew_summary` / `get_overview_summary` count `employees` rather than
    company members (per-company admin pages, Phase 5).
- Next: Phase 1 step 5, the photo worker (`mobile/cloudflare/project-media-worker`),
  and step 6, a repeatable two-company leak test in
  `mobile/scripts/qa-supabase-rls.cjs`.

Use an expand-then-contract migration so the live Android app and older
binaries keep working the whole time:

1. Create `organizations`, `org_members`, the helpers and `audit_log`. Insert the
   **Ottawa Painters** org and one `org_members` row per existing employee.
2. Add nullable `org_id` to every company-owned table, backfill it with the
   Ottawa Painters org, then make it `not null`. Give it a temporary default of
   the Ottawa Painters org id so old clients that don't send `org_id` still write
   valid rows.
3. Rewrite every RLS policy to the company-scoped form. Old clients keep
   working because every current user is an Ottawa Painters member.
4. Audit every `SECURITY DEFINER` function. Each one either takes
   `requested_org_id` and checks `private.is_org_member/manager`, or derives
   the org from the row it touches (such as `jobs.org_id`) and checks
   membership. Also check that cross-row references stay inside one company:
   a job task, media item, assignment or time entry must never point at
   another company's job.
5. The R2 media worker checks company membership for the job before signing a
   URL. New object keys go under `orgs/{org_id}/jobs/{job_id}/…`, and old keys
   stay valid.
6. The outbox to the Ottawa Painters project only enqueues rows where
   `org_id = <Ottawa Painters>`, enforced in the trigger and not just the reader.
7. **Ottawa Painters integrations** (the leftover data is already archived, see
   above): tag the DripJobs intake, integration health and Hermes functions
   with the Ottawa Painters org and allow them only for that org. Move
   CompanyCam's single global key to a per-company `org_integrations` row, so
   any company can connect its own CompanyCam account. The DripJobs rules in
   the root `AGENTS.md` then apply to the Ottawa Painters org only.
8. Scheduled edge functions (reminders, stale-location alerts) loop per company
   and use each company's timezone.
9. **Test for leaks:** extend `mobile/scripts/qa-supabase-rls.cjs` with two fixture
   companies and users in each role. Assert that no table, RPC or media URL
   returns data from the other company. This is the release gate for enabling
   signup.

Right away, independent of this plan: confirm **"Allow new users to sign up"
is OFF** in Supabase Auth settings. With today's policies, an open signup
already exposes everything.

## Phase 2: Invites and sign-in

**Sign-in:** move to **email one-time codes** (6-digit code sent to email,
`signInWithOtp` + `verifyOtp`). Painters don't need to remember passwords, and
no deep links are required. Keep password login for the App Review demo
account. With no Google or Facebook login, Sign in with Apple isn't required.

**Invite flow (first version needs no deep links, so it can ship JavaScript-only):**

1. A manager enters an email (and optionally a phone number) and a role, in the
   web admin or the app.
2. Edge function `send-invitation`:
   - checks `is_org_manager` and applies a rate limit
   - creates an `org_invitations` row with a random 8-character code (stores
     only the hash) that expires after 7 days
   - sends the email through **Resend or Postmark** from a verified ServiceFlow
     domain (Supabase's built-in SMTP is limited to a few emails an hour)

   For now, send from `info@paintersottawa.com` with the display name
   "ServiceFlow". The domain needs Resend's SPF/DKIM DNS records. Switch to a
   ServiceFlow domain later; it's a one-line config change.

   Email: *"Mike invited you to join Ottawa Painters on ServiceFlow. Code:
   K7Q2-MX9P."* plus App Store and Play links.
3. The painter installs the app, signs in with an email code, and taps **Join a
   company** → enters the code. RPC `accept_invitation(code)` checks the code
   isn't expired, revoked or already used, creates the `org_members` row, marks
   the invite accepted, and writes to the audit log.
4. After sign-in the app also lists pending invites that match the user's
   verified email, so they can join with one tap.

**Email matching rule:** the code is the proof. Don't require the sign-in email
to equal the invited email. People use different addresses, and Apple's Hide
My Email relay addresses never match. The team list shows *"Invited
mike@gmail.com · joined as mike.p@icloud.com"* so the admin can spot mistakes
and remove the member.

Also: resend, revoke, and an expired state in the admin UI. Later: SMS invites
through Quo/Twilio, and universal links (`https://<domain>/invite/<code>`).
Universal links are a native change, so they need a `runtimeVersion` bump.

**Existing Ottawa Painters logins keep working.** Phase 1 already made them
members, so they never see the invite flow.

## Phase 3: Company self-serve onboarding

This is what makes 3.2 true: **anyone can download the app and start a
company without talking to us.**

- The first screen after sign-in, for someone with no company, offers two
  choices: **Create a company** and **Join with an invite code**.
- **Create a company:** name, trade (painting, plumbing, electrical, HVAC,
  cleaning, landscaping, general contracting, other), city/timezone, phone. RPC
  `create_organization` makes the org and the `owner` membership.
- A first-run checklist in the app and web admin: invite your crew, create your
  first project, set pay rates, set your geofence radius.
- The web admin gets a company switcher, and every page and query is scoped to
  the active company.
- **Billing: free at launch.** When pricing is added, companies subscribe on the
  web through Stripe. That is allowed under guideline **3.1.3(c)** (enterprise
  services sold to organizations). The iOS app never shows prices, "upgrade"
  buttons or links to purchase.
- Suspended companies (`organizations.status = 'suspended'`) get read-only
  access through the helpers.

## Phase 4: ServiceFlow platform admin (you)

- A `platform_admins` table, checked by `private.is_platform_admin()`. It is
  separate from company roles and never granted through the app.
- A `/platform` section in serviceflow-admin, not in the mobile app: list
  companies, member counts, activity, suspend/restore, resend an owner invite.
- Support "view as company" is read-only, shows a banner, and every use is
  written to `audit_log`.
- The `service_role` key only lives in edge functions and server routes.

## Phase 5: Mobile app changes (React Native, both platforms)

- Company context: an active-company provider, a switcher (hidden when the user
  has one company), and `org_id` on every repository call in `mobile/src/lib/*Repository.js`.
- Onboarding screens: sign-in with email code, Create company, Join with code.
- **In-app account deletion** (guideline 5.1.1(v), required once accounts can be
  created in the app). It deletes the login and memberships. Time entries a
  company needs for payroll are kept and marked as a deleted user, and the
  deletion screen says so.
- Remove wording specific to painting and to Ottawa Painters ("Painter"
  fallback names, painting-only labels). Delete `ServicesScreen`,
  `QuoteScreen` and `ContactScreen` if they are Ottawa Painters marketing.
  The painting calculator becomes an option for painting companies only.
- Ship over the air where possible. Anything native (universal links, removing
  the background mode) goes in one binary with a `runtimeVersion` bump.

## Phase 6: App Store compliance and resubmission

| Guideline | Fix |
|---|---|
| **2.5.4** background location | iOS only: remove `"location"` (and `"fetch"` if unused) from `UIBackgroundModes` in `mobile/app.config.js`, and set `isIosBackgroundLocationEnabled: false`. On iOS the app records location at clock-in/out and while it's open. The team map shows "last seen". `stale-location-alerts` must skip iOS devices or treat gaps as "app closed". Android is unchanged. Native change, so bump `runtimeVersion`. |
| **5.1.1(iv)** location prompt | The current code only requests While In Use and has no Settings redirect. Check this on the release build: no screen before the system prompt that pressures users, no "are you sure" screen after they deny. A Settings link appears only when a denied user taps Clock In. |
| **2.3.10** screenshots | Retake them on iOS simulators: 6.9" iPhone, plus 13" iPad (`supportsTablet: true`, and review ran on an iPad). Or set `supportsTablet: false`. Show real features: clock-in, projects, photos, timesheet. |
| **3.2** business | Ship Phases 1–3 first, then answer Apple's questions (draft below). |
| **5.1.1(v)** | In-app account deletion (Phase 5). |
| **2.1** review access | Create an "App Review Demo Contracting Co" company with sample projects, plus an owner login and a painter login with passwords. In the review notes, explain how to create a company and use an invite code. |
| Metadata | Generic product name and description, privacy policy URL, accurate App Privacy labels (location, photos, name, email). No Ottawa Painters branding. The bundle id `com.ottawapainters.app` can't change and users never see it. |

**Draft reply to the 3.2 questions** (only send once self-serve signup is live
in the submitted build):

1. *No. ServiceFlow is used by independent contracting companies. Ottawa
   Painters was our first customer.*
2. *No. Any trades company can download the app and create a
   company account in-app without contacting us.*
3. *A business owner can download the app, create their company, add projects,
   and invite their crew. Crew members join with an invite code from their
   employer.*
4. *Owners sign up in the app with their email. Employees sign up the same way
   and join their company with an invite code.*
5. *The app is currently free. If we add paid plans, companies will subscribe
   as organizations under 3.1.3(c). There are no consumer purchases.*

Before submitting: follow the Release Verification rules in `mobile/AGENTS.md`, and
test the exact build on a device, including iPad.

## Phase 7: Native iOS app (after Phases 1–6)

- The web admin, Android app and iOS app all use the same company-scoped
  backend. Finishing Phases 1–4 first means the Swift app is written once
  against the final API.
- Keep business rules in RPCs (they're already there) so the Swift client stays
  thin. Generate a typed API contract from the RPC list.
- Build it in its own directory without spaces (for example `~/serviceflow-ios`,
  or `apps/ios` in this repo), and ship it under the same App Store record and
  bundle id so existing installs upgrade.
- Scope it to match the React Native app first: sign-in, company switcher,
  clock-in/out, projects, camera and media, timesheet, team map. Then retire the
  React Native iOS target.

## Order of work

1. Now: confirm Auth signup is off.
2. Phase 1 (database + RLS + function audit + leak tests). This is the biggest
   and riskiest step.
3. Phases 2–3 (invites, email-code sign-in, create company) together with the
   Phase 5 client changes.
4. Phase 4 (platform admin), which can be minimal at first.
5. Phase 6: build, verify on a device, resubmit publicly.
6. Phase 7: native iOS.

## Decisions (2026-09-25)

- **Trades:** any trade, not just painting.
- **Invite sender:** `info@paintersottawa.com` for now. Move to a ServiceFlow
  domain later.
- **Repository:** admin, backend and mobile app together in `jaddoescad/serviceflow` (combined 2026-09-14).
- **Ottawa Painters leftovers:** archived (2026-09-25). The live DripJobs and
  Hermes integrations stay, scoped to the Ottawa Painters org. CompanyCam
  becomes a per-company integration.
