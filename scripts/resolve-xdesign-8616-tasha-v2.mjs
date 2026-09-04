#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { jobAccountingLockReason } from "./lib/dripjobs-job-authority.mjs";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const RESOLVED_AT = "2026-08-27T18:31:07.000Z";
const INVOICE_ID = "f2ca9fa9-e5b7-50dd-809f-4421160d638d";
const LINE_ID = "f5ef049c-90e1-54f8-9454-5c7d43858f95";
const JOB_ID = "76f23ac5-0a28-5268-9175-672cec8d1716";
const SOURCE_DOCUMENT_ID = "6474df1e-ed47-57f0-868b-0489f5fd1ca3";
const SOURCE_SHA256 = "2f295d81f87c5cb877e8e4e3aa58e200966976e5e2c257b530c4391021722b73";
const ALLOCATION_ID = stableUuid(`invoice-job-allocation:${LINE_ID}:${JOB_ID}`);
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

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing Supabase credentials.");
assert(new URL(supabaseUrl).hostname.split(".")[0] === PROJECT_REF, "Unexpected Supabase project.");
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [invoiceResult, lineResult, jobsResult, documentResult, allocationsResult] = await Promise.all([
  db.from("invoices").select("*").eq("id", INVOICE_ID).single(),
  db.from("invoice_lines").select("*").eq("id", LINE_ID).single(),
  db.from("jobs").select("*").eq("name", "Tasha Thornton"),
  db.from("documents").select("*").eq("id", SOURCE_DOCUMENT_ID).single(),
  db.from("invoice_job_allocations").select("*").eq("invoice_id", INVOICE_ID),
]);
for (const result of [invoiceResult, lineResult, jobsResult, documentResult, allocationsResult]) {
  if (result.error) throw result.error;
}

const invoice = invoiceResult.data;
const line = lineResult.data;
const document = documentResult.data;
const exactJobs = jobsResult.data ?? [];
const existingAllocations = allocationsResult.data ?? [];

assert(invoice.invoice_number === "8616", "Unexpected invoice number.");
assert(invoice.contact_id === "ac2a71c8-5082-5bad-af43-d785ed98b30a", "Unexpected XDesign supplier.");
assert(invoice.issued_on === "2026-08-20", "Unexpected invoice date.");
assert(Number(invoice.subtotal_cents) === 36_000 && Number(invoice.tax_cents) === 4_680 && Number(invoice.total_cents) === 40_680, "Unexpected invoice totals.");
assert(Number(invoice.paid_cents) === 0 && Number(invoice.balance_cents) === 40_680, "Invoice payment state changed unexpectedly.");
assert(line.invoice_id === INVOICE_ID, "Invoice line belongs to another invoice.");
assert(line.description === "Paint & Plaster - Tasha Thornton - 197 Lisgar Street", "Unexpected printed invoice description.");
assert(Number(line.subtotal_cents) === 36_000 && Number(line.tax_cents) === 4_680 && Number(line.total_cents) === 40_680, "Unexpected line totals.");
assert(document.content_sha256 === SOURCE_SHA256 && document.mime_type === "application/pdf", "Archived physical invoice evidence changed.");
assert(exactJobs.length === 1, `Expected one exact Tasha Thornton job, found ${exactJobs.length}.`);
const job = exactJobs[0];
assert(job.id === JOB_ID, "The unique Tasha Thornton job identity changed.");
assert(job.started_on === "2026-08-20", "Tasha job start date no longer matches the invoice date.");
assert(job.production_month === "2026-08-01", "Tasha job has no verified August production month.");
assert(job.metadata?.dripjobs_operational_authority?.deal_stage === "Work Finished", "Tasha job is no longer at the verified Work Finished stage.");
assert(!jobAccountingLockReason(job), `Historical accounting lock: ${jobAccountingLockReason(job)}`);

const expectedAllocation = {
  id: ALLOCATION_ID,
  invoice_id: INVOICE_ID,
  invoice_line_id: LINE_ID,
  job_id: JOB_ID,
  subtotal_cents: 36_000,
  tax_cents: 4_680,
  total_cents: 40_680,
  quantity: 1,
  minutes: null,
  allocation_method: "exact_printed_name_and_coherent_service_date",
  confidence: 1,
  needs_review: false,
  metadata: {
    printed_match_type: "name",
    printed_match_value: "Tasha Thornton",
    printed_address: "197 Lisgar Street",
    printed_description: "Paint & Plaster - Tasha Thornton - 197 Lisgar Street",
    printed_hours: { wednesday: 8, thursday: 4, total: 12 },
    source_document_id: SOURCE_DOCUMENT_ID,
    source_document_sha256: SOURCE_SHA256,
    source_gmail_message_id: "1a0214498d244f39",
    job_evidence: {
      proposal_id: "3180786",
      started_on: "2026-08-20",
      scheduled_on: "2026-08-19",
      deal_stage: "Work Finished",
      deal_stage_date: "2026-08-26",
    },
    resolution_reason: "The archived XDesign PDF prints Tasha Thornton and 197 Lisgar Street. There is exactly one current DripJobs job named Tasha Thornton; it started on the invoice date and its schedule covers the printed work dates.",
    resolved_at: RESOLVED_AT,
  },
  created_at: RESOLVED_AT,
  updated_at: RESOLVED_AT,
};

const alreadyApplied = existingAllocations.length === 1 &&
  existingAllocations[0].id === ALLOCATION_ID &&
  existingAllocations[0].job_id === JOB_ID &&
  Number(existingAllocations[0].subtotal_cents) === 36_000 &&
  !existingAllocations[0].needs_review;
assert(existingAllocations.length === 0 || alreadyApplied, `Unexpected existing job allocations: ${JSON.stringify(existingAllocations)}`);

const invoiceMetadata = {
  ...(invoice.metadata ?? {}),
  match_status: "assigned",
  job_assignment_count: 1,
  job_assignment_status: "fully_assigned",
  unassigned_line_count: 0,
  assignment_resolution: {
    status: "resolved",
    method: "exact_unique_printed_customer_name_and_coherent_service_date",
    job_id: JOB_ID,
    customer_name: "Tasha Thornton",
    printed_address: "197 Lisgar Street",
    source_document_id: SOURCE_DOCUMENT_ID,
    source_document_sha256: SOURCE_SHA256,
    dripjobs_proposal_id: "3180786",
    resolved_at: RESOLVED_AT,
    reason: expectedAllocation.metadata.resolution_reason,
  },
};
const lineMetadata = {
  ...(line.metadata ?? {}),
  printed_match_type: "name",
  printed_match_value: "Tasha Thornton",
  assignment_resolution: invoiceMetadata.assignment_resolution,
};

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  already_applied: alreadyApplied,
  invoice: {
    id: INVOICE_ID,
    invoice_number: invoice.invoice_number,
    supplier: "XDesign Dev Inc",
    total_cents: invoice.total_cents,
    payment_status: "unpaid",
  },
  physical_invoice: {
    filename: document.original_filename,
    sha256: SOURCE_SHA256,
    printed_customer: "Tasha Thornton",
    printed_address: "197 Lisgar Street",
    printed_hours: 12,
  },
  target_job: {
    id: job.id,
    name: job.name,
    started_on: job.started_on,
    production_month: job.production_month,
    deal_stage: job.metadata?.dripjobs_operational_authority?.deal_stage,
    proposal_id: job.metadata?.dripjobs_operational_authority?.proposal_id,
  },
  allocation: expectedAllocation,
}, null, 2));

if (!APPLY || alreadyApplied) process.exit();

const allocationWrite = await db.from("invoice_job_allocations").insert(expectedAllocation);
if (allocationWrite.error) throw allocationWrite.error;

const invoiceWrite = await db.from("invoices").update({
  metadata: invoiceMetadata,
  updated_at: RESOLVED_AT,
}).eq("id", INVOICE_ID).eq("updated_at", invoice.updated_at).select("id").maybeSingle();
if (invoiceWrite.error) throw invoiceWrite.error;
assert(invoiceWrite.data, "Concurrent invoice update detected.");

const lineWrite = await db.from("invoice_lines").update({
  metadata: lineMetadata,
  updated_at: RESOLVED_AT,
}).eq("id", LINE_ID).eq("updated_at", line.updated_at).select("id").maybeSingle();
if (lineWrite.error) throw lineWrite.error;
assert(lineWrite.data, "Concurrent invoice-line update detected.");

const verificationWrite = await db.from("verification_events").upsert({
  id: stableUuid(`verification:invoice-job-allocation:${INVOICE_ID}:${JOB_ID}`),
  entity_type: "invoice",
  entity_id: INVOICE_ID,
  action: "job_allocation_resolved",
  reason: expectedAllocation.metadata.resolution_reason,
  old_values: {
    job_assignment_count: Number(invoice.metadata?.job_assignment_count ?? 0),
    job_assignment_status: invoice.metadata?.job_assignment_status ?? null,
    unassigned_line_count: Number(invoice.metadata?.unassigned_line_count ?? 0),
  },
  new_values: {
    job_assignment_count: 1,
    job_assignment_status: "fully_assigned",
    unassigned_line_count: 0,
    job_id: JOB_ID,
    allocated_subtotal_cents: 36_000,
  },
  evidence: {
    source_document_id: SOURCE_DOCUMENT_ID,
    source_document_sha256: SOURCE_SHA256,
    invoice_line_id: LINE_ID,
    invoice_job_allocation_id: ALLOCATION_ID,
    printed_customer: "Tasha Thornton",
    printed_address: "197 Lisgar Street",
    dripjobs_proposal_id: "3180786",
  },
  occurred_at: RESOLVED_AT,
}, { onConflict: "id" });
if (verificationWrite.error) throw verificationWrite.error;

const verifiedResult = await db.from("invoices").select("id,metadata,job_allocations:invoice_job_allocations(*)").eq("id", INVOICE_ID).single();
if (verifiedResult.error) throw verifiedResult.error;
const verified = verifiedResult.data;
assert(verified.job_allocations.length === 1, "Expected one stored job allocation.");
assert(verified.job_allocations[0].job_id === JOB_ID && Number(verified.job_allocations[0].subtotal_cents) === 36_000, "Stored allocation verification failed.");
assert(verified.metadata?.job_assignment_status === "fully_assigned" && Number(verified.metadata?.unassigned_line_count) === 0, "Invoice readiness metadata verification failed.");

console.log(JSON.stringify({
  status: "verified",
  invoice_id: INVOICE_ID,
  invoice_number: "8616",
  allocation_id: ALLOCATION_ID,
  job_id: JOB_ID,
  allocated_subtotal_cents: 36_000,
  allocated_total_cents: 40_680,
  job_assignment_status: verified.metadata.job_assignment_status,
}, null, 2));
