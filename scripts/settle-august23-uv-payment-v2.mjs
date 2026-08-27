#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const TRANSACTION_ID = "379d3320-a692-5e08-ad16-986cda6662db";
const INVOICE_ID = "e9d410f0-fd36-57f1-88cd-c9c272367854";
const AMOUNT_CENTS = 101_782;
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const capturedAt = new Date().toISOString();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
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

const evidence = {
  source: "TD EasyWeb Interac e-Transfer history and detail page",
  observed_on: "2026-08-25",
  date_sent: "2026-08-23",
  deposited_on: "2026-08-23",
  status: "Deposited",
  from_account_last_four: "6970",
  amount_cents: AMOUNT_CENTS,
  recipient: "Yuri",
  message: "U&V invoice 156364",
  confirmation_masked: "CA***vmx",
  purpose: "SUPP - Supplier Payment",
  method: "Mobile",
  sent_by: "OTTAWA PAINTERS",
};
const evidenceBytes = Buffer.from(JSON.stringify(evidence, null, 2));
const evidenceHash = crypto.createHash("sha256").update(evidenceBytes).digest("hex");
const documentId = stableUuid(`document:td-easyweb-uv-156364:${evidenceHash}`);
const allocationId = stableUuid(`transaction-allocation:uv-156364:${TRANSACTION_ID}:${INVOICE_ID}`);

const env = {
  ...parseEnvFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.join(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const [transactionResult, invoiceResult, documentResult] = await Promise.all([
  db.from("transactions")
    .select("*,account:accounts(slug,last_four),allocations:transaction_allocations(*)")
    .eq("id", TRANSACTION_ID)
    .single(),
  db.from("invoices")
    .select("*,contact:contacts(id,name),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(*),job_allocations:invoice_job_allocations(id,job_id,subtotal_cents,total_cents,needs_review,job:jobs(id,name,status,started_on,completed_on))")
    .eq("id", INVOICE_ID)
    .single(),
  db.from("documents").select("id,content_sha256").eq("content_sha256", evidenceHash).maybeSingle(),
]);
if (transactionResult.error) throw transactionResult.error;
if (invoiceResult.error) throw invoiceResult.error;
if (documentResult.error) throw documentResult.error;
const transaction = transactionResult.data;
const invoice = invoiceResult.data;
const activeTransactionAllocations = (transaction.allocations ?? []).filter((row) => !row.reversed_at);
const activeInvoicePayments = (invoice.payments ?? []).filter((row) => !row.reversed_at);
const existingAllocation = activeTransactionAllocations.find((row) => row.id === allocationId);

assert(transaction.account?.slug === "td-chequing-6970", "U&V payment account changed.");
assert(transaction.posted_on === "2026-08-24", "U&V payment posting date changed.");
assert(transaction.description === "SEND E-TFR *vmx SUPP", "U&V payment description changed.");
assert(Number(transaction.amount_cents) === -AMOUNT_CENTS, "U&V payment amount changed.");
assert(invoice.invoice_number === "156364", "U&V invoice number changed.");
assert(invoice.direction === "payable" && invoice.category === "labour", "U&V invoice is not a labour payable.");
assert(invoice.contact?.name === "U&V Painting", "U&V invoice supplier changed.");
assert(Number(invoice.total_cents) === AMOUNT_CENTS, "U&V invoice total changed.");
assert((invoice.job_allocations ?? []).length > 0, "U&V invoice has no job allocations.");
assert(activeTransactionAllocations.every((row) => row.id === allocationId), "U&V transaction has an unexpected allocation.");
assert(activeInvoicePayments.every((row) => row.id === allocationId), "U&V invoice has an unexpected payment allocation.");
if (existingAllocation) {
  assert(existingAllocation.invoice_id === invoice.id, "Existing U&V allocation points to another invoice.");
  assert(Number(existingAllocation.amount_cents) === AMOUNT_CENTS, "Existing U&V allocation amount changed.");
} else {
  assert(Number(invoice.paid_cents) === 0, "U&V invoice has a paid amount without a bank allocation.");
  assert(Number(invoice.balance_cents) === AMOUNT_CENTS, "U&V invoice balance changed before settlement.");
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  transaction: {
    id: transaction.id,
    posted_on: transaction.posted_on,
    amount_cents: transaction.amount_cents,
    current_category: transaction.category,
    proposed_category: "Subcontractors",
    current_review_status: transaction.review_status,
    proposed_review_status: "reconciled",
  },
  invoice: {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    supplier: invoice.contact.name,
    total_cents: invoice.total_cents,
    current_status: invoice.status,
    proposed_status: "paid",
    current_paid_cents: invoice.paid_cents,
    proposed_paid_cents: AMOUNT_CENTS,
    job_allocations_unchanged: invoice.job_allocations.map((row) => ({
      job: row.job?.name ?? row.job_id,
      subtotal_cents: row.subtotal_cents,
      total_cents: row.total_cents,
      needs_review: row.needs_review,
    })),
  },
  evidence: {
    ...evidence,
    document_id: documentResult.data?.id ?? documentId,
    sha256: evidenceHash,
  },
}, null, 2));
if (!APPLY) process.exit(0);

const resolvedDocumentId = documentResult.data?.id ?? documentId;
if (!documentResult.data) {
  const documentWrite = await db.from("documents").insert({
    id: documentId,
    kind: "bank_transfer_detail",
    original_filename: "TD EasyWeb U&V invoice 156364 payment observed 2026-08-25.json",
    mime_type: "application/json",
    size_bytes: evidenceBytes.length,
    content_sha256: evidenceHash,
    storage_bucket: null,
    storage_path: null,
    source_url: "https://easyweb.td.com/waw/webui/emt/#/",
    captured_at: capturedAt,
    metadata: evidence,
  }).select("id").single();
  if (documentWrite.error) throw documentWrite.error;
}

for (const [entityType, entityId, role] of [
  ["transaction", transaction.id, "bank_transfer_detail"],
  ["invoice", invoice.id, "payment_evidence"],
]) {
  const linkWrite = await db.from("evidence_links").upsert({
    id: stableUuid(`evidence-link:${resolvedDocumentId}:${entityType}:${entityId}:${role}`),
    document_id: resolvedDocumentId,
    entity_type: entityType,
    entity_id: entityId,
    evidence_role: role,
    metadata: { source: evidence.source, confirmation_masked: evidence.confirmation_masked },
    created_at: capturedAt,
  }, { onConflict: "id" });
  if (linkWrite.error) throw linkWrite.error;
}

const allocationWrite = await db.from("transaction_allocations").upsert({
  id: allocationId,
  transaction_id: transaction.id,
  invoice_id: invoice.id,
  contact_id: invoice.contact_id,
  source_system: "td_easyweb",
  external_id: `${evidence.confirmation_masked}:${invoice.invoice_number}`,
  allocation_type: "labour_payment",
  amount_cents: AMOUNT_CENTS,
  allocation_method: "easyweb_recipient,exact_bank_message,exact_invoice_total,deposited_status",
  confidence: 1,
  needs_review: false,
  metadata: {
    classification: "subcontractor_labour",
    invoice_number: invoice.invoice_number,
    bank_status: evidence.status,
    bank_recipient: evidence.recipient,
    bank_message: evidence.message,
    confirmation_masked: evidence.confirmation_masked,
    paid_on: evidence.deposited_on,
    evidence_document_id: resolvedDocumentId,
    evidence_document_sha256: evidenceHash,
  },
  created_at: existingAllocation?.created_at ?? capturedAt,
  updated_at: capturedAt,
}, { onConflict: "id" });
if (allocationWrite.error) throw allocationWrite.error;

const priorSettlement = invoice.metadata?.settlement && typeof invoice.metadata.settlement === "object" ? invoice.metadata.settlement : {};
const invoiceWrite = await db.from("invoices").update({
  status: "paid",
  paid_cents: AMOUNT_CENTS,
  balance_cents: 0,
  metadata: {
    ...(invoice.metadata ?? {}),
    settlement: {
      ...priorSettlement,
      status: "paid",
      paid_cents: AMOUNT_CENTS,
      balance_cents: 0,
      transaction_ids: [...new Set([...(priorSettlement.transaction_ids ?? []), transaction.id])],
      allocation_ids: [...new Set([...(priorSettlement.allocation_ids ?? []), allocationId])],
      last_payment_on: evidence.deposited_on,
      evidence: {
        source: evidence.source,
        bank_status: evidence.status,
        bank_recipient: evidence.recipient,
        bank_message: evidence.message,
        confirmation_masked: evidence.confirmation_masked,
        document_id: resolvedDocumentId,
        document_sha256: evidenceHash,
      },
    },
  },
  updated_at: capturedAt,
}).eq("id", invoice.id).eq("updated_at", invoice.updated_at).select("id").maybeSingle();
if (invoiceWrite.error) throw invoiceWrite.error;
if (!invoiceWrite.data) throw new Error("Concurrent U&V invoice update detected.");

const transactionWrite = await db.from("transactions").update({
  contact_id: invoice.contact_id,
  counterparty: invoice.contact.name,
  category: "Subcontractors",
  review_status: "reconciled",
  notes: "TD EasyWeb confirms the deposited payment for U&V Painting invoice #156364; allocated $1,017.82 in full.",
  metadata: {
    ...(transaction.metadata ?? {}),
    easyweb_e_transfer_evidence: evidence,
    source_document_sha256: evidenceHash,
    settlement_confirmation: {
      status: "settled",
      invoice_ids: [invoice.id],
      invoice_numbers: [invoice.invoice_number],
      allocation_ids: [allocationId],
      allocated_cents: AMOUNT_CENTS,
      method: "easyweb_recipient,exact_bank_message,exact_invoice_total,deposited_status",
      reconciled_at: capturedAt,
    },
  },
  updated_at: capturedAt,
}).eq("id", transaction.id).eq("updated_at", transaction.updated_at).select("id").maybeSingle();
if (transactionWrite.error) throw transactionWrite.error;
if (!transactionWrite.data) throw new Error("Concurrent U&V transaction update detected.");

const eventWrite = await db.from("verification_events").upsert({
  id: stableUuid(`verification:uv-156364:${transaction.id}:${invoice.id}:paid`),
  entity_type: "transaction_allocation",
  entity_id: allocationId,
  action: "supplier_invoice_payment_reconciled",
  reason: "TD EasyWeb shows a deposited transfer whose recipient, exact message, masked confirmation, and amount identify U&V Painting invoice #156364.",
  old_values: {
    transaction_category: transaction.category,
    transaction_review_status: transaction.review_status,
    invoice_status: invoice.status,
    invoice_paid_cents: invoice.paid_cents,
    invoice_balance_cents: invoice.balance_cents,
  },
  new_values: {
    transaction_category: "Subcontractors",
    transaction_review_status: "reconciled",
    invoice_status: "paid",
    invoice_paid_cents: AMOUNT_CENTS,
    invoice_balance_cents: 0,
    allocation_cents: AMOUNT_CENTS,
  },
  evidence: { ...evidence, evidence_document_id: resolvedDocumentId, evidence_document_sha256: evidenceHash },
  occurred_at: capturedAt,
}, { onConflict: "id" });
if (eventWrite.error) throw eventWrite.error;

const [verifiedTransaction, verifiedInvoice] = await Promise.all([
  db.from("transactions").select("id,counterparty,category,review_status,allocations:transaction_allocations(id,invoice_id,amount_cents,needs_review,reversed_at)").eq("id", transaction.id).single(),
  db.from("invoices").select("id,status,paid_cents,balance_cents,payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,transaction_id,amount_cents,needs_review,reversed_at)").eq("id", invoice.id).single(),
]);
if (verifiedTransaction.error) throw verifiedTransaction.error;
if (verifiedInvoice.error) throw verifiedInvoice.error;
assert(verifiedTransaction.data.category === "Subcontractors" && verifiedTransaction.data.review_status === "reconciled", "U&V transaction verification failed.");
assert(Number(verifiedInvoice.data.paid_cents) === AMOUNT_CENTS && Number(verifiedInvoice.data.balance_cents) === 0, "U&V invoice verification failed.");
assert((verifiedTransaction.data.allocations ?? []).some((row) => row.id === allocationId && !row.reversed_at), "U&V payment allocation verification failed.");

console.log(JSON.stringify({
  status: "verified",
  transaction_id: transaction.id,
  invoice_id: invoice.id,
  allocation_id: allocationId,
  evidence_document_id: resolvedDocumentId,
  amount_cents: AMOUNT_CENTS,
}, null, 2));
