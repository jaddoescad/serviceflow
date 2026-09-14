#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const ACTIVE_USER_ID = "11111111-1111-4111-8111-111111111111";
const UNPRICED_USER_ID = "22222222-2222-4222-8222-222222222222";
const migrationUrls = [
  new URL(
    "../supabase/migrations/20260716120000_create_project_budget_progress.sql",
    import.meta.url,
  ),
  new URL(
    "../supabase/migrations/20260716140000_allow_partial_project_budget_progress.sql",
    import.meta.url,
  ),
  new URL(
    "../supabase/migrations/20260716192101_add_hours_to_project_budget_progress.sql",
    import.meta.url,
  ),
  new URL(
    "../supabase/migrations/20260716200000_use_actual_labour_override_and_remove_derived_hours.sql",
    import.meta.url,
  ),
  new URL(
    "../supabase/migrations/20260716210000_create_project_feed_with_budget.sql",
    import.meta.url,
  ),
  new URL(
    "../supabase/migrations/20260716213000_add_location_to_project_feed.sql",
    import.meta.url,
  ),
];

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

  create table public.employee_profiles (
    user_id uuid primary key,
    is_active boolean not null default true
  );

  create table public.companycam_projects (
    companycam_id text primary key,
    name text not null default 'Test Project',
    formatted_address text,
    street_address_1 text,
    street_address_2 text,
    city text,
    state text,
    postal_code text,
    country text,
    latitude double precision,
    longitude double precision,
    is_archived boolean not null default false,
    is_deleted boolean not null default false,
    companycam_status text,
    is_lead boolean not null default false,
    last_synced_at timestamptz not null default now(),
    companycam_updated_at timestamptz
  );

  create table public.project_budgets (
    companycam_project_id text primary key references public.companycam_projects(companycam_id),
    budgeted_hours numeric(10, 2),
    hourly_rate numeric(10, 2),
    amount_including_tax numeric(12, 2)
  );

  create table public.time_entries (
    id uuid primary key,
    user_id uuid,
    companycam_project_id text references public.companycam_projects(companycam_id),
    started_at timestamptz not null,
    ended_at timestamptz
  );

  create table public.employee_pay_rates (
    id uuid primary key,
    user_id uuid not null,
    hourly_rate numeric(10, 2) not null,
    effective_from date not null
  );

  create table public.project_labour_expenses (
    id uuid primary key,
    companycam_project_id text not null references public.companycam_projects(companycam_id),
    amount_before_tax numeric(12, 2) not null
  );

  insert into public.companycam_projects (companycam_id, name, is_deleted)
  values ('109412153', 'Sheila McSwiggan', false);

  update public.companycam_projects
  set formatted_address = '1953 Oakdean Crescent, Ottawa, ON, K1J 6H6, CA',
      street_address_1 = '1953 Oakdean Crescent',
      city = 'Ottawa',
      state = 'ON',
      postal_code = 'K1J 6H6',
      country = 'CA',
      latitude = 45.4576891781006,
      longitude = -75.6091136299074
  where companycam_id = '109412153';

  insert into public.project_budgets (companycam_project_id, amount_including_tax)
  values ('109412153', 1130.00);
`);

for (const migrationUrl of migrationUrls) {
  await db.exec(await readFile(migrationUrl, "utf8"));
}

await db.exec(`
  set "request.jwt.claim.sub" = '${ACTIVE_USER_ID}';

  insert into public.employee_profiles (user_id, is_active) values
    ('${ACTIVE_USER_ID}', true),
    ('${UNPRICED_USER_ID}', true);

  insert into public.companycam_projects (companycam_id, name, is_deleted) values
    ('job-1', 'Job One', false),
    ('job-without-budget', 'Job Without Budget', false);

  insert into public.project_budgets (companycam_project_id, amount_including_tax)
  values ('job-1', 11300.00);

  insert into public.employee_pay_rates (id, user_id, hourly_rate, effective_from)
  values (
    '33333333-3333-4333-8333-333333333333',
    '${ACTIVE_USER_ID}',
    30.00,
    '2026-01-01'
  );

  insert into public.time_entries (
    id,
    user_id,
    companycam_project_id,
    started_at,
    ended_at
  ) values (
    '44444444-4444-4444-8444-444444444444',
    '${ACTIVE_USER_ID}',
    'job-1',
    '2026-07-01T12:00:00Z',
    '2026-07-05T16:00:00Z'
  ), (
    '77777777-7777-4777-8777-777777777777',
    '${ACTIVE_USER_ID}',
    '109412153',
    '2026-07-13T11:30:00Z',
    '2026-07-13T15:45:00Z'
  );
`);

let progress = await getProgress("job-1");
assert.equal(Number(progress.percent_used), 76.9);
assert.equal(Number(progress.hours_used), 100);
assert.equal(progress.budget_status, "under");
assert.equal(progress.is_complete, true);
assert.deepEqual(Object.keys(progress).sort(), [
  "budget_status",
  "calculated_at",
  "companycam_project_id",
  "hours_used",
  "is_complete",
  "percent_used",
]);

const sheilaProgress = await getProgress("109412153");
assert.equal(Number(sheilaProgress.percent_used), 115.4);
assert.equal(Number(sheilaProgress.hours_used), 4.3);
assert.equal(sheilaProgress.budget_status, "over");
assert.equal(sheilaProgress.is_complete, true);

const projectFeed = (
  await db.query(
    "select * from public.list_project_feed(0, 20, '', null)",
  )
).rows;
const sheilaFeedRow = projectFeed.find((row) => row.companycam_id === "109412153");
assert.ok(sheilaFeedRow);
assert.equal(Number(sheilaFeedRow.budget_percent_used), 115.4);
assert.equal(Number(sheilaFeedRow.budget_hours_used), 4.3);
assert.equal(sheilaFeedRow.budget_status, "over");
assert.equal(sheilaFeedRow.budget_is_complete, true);
assert.equal(Number(sheilaFeedRow.latitude), 45.4576891781006);
assert.equal(Number(sheilaFeedRow.longitude), -75.6091136299074);
assert.equal(sheilaFeedRow.street_address_1, "1953 Oakdean Crescent");
assert.equal(projectFeed.some((row) => "amount_including_tax" in row), false);
assert.equal(projectFeed.some((row) => "actual_labour_cost_override" in row), false);

const [{ actual_labour_cost_override: sheilaActualLabourCost }] = (
  await db.query(
    "select actual_labour_cost_override from public.project_budgets where companycam_project_id = '109412153'",
  )
).rows;
assert.equal(Number(sheilaActualLabourCost), 450);

const [{ labour_allocation_percent: defaultAllocation }] = (
  await db.query(
    "select labour_allocation_percent from public.project_budgets where companycam_project_id = 'job-1'",
  )
).rows;
assert.equal(Number(defaultAllocation), 39);

await db.exec(`
  insert into public.project_labour_expenses (id, companycam_project_id, amount_before_tax)
  values ('55555555-5555-4555-8555-555555555555', 'job-1', 900.00);
`);
progress = await getProgress("job-1");
assert.equal(Number(progress.percent_used), 100);
assert.equal(Number(progress.hours_used), 100);
assert.equal(progress.budget_status, "at");

await db.exec(`
  update public.project_labour_expenses
  set amount_before_tax = 1300.00
  where id = '55555555-5555-4555-8555-555555555555';
`);
progress = await getProgress("job-1");
assert.equal(Number(progress.percent_used), 110.3);
assert.equal(Number(progress.hours_used), 100);
assert.equal(progress.budget_status, "over");

const pending = await getProgress("job-without-budget");
assert.equal(pending.percent_used, null);
assert.equal(Number(pending.hours_used), 0);
assert.equal(pending.budget_status, "not_configured");
assert.equal(pending.is_complete, false);

await db.exec(`
  update public.project_labour_expenses
  set amount_before_tax = 0
  where id = '55555555-5555-4555-8555-555555555555';

  insert into public.time_entries (
    id,
    user_id,
    companycam_project_id,
    started_at,
    ended_at
  ) values (
    '66666666-6666-4666-8666-666666666666',
    '${UNPRICED_USER_ID}',
    'job-1',
    '2026-07-06T12:00:00Z',
    '2026-07-06T13:00:00Z'
  );
`);
progress = await getProgress("job-1");
assert.equal(Number(progress.percent_used), 76.9);
assert.equal(Number(progress.hours_used), 101);
assert.equal(progress.budget_status, "under");
assert.equal(progress.is_complete, false);

console.log("Budget SQL checks passed: actual hours, hourly/fixed costs, total-cost override, under/at/over states, and partial known-cost progress.");

async function getProgress(projectId) {
  const result = await db.query(
    "select * from public.get_project_budget_progress(array[$1]::text[])",
    [projectId],
  );
  assert.equal(result.rows.length, 1);
  return result.rows[0];
}
