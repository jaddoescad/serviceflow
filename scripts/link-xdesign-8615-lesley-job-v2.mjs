#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ACCOUNTING_CUTOFF = "2026-06-01";
const INVOICE_ID = "34722641-13f3-568c-86d4-fb33f9b4a778";
const INVOICE_LINE_ID = "1b04af8e-7c43-56fa-be5a-1d7d14b9afe3";
const DOCUMENT_ID = "e004d3e7-d29f-5e27-ba7d-dbbb2f9130bb";
const JOB_ID = "bd28a7cb-d6a7-5467-960c-966696416d09";
const JOB_CONTACT_ID = "9feeba14-7e14-5fb0-a665-ef5c69ba8871";
const QUOTE_ID = "c6ce5146-5c2e-5246-b449-94b3772a98e3";
const INVOICE_NUMBER = "8615";
const SUPPLIER = "XDesign Dev Inc";
const CUSTOMER = "Lesley Lesley";
const PRINTED_ADDRESS = "528 Hilson Ave";
const PROPOSAL_ID = "3196567";
const SOURCE_SHA256 = "00cda25041ee918c61b58f54738c5a454366237c5f781908b007b60462544e67";
const SOURCE_DOCUMENT_PATH =
  "gmail-contractor-invoices/2026-08-18/00cda25041ee918c-Invoice_8615_2026-08-18.pdf";
const PDF_PATH = path.resolve(
  process.argv.find((value) => value.startsWith("--pdf="))?.slice(6) ??
    "tmp/pdfs/Invoice_8615_2026-08-18.pdf",
);
const HOURS = 22;
const HOURLY_RATE_CENTS = 3_000;
const SUBTOTAL_CENTS = 66_000;
const TAX_CENTS = 8_580;
const TOTAL_CENTS = 74_580;

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        let value = line.slice(separator + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) value = value.slice(1, -1);
        return [line.slice(0, separator).trim(), value];
      }),
  );
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

function normalize(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function historicalLocked(job) {
  if (job.started_on && job.started_on < ACCOUNTING_CUTOFF) return true;
  return ["completed", "archived"].includes(job.status) && !job.started_on && !job.completed_on;
}

assert(existsSync(PDF_PATH), `Archived source PDF not found: ${PDF_PATH}`);
const pdfSha256 = crypto.createHash("sha256").update(readFileSync(PDF_PATH)).digest("hex");
assert(pdfSha256 === SOURCE_SHA256, `Archived source PDF hash changed: ${pdfSha256}`);
assert(HOURS * HOURLY_RATE_CENTS === SUBTOTAL_CENTS, "Printed hours and rate do not equal subtotal.");
assert(Math.round(SUBTOTAL_CENTS * 0.13) === TAX_CENTS, "Printed HST does not equal 13% of subtotal.");
assert(SUBTOTAL_CENTS + TAX_CENTS === TOTAL_CENTS, "Printed invoice total does not reconcile.");

const allocationId = stableUuid(`invoice-job-allocation:${INVOICE_LINE_ID}:${JOB_ID}`);
const verificationId = stableUuid(`verification:invoice-job-link:${INVOICE_LINE_ID}:${JOB_ID}`);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) {
  throw new Error("Refusing update for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function loadState() {
  const [invoiceResult, lineResult, documentResult, jobResult, customerResult, quoteResult, candidatesResult, allocationsResult, allocationResult] = await Promise.all([
    db.from("invoices").select("*,contact:contacts(name)").eq("id", INVOICE_ID).single(),
    db.from("invoice_lines").select("*").eq("id", INVOICE_LINE_ID).single(),
    db.from("documents").select("*").eq("id", DOCUMENT_ID).single(),
    db.from("jobs").select("*").eq("id", JOB_ID).single(),
    db.from("contacts").select("*").eq("id", JOB_CONTACT_ID).single(),
    db.from("quotes").select("*").eq("id", QUOTE_ID).single(),
    db.from("jobs").select("id,name,status,started_on,completed_on,archived_at,accepted_quote_id,contact_id,source,metadata").ilike("name", CUSTOMER),
    db.from("invoice_job_allocations").select("*").eq("invoice_id", INVOICE_ID),
    db.from("invoice_job_allocations").select("*").eq("id", allocationId).maybeSingle(),
  ]);
  return {
    invoice: data("invoice", invoiceResult),
    line: data("invoice line", lineResult),
    document: data("source document", documentResult),
    job: data("job", jobResult),
    customer: data("job customer", customerResult),
    quote: data("accepted quote", quoteResult),
    exactNameCandidates: data("exact-name job candidates", candidatesResult).filter(
      (row) => normalize(row.name) === normalize(CUSTOMER),
    ),
    invoiceAllocations: data("invoice allocations", allocationsResult).filter(
      (row) => !row.metadata?.reversed_at,
    ),
    expectedAllocation: data("expected allocation", allocationResult),
  };
}

function validate(state) {
  assert(state.invoice.invoice_number === INVOICE_NUMBER, "Invoice number changed.");
  assert(state.invoice.contact?.name === SUPPLIER, "Supplier identity changed.");
  assert(state.invoice.direction === "payable" && state.invoice.category === "labour", "Invoice is not a payable labour invoice.");
  assert(state.invoice.source_system === "gmail_contractor_invoice", "Invoice source changed.");
  assert(state.invoice.status === "recorded", "Invoice status changed.");
  assert(Number(state.invoice.subtotal_cents) === SUBTOTAL_CENTS, "Invoice subtotal changed.");
  assert(Number(state.invoice.tax_cents) === TAX_CENTS, "Invoice tax changed.");
  assert(Number(state.invoice.total_cents) === TOTAL_CENTS, "Invoice total changed.");
  assert(Number(state.invoice.paid_cents) === 0 && Number(state.invoice.balance_cents) === TOTAL_CENTS, "Invoice is no longer fully unpaid.");
  assert(state.invoice.metadata?.source_document_sha256 === SOURCE_SHA256, "Invoice source hash changed.");
  assert(state.line.invoice_id === INVOICE_ID && Number(state.line.line_number) === 1, "Invoice line identity changed.");
  assert(state.line.description.includes(CUSTOMER) && state.line.description.includes(PRINTED_ADDRESS), "Printed customer or address is missing from the invoice line.");
  assert(Number(state.line.subtotal_cents) === SUBTOTAL_CENTS && Number(state.line.total_cents) === TOTAL_CENTS, "Invoice line totals changed.");
  assert(state.document.content_sha256 === SOURCE_SHA256, "Archived document hash changed.");
  assert(state.document.storage_path === SOURCE_DOCUMENT_PATH, "Archived document path changed.");
  assert(state.job.name === CUSTOMER && state.job.contact_id === JOB_CONTACT_ID, "Job identity changed.");
  assert(state.job.accepted_quote_id === QUOTE_ID && state.job.source === "dripjobs", "Job is not the expected DripJobs proposal job.");
  assert(!historicalLocked(state.job), `Job is locked by the ${ACCOUNTING_CUTOFF} historical cutoff.`);
  assert(state.customer.name === CUSTOMER && state.customer.kind === "customer", "Customer identity changed.");
  assert(state.quote.dripjobs_proposal_id === PROPOSAL_ID && state.quote.status === "accepted", "DripJobs proposal identity changed.");
  assert(state.exactNameCandidates.length === 1 && state.exactNameCandidates[0].id === JOB_ID, "Printed customer name is not unique across jobs.");
  assert(state.invoiceAllocations.length <= 1, "Invoice has an unexpected extra active job allocation.");
  if (state.invoiceAllocations.length === 1) {
    assert(state.invoiceAllocations[0].id === allocationId, "Invoice is allocated to an unexpected job.");
  }
}

function fullyResolved(state) {
  const allocation = state.expectedAllocation;
  return Boolean(
    allocation &&
      !allocation.metadata?.reversed_at &&
      allocation.invoice_id === INVOICE_ID &&
      allocation.invoice_line_id === INVOICE_LINE_ID &&
      allocation.job_id === JOB_ID &&
      Number(allocation.subtotal_cents) === SUBTOTAL_CENTS &&
      Number(allocation.tax_cents) === TAX_CENTS &&
      Number(allocation.total_cents) === TOTAL_CENTS &&
      allocation.needs_review === false &&
      state.invoice.metadata?.match_status === "assigned" &&
      state.invoice.metadata?.job_assignment_status === "fully_assigned" &&
      Number(state.invoice.metadata?.job_assignment_count) === 1 &&
      Number(state.invoice.metadata?.unassigned_line_count) === 0 &&
      Number(state.line.quantity) === HOURS &&
      state.line.unit === "hours" &&
      Number(state.line.unit_price_cents) === HOURLY_RATE_CENTS
  );
}

const before = await loadState();
validate(before);
console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  invoice: {
    id: INVOICE_ID,
    number: INVOICE_NUMBER,
    supplier: SUPPLIER,
    subtotal_cents: SUBTOTAL_CENTS,
    tax_cents: TAX_CENTS,
    total_cents: TOTAL_CENTS,
    printed_hours: HOURS,
    printed_rate_cents: HOURLY_RATE_CENTS,
    printed_customer: CUSTOMER,
    printed_address: PRINTED_ADDRESS,
    source_sha256: SOURCE_SHA256,
  },
  unique_job_match: {
    id: JOB_ID,
    name: before.job.name,
    status: before.job.status,
    started_on: before.job.started_on,
    completed_on: before.job.completed_on,
    proposal_id: before.quote.dripjobs_proposal_id,
    match_method: "exact_unique_printed_customer_name",
    historical_lock: false,
  },
  allocation: {
    id: allocationId,
    subtotal_cents: SUBTOTAL_CENTS,
    tax_cents: TAX_CENTS,
    total_cents: TOTAL_CENTS,
    minutes: HOURS * 60,
  },
  already_resolved: fullyResolved(before),
}, null, 2));

if (!APPLY || fullyResolved(before)) process.exit(0);

const now = new Date().toISOString();
const reason = `Invoice #${INVOICE_NUMBER} prints ${CUSTOMER} at ${PRINTED_ADDRESS}. ${CUSTOMER} is the single exact current DripJobs job-name match (proposal ${PROPOSAL_ID}); the job is active and is not historical-locked.`;

data("job allocation", await db.from("invoice_job_allocations").upsert({
  id: allocationId,
  invoice_id: INVOICE_ID,
  invoice_line_id: INVOICE_LINE_ID,
  job_id: JOB_ID,
  subtotal_cents: SUBTOTAL_CENTS,
  tax_cents: TAX_CENTS,
  total_cents: TOTAL_CENTS,
  quantity: 1,
  minutes: HOURS * 60,
  allocation_method: "exact_printed_customer_name",
  confidence: 1,
  needs_review: false,
  metadata: {
    source_document_id: DOCUMENT_ID,
    source_document_sha256: SOURCE_SHA256,
    printed_description: `Paint & Plaster - ${CUSTOMER} - ${PRINTED_ADDRESS}`,
    printed_customer_name: CUSTOMER,
    printed_address: PRINTED_ADDRESS,
    printed_match_type: "customer_name",
    printed_match_value: CUSTOMER,
    dripjobs_proposal_id: PROPOSAL_ID,
    repair_reason: reason,
  },
  created_at: before.expectedAllocation?.created_at ?? now,
  updated_at: now,
}, { onConflict: "id" }));

const lineUpdate = await db.from("invoice_lines").update({
  quantity: HOURS,
  unit: "hours",
  unit_price_cents: HOURLY_RATE_CENTS,
  metadata: {
    ...(before.line.metadata ?? {}),
    needs_review: false,
    job_allocation_required: true,
    entry_type: "labour",
    printed_hours: HOURS,
    hourly_rate_cents: HOURLY_RATE_CENTS,
    printed_customer_name: CUSTOMER,
    printed_address: PRINTED_ADDRESS,
    printed_match_type: "customer_name",
    printed_match_value: CUSTOMER,
    matched_job_id: JOB_ID,
    dripjobs_proposal_id: PROPOSAL_ID,
    job_match_method: "exact_unique_printed_customer_name",
  },
  updated_at: now,
}).eq("id", INVOICE_LINE_ID).eq("updated_at", before.line.updated_at).select("id").maybeSingle();
if (lineUpdate.error) throw lineUpdate.error;
if (!lineUpdate.data) throw new Error("Concurrent invoice-line update; stopped.");

const invoiceUpdate = await db.from("invoices").update({
  metadata: {
    ...(before.invoice.metadata ?? {}),
    match_status: "assigned",
    job_assignment_status: "fully_assigned",
    job_assignment_count: 1,
    unassigned_line_count: 0,
    assignment_resolution: {
      status: "resolved",
      resolved_at: now,
      method: "exact_unique_printed_customer_name",
      job_id: JOB_ID,
      customer_name: CUSTOMER,
      printed_address: PRINTED_ADDRESS,
      dripjobs_proposal_id: PROPOSAL_ID,
      source_document_id: DOCUMENT_ID,
      source_document_sha256: SOURCE_SHA256,
      reason,
    },
  },
  updated_at: now,
}).eq("id", INVOICE_ID).eq("updated_at", before.invoice.updated_at).select("id").maybeSingle();
if (invoiceUpdate.error) throw invoiceUpdate.error;
if (!invoiceUpdate.data) throw new Error("Concurrent invoice update; stopped.");

data("verification event", await db.from("verification_events").upsert({
  id: verificationId,
  entity_type: "invoice",
  entity_id: INVOICE_ID,
  action: "invoice_line_linked_to_job",
  reason,
  old_values: {
    match_status: before.invoice.metadata?.match_status ?? null,
    job_assignment_status: before.invoice.metadata?.job_assignment_status ?? null,
    job_assignment_count: before.invoice.metadata?.job_assignment_count ?? 0,
    unassigned_line_count: before.invoice.metadata?.unassigned_line_count ?? 1,
    line_quantity: before.line.quantity,
    line_unit: before.line.unit,
    line_unit_price_cents: before.line.unit_price_cents,
  },
  new_values: {
    match_status: "assigned",
    job_assignment_status: "fully_assigned",
    job_assignment_count: 1,
    unassigned_line_count: 0,
    job_id: JOB_ID,
    job_name: CUSTOMER,
    dripjobs_proposal_id: PROPOSAL_ID,
    line_quantity: HOURS,
    line_unit: "hours",
    line_unit_price_cents: HOURLY_RATE_CENTS,
    allocated_subtotal_cents: SUBTOTAL_CENTS,
    allocated_total_cents: TOTAL_CENTS,
  },
  evidence: {
    document_id: DOCUMENT_ID,
    content_sha256: SOURCE_SHA256,
    printed_customer_name: CUSTOMER,
    printed_address: PRINTED_ADDRESS,
    exact_name_candidate_count: before.exactNameCandidates.length,
  },
  performed_by: null,
  occurred_at: now,
}, { onConflict: "id" }));

const after = await loadState();
validate(after);
assert(fullyResolved(after), "Invoice #8615 job assignment did not verify after apply.");
console.log(JSON.stringify({
  status: "verified",
  invoice_id: INVOICE_ID,
  invoice_number: INVOICE_NUMBER,
  supplier: SUPPLIER,
  job: {
    id: JOB_ID,
    name: CUSTOMER,
    proposal_id: PROPOSAL_ID,
    status: after.job.status,
    production_month: after.job.production_month,
  },
  printed_work: {
    hours: HOURS,
    hourly_rate_cents: HOURLY_RATE_CENTS,
    subtotal_cents: SUBTOTAL_CENTS,
    tax_cents: TAX_CENTS,
    total_cents: TOTAL_CENTS,
  },
  job_assignment_status: after.invoice.metadata.job_assignment_status,
  allocation_id: allocationId,
}, null, 2));
