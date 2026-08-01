#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const apply = process.argv.includes("--apply");

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

function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function dollars(value) {
  return Math.round(value) / 100;
}

function daysBetween(later, earlier) {
  return Math.round(
    (new Date(`${later}T12:00:00Z`) - new Date(`${earlier}T12:00:00Z`)) /
      86_400_000,
  );
}

function vendorMatches(invoice, transaction) {
  const text = `${transaction.counterparty ?? ""} ${transaction.description ?? ""}`.toLowerCase();
  if (invoice.supplier_name === "The Home Depot") return /home depot/.test(text);
  if (invoice.supplier_name === "Preston Paint Center") return /preston paint/.test(text);
  if (invoice.supplier_name === "Canadian Tire") return /canadian tire/.test(text);
  return false;
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

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF) {
  throw new Error("Refusing reconciliation for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [invoices, transactions, allocations] = await Promise.all([
  fetchAll(() =>
    db
      .from("material_invoices")
      .select(
        "id,source_system,supplier_name,invoice_number,invoice_date,invoice_type,total_amount,material_invoice_documents(original_filename,source_reference)",
      )
      .in("source_system", [
        "gmail_home_depot_receipt",
        "gmail_preston_material_receipt",
        "gmail_canadian_tire_receipt",
      ])
      .gt("total_amount", 0)
      .order("invoice_date"),
  ),
  fetchAll(() =>
    db
      .from("financial_transactions")
      .select("id,posted_on,counterparty,description,amount,currency,transaction_type,category,is_transfer")
      .eq("transaction_type", "expense")
      .eq("is_transfer", false)
      .lt("amount", 0)
      .in("category", ["Paint & materials", "Materials"])
      .order("posted_on"),
  ),
  fetchAll(() =>
    db
      .from("material_payment_allocations")
      .select("financial_transaction_id,material_invoice_id,allocated_amount")
      .is("reversed_at", null),
  ),
]);

const paidByInvoice = new Map();
const allocatedByTransaction = new Map();
for (const allocation of allocations) {
  paidByInvoice.set(
    allocation.material_invoice_id,
    (paidByInvoice.get(allocation.material_invoice_id) ?? 0) + cents(allocation.allocated_amount),
  );
  allocatedByTransaction.set(
    allocation.financial_transaction_id,
    (allocatedByTransaction.get(allocation.financial_transaction_id) ?? 0) + cents(allocation.allocated_amount),
  );
}

const usedTransactionIds = new Set();
const planned = [];
const unmatched = [];
const ambiguous = [];

for (const invoice of invoices) {
  const remaining = cents(invoice.total_amount) - (paidByInvoice.get(invoice.id) ?? 0);
  if (remaining <= 2) continue;
  const candidates = transactions
    .filter((transaction) => {
      const transactionRemaining =
        Math.abs(cents(transaction.amount)) -
        (allocatedByTransaction.get(transaction.id) ?? 0);
      const dayDistance = daysBetween(transaction.posted_on, invoice.invoice_date);
      return (
        transaction.currency === "CAD" &&
        !usedTransactionIds.has(transaction.id) &&
        transactionRemaining === remaining &&
        dayDistance >= 0 &&
        dayDistance <= 5 &&
        vendorMatches(invoice, transaction)
      );
    })
    .map((transaction) => ({
      ...transaction,
      day_distance: daysBetween(transaction.posted_on, invoice.invoice_date),
    }))
    .sort((left, right) => left.day_distance - right.day_distance || left.posted_on.localeCompare(right.posted_on));

  const nearestDistance = candidates[0]?.day_distance;
  const nearest = candidates.filter((candidate) => candidate.day_distance === nearestDistance);
  const auditInvoice = {
    invoice_id: invoice.id,
    supplier: invoice.supplier_name,
    invoice_number: invoice.invoice_number,
    invoice_date: invoice.invoice_date,
    total: dollars(remaining),
  };
  if (!nearest.length) {
    unmatched.push(auditInvoice);
    continue;
  }
  if (nearest.length !== 1) {
    ambiguous.push({
      ...auditInvoice,
      candidates: nearest.map((row) => ({ id: row.id, posted_on: row.posted_on, amount: row.amount })),
    });
    continue;
  }
  const transaction = nearest[0];
  usedTransactionIds.add(transaction.id);
  const document = Array.isArray(invoice.material_invoice_documents)
    ? invoice.material_invoice_documents[0]
    : invoice.material_invoice_documents;
  planned.push({
    financial_transaction_id: transaction.id,
    material_invoice_id: invoice.id,
    allocated_amount: dollars(remaining),
    allocation_method: "date_amount_exact",
    evidence_reference: `${document?.original_filename ?? invoice.invoice_number} · exact supplier, amount, and ${transaction.day_distance}-day posting lag`,
    confidence: 1,
    needs_review: false,
    source_payload: {
      supplier: invoice.supplier_name,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      bank_posted_on: transaction.posted_on,
      posting_lag_days: transaction.day_distance,
      rule: "Unique supplier + exact remaining amount + bank posting 0-5 days after receipt",
      source_reference: document?.source_reference ?? null,
    },
  });
}

const report = {
  mode: apply ? "apply" : "dry-run",
  evidence_invoices: invoices.length,
  planned_allocations: planned.length,
  planned_total: dollars(planned.reduce((sum, row) => sum + cents(row.allocated_amount), 0)),
  planned: planned.map((allocation) => {
    const invoice = invoices.find((row) => row.id === allocation.material_invoice_id);
    const transaction = transactions.find((row) => row.id === allocation.financial_transaction_id);
    return {
      supplier: invoice?.supplier_name,
      invoice_number: invoice?.invoice_number,
      invoice_date: invoice?.invoice_date,
      bank_posted_on: transaction?.posted_on,
      amount: allocation.allocated_amount,
    };
  }),
  unmatched,
  ambiguous,
  inserted_allocations: 0,
};

if (ambiguous.length) {
  console.log(JSON.stringify(report, null, 2));
  throw new Error(`Refusing reconciliation: ${ambiguous.length} ambiguous exact payment match(es).`);
}

if (apply && planned.length) {
  const inserted = await db.from("material_payment_allocations").insert(planned);
  if (inserted.error) throw inserted.error;
  report.inserted_allocations = planned.length;
}

console.log(JSON.stringify(report, null, 2));
