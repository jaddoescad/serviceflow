#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildDripJobsProjectIdentity } from "./lib/dripjobs-job-identity.mjs";
import {
  EXCLUDED_TEST_INVOICE_IDS,
  EXCLUDED_TEST_JOBS,
  EXCLUDED_TEST_PROPOSAL_IDS,
} from "./lib/dripjobs-job-reconciliation.mjs";

const APPLY = process.argv.includes("--apply");
const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const SOURCE_SYSTEM = "dripjobs";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const exportRoot = path.resolve(repoRoot, "tmp/dripjobs-export/2026-07-31");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let page = 0; page < 100; page += 1) {
    const from = page * pageSize;
    const result = await queryFactory().range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Pagination exceeded 100,000 rows.");
}

function chunks(values, size = 150) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function assertNoError(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

function sourceObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function money(value) {
  return Number(Number(value ?? 0).toFixed(2));
}

function addressFields(address) {
  const parts = String(address ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const provinceIndex = parts.findIndex((value) => /^(ON|Ontario)$/i.test(value));
  const postalIndex = parts.findIndex((value) =>
    /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test(value),
  );
  return {
    street_address_1: parts.length >= 2 ? parts[0] : null,
    street_address_2: null,
    city:
      provinceIndex > 0
        ? parts[provinceIndex - 1]
        : parts.length >= 2
          ? parts[1]
          : parts[0] || null,
    state: provinceIndex >= 0 ? "ON" : null,
    postal_code: postalIndex >= 0 ? parts[postalIndex].toUpperCase() : null,
    country: "CA",
  };
}

function projectName(job) {
  const suffix = job.archived ? " (completed)" : "";
  return `${job.job_name || job.customer_name || "DripJobs job"} — proposal ${
    job.proposal_id
  }${suffix}`;
}

function evidenceNote(invoice) {
  return `DripJobs physical invoice #${invoice.invoice_number} is the job-value source: $${money(
    invoice.subtotal,
  ).toFixed(2)} before HST, $${money(invoice.sales_tax).toFixed(
    2,
  )} HST, $${money(invoice.total).toFixed(2)} total.`;
}

function appendEvidenceNote(existing, note) {
  const current = String(existing ?? "").trim();
  if (current.includes(note)) return current;
  return current ? `${current}\n${note}` : note;
}

const jobsArchive = JSON.parse(
  readFileSync(path.resolve(exportRoot, "jobs.normalized.json"), "utf8"),
);
const archivedJobs = jobsArchive.jobs ?? [];
const archivedInvoices = JSON.parse(
  readFileSync(
    path.resolve(exportRoot, "customer-invoices/invoices.normalized.json"),
    "utf8",
  ),
);

if (archivedJobs.length !== 186 || archivedInvoices.length !== 184) {
  throw new Error(
    `Expected the verified export of 186 jobs and 184 invoices; found ${archivedJobs.length} and ${archivedInvoices.length}.`,
  );
}
const jobs = archivedJobs.filter(
  (job) => !EXCLUDED_TEST_PROPOSAL_IDS.has(String(job.proposal_id)),
);
const invoices = archivedInvoices.filter(
  (invoice) =>
    !EXCLUDED_TEST_PROPOSAL_IDS.has(String(invoice.proposal_id)) &&
    !EXCLUDED_TEST_INVOICE_IDS.has(String(invoice.invoice_uuid)),
);

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl =
  env.SUPABASE_URL ||
  env.NEXT_PUBLIC_SUPABASE_URL ||
  env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== TARGET_PROJECT_REF) {
  throw new Error(`Refusing write for unexpected project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [projects, storedInvoicesAll, budgets] = await Promise.all([
  fetchAll(() => db.from("companycam_projects").select("*")),
  fetchAll(() =>
    db
      .from("customer_invoices")
      .select(
        "id,source_system,external_invoice_id,invoice_number,companycam_project_id,external_proposal_id,external_proposal_uuid,subtotal,tax_amount,total_amount",
      )
      .eq("source_system", SOURCE_SYSTEM),
  ),
  fetchAll(() =>
    db
      .from("project_budgets")
      .select(
        "companycam_project_id,amount_including_tax,budgeted_hours,hourly_rate,labour_allocation_percent,labour_closed_at,labour_invoice_job_started_on,notes",
      ),
  ),
]);
const storedInvoices = storedInvoicesAll.filter(
  (invoice) =>
    !EXCLUDED_TEST_PROPOSAL_IDS.has(String(invoice.external_proposal_id)) &&
    !EXCLUDED_TEST_INVOICE_IDS.has(String(invoice.external_invoice_id)),
);

const projectsById = new Map(
  projects.map((project) => [String(project.companycam_id), project]),
);
const { projectIdByProposal, collisions } = buildDripJobsProjectIdentity(
  jobs,
  new Set(projectsById.keys()),
);
const jobsByProposal = new Map(jobs.map((job) => [job.proposal_uuid, job]));
const invoicesByExternalId = new Map(
  invoices.map((invoice) => [invoice.invoice_uuid, invoice]),
);
const storedByExternalId = new Map(
  storedInvoices.map((invoice) => [invoice.external_invoice_id, invoice]),
);
const budgetsByProject = new Map(
  budgets.map((budget) => [budget.companycam_project_id, budget]),
);

if (storedByExternalId.size !== invoices.length) {
  throw new Error(
    `Stored DripJobs invoice set is incomplete: ${storedByExternalId.size} of ${invoices.length}.`,
  );
}

const invoiceCorrections = [];
const expectedBudgetByProject = new Map();
for (const invoice of invoices) {
  const stored = storedByExternalId.get(invoice.invoice_uuid);
  const targetProjectId = projectIdByProposal.get(invoice.proposal_uuid);
  if (!stored || !targetProjectId || !jobsByProposal.has(invoice.proposal_uuid)) {
    throw new Error(`Incomplete source chain for invoice ${invoice.invoice_number}.`);
  }
  if (
    stored.external_proposal_uuid !== invoice.proposal_uuid ||
    String(stored.external_proposal_id) !== String(invoice.proposal_id) ||
    String(stored.invoice_number) !== String(invoice.invoice_number) ||
    cents(stored.subtotal) !== cents(invoice.subtotal) ||
    cents(stored.tax_amount) !== cents(invoice.sales_tax) ||
    cents(stored.total_amount) !== cents(invoice.total)
  ) {
    throw new Error(`Stored values differ from physical invoice #${invoice.invoice_number}.`);
  }
  if (stored.companycam_project_id !== targetProjectId) {
    invoiceCorrections.push({
      id: stored.id,
      invoice_number: stored.invoice_number,
      proposal_id: String(invoice.proposal_id),
      from_project_id: stored.companycam_project_id,
      to_project_id: targetProjectId,
    });
  }
  if (expectedBudgetByProject.has(targetProjectId)) {
    throw new Error(
      `Project ${targetProjectId} has multiple physical invoices; define revision semantics before summing them.`,
    );
  }
  expectedBudgetByProject.set(targetProjectId, invoice);
}

const placeholderRows = jobs
  .filter((job) => projectIdByProposal.get(job.proposal_uuid).startsWith("dripjobs-"))
  .map((job) => {
    const projectId = projectIdByProposal.get(job.proposal_uuid);
    const existing = projectsById.get(projectId);
    const parsedAddress = addressFields(job.address);
    return {
      ...(existing ?? {}),
      companycam_id: projectId,
      name: projectName(job),
      street_address_1: existing?.street_address_1 ?? parsedAddress.street_address_1,
      street_address_2: existing?.street_address_2 ?? parsedAddress.street_address_2,
      city: existing?.city ?? parsedAddress.city,
      state: existing?.state ?? parsedAddress.state,
      postal_code: existing?.postal_code ?? parsedAddress.postal_code,
      country: existing?.country ?? parsedAddress.country,
      formatted_address: job.address || existing?.formatted_address || null,
      is_archived: Boolean(job.archived),
      companycam_created_at: existing?.companycam_created_at ?? null,
      companycam_updated_at: existing?.companycam_updated_at ?? null,
      raw: {
        ...sourceObject(existing?.raw),
        source: "dripjobs_accounting_job",
        dripjobs: job,
        companycam_support: job.companycam_project_id
          ? {
              project_id: String(job.companycam_project_id),
              project_name: job.companycam_project_name || null,
            }
          : null,
      },
      last_synced_at: new Date().toISOString(),
      inserted_at: existing?.inserted_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
      labels:
        Array.isArray(existing?.labels) && existing.labels.length > 0
          ? existing.labels
          : [{ name: "DripJobs accounting job" }],
      is_lead: false,
      companycam_status: job.archived
        ? "dripjobs_completed"
        : "dripjobs_job",
      is_deleted: false,
    };
  });

const budgetWrites = [];
for (const [projectId, invoice] of expectedBudgetByProject) {
  const existing = budgetsByProject.get(projectId);
  const expectedAmount = money(invoice.subtotal);
  if (
    existing &&
    cents(existing.amount_including_tax) === cents(expectedAmount) &&
    String(existing.notes ?? "").includes(evidenceNote(invoice))
  ) {
    continue;
  }
  budgetWrites.push({
    companycam_project_id: projectId,
    amount_including_tax: expectedAmount,
    notes: appendEvidenceNote(existing?.notes, evidenceNote(invoice)),
    updated_at: new Date().toISOString(),
    change: existing
      ? cents(existing.amount_including_tax) === cents(expectedAmount)
        ? "evidence_note"
        : "correct_pre_hst_amount"
      : "create_from_invoice",
    before: existing?.amount_including_tax == null
      ? null
      : money(existing.amount_including_tax),
    invoice_number: String(invoice.invoice_number),
  });
}

const plan = {
  project_ref: projectRef,
  mode: APPLY ? "apply" : "dry-run",
  source: {
    archived_jobs: archivedJobs.length,
    archived_physical_customer_invoices: archivedInvoices.length,
    excluded_owner_confirmed_tests: EXCLUDED_TEST_JOBS.length,
    jobs: jobs.length,
    physical_customer_invoices: invoices.length,
    stored_customer_invoices: storedInvoices.length,
  },
  identity: {
    distinct_job_ids: new Set(projectIdByProposal.values()).size,
    companycam_reuse_collisions: collisions,
    placeholder_jobs: placeholderRows.length,
    placeholder_rows_to_create: placeholderRows.filter(
      (row) => !projectsById.has(row.companycam_id),
    ).length,
    customer_invoice_links_to_correct: invoiceCorrections,
  },
  job_values: {
    source_rule: "physical DripJobs invoice subtotal before HST",
    budgets_examined: expectedBudgetByProject.size,
    budgets_to_create: budgetWrites.filter(
      (row) => row.change === "create_from_invoice",
    ).length,
    pre_hst_amounts_to_correct: budgetWrites.filter(
      (row) => row.change === "correct_pre_hst_amount",
    ).length,
    evidence_notes_to_add: budgetWrites.filter(
      (row) => row.change === "evidence_note",
    ).length,
    sample_changes: budgetWrites.slice(0, 20).map((row) => ({
      project_id: row.companycam_project_id,
      invoice_number: row.invoice_number,
      change: row.change,
      before: row.before,
      after: row.amount_including_tax,
    })),
  },
};

console.log(JSON.stringify(plan, null, 2));
if (!APPLY) {
  console.log("\nDry run only. Re-run with --apply to write this verified plan.");
  process.exit(0);
}

for (const batch of chunks(placeholderRows)) {
  assertNoError(
    "DripJobs accounting project upsert",
    await db.from("companycam_projects").upsert(batch, {
      onConflict: "companycam_id",
    }),
  );
}

for (const correction of invoiceCorrections) {
  assertNoError(
    `invoice #${correction.invoice_number} job correction`,
    await db
      .from("customer_invoices")
      .update({
        companycam_project_id: correction.to_project_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", correction.id),
  );
}

for (const batch of chunks(
  budgetWrites.map(({ change, before, invoice_number, ...row }) => row),
)) {
  assertNoError(
    "DripJobs invoice job-value upsert",
    await db.from("project_budgets").upsert(batch, {
      onConflict: "companycam_project_id",
    }),
  );
}

const [verifiedInvoicesAll, verifiedBudgets, verifiedProjects] = await Promise.all([
  fetchAll(() =>
    db
      .from("customer_invoices")
      .select(
        "external_invoice_id,external_proposal_uuid,companycam_project_id,subtotal,tax_amount,total_amount",
      )
      .eq("source_system", SOURCE_SYSTEM),
  ),
  fetchAll(() =>
    db
      .from("project_budgets")
      .select("companycam_project_id,amount_including_tax,notes"),
  ),
  fetchAll(() => db.from("companycam_projects").select("companycam_id")),
]);
const verifiedInvoices = verifiedInvoicesAll.filter(
  (invoice) =>
    !EXCLUDED_TEST_INVOICE_IDS.has(String(invoice.external_invoice_id)),
);
const verifiedBudgetByProject = new Map(
  verifiedBudgets.map((budget) => [budget.companycam_project_id, budget]),
);
const verifiedProjectIds = new Set(
  verifiedProjects.map((project) => project.companycam_id),
);
const failures = [];
for (const stored of verifiedInvoices) {
  const source = invoicesByExternalId.get(stored.external_invoice_id);
  const targetProjectId = projectIdByProposal.get(stored.external_proposal_uuid);
  const budget = verifiedBudgetByProject.get(targetProjectId);
  if (
    !source ||
    stored.companycam_project_id !== targetProjectId ||
    !verifiedProjectIds.has(targetProjectId) ||
    !budget ||
    cents(budget.amount_including_tax) !== cents(source.subtotal) ||
    !String(budget.notes ?? "").includes(evidenceNote(source))
  ) {
    failures.push({
      invoice: stored.external_invoice_id,
      expected_project: targetProjectId,
      actual_project: stored.companycam_project_id,
      expected_subtotal: source?.subtotal ?? null,
      actual_budget: budget?.amount_including_tax ?? null,
    });
  }
}
if (failures.length > 0) {
  throw new Error(`Post-write verification failed: ${JSON.stringify(failures)}`);
}

const checkedProposalIds = ["2390920", "2523918", "2370863", "3006955"];
const checkedIdentities = jobs
  .filter((job) => checkedProposalIds.includes(String(job.proposal_id)))
  .map((job) => ({
    proposal_id: String(job.proposal_id),
    accounting_project_id: projectIdByProposal.get(job.proposal_uuid),
  }));

console.log(
  JSON.stringify(
    {
      applied: true,
      verified: {
        jobs: jobs.length,
        invoices: verifiedInvoices.length,
        invoice_job_failures: failures.length,
        invoice_budget_failures: failures.length,
        source_rule: "physical DripJobs invoice subtotal before HST",
        repeated_job_examples: checkedIdentities,
      },
    },
    null,
    2,
  ),
);
