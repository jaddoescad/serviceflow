#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const OLD_INVOICE_ID = "9e7fa4b5-a4dd-515a-91ed-05b6b70b674c";
const OLD_LINE_ID = "eaf37918-2a8c-594c-a0ee-227637e18e40";
const OLD_ALLOCATION_ID = "c5e87cc5-ab9d-5498-9461-55f9ea27f73c";
const JOB_ID = "b0bc0dba-9412-50de-afb8-d26899e4330f";
const INVOICE_NUMBER = "8614";
const GMAIL_MESSAGE_ID = "1a0124be864c6653";
const ATTACHMENT_INDEX = 1;
const PDF_PATH = path.resolve(
  process.argv.find((value) => value.startsWith("--pdf="))?.slice(6) ??
    "/Users/jadslim/.workspace-mcp/attachments/Invoice_8614_2026-08-15_ce52f455.pdf",
);
const SOURCE_URL = `https://mail.google.com/mail/u/0/#all/${GMAIL_MESSAGE_ID}`;
const SOURCE_SHA256 = "135dfaa08219c9914864e45eb1d0430cd24671551b2dbe0e103a2936670af838";
const OLD_SHA256 = "2af9b6f716b6753a44775b4129a96edf28c50a22a4abb112fd9300ae3312702a";
const SUBTOTAL_CENTS = 114_000;
const TAX_CENTS = 14_820;
const TOTAL_CENTS = 128_820;
const HOURS = 38;
const HOURLY_RATE_CENTS = 3_000;

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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function data(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

assert(existsSync(PDF_PATH), `Updated invoice PDF not found: ${PDF_PATH}`);
const pdf = readFileSync(PDF_PATH);
const pdfSha256 = sha256(pdf);
assert(pdfSha256 === SOURCE_SHA256, `Updated PDF hash changed: ${pdfSha256}`);
assert(HOURS * HOURLY_RATE_CENTS === SUBTOTAL_CENTS, "Hours do not reconcile to subtotal.");
assert(SUBTOTAL_CENTS + TAX_CENTS === TOTAL_CENTS, "Invoice total does not reconcile.");

const invoiceId = stableUuid(`invoice:gmail_contractor_invoice:sha256:${SOURCE_SHA256}`);
const documentId = stableUuid(`document:sha256:${SOURCE_SHA256}`);
const lineId = stableUuid(`invoice-line:${invoiceId}:1`);
const allocationId = stableUuid(`invoice-job-allocation:${lineId}:${JOB_ID}`);
const evidenceId = stableUuid(`evidence-link:${documentId}:invoice:${invoiceId}`);
const storagePath = `gmail-contractor-invoices/2026-08-15/${SOURCE_SHA256.slice(0, 16)}-Invoice_8614_2026-08-15.pdf`;

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
  const [oldInvoiceResult, newInvoiceResult, oldLineResult, oldAllocationResult, jobResult, oldEvidenceResult, paymentResult] = await Promise.all([
    db.from("invoices").select("*").eq("id", OLD_INVOICE_ID).single(),
    db.from("invoices").select("*").eq("id", invoiceId).maybeSingle(),
    db.from("invoice_lines").select("*").eq("id", OLD_LINE_ID).single(),
    db.from("invoice_job_allocations").select("*").eq("id", OLD_ALLOCATION_ID).single(),
    db.from("jobs").select("id,name,status,started_on,completed_on,archived_at,production_month").eq("id", JOB_ID).single(),
    db.from("evidence_links").select("*").eq("entity_type", "invoice").eq("entity_id", OLD_INVOICE_ID),
    db.from("transaction_allocations").select("id,invoice_id,reversed_at").eq("invoice_id", OLD_INVOICE_ID).is("reversed_at", null),
  ]);
  return {
    oldInvoice: data("old invoice", oldInvoiceResult),
    newInvoice: data("new invoice", newInvoiceResult),
    oldLine: data("old line", oldLineResult),
    oldAllocation: data("old allocation", oldAllocationResult),
    job: data("job", jobResult),
    oldEvidence: data("old evidence", oldEvidenceResult),
    activePayments: data("payment allocations", paymentResult),
  };
}

function validate(state) {
  assert(state.oldInvoice.invoice_number === INVOICE_NUMBER, "Old invoice number changed.");
  assert(state.oldInvoice.source_system === "gmail_contractor_invoice", "Old invoice source changed.");
  assert(state.oldInvoice.direction === "payable" && state.oldInvoice.category === "labour", "Old invoice is not a payable labour invoice.");
  assert(state.oldInvoice.contact_id, "Old invoice supplier is missing.");
  assert(state.oldInvoice.metadata?.source_document_sha256 === OLD_SHA256, "Old source PDF hash changed.");
  assert(state.oldLine.invoice_id === OLD_INVOICE_ID, "Old invoice line identity changed.");
  assert(state.oldAllocation.invoice_id === OLD_INVOICE_ID && state.oldAllocation.job_id === JOB_ID, "Old job allocation identity changed.");
  assert(state.job.name === "Sherrie Egan", "Sherrie Egan job identity changed.");
  assert(state.job.production_month == null, "Production month changed; stop and recalculate readiness before applying.");
  assert(state.activePayments.length === 0, "Invoice #8614 has a live payment allocation and cannot be revised as unpaid.");

  const alreadySuperseded =
    state.oldInvoice.status === "supporting_document" &&
    state.oldInvoice.metadata?.superseded_by_invoice_id === invoiceId &&
    state.oldAllocation.metadata?.reversed_at;
  if (!alreadySuperseded) {
    assert(state.oldInvoice.status === "recorded", "Old invoice status changed.");
    assert(Number(state.oldInvoice.subtotal_cents) === 102_000, "Old subtotal changed.");
    assert(Number(state.oldInvoice.tax_cents) === 13_260, "Old tax changed.");
    assert(Number(state.oldInvoice.total_cents) === 115_260, "Old total changed.");
    assert(Number(state.oldInvoice.paid_cents) === 0 && Number(state.oldInvoice.balance_cents) === 115_260, "Old payment state changed.");
    assert(!state.oldAllocation.metadata?.reversed_at, "Old allocation is unexpectedly reversed.");
  }
  return { alreadySuperseded };
}

const before = await loadState();
const preconditions = validate(before);
console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  old_invoice: { id: OLD_INVOICE_ID, total_cents: Number(before.oldInvoice.total_cents), preserved_as_superseded_evidence: true },
  updated_invoice: { id: invoiceId, invoice_number: INVOICE_NUMBER, subtotal_cents: SUBTOTAL_CENTS, tax_cents: TAX_CENTS, total_cents: TOTAL_CENTS, hours: HOURS, already_exists: Boolean(before.newInvoice) },
  job: { id: JOB_ID, name: before.job.name, production_month: before.job.production_month },
  payment_state: "unpaid",
  already_superseded: Boolean(preconditions.alreadySuperseded),
}, null, 2));
if (!APPLY || preconditions.alreadySuperseded) process.exit(0);

const now = new Date().toISOString();
const reason = "XDesign resent invoice #8614 after Billy could not finish the project. The authenticated replacement adds four hours, changing labour from 34 to 38 hours and the total from $1,152.60 to $1,288.20. The original is retained as superseded evidence.";

const upload = await db.storage.from("labour-invoices").upload(storagePath, pdf, {
  contentType: "application/pdf",
  cacheControl: "3600",
  upsert: false,
});
if (upload.error && !String(upload.error.message).toLowerCase().includes("already exists")) throw upload.error;

data("updated document", await db.from("documents").upsert({
  id: documentId,
  kind: "labour_invoice",
  original_filename: path.basename(PDF_PATH),
  mime_type: "application/pdf",
  size_bytes: statSync(PDF_PATH).size,
  content_sha256: SOURCE_SHA256,
  storage_bucket: "labour-invoices",
  storage_path: storagePath,
  source_url: SOURCE_URL,
  captured_at: "2026-08-18T00:35:59.000Z",
  metadata: {
    source: "gmail_contractor_invoice",
    gmail_message_id: GMAIL_MESSAGE_ID,
    attachment_index: ATTACHMENT_INDEX,
    supplier_name: "XDesign Dev Inc",
    invoice_number: INVOICE_NUMBER,
    revision_number: 2,
    supersedes_invoice_id: OLD_INVOICE_ID,
  },
  created_at: now,
}, { onConflict: "id" }));

data("updated invoice", await db.from("invoices").upsert({
  id: invoiceId,
  contact_id: before.oldInvoice.contact_id,
  direction: "payable",
  category: "labour",
  source_system: "gmail_contractor_invoice",
  external_id: `sha256:${SOURCE_SHA256}`,
  invoice_number: INVOICE_NUMBER,
  status: "recorded",
  issued_on: "2026-08-15",
  due_on: null,
  currency: "CAD",
  subtotal_cents: SUBTOTAL_CENTS,
  tax_cents: TAX_CENTS,
  total_cents: TOTAL_CENTS,
  paid_cents: 0,
  balance_cents: TOTAL_CENTS,
  metadata: {
    ...before.oldInvoice.metadata,
    match_status: "assigned",
    document_type: "invoice",
    supplier_name: "XDesign Dev Inc",
    source_document_id: documentId,
    source_document_sha256: SOURCE_SHA256,
    source_gmail_message_id: GMAIL_MESSAGE_ID,
    source_gmail_attachment_index: ATTACHMENT_INDEX,
    automatic_import: true,
    payment_status: "unpaid",
    itemization_status: "itemized_from_source",
    job_assignment_status: "fully_assigned",
    job_assignment_count: 1,
    unassigned_line_count: 0,
    company_expense_line_count: 0,
    accounting_status: "active",
    revision_number: 2,
    revision_of_invoice_id: OLD_INVOICE_ID,
    revision_reason: reason,
    original_invoice_total_cents: 115_260,
  },
  created_at: now,
  updated_at: now,
}, { onConflict: "id" }));

data("updated invoice line", await db.from("invoice_lines").upsert({
  id: lineId,
  invoice_id: invoiceId,
  line_number: 1,
  description: "Paint & Plaster - Sherrie Egan - 992 Alenmede Cres (38 hours; includes 4 hours helping Billy finish)",
  quantity: HOURS,
  unit: "hours",
  unit_price_cents: HOURLY_RATE_CENTS,
  subtotal_cents: SUBTOTAL_CENTS,
  tax_cents: TAX_CENTS,
  total_cents: TOTAL_CENTS,
  service_started_on: "2026-08-11",
  service_ended_on: "2026-08-15",
  source_kind: "gmail_contractor_invoice_item",
  metadata: {
    needs_review: false,
    job_allocation_required: true,
    entry_type: "labour",
    source_document_id: documentId,
    source_gmail_message_id: GMAIL_MESSAGE_ID,
    printed_match_type: "customer_name",
    printed_match_value: "Sherrie Egan",
    printed_hours: HOURS,
    hourly_rate_cents: HOURLY_RATE_CENTS,
    source_note: "Billy couldn't finish project; XDesign helped finish it.",
  },
  created_at: now,
  updated_at: now,
}, { onConflict: "id" }));

data("updated job allocation", await db.from("invoice_job_allocations").upsert({
  id: allocationId,
  invoice_id: invoiceId,
  invoice_line_id: lineId,
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
    source_document_id: documentId,
    source_gmail_message_id: GMAIL_MESSAGE_ID,
    printed_description: "Sherrie Egan - 992 Alenmede Cres",
    printed_match_type: "customer_name",
    printed_match_value: "Sherrie Egan",
    revision_of_allocation_id: OLD_ALLOCATION_ID,
  },
  created_at: now,
  updated_at: now,
}, { onConflict: "id" }));

data("updated evidence", await db.from("evidence_links").upsert({
  id: evidenceId,
  document_id: documentId,
  entity_type: "invoice",
  entity_id: invoiceId,
  evidence_role: "primary_invoice",
  metadata: {
    gmail_message_id: GMAIL_MESSAGE_ID,
    attachment_index: ATTACHMENT_INDEX,
    revision_number: 2,
    supersedes_invoice_id: OLD_INVOICE_ID,
  },
  created_at: now,
}, { onConflict: "id" }));

const allocationReversal = await db.from("invoice_job_allocations").update({
  metadata: {
    ...(before.oldAllocation.metadata ?? {}),
    reversed_at: now,
    reversal_reason: reason,
    superseded_by_invoice_id: invoiceId,
    superseded_by_allocation_id: allocationId,
  },
  updated_at: now,
}).eq("id", OLD_ALLOCATION_ID).eq("updated_at", before.oldAllocation.updated_at).select("id").maybeSingle();
if (allocationReversal.error) throw allocationReversal.error;
if (!allocationReversal.data) throw new Error("Concurrent old-allocation update; stopped.");

for (const evidence of before.oldEvidence) {
  data(`superseded evidence ${evidence.id}`, await db.from("evidence_links").update({
    evidence_role: "superseded_invoice",
    metadata: {
      ...(evidence.metadata ?? {}),
      revision_number: 1,
      superseded_by_invoice_id: invoiceId,
      superseded_at: now,
    },
  }).eq("id", evidence.id));
}

const oldInvoiceUpdate = await db.from("invoices").update({
  status: "supporting_document",
  metadata: {
    ...before.oldInvoice.metadata,
    accounting_status: "void",
    payment_status: "not_payable_superseded",
    superseded_by_invoice_id: invoiceId,
    void_reason: reason,
    voided_at: now,
    revision_number: 1,
    superseded_document_sha256: OLD_SHA256,
  },
  updated_at: now,
}).eq("id", OLD_INVOICE_ID).eq("updated_at", before.oldInvoice.updated_at).select("id").maybeSingle();
if (oldInvoiceUpdate.error) throw oldInvoiceUpdate.error;
if (!oldInvoiceUpdate.data) throw new Error("Concurrent old-invoice update; stopped.");

for (const event of [
  {
    id: stableUuid(`verification:invoice-revision-superseded:${OLD_INVOICE_ID}:${SOURCE_SHA256}`),
    entityId: OLD_INVOICE_ID,
    action: "source_revision_superseded",
    oldValues: { status: "recorded", subtotal_cents: 102_000, tax_cents: 13_260, total_cents: 115_260 },
    newValues: { status: "supporting_document", superseded_by_invoice_id: invoiceId },
  },
  {
    id: stableUuid(`verification:invoice-revision-current:${invoiceId}`),
    entityId: invoiceId,
    action: "source_invoice_revised",
    oldValues: { invoice_id: OLD_INVOICE_ID, hours: 34, subtotal_cents: 102_000, tax_cents: 13_260, total_cents: 115_260 },
    newValues: { invoice_number: INVOICE_NUMBER, hours: HOURS, subtotal_cents: SUBTOTAL_CENTS, tax_cents: TAX_CENTS, total_cents: TOTAL_CENTS, paid_cents: 0, balance_cents: TOTAL_CENTS, job_id: JOB_ID },
  },
]) {
  data(`verification ${event.action}`, await db.from("verification_events").upsert({
    id: event.id,
    entity_type: "invoice",
    entity_id: event.entityId,
    action: event.action,
    reason,
    old_values: event.oldValues,
    new_values: event.newValues,
    evidence: { source_url: SOURCE_URL, document_id: documentId, content_sha256: SOURCE_SHA256, gmail_message_id: GMAIL_MESSAGE_ID },
    performed_by: null,
    occurred_at: now,
  }, { onConflict: "id" }));
}

const after = await loadState();
validate(after);
const [lineResult, allocationResult, documentResult, activeInvoicesResult] = await Promise.all([
  db.from("invoice_lines").select("*").eq("id", lineId).single(),
  db.from("invoice_job_allocations").select("*").eq("id", allocationId).single(),
  db.from("documents").select("*").eq("id", documentId).single(),
  db.from("invoices").select("id,status,total_cents").eq("invoice_number", INVOICE_NUMBER).eq("contact_id", before.oldInvoice.contact_id).neq("status", "supporting_document"),
]);
const line = data("verified line", lineResult);
const allocation = data("verified allocation", allocationResult);
const document = data("verified document", documentResult);
const activeInvoices = data("active invoice identity", activeInvoicesResult);

assert(after.newInvoice?.status === "recorded", "Updated invoice is not current.");
assert(Number(after.newInvoice?.total_cents) === TOTAL_CENTS && Number(after.newInvoice?.balance_cents) === TOTAL_CENTS, "Updated invoice total or balance is wrong.");
assert(after.oldInvoice.status === "supporting_document", "Old invoice was not preserved as supporting evidence.");
assert(after.oldInvoice.metadata?.superseded_by_invoice_id === invoiceId, "Old invoice supersession link is missing.");
assert(after.oldAllocation.metadata?.reversed_at, "Old job allocation was not reversed.");
assert(Number(line.quantity) === HOURS && Number(line.subtotal_cents) === SUBTOTAL_CENTS, "Updated hours or line subtotal is wrong.");
assert(allocation.job_id === JOB_ID && Number(allocation.total_cents) === TOTAL_CENTS && !allocation.metadata?.reversed_at, "Updated job allocation is wrong.");
assert(document.content_sha256 === SOURCE_SHA256 && document.storage_path === storagePath, "Archived replacement PDF is wrong.");
assert(activeInvoices.length === 1 && activeInvoices[0].id === invoiceId, "Current invoice #8614 identity is ambiguous.");

console.log(JSON.stringify({
  status: "verified",
  old_invoice_id: OLD_INVOICE_ID,
  current_invoice_id: invoiceId,
  document_id: documentId,
  invoice_number: INVOICE_NUMBER,
  hours: HOURS,
  subtotal_cents: SUBTOTAL_CENTS,
  tax_cents: TAX_CENTS,
  total_cents: TOTAL_CENTS,
  paid_cents: 0,
  balance_cents: TOTAL_CENTS,
  job: { id: JOB_ID, name: after.job.name, production_month: after.job.production_month },
  old_revision_preserved: true,
}, null, 2));
