#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ACCOUNTING_CUTOFF = "2026-06-01";
const confirmedAt = new Date().toISOString();
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const mappings = [
  {
    invoiceId: "7e912a37-e970-525a-9767-ca92e994ade6",
    invoiceNumber: "13",
    lineId: "cb6eeb74-b7da-5fc5-ba94-01cd6b817db9",
    jobId: "4cb883f3-58e6-5fa0-861a-05680f692bd3",
    printedValue: "Wardah Vacher",
    expectedJobName: "Wardah Vacher - 2026-07-04T13:26:59.99",
    allocationMethod: "user_confirmed_similar_name",
    confirmation: "User confirmed that the similar stored job name is the intended Wardah Vacher job.",
  },
  {
    invoiceId: "5143bd08-f5ee-5dcf-ab53-690a2234fd7a",
    invoiceNumber: "12",
    lineId: "07d4c781-b439-5ebd-a8f4-1cb73aed190b",
    jobId: "7b11cfde-5772-5682-a09f-2061255fa01a",
    printedValue: "Darya Raffi",
    expectedJobName: "Darya Rafi",
    allocationMethod: "user_confirmed_similar_name",
    confirmation: "User confirmed Darya Raffi maps to the stored Darya Rafi job.",
  },
  {
    invoiceId: "16dc1732-d34a-5eb7-b5ac-d4a9ee52d3c6",
    invoiceNumber: "11",
    lineId: "cdbfd9e8-2c37-560b-a373-5fc287b96f28",
    jobId: "bd28a7cb-d6a7-5467-960c-966696416d09",
    printedValue: "Lesley",
    expectedJobName: "Lesley Lesley",
    allocationMethod: "user_confirmed_similar_name",
    confirmation: "User confirmed Lesley maps to the stored Lesley Lesley job.",
  },
  {
    invoiceId: "bf94e774-373b-5ce9-b44e-44558017152a",
    invoiceNumber: "INV-20260829-001",
    lineId: "6e15b5f7-cc4f-503a-aca8-5ea352f6c971",
    jobId: "b66f4fa0-d463-5c6e-8442-e40a75122327",
    printedValue: "1 White Cedar street",
    expectedJobName: "Erin zuber",
    allocationMethod: "user_confirmed_printed_address_over_wrong_name",
    confirmation: "User confirmed the invoice has the wrong customer name and must be mapped by its printed 1 White Cedar address to Erin Zuber.",
  },
];

function parseEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, index).trim()] = value;
  }
  return out;
}

function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function data(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const env = {
  ...parseEnv(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnv(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
assert(supabaseUrl && env.SUPABASE_SERVICE_ROLE_KEY, "Missing server-side Supabase credentials.");
assert(new URL(supabaseUrl).hostname.split(".")[0] === PROJECT_REF, "Unexpected Supabase project.");
const db = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const [invoiceRows, lineRows, jobRows, allocationRows] = await Promise.all([
  db.from("invoices").select("id,invoice_number,status,subtotal_cents,tax_cents,total_cents,paid_cents,balance_cents,metadata").in("id", mappings.map((row) => row.invoiceId)),
  db.from("invoice_lines").select("id,invoice_id,subtotal_cents,tax_cents,total_cents,metadata").in("id", mappings.map((row) => row.lineId)),
  db.from("jobs").select("id,name,status,started_on,completed_on,archived_at,production_month,formatted_address").in("id", mappings.map((row) => row.jobId)),
  db.from("invoice_job_allocations").select("id,invoice_id,invoice_line_id,job_id,subtotal_cents,tax_cents,total_cents,needs_review,metadata").in("invoice_line_id", mappings.map((row) => row.lineId)),
]);
for (const [label, result] of Object.entries({ invoiceRows, lineRows, jobRows, allocationRows })) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
assert(invoiceRows.data.length === mappings.length, "A target invoice is missing.");
assert(lineRows.data.length === mappings.length, "A target invoice line is missing.");
assert(jobRows.data.length === mappings.length, "A confirmed target job is missing.");

const plans = mappings.map((mapping) => {
  const invoice = invoiceRows.data.find((row) => row.id === mapping.invoiceId);
  const line = lineRows.data.find((row) => row.id === mapping.lineId);
  const job = jobRows.data.find((row) => row.id === mapping.jobId);
  assert(invoice.invoice_number === mapping.invoiceNumber, `Invoice identity changed for ${mapping.invoiceNumber}.`);
  assert(line.invoice_id === invoice.id, `Line identity changed for ${mapping.invoiceNumber}.`);
  assert(job.name === mapping.expectedJobName, `Job identity changed for ${mapping.printedValue}.`);
  assert(!job.archived_at && !["archived", "cancelled", "canceled"].includes(String(job.status).toLowerCase()), `${job.name} is not an eligible current job.`);
  assert(!job.started_on || job.started_on >= ACCOUNTING_CUTOFF, `${job.name} is locked by the historical accounting cutoff.`);
  assert(job.started_on || !["completed", "archived"].includes(String(job.status).toLowerCase()), `${job.name} has no verified current date.`);
  const existing = allocationRows.data.filter((row) => row.invoice_line_id === line.id && !row.metadata?.reversed_at);
  assert(existing.length <= 1, `Line ${mapping.invoiceNumber} has multiple active allocations.`);
  if (existing.length === 1) {
    assert(existing[0].job_id === job.id && Number(existing[0].subtotal_cents) === Number(line.subtotal_cents), `Line ${mapping.invoiceNumber} already has a conflicting allocation.`);
  }
  return { mapping, invoice, line, job, existing: existing[0] ?? null };
});

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  mappings: plans.map(({ mapping, invoice, line, job, existing }) => ({
    invoice_number: invoice.invoice_number,
    printed_value: mapping.printedValue,
    job: job.name,
    production_month: job.production_month,
    subtotal_cents: Number(line.subtotal_cents),
    total_cents: Number(line.total_cents),
    allocation_method: mapping.allocationMethod,
    already_applied: Boolean(existing),
  })),
}, null, 2));
if (!APPLY) process.exit(0);

for (const { mapping, invoice, line, job, existing } of plans) {
  const allocationId = existing?.id ?? stableUuid(`invoice-job-allocation:${line.id}:${job.id}`);
  if (!existing) {
    data(`allocation ${invoice.invoice_number}`, await db.from("invoice_job_allocations").insert({
      id: allocationId,
      invoice_id: invoice.id,
      invoice_line_id: line.id,
      job_id: job.id,
      subtotal_cents: line.subtotal_cents,
      tax_cents: line.tax_cents,
      total_cents: line.total_cents,
      quantity: 1,
      allocation_method: mapping.allocationMethod,
      confidence: 1,
      needs_review: false,
      metadata: {
        source_document_id: invoice.metadata?.source_document_id,
        source_document_sha256: invoice.metadata?.source_document_sha256,
        source_gmail_message_id: invoice.metadata?.source_gmail_message_id,
        printed_match_value: mapping.printedValue,
        user_confirmation: mapping.confirmation,
        user_confirmed_at: confirmedAt,
      },
      created_at: confirmedAt,
      updated_at: confirmedAt,
    }));
  }

  data(`line ${invoice.invoice_number}`, await db.from("invoice_lines").update({
    metadata: {
      ...(line.metadata ?? {}),
      needs_review: false,
      printed_match_type: mapping.allocationMethod,
      printed_match_value: mapping.printedValue,
      prior_review_reason: line.metadata?.review_reason ?? null,
      review_reason: null,
      user_confirmation: mapping.confirmation,
      user_confirmed_at: confirmedAt,
    },
    updated_at: confirmedAt,
  }).eq("id", line.id));

  data(`invoice ${invoice.invoice_number}`, await db.from("invoices").update({
    metadata: {
      ...(invoice.metadata ?? {}),
      match_status: "assigned",
      job_assignment_status: "fully_assigned",
      job_assignment_count: 1,
      unassigned_line_count: 0,
      user_confirmed_job_mapping_at: confirmedAt,
    },
    updated_at: confirmedAt,
  }).eq("id", invoice.id));

  data(`verification ${invoice.invoice_number}`, await db.from("verification_events").upsert({
    id: stableUuid(`verification:user-confirmed-job-mapping:${invoice.id}:${line.id}:${job.id}`),
    entity_type: "invoice",
    entity_id: invoice.id,
    action: "invoice_job_mapping_user_confirmed",
    reason: mapping.confirmation,
    old_values: { line_needs_review: true, job_assignment_status: invoice.metadata?.job_assignment_status ?? "unassigned" },
    new_values: { line_needs_review: false, job_id: job.id, job_name: job.name, allocation_id: allocationId, allocation_method: mapping.allocationMethod },
    evidence: { user_confirmation_date: "2026-09-01", printed_match_value: mapping.printedValue, source_gmail_message_id: invoice.metadata?.source_gmail_message_id, source_document_sha256: invoice.metadata?.source_document_sha256 },
    performed_by: null,
    occurred_at: confirmedAt,
  }, { onConflict: "id" }));
}

const verified = data("verification", await db.from("invoices")
  .select("id,invoice_number,total_cents,paid_cents,balance_cents,metadata,lines:invoice_lines(id,subtotal_cents,tax_cents,total_cents,metadata),allocations:invoice_job_allocations(id,invoice_line_id,job_id,subtotal_cents,tax_cents,total_cents,allocation_method,needs_review,job:jobs(name,status,started_on,production_month)),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,amount_cents,reversed_at)")
  .in("id", mappings.map((row) => row.invoiceId))
  .order("invoice_number"));
assert(verified.length === mappings.length, "Not all resolved invoices were returned.");
for (const invoice of verified) {
  assert(invoice.allocations.length === 1, `Invoice ${invoice.invoice_number} does not have exactly one job allocation.`);
  assert(Number(invoice.allocations[0].total_cents) === Number(invoice.total_cents), `Invoice ${invoice.invoice_number} allocation does not equal its total.`);
  assert(invoice.allocations[0].needs_review === false, `Invoice ${invoice.invoice_number} allocation is still under review.`);
  assert(invoice.lines.every((line) => line.metadata?.needs_review === false), `Invoice ${invoice.invoice_number} line is still under review.`);
  assert((invoice.payments ?? []).filter((payment) => !payment.reversed_at).length === 0, `Invoice ${invoice.invoice_number} unexpectedly has payment evidence.`);
}
console.log(JSON.stringify({ applied: true, invoices: verified }, null, 2));
