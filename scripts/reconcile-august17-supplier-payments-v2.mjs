#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const capturedAt = new Date().toISOString();

const targets = [
  {
    key: "caledonian-239609-balance",
    transaction: {
      postedOn: "2026-08-17",
      description: "SEND E-TFR *QaV SUPP",
      amountCents: 95_352,
      recipient: "Scott Madden",
      recipientDestination: "scott@caledonianpainting.ca",
      message: "Caledonian invoice 239609 balance",
      confirmation: "C1AjG8***QaV",
      bankStatus: "Autodeposited",
      category: "Sales commissions",
      counterparty: "Caledonian Painting Ltd",
      allocationType: "supplier_payment",
      classification: "sales_commission_and_business_development_overhead",
    },
    invoices: [
      {
        id: "3e859614-a397-5670-b0ab-af0963807eb1",
        number: "239609",
        supplier: "Caledonian Painting Ltd",
        totalCents: 1_095_352,
        priorMatchedCents: 1_000_000,
        allocationCents: 95_352,
      },
    ],
  },
  {
    key: "grutenco-august-01-02",
    transaction: {
      postedOn: "2026-08-17",
      description: "SEND E-TFR *WkE SUPP",
      amountCents: 541_691,
      recipient: "grutenco",
      recipientDestination: "hello@grutenco.ca",
      message: "GT-INV-202608-01 + GT-INV-202608-02",
      confirmation: "CA***WkE",
      bankStatus: "Deposited",
      category: "Subcontractors",
      counterparty: "Grutenco Painting & Construction Services",
      allocationType: "labour_payment",
      classification: "subcontractor_labour",
    },
    invoices: [
      {
        id: "7f0327e7-00a3-5eb9-8121-0e902d288308",
        number: "GT-INV-202608-01",
        supplier: "Grutenco Painting & Construction Services",
        totalCents: 396_163,
        priorMatchedCents: 0,
        allocationCents: 396_163,
      },
      {
        id: "9b422fdb-973b-5d19-bb08-978680877716",
        number: "GT-INV-202608-02",
        supplier: "Grutenco Painting & Construction Services",
        totalCents: 145_528,
        priorMatchedCents: 0,
        allocationCents: 145_528,
      },
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
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

const invoiceIds = targets.flatMap((target) => target.invoices.map((invoice) => invoice.id));
const [transactionResult, invoiceResult] = await Promise.all([
  db
    .from("transactions")
    .select("*,account:accounts(slug,name,last_four),allocations:transaction_allocations(*)")
    .eq("posted_on", "2026-08-17")
    .in("description", targets.map((target) => target.transaction.description)),
  db
    .from("invoices")
    .select("*,contact:contacts(id,name,email),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(*)")
    .in("id", invoiceIds),
]);
if (transactionResult.error) throw transactionResult.error;
if (invoiceResult.error) throw invoiceResult.error;

const transactions = transactionResult.data ?? [];
const invoices = invoiceResult.data ?? [];
assert(transactions.length === targets.length, `Expected ${targets.length} target transactions, found ${transactions.length}.`);
assert(invoices.length === invoiceIds.length, `Expected ${invoiceIds.length} target invoices, found ${invoices.length}.`);

const preview = [];
for (const target of targets) {
  const transaction = transactions.find(
    (row) => row.description === target.transaction.description,
  );
  assert(transaction, `Missing ${target.transaction.description}.`);
  assert(transaction.posted_on === target.transaction.postedOn, `${target.key} posting date changed.`);
  assert(Number(transaction.amount_cents) === -target.transaction.amountCents, `${target.key} amount changed.`);
  assert(transaction.account?.slug === "td-chequing-6970", `${target.key} account changed.`);
  assert(
    [target.transaction.recipient, target.transaction.counterparty].includes(
      transaction.counterparty,
    ),
    `${target.key} recipient changed.`,
  );
  assert(
    transaction.metadata?.recipient_destination === target.transaction.recipientDestination,
    `${target.key} recipient destination changed.`,
  );
  assert(transaction.metadata?.message === target.transaction.message, `${target.key} bank message changed.`);
  assert(
    transaction.metadata?.confirmation_masked === target.transaction.confirmation,
    `${target.key} confirmation changed.`,
  );
  assert(transaction.metadata?.status === target.transaction.bankStatus, `${target.key} bank status changed.`);

  const expectedAllocationIds = target.invoices.map((invoice) =>
    stableUuid(`transaction-allocation:${target.key}:${transaction.id}:invoice:${invoice.id}`),
  );
  const unexpectedTransactionAllocations = active(transaction.allocations).filter(
    (allocation) => !expectedAllocationIds.includes(allocation.id),
  );
  assert(
    unexpectedTransactionAllocations.length === 0,
    `${target.key} has unexpected active allocation(s): ${unexpectedTransactionAllocations.map((row) => row.id).join(", ")}`,
  );

  let contactId = null;
  const invoicePreview = [];
  for (const expected of target.invoices) {
    const invoice = invoices.find((row) => row.id === expected.id);
    assert(invoice, `Missing invoice ${expected.number}.`);
    assert(invoice.invoice_number === expected.number, `${expected.number} invoice number changed.`);
    assert(invoice.direction === "payable", `${expected.number} is not payable.`);
    assert(invoice.contact?.name === expected.supplier, `${expected.number} supplier changed.`);
    assert(Number(invoice.total_cents) === expected.totalCents, `${expected.number} total changed.`);
    if (contactId == null) contactId = invoice.contact_id;
    assert(contactId === invoice.contact_id, `${target.key} invoices do not share one supplier contact.`);

    const allocationId = stableUuid(
      `transaction-allocation:${target.key}:${transaction.id}:invoice:${invoice.id}`,
    );
    const priorPayments = active(invoice.payments).filter((row) => row.id !== allocationId);
    assert(
      sum(priorPayments) === expected.priorMatchedCents,
      `${expected.number} prior matched total changed; expected ${expected.priorMatchedCents}, found ${sum(priorPayments)}.`,
    );
    const existingExpected = active(invoice.payments).find((row) => row.id === allocationId);
    if (existingExpected) {
      assert(
        Number(existingExpected.amount_cents) === expected.allocationCents &&
          existingExpected.transaction_id === transaction.id,
        `${expected.number} expected allocation changed.`,
      );
    }
    assert(
      expected.priorMatchedCents + expected.allocationCents === expected.totalCents,
      `${expected.number} would not settle exactly.`,
    );
    invoicePreview.push({
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      supplier: invoice.contact?.name,
      total_cents: Number(invoice.total_cents),
      current_active_payment_cents: sum(active(invoice.payments)),
      allocation_cents: expected.allocationCents,
      proposed_paid_cents: expected.totalCents,
      proposed_balance_cents: 0,
      allocation_id: allocationId,
    });
  }
  assert(
    target.invoices.reduce((total, invoice) => total + invoice.allocationCents, 0) ===
      target.transaction.amountCents,
    `${target.key} invoice allocations do not equal the bank payment.`,
  );
  preview.push({
    key: target.key,
    transaction: {
      id: transaction.id,
      posted_on: transaction.posted_on,
      description: transaction.description,
      bank_recipient: transaction.counterparty,
      amount_cents: Number(transaction.amount_cents),
      bank_status: transaction.metadata?.status,
      message: transaction.metadata?.message,
      current_review_status: transaction.review_status,
      current_active_allocation_cents: sum(active(transaction.allocations)),
      proposed_category: target.transaction.category,
      proposed_counterparty: target.transaction.counterparty,
    },
    invoices: invoicePreview,
  });
}

console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", payments: preview }, null, 2));
if (!APPLY) process.exit(0);

for (const target of targets) {
  const transaction = transactions.find(
    (row) => row.description === target.transaction.description,
  );
  const targetInvoices = target.invoices.map((expected) => ({
    expected,
    invoice: invoices.find((row) => row.id === expected.id),
  }));
  const contactId = targetInvoices[0].invoice.contact_id;
  const allocationIds = [];

  for (const { expected, invoice } of targetInvoices) {
    const allocationId = stableUuid(
      `transaction-allocation:${target.key}:${transaction.id}:invoice:${invoice.id}`,
    );
    allocationIds.push(allocationId);
    const allocationWrite = await db.from("transaction_allocations").upsert(
      {
        id: allocationId,
        transaction_id: transaction.id,
        invoice_id: invoice.id,
        contact_id: contactId,
        source_system: "td_easyweb",
        external_id: `${target.transaction.confirmation}:${invoice.invoice_number}`,
        allocation_type: target.transaction.allocationType,
        amount_cents: expected.allocationCents,
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
        created_at:
          active(invoice.payments).find((row) => row.id === allocationId)?.created_at ?? capturedAt,
        updated_at: capturedAt,
      },
      { onConflict: "id" },
    );
    if (allocationWrite.error) throw allocationWrite.error;

    const priorSettlement =
      invoice.metadata?.settlement && typeof invoice.metadata.settlement === "object"
        ? invoice.metadata.settlement
        : {};
    const transactionIds = [
      ...new Set([...(priorSettlement.transaction_ids ?? []), transaction.id]),
    ];
    const priorAllocationIds = Array.isArray(priorSettlement.allocation_ids)
      ? priorSettlement.allocation_ids
      : [];
    const invoiceWrite = await db
      .from("invoices")
      .update({
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
            transaction_ids: transactionIds,
            allocation_ids: [...new Set([...priorAllocationIds, allocationId])],
            last_payment_on: transaction.posted_on,
            evidence: {
              source: "TD EasyWeb transfer detail",
              confirmation_masked: target.transaction.confirmation,
              bank_message: target.transaction.message,
            },
          },
        },
        updated_at: capturedAt,
      })
      .eq("id", invoice.id)
      .eq("updated_at", invoice.updated_at)
      .select("id")
      .maybeSingle();
    if (invoiceWrite.error) throw invoiceWrite.error;
    if (!invoiceWrite.data) throw new Error(`Concurrent invoice update detected for ${invoice.invoice_number}.`);

    const eventWrite = await db.from("verification_events").upsert(
      {
        id: stableUuid(`verification:${target.key}:invoice:${invoice.id}:transaction:${transaction.id}`),
        entity_type: "transaction_allocation",
        entity_id: allocationId,
        action: "supplier_invoice_payment_reconciled",
        reason: `TD EasyWeb recipient and message identify payment of invoice #${invoice.invoice_number}; the grouped invoice allocations equal the bank transfer exactly.`,
        old_values: {
          invoice_status: invoice.status,
          invoice_paid_cents: invoice.paid_cents,
          invoice_balance_cents: invoice.balance_cents,
        },
        new_values: {
          invoice_status: "paid",
          invoice_paid_cents: expected.totalCents,
          invoice_balance_cents: 0,
          allocation_cents: expected.allocationCents,
        },
        evidence: {
          source: "TD EasyWeb transfer detail and current account CSV",
          source_document_sha256: transaction.metadata?.source_document_sha256,
          posted_on: transaction.posted_on,
          bank_recipient: target.transaction.recipient,
          recipient_destination: target.transaction.recipientDestination,
          bank_message: target.transaction.message,
          confirmation_masked: target.transaction.confirmation,
          invoice_number: invoice.invoice_number,
          grouped_invoice_numbers: target.invoices.map((row) => row.number),
          grouped_payment_cents: target.transaction.amountCents,
        },
        occurred_at: capturedAt,
      },
      { onConflict: "id" },
    );
    if (eventWrite.error) throw eventWrite.error;
  }

  const transactionWrite = await db
    .from("transactions")
    .update({
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
    })
    .eq("id", transaction.id)
    .eq("updated_at", transaction.updated_at)
    .select("id")
    .maybeSingle();
  if (transactionWrite.error) throw transactionWrite.error;
  if (!transactionWrite.data) throw new Error(`Concurrent transaction update detected for ${target.key}.`);
}

const [verifiedTransactions, verifiedInvoices] = await Promise.all([
  db
    .from("transactions")
    .select("id,description,amount_cents,category,review_status,counterparty,allocations:transaction_allocations(id,invoice_id,amount_cents,needs_review,reversed_at)")
    .eq("posted_on", "2026-08-17")
    .in("description", targets.map((target) => target.transaction.description)),
  db
    .from("invoices")
    .select("id,invoice_number,status,total_cents,paid_cents,balance_cents,payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,transaction_id,amount_cents,needs_review,reversed_at)")
    .in("id", invoiceIds),
]);
if (verifiedTransactions.error) throw verifiedTransactions.error;
if (verifiedInvoices.error) throw verifiedInvoices.error;

for (const target of targets) {
  const transaction = verifiedTransactions.data.find(
    (row) => row.description === target.transaction.description,
  );
  assert(transaction.review_status === "reconciled", `${target.key} transaction was not reconciled.`);
  assert(transaction.category === target.transaction.category, `${target.key} category verification failed.`);
  assert(
    sum(active(transaction.allocations)) === target.transaction.amountCents,
    `${target.key} transaction allocation total failed.`,
  );
  for (const expected of target.invoices) {
    const invoice = verifiedInvoices.data.find((row) => row.id === expected.id);
    assert(invoice.status === "paid", `${expected.number} status verification failed.`);
    assert(Number(invoice.paid_cents) === expected.totalCents, `${expected.number} paid total failed.`);
    assert(Number(invoice.balance_cents) === 0, `${expected.number} balance verification failed.`);
    assert(
      sum(active(invoice.payments)) === expected.totalCents,
      `${expected.number} active bank allocations do not equal its invoice total.`,
    );
  }
}

console.log(
  JSON.stringify(
    {
      status: "verified",
      transactions: verifiedTransactions.data,
      invoices: verifiedInvoices.data,
    },
    null,
    2,
  ),
);
