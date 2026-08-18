#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const OLD_INVOICE_ID = "72bf43ea-3387-51f8-bcad-9ac7ea7ba7b9";
const JOB_ID = "5c68f2f5-68b9-5606-8c97-0ff0eb4b07eb";
const INVOICE_UUID = "74155945099b398a54e36f491ca908";
const INVOICE_NUMBER = "431865";
const SOURCE_URL = `https://app.dripjobs.com/jobs/invoice/${INVOICE_UUID}`;
const OLD_EXTERNAL_ID = `${INVOICE_UUID}:revision:2026-07-31`;
const PAYMENT_ALLOCATION_IDS = [
  "4173df4c-e60f-5821-83e3-b73379a72826",
  "e86cfa46-2a79-5efe-8cf2-4a034144ab1e",
];
const PDF_PATH = path.resolve(
  process.argv.find((value) => value.startsWith("--pdf="))?.slice(6) ??
    "/Users/jadslim/Downloads/invoice-431865-download.pdf",
);

const source = {
  customerName: "Carina Stark",
  invoiceNumber: INVOICE_NUMBER,
  issuedOn: "2026-04-30",
  proposalId: "2759065",
  proposalUuid: "61583815476cccd3d9c9e34c9e87de",
  companycamProjectId: "103507278",
  address: "148 Waterfern Way, Ottawa, ON, K4A 0S6",
  email: "carinastark07@gmail.com",
  phone: "(807) 472-1922",
  salesperson: "Scott Madden",
  status: "Partially Paid",
  subtotalCents: 543_900,
  taxCents: 70_707,
  totalCents: 614_607,
  paidCents: 144_132,
  balanceCents: 470_475,
  payment: {
    number: "564837",
    amountCents: 144_132,
    receivedOn: "2026-07-23",
    method: "Credit Card (Succeeded)",
  },
  changeOrder: {
    number: "112737",
    description: "Interior Painting - Doors",
    subtotalCents: 33_700,
    taxCents: 4_381,
    totalCents: 38_081,
  },
  lines: [
    {
      description: "Why Choose Ottawa Painters",
      externalItemId: "741575090460e46a134441424386f2",
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
    },
    {
      description: "Interior Painting - Doors",
      externalItemId: "change-order:112737",
      subtotalCents: 33_700,
      taxCents: 4_381,
      totalCents: 38_081,
      changeOrderNumber: "112737",
    },
    {
      description: "Client Notes",
      externalItemId: "741590905039e8000181674eafb987",
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
    },
    {
      description: "Interior Painting - Textured Ceilings (Rolling)",
      externalItemId: "741606406121e02e704f2c492b873e",
      subtotalCents: 80_200,
      taxCents: 10_426,
      totalCents: 90_626,
    },
    {
      description: "Interior Painting - Walls",
      externalItemId: "741621950572840fed78fe45909056",
      subtotalCents: 353_600,
      taxCents: 45_968,
      totalCents: 399_568,
    },
    {
      description: "Interior Painting - Trim",
      externalItemId: "7416375560cbfd586d3a284380b9df",
      subtotalCents: 76_400,
      taxCents: 9_932,
      totalCents: 86_332,
    },
  ],
};

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

assert(existsSync(PDF_PATH), `Current DripJobs PDF not found: ${PDF_PATH}`);
const pdf = readFileSync(PDF_PATH);
const pdfSha256 = sha256(pdf);
const currentInvoiceId = stableUuid(`invoice:dripjobs:${INVOICE_UUID}:revision:${pdfSha256}`);
const documentId = stableUuid(`document:customer-invoice:${pdfSha256}`);
const evidenceLinkId = stableUuid(`evidence-link:${documentId}:invoice:${currentInvoiceId}`);
const jobAllocationId = stableUuid(`invoice-job-allocation:${currentInvoiceId}:${JOB_ID}`);
const storagePath = `dripjobs/${INVOICE_UUID}/revisions/${pdfSha256.slice(0, 16)}-invoice-${INVOICE_NUMBER}.pdf`;

const lineSubtotal = source.lines.reduce((sum, line) => sum + line.subtotalCents, 0);
const lineTax = source.lines.reduce((sum, line) => sum + line.taxCents, 0);
const lineTotal = source.lines.reduce((sum, line) => sum + line.totalCents, 0);
assert(lineSubtotal === source.subtotalCents, "Line subtotals do not reconcile.");
assert(lineTax === source.taxCents, "Line taxes do not reconcile.");
assert(lineTotal === source.totalCents, "Line totals do not reconcile.");
assert(source.subtotalCents + source.taxCents === source.totalCents, "Invoice total does not reconcile.");
assert(source.paidCents + source.balanceCents === source.totalCents, "Invoice balance does not reconcile.");

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
  throw new Error("Refusing reconciliation for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function loadState() {
  const [oldInvoiceResult, currentInvoiceResult, jobResult, paymentResult] = await Promise.all([
    db.from("invoices").select("*").eq("id", OLD_INVOICE_ID).single(),
    db.from("invoices").select("*").eq("id", currentInvoiceId).maybeSingle(),
    db.from("jobs").select("id,name,status,started_on,completed_on,archived_at,contract_amount_cents").eq("id", JOB_ID).single(),
    db.from("transaction_allocations").select("*").in("id", PAYMENT_ALLOCATION_IDS),
  ]);
  return {
    oldInvoice: data("old invoice", oldInvoiceResult),
    currentInvoice: data("current invoice", currentInvoiceResult),
    job: data("job", jobResult),
    payments: data("payment allocations", paymentResult),
  };
}

function validatePreconditions(state) {
  assert(state.oldInvoice.invoice_number === INVOICE_NUMBER, "Old invoice number changed.");
  assert(state.oldInvoice.category === "customer", "Target is not a customer invoice.");
  assert(state.job.name === source.customerName, "Job identity changed.");
  assert(state.job.status !== "completed" && state.job.status !== "archived", "Refusing to alter a completed or archived job.");
  assert(state.job.archived_at == null, "Refusing to alter an archived job.");
  assert(Number(state.job.contract_amount_cents) === source.subtotalCents, "Current job value no longer matches the verified before-HST invoice subtotal.");
  assert(state.payments.length === PAYMENT_ALLOCATION_IDS.length, "Expected payment evidence is missing.");
  for (const payment of state.payments) {
    assert(Number(payment.amount_cents) === source.paidCents, `Payment allocation ${payment.id} amount changed.`);
    assert(payment.reversed_at == null, `Payment allocation ${payment.id} is reversed.`);
    assert(
      payment.invoice_id === OLD_INVOICE_ID || payment.invoice_id === currentInvoiceId,
      `Payment allocation ${payment.id} points to an unexpected invoice.`,
    );
  }

  const oldAlreadySuperseded =
    state.oldInvoice.external_id === OLD_EXTERNAL_ID &&
    state.oldInvoice.metadata?.accounting_status === "void" &&
    state.oldInvoice.metadata?.superseded_by_invoice_id === currentInvoiceId;
  if (!oldAlreadySuperseded) {
    assert(state.oldInvoice.external_id === INVOICE_UUID, "Old invoice external ID changed.");
    assert(Number(state.oldInvoice.subtotal_cents) === 510_200, "Old invoice subtotal changed.");
    assert(Number(state.oldInvoice.tax_cents) === 66_326, "Old invoice tax changed.");
    assert(Number(state.oldInvoice.total_cents) === 576_526, "Old invoice total changed.");
    assert(Number(state.oldInvoice.paid_cents) === source.paidCents, "Old invoice payment changed.");
  }
  return { oldAlreadySuperseded };
}

const before = await loadState();
const preconditions = validatePreconditions(before);
const preview = {
  mode: APPLY ? "apply" : "dry-run",
  project_ref: PROJECT_REF,
  current_source: {
    source_url: SOURCE_URL,
    pdf_path: PDF_PATH,
    pdf_sha256: pdfSha256,
    pdf_size_bytes: statSync(PDF_PATH).size,
    invoice_number: INVOICE_NUMBER,
    subtotal_cents: source.subtotalCents,
    tax_cents: source.taxCents,
    total_cents: source.totalCents,
    paid_cents: source.paidCents,
    balance_cents: source.balanceCents,
    change_order: source.changeOrder,
  },
  old_invoice: {
    id: OLD_INVOICE_ID,
    subtotal_cents: Number(before.oldInvoice.subtotal_cents),
    total_cents: Number(before.oldInvoice.total_cents),
    retained_as_superseded_evidence: true,
  },
  new_invoice: { id: currentInvoiceId, already_exists: Boolean(before.currentInvoice) },
  payment_allocations_reassigned_not_revalued: PAYMENT_ALLOCATION_IDS,
  old_already_superseded: preconditions.oldAlreadySuperseded,
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) process.exit(0);

const now = new Date().toISOString();
const reason =
  "Authenticated DripJobs invoice #431865 and its downloaded PDF now include approved change order #112737 for Interior Painting - Doors ($337.00 before HST, $43.81 HST). The July 31 $5,102.00 subtotal snapshot is retained as superseded evidence; the current before-HST subtotal is $5,439.00.";

const upload = await db.storage.from("customer-invoices").upload(storagePath, pdf, {
  contentType: "application/pdf",
  cacheControl: "3600",
  upsert: false,
});
if (upload.error && !String(upload.error.message).toLocaleLowerCase("en-CA").includes("already exists")) {
  throw upload.error;
}

const sourcePayload = {
  invoice_uuid: INVOICE_UUID,
  invoice_number: INVOICE_NUMBER,
  proposal_id: source.proposalId,
  proposal_uuid: source.proposalUuid,
  customer_name: source.customerName,
  customer_email: source.email,
  customer_phone: source.phone,
  job_name: source.customerName,
  job_address: source.address,
  invoice_date: "4/30/2026",
  status: "partially_paid",
  visible_status: source.status,
  subtotal: source.subtotalCents / 100,
  sales_tax: source.taxCents / 100,
  total: source.totalCents / 100,
  paid_amount: source.paidCents / 100,
  payment_sum: source.paidCents / 100,
  balance: source.balanceCents / 100,
  payment_count: 1,
  line_item_count: source.lines.length,
  change_order_reference_count: 1,
  change_orders: [source.changeOrder],
  payment: source.payment,
  source_url: SOURCE_URL,
  pdf_sha256: pdfSha256,
  pdf_status: "downloaded_and_archived",
  captured_at: now,
  captured_from: "Authenticated DripJobs invoice page and current downloaded PDF",
};

data("current invoice document", await db.from("documents").upsert({
  id: documentId,
  kind: "original_invoice",
  original_filename: `invoice-${INVOICE_NUMBER}-current-${pdfSha256.slice(0, 8)}.pdf`,
  mime_type: "application/pdf",
  size_bytes: statSync(PDF_PATH).size,
  content_sha256: pdfSha256,
  storage_bucket: "customer-invoices",
  storage_path: storagePath,
  source_url: SOURCE_URL,
  captured_at: now,
  metadata: {
    source: "authenticated_dripjobs_current_invoice",
    invoice_number: INVOICE_NUMBER,
    invoice_uuid: INVOICE_UUID,
    proposal_id: source.proposalId,
    page_count: 7,
    subtotal_cents: source.subtotalCents,
    tax_cents: source.taxCents,
    total_cents: source.totalCents,
    change_order_number: source.changeOrder.number,
  },
  created_at: now,
}, { onConflict: "id" }));

data("current invoice", await db.from("invoices").upsert({
  id: currentInvoiceId,
  contact_id: before.oldInvoice.contact_id,
  direction: "receivable",
  category: "customer",
  source_system: "dripjobs",
  external_id: INVOICE_UUID,
  invoice_number: INVOICE_NUMBER,
  status: source.status,
  issued_on: source.issuedOn,
  due_on: null,
  currency: "CAD",
  subtotal_cents: source.subtotalCents,
  tax_cents: source.taxCents,
  total_cents: source.totalCents,
  paid_cents: source.paidCents,
  balance_cents: source.balanceCents,
  metadata: {
    ...before.oldInvoice.metadata,
    source_url: SOURCE_URL,
    source_status: "partially_paid",
    accounting_status: "active",
    superseded_by_invoice_id: null,
    void_reason: null,
    voided_at: null,
    revision_number: 2,
    revision_of_invoice_id: OLD_INVOICE_ID,
    revision_reason: reason,
    current_document_id: documentId,
    current_pdf_sha256: pdfSha256,
    source_payload: sourcePayload,
  },
  created_at: now,
  updated_at: now,
}, { onConflict: "id" }));

const lineRows = source.lines.map((line, index) => ({
  id: stableUuid(`invoice-line:${currentInvoiceId}:${index + 1}`),
  invoice_id: currentInvoiceId,
  line_number: index + 1,
  description: line.description,
  quantity: 1,
  unit: "item",
  unit_price_cents: line.subtotalCents,
  subtotal_cents: line.subtotalCents,
  tax_cents: line.taxCents,
  total_cents: line.totalCents,
  source_kind: line.changeOrderNumber ? "dripjobs_change_order_item" : "dripjobs_invoice_item",
  metadata: {
    source_invoice_uuid: INVOICE_UUID,
    external_item_id: line.externalItemId,
    change_order_number: line.changeOrderNumber ?? null,
    source_document_id: documentId,
  },
  created_at: now,
  updated_at: now,
}));
data("current invoice lines", await db.from("invoice_lines").upsert(lineRows, {
  onConflict: "invoice_id,line_number",
}));

data("current invoice job allocation", await db.from("invoice_job_allocations").upsert({
  id: jobAllocationId,
  invoice_id: currentInvoiceId,
  invoice_line_id: null,
  job_id: JOB_ID,
  subtotal_cents: source.subtotalCents,
  tax_cents: source.taxCents,
  total_cents: source.totalCents,
  allocation_method: "current_physical_dripjobs_invoice",
  confidence: 1,
  needs_review: false,
  metadata: {
    source_invoice_uuid: INVOICE_UUID,
    external_proposal_id: source.proposalId,
    companycam_project_id: source.companycamProjectId,
    source_document_id: documentId,
    revision_of_allocation_id: "89976ed2-b6c9-5f69-bf6c-ed94c225abc0",
  },
  created_at: now,
  updated_at: now,
}, { onConflict: "id" }));

data("current invoice evidence link", await db.from("evidence_links").upsert({
  id: evidenceLinkId,
  document_id: documentId,
  entity_type: "invoice",
  entity_id: currentInvoiceId,
  evidence_role: "current_original_invoice",
  metadata: {
    invoice_number: INVOICE_NUMBER,
    revision_number: 2,
    supersedes_invoice_id: OLD_INVOICE_ID,
  },
  created_at: now,
}, { onConflict: "id" }));

for (const payment of before.payments) {
  data(`payment allocation ${payment.id}`, await db.from("transaction_allocations").update({
    invoice_id: currentInvoiceId,
    metadata: {
      ...(payment.metadata ?? {}),
      invoice_revision: {
        reassigned_at: now,
        old_invoice_id: OLD_INVOICE_ID,
        current_invoice_id: currentInvoiceId,
        invoice_number: INVOICE_NUMBER,
        current_invoice_total_cents: source.totalCents,
        amount_unchanged: true,
        reason,
      },
    },
    updated_at: now,
  }).eq("id", payment.id).eq("invoice_id", payment.invoice_id));
}

data("superseded invoice", await db.from("invoices").update({
  external_id: OLD_EXTERNAL_ID,
  status: "supporting_document",
  metadata: {
    ...before.oldInvoice.metadata,
    original_external_id: INVOICE_UUID,
    accounting_status: "void",
    superseded_by_invoice_id: currentInvoiceId,
    void_reason: reason,
    voided_at: now,
    revision_number: 1,
    superseded_document_id: before.oldInvoice.metadata?.current_document_id ?? null,
  },
  updated_at: now,
}).eq("id", OLD_INVOICE_ID));

for (const event of [
  {
    id: stableUuid(`verification:invoice-revision-superseded:${OLD_INVOICE_ID}:${pdfSha256}`),
    entityId: OLD_INVOICE_ID,
    action: "source_revision_superseded",
    oldValues: {
      external_id: INVOICE_UUID,
      subtotal_cents: 510_200,
      tax_cents: 66_326,
      total_cents: 576_526,
      paid_cents: source.paidCents,
      balance_cents: 432_394,
    },
    newValues: {
      accounting_status: "void",
      superseded_by_invoice_id: currentInvoiceId,
      external_id: OLD_EXTERNAL_ID,
    },
  },
  {
    id: stableUuid(`verification:invoice-revision-current:${currentInvoiceId}`),
    entityId: currentInvoiceId,
    action: "source_invoice_revised",
    oldValues: { invoice_id: OLD_INVOICE_ID, subtotal_cents: 510_200, total_cents: 576_526 },
    newValues: {
      invoice_number: INVOICE_NUMBER,
      subtotal_cents: source.subtotalCents,
      tax_cents: source.taxCents,
      total_cents: source.totalCents,
      paid_cents: source.paidCents,
      balance_cents: source.balanceCents,
      job_id: JOB_ID,
      change_order_number: source.changeOrder.number,
    },
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
    evidence: {
      source_url: SOURCE_URL,
      document_id: documentId,
      pdf_sha256: pdfSha256,
      user_confirmed_current_subtotal_cents: source.subtotalCents,
    },
    occurred_at: now,
  }, { onConflict: "id" }));
}

const after = await loadState();
validatePreconditions(after);
const [lineResult, jobAllocationResult, evidenceResult, activeExternalResult] = await Promise.all([
  db.from("invoice_lines").select("line_number,subtotal_cents,tax_cents,total_cents").eq("invoice_id", currentInvoiceId),
  db.from("invoice_job_allocations").select("*").eq("id", jobAllocationId).single(),
  db.from("evidence_links").select("id,document:documents(id,content_sha256,storage_bucket,storage_path)").eq("id", evidenceLinkId).single(),
  db.from("invoices").select("id").eq("source_system", "dripjobs").eq("external_id", INVOICE_UUID),
]);
const storedLines = data("stored lines", lineResult);
const storedAllocation = data("stored allocation", jobAllocationResult);
const storedEvidence = data("stored evidence", evidenceResult);
const activeExternal = data("canonical external invoice", activeExternalResult);

assert(after.currentInvoice?.metadata?.accounting_status === "active", "Current invoice is not active.");
assert(Number(after.currentInvoice?.subtotal_cents) === source.subtotalCents, "Current invoice subtotal mismatch.");
assert(Number(after.currentInvoice?.total_cents) === source.totalCents, "Current invoice total mismatch.");
assert(Number(after.currentInvoice?.balance_cents) === source.balanceCents, "Current invoice balance mismatch.");
assert(after.oldInvoice.metadata?.accounting_status === "void", "Old invoice is not superseded.");
assert(after.oldInvoice.metadata?.superseded_by_invoice_id === currentInvoiceId, "Old invoice supersession link is missing.");
assert(after.payments.every((payment) => payment.invoice_id === currentInvoiceId), "Payment evidence did not move to the current revision.");
assert(storedLines.length === source.lines.length, "Current invoice line count mismatch.");
assert(storedLines.reduce((sum, line) => sum + Number(line.subtotal_cents), 0) === source.subtotalCents, "Stored line subtotal mismatch.");
assert(Number(storedAllocation.subtotal_cents) === source.subtotalCents, "Job allocation subtotal mismatch.");
assert(storedAllocation.job_id === JOB_ID && storedAllocation.needs_review === false, "Job allocation identity mismatch.");
assert(storedEvidence.document.content_sha256 === pdfSha256, "Archived PDF hash mismatch.");
assert(activeExternal.length === 1 && activeExternal[0].id === currentInvoiceId, "Canonical external invoice identity is ambiguous.");

console.log(JSON.stringify({
  status: "verified",
  old_invoice_id: OLD_INVOICE_ID,
  current_invoice_id: currentInvoiceId,
  current_document_id: documentId,
  current_pdf_sha256: pdfSha256,
  invoice_number: INVOICE_NUMBER,
  subtotal_cents: source.subtotalCents,
  tax_cents: source.taxCents,
  total_cents: source.totalCents,
  paid_cents: source.paidCents,
  balance_cents: source.balanceCents,
  line_count: storedLines.length,
  payment_allocations_reassigned: after.payments.map((payment) => payment.id),
  old_revision_preserved: true,
}, null, 2));
