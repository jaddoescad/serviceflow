#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const includeDetails = process.argv.includes("--details");

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

function dollars(cents) {
  return Math.round(cents) / 100;
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

const [documents, invoices, lines, lineAllocations, paymentVerification, materialTransactions] =
  await Promise.all([
    fetchAll(() => db.from("material_invoice_documents").select("id,content_sha256")),
    fetchAll(() =>
      db
        .from("material_invoice_verification")
        .select("*")
        .order("invoice_date"),
    ),
    fetchAll(() => db.from("material_invoice_lines").select("id,material_invoice_id")),
    fetchAll(() =>
      db
        .from("material_invoice_line_allocations")
        .select("id,material_invoice_line_id,allocation_scope,companycam_project_id,overhead_category")
        .is("reversed_at", null),
    ),
    fetchAll(() =>
      db
        .from("material_payment_verification")
        .select("*")
        .order("posted_on"),
    ),
    fetchAll(() =>
      db
        .from("financial_transactions")
        .select("id,posted_on,counterparty,description,amount,category")
        .in("category", ["Paint & materials", "Materials"]),
    ),
  ]);

const lineById = new Map(lines.map((line) => [line.id, line]));
const allocatedInvoiceIds = new Set(
  lineAllocations
    .map((allocation) => lineById.get(allocation.material_invoice_line_id)?.material_invoice_id)
    .filter(Boolean),
);
const duplicateHashes = Object.entries(
  documents.reduce((counts, document) => {
    counts[document.content_sha256] = (counts[document.content_sha256] ?? 0) + 1;
    return counts;
  }, {}),
).filter(([, count]) => count > 1);
const vendorGroups = new Map();
const transactionById = new Map(
  materialTransactions.map((transaction) => [transaction.id, transaction]),
);
for (const row of paymentVerification) {
  const transaction = transactionById.get(row.financial_transaction_id);
  const name = transaction?.counterparty || transaction?.description || "Unknown";
  const group = vendorGroups.get(name) ?? {
    vendor: name,
    rows: 0,
    total_cents: 0,
    fully_matched: 0,
    partially_matched: 0,
    needs_review: 0,
  };
  group.rows += 1;
  group.total_cents += Math.round(Math.abs(Number(transaction?.amount ?? 0)) * 100);
  if (row.payment_status === "fully_allocated") group.fully_matched += 1;
  else if (row.payment_status === "partially_allocated") group.partially_matched += 1;
  else group.needs_review += 1;
  vendorGroups.set(name, group);
}

const report = {
  documents: {
    count: documents.length,
    duplicate_hashes: duplicateHashes.length,
  },
  invoices: {
    count: invoices.length,
    exact_line_arithmetic: invoices.filter(
      (invoice) =>
        Math.abs(Number(invoice.line_amount_before_tax) - Number(invoice.amount_before_tax)) <= 0.02 &&
        Math.abs(Number(invoice.line_tax_amount) - Number(invoice.tax_amount)) <= 0.02,
    ).length,
    extraction_needs_review: invoices.filter(
      (invoice) => invoice.extraction_status !== "verified",
    ).length,
    fully_job_or_overhead_allocated: invoices.filter(
      (invoice) =>
        Math.abs(Number(invoice.job_allocated_total) - Number(invoice.total_amount)) <= 0.02,
    ).length,
    invoices_with_any_allocation: allocatedInvoiceIds.size,
    settled_or_credit_applied: invoices.filter(
      (invoice) => Math.abs(Number(invoice.amount_remaining)) <= 0.02,
    ).length,
    verification_statuses: invoices.reduce((counts, invoice) => {
      counts[invoice.verification_status] = (counts[invoice.verification_status] ?? 0) + 1;
      return counts;
    }, {}),
  },
  material_bank_rows: {
    count: paymentVerification.length,
    statuses: paymentVerification.reduce((counts, row) => {
      counts[row.payment_status] = (counts[row.payment_status] ?? 0) + 1;
      return counts;
    }, {}),
    vendors: [...vendorGroups.values()]
      .map(({ total_cents: totalCents, ...group }) => ({
        ...group,
        total: dollars(totalCents),
      }))
      .sort((left, right) => right.total - left.total),
    ...(includeDetails
      ? {
          unresolved: paymentVerification
            .filter((row) => row.payment_status !== "fully_allocated")
            .map((row) => {
              const transaction = transactionById.get(row.financial_transaction_id);
              return {
                financial_transaction_id: row.financial_transaction_id,
                posted_on: row.posted_on,
                counterparty: transaction?.counterparty ?? null,
                description: transaction?.description ?? null,
                amount: Number(transaction?.amount ?? 0),
                allocated_amount: Number(row.allocated_amount ?? 0),
                remaining_amount: Number(row.unallocated_amount ?? 0),
                payment_status: row.payment_status,
              };
            }),
        }
      : {}),
  },
};

console.log(JSON.stringify(report, null, 2));
