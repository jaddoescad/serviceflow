#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  CONFIRMED_LEAD_JOB_LINKS,
  DRIPJOBS_JOB_RECONCILIATION,
  EXCLUDED_TEST_JOBS,
} from "./lib/dripjobs-job-reconciliation.mjs";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const testProposalIds = EXCLUDED_TEST_JOBS.map((job) => job.proposal_id);
const testInvoiceIds = EXCLUDED_TEST_JOBS.map((job) => job.invoice_uuid);
const testProjectIds = testProposalIds.map((proposalId) => `dripjobs-${proposalId}`);
const leadIds = CONFIRMED_LEAD_JOB_LINKS.map((record) => record.lead_deal_id);
const realProposalIds = CONFIRMED_LEAD_JOB_LINKS.map(
  (record) => record.proposal_id,
);

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
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

function assertCount(label, rows, expected) {
  if (rows.length !== expected) {
    throw new Error(`${label}: expected ${expected}, found ${rows.length}.`);
  }
}

function assertNotPartiallyApplied(label, rows, expectedComplete) {
  if (rows.length !== 0 && rows.length !== expectedComplete) {
    throw new Error(
      `${label}: expected either 0 (already reconciled) or ${expectedComplete} (not yet reconciled), found ${rows.length}.`,
    );
  }
}

async function deleteRows(label, query) {
  const result = await query;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or service role key.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== TARGET_PROJECT_REF) {
  throw new Error(`Refusing write for unexpected project ${projectRef}.`);
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [
  leads,
  realJobs,
  realInvoices,
  testJobs,
  testInvoices,
  testSourceRecords,
  testProjects,
  testBudgets,
  existingJobLinks,
  existingProjectLinks,
] = await Promise.all([
  db.from("marketing_leads").select("*").in("deal_id", leadIds),
  db.from("dripjobs_jobs").select("*").in("proposal_id", realProposalIds),
  db
    .from("customer_invoices")
    .select("*")
    .in("external_proposal_id", realProposalIds),
  db.from("dripjobs_jobs").select("*").in("proposal_id", testProposalIds),
  db
    .from("customer_invoices")
    .select("*")
    .in("external_invoice_id", testInvoiceIds),
  db
    .from("marketing_crm_records")
    .select("id,proposal_id,canonical_in_snapshot,source_payload")
    .eq("record_type", "job")
    .eq("canonical_in_snapshot", true)
    .in("proposal_id", testProposalIds),
  db
    .from("companycam_projects")
    .select("companycam_id,name,raw")
    .in("companycam_id", testProjectIds),
  db
    .from("project_budgets")
    .select("companycam_project_id,amount_including_tax")
    .in("companycam_project_id", testProjectIds),
  db
    .from("marketing_lead_job_links")
    .select("*")
    .in("job_proposal_id", [...realProposalIds, ...testProposalIds]),
  db
    .from("marketing_lead_project_links")
    .select("*")
    .in("companycam_project_id", [
      ...testProjectIds,
      ...CONFIRMED_LEAD_JOB_LINKS.map((record) => record.companycam_project_id),
    ]),
]);
for (const [label, result] of Object.entries({
  leads,
  realJobs,
  realInvoices,
  testJobs,
  testInvoices,
  testSourceRecords,
  testProjects,
  testBudgets,
  existingJobLinks,
  existingProjectLinks,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
assertCount("canonical lead rows", leads.data, 3);
assertCount("real DripJobs jobs", realJobs.data, 3);
assertCount("real customer invoices", realInvoices.data, 3);
assertNotPartiallyApplied("test DripJobs jobs", testJobs.data, 3);
assertNotPartiallyApplied("test customer invoices", testInvoices.data, 3);
assertNotPartiallyApplied(
  "canonical test CRM source rows",
  testSourceRecords.data,
  3,
);
assertNotPartiallyApplied("test accounting projects", testProjects.data, 3);
assertNotPartiallyApplied("test project budgets", testBudgets.data, 3);

const realInvoiceByProposal = new Map(
  realInvoices.data.map((invoice) => [String(invoice.external_proposal_id), invoice]),
);
for (const record of CONFIRMED_LEAD_JOB_LINKS) {
  const invoice = realInvoiceByProposal.get(record.proposal_id);
  if (
    !invoice ||
    String(invoice.external_invoice_id) !== record.invoice_uuid ||
    cents(invoice.total_amount) !== cents(record.invoice_total)
  ) {
    throw new Error(`Physical invoice evidence differs for ${record.proposal_id}.`);
  }
}
for (const expected of EXCLUDED_TEST_JOBS) {
  const invoice = testInvoices.data.find(
    (row) => row.external_invoice_id === expected.invoice_uuid,
  );
  if (testInvoices.data.length === 0) continue;
  if (
    !invoice ||
    String(invoice.external_proposal_id) !== expected.proposal_id ||
    cents(invoice.total_amount) !== cents(expected.total_amount)
  ) {
    throw new Error(`Test invoice evidence differs for ${expected.proposal_id}.`);
  }
}

const testInvoiceRowIds = testInvoices.data.map((invoice) => invoice.id);
const dependencyQueries = {
  invoice_items: db
    .from("customer_invoice_items")
    .select("id,customer_invoice_id")
    .in("customer_invoice_id", testInvoiceRowIds),
  invoice_documents: db
    .from("customer_invoice_documents")
    .select("id,customer_invoice_id,storage_bucket,storage_path")
    .in("customer_invoice_id", testInvoiceRowIds),
  payment_events: db
    .from("customer_invoice_payment_events")
    .select("id,customer_invoice_id,amount")
    .in("customer_invoice_id", testInvoiceRowIds),
  bank_allocations: db
    .from("customer_invoice_bank_allocations")
    .select("id,customer_invoice_id,financial_transaction_id")
    .in("customer_invoice_id", testInvoiceRowIds),
  acquisition_attributions: db
    .from("customer_invoice_acquisition_attributions")
    .select("customer_invoice_id")
    .in("customer_invoice_id", testInvoiceRowIds),
  lead_project_links: db
    .from("marketing_lead_project_links")
    .select("id")
    .in("companycam_project_id", testProjectIds),
  material_allocations: db
    .from("material_invoice_line_allocations")
    .select("companycam_project_id")
    .in("companycam_project_id", testProjectIds),
  labour_invoice_projects: db
    .from("labour_invoice_projects")
    .select("companycam_project_id")
    .in("companycam_project_id", testProjectIds),
  project_assignments: db
    .from("project_assignments")
    .select("companycam_project_id")
    .in("companycam_project_id", testProjectIds),
  project_calculators: db
    .from("project_calculators")
    .select("companycam_project_id")
    .in("companycam_project_id", testProjectIds),
  project_labour_budgets: db
    .from("project_labour_budgets")
    .select("companycam_project_id")
    .in("companycam_project_id", testProjectIds),
  project_labour_expenses: db
    .from("project_labour_expenses")
    .select("companycam_project_id")
    .in("companycam_project_id", testProjectIds),
  project_labour_tasks: db
    .from("project_labour_tasks")
    .select("companycam_project_id")
    .in("companycam_project_id", testProjectIds),
  time_entries: db
    .from("time_entries")
    .select("companycam_project_id")
    .in("companycam_project_id", testProjectIds),
};
const dependencies = Object.fromEntries(
  await Promise.all(
    Object.entries(dependencyQueries).map(async ([label, query]) => {
      const result = await query;
      if (result.error) throw new Error(`${label}: ${result.error.message}`);
      return [label, result.data ?? []];
    }),
  ),
);
assertCount(
  "test invoice items",
  dependencies.invoice_items,
  testInvoices.data.length,
);
assertCount(
  "test invoice documents",
  dependencies.invoice_documents,
  testInvoices.data.length,
);
assertCount(
  "test source payment events",
  dependencies.payment_events,
  testInvoices.data.some(
    (invoice) => String(invoice.external_proposal_id) === "2665278",
  )
    ? 1
    : 0,
);
assertCount("test bank allocations", dependencies.bank_allocations, 0);
assertCount("test acquisition attributions", dependencies.acquisition_attributions, 0);
for (const label of [
  "lead_project_links",
  "material_allocations",
  "labour_invoice_projects",
  "project_assignments",
  "project_calculators",
  "project_labour_budgets",
  "project_labour_expenses",
  "project_labour_tasks",
  "time_entries",
]) {
  assertCount(`test ${label}`, dependencies[label], 0);
}

const preview = {
  project_ref: projectRef,
  mode: APPLY ? "apply" : "dry-run",
  source_evidence: "data/dripjobs-job-reconciliation-2026-08-02.json",
  tests_to_remove: EXCLUDED_TEST_JOBS.map((job) => ({
    proposal_id: job.proposal_id,
    invoice_number: job.invoice_number,
    total_amount: job.total_amount,
    bank_allocations: job.verified_bank_allocations,
  })),
  real_jobs_to_link: CONFIRMED_LEAD_JOB_LINKS.map((record) => ({
    proposal_id: record.proposal_id,
    contact_name: record.contact_name,
    lead_deal_id: record.lead_deal_id,
    contact_uuid: record.contact_uuid,
    invoice_number: record.invoice_number,
    companycam_project_id: record.companycam_project_id,
  })),
  existing_confirmed_job_links: existingJobLinks.data.filter(
    (link) => link.link_status === "confirmed",
  ).length,
  existing_confirmed_project_links: existingProjectLinks.data.filter(
    (link) => link.link_status === "confirmed",
  ).length,
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) {
  console.log("\nDry run only. Re-run with --apply to write this verified plan.");
  process.exit(0);
}

const now = new Date().toISOString();
const leadById = new Map(leads.data.map((lead) => [lead.deal_id, lead]));
for (const record of CONFIRMED_LEAD_JOB_LINKS) {
  const existing = leadById.get(record.lead_deal_id);
  assertNoError(
    `lead correction ${record.contact_name}`,
    await db
      .from("marketing_leads")
      .update({
        created_on: record.contact_created_at_local.slice(0, 10),
        created_at_local: record.contact_created_at_local,
        created_at_precision: "timestamp",
        contact_name: record.contact_name,
        email: record.email,
        phone: record.phone,
        raw_lead_source: record.lead_source,
        normalized_channel: record.normalized_channel,
        address: record.address,
        postal_code: record.postal_code,
        proposal_number: record.proposal_id,
        proposal_amount: record.invoice_total,
        proposal_on: record.proposal_created_on,
        source_payload: {
          ...sourceObject(existing.source_payload),
          dripjobs_reconciliation: {
            status: "confirmed",
            captured_at: DRIPJOBS_JOB_RECONCILIATION.captured_at,
            evidence_source:
              "data/dripjobs-job-reconciliation-2026-08-02.json",
            contact_uuid: record.contact_uuid,
            dripjobs_deal_uuid: record.dripjobs_deal_uuid,
            proposal_uuid: record.proposal_uuid,
            invoice_uuid: record.invoice_uuid,
            identity_correction: record.identity_correction ?? null,
          },
        },
      })
      .eq("deal_id", record.lead_deal_id),
  );
}

for (const sourceRecord of testSourceRecords.data) {
  const exclusion = EXCLUDED_TEST_JOBS.find(
    (job) => job.proposal_id === String(sourceRecord.proposal_id),
  );
  assertNoError(
    `test source exclusion ${sourceRecord.proposal_id}`,
    await db
      .from("marketing_crm_records")
      .update({
        canonical_in_snapshot: false,
        source_payload: {
          ...sourceObject(sourceRecord.source_payload),
          accounting_exclusion: {
            status: "confirmed_test_record",
            captured_at: DRIPJOBS_JOB_RECONCILIATION.captured_at,
            reason: exclusion.reason,
            evidence_source:
              "data/dripjobs-job-reconciliation-2026-08-02.json",
          },
        },
      })
      .eq("id", sourceRecord.id),
  );
}

await deleteRows(
  "test lead/job links",
  db
    .from("marketing_lead_job_links")
    .delete()
    .in("job_proposal_id", testProposalIds),
);
await deleteRows(
  "test DripJobs jobs",
  db.from("dripjobs_jobs").delete().in("proposal_id", testProposalIds),
);
await deleteRows(
  "test invoice documents",
  db
    .from("customer_invoice_documents")
    .delete()
    .in("customer_invoice_id", testInvoiceRowIds),
);
await deleteRows(
  "test invoice items",
  db
    .from("customer_invoice_items")
    .delete()
    .in("customer_invoice_id", testInvoiceRowIds),
);
await deleteRows(
  "test invoice payment events",
  db
    .from("customer_invoice_payment_events")
    .delete()
    .in("customer_invoice_id", testInvoiceRowIds),
);
await deleteRows(
  "test customer invoices",
  db.from("customer_invoices").delete().in("id", testInvoiceRowIds),
);
await deleteRows(
  "test project budgets",
  db
    .from("project_budgets")
    .delete()
    .in("companycam_project_id", testProjectIds),
);
await deleteRows(
  "test accounting projects",
  db.from("companycam_projects").delete().in("companycam_id", testProjectIds),
);

for (const record of CONFIRMED_LEAD_JOB_LINKS) {
  const realJob = realJobs.data.find(
    (job) => String(job.proposal_id) === record.proposal_id,
  );
  assertNoError(
    `job evidence ${record.proposal_id}`,
    await db
      .from("dripjobs_jobs")
      .update({
        lead_resolution_status: "confirmed",
        lead_resolution_note:
          "Originating lead confirmed from the exact authenticated DripJobs contact UUID, proposal, deal, and physical invoice.",
        lead_resolved_at: now,
        source_payload: {
          ...sourceObject(realJob.source_payload),
          attribution_evidence: {
            evidence_source:
              "data/dripjobs-job-reconciliation-2026-08-02.json",
            contact_uuid: record.contact_uuid,
            proposal_uuid: record.proposal_uuid,
            dripjobs_deal_uuid: record.dripjobs_deal_uuid,
          },
        },
      })
      .eq("proposal_id", record.proposal_id),
  );
  assertNoError(
    `lead/job link ${record.proposal_id}`,
    await db.from("marketing_lead_job_links").upsert(
      {
        lead_deal_id: record.lead_deal_id,
        job_proposal_id: record.proposal_id,
        relationship_type: "originated",
        link_status: "confirmed",
        match_method: "dripjobs_contact_uuid",
        confidence: 1,
        evidence: {
          decision_source: "authenticated_dripjobs_reconciliation_2026_08_02",
          exact_identifiers: [
            "dripjobs_contact_uuid",
            "dripjobs_proposal_uuid",
            "dripjobs_invoice_uuid",
          ],
          contact_uuid: record.contact_uuid,
          proposal_uuid: record.proposal_uuid,
          invoice_uuid: record.invoice_uuid,
          dripjobs_deal_uuid: record.dripjobs_deal_uuid,
          returning_customer_safe: true,
        },
        review_note:
          "Confirmed from exact authenticated DripJobs identifiers; name, email, and phone were supporting evidence only.",
        confirmed_at: now,
      },
      { onConflict: "lead_deal_id,job_proposal_id" },
    ),
  );
  assertNoError(
    `lead/project link ${record.proposal_id}`,
    await db.from("marketing_lead_project_links").upsert(
      {
        lead_deal_id: record.lead_deal_id,
        companycam_project_id: record.companycam_project_id,
        relationship_type: "originated",
        link_status: "confirmed",
        match_method: "dripjobs_contact_uuid",
        confidence: 1,
        evidence: {
          decision_source: "authenticated_dripjobs_reconciliation_2026_08_02",
          exact_identifiers: [
            "dripjobs_contact_uuid",
            "dripjobs_proposal_uuid",
            "dripjobs_invoice_uuid",
          ],
          contact_uuid: record.contact_uuid,
          proposal_uuid: record.proposal_uuid,
          invoice_uuid: record.invoice_uuid,
          returning_customer_safe: true,
        },
        review_note:
          "Confirmed from the exact DripJobs contact, proposal, invoice, and accounting-project chain.",
        confirmed_at: now,
      },
      { onConflict: "lead_deal_id,companycam_project_id" },
    ),
  );
}

const [
  remainingTestJobs,
  remainingTestInvoices,
  remainingTestProjects,
  remainingTestBudgets,
  canonicalTestSources,
  verifiedLeads,
  verifiedJobLinks,
  verifiedProjectLinks,
  verifiedJobs,
  allLeadCount,
  lead2026Count,
  meta2026Count,
  allInvoiceCount,
] = await Promise.all([
  db
    .from("dripjobs_jobs")
    .select("proposal_id", { count: "exact", head: true })
    .in("proposal_id", testProposalIds),
  db
    .from("customer_invoices")
    .select("id", { count: "exact", head: true })
    .in("external_invoice_id", testInvoiceIds),
  db
    .from("companycam_projects")
    .select("companycam_id", { count: "exact", head: true })
    .in("companycam_id", testProjectIds),
  db
    .from("project_budgets")
    .select("companycam_project_id", { count: "exact", head: true })
    .in("companycam_project_id", testProjectIds),
  db
    .from("marketing_crm_records")
    .select("id", { count: "exact", head: true })
    .eq("record_type", "job")
    .eq("canonical_in_snapshot", true)
    .in("proposal_id", testProposalIds),
  db
    .from("marketing_leads")
    .select("deal_id,contact_name,email,phone,proposal_number")
    .in("deal_id", leadIds),
  db
    .from("marketing_lead_job_links")
    .select("lead_deal_id,job_proposal_id,link_status,relationship_type")
    .in("job_proposal_id", realProposalIds),
  db
    .from("marketing_lead_project_links")
    .select("lead_deal_id,companycam_project_id,link_status,relationship_type")
    .in(
      "companycam_project_id",
      CONFIRMED_LEAD_JOB_LINKS.map((record) => record.companycam_project_id),
    ),
  db
    .from("dripjobs_jobs")
    .select("proposal_id,lead_resolution_status")
    .in("proposal_id", realProposalIds),
  db.from("marketing_leads").select("deal_id", { count: "exact", head: true }),
  db
    .from("marketing_leads")
    .select("deal_id", { count: "exact", head: true })
    .gte("created_on", "2026-01-01")
    .lte("created_on", "2026-12-31"),
  db
    .from("marketing_leads")
    .select("deal_id", { count: "exact", head: true })
    .gte("created_on", "2026-01-01")
    .lte("created_on", "2026-12-31")
    .eq("normalized_channel", "paid_social"),
  db.from("customer_invoices").select("id", { count: "exact", head: true }),
]);
for (const [label, result] of Object.entries({
  remainingTestJobs,
  remainingTestInvoices,
  remainingTestProjects,
  remainingTestBudgets,
  canonicalTestSources,
  verifiedLeads,
  verifiedJobLinks,
  verifiedProjectLinks,
  verifiedJobs,
  allLeadCount,
  lead2026Count,
  meta2026Count,
  allInvoiceCount,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
for (const [label, result] of Object.entries({
  remainingTestJobs,
  remainingTestInvoices,
  remainingTestProjects,
  remainingTestBudgets,
  canonicalTestSources,
})) {
  if (result.count !== 0) throw new Error(`${label}: expected zero, found ${result.count}.`);
}
assertCount("verified corrected leads", verifiedLeads.data, 3);
assertCount("verified lead/job links", verifiedJobLinks.data, 3);
assertCount("verified lead/project links", verifiedProjectLinks.data, 3);
assertCount("verified real jobs", verifiedJobs.data, 3);
for (const record of CONFIRMED_LEAD_JOB_LINKS) {
  const lead = verifiedLeads.data.find((row) => row.deal_id === record.lead_deal_id);
  const job = verifiedJobs.data.find(
    (row) => String(row.proposal_id) === record.proposal_id,
  );
  if (
    !lead ||
    lead.contact_name !== record.contact_name ||
    lead.email.toLocaleLowerCase("en-CA") !==
      record.email.toLocaleLowerCase("en-CA") ||
    String(lead.proposal_number) !== record.proposal_id ||
    job?.lead_resolution_status !== "confirmed"
  ) {
    throw new Error(`Lead/job verification failed for ${record.proposal_id}.`);
  }
}
if (
  allLeadCount.count !== 1170 ||
  lead2026Count.count !== 792 ||
  meta2026Count.count !== 501
) {
  throw new Error(
    `Lead denominator changed unexpectedly: ${allLeadCount.count}/${lead2026Count.count}/${meta2026Count.count}.`,
  );
}
if (allInvoiceCount.count !== 181) {
  throw new Error(`Expected 181 non-test customer invoices, found ${allInvoiceCount.count}.`);
}

console.log(
  JSON.stringify(
    {
      applied: true,
      removed_tests: EXCLUDED_TEST_JOBS.length,
      confirmed_lead_job_links: verifiedJobLinks.data.length,
      confirmed_lead_project_links: verifiedProjectLinks.data.length,
      lead_denominator: {
        total: allLeadCount.count,
        year_2026: lead2026Count.count,
        meta_2026: meta2026Count.count,
      },
      customer_invoices_remaining: allInvoiceCount.count,
      archived_test_source_evidence_preserved: true,
    },
    null,
    2,
  ),
);
