import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();

await db.exec(`
  create role anon;
  create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create or replace function auth.uid()
  returns uuid language sql stable
  as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create or replace function auth.jwt()
  returns jsonb language sql stable
  as $$ select jsonb_build_object('email', current_setting('app.email', true)) $$;
  create or replace function auth.role()
  returns text language sql stable
  as $$ select 'authenticated'::text $$;

  create table public.companycam_projects (
    companycam_id text primary key,
    name text not null
  );
  create table public.employee_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    email text,
    full_name text,
    role text not null default 'painter' check (role in ('admin', 'manager', 'painter')),
    is_active boolean not null default true,
    inserted_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
  );
  create table public.time_entries (
    id uuid primary key default gen_random_uuid(),
    client_entry_id text unique,
    user_id uuid references auth.users(id) on delete cascade,
    user_email text,
    user_name text,
    companycam_project_id text references public.companycam_projects(companycam_id) on delete set null,
    project_name text not null,
    project_address text,
    original_started_at timestamptz,
    started_at timestamptz not null,
    start_edited_at timestamptz,
    ended_at timestamptz,
    status text not null default 'active' check (status in ('active', 'complete')),
    clock_in_latitude double precision,
    clock_in_longitude double precision,
    clock_out_latitude double precision,
    clock_out_longitude double precision,
    last_distance_meters integer,
    is_on_site boolean,
    segments jsonb not null default '[]'::jsonb,
    adjustment_history jsonb not null default '[]'::jsonb,
    notes text,
    approved_at timestamptz,
    approved_by uuid references auth.users(id) on delete set null,
    inserted_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
  );
  alter table public.time_entries enable row level security;
  create policy "Users can read own time entries"
  on public.time_entries for select to authenticated
  using (user_id = auth.uid());
  create policy "Users can insert own time entries"
  on public.time_entries for insert to authenticated
  with check (user_id = auth.uid());
  create policy "Users can update own time entries"
  on public.time_entries for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
  create policy "Users can delete own time entries"
  on public.time_entries for delete to authenticated
  using (user_id = auth.uid());
  grant select, insert, update, delete on public.time_entries to authenticated;

  create or replace function public.current_employee_role()
  returns text language sql stable security definer set search_path = public
  as $$
    select role from public.employee_profiles
    where user_id = auth.uid() and is_active = true limit 1
  $$;
  create or replace function public.set_updated_at()
  returns trigger language plpgsql
  as $$ begin new.updated_at = timezone('utc', now()); return new; end $$;
`);

for (const migration of [
  "supabase/migrations/20260715140000_protect_time_entry_lifecycle.sql",
  "supabase/migrations/20260715150000_authoritative_time_entry_commands.sql",
]) {
  await db.exec(fs.readFileSync(migration, "utf8"));
}

const userId = "11111111-1111-4111-8111-111111111111";
await db.query(
  "insert into auth.users (id, email) values ($1, 'bilal@example.test')",
  [userId],
);
await db.query(
  `insert into public.employee_profiles (user_id, email, full_name)
   values ($1, 'bilal@example.test', 'Bilal')`,
  [userId],
);
await db.exec(`
  insert into public.companycam_projects (companycam_id, name)
  values ('job-1', 'Test Job');
`);
await db.query(
  `select set_config('app.uid', $1, false),
          set_config('app.email', 'bilal@example.test', false)`,
  [userId],
);

const baseCommand = {
  client_entry_id: "shift-1",
  companycam_project_id: "job-1",
  project_name: "Test Job",
  project_address: "1 Test Street",
  started_at: "2026-07-14T13:00:00.000Z",
  clock_in_latitude: 45.42,
  clock_in_longitude: -75.69,
  segments: [],
  source: "qa",
};

async function command(functionName, payload) {
  const result = await db.query(
    `select to_jsonb(public.${functionName}($1::jsonb)) as row`,
    [JSON.stringify(payload)],
  );
  return result.rows[0].row;
}

const active = await command("clock_in_time_entry", baseCommand);
assert.equal(active.status, "active");
assert.equal(active.ended_at, null);

const observed = await command("record_time_entry_observation", {
  ...baseCommand,
  server_id: active.id,
  clock_out_latitude: 45.43,
  clock_out_longitude: -75.7,
  last_distance_meters: 25,
  is_on_site: true,
});
assert.equal(observed.status, "active");
assert.equal(observed.last_distance_meters, 25);

const firstEnd = "2026-07-14T22:00:00.000Z";
const completed = await command("clock_out_time_entry", {
  ...baseCommand,
  server_id: active.id,
  ended_at: firstEnd,
  reason: "manual",
});
assert.equal(completed.status, "complete");
assert.equal(new Date(completed.ended_at).toISOString(), firstEnd);

const lateObservation = await command("record_time_entry_observation", {
  ...baseCommand,
  server_id: active.id,
  clock_out_latitude: 99,
  clock_out_longitude: 99,
});
assert.equal(lateObservation.status, "complete");
assert.notEqual(lateObservation.clock_out_latitude, 99);

const delayedClockIn = await command("clock_in_time_entry", baseCommand);
assert.equal(delayedClockIn.status, "complete");
assert.equal(new Date(delayedClockIn.ended_at).toISOString(), firstEnd);

const repeatedClockOut = await command("clock_out_time_entry", {
  ...baseCommand,
  server_id: active.id,
  ended_at: "2026-07-15T11:43:00.000Z",
});
assert.equal(new Date(repeatedClockOut.ended_at).toISOString(), firstEnd);

await assert.rejects(
  db.query(
    `update public.time_entries
     set status = 'active', ended_at = null
     where id = $1`,
    [active.id],
  ),
  /administrative service may reopen/,
  "the compatibility trigger must reject stale writes from an old app build",
);

const lifecycleCounts = await db.query(`
  select event_type, count(*)::integer as count
  from public.time_entry_lifecycle_events
  where client_entry_id = 'shift-1'
  group by event_type
  order by event_type
`);
assert.deepEqual(lifecycleCounts.rows, [
  { event_type: "clock_in", count: 1 },
  { event_type: "clock_out", count: 1 },
]);

const offlineCompleted = await command("clock_out_time_entry", {
  ...baseCommand,
  client_entry_id: "shift-offline",
  started_at: "2026-07-15T09:00:00.000Z",
  ended_at: "2026-07-15T17:00:00.000Z",
  source: "qa_offline",
});
assert.equal(offlineCompleted.status, "complete");
assert.equal(
  new Date(offlineCompleted.ended_at).toISOString(),
  "2026-07-15T17:00:00.000Z",
  "a self-contained offline clock-out should not require clock-in to sync first",
);
const offlineRetry = await command("clock_in_time_entry", {
  ...baseCommand,
  client_entry_id: "shift-offline",
  started_at: "2026-07-15T09:00:00.000Z",
});
assert.equal(offlineRetry.status, "complete");

const offlineAdjusted = await command("adjust_time_entry", {
  ...baseCommand,
  client_entry_id: "shift-offline-edit",
  original_started_at: "2026-07-13T09:00:00.000Z",
  started_at: "2026-07-13T09:05:00.000Z",
  ended_at: "2026-07-13T17:00:00.000Z",
  adjustment_source: "qa_offline_edit",
});
assert.equal(
  new Date(offlineAdjusted.started_at).toISOString(),
  "2026-07-13T09:05:00.000Z",
);
assert.equal(offlineAdjusted.adjustment_history.length, 1);

const secondCommand = {
  ...baseCommand,
  client_entry_id: "shift-2",
  started_at: "2026-07-15T12:00:00.000Z",
};
await command("clock_in_time_entry", secondCommand);
await assert.rejects(
  command("clock_in_time_entry", {
    ...secondCommand,
    client_entry_id: "shift-duplicate",
  }),
  /already has an active time entry/,
);

const switchResult = await db.query(
  `select public.switch_time_entry($1::jsonb, $2::jsonb) as result`,
  [
    JSON.stringify({
      ...secondCommand,
      ended_at: "2026-07-15T13:00:00.000Z",
      reason: "switched_project",
    }),
    JSON.stringify({
      ...secondCommand,
      client_entry_id: "shift-3",
      started_at: "2026-07-15T13:00:00.000Z",
    }),
  ],
);
assert.equal(switchResult.rows[0].result.completed_entry.status, "complete");
assert.equal(switchResult.rows[0].result.active_entry.status, "active");

const adjusted = await command("adjust_time_entry", {
  ...baseCommand,
  server_id: active.id,
  ended_at: "2026-07-14T21:30:00.000Z",
  adjustment_source: "qa_time_edit",
});
assert.equal(new Date(adjusted.ended_at).toISOString(), "2026-07-14T21:30:00.000Z");
assert.equal(adjusted.adjustment_history.length, 1);

const privileges = await db.query(`
  select
    has_table_privilege('authenticated', 'public.time_entries', 'UPDATE') as can_update,
    has_function_privilege('authenticated', 'public.clock_out_time_entry(jsonb)', 'EXECUTE') as can_clock_out
`);
assert.equal(
  privileges.rows[0].can_update,
  true,
  "legacy owner writes remain temporarily available during the app rollout",
);
assert.equal(privileges.rows[0].can_clock_out, true);

console.log("Authoritative time-entry command integration checks passed.");
await db.close();
