#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CUTOFF = "2026-06-01";
const OBSERVED_AT = new Date().toISOString();
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const targets = [
  {
    key: "xdesign-8616-8619",
    transactionId: "547ceb7f-aca5-546b-a814-57117121f9dd",
    contactId: "ac2a71c8-5082-5bad-af43-d785ed98b30a",
    counterparty: "XDesign Dev Inc",
    description: "SEND E-TFR *PUw AP",
    amountCents: 233_910,
    recipient: "Michael Matambo",
    destination: "xdesign.ottawa@gmail.com",
    message: "Invoices 8616, 8617, 8618, 8619",
    confirmation: "CA***PUw",
    depositedOn: "2026-08-27",
    invoices: [
      { id: "f2ca9fa9-e5b7-50dd-809f-4421160d638d", number: "8616", totalCents: 40_680 },
      { id: "69849ca1-2a0d-5448-8f98-6221bbaf3b63", number: "8617", totalCents: 23_730 },
      { id: "0b2440a5-2879-5d69-b06e-105704b4c934", number: "8618", totalCents: 98_310 },
      { id: "cd23000a-53b1-519f-88be-a6c5dec9ce1e", number: "8619", totalCents: 71_190 },
    ],
  },
  {
    key: "grutenco-gt-inv-202608-03",
    transactionId: "21ce29ca-2fad-52df-bbee-bd1cecfc7041",
    contactId: "2d6edf7a-2a0e-585e-8d62-adf89506e6d6",
    counterparty: "Grutenco Painting & Construction Services",
    description: "SEND E-TFR *eQH AP",
    amountCents: 175_661,
    recipient: "grutenco",
    destination: "hello@grutenco.ca",
    message: "GT-INV-202608-03",
    confirmation: "CA***eQH",
    depositedOn: "2026-08-27",
    invoices: [
      { id: "1d04c0f2-3713-58ef-a371-423a6c7e3edd", number: "GT-INV-202608-03", totalCents: 175_661 },
    ],
  },
];

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function active(rows) {
  return (rows ?? []).filter((row) => !row.reversed_at);
}

function sum(rows, key = "amount_cents") {
  return rows.reduce((total, row) => total + Number(row?.[key] ?? 0), 0);
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

const evidencePayload = {
  source: "TD EasyWeb Interac e-Transfer history and detail pages",
  observed_at: OBSERVED_AT,
  pending_count: 0,
  completed_count: 59,
  rows: targets.map((target) => ({
    transaction_id: target.transactionId,
    date_sent: target.depositedOn,
    from_account_last_four: "6970",
    amount_cents: target.amountCents,
    recipient: target.recipient,
    recipient_destination: target.destination,
    message: target.message,
    confirmation_masked: target.confirmation,
    purpose: "AP - Accounts Payable",
    method: "Email",
    status: "Deposited",
    status_history: [
      { status: "Sent", date: target.depositedOn },
      { status: "Deposited", date: target.depositedOn },
    ],
  })),
};
const evidenceBytes = Buffer.from(JSON.stringify(evidencePayload));
const evidenceHash = sha256(evidenceBytes);
const evidenceDocument = {
  id: stableUuid(`document:td-easyweb:labour-deposits:${evidenceHash}`),
  kind: "bank_activity_observation",
  original_filename: "TD EasyWeb deposited labour transfers observed 2026-08-29.json",
  mime_type: "application/json",
  size_bytes: evidenceBytes.length,
  content_sha256: evidenceHash,
  storage_bucket: null,
  storage_path: null,
  source_url: "https://easyweb.td.com/waw/webui/emt/#/",
  captured_at: OBSERVED_AT,
  metadata: evidencePayload,
};

const invoiceIds = targets.flatMap((target) => target.invoices.map((invoice) => invoice.id));
const [transactionResult, invoiceResult, documentResult] = await Promise.all([
  db.from("transactions")
    .select("*,account:accounts(slug,last_four),allocations:transaction_allocations(*)")
    .in("id", targets.map((target) => target.transactionId)),
  db.from("invoices")
    .select("*,contact:contacts(id,name,email),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(*),job_allocations:invoice_job_allocations(id,job_id,total_cents,needs_review,job:jobs(id,name,status,started_on,completed_on,production_month))")
    .in("id", invoiceIds),
  db.from("documents").select("id,content_sha256").eq("content_sha256", evidenceHash).maybeSingle(),
]);
if (transactionResult.error) throw transactionResult.error;
if (invoiceResult.error) throw invoiceResult.error;
if (documentResult.error) throw documentResult.error;
const transactions = transactionResult.data ?? [];
const invoices = invoiceResult.data ?? [];
assert(transactions.length === targets.length, `Expected ${targets.length} transactions, found ${transactions.length}.`);
assert(invoices.length === invoiceIds.length, `Expected ${invoiceIds.length} invoices, found ${invoices.length}.`);

const plans = [];
for (const target of targets) {
  const transaction = transactions.find((row) => row.id === target.transactionId);
  assert(transaction, `Missing ${target.key} transaction.`);
  assert(transaction.account?.slug === "td-chequing-6970" && transaction.account?.last_four === "6970", `${target.key} account changed.`);
  assert(transaction.posted_on === target.depositedOn, `${target.key} posted date changed.`);
  assert(transaction.description === target.description, `${target.key} description changed.`);
  assert(Number(transaction.amount_cents) === -target.amountCents, `${target.key} amount changed.`);
  assert(transaction.contact_id === target.contactId, `${target.key} contact changed.`);
  assert(transaction.counterparty === target.counterparty, `${target.key} counterparty changed.`);
  assert(transaction.metadata?.recipient === target.recipient, `${target.key} recipient changed.`);
  assert(transaction.metadata?.recipient_destination === target.destination, `${target.key} destination changed.`);
  assert(transaction.metadata?.message === target.message, `${target.key} bank message changed.`);
  assert(transaction.metadata?.confirmation_masked === target.confirmation, `${target.key} confirmation changed.`);
  assert(["Sent", "Deposited"].includes(transaction.metadata?.status), `${target.key} bank status is unexpected.`);
  assert(active(transaction.allocations).length === 0, `${target.key} already has an active allocation.`);

  const invoicePlans = target.invoices.map((expected) => {
    const invoice = invoices.find((row) => row.id === expected.id);
    assert(invoice, `Missing invoice #${expected.number}.`);
    assert(invoice.invoice_number === expected.number, `Invoice #${expected.number} number changed.`);
    assert(invoice.direction === "payable" && invoice.category === "labour", `Invoice #${expected.number} is not a labour payable.`);
    assert(invoice.contact_id === target.contactId && invoice.contact?.name === target.counterparty, `Invoice #${expected.number} supplier changed.`);
    assert(Number(invoice.total_cents) === expected.totalCents, `Invoice #${expected.number} total changed.`);
    assert((invoice.job_allocations ?? []).length > 0, `Invoice #${expected.number} has no job allocation.`);
    for (const allocation of invoice.job_allocations ?? []) {
      assert(allocation.job, `Invoice #${expected.number} has a missing allocated job.`);
      if (allocation.job.started_on) {
        assert(allocation.job.started_on >= CUTOFF, `Invoice #${expected.number} is linked to locked historical job ${allocation.job.name}.`);
      } else {
        assert(!["completed", "archived", "cancelled", "canceled"].includes(String(allocation.job.status).toLowerCase()), `Invoice #${expected.number} is linked to a locked undated job ${allocation.job.name}.`);
      }
    }
    const allocationId = stableUuid(`transaction-allocation:${target.key}:${transaction.id}:invoice:${invoice.id}`);
    assert(active(invoice.payments).length === 0, `Invoice #${expected.number} already has an active bank payment.`);
    assert(invoice.status !== "paid", `Invoice #${expected.number} is already marked paid without an allocation.`);
    assert(Number(invoice.paid_cents) === 0 && Number(invoice.balance_cents) === expected.totalCents, `Invoice #${expected.number} stored settlement amounts changed.`);
    const dispatch = invoice.metadata?.payment_dispatch;
    assert(["sent_pending_bank_deposit", "sent_pending_bank_sync"].includes(dispatch?.status), `Invoice #${expected.number} is not sent/pending.`);
    assert(dispatch?.transaction_id === transaction.id && dispatch?.confirmation_masked === target.confirmation, `Invoice #${expected.number} dispatch evidence changed.`);
    return { expected, invoice, allocationId };
  });
  assert(sum(target.invoices, "totalCents") === target.amountCents, `${target.key} invoice sum does not equal transfer.`);
  plans.push({ target, transaction, invoicePlans });
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  evidence_sha256: evidenceHash,
  payments: plans.map(({ target, transaction, invoicePlans }) => ({
    transaction_id: transaction.id,
    recipient: target.recipient,
    confirmation_masked: target.confirmation,
    status_before: transaction.metadata?.status,
    status_after: "Deposited",
    amount_cents: target.amountCents,
    invoices: invoicePlans.map(({ expected, invoice, allocationId }) => ({
      invoice_number: expected.number,
      total_cents: expected.totalCents,
      current_status: invoice.status,
      proposed_status: "paid",
      jobs: invoice.job_allocations.map((allocation) => ({
        name: allocation.job.name,
        status: allocation.job.status,
        started_on: allocation.job.started_on,
        production_month: allocation.job.production_month,
      })),
      allocation_id: allocationId,
    })),
  })),
  total_cents: sum(targets, "amountCents"),
}, null, 2));
if (!APPLY) process.exit(0);

let evidenceDocumentId = documentResult.data?.id ?? evidenceDocument.id;
if (!documentResult.data) {
  const write = await db.from("documents").insert(evidenceDocument).select("id").single();
  if (write.error) throw write.error;
  evidenceDocumentId = write.data.id;
}

for (const { target, transaction, invoicePlans } of plans) {
  const allocationIds = [];
  for (const { expected, invoice, allocationId } of invoicePlans) {
    allocationIds.push(allocationId);
    const allocationWrite = await db.from("transaction_allocations").upsert({
      id: allocationId,
      transaction_id: transaction.id,
      invoice_id: invoice.id,
      contact_id: target.contactId,
      source_system: "td_easyweb",
      external_id: `${target.confirmation}:${invoice.invoice_number}`,
      allocation_type: "labour_payment",
      amount_cents: expected.totalCents,
      allocation_method: "exact_recipient_destination_message_confirmation_invoice_sum_deposited_status",
      confidence: 1,
      needs_review: false,
      metadata: {
        invoice_number: invoice.invoice_number,
        classification: "subcontractor_labour",
        bank_status: "Deposited",
        bank_recipient: target.recipient,
        recipient_destination: target.destination,
        bank_message: target.message,
        confirmation_masked: target.confirmation,
        paid_on: target.depositedOn,
        grouped_invoice_numbers: target.invoices.map((row) => row.number),
        grouped_payment_cents: target.amountCents,
        evidence_document_id: evidenceDocumentId,
        evidence_document_sha256: evidenceHash,
      },
      created_at: OBSERVED_AT,
      updated_at: OBSERVED_AT,
    }, { onConflict: "id" });
    if (allocationWrite.error) throw allocationWrite.error;

    const settlement = invoice.metadata?.settlement && typeof invoice.metadata.settlement === "object" ? invoice.metadata.settlement : {};
    const dispatch = invoice.metadata?.payment_dispatch && typeof invoice.metadata.payment_dispatch === "object" ? invoice.metadata.payment_dispatch : {};
    const invoiceWrite = await db.from("invoices").update({
      status: "paid",
      paid_cents: expected.totalCents,
      balance_cents: 0,
      metadata: {
        ...(invoice.metadata ?? {}),
        payment_dispatch: {
          ...dispatch,
          status: "deposited",
          bank_status: "Deposited",
          deposited_on: target.depositedOn,
          observed_at: OBSERVED_AT,
          evidence_document_id: evidenceDocumentId,
          evidence_document_sha256: evidenceHash,
        },
        settlement: {
          ...settlement,
          status: "paid",
          paid_cents: expected.totalCents,
          balance_cents: 0,
          transaction_ids: [...new Set([...(settlement.transaction_ids ?? []), transaction.id])],
          allocation_ids: [...new Set([...(settlement.allocation_ids ?? []), allocationId])],
          last_payment_on: target.depositedOn,
          evidence: {
            source: evidencePayload.source,
            bank_status: "Deposited",
            confirmation_masked: target.confirmation,
            bank_message: target.message,
            document_id: evidenceDocumentId,
            document_sha256: evidenceHash,
          },
        },
      },
      updated_at: OBSERVED_AT,
    }).eq("id", invoice.id).eq("updated_at", invoice.updated_at).select("id").maybeSingle();
    if (invoiceWrite.error) throw invoiceWrite.error;
    assert(invoiceWrite.data, `Concurrent invoice update detected for #${invoice.invoice_number}.`);

    const evidenceLink = await db.from("evidence_links").upsert({
      id: stableUuid(`evidence-link:${evidenceDocumentId}:invoice:${invoice.id}:payment_evidence`),
      document_id: evidenceDocumentId,
      entity_type: "invoice",
      entity_id: invoice.id,
      evidence_role: "payment_evidence",
      metadata: { transaction_id: transaction.id, confirmation_masked: target.confirmation, bank_status: "Deposited" },
    }, { onConflict: "id" });
    if (evidenceLink.error) throw evidenceLink.error;

    const event = await db.from("verification_events").upsert({
      id: stableUuid(`verification:${target.key}:invoice:${invoice.id}:transaction:${transaction.id}:deposited`),
      entity_type: "transaction_allocation",
      entity_id: allocationId,
      action: "supplier_invoice_payment_reconciled",
      reason: `TD EasyWeb confirms ${target.recipient}'s exact transfer as Deposited; invoice #${invoice.invoice_number} is part of the exact bank-message invoice set.`,
      old_values: { invoice_status: invoice.status, invoice_paid_cents: invoice.paid_cents, invoice_balance_cents: invoice.balance_cents },
      new_values: { invoice_status: "paid", invoice_paid_cents: expected.totalCents, invoice_balance_cents: 0, allocation_cents: expected.totalCents },
      evidence: { document_id: evidenceDocumentId, document_sha256: evidenceHash, confirmation_masked: target.confirmation, bank_message: target.message, bank_status: "Deposited" },
      occurred_at: OBSERVED_AT,
    }, { onConflict: "id" });
    if (event.error) throw event.error;
  }

  const transactionWrite = await db.from("transactions").update({
    category: "Subcontractors",
    review_status: "reconciled",
    notes: `Deposited TD EasyWeb settlement for ${target.invoices.map((invoice) => `#${invoice.number}`).join(" + ")}; allocated $${(target.amountCents / 100).toFixed(2)} in full.`,
    metadata: {
      ...(transaction.metadata ?? {}),
      status: "Deposited",
      deposited_on: target.depositedOn,
      cancellable_when_observed: false,
      status_observation: { status: "Deposited", observed_at: OBSERVED_AT, evidence_document_id: evidenceDocumentId, evidence_document_sha256: evidenceHash },
      settlement_confirmation: {
        status: "settled",
        invoice_ids: target.invoices.map((invoice) => invoice.id),
        invoice_numbers: target.invoices.map((invoice) => invoice.number),
        allocation_ids: allocationIds,
        allocated_cents: target.amountCents,
        method: "exact_recipient_destination_message_confirmation_invoice_sum_deposited_status",
        reconciled_at: OBSERVED_AT,
      },
    },
    updated_at: OBSERVED_AT,
  }).eq("id", transaction.id).eq("updated_at", transaction.updated_at).select("id").maybeSingle();
  if (transactionWrite.error) throw transactionWrite.error;
  assert(transactionWrite.data, `Concurrent transaction update detected for ${target.key}.`);

  const evidenceLink = await db.from("evidence_links").upsert({
    id: stableUuid(`evidence-link:${evidenceDocumentId}:transaction:${transaction.id}:settlement_evidence`),
    document_id: evidenceDocumentId,
    entity_type: "transaction",
    entity_id: transaction.id,
    evidence_role: "settlement_evidence",
    metadata: { confirmation_masked: target.confirmation, bank_status: "Deposited", allocation_ids: allocationIds },
  }, { onConflict: "id" });
  if (evidenceLink.error) throw evidenceLink.error;
}

const [verifiedTransactions, verifiedInvoices] = await Promise.all([
  db.from("transactions").select("id,review_status,category,metadata,allocations:transaction_allocations(id,invoice_id,amount_cents,needs_review,reversed_at)").in("id", targets.map((target) => target.transactionId)),
  db.from("invoices").select("id,invoice_number,status,total_cents,paid_cents,balance_cents,metadata,payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,transaction_id,amount_cents,needs_review,reversed_at)").in("id", invoiceIds),
]);
if (verifiedTransactions.error) throw verifiedTransactions.error;
if (verifiedInvoices.error) throw verifiedInvoices.error;
for (const target of targets) {
  const transaction = verifiedTransactions.data.find((row) => row.id === target.transactionId);
  assert(transaction.review_status === "reconciled" && transaction.metadata?.status === "Deposited", `${target.key} transaction verification failed.`);
  assert(sum(active(transaction.allocations)) === target.amountCents, `${target.key} allocation total verification failed.`);
  for (const expected of target.invoices) {
    const invoice = verifiedInvoices.data.find((row) => row.id === expected.id);
    assert(invoice.status === "paid", `Invoice #${expected.number} status verification failed.`);
    assert(Number(invoice.paid_cents) === expected.totalCents && Number(invoice.balance_cents) === 0, `Invoice #${expected.number} settlement verification failed.`);
    assert(sum(active(invoice.payments)) === expected.totalCents, `Invoice #${expected.number} allocation verification failed.`);
    assert(invoice.metadata?.payment_dispatch?.status === "deposited", `Invoice #${expected.number} deposit-status verification failed.`);
  }
}

console.log(JSON.stringify({
  status: "verified",
  evidence_document_id: evidenceDocumentId,
  transactions: verifiedTransactions.data.map((row) => ({ id: row.id, review_status: row.review_status, bank_status: row.metadata?.status, allocated_cents: sum(active(row.allocations)) })),
  invoices: verifiedInvoices.data.map((row) => ({ invoice_number: row.invoice_number, status: row.status, paid_cents: Number(row.paid_cents), balance_cents: Number(row.balance_cents) })),
}, null, 2));
