#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const OBSERVED_ON = "2026-08-29";
const CONTACT_ID = "ac2a71c8-5082-5bad-af43-d785ed98b30a";
const ACCOUNT_SLUG = "td-chequing-6970";
const CONFIRMATION = "CA***VN3";
const TRANSFER_CENTS = 78_812;
const FEE_CENTS = 150;
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const capturedAt = new Date().toISOString();

const sources = [
  {
    number: "8620", issuedOn: "2026-08-27", messageId: "1a047bb9ab3a5f03",
    filename: "Invoice_8620_2026-08-27.pdf",
    localPath: "/Users/jadslim/.workspace-mcp/attachments/Invoice_8620_2026-08-27_a5df8d5e-c3b0-4392-9602-c153178d9d51.pdf",
    subtotal: 54_000, tax: 7_020, total: 61_020,
    description: "Paint & Plaster - Erin Zuber - 1 White Cedar Tr - Wed 9hrs, Thur 9hrs",
    jobId: "b66f4fa0-d463-5c6e-8442-e40a75122327", match: "Erin Zuber / 1 White Cedar Tr",
  },
  {
    number: "8621", issuedOn: "2026-08-28", messageId: "1a049b00c05bef18",
    filename: "Invoice_8621_2026-08-28.pdf",
    localPath: "/Users/jadslim/.workspace-mcp/attachments/Invoice_8621_2026-08-28_e324ec32-43c4-4b6d-9ba0-8bc94d6347c4.pdf",
    subtotal: 15_000, tax: 1_950, total: 16_950,
    description: "Paint & Plaster - Katharina Keet - 2336 Orient Park #71",
    jobId: "19a09c1e-bdc2-5f32-ad3f-67c4b2b3242d", match: "Katharina Keet / 2336 Orient Park #71",
  },
];

const parking = {
  invoiceId: "f2ca9fa9-e5b7-50dd-809f-4421160d638d",
  lineId: stableUuid("invoice-line:xdesign:8616:parking:2026-08-20"),
  allocationId: stableUuid("invoice-job-allocation:xdesign:8616:parking:2026-08-20"),
  jobId: "76f23ac5-0a28-5268-9175-672cec8d1716",
  messageId: "1a02159f71694a15",
  filename: "1787265402009.pdf",
  localPath: "/Users/jadslim/.workspace-mcp/attachments/1787265402009_d5203577-3c3c-4916-b914-d05d45457e66.pdf",
  subtotal: 745, tax: 97, total: 842,
};

function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function sha(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function assert(value, message) { if (!value) throw new Error(message); }
function parseEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("="); if (i < 1) continue;
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[line.slice(0, i).trim()] = value;
  }
  return out;
}
function data(label, result) { if (result.error) throw new Error(`${label}: ${result.error.message}`); return result.data; }

for (const source of [...sources, parking]) assert(existsSync(source.localPath), `Missing source file ${source.localPath}`);
const env = { ...parseEnv(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")), ...parseEnv(path.resolve(repoRoot, ".env.local")), ...process.env };
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
assert(url && env.SUPABASE_SERVICE_ROLE_KEY, "Missing Supabase credentials.");
assert(new URL(url).hostname.split(".")[0] === PROJECT_REF, "Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const invoiceIds = [parking.invoiceId, ...sources.map((s) => stableUuid(`invoice:gmail_contractor_invoice:${s.messageId}:1`))];
const [contact, account, jobs, existingInvoices] = await Promise.all([
  data("contact", await db.from("contacts").select("*").eq("id", CONTACT_ID).single()),
  data("account", await db.from("accounts").select("*").eq("slug", ACCOUNT_SLUG).single()),
  data("jobs", await db.from("jobs").select("id,name,status,started_on,completed_on,production_month,formatted_address,budgets:job_budgets(id,status,version,amount_including_tax_cents,actual_labour_cost_cents)").in("id", [parking.jobId, ...sources.map((s) => s.jobId)])),
  data("invoices", await db.from("invoices").select("*,lines:invoice_lines(*),allocations:invoice_job_allocations(*),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(*)").or(`id.in.(${invoiceIds.join(",")}),invoice_number.in.(8616,8620,8621)`)),
]);
assert(contact.name === "XDesign Dev Inc", "XDesign contact changed.");
assert(account.last_four === "6970", "Payment account changed.");
assert(jobs.length === 3, "Expected all three current jobs.");
for (const job of jobs) {
  assert(!["completed", "archived", "cancelled", "canceled"].includes(String(job.status).toLowerCase()), `${job.name} is locked.`);
  assert((job.budgets ?? []).filter((b) => b.status === "active").length === 1, `${job.name} must have one active budget.`);
}
const old8616 = existingInvoices.find((row) => row.id === parking.invoiceId);
assert(old8616?.invoice_number === "8616", "Invoice #8616 is missing.");
assert(Number(old8616.total_cents) === 40_680, "Invoice #8616 total changed before parking revision.");
assert((old8616.payments ?? []).filter((p) => !p.reversed_at).reduce((n, p) => n + Number(p.amount_cents), 0) === 40_680, "Invoice #8616 payment changed.");
for (const source of sources) assert(!existingInvoices.some((row) => row.invoice_number === source.number), `Invoice #${source.number} already exists.`);

const paymentEvidence = {
  source: "TD EasyWeb send confirmation",
  observed_on: OBSERVED_ON,
  confirmation_masked: CONFIRMATION,
  recipient: "Michael Matambo",
  recipient_destination: "xdesign.ottawa@gmail.com",
  message: "Invoices 8616 parking, 8620, 8621",
  purpose: "AP - Accounts Payable",
  amount_cents: TRANSFER_CENTS,
  fee_cents: FEE_CENTS,
  status: "Sent",
  cancellable_when_observed: true,
};
const paymentBytes = Buffer.from(JSON.stringify(paymentEvidence, null, 2));
const paymentHash = sha(paymentBytes);
const paymentDocId = stableUuid(`document:td-easyweb-send:${paymentHash}`);
const transactionId = stableUuid(`transaction:${account.id}:td-easyweb:${OBSERVED_ON}:${CONFIRMATION}:${TRANSFER_CENTS}`);
const feeId = stableUuid(`transaction:${account.id}:td-easyweb-fee:${OBSERVED_ON}:${CONFIRMATION}:${FEE_CENTS}`);

const preview = {
  mode: APPLY ? "apply" : "dry-run",
  transfer: paymentEvidence,
  revise_invoice: { number: "8616", old_total_cents: 40680, new_total_cents: 41522, paid_cents: 40680, balance_cents: 842, job: "Tasha Thornton" },
  create_invoices: sources.map((s) => ({ number: s.number, subtotal_cents: s.subtotal, total_cents: s.total, job: jobs.find((j) => j.id === s.jobId)?.name })),
  job_budgets: jobs.map((j) => ({ job: j.name, active_budget_id: j.budgets.find((b) => b.status === "active")?.id })),
  settlement_state: "sent_pending_bank_deposit",
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) process.exit(0);

async function archiveDocument({ localPath, filename, issuedOn, messageId, kind = "labour_invoice" }) {
  const bytes = readFileSync(localPath); const hash = sha(bytes);
  const id = stableUuid(`document:${kind}:${hash}`);
  const storagePath = `gmail-contractor-invoices/${issuedOn}/${hash.slice(0, 16)}-${filename}`;
  const existing = data("document lookup", await db.from("documents").select("id").eq("content_sha256", hash).maybeSingle());
  if (!existing) {
    const upload = await db.storage.from("labour-invoices").upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
    if (upload.error && !/already exists/i.test(upload.error.message)) throw upload.error;
    data("document insert", await db.from("documents").insert({ id, kind, original_filename: filename, mime_type: "application/pdf", size_bytes: bytes.length, content_sha256: hash, storage_bucket: "labour-invoices", storage_path: storagePath, source_url: `https://mail.google.com/mail/u/0/#all/${messageId}`, captured_at: capturedAt, metadata: { source: "gmail_contractor_invoice", gmail_message_id: messageId, attachment_index: 1, sender_email: "mailer@waveapps.com" } }));
  }
  return { id: existing?.id ?? id, hash, storagePath };
}

const parkingDoc = await archiveDocument({ ...parking, issuedOn: "2026-08-20", kind: "parking_receipt" });
const sourceDocs = new Map();
for (const source of sources) sourceDocs.set(source.number, await archiveDocument(source));

const dispatch = (portion) => ({ status: "sent_pending_bank_deposit", dispatched_on: OBSERVED_ON, amount_cents: portion, grouped_payment_cents: TRANSFER_CENTS, grouped_invoice_numbers: ["8616", "8620", "8621"], transaction_id: transactionId, bank_status: "Sent", recipient: "Michael Matambo", recipient_destination: "xdesign.ottawa@gmail.com", bank_message: paymentEvidence.message, confirmation_masked: CONFIRMATION, cancellable_when_observed: true, evidence_document_id: paymentDocId, evidence_document_sha256: paymentHash });

data("parking line", await db.from("invoice_lines").upsert({ id: parking.lineId, invoice_id: parking.invoiceId, line_number: 2, description: "Parking reimbursement - PayByPhone City of Ottawa - August 20, 2026", quantity: 1, unit: "expense", unit_price_cents: parking.subtotal, subtotal_cents: parking.subtotal, tax_cents: parking.tax, total_cents: parking.total, source_kind: "gmail_contractor_invoice_item", metadata: { entry_type: "labour_reimbursement", needs_review: false, job_allocation_required: true, source_document_id: parkingDoc.id, source_gmail_message_id: parking.messageId, printed_match_type: "invoice_revision", printed_match_value: "Invoice 8616" }, created_at: capturedAt, updated_at: capturedAt }, { onConflict: "id" }));
data("parking allocation", await db.from("invoice_job_allocations").upsert({ id: parking.allocationId, invoice_id: parking.invoiceId, invoice_line_id: parking.lineId, job_id: parking.jobId, subtotal_cents: parking.subtotal, tax_cents: parking.tax, total_cents: parking.total, quantity: 1, allocation_method: "explicit_invoice_revision_to_existing_single_job", confidence: 1, needs_review: false, metadata: { source_document_id: parkingDoc.id, source_gmail_message_id: parking.messageId, printed_description: "Parking added to invoice 8616" }, created_at: capturedAt, updated_at: capturedAt }, { onConflict: "id" }));
data("8616 revision", await db.from("invoices").update({ subtotal_cents: 36_745, tax_cents: 4_777, total_cents: 41_522, paid_cents: 40_680, balance_cents: 842, status: "partially_paid", metadata: { ...(old8616.metadata ?? {}), payment_status: "partially_paid", source_revision_message_id: parking.messageId, source_revision_document_id: parkingDoc.id, source_revision_document_sha256: parkingDoc.hash, revision_reason: "XDesign added a $7.45 parking receipt plus $0.97 HST.", payment_dispatch: dispatch(842), settlement: { ...(old8616.metadata?.settlement ?? {}), status: "partially_paid", paid_cents: 40_680, balance_cents: 842, pending_dispatch_transaction_id: transactionId, pending_dispatch_confirmation_masked: CONFIRMATION } }, updated_at: capturedAt }).eq("id", parking.invoiceId));
data("parking evidence", await db.from("evidence_links").upsert({ id: stableUuid(`evidence:${parkingDoc.id}:invoice:${parking.invoiceId}:revision`), document_id: parkingDoc.id, entity_type: "invoice", entity_id: parking.invoiceId, evidence_role: "invoice_revision_support", metadata: { gmail_message_id: parking.messageId }, created_at: capturedAt }, { onConflict: "id" }));

for (const source of sources) {
  const doc = sourceDocs.get(source.number);
  const invoiceId = stableUuid(`invoice:gmail_contractor_invoice:${source.messageId}:1`);
  const lineId = stableUuid(`invoice-line:${invoiceId}:1`);
  const allocationId = stableUuid(`invoice-job-allocation:${invoiceId}:${lineId}:${source.jobId}`);
  data(`invoice ${source.number}`, await db.from("invoices").insert({ id: invoiceId, contact_id: CONTACT_ID, direction: "payable", category: "labour", source_system: "gmail_contractor_invoice", external_id: `sha256:${doc.hash}`, invoice_number: source.number, status: "unpaid", issued_on: source.issuedOn, due_on: source.issuedOn, currency: "CAD", subtotal_cents: source.subtotal, tax_cents: source.tax, total_cents: source.total, paid_cents: 0, balance_cents: source.total, metadata: { document_type: "invoice", supplier_name: "XDesign Dev Inc", payment_status: "unpaid", itemization_status: "itemized_from_source", job_assignment_status: "fully_assigned", match_status: "assigned", source_document_id: doc.id, source_document_sha256: doc.hash, source_gmail_message_id: source.messageId, source_gmail_attachment_index: 1, supplier_sender_email: "mailer@waveapps.com", supplier_reply_to_email: "xdesign.ottawa@gmail.com", payment_dispatch: dispatch(source.total) }, created_at: capturedAt, updated_at: capturedAt }));
  data(`line ${source.number}`, await db.from("invoice_lines").insert({ id: lineId, invoice_id: invoiceId, line_number: 1, description: source.description, quantity: 1, unit: "service", unit_price_cents: source.subtotal, subtotal_cents: source.subtotal, tax_cents: source.tax, total_cents: source.total, source_kind: "gmail_contractor_invoice_item", metadata: { entry_type: "labour", needs_review: false, job_allocation_required: true, printed_match_type: "name_and_address", printed_match_value: source.match, source_document_id: doc.id, source_gmail_message_id: source.messageId }, created_at: capturedAt, updated_at: capturedAt }));
  data(`allocation ${source.number}`, await db.from("invoice_job_allocations").insert({ id: allocationId, invoice_id: invoiceId, invoice_line_id: lineId, job_id: source.jobId, subtotal_cents: source.subtotal, tax_cents: source.tax, total_cents: source.total, quantity: 1, allocation_method: "exact_printed_name_and_address", confidence: 1, needs_review: false, metadata: { printed_match_value: source.match, source_document_id: doc.id, source_document_sha256: doc.hash, source_gmail_message_id: source.messageId }, created_at: capturedAt, updated_at: capturedAt }));
  data(`evidence ${source.number}`, await db.from("evidence_links").insert({ id: stableUuid(`evidence:${doc.id}:invoice:${invoiceId}:source`), document_id: doc.id, entity_type: "invoice", entity_id: invoiceId, evidence_role: "source_document", metadata: { gmail_message_id: source.messageId }, created_at: capturedAt }));
}

data("payment document", await db.from("documents").upsert({ id: paymentDocId, kind: "bank_transfer_confirmation", original_filename: "td-easyweb-xdesign-2026-08-29.json", mime_type: "application/json", size_bytes: paymentBytes.length, content_sha256: paymentHash, storage_bucket: null, storage_path: null, source_url: "https://easyweb.td.com/waw/webui/emt/#/", captured_at: capturedAt, metadata: paymentEvidence }, { onConflict: "id" }));
const settlement = { status: "sent_pending_bank_deposit", invoice_ids: invoiceIds, invoice_numbers: ["8616", "8620", "8621"], dispatched_cents: TRANSFER_CENTS, reason: "EasyWeb shows Money Sent via email; no active invoice payment allocations until deposit.", observed_at: capturedAt };
data("transfer transaction", await db.from("transactions").upsert({ id: transactionId, account_id: account.id, import_document_id: paymentDocId, contact_id: CONTACT_ID, source_key: `td-easyweb-transfer-history:${OBSERVED_ON}:${CONFIRMATION}:${TRANSFER_CENTS}`, posted_on: OBSERVED_ON, transaction_on: OBSERVED_ON, description: "SEND E-TFR *VN3 AP", counterparty: "XDesign Dev Inc", amount_cents: -TRANSFER_CENTS, tax_cents: 0, net_cents: -TRANSFER_CENTS, currency: "CAD", transaction_type: "expense", category: "Subcontractors", is_transfer: false, review_status: "needs_review", notes: "TD EasyWeb payment sent for #8616 parking + #8620 + #8621; awaiting recipient deposit before settlement.", metadata: { ...paymentEvidence, pending: true, settlement_confirmation: settlement, source_document_sha256: paymentHash }, created_at: capturedAt, updated_at: capturedAt }, { onConflict: "id" }));
data("fee transaction", await db.from("transactions").upsert({ id: feeId, account_id: account.id, import_document_id: paymentDocId, contact_id: null, source_key: `td-easyweb-transfer-fee:${OBSERVED_ON}:${CONFIRMATION}:${FEE_CENTS}`, posted_on: OBSERVED_ON, transaction_on: OBSERVED_ON, description: "SEND E-TFR FEE", counterparty: "TD Bank", amount_cents: -FEE_CENTS, tax_cents: 0, net_cents: -FEE_CENTS, currency: "CAD", transaction_type: "expense", category: "Bank fees", is_transfer: false, review_status: "reconciled", notes: `Interac e-Transfer fee for XDesign payment ${CONFIRMATION}.`, metadata: { source: "td_easyweb_send_confirmation", related_transfer_confirmation_masked: CONFIRMATION, pending: false, tax_evidence: { status: "not_applicable", tax_cents: 0 } }, created_at: capturedAt, updated_at: capturedAt }, { onConflict: "id" }));
for (const id of [transactionId, feeId]) data("transaction evidence", await db.from("evidence_links").upsert({ id: stableUuid(`evidence:${paymentDocId}:transaction:${id}`), document_id: paymentDocId, entity_type: "transaction", entity_id: id, evidence_role: "bank_transfer_observation", metadata: { confirmation_masked: CONFIRMATION, status: "Sent" }, created_at: capturedAt }, { onConflict: "id" }));
for (const invoiceId of invoiceIds) data("dispatch evidence", await db.from("evidence_links").upsert({ id: stableUuid(`evidence:${paymentDocId}:invoice:${invoiceId}:dispatch`), document_id: paymentDocId, entity_type: "invoice", entity_id: invoiceId, evidence_role: "payment_dispatch_evidence", metadata: { confirmation_masked: CONFIRMATION, status: "Sent", transaction_id: transactionId }, created_at: capturedAt }, { onConflict: "id" }));

const verify = data("verification", await db.from("invoices").select("id,invoice_number,status,subtotal_cents,tax_cents,total_cents,paid_cents,balance_cents,metadata,lines:invoice_lines(id,subtotal_cents,tax_cents,total_cents),allocations:invoice_job_allocations(id,job_id,subtotal_cents,total_cents,needs_review),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,amount_cents,reversed_at)").in("id", invoiceIds).order("invoice_number"));
assert(verify.length === 3, "Expected three verified invoices.");
for (const row of verify) {
  assert(row.lines.reduce((n, line) => n + Number(line.total_cents), 0) === Number(row.total_cents), `Invoice #${row.invoice_number} lines do not total.`);
  assert(row.allocations.reduce((n, allocation) => n + Number(allocation.total_cents), 0) === Number(row.total_cents), `Invoice #${row.invoice_number} allocations do not total.`);
  assert(row.metadata?.payment_dispatch?.confirmation_masked === CONFIRMATION, `Invoice #${row.invoice_number} dispatch missing.`);
}
console.log(JSON.stringify({ applied: true, confirmation_masked: CONFIRMATION, invoices: verify, transaction_id: transactionId, fee_transaction_id: feeId }, null, 2));
