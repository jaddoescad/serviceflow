#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { validateDripJobsJobsExports } from "./lib/dripjobs-jobs-list.mjs";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ACTIVE_CSV = "/Users/jadslim/Downloads/Jobs_List_20260817_093806.csv";
const ARCHIVED_CSV = "/Users/jadslim/Downloads/Jobs_List_20260817_093849.csv";
const PROPOSAL_ID = "3166585";
const CUSTOMER_INVOICE_ID = "493396";
const JOB_ID = "578e8c24-e7bd-5f29-8179-27a2b626bbe3";
const CONTACT_ID = "cd493956-4039-515d-a891-111c391f2c20";
const LEAD_ID = "a2de9965-f5b5-512d-a8f3-d0c08062e224";
const LABOUR_INVOICE_ID = "9b422fdb-973b-5d19-bb08-978680877716";
const LABOUR_LINE_ID = "0f586239-cdbd-59a2-8b27-13b34862f680";
const capturedAt = new Date().toISOString();
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

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
    ) value = value.slice(1, -1);
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function data(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

assert(existsSync(ACTIVE_CSV), `Missing active Jobs List: ${ACTIVE_CSV}`);
assert(existsSync(ARCHIVED_CSV), `Missing archived Jobs List: ${ARCHIVED_CSV}`);
const validation = validateDripJobsJobsExports({
  active: readFileSync(ACTIVE_CSV),
  archived: readFileSync(ARCHIVED_CSV),
});
const authorityRow = validation.rows.find((row) => row.proposalId === PROPOSAL_ID);
assert(authorityRow, `Proposal ${PROPOSAL_ID} is absent from the validated exports.`);
assert(authorityRow.view === "active" && authorityRow.rowNumber === 86, "Erin authority row moved unexpectedly.");
assert(authorityRow.customer === "Erin Lee" && authorityRow.invoiceId === CUSTOMER_INVOICE_ID, "Erin identity changed.");
assert(authorityRow.grossCents === 86_671 && authorityRow.beforeHstCents === 76_700, "Erin amount changed.");
assert(authorityRow.paidCents === 86_671 && authorityRow.balanceCents === 0, "Erin customer payment state changed.");
assert(authorityRow.normalizedProductionStage === "project_complete", "Erin stage is no longer Project Complete.");
assert(authorityRow.dealStageDateIso === "2026-08-14" && authorityRow.productionMonth === "2026-08-01", "Erin production evidence changed.");
assert(authorityRow.jobStartDateIso === "2026-08-13" && authorityRow.jobCompletionDateIso === "2026-08-14", "Erin job dates changed.");

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && secretKey, "Missing Supabase credentials.");
assert(new URL(supabaseUrl).hostname.split(".")[0] === PROJECT_REF, "Unexpected Supabase project.");
const db = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const QUOTE_ID = stableUuid(`quote:dripjobs:${PROPOSAL_ID}`);
const BUDGET_ID = stableUuid(`job-budget:jobs-list:${validation.manifest.source_sha256}:${JOB_ID}`);
const ALLOCATION_ID = stableUuid(`invoice-job-allocation:${LABOUR_LINE_ID}:${JOB_ID}`);
const [contact, lead, quote, job, budgets, invoice, sourceDocuments, config] = await Promise.all([
  db.from("contacts").select("*").eq("id", CONTACT_ID).single(),
  db.from("leads").select("*").eq("id", LEAD_ID).single(),
  db.from("quotes").select("*").eq("dripjobs_proposal_id", PROPOSAL_ID).maybeSingle(),
  db.from("jobs").select("*").eq("id", JOB_ID).single(),
  db.from("job_budgets").select("*").eq("job_id", JOB_ID),
  db.from("invoices").select("*,lines:invoice_lines(*),allocations:invoice_job_allocations(*)").eq("id", LABOUR_INVOICE_ID).single(),
  db.from("documents").select("*").in("content_sha256", [validation.active.sourceSha256, validation.archived.sourceSha256]),
  db.from("app_config").select("settings").eq("id", "default").single(),
]);
for (const [label, result] of [
  ["contact", contact], ["lead", lead], ["quote", quote], ["job", job],
  ["budgets", budgets], ["invoice", invoice], ["source documents", sourceDocuments], ["app config", config],
]) data(label, result);

assert(contact.data.name === "Erin Lee" && contact.data.email === "erin.lee@lcih.com" && contact.data.phone === "6138785700", "Erin contact changed.");
assert(lead.data.contact_id === CONTACT_ID && lead.data.dripjobs_deal_id === "434332899191ab1450d877448e8fbe", "Erin DripJobs lead changed.");
assert(!quote.data || quote.data.id === QUOTE_ID, "A conflicting quote exists for proposal 3166585.");
assert(job.data.source === "legacy_companycam" || job.data.accepted_quote_id === QUOTE_ID, "The Erin operational job changed unexpectedly.");
assert((job.data.companycam_project_ids ?? []).includes("111259179"), "The Erin CompanyCam identity changed.");
assert(job.data.started_on == null || job.data.started_on === "2026-08-13", "Erin started_on conflicts with DripJobs.");
assert(job.data.completed_on == null || job.data.completed_on === "2026-08-14", "Erin completed_on conflicts with DripJobs.");
assert(!job.data.production_month || String(job.data.production_month).slice(0, 10) === "2026-08-01", "Erin production month conflicts with DripJobs.");

const matchingDocs = new Map((sourceDocuments.data ?? []).map((document) => [document.content_sha256, document]));
const activeDocument = matchingDocs.get(validation.active.sourceSha256);
const archivedDocument = matchingDocs.get(validation.archived.sourceSha256);
assert(activeDocument?.metadata?.view === "active", "Validated active Jobs List document is not archived in Supabase.");
assert(archivedDocument?.metadata?.view === "archived", "Validated archived Jobs List document is not archived in Supabase.");

const invoiceLine = (invoice.data.lines ?? []).find((line) => line.id === LABOUR_LINE_ID);
assert(invoice.data.invoice_number === "GT-INV-202608-02" && Number(invoice.data.total_cents) === 145_528, "Grutenco invoice changed.");
assert(invoiceLine?.metadata?.printed_match_type === "proposal" && invoiceLine.metadata.printed_match_value === PROPOSAL_ID, "Erin invoice proposal evidence changed.");
assert(invoiceLine.description.includes("Erin Lee") && invoiceLine.description.includes("559 Pepperville Crescent"), "Erin invoice identity or address changed.");
assert(Number(invoiceLine.subtotal_cents) === 32_068 && Number(invoiceLine.tax_cents) === 4_169 && Number(invoiceLine.total_cents) === 36_237, "Erin invoice amount changed.");
const existingLineAllocations = (invoice.data.allocations ?? []).filter((allocation) => allocation.invoice_line_id === LABOUR_LINE_ID && !allocation.metadata?.reversed_at);
assert(
  existingLineAllocations.length === 0 ||
  (existingLineAllocations.length === 1 && existingLineAllocations[0].id === ALLOCATION_ID && existingLineAllocations[0].job_id === JOB_ID),
  "Erin invoice line has a conflicting job allocation.",
);

const allocationPercent = Number(config.data.settings?.labour_budget?.allocation_percent ?? 37);
const hourlyRateCents = Number(config.data.settings?.labour_budget?.planning_hourly_rate_cents ?? 3500);
assert(allocationPercent > 0 && hourlyRateCents > 0, "Invalid labour-budget defaults.");
const budgetMinutes = Math.round(authorityRow.beforeHstCents * (allocationPercent / 100) * 60 / hourlyRateCents);
const amountAuthority = {
  source_type: "dripjobs_jobs_list_all_views_csv",
  source_view: authorityRow.view,
  source_filename: activeDocument.original_filename,
  source_sha256: validation.active.sourceSha256,
  combined_source_sha256: validation.manifest.source_sha256,
  source_document_id: activeDocument.id,
  csv_row: authorityRow.rowNumber,
  proposal_id: authorityRow.proposalId,
  invoice_id: authorityRow.invoiceId,
  customer: authorityRow.customer,
  job_status: authorityRow.status,
  invoice_status: authorityRow.invoiceStatus,
  gross_amount_cents: authorityRow.grossCents,
  paid_cents: authorityRow.paidCents,
  balance_cents: authorityRow.balanceCents,
  hst_rate: 0.13,
  formula: "round(gross_amount_cents / 1.13)",
  before_hst_cents: authorityRow.beforeHstCents,
  implied_hst_cents: authorityRow.impliedHstCents,
  imported_at: capturedAt,
};
const productionAuthority = {
  source_type: "dripjobs_jobs_list_all_views_csv",
  source_view: authorityRow.view,
  source_filename: activeDocument.original_filename,
  source_sha256: validation.active.sourceSha256,
  combined_source_sha256: validation.manifest.source_sha256,
  source_document_id: activeDocument.id,
  csv_row: authorityRow.rowNumber,
  proposal_id: authorityRow.proposalId,
  deal_stage: authorityRow.dealStage,
  normalized_stage: authorityRow.normalizedProductionStage,
  deal_stage_date: authorityRow.dealStageDateIso,
  candidate_production_month: authorityRow.productionMonth,
  effective_production_month: authorityRow.productionMonth,
  rule: "advance from a qualifying workflow transition date; never clear or move backward",
  imported_at: capturedAt,
};

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  source: {
    active_rows: validation.manifest.active_row_count,
    archived_rows: validation.manifest.archived_row_count,
    combined_rows: validation.manifest.row_count,
    combined_sha256: validation.manifest.source_sha256,
  },
  proposal: authorityRow,
  repair: {
    promote_existing_job_id: JOB_ID,
    preserve_companycam_project_ids: job.data.companycam_project_ids,
    contact_id: CONTACT_ID,
    lead_id: LEAD_ID,
    quote_id: QUOTE_ID,
    budget_id: BUDGET_ID,
    budget_minutes: budgetMinutes,
    labour_invoice_id: LABOUR_INVOICE_ID,
    labour_line_id: LABOUR_LINE_ID,
    allocation_id: ALLOCATION_ID,
    allocation_subtotal_cents: 32_068,
    allocation_total_cents: 36_237,
  },
}, null, 2));
if (!APPLY) process.exit(0);

const contactWrite = await db.from("contacts").update({
  metadata: {
    ...(contact.data.metadata ?? {}),
    formatted_address: "559 Pepperville Crescent, Ottawa, ON, K2M 0E6, CA",
    proposal_id: PROPOSAL_ID,
    updated_from_jobs_list_at: capturedAt,
  },
  updated_at: capturedAt,
}).eq("id", CONTACT_ID).eq("updated_at", contact.data.updated_at).select("id").maybeSingle();
assert(data("contact update", contactWrite), "Concurrent Erin contact update.");

const leadWrite = await db.from("leads").update({
  status: "won",
  pipeline_stage_raw: "Project Complete",
  address: "559 Pepperville Crescent, Ottawa, ON, K2M 0E6, CA",
  city: "Ottawa",
  province: "ON",
  postal_code: "K2M 0E6",
  metadata: {
    ...(lead.data.metadata ?? {}),
    proposal_number: PROPOSAL_ID,
    proposal_amount: authorityRow.grossCents / 100,
    proposal_on: "2026-08-05",
    job_status: authorityRow.status,
    deal_stage: authorityRow.dealStage,
    job_start_date: authorityRow.jobStartDateIso,
    job_completion_date: authorityRow.jobCompletionDateIso,
  },
  updated_at: capturedAt,
}).eq("id", LEAD_ID).eq("updated_at", lead.data.updated_at).select("id").maybeSingle();
assert(data("lead update", leadWrite), "Concurrent Erin lead update.");

data("quote upsert", await db.from("quotes").upsert({
  id: QUOTE_ID,
  lead_id: LEAD_ID,
  dripjobs_proposal_id: PROPOSAL_ID,
  name: "Erin Lee — proposal 3166585",
  status: "accepted",
  amount_cents: authorityRow.grossCents,
  tax_cents: authorityRow.impliedHstCents,
  accepted_at: "2026-08-05T14:03:55-04:00",
  source: "dripjobs_jobs_list",
  metadata: {
    invoice_number: CUSTOMER_INVOICE_ID,
    invoice_status: authorityRow.invoiceStatus,
    deal_stage: authorityRow.dealStage,
    deal_stage_date: authorityRow.dealStageDateIso,
    source_document_id: activeDocument.id,
    combined_source_sha256: validation.manifest.source_sha256,
  },
  created_at: job.data.created_at,
  updated_at: capturedAt,
}, { onConflict: "id" }));

const jobWrite = await db.from("jobs").update({
  contact_id: CONTACT_ID,
  lead_id: LEAD_ID,
  accepted_quote_id: QUOTE_ID,
  name: "Erin Lee",
  status: "completed",
  contract_amount_cents: authorityRow.beforeHstCents,
  address_line_1: "559 Pepperville Crescent",
  city: "Ottawa",
  province: "ON",
  postal_code: "K2M 0E6",
  country: "CA",
  formatted_address: "559 Pepperville Crescent, Ottawa, ON, K2M 0E6, CA",
  started_on: authorityRow.jobStartDateIso,
  completed_on: authorityRow.jobCompletionDateIso,
  production_month: authorityRow.productionMonth,
  is_feed_visible: true,
  source: "dripjobs",
  metadata: {
    ...(job.data.metadata ?? {}),
    dripjobs_job_number: PROPOSAL_ID,
    dripjobs_status: authorityRow.status,
    deal_stage: authorityRow.dealStage,
    salesperson: "Scott Madden",
    project_manager: "Scott Madden",
    invoice_number: CUSTOMER_INVOICE_ID,
    accounting_status: "active",
    promoted_from_legacy_companycam: true,
    identity_evidence: {
      companycam_project_id: "111259179",
      dripjobs_contact_id: contact.data.dripjobs_contact_id,
      printed_invoice_proposal_id: PROPOSAL_ID,
      printed_invoice_address: "559 Pepperville Crescent, Ottawa",
    },
    job_amount_authority: amountAuthority,
    production_month_authority: productionAuthority,
  },
  updated_at: capturedAt,
}).eq("id", JOB_ID).eq("updated_at", job.data.updated_at).select("id").maybeSingle();
assert(data("job update", jobWrite), "Concurrent Erin job update.");

const existingTargetBudget = (budgets.data ?? []).find((budget) => budget.id === BUDGET_ID);
const activeBudgetIds = (budgets.data ?? [])
  .filter((budget) => budget.id !== BUDGET_ID && ["active", "closed"].includes(budget.status))
  .map((budget) => budget.id);
if (activeBudgetIds.length) data("supersede old budgets", await db.from("job_budgets").update({ status: "superseded", updated_at: capturedAt }).in("id", activeBudgetIds));
data("budget upsert", await db.from("job_budgets").upsert({
  id: BUDGET_ID,
  job_id: JOB_ID,
  quote_id: QUOTE_ID,
  version: existingTargetBudget?.version ?? Math.max(0, ...(budgets.data ?? []).map((budget) => Number(budget.version))) + 1,
  status: "closed",
  production_month: authorityRow.productionMonth,
  budget_minutes: budgetMinutes,
  calculated_minutes: budgetMinutes,
  hourly_rate_cents: hourlyRateCents,
  amount_including_tax_cents: authorityRow.beforeHstCents,
  labour_allocation_percent: 40,
  source: "manual",
  notes: `Job amount imported from validated DripJobs Jobs List: proposal ${PROPOSAL_ID}, gross $866.71 including HST / 1.13 = $767.00 before HST.`,
  metadata: {
    budget_minutes_source: "formula",
    formula_allocation_percent: allocationPercent,
    formula_hourly_rate_cents: hourlyRateCents,
    formula_amount_cents: authorityRow.beforeHstCents,
    job_amount_authority: amountAuthority,
    production_month_authority: productionAuthority,
  },
  created_at: capturedAt,
  updated_at: capturedAt,
}, { onConflict: "id" }));

data("invoice allocation", await db.from("invoice_job_allocations").upsert({
  id: ALLOCATION_ID,
  invoice_id: LABOUR_INVOICE_ID,
  invoice_line_id: LABOUR_LINE_ID,
  job_id: JOB_ID,
  subtotal_cents: 32_068,
  tax_cents: 4_169,
  total_cents: 36_237,
  quantity: 1,
  minutes: null,
  allocation_method: "exact_printed_proposal",
  confidence: 1,
  needs_review: false,
  metadata: {
    printed_match_type: "proposal",
    printed_match_value: PROPOSAL_ID,
    printed_description: invoiceLine.description,
    source_document_id: invoiceLine.metadata.source_document_id,
    source_gmail_message_id: invoiceLine.metadata.source_gmail_message_id,
    job_authority_document_id: activeDocument.id,
    combined_source_sha256: validation.manifest.source_sha256,
  },
  created_at: capturedAt,
  updated_at: capturedAt,
}, { onConflict: "id" }));

for (const document of [activeDocument, archivedDocument]) {
  data(`job evidence ${document.id}`, await db.from("evidence_links").upsert({
    id: stableUuid(`evidence-link:${document.id}:job:${JOB_ID}`),
    document_id: document.id,
    entity_type: "job",
    entity_id: JOB_ID,
    evidence_role: "job_amount_authority",
    metadata: {
      proposal_id: PROPOSAL_ID,
      selected_source_view: authorityRow.view,
      selected_csv_row: authorityRow.rowNumber,
      combined_source_sha256: validation.manifest.source_sha256,
    },
    created_at: capturedAt,
  }, { onConflict: "id" }));
}

data("job verification event", await db.from("verification_events").upsert({
  id: stableUuid(`verification:erin-lee-job-repair:${PROPOSAL_ID}`),
  entity_type: "job",
  entity_id: JOB_ID,
  action: "canonical_dripjobs_job_repaired",
  reason: "Exact DripJobs proposal, contact identity, address, validated Jobs List authority, and printed contractor invoice evidence identify the existing CompanyCam lead row as Erin Lee proposal 3166585.",
  old_values: {
    accepted_quote_id: job.data.accepted_quote_id,
    status: job.data.status,
    contract_amount_cents: job.data.contract_amount_cents,
    production_month: job.data.production_month,
  },
  new_values: {
    accepted_quote_id: QUOTE_ID,
    status: "completed",
    contract_amount_cents: authorityRow.beforeHstCents,
    production_month: authorityRow.productionMonth,
  },
  evidence: {
    amount: amountAuthority,
    production_month: productionAuthority,
    source_documents: [activeDocument.id, archivedDocument.id],
    invoice_line_id: LABOUR_LINE_ID,
  },
  occurred_at: capturedAt,
}, { onConflict: "id" }));

data("allocation verification event", await db.from("verification_events").upsert({
  id: stableUuid(`verification:erin-lee-grutenco-allocation:${LABOUR_LINE_ID}`),
  entity_type: "invoice_job_allocation",
  entity_id: ALLOCATION_ID,
  action: "invoice_line_linked_to_exact_dripjobs_proposal",
  reason: "The Grutenco line prints proposal 3166585, Erin Lee, and 559 Pepperville Crescent; the repaired canonical job has the same proposal, customer, and address.",
  old_values: { allocation_id: null },
  new_values: { allocation_id: ALLOCATION_ID, job_id: JOB_ID, subtotal_cents: 32_068, total_cents: 36_237 },
  evidence: { invoice_id: LABOUR_INVOICE_ID, invoice_line_id: LABOUR_LINE_ID, proposal_id: PROPOSAL_ID, source_document_id: invoiceLine.metadata.source_document_id },
  occurred_at: capturedAt,
}, { onConflict: "id" }));

const [verifiedJob, verifiedQuote, verifiedBudgets, verifiedInvoice] = await Promise.all([
  db.from("jobs").select("id,contact_id,lead_id,accepted_quote_id,name,status,contract_amount_cents,formatted_address,started_on,completed_on,production_month,companycam_project_ids,source,metadata").eq("id", JOB_ID).single(),
  db.from("quotes").select("id,dripjobs_proposal_id,amount_cents,tax_cents,status").eq("id", QUOTE_ID).single(),
  db.from("job_budgets").select("id,job_id,version,status,production_month,amount_including_tax_cents,metadata").eq("job_id", JOB_ID),
  db.from("invoices").select("id,invoice_number,total_cents,allocations:invoice_job_allocations(id,invoice_line_id,job_id,subtotal_cents,tax_cents,total_cents,needs_review)").eq("id", LABOUR_INVOICE_ID).single(),
]);
for (const [label, result] of [["verified job", verifiedJob], ["verified quote", verifiedQuote], ["verified budgets", verifiedBudgets], ["verified invoice", verifiedInvoice]]) data(label, result);
assert(verifiedJob.data.accepted_quote_id === QUOTE_ID && verifiedJob.data.status === "completed", "Job identity verification failed.");
assert(Number(verifiedJob.data.contract_amount_cents) === 76_700 && verifiedJob.data.production_month === "2026-08-01", "Job authority verification failed.");
assert(verifiedJob.data.started_on === "2026-08-13" && verifiedJob.data.completed_on === "2026-08-14", "Job date verification failed.");
assert(verifiedQuote.data.dripjobs_proposal_id === PROPOSAL_ID && Number(verifiedQuote.data.amount_cents) === 86_671, "Quote verification failed.");
const currentBudget = (verifiedBudgets.data ?? []).find((budget) => budget.id === BUDGET_ID);
assert(currentBudget?.status === "closed" && currentBudget.production_month === "2026-08-01" && Number(currentBudget.amount_including_tax_cents) === 76_700, "Budget verification failed.");
const activeAllocations = (verifiedInvoice.data.allocations ?? []).filter((allocation) => !allocation.needs_review);
assert(activeAllocations.length === 3, "Grutenco invoice does not have exactly three verified allocations.");
assert(activeAllocations.reduce((sum, allocation) => sum + Number(allocation.subtotal_cents), 0) === 128_786, "Grutenco allocated subtotal does not equal the invoice subtotal.");
assert(activeAllocations.reduce((sum, allocation) => sum + Number(allocation.total_cents), 0) === 145_528, "Grutenco allocated total does not equal the invoice total.");

console.log(JSON.stringify({
  status: "verified",
  job: verifiedJob.data,
  quote: verifiedQuote.data,
  current_budget: currentBudget,
  grutenco_invoice: {
    id: verifiedInvoice.data.id,
    invoice_number: verifiedInvoice.data.invoice_number,
    total_cents: verifiedInvoice.data.total_cents,
    allocated_subtotal_cents: activeAllocations.reduce((sum, allocation) => sum + Number(allocation.subtotal_cents), 0),
    allocated_total_cents: activeAllocations.reduce((sum, allocation) => sum + Number(allocation.total_cents), 0),
    allocation_count: activeAllocations.length,
  },
}, null, 2));
