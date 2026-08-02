#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CONFIRMED_ON = "2026-08-02";
const MARIA = {
  invoiceId: "00726dfc-2a21-47e2-8a70-bf59376c8cbb",
  invoiceNumber: "346484",
  paymentEventId: "bc5f7fb7-6568-4841-9d9a-25c7d1a026ea",
  paymentNumber: "428630",
  transactionId: "b7501f93-0b71-4b83-89fb-a906b149c8ff",
  bankAmount: 423.95,
  invoiceAmount: 423.75,
  overpayment: 0.2,
};
const DUBRAVKA = {
  invoiceId: "552eac3a-d689-47a2-8c40-9eecf4ec69c5",
  invoiceNumber: "381855",
  transactionId: "3f399747-20a7-4528-99ca-a884c061dbde",
  overpayment: 5.87,
};

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function money(value) {
  return Number(Number(value ?? 0).toFixed(2));
}

function sourceObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoError(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const apply = process.argv.includes("--apply");

assert(supabaseUrl && serviceRoleKey, "Missing Supabase credentials.");
assert(
  new URL(supabaseUrl).hostname.split(".")[0] === TARGET_PROJECT_REF,
  "Refusing reconciliation for an unexpected Supabase project.",
);

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [invoiceResult, eventResult, transactionResult, allocationResult] =
  await Promise.all([
    db
      .from("customer_invoices")
      .select(
        "id,invoice_number,customer_name,total_amount,source_paid_amount,currency,accounting_status",
      )
      .in("id", [MARIA.invoiceId, DUBRAVKA.invoiceId]),
    db
      .from("customer_invoice_payment_events")
      .select(
        "id,customer_invoice_id,payment_number,received_on,method,amount,currency",
      )
      .eq("id", MARIA.paymentEventId),
    db
      .from("financial_transactions")
      .select(
        "id,posted_on,description,counterparty,amount,currency,transaction_type,category,is_transfer,review_status,source_data",
      )
      .in("id", [MARIA.transactionId, DUBRAVKA.transactionId]),
    db
      .from("customer_invoice_bank_allocations")
      .select(
        "id,financial_transaction_id,customer_invoice_id,source_payment_event_id,allocated_amount,invoice_applied_amount,reversed_at",
      )
      .in("financial_transaction_id", [
        MARIA.transactionId,
        DUBRAVKA.transactionId,
      ])
      .is("reversed_at", null),
  ]);
const invoices = assertNoError("customer invoices", invoiceResult);
const events = assertNoError("Maria payment event", eventResult);
const transactions = assertNoError("financial transactions", transactionResult);
const allocations = assertNoError("customer allocations", allocationResult);

assert(invoices.length === 2, "The target invoice set changed.");
assert(events.length === 1, "Maria payment event is missing.");
assert(transactions.length === 2, "The target bank transaction set changed.");

const invoiceById = new Map(invoices.map((row) => [row.id, row]));
const transactionById = new Map(transactions.map((row) => [row.id, row]));
const mariaInvoice = invoiceById.get(MARIA.invoiceId);
const dubravkaInvoice = invoiceById.get(DUBRAVKA.invoiceId);
const mariaEvent = events[0];
const mariaTransaction = transactionById.get(MARIA.transactionId);
const dubravkaTransaction = transactionById.get(DUBRAVKA.transactionId);

assert(
  mariaInvoice.invoice_number === MARIA.invoiceNumber,
  "Maria invoice changed.",
);
assert(
  mariaInvoice.customer_name === "Maria Gonzalez",
  "Maria customer changed.",
);
assert(
  money(mariaInvoice.total_amount) === 847.5,
  "Maria invoice total changed.",
);
assert(
  mariaInvoice.accounting_status === "active",
  "Maria invoice is not active.",
);
assert(
  mariaEvent.customer_invoice_id === MARIA.invoiceId,
  "Maria event invoice changed.",
);
assert(
  mariaEvent.payment_number === MARIA.paymentNumber,
  "Maria payment number changed.",
);
assert(mariaEvent.method === "Check", "Maria payment is not a cheque.");
assert(
  money(mariaEvent.amount) === MARIA.invoiceAmount,
  "Maria event amount changed.",
);
assert(
  mariaTransaction.posted_on === "2026-01-13",
  "Maria deposit date changed.",
);
assert(
  mariaTransaction.description === "DEPOSIT",
  "Maria deposit description changed.",
);
assert(
  money(mariaTransaction.amount) === MARIA.bankAmount,
  "Maria deposit amount changed.",
);
assert(mariaTransaction.currency === "CAD", "Maria deposit is not CAD.");
assert(
  mariaTransaction.transaction_type === "income",
  "Maria deposit is not income.",
);
assert(
  mariaTransaction.category === "Painting revenue",
  "Maria deposit category changed.",
);
assert(!mariaTransaction.is_transfer, "Maria deposit is marked as a transfer.");

assert(
  dubravkaInvoice.invoice_number === DUBRAVKA.invoiceNumber,
  "Dubravka invoice changed.",
);
assert(
  dubravkaInvoice.customer_name === "Dubravka Staka",
  "Dubravka customer changed.",
);
assert(
  money(dubravkaInvoice.total_amount) === 1492.73,
  "Dubravka total changed.",
);
assert(
  money(dubravkaInvoice.source_paid_amount) === 1498.6,
  "Dubravka source-paid amount changed.",
);
assert(
  money(dubravkaTransaction.amount) === 1250,
  "Dubravka bank row changed.",
);
const dubravkaException = sourceObject(
  sourceObject(dubravkaTransaction.source_data).customer_revenue_exception,
);
assert(
  dubravkaException.status === "confirmed" &&
    dubravkaException.kind === "overpayment",
  "Dubravka overpayment evidence is missing.",
);

const mariaExisting = allocations.find(
  (row) =>
    row.financial_transaction_id === MARIA.transactionId &&
    row.customer_invoice_id === MARIA.invoiceId,
);
const dubravkaAllocation = allocations.find(
  (row) =>
    row.financial_transaction_id === DUBRAVKA.transactionId &&
    row.customer_invoice_id === DUBRAVKA.invoiceId,
);
assert(dubravkaAllocation, "Dubravka invoice allocation is missing.");
assert(
  money(
    money(dubravkaTransaction.amount) -
      money(dubravkaAllocation.allocated_amount),
  ) === DUBRAVKA.overpayment,
  "Dubravka overpayment residual changed.",
);

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      project_ref: TARGET_PROJECT_REF,
      maria: {
        transaction: "2026-01-13 DEPOSIT",
        bank_amount: MARIA.bankAmount,
        invoice_number: MARIA.invoiceNumber,
        invoice_credit: MARIA.invoiceAmount,
        overpayment: MARIA.overpayment,
        action: mariaExisting
          ? "already_reconciled"
          : "allocate_cheque_and_record_overpayment",
      },
      dubravka: {
        invoice_number: DUBRAVKA.invoiceNumber,
        invoice_total: money(dubravkaInvoice.total_amount),
        recorded_payments: money(dubravkaInvoice.source_paid_amount),
        overpayment: DUBRAVKA.overpayment,
        action: "accept_existing_confirmed_overpayment",
      },
    },
    null,
    2,
  ),
);

if (!apply) process.exit(0);

if (!mariaExisting) {
  assertNoError(
    "Maria cheque allocation",
    await db.from("customer_invoice_bank_allocations").insert({
      financial_transaction_id: MARIA.transactionId,
      customer_invoice_id: MARIA.invoiceId,
      source_payment_event_id: MARIA.paymentEventId,
      allocated_amount: MARIA.invoiceAmount,
      invoice_applied_amount: MARIA.invoiceAmount,
      match_method: [
        "owner_confirmed_cheque",
        "bank_deposit_amount_with_overpayment",
        "customer_invoice_payment_event",
      ],
      confidence: "confirmed",
      evidence_note:
        "Ottawa Painters confirmed the 2026-01-13 $423.95 cheque deposit is Maria Gonzalez's second $423.75 payment for invoice #346484; the remaining $0.20 is a confirmed overpayment.",
      confirmed_by: null,
      confirmed_at: new Date().toISOString(),
    }),
  );
}

const mariaVerification = assertNoError(
  "Maria bank verification",
  await db
    .from("customer_revenue_verification")
    .select("payment_status,allocated_amount,unallocated_amount")
    .eq("financial_transaction_id", MARIA.transactionId),
)[0];
assert(mariaVerification, "Maria bank verification is missing.");

const mariaSource = sourceObject(mariaTransaction.source_data);
assertNoError(
  "Maria transaction evidence",
  await db
    .from("financial_transactions")
    .update({
      counterparty: "Maria Gonzalez",
      review_status: "reconciled",
      notes:
        "Cheque deposit confirmed for Maria Gonzalez invoice #346484. Applied $423.75; preserved $0.20 as a confirmed overpayment.",
      source_data: {
        ...mariaSource,
        customer_revenue_identity: {
          status: "confirmed",
          provider: "cheque",
          customer_name: "Maria Gonzalez",
          invoice_number: MARIA.invoiceNumber,
          payment_number: MARIA.paymentNumber,
          verified_at: `${CONFIRMED_ON}T00:00:00-04:00`,
          confirmation_source: "owner_confirmation",
        },
        customer_revenue_exception: {
          kind: "rounding_overpayment",
          status: "confirmed",
          resolution:
            "$0.20 exceeds Maria Gonzalez invoice #346484 after the second cheque payment.",
          confirmed_at: new Date().toISOString(),
        },
        customer_revenue_settlement: {
          status: mariaVerification.payment_status,
          allocated_amount: money(mariaVerification.allocated_amount),
          unallocated_amount: money(mariaVerification.unallocated_amount),
          customer_invoice_ids: [MARIA.invoiceId],
          rule: "customer_invoice_bank_allocations_are_settlement_truth",
          updated_at: new Date().toISOString(),
        },
      },
    })
    .eq("id", MARIA.transactionId),
);

const [finalInvoiceResult, finalTransactionResult, finalRevenueResult] =
  await Promise.all([
    db
      .from("customer_invoice_verification")
      .select(
        "customer_invoice_id,invoice_number,customer_name,total_amount,source_paid_amount,bank_paid_amount,bank_cash_amount,amount_remaining,bank_payment_status,verification_status,confirmed_overpayment_amount",
      )
      .in("customer_invoice_id", [MARIA.invoiceId, DUBRAVKA.invoiceId]),
    db
      .from("financial_transactions")
      .select("id,counterparty,review_status,source_data")
      .in("id", [MARIA.transactionId, DUBRAVKA.transactionId]),
    db
      .from("customer_revenue_verification")
      .select(
        "financial_transaction_id,payment_status,allocated_amount,unallocated_amount",
      )
      .in("financial_transaction_id", [
        MARIA.transactionId,
        DUBRAVKA.transactionId,
      ]),
  ]);
const finalInvoices = assertNoError("final invoices", finalInvoiceResult);
const finalTransactions = assertNoError(
  "final transactions",
  finalTransactionResult,
);
const finalRevenue = assertNoError("final revenue", finalRevenueResult);

for (const invoice of finalInvoices) {
  assert(
    invoice.bank_payment_status === "paid" &&
      invoice.verification_status === "verified" &&
      money(invoice.amount_remaining) === 0,
    `Invoice #${invoice.invoice_number} is not resolved.`,
  );
}
const finalMariaInvoice = finalInvoices.find(
  (row) => row.customer_invoice_id === MARIA.invoiceId,
);
const finalDubravkaInvoice = finalInvoices.find(
  (row) => row.customer_invoice_id === DUBRAVKA.invoiceId,
);
assert(
  money(finalMariaInvoice.confirmed_overpayment_amount) === MARIA.overpayment,
  "Maria overpayment is not visible on the invoice.",
);
assert(
  money(finalDubravkaInvoice.confirmed_overpayment_amount) ===
    DUBRAVKA.overpayment,
  "Dubravka overpayment is not visible on the invoice.",
);
for (const transaction of finalTransactions) {
  assert(
    transaction.review_status === "reconciled",
    `Transaction ${transaction.id} still needs review.`,
  );
}

console.log(
  JSON.stringify(
    {
      applied: true,
      invoices: finalInvoices.map((invoice) => ({
        customer: invoice.customer_name,
        invoice_number: invoice.invoice_number,
        invoice_total: money(invoice.total_amount),
        bank_credit: money(invoice.bank_paid_amount),
        overpayment: money(invoice.confirmed_overpayment_amount),
        payment_status: invoice.bank_payment_status,
        verification: invoice.verification_status,
      })),
      bank_rows: finalRevenue.map((row) => ({
        financial_transaction_id: row.financial_transaction_id,
        allocated_amount: money(row.allocated_amount),
        overpayment_residual: money(row.unallocated_amount),
        settlement: "resolved_overpayment",
      })),
    },
    null,
    2,
  ),
);
