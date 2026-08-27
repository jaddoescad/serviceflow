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

const settledTargets = [
  {
    key: "fennec-august-6-7-8",
    transaction: {
      postedOn: "2026-08-20",
      description: "SEND E-TFR *HyZ SUPP",
      amountCents: 168_750,
      recipient: "Bilal akkacha",
      recipientDestination: "bilal.akkacha2@outlook.com",
      message: "Fennec invoices 6, 7, 8",
      confirmation: "C1Ay7p***HyZ",
      bankStatus: "Autodeposited",
      category: "Subcontractors",
      counterparty: "Fennec Contracting",
      allocationType: "labour_payment",
      classification: "subcontractor_labour",
    },
    invoices: [
      { id: "50cddacf-024b-527d-a419-3e8926d75595", number: "6", supplier: "Fennec Contracting", totalCents: 36_000 },
      { id: "ffa5f3a6-3edd-5f45-aa4a-3af2a3ec03eb", number: "7", supplier: "Fennec Contracting", totalCents: 96_000 },
      { id: "996dce3a-4649-58cc-b9b8-39069388b315", number: "8", supplier: "Fennec Contracting", totalCents: 36_750 },
    ],
  },
  {
    key: "curb-appeal-1404",
    transaction: {
      postedOn: "2026-08-20",
      description: "SEND E-TFR *RMY SUPP",
      amountCents: 15_000,
      recipient: "curb appeal softwash",
      recipientDestination: "payments@curbappealprowash.ca",
      message: "Curb Appeal invoice 1404",
      confirmation: "C1AaPn***RMY",
      bankStatus: "Autodeposited",
      category: "Pressure washing",
      counterparty: "Curb Appeal Pro Wash",
      allocationType: "service_payment",
      classification: "pressure_washing",
    },
    invoices: [
      { id: "70d1089a-e5dc-591a-a08d-150b1963733b", number: "1404", supplier: "Curb Appeal Pro Wash", totalCents: 15_000 },
    ],
  },
];

const allTargets = settledTargets;

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
  throw new Error("Refusing reconciliation for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const invoiceIds = allTargets.flatMap((target) => target.invoices.map((invoice) => invoice.id));
const [transactionResult, invoiceResult] = await Promise.all([
  db
    .from("transactions")
    .select("*,account:accounts(slug,name,last_four),allocations:transaction_allocations(*)")
    .eq("posted_on", "2026-08-20")
    .in("description", allTargets.map((target) => target.transaction.description)),
  db
    .from("invoices")
    .select("*,contact:contacts(id,name,email),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(*),job_allocations:invoice_job_allocations(id,job_id,total_cents,needs_review,job:jobs(id,name,status,started_on,completed_on,production_month))")
    .in("id", invoiceIds),
]);
if (transactionResult.error) throw transactionResult.error;
if (invoiceResult.error) throw invoiceResult.error;

const transactions = transactionResult.data ?? [];
const invoices = invoiceResult.data ?? [];
assert(transactions.length === allTargets.length, `Expected ${allTargets.length} target transactions, found ${transactions.length}.`);
assert(invoices.length === invoiceIds.length, `Expected ${invoiceIds.length} target invoices, found ${invoices.length}.`);

function validateBankEvidence(target, transaction) {
  assert(transaction, `Missing ${target.transaction.description}.`);
  assert(transaction.account?.slug === "td-chequing-6970", `${target.key} account changed.`);
  assert(transaction.posted_on === target.transaction.postedOn, `${target.key} posting date changed.`);
  assert(Number(transaction.amount_cents) === -target.transaction.amountCents, `${target.key} amount changed.`);
  assert(transaction.metadata?.recipient_destination === target.transaction.recipientDestination, `${target.key} recipient destination changed.`);
  assert(transaction.metadata?.message === target.transaction.message, `${target.key} bank message changed.`);
  assert(transaction.metadata?.confirmation_masked === target.transaction.confirmation, `${target.key} confirmation changed.`);
  assert(transaction.metadata?.status === target.transaction.bankStatus, `${target.key} bank status changed.`);
}

function targetInvoiceRows(target) {
  return target.invoices.map((expected) => {
    const invoice = invoices.find((row) => row.id === expected.id);
    assert(invoice, `Missing invoice ${expected.number}.`);
    assert(invoice.invoice_number === expected.number, `${expected.number} invoice number changed.`);
    assert(invoice.direction === "payable", `${expected.number} is not payable.`);
    assert(invoice.contact?.name === expected.supplier, `${expected.number} supplier changed.`);
    assert(Number(invoice.total_cents) === expected.totalCents, `${expected.number} total changed.`);
    assert((invoice.job_allocations ?? []).length > 0, `${expected.number} has no job allocation.`);
    for (const allocation of invoice.job_allocations ?? []) {
      assert(allocation.job, `${expected.number} has a missing allocated job.`);
      if (allocation.job.started_on) {
        assert(allocation.job.started_on >= CUTOFF, `${expected.number} is linked to historical job ${allocation.job.name}.`);
      } else {
        assert(
          !["completed", "archived", "cancelled", "canceled"].includes(String(allocation.job.status).toLowerCase()),
          `${expected.number} is linked to completed or archived undated job ${allocation.job.name}.`,
        );
      }
    }
    return { expected, invoice };
  });
}

const preview = [];
for (const target of settledTargets) {
  const transaction = transactions.find((row) => row.description === target.transaction.description);
  validateBankEvidence(target, transaction);
  const rows = targetInvoiceRows(target);
  const contactId = rows[0].invoice.contact_id;
  assert(rows.every(({ invoice }) => invoice.contact_id === contactId), `${target.key} invoices do not share one supplier contact.`);
  assert(sum(target.invoices, "totalCents") === target.transaction.amountCents, `${target.key} invoice sum does not equal the bank payment.`);

  const invoicePreview = rows.map(({ expected, invoice }) => {
    const allocationId = stableUuid(`transaction-allocation:${target.key}:${transaction.id}:invoice:${invoice.id}`);
    const otherPayments = active(invoice.payments).filter((row) => row.id !== allocationId);
    assert(sum(otherPayments) === 0, `${expected.number} has an unexpected prior payment.`);
    const existing = active(invoice.payments).find((row) => row.id === allocationId);
    if (existing) {
      assert(existing.transaction_id === transaction.id, `${expected.number} expected allocation uses another transaction.`);
      assert(Number(existing.amount_cents) === expected.totalCents, `${expected.number} expected allocation amount changed.`);
    }
    return {
      invoice_number: expected.number,
      job_names: invoice.job_allocations.map((row) => row.job.name),
      total_cents: expected.totalCents,
      current_payment_cents: sum(active(invoice.payments)),
      proposed_status: "paid",
      allocation_id: allocationId,
    };
  });
  const expectedAllocationIds = invoicePreview.map((row) => row.allocation_id);
  assert(active(transaction.allocations).every((row) => expectedAllocationIds.includes(row.id)), `${target.key} transaction has an unexpected active allocation.`);
  preview.push({
    key: target.key,
    bank_status: target.transaction.bankStatus,
    transaction_id: transaction.id,
    amount_cents: Number(transaction.amount_cents),
    proposed_category: target.transaction.category,
    invoices: invoicePreview,
  });
}

console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", payments: preview }, null, 2));
if (!APPLY) process.exit(0);

for (const target of settledTargets) {
  const transaction = transactions.find((row) => row.description === target.transaction.description);
  const rows = targetInvoiceRows(target);
  const contactId = rows[0].invoice.contact_id;
  const allocationIds = [];

  for (const { expected, invoice } of rows) {
    const allocationId = stableUuid(`transaction-allocation:${target.key}:${transaction.id}:invoice:${invoice.id}`);
    allocationIds.push(allocationId);
    const existing = active(invoice.payments).find((row) => row.id === allocationId);
    const allocationWrite = await db.from("transaction_allocations").upsert({
      id: allocationId,
      transaction_id: transaction.id,
      invoice_id: invoice.id,
      contact_id: contactId,
      source_system: "td_easyweb",
      external_id: `${target.transaction.confirmation}:${invoice.invoice_number}`,
      allocation_type: target.transaction.allocationType,
      amount_cents: expected.totalCents,
      allocation_method: "bank_recipient,recipient_destination,exact_bank_message,exact_invoice_sum",
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
        paid_on: transaction.posted_on,
        grouped_invoice_numbers: target.invoices.map((row) => row.number),
        grouped_payment_cents: target.transaction.amountCents,
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
          last_payment_on: transaction.posted_on,
          evidence: {
            source: "TD EasyWeb transfer detail",
            confirmation_masked: target.transaction.confirmation,
            bank_message: target.transaction.message,
          },
        },
      },
      updated_at: capturedAt,
    }).eq("id", invoice.id).eq("updated_at", invoice.updated_at).select("id").maybeSingle();
    if (invoiceWrite.error) throw invoiceWrite.error;
    if (!invoiceWrite.data) throw new Error(`Concurrent invoice update detected for ${invoice.invoice_number}.`);

    const eventWrite = await db.from("verification_events").upsert({
      id: stableUuid(`verification:${target.key}:invoice:${invoice.id}:transaction:${transaction.id}`),
      entity_type: "transaction_allocation",
      entity_id: allocationId,
      action: "supplier_invoice_payment_reconciled",
      reason: `TD EasyWeb shows the exact supplier payment for invoice #${invoice.invoice_number} as ${target.transaction.bankStatus.toLowerCase()}; the grouped invoice sum equals the bank transfer.`,
      old_values: { invoice_status: invoice.status, invoice_paid_cents: invoice.paid_cents, invoice_balance_cents: invoice.balance_cents },
      new_values: { invoice_status: "paid", invoice_paid_cents: expected.totalCents, invoice_balance_cents: 0, allocation_cents: expected.totalCents },
      evidence: {
        source: "TD EasyWeb visible account activity and transfer detail",
        posted_on: transaction.posted_on,
        bank_status: target.transaction.bankStatus,
        bank_recipient: target.transaction.recipient,
        recipient_destination: target.transaction.recipientDestination,
        bank_message: target.transaction.message,
        confirmation_masked: target.transaction.confirmation,
        invoice_number: invoice.invoice_number,
      },
      occurred_at: capturedAt,
    }, { onConflict: "id" });
    if (eventWrite.error) throw eventWrite.error;
  }

  const transactionWrite = await db.from("transactions").update({
    contact_id: contactId,
    counterparty: target.transaction.counterparty,
    category: target.transaction.category,
    review_status: "reconciled",
    notes: `Exact TD EasyWeb settlement for ${target.invoices.map((invoice) => `#${invoice.number}`).join(" + ")}; allocated $${(target.transaction.amountCents / 100).toFixed(2)} in full.`,
    metadata: {
      ...(transaction.metadata ?? {}),
      settlement_confirmation: {
        status: "settled",
        invoice_ids: target.invoices.map((invoice) => invoice.id),
        invoice_numbers: target.invoices.map((invoice) => invoice.number),
        allocation_ids: allocationIds,
        allocated_cents: target.transaction.amountCents,
        method: "bank_recipient,recipient_destination,exact_bank_message,exact_invoice_sum",
        reconciled_at: capturedAt,
      },
    },
    updated_at: capturedAt,
  }).eq("id", transaction.id).eq("updated_at", transaction.updated_at).select("id").maybeSingle();
  if (transactionWrite.error) throw transactionWrite.error;
  if (!transactionWrite.data) throw new Error(`Concurrent transaction update detected for ${target.key}.`);
}

const [verifiedTransactions, verifiedInvoices] = await Promise.all([
  db.from("transactions").select("id,description,amount_cents,category,review_status,counterparty,metadata,allocations:transaction_allocations(id,invoice_id,amount_cents,needs_review,reversed_at)").eq("posted_on", "2026-08-20").in("description", allTargets.map((target) => target.transaction.description)),
  db.from("invoices").select("id,invoice_number,status,total_cents,paid_cents,balance_cents,payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,transaction_id,amount_cents,needs_review,reversed_at)").in("id", invoiceIds),
]);
if (verifiedTransactions.error) throw verifiedTransactions.error;
if (verifiedInvoices.error) throw verifiedInvoices.error;

for (const target of settledTargets) {
  const transaction = verifiedTransactions.data.find((row) => row.description === target.transaction.description);
  assert(transaction.review_status === "reconciled", `${target.key} transaction was not reconciled.`);
  assert(transaction.category === target.transaction.category, `${target.key} category verification failed.`);
  assert(sum(active(transaction.allocations)) === target.transaction.amountCents, `${target.key} allocation total failed.`);
  for (const expected of target.invoices) {
    const invoice = verifiedInvoices.data.find((row) => row.id === expected.id);
    assert(invoice.status === "paid", `${expected.number} status verification failed.`);
    assert(Number(invoice.paid_cents) === expected.totalCents, `${expected.number} paid total failed.`);
    assert(Number(invoice.balance_cents) === 0, `${expected.number} balance verification failed.`);
    assert(sum(active(invoice.payments)) === expected.totalCents, `${expected.number} bank allocation total failed.`);
  }
}

console.log(JSON.stringify({ status: "verified", transactions: verifiedTransactions.data, invoices: verifiedInvoices.data }, null, 2));
