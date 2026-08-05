import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260805202244_automate_default_job_budget_hours.sql",
  import.meta.url,
);

async function database() {
  const db = new PGlite();

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema extensions;
    create schema private;

    create table auth.users (id uuid primary key);
    insert into auth.users (id)
    values ('00000000-0000-0000-0000-000000000001');

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      select '00000000-0000-0000-0000-000000000001'::uuid
    $$;

    create function extensions.gen_random_uuid()
    returns uuid
    language sql
    volatile
    as $$ select gen_random_uuid() $$;

    create function extensions.uuid_generate_v5(namespace_id uuid, source_key text)
    returns uuid
    language sql
    immutable
    as $$ select md5(namespace_id::text || source_key)::uuid $$;

    create function private.is_manager()
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $$ select true $$;

    create table public.app_config (
      id text primary key,
      schema_version integer not null,
      maintenance_mode boolean not null default false,
      minimum_mobile_version text not null,
      settings jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );

    insert into public.app_config (
      id, schema_version, maintenance_mode, minimum_mobile_version, settings
    ) values ('default', 2, false, '1.1.0', '{"calculator_rates":{}}');

    create table public.contacts (
      id uuid primary key,
      kind text not null,
      dripjobs_contact_id text unique,
      name text not null,
      email text,
      phone text,
      normalized_email text,
      normalized_phone text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.leads (
      id uuid primary key,
      contact_id uuid not null references public.contacts(id),
      dripjobs_deal_id text unique,
      status text not null,
      pipeline_stage_raw text,
      source text,
      normalized_channel text not null default 'unknown',
      address text,
      city text,
      province text,
      postal_code text,
      estimate_scheduled_on date,
      estimate_appointment_on date,
      is_interior boolean not null default false,
      is_exterior boolean not null default false,
      is_cabinets boolean not null default false,
      created_at timestamptz not null,
      captured_at timestamptz not null,
      updated_at timestamptz not null default now(),
      metadata jsonb not null default '{}'::jsonb
    );

    create table public.quotes (
      id uuid primary key,
      lead_id uuid not null references public.leads(id),
      dripjobs_proposal_id text unique,
      name text not null,
      status text not null,
      amount_cents bigint not null default 0,
      tax_cents bigint not null default 0,
      calculator_doc jsonb,
      accepted_at timestamptz,
      valid_until date,
      source text not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.jobs (
      id uuid primary key,
      contact_id uuid references public.contacts(id),
      lead_id uuid references public.leads(id),
      accepted_quote_id uuid unique references public.quotes(id),
      name text not null,
      status text not null,
      contract_amount_cents bigint not null default 0,
      address_line_1 text,
      address_line_2 text,
      city text,
      province text,
      postal_code text,
      country text not null default 'CA',
      formatted_address text,
      latitude double precision,
      longitude double precision,
      companycam_project_ids text[] not null default '{}'::text[],
      scheduled_on date,
      started_on date,
      completed_on date,
      archived_at timestamptz,
      is_feed_visible boolean not null default true,
      source text not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.job_budgets (
      id uuid primary key,
      job_id uuid not null references public.jobs(id) on delete cascade,
      quote_id uuid references public.quotes(id),
      version integer not null default 1,
      status text not null,
      budget_minutes integer,
      calculated_minutes integer,
      hourly_rate_cents integer,
      amount_including_tax_cents bigint,
      labour_allocation_percent numeric(6,3) not null default 40,
      actual_labour_cost_cents bigint,
      instructions text,
      notes text,
      closed_at timestamptz,
      closed_by uuid references auth.users(id),
      source text not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (job_id, source, version)
    );

    create unique index job_budgets_one_active_operational_idx
      on public.job_budgets(job_id)
      where source in ('manual', 'project_budget') and status = 'active';

    create table public.time_entries (
      id uuid primary key,
      job_id uuid references public.jobs(id),
      job_name text not null,
      started_at timestamptz not null,
      ended_at timestamptz,
      status text not null
    );

    create table private.integration_events (
      id uuid primary key,
      provider text not null,
      event_key text not null,
      event_type text not null,
      entity_type text,
      entity_id text,
      occurred_at timestamptz,
      payload jsonb not null default '{}'::jsonb,
      payload_sha256 text,
      processing_status text not null,
      error_code text,
      is_test boolean not null default false,
      attempt_count integer not null default 0,
      received_at timestamptz not null,
      processed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (provider, event_key)
    );
  `);

  return db;
}

async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0])[0];
}

test("backfills missing hours and preserves explicit budgets", async () => {
  const db = await database();

  await db.exec(`
    insert into public.jobs (
      id, name, status, contract_amount_cents, source
    ) values
      ('ec24398b-3137-5b77-b59a-6497cd648aa9', 'Mehaly', 'scheduled', 65052, 'dripjobs'),
      ('10000000-0000-0000-0000-000000000001', 'No budget', 'active', 100000, 'dripjobs'),
      ('10000000-0000-0000-0000-000000000002', 'Explicit', 'active', 100000, 'app'),
      ('10000000-0000-0000-0000-000000000003', 'Published', 'active', 100000, 'app');

    insert into public.job_budgets (
      id, job_id, version, status, budget_minutes, amount_including_tax_cents, source
    ) values
      ('20000000-0000-0000-0000-000000000001', 'ec24398b-3137-5b77-b59a-6497cd648aa9', 1, 'active', null, 57568, 'project_budget'),
      ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 1, 'active', 420, null, 'manual'),
      ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 3, 'active', 500, null, 'published_labour_budget');
  `);

  const migration = await readFile(migrationUrl, "utf8");
  await db.exec(migration);

  assert.equal(
    await scalar(
      db,
      "select budget_minutes from public.job_feed where id = $1",
      ["ec24398b-3137-5b77-b59a-6497cd648aa9"],
    ),
    365,
  );
  assert.equal(
    await scalar(
      db,
      "select budget_minutes from public.job_feed where id = $1",
      ["10000000-0000-0000-0000-000000000001"],
    ),
    634,
  );
  assert.equal(
    await scalar(
      db,
      "select budget_minutes from public.job_feed where id = $1",
      ["10000000-0000-0000-0000-000000000002"],
    ),
    420,
  );
  assert.equal(
    await scalar(
      db,
      "select budget_minutes from public.job_feed where id = $1",
      ["10000000-0000-0000-0000-000000000003"],
    ),
    500,
  );

  assert.equal(
    await scalar(
      db,
      "select count(*)::int from public.jobs job join public.job_feed feed on feed.id = job.id where job.contract_amount_cents > 0 and feed.budget_minutes is null",
    ),
    0,
  );

  await db.close();
});

test("recalculates formula budgets but preserves calculator hours", async () => {
  const db = await database();

  await db.exec(`
    insert into public.jobs (id, name, status, contract_amount_cents, source)
    values ('10000000-0000-0000-0000-000000000010', 'Formula updates', 'active', 100000, 'dripjobs');
  `);

  const migration = await readFile(migrationUrl, "utf8");
  await db.exec(migration);

  await db.query(
    "select public.save_job_budget($1, null, null, $2, null)",
    ["10000000-0000-0000-0000-000000000010", 200000],
  );
  assert.equal(
    await scalar(
      db,
      "select budget_minutes from public.job_feed where id = $1",
      ["10000000-0000-0000-0000-000000000010"],
    ),
    1269,
  );

  await db.query(
    "select public.save_job_budget($1, $2, null, null, null)",
    ["10000000-0000-0000-0000-000000000010", 777],
  );
  await db.query(
    "select public.save_job_budget($1, null, null, $2, null)",
    ["10000000-0000-0000-0000-000000000010", 300000],
  );

  assert.equal(
    await scalar(
      db,
      "select budget_minutes from public.job_feed where id = $1",
      ["10000000-0000-0000-0000-000000000010"],
    ),
    777,
  );
  assert.equal(
    await scalar(
      db,
      "select metadata->>'budget_minutes_source' from public.job_budgets where job_id = $1 and source = 'manual' and status = 'active'",
      ["10000000-0000-0000-0000-000000000010"],
    ),
    "explicit",
  );

  await db.close();
});

test("creates hours for app conversions and accepted DripJobs proposals", async () => {
  const db = await database();
  await db.exec(`
    insert into public.contacts (id, kind, name)
    values ('30000000-0000-0000-0000-000000000001', 'customer', 'App Contact');

    insert into public.leads (
      id, contact_id, status, normalized_channel, created_at, captured_at
    ) values (
      '30000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000001',
      'new',
      'unknown',
      now(),
      now()
    );

    insert into public.quotes (
      id, lead_id, name, status, amount_cents, source
    ) values (
      '30000000-0000-0000-0000-000000000003',
      '30000000-0000-0000-0000-000000000002',
      'App Quote',
      'accepted',
      123400,
      'app'
    );
  `);

  const migration = await readFile(migrationUrl, "utf8");
  await db.exec(migration);

  const conversion = await db.query(
    "select (public.convert_lead_to_job($1, $2, null, null)).id as id",
    [
      "30000000-0000-0000-0000-000000000002",
      "30000000-0000-0000-0000-000000000003",
    ],
  );
  const convertedJobId = conversion.rows[0].id;

  assert.equal(
    await scalar(
      db,
      "select budget_minutes from public.job_feed where id = $1",
      [convertedJobId],
    ),
    783,
  );

  const eventResult = await db.query(
    `select public.process_dripjobs_zapier_event(
      'proposal.accepted:test',
      'proposal.accepted',
      'proposal-test',
      now(),
      '{}'::jsonb,
      repeat('a', 64),
      $1::jsonb,
      false
    ) as result`,
    [
      JSON.stringify({
        deal_id: "deal-test",
        contact_uuid: "contact-test",
        contact_name: "DripJobs Contact",
        job_name: "DripJobs Job",
        amount: "900.00",
      }),
    ],
  );
  const event = eventResult.rows[0].result;
  assert.equal(event.ok, true);
  assert.equal(
    await scalar(
      db,
      "select budget_minutes from public.job_feed where id = $1",
      [event.job_id],
    ),
    571,
  );

  await db.close();
});
