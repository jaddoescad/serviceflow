import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL("../supabase/migrations/20260818205533_enable_lead_clock_in.sql", import.meta.url),
  "utf8",
);
const db = new PGlite();

await db.exec(`
  create role anon;
  create role authenticated;
  create schema auth;
  create schema private;
  create schema extensions;

  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create function extensions.gen_random_uuid() returns uuid language sql volatile as $$
    select gen_random_uuid()
  $$;

  create table public.employees (
    id uuid primary key,
    role text not null,
    is_active boolean not null default true
  );
  create table public.contacts (
    id uuid primary key,
    name text not null
  );
  create table public.leads (
    id uuid primary key,
    contact_id uuid not null references public.contacts(id),
    status text not null,
    address text,
    city text,
    province text,
    postal_code text,
    updated_at timestamptz not null default now()
  );
  create table public.quotes (
    id uuid primary key,
    lead_id uuid not null references public.leads(id),
    name text not null,
    status text not null,
    amount_cents bigint not null default 0,
    accepted_at timestamptz,
    updated_at timestamptz not null default now()
  );
  create table public.jobs (
    id uuid primary key,
    contact_id uuid,
    lead_id uuid,
    accepted_quote_id uuid unique,
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
    companycam_project_ids text[] not null default '{}',
    scheduled_on date,
    started_on date,
    completed_on date,
    archived_at timestamptz,
    is_feed_visible boolean not null default true,
    source text not null,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    production_month date
  );

  create function private.is_manager() returns boolean language sql stable as $$
    select exists (
      select 1 from public.employees employee
      where employee.id = auth.uid()
        and employee.is_active
        and employee.role in ('admin', 'manager')
    )
  $$;
  create function private.ensure_default_job_budget(uuid, bigint)
  returns void language sql as $$ select $$;
`);

await db.exec(migration);

const actorId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const contactId = "11111111-2222-4333-8444-555555555555";
const leadId = "22222222-3333-4444-8555-666666666666";
const quoteId = "33333333-4444-4555-8666-777777777777";

await db.query(
  `insert into public.employees (id, role) values ($1, 'manager')`,
  [actorId],
);
await db.query(
  `insert into public.contacts (id, name) values ($1, 'Jad Slim')`,
  [contactId],
);
await db.query(
  `insert into public.leads
    (id, contact_id, status, address, city, province, postal_code)
   values ($1, $2, 'new', '123 Test St', 'Ottawa', 'ON', 'K1A 0B1')`,
  [leadId, contactId],
);
await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [actorId]);

const first = await db.query(
  `select id, lead_id, accepted_quote_id, status, contract_amount_cents, started_on
   from public.ensure_lead_clock_in_job($1)`,
  [leadId],
);
assert.equal(first.rows.length, 1);
assert.equal(first.rows[0].lead_id, leadId);
assert.equal(first.rows[0].accepted_quote_id, null);
assert.equal(first.rows[0].status, "active");
assert.equal(Number(first.rows[0].contract_amount_cents), 0);
assert.ok(first.rows[0].started_on);

const second = await db.query(
  `select id from public.ensure_lead_clock_in_job($1)`,
  [leadId],
);
assert.equal(second.rows[0].id, first.rows[0].id, "repeat clock-ins must reuse one job");

await db.query(
  `insert into public.quotes (id, lead_id, name, status, amount_cents)
   values ($1, $2, 'Interior repaint', 'sent', 425000)`,
  [quoteId, leadId],
);
const converted = await db.query(
  `select id, accepted_quote_id, contract_amount_cents, status
   from public.convert_lead_to_job($1, $2, null, null)`,
  [leadId, quoteId],
);
assert.equal(converted.rows[0].id, first.rows[0].id, "accepted quote must attach to the started job");
assert.equal(converted.rows[0].accepted_quote_id, quoteId);
assert.equal(Number(converted.rows[0].contract_amount_cents), 425000);
assert.equal(converted.rows[0].status, "active");

const state = await db.query(
  `select
     (select status from public.leads where id = $1) as lead_status,
     (select status from public.quotes where id = $2) as quote_status,
     (select count(*)::integer from public.jobs where lead_id = $1) as job_count`,
  [leadId, quoteId],
);
assert.deepEqual(state.rows[0], {
  lead_status: "won",
  quote_status: "accepted",
  job_count: 1,
});

const permissions = await db.query(`
  select
    has_function_privilege('anon', 'public.ensure_lead_clock_in_job(uuid)', 'execute') as anon_can_execute,
    has_function_privilege('authenticated', 'public.ensure_lead_clock_in_job(uuid)', 'execute') as staff_can_execute
`);
assert.deepEqual(permissions.rows[0], {
  anon_can_execute: false,
  staff_can_execute: true,
});

console.log(
  "Lead clock-in migration QA passed: active employees can start one pre-quote job and later quote acceptance reuses it.",
);
