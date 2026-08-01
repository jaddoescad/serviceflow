#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await queryFactory().range(page * pageSize, page * pageSize + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Pagination exceeded 100,000 rows.");
}

function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function objectValue(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF) {
  throw new Error("Refusing audit for an unexpected Supabase project.");
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const [transactions, verification, allocations, invoices, paymentEvents] =
  await Promise.all([
    fetchAll(() => db.from("financial_transactions").select(
      "id,posted_on,description,counterparty,amount,review_status,source_data,category,transaction_type,is_transfer",
    ).eq("category", "Painting revenue").eq("transaction_type", "income").eq("is_transfer", false)),
    fetchAll(() => db.from("customer_revenue_verification").select("*")),
    fetchAll(() => db.from("customer_invoice_bank_allocations").select(
      "id,financial_transaction_id,customer_invoice_id,source_payment_event_id,allocated_amount,invoice_applied_amount,reversed_at",
    ).is("reversed_at", null)),
    fetchAll(() => db.from("customer_invoices").select("id,invoice_number,total_amount")),
    fetchAll(() => db.from("customer_invoice_payment_events").select("id,payment_number,amount")),
  ]);

const verificationByTransaction = new Map(
  verification.map((row) => [row.financial_transaction_id, row]),
);
const reviewStatusFailures = [];
for (const transaction of transactions) {
  const row = verificationByTransaction.get(transaction.id);
  const exception = objectValue(objectValue(transaction.source_data).customer_revenue_exception);
  const settledException = exception.status === "confirmed" && exception.review !== true;
  const expected = row?.payment_status === "fully_allocated" || settledException
    ? "reconciled"
    : "needs_review";
  if (transaction.review_status !== expected) {
    reviewStatusFailures.push({
      id: transaction.id,
      posted_on: transaction.posted_on,
      description: transaction.description,
      payment_status: row?.payment_status ?? "missing",
      exception: exception.kind ?? null,
      actual: transaction.review_status,
      expected,
    });
  }
}

const duplicateKeys = [];
const seenKeys = new Set();
const bankTotals = new Map();
const invoiceTotals = new Map();
const paymentTotals = new Map();
for (const allocation of allocations) {
  const key = `${allocation.financial_transaction_id}|${allocation.customer_invoice_id}|${allocation.source_payment_event_id ?? "none"}`;
  if (seenKeys.has(key)) duplicateKeys.push(key);
  seenKeys.add(key);
  bankTotals.set(
    allocation.financial_transaction_id,
    (bankTotals.get(allocation.financial_transaction_id) ?? 0) + cents(allocation.allocated_amount),
  );
  invoiceTotals.set(
    allocation.customer_invoice_id,
    (invoiceTotals.get(allocation.customer_invoice_id) ?? 0) + cents(allocation.invoice_applied_amount),
  );
  if (allocation.source_payment_event_id) {
    paymentTotals.set(
      allocation.source_payment_event_id,
      (paymentTotals.get(allocation.source_payment_event_id) ?? 0) + cents(allocation.invoice_applied_amount),
    );
  }
}

const transactionById = new Map(transactions.map((row) => [row.id, row]));
const invoiceById = new Map(invoices.map((row) => [row.id, row]));
const paymentById = new Map(paymentEvents.map((row) => [row.id, row]));
const bankOverallocations = [...bankTotals].filter(
  ([id, total]) => total > cents(transactionById.get(id)?.amount) + 1,
);
const invoiceOverallocations = [...invoiceTotals].filter(
  ([id, total]) => total > cents(invoiceById.get(id)?.total_amount) + 1,
);
const paymentOverallocations = [...paymentTotals].filter(
  ([id, total]) => total > cents(paymentById.get(id)?.amount) + 1,
);

const interacEvidence = JSON.parse(
  readFileSync(
    path.resolve(repoRoot, "data/customer-revenue-payment-evidence-2025-2026.json"),
    "utf8",
  ),
).interac;
const missingInteracIdentity = interacEvidence.filter((evidence) => {
  const transaction = transactionById.get(evidence.financial_transaction_id);
  const identity = objectValue(objectValue(transaction?.source_data).customer_revenue_identity);
  return identity.status !== "confirmed" || identity.reference !== evidence.interac_reference;
});

const statusCounts = verification.reduce((output, row) => {
  output[row.payment_status] = (output[row.payment_status] ?? 0) + 1;
  return output;
}, {});
const exceptionCounts = transactions.reduce((output, transaction) => {
  const exception = objectValue(objectValue(transaction.source_data).customer_revenue_exception);
  if (exception.status === "confirmed") {
    const key = String(exception.kind ?? "unknown");
    output[key] = (output[key] ?? 0) + 1;
  }
  return output;
}, {});

const failures = {
  review_status: reviewStatusFailures,
  duplicate_active_allocations: duplicateKeys,
  bank_overallocations: bankOverallocations,
  invoice_overallocations: invoiceOverallocations,
  payment_event_overallocations: paymentOverallocations,
  missing_interac_identity: missingInteracIdentity.map((row) => row.financial_transaction_id),
};
const failureCount = Object.values(failures).reduce((sum, rows) => sum + rows.length, 0);
console.log(JSON.stringify({
  passed: failureCount === 0,
  customer_revenue_rows: transactions.length,
  active_allocations: allocations.length,
  payment_status_counts: statusCounts,
  documented_exception_counts: exceptionCounts,
  interac_identities_verified: interacEvidence.length - missingInteracIdentity.length,
  failures,
}, null, 2));
if (failureCount) process.exitCode = 1;
