import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260803200000_ingest_live_dripjobs_events.sql",
  import.meta.url,
);
const lifecycleMigrationUrl = new URL(
  "../supabase/migrations/20260804120000_unify_dripjobs_lead_lifecycle.sql",
  import.meta.url,
);
const lifecycleCorrectionMigrationUrl = new URL(
  "../supabase/migrations/20260804150000_correct_unconverted_lead_projection.sql",
  import.meta.url,
);

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key default gen_random_uuid());
    create function auth.uid() returns uuid language sql stable as $$
      select '00000000-0000-0000-0000-000000000001'::uuid
    $$;

    create table public.employee_profiles (
      user_id uuid primary key,
      is_active boolean not null default true
    );
    insert into public.employee_profiles (user_id)
    values ('00000000-0000-0000-0000-000000000001');

    create function public.set_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at = now(); return new; end $$;
    create function public.current_employee_role() returns text language sql stable as $$
      select 'admin'::text
    $$;
    create function public.get_project_budget_progress(requested_project_ids text[])
    returns table (
      companycam_project_id text,
      percent_used numeric,
      hours_used numeric,
      budget_status text,
      is_complete boolean,
      calculated_at timestamptz
    ) language sql stable as $$
      select null::text, null::numeric, null::numeric, null::text,
             null::boolean, null::timestamptz where false
    $$;

    create table public.companycam_projects (
      companycam_id text primary key,
      name text not null,
      street_address_1 text,
      street_address_2 text,
      city text,
      state text,
      postal_code text,
      country text,
      formatted_address text,
      latitude double precision,
      longitude double precision,
      is_archived boolean not null default false,
      companycam_created_at timestamptz,
      companycam_updated_at timestamptz,
      raw jsonb not null default '{}'::jsonb,
      last_synced_at timestamptz not null default now(),
      inserted_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      labels jsonb not null default '[]'::jsonb,
      is_lead boolean not null default false,
      companycam_status text,
      is_deleted boolean not null default false
    );

    create or replace function public.normalize_companycam_project_lead_flag()
    returns trigger
    language plpgsql
    set search_path = public
    as $$
    declare
      normalized_labels text[];
    begin
      select coalesce(array_agg(label_text), array[]::text[])
      into normalized_labels
      from (
        select nullif(
          trim(regexp_replace(lower(coalesce(
            label->>'value',
            label->>'display_value',
            label->>'name',
            label->>'title',
            label #>> '{}'
          )), '[^a-z0-9]+', ' ', 'g')),
          ''
        ) as label_text
        from jsonb_array_elements(coalesce(new.labels, '[]'::jsonb)) as label
      ) labels
      where label_text is not null;

      new.is_lead =
        ('lead' = any(normalized_labels) or 'leads' = any(normalized_labels))
        and not exists (
          select 1
          from unnest(normalized_labels) as label_text
          where label_text not in ('lead', 'leads')
        );

      return new;
    end;
    $$;

    create trigger normalize_companycam_project_lead_flag_before_write
    before insert or update of labels, is_lead
    on public.companycam_projects
    for each row execute function public.normalize_companycam_project_lead_flag();

    create table public.project_calculators (
      companycam_project_id text primary key
        references public.companycam_projects(companycam_id),
      doc jsonb not null,
      updated_by uuid references auth.users(id),
      updated_at timestamptz not null default now()
    );

    create table public.marketing_leads (
      deal_id text primary key,
      created_on date not null,
      created_at_local timestamp without time zone,
      created_at_precision text not null default 'date',
      contact_name text,
      email text,
      phone text,
      raw_lead_source text,
      normalized_channel text not null default 'unknown',
      address text,
      postal_code text,
      estimate_scheduled_on date,
      estimate_appointment_on date,
      proposal_number text,
      proposal_amount numeric(14,2),
      proposal_on date,
      job_crew text,
      is_interior boolean not null default false,
      is_exterior boolean not null default false,
      is_cabinets boolean not null default false,
      source_system text not null default 'google_sheets_dripjobs_export',
      source_filename text not null,
      source_spreadsheet_id text not null,
      source_sheet_name text not null,
      source_row_number integer not null,
      source_sha256 text not null,
      source_payload jsonb not null default '{}'::jsonb,
      captured_at timestamptz not null,
      inserted_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint marketing_leads_source_row_check check (source_row_number > 1),
      constraint marketing_leads_source_hash_check check (source_sha256 ~ '^[0-9a-f]{64}$')
    );

    create table public.dripjobs_jobs (
      proposal_id text primary key,
      source_crm_record_id uuid not null,
      invoice_id text,
      job_name text not null,
      contact_name text,
      email text,
      phone text,
      status text not null,
      label text,
      deal_stage text,
      salesperson text,
      amount numeric(14,2) not null default 0,
      invoice_status text,
      paid_amount numeric(14,2) not null default 0,
      balance_amount numeric(14,2) not null default 0,
      proposal_signed_on date,
      job_start_on date,
      job_scheduled_on date,
      job_completion_on date,
      lead_resolution_status text not null default 'needs_review',
      lead_resolution_note text,
      lead_resolved_at timestamptz,
      source_filename text not null,
      source_sha256 text not null,
      source_row_number integer not null,
      source_payload jsonb not null default '{}'::jsonb,
      captured_at timestamptz not null,
      inserted_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint dripjobs_jobs_source_row_check check (source_row_number > 1),
      constraint dripjobs_jobs_source_hash_check check (source_sha256 ~ '^[0-9a-f]{64}$')
    );

    create table public.marketing_lead_job_links (
      id uuid primary key default gen_random_uuid(),
      lead_deal_id text not null references public.marketing_leads(deal_id),
      job_proposal_id text not null references public.dripjobs_jobs(proposal_id),
      relationship_type text not null default 'originated',
      link_status text not null default 'suggested',
      match_method text not null,
      confidence numeric(4,3) not null,
      evidence jsonb not null default '{}'::jsonb,
      review_note text,
      confirmed_at timestamptz,
      confirmed_by uuid references auth.users(id),
      inserted_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint marketing_lead_job_links_pair_unique unique (lead_deal_id, job_proposal_id),
      constraint marketing_lead_job_links_method_check check (
        match_method in ('proposal_number','dripjobs_contact_uuid','email_and_phone','email','phone','manual')
      )
    );
    create unique index marketing_lead_job_links_one_origin_idx
      on public.marketing_lead_job_links(job_proposal_id)
      where relationship_type = 'originated' and link_status = 'confirmed';

    create table public.marketing_lead_project_links (
      id uuid primary key default gen_random_uuid(),
      lead_deal_id text not null references public.marketing_leads(deal_id),
      companycam_project_id text not null references public.companycam_projects(companycam_id),
      relationship_type text not null default 'originated',
      link_status text not null default 'suggested',
      match_method text not null,
      confidence numeric(4,3) not null,
      evidence jsonb not null default '{}'::jsonb,
      review_note text,
      confirmed_at timestamptz,
      confirmed_by uuid references auth.users(id),
      inserted_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (lead_deal_id, companycam_project_id)
    );

    create table public.job_project_links (
      id uuid primary key default gen_random_uuid(),
      job_proposal_id text not null references public.dripjobs_jobs(proposal_id),
      companycam_project_id text not null references public.companycam_projects(companycam_id),
      link_role text not null default 'supporting',
      link_status text not null default 'suggested',
      match_method text not null,
      confidence numeric(4,3) not null,
      evidence jsonb not null default '{}'::jsonb,
      review_note text,
      confirmed_at timestamptz,
      confirmed_by uuid references auth.users(id),
      inserted_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint job_project_links_pair_unique unique (job_proposal_id, companycam_project_id)
    );
    create unique index job_project_links_one_canonical_idx
      on public.job_project_links(job_proposal_id)
      where link_role = 'canonical' and link_status = 'confirmed';
  `);
  await db.exec(`
    insert into public.marketing_leads (
      deal_id, created_on, contact_name, raw_lead_source, normalized_channel,
      source_filename, source_spreadsheet_id, source_sheet_name,
      source_row_number, source_sha256, captured_at
    ) values (
      'historical-deal', '2026-08-01', 'Historical Name', 'Google',
      'organic_search', 'all-leads.csv', 'sheet-1', 'All Leads', 2,
      repeat('b', 64), '2026-08-02T13:04:11Z'
    );
    insert into public.dripjobs_jobs (
      proposal_id, source_crm_record_id, job_name, status, amount,
      lead_resolution_status, lead_resolved_at, source_filename,
      source_sha256, source_row_number, captured_at
    ) values (
      'historical-proposal', gen_random_uuid(), 'Historical Job', 'Complete',
      1000, 'confirmed', now(), 'jobs.xlsx', repeat('c', 64), 2,
      '2026-08-02T13:04:11Z'
    );
    insert into public.marketing_lead_job_links (
      lead_deal_id, job_proposal_id, relationship_type, link_status,
      match_method, confidence, confirmed_at
    ) values (
      'historical-deal', 'historical-proposal', 'originated', 'confirmed',
      'proposal_number', 1, now()
    );
    insert into public.companycam_projects (companycam_id, name)
    values
      ('existing-companycam-project', 'Existing CompanyCam Project'),
      ('evidence-companycam-project', 'Evidence CompanyCam Project');
    insert into public.job_project_links (
      job_proposal_id, companycam_project_id, link_role, link_status,
      match_method, confidence, confirmed_at
    ) values (
      'historical-proposal', 'existing-companycam-project', 'canonical',
      'confirmed', 'manual', 1, now()
    );

    insert into public.marketing_leads (
      deal_id, created_on, contact_name, raw_lead_source, normalized_channel,
      source_filename, source_spreadsheet_id, source_sheet_name,
      source_row_number, source_sha256, captured_at
    ) values (
      'evidence-only-deal', '2026-08-01', 'Evidence-only Lead', 'Referral',
      'referral', 'all-leads.csv', 'sheet-1', 'All Leads', 3,
      repeat('d', 64), '2026-08-02T13:04:11Z'
    );
    insert into public.marketing_lead_project_links (
      lead_deal_id, companycam_project_id, relationship_type, link_status,
      match_method, confidence, confirmed_at
    ) values (
      'evidence-only-deal', 'evidence-companycam-project', 'originated',
      'confirmed', 'manual', 1, now()
    );
    insert into public.project_calculators (
      companycam_project_id, doc, updated_at
    ) values (
      'evidence-companycam-project', '{"rooms": [{"name": "Kitchen"}]}'::jsonb,
      '2026-08-02T13:04:11Z'
    );
  `);
  await db.exec(await readFile(migrationUrl, "utf8"));
  await db.exec(await readFile(lifecycleMigrationUrl, "utf8"));
  await db.exec(await readFile(lifecycleCorrectionMigrationUrl, "utf8"));
  return db;
}

const hash = "a".repeat(64);

async function processEvent(db, values) {
  const result = await db.query(
    `select public.process_dripjobs_zapier_event($1,$2,$3,$4,$5,$6,$7,$8) as result`,
    [
      values.eventKey,
      values.eventType,
      values.entityId,
      values.occurredAt,
      JSON.stringify(values.payload ?? values.data),
      hash,
      JSON.stringify(values.data),
      values.isTest ?? false,
    ],
  );
  return result.rows[0].result;
}

test("live DripJobs events continue the export without rewriting it", async () => {
  const db = await database();

  const correctedEvidenceLead = await db.query(
    `select lead.operational_project_id, project.is_lead,
            project.raw ->> 'source' as source,
            calculator.doc,
            evidence_calculator.doc as evidence_doc
     from public.marketing_leads lead
     join public.companycam_projects project
       on project.companycam_id = lead.operational_project_id
     join public.project_calculators calculator
       on calculator.companycam_project_id = lead.operational_project_id
     join public.project_calculators evidence_calculator
       on evidence_calculator.companycam_project_id = 'evidence-companycam-project'
     where lead.deal_id = 'evidence-only-deal'`,
  );
  assert.deepEqual(correctedEvidenceLead.rows[0], {
    operational_project_id: "dripjobs-deal-evidence-only-deal",
    is_lead: true,
    source: "dripjobs_lifecycle_projection",
    doc: { rooms: [{ name: "Kitchen" }] },
    evidence_doc: { rooms: [{ name: "Kitchen" }] },
  });
  const preservedEvidenceProject = await db.query(
    `select is_job_feed_visible,
            raw ->> 'supporting_evidence_for' as supporting_evidence_for
     from public.companycam_projects
     where companycam_id = 'evidence-companycam-project'`,
  );
  assert.deepEqual(preservedEvidenceProject.rows[0], {
    is_job_feed_visible: false,
    supporting_evidence_for: "dripjobs-deal-evidence-only-deal",
  });

  const overlap = {
    eventKey: "lead.created:historical-deal",
    eventType: "lead.created",
    entityId: "historical-deal",
    occurredAt: "2026-08-01T14:00:00Z",
    data: {
      deal_id: "historical-deal",
      created_at: "2026-08-01T14:00:00Z",
      contact_name: "Should Not Replace Historical Name",
      lead_source: "Meta-Perspective",
      email: "filled@example.com",
    },
  };
  assert.equal((await processEvent(db, overlap)).status, "processed");
  assert.equal((await processEvent(db, overlap)).status, "duplicate");

  const preserved = await db.query(
    `select contact_name, raw_lead_source, normalized_channel, email,
            source_filename, source_row_number, first_live_event_id
     from public.marketing_leads where deal_id = 'historical-deal'`,
  );
  assert.equal(preserved.rows[0].contact_name, "Historical Name");
  assert.equal(preserved.rows[0].raw_lead_source, "Google");
  assert.equal(preserved.rows[0].normalized_channel, "organic_search");
  assert.equal(preserved.rows[0].email, "filled@example.com");
  assert.equal(preserved.rows[0].source_filename, "all-leads.csv");
  assert.equal(preserved.rows[0].source_row_number, 2);
  assert.ok(preserved.rows[0].first_live_event_id);

  const newLead = {
    eventKey: "lead.created:new-deal",
    eventType: "lead.created",
    entityId: "new-deal",
    occurredAt: "2026-08-03T15:30:00Z",
    data: {
      deal_id: "new-deal",
      created_at: "2026-08-03T15:30:00Z",
      contact_name: "New Lead",
      lead_source: "Meta-Perspective",
      address: "123 Test Street, Ottawa, ON",
      postal_code: "K1A 0B1",
    },
  };
  assert.equal((await processEvent(db, newLead)).status, "processed");

  const liveLead = await db.query(
    `select source_system, source_filename, source_row_number, normalized_channel,
            operational_project_id
     from public.marketing_leads where deal_id = 'new-deal'`,
  );
  assert.deepEqual(liveLead.rows[0], {
    source_system: "dripjobs_zapier",
    source_filename: null,
    source_row_number: null,
    normalized_channel: "paid_social",
    operational_project_id: "dripjobs-deal-new-deal",
  });
  const leadProjection = await db.query(
    `select is_lead, is_job_feed_visible, raw ->> 'source' as source
     from public.companycam_projects
     where companycam_id = 'dripjobs-deal-new-deal'`,
  );
  assert.deepEqual(leadProjection.rows[0], {
    is_lead: true,
    is_job_feed_visible: true,
    source: "dripjobs_lifecycle_projection",
  });

  assert.equal((await processEvent(db, {
    ...newLead,
    eventKey: "lead.created:test-deal:test:fixture",
    entityId: "test-deal",
    data: { ...newLead.data, deal_id: "test-deal" },
    isTest: true,
  })).status, "ignored");
  const testLead = await db.query(
    `select count(*)::int as count from public.marketing_leads where deal_id = 'test-deal'`,
  );
  assert.equal(testLead.rows[0].count, 0);

  assert.equal((await processEvent(db, {
    eventKey: "proposal.accepted:historical-proposal",
    eventType: "proposal.accepted",
    entityId: "historical-proposal",
    occurredAt: "2026-08-03T16:00:00Z",
    data: {
      proposal_id: "historical-proposal",
      deal_id: "new-deal",
      accepted_at: "2026-08-03T16:00:00Z",
      job_name: "Do Not Replace Historical Job",
      amount: 2000,
    },
  })).status, "processed");
  const historicalJob = await db.query(
    `select job_name, status, amount, originating_deal_id from public.dripjobs_jobs
     where proposal_id = 'historical-proposal'`,
  );
  assert.deepEqual(historicalJob.rows[0], {
    job_name: "Historical Job",
    status: "Complete",
    amount: "1000.00",
    originating_deal_id: "historical-deal",
  });
  const historicalLink = await db.query(
    `select lead_deal_id from public.marketing_lead_job_links
     where job_proposal_id = 'historical-proposal' and link_status = 'confirmed'`,
  );
  assert.equal(historicalLink.rows[0].lead_deal_id, "historical-deal");

  assert.equal((await processEvent(db, {
    eventKey: "proposal.accepted:new-proposal",
    eventType: "proposal.accepted",
    entityId: "new-proposal",
    occurredAt: "2026-08-03T17:00:00Z",
    data: {
      proposal_id: "new-proposal",
      deal_id: "new-deal",
      accepted_at: "2026-08-03T17:00:00Z",
      job_name: "New Job",
      amount: 2500,
      address: "123 Test Street, Ottawa, ON",
      street_address_1: "123 Test Street",
      city: "Ottawa",
      state: "ON",
      postal_code: "K1A 0B1",
    },
  })).status, "processed");
  const newJob = await db.query(
    `select lead_resolution_status, originating_deal_id
     from public.dripjobs_jobs where proposal_id = 'new-proposal'`,
  );
  assert.deepEqual(newJob.rows[0], {
    lead_resolution_status: "confirmed",
    originating_deal_id: "new-deal",
  });
  const newLink = await db.query(
    `select match_method, confidence from public.marketing_lead_job_links
     where job_proposal_id = 'new-proposal'`,
  );
  assert.equal(newLink.rows[0].match_method, "dripjobs_deal_id");
  assert.equal(Number(newLink.rows[0].confidence), 1);
  const projectLinks = await db.query(
    `select job_proposal_id, companycam_project_id from public.job_project_links
     order by job_proposal_id`,
  );
  assert.deepEqual(projectLinks.rows, [
    {
      job_proposal_id: "historical-proposal",
      companycam_project_id: "existing-companycam-project",
    },
    {
      job_proposal_id: "new-proposal",
      companycam_project_id: "dripjobs-deal-new-deal",
    },
  ]);
  const operationalProjection = await db.query(
    `select operational_job_proposal_id, is_job_feed_visible, is_lead,
            raw ->> 'source' as source
     from public.companycam_projects
     where companycam_id = 'dripjobs-deal-new-deal'`,
  );
  assert.deepEqual(operationalProjection.rows[0], {
    operational_job_proposal_id: "new-proposal",
    is_job_feed_visible: true,
    is_lead: false,
    source: "dripjobs_lifecycle_projection",
  });
  const supersededProjection = await db.query(
    `select operational_job_proposal_id, is_job_feed_visible, is_archived,
            raw ->> 'superseded_by' as superseded_by
     from public.companycam_projects
     where companycam_id = 'dripjobs-new-proposal'`,
  );
  assert.deepEqual(supersededProjection.rows[0], {
    operational_job_proposal_id: null,
    is_job_feed_visible: false,
    is_archived: true,
    superseded_by: "dripjobs-deal-new-deal",
  });
  await db.exec(`
    insert into public.companycam_projects (companycam_id, name)
    values ('future-companycam-only', 'Future CompanyCam Only');
  `);
  const feed = await db.query(
    `select companycam_id from public.list_project_feed(0, 20, '', null)
     order by companycam_id`,
  );
  assert.deepEqual(feed.rows, [
    { companycam_id: "dripjobs-deal-new-deal" },
    { companycam_id: "existing-companycam-project" },
  ]);

  await processEvent(db, {
    eventKey: "proposal.accepted:unresolved-proposal",
    eventType: "proposal.accepted",
    entityId: "unresolved-proposal",
    occurredAt: "2026-08-03T18:00:00Z",
    data: {
      proposal_id: "unresolved-proposal",
      deal_id: "unknown-deal",
      accepted_at: "2026-08-03T18:00:00Z",
      job_name: "Needs Review",
      amount: 100,
    },
  });
  const unresolved = await db.query(
    `select lead_resolution_status from public.dripjobs_jobs
     where proposal_id = 'unresolved-proposal'`,
  );
  assert.equal(unresolved.rows[0].lead_resolution_status, "needs_review");

  await processEvent(db, {
    eventKey: "lead.created:unknown-deal",
    eventType: "lead.created",
    entityId: "unknown-deal",
    occurredAt: "2026-08-03T18:30:00Z",
    data: {
      deal_id: "unknown-deal",
      created_at: "2026-08-03T18:30:00Z",
      contact_name: "Late Lead",
      lead_source: "Phone Call",
    },
  });
  const repaired = await db.query(
    `select job.lead_resolution_status, lead.operational_project_id,
            project.operational_job_proposal_id, project.is_lead
     from public.dripjobs_jobs job
     join public.marketing_leads lead
       on lead.deal_id = job.originating_deal_id
     join public.companycam_projects project
       on project.companycam_id = lead.operational_project_id
     where job.proposal_id = 'unresolved-proposal'`,
  );
  assert.deepEqual(repaired.rows[0], {
    lead_resolution_status: "confirmed",
    operational_project_id: "dripjobs-deal-unknown-deal",
    operational_job_proposal_id: "unresolved-proposal",
    is_lead: false,
  });

  const health = await db.query(`select * from public.read_dripjobs_sync_health()`);
  assert.equal(Number(health.rows[0].duplicate_deliveries), 1);
  assert.equal(Number(health.rows[0].failed_events), 0);

  await db.close();
});
