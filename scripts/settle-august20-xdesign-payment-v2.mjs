#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CUTOFF = "2026-06-01";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const capturedAt = new Date().toISOString();

const target = {
  key: "xdesign-8611-8615",
  transaction: {
    postedOn: "2026-08-20",
    description: "SEND E-TFR *4Wd SUPP",
    amountCents: 433_920,
    recipient: "Michael Matambo",
    recipientDestination: "xdesign.ottawa@gmail.com",
    message: "XDesign invoices 8611-8615",
    confirmation: "CA***4Wd",
    priorBankStatus: "Sent",
    bankStatus: "Deposited",
    depositedOn: "2026-08-20",
    category: "Subcontractors",
    counterparty: "XDesign Dev Inc",
    allocationType: "labour_payment",
    classification: "subcontractor_labour",
    latestEvidenceSha256: "bef0085a44d88d99ce796b02cfd13c147c7ef5d370ca8882f05e149eb6293566",
  },
  invoices: [
    { id: "66baf5ca-4274-59c3-bf35-858bec19897e", number: "8611", totalCents: 40_680 },
    { id: "0ac13970-e077-565e-b945-19327728cd70", number: "8612", totalCents: 128_820 },
    { id: "fe449d06-c969-503e-b877-9bc73f773daf", number: "8613", totalCents: 61_020 },
    { id: "fdfdcc6b-6dc2-5bb7-896b-4846e17984ed", number: "8614", totalCents: 128_820 },
    { id: "34722641-13f3-568c-86d4-fb33f9b4a778", number: "8615", totalCents: 74_580 },
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

function active(rows) {
  return (rows ?? []).filter((row) => !row.reversed_at);
}

function sum(rows, key = "amount_cents") {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
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
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) {
  throw new Error("Refusing settlement for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [transactionResult, invoiceResult, evidenceResult] = await Promise.all([
  db
    .from("transactions")
    .select("*,account:accounts(slug,name,last_four),allocations:transaction_allocations(*)")
    .eq("posted_on", target.transaction.postedOn)
    .eq("description", target.transaction.description)
    .single(),
  db
    .from("invoices")
    .select("*,contact:contacts(id,name,email),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(*),job_allocations:invoice_job_allocations(id,job_id,total_cents,needs_review,job:jobs(id,name,status,started_on,completed_on,production_month))")
    .in("id", target.invoices.map((invoice) => invoice.id)),
  db
    .from("documents")
    .select("id,kind,content_sha256,original_filename,captured_at,metadata")
    .eq("content_sha256", target.transaction.latestEvidenceSha256)
    .single(),
]);
if (transactionResult.error) throw transactionResult.error;
if (invoiceResult.error) throw invoiceResult.error;
if (evidenceResult.error) throw evidenceResult.error;

const transaction = transactionResult.data;
const invoices = invoiceResult.data ?? [];
const evidenceDocument = evidenceResult.data;
assert(invoices.length === target.invoices.length, `Expected ${target.invoices.length} invoices, found ${invoices.length}.`);
assert(transaction.account?.slug === "td-chequing-6970", "XDesign payment account changed.");
assert(Number(transaction.amount_cents) === -target.transaction.amountCents, "XDesign payment amount changed.");
assert(transaction.metadata?.recipient === target.transaction.recipient, "XDesign bank recipient changed.");
assert(transaction.metadata?.recipient_destination === target.transaction.recipientDestination, "XDesign recipient destination changed.");
assert(transaction.metadata?.message === target.transaction.message, "XDesign bank message changed.");
assert(transaction.metadata?.confirmation_masked === target.transaction.confirmation, "XDesign confirmation changed.");
assert(
  [target.transaction.priorBankStatus, target.transaction.bankStatus].includes(transaction.metadata?.status),
  `Unexpected stored bank status ${transaction.metadata?.status}.`,
);
assert(evidenceDocument.kind === "bank_activity_observation", "Latest transfer-history evidence has the wrong document type.");
assert(evidenceDocument.metadata?.rows?.some((row) =>
  row.description === target.transaction.description &&
  row.evidence?.status === target.transaction.bankStatus &&
  row.evidence?.confirmation_masked === target.transaction.confirmation
), "Latest bank observation does not confirm the XDesign deposit.");
assert(active(transaction.allocations).every((row) =>
  target.invoices.some((invoice) =>
    row.id === stableUuid(`transaction-allocation:${target.key}:${transaction.id}:invoice:${invoice.id}`)
  )
), "XDesign transfer has an unexpected active allocation.");

const rows = target.invoices.map((expected) => {
  const invoice = invoices.find((row) => row.id === expected.id);
  assert(invoice, `Missing invoice #${expected.number}.`);
  assert(invoice.invoice_number === expected.number, `Invoice #${expected.number} number changed.`);
  assert(invoice.direction === "payable", `Invoice #${expected.number} is not payable.`);
  assert(invoice.contact?.name === target.transaction.counterparty, `Invoice #${expected.number} supplier changed.`);
  assert(Number(invoice.total_cents) === expected.totalCents, `Invoice #${expected.number} total changed.`);
  assert((invoice.job_allocations ?? []).length > 0, `Invoice #${expected.number} has no job allocation.`);
  for (const allocation of invoice.job_allocations ?? []) {
    assert(allocation.job, `Invoice #${expected.number} has a missing allocated job.`);
    if (allocation.job.started_on) {
      assert(allocation.job.started_on >= CUTOFF, `Invoice #${expected.number} is linked to historical job ${allocation.job.name}.`);
    } else {
      assert(
        !["completed", "archived", "cancelled", "canceled"].includes(String(allocation.job.status).toLowerCase()),
        `Invoice #${expected.number} is linked to completed or archived undated job ${allocation.job.name}.`,
      );
    }
  }
  const allocationId = stableUuid(`transaction-allocation:${target.key}:${transaction.id}:invoice:${invoice.id}`);
  const otherPayments = active(invoice.payments).filter((row) => row.id !== allocationId);
  assert(sum(otherPayments) === 0, `Invoice #${expected.number} has an unexpected bank payment.`);
  const existing = active(invoice.payments).find((row) => row.id === allocationId);
  if (existing) {
    assert(existing.transaction_id === transaction.id, `Invoice #${expected.number} expected allocation uses another transaction.`);
    assert(Number(existing.amount_cents) === expected.totalCents, `Invoice #${expected.number} expected allocation amount changed.`);
  } else {
    assert(invoice.status !== "paid", `Invoice #${expected.number} is marked paid without its bank allocation.`);
    assert(Number(invoice.paid_cents) === 0, `Invoice #${expected.number} has an unmatched paid amount.`);
    assert(Number(invoice.balance_cents) === expected.totalCents, `Invoice #${expected.number} balance changed before settlement.`);
  }
  return { expected, invoice, allocationId, existing };
});

assert(new Set(rows.map(({ invoice }) => invoice.contact_id)).size === 1, "XDesign invoices do not share one supplier contact.");
assert(sum(target.invoices, "totalCents") === target.transaction.amountCents, "XDesign invoice totals do not equal the deposited transfer.");

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  transaction: {
    id: transaction.id,
    amount_cents: Number(transaction.amount_cents),
    stored_bank_status: transaction.metadata?.status,
    latest_bank_status: target.transaction.bankStatus,
    confirmation_masked: target.transaction.confirmation,
    current_allocation_cents: sum(active(transaction.allocations)),
    proposed_allocation_cents: target.transaction.amountCents,
  },
  invoices: rows.map(({ expected, invoice, allocationId }) => ({
    invoice_number: expected.number,
    job_names: invoice.job_allocations.map((allocation) => allocation.job.name),
    total_cents: expected.totalCents,
    current_status: invoice.status,
    current_paid_cents: Number(invoice.paid_cents),
    proposed_status: "paid",
    allocation_id: allocationId,
  })),
}, null, 2));
if (!APPLY) process.exit(0);

const contactId = rows[0].invoice.contact_id;
const allocationIds = [];
for (const { expected, invoice, allocationId, existing } of rows) {
  allocationIds.push(allocationId);
  const allocationWrite = await db.from("transaction_allocations").upsert({
    id: allocationId,
    transaction_id: transaction.id,
    invoice_id: invoice.id,
    contact_id: contactId,
    source_system: "td_easyweb",
    external_id: `${target.transaction.confirmation}:${invoice.invoice_number}`,
    allocation_type: target.transaction.allocationType,
    amount_cents: expected.totalCents,
    allocation_method: "bank_recipient,recipient_destination,exact_bank_message,exact_invoice_sum,deposit_status",
    confidence: 1,
    needs_review: false,
    metadata: {
      invoice_number: invoice.invoice_number,
      classification: target.transaction.classification,
      bank_status: target.transaction.bankStatus,
      bank_recipient: target.transaction.recipient,
      recipient_destination: target.transaction.recipientDestination,
      bank_message: target.transaction.message,
      confirmation_masked: target.transaction.confirmation,
      paid_on: target.transaction.depositedOn,
      grouped_invoice_numbers: target.invoices.map((row) => row.number),
      grouped_payment_cents: target.transaction.amountCents,
      evidence_document_id: evidenceDocument.id,
      evidence_document_sha256: evidenceDocument.content_sha256,
    },
    created_at: existing?.created_at ?? capturedAt,
    updated_at: capturedAt,
  }, { onConflict: "id" });
  if (allocationWrite.error) throw allocationWrite.error;

  const priorSettlement = invoice.metadata?.settlement && typeof invoice.metadata.settlement === "object"
    ? invoice.metadata.settlement
    : {};
  const invoiceWrite = await db.from("invoices").update({
    status: "paid",
    paid_cents: expected.totalCents,
    balance_cents: 0,
    metadata: {
      ...(invoice.metadata ?? {}),
      settlement: {
        ...priorSettlement,
        status: "paid",
        paid_cents: expected.totalCents,
        balance_cents: 0,
        transaction_ids: [...new Set([...(priorSettlement.transaction_ids ?? []), transaction.id])],
        allocation_ids: [...new Set([...(priorSettlement.allocation_ids ?? []), allocationId])],
        last_payment_on: target.transaction.depositedOn,
        evidence: {
          source: "TD EasyWeb transfer history and visible account activity",
          bank_status: target.transaction.bankStatus,
          confirmation_masked: target.transaction.confirmation,
          bank_message: target.transaction.message,
          document_id: evidenceDocument.id,
          document_sha256: evidenceDocument.content_sha256,
        },
      },
    },
    updated_at: capturedAt,
  }).eq("id", invoice.id).eq("updated_at", invoice.updated_at).select("id").maybeSingle();
  if (invoiceWrite.error) throw invoiceWrite.error;
  if (!invoiceWrite.data) throw new Error(`Concurrent invoice update detected for #${invoice.invoice_number}.`);

  const eventWrite = await db.from("verification_events").upsert({
    id: stableUuid(`verification:${target.key}:invoice:${invoice.id}:transaction:${transaction.id}:deposited`),
    entity_type: "transaction_allocation",
    entity_id: allocationId,
    action: "supplier_invoice_payment_reconciled",
    reason: `TD EasyWeb now shows the XDesign transfer as deposited; invoice #${invoice.invoice_number} is part of the exact five-invoice sum.`,
    old_values: { invoice_status: invoice.status, invoice_paid_cents: invoice.paid_cents, invoice_balance_cents: invoice.balance_cents },
    new_values: { invoice_status: "paid", invoice_paid_cents: expected.totalCents, invoice_balance_cents: 0, allocation_cents: expected.totalCents },
    evidence: {
      source: "TD EasyWeb transfer history and visible account activity",
      evidence_document_id: evidenceDocument.id,
      evidence_document_sha256: evidenceDocument.content_sha256,
      posted_on: transaction.posted_on,
      deposited_on: target.transaction.depositedOn,
      bank_status: target.transaction.bankStatus,
      bank_recipient: target.transaction.recipient,
      recipient_destination: target.transaction.recipientDestination,
      bank_message: target.transaction.message,
      confirmation_masked: target.transaction.confirmation,
      invoice_number: invoice.invoice_number,
      grouped_invoice_numbers: target.invoices.map((row) => row.number),
      grouped_payment_cents: target.transaction.amountCents,
    },
    occurred_at: capturedAt,
  }, { onConflict: "id" });
  if (eventWrite.error) throw eventWrite.error;
}

const pendingObservation = transaction.metadata?.settlement_confirmation;
const transactionWrite = await db.from("transactions").update({
  contact_id: contactId,
  counterparty: target.transaction.counterparty,
  category: target.transaction.category,
  review_status: "reconciled",
  notes: `Deposited TD EasyWeb settlement for ${target.invoices.map((invoice) => `#${invoice.number}`).join(" + ")}; allocated $${(target.transaction.amountCents / 100).toFixed(2)} in full.`,
  metadata: {
    ...(transaction.metadata ?? {}),
    status: target.transaction.bankStatus,
    deposited_on: target.transaction.depositedOn,
    cancellable_when_observed: false,
    source_document_sha256: evidenceDocument.content_sha256,
    status_observation: {
      status: target.transaction.bankStatus,
      observed_at: capturedAt,
      evidence_document_id: evidenceDocument.id,
      evidence_document_sha256: evidenceDocument.content_sha256,
    },
    settlement_confirmation: {
      status: "settled",
      prior_pending_observation: pendingObservation,
      invoice_ids: target.invoices.map((invoice) => invoice.id),
      invoice_numbers: target.invoices.map((invoice) => invoice.number),
      allocation_ids: allocationIds,
      allocated_cents: target.transaction.amountCents,
      method: "bank_recipient,recipient_destination,exact_bank_message,exact_invoice_sum,deposit_status",
      reconciled_at: capturedAt,
    },
  },
  updated_at: capturedAt,
}).eq("id", transaction.id).eq("updated_at", transaction.updated_at).select("id").maybeSingle();
if (transactionWrite.error) throw transactionWrite.error;
if (!transactionWrite.data) throw new Error("Concurrent XDesign transaction update detected.");

const depositEventWrite = await db.from("verification_events").upsert({
  id: stableUuid(`verification:${target.key}:transaction:${transaction.id}:deposit-confirmed`),
  entity_type: "transaction",
  entity_id: transaction.id,
  action: "supplier_payment_deposit_confirmed",
  reason: "TD EasyWeb transfer history changed from one pending Sent transfer to zero pending transfers and lists Michael Matambo's $4,339.20 transfer as Deposited.",
  old_values: { bank_status: target.transaction.priorBankStatus, review_status: transaction.review_status, allocated_cents: 0 },
  new_values: { bank_status: target.transaction.bankStatus, review_status: "reconciled", allocated_cents: target.transaction.amountCents },
  evidence: {
    source: "TD EasyWeb transfer history",
    evidence_document_id: evidenceDocument.id,
    evidence_document_sha256: evidenceDocument.content_sha256,
    pending_count: 0,
    completed_count: 59,
    recipient: target.transaction.recipient,
    amount_cents: target.transaction.amountCents,
    confirmation_masked: target.transaction.confirmation,
  },
  occurred_at: capturedAt,
}, { onConflict: "id" });
if (depositEventWrite.error) throw depositEventWrite.error;

const [verifiedTransaction, verifiedInvoices] = await Promise.all([
  db.from("transactions").select("id,description,amount_cents,category,review_status,counterparty,metadata,allocations:transaction_allocations(id,invoice_id,amount_cents,needs_review,reversed_at)").eq("id", transaction.id).single(),
  db.from("invoices").select("id,invoice_number,status,total_cents,paid_cents,balance_cents,payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,transaction_id,amount_cents,needs_review,reversed_at)").in("id", target.invoices.map((invoice) => invoice.id)),
]);
if (verifiedTransaction.error) throw verifiedTransaction.error;
if (verifiedInvoices.error) throw verifiedInvoices.error;
assert(verifiedTransaction.data.review_status === "reconciled", "XDesign transaction review status verification failed.");
assert(verifiedTransaction.data.category === target.transaction.category, "XDesign transaction category verification failed.");
assert(verifiedTransaction.data.metadata?.status === target.transaction.bankStatus, "XDesign deposited status verification failed.");
assert(sum(active(verifiedTransaction.data.allocations)) === target.transaction.amountCents, "XDesign transaction allocation total failed.");
for (const expected of target.invoices) {
  const invoice = verifiedInvoices.data.find((row) => row.id === expected.id);
  assert(invoice.status === "paid", `Invoice #${expected.number} status verification failed.`);
  assert(Number(invoice.paid_cents) === expected.totalCents, `Invoice #${expected.number} paid total failed.`);
  assert(Number(invoice.balance_cents) === 0, `Invoice #${expected.number} balance verification failed.`);
  assert(sum(active(invoice.payments)) === expected.totalCents, `Invoice #${expected.number} allocation total failed.`);
}

console.log(JSON.stringify({ status: "verified", transaction: verifiedTransaction.data, invoices: verifiedInvoices.data }, null, 2));
