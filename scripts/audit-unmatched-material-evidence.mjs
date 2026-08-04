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

function daysBetween(later, earlier) {
  return Math.round(
    (new Date(`${later}T12:00:00Z`) - new Date(`${earlier}T12:00:00Z`)) /
      86_400_000,
  );
}

function supplierKey(value) {
  const text = String(value ?? "").toLowerCase();
  if (/sherwin/.test(text)) return "sherwin-williams";
  if (/preston paint/.test(text)) return "preston-paint";
  if (/home depot/.test(text)) return "home-depot";
  if (/merivale century/.test(text)) return "merivale-century";
  if (/canadian tire/.test(text)) return "canadian-tire";
  if (/bridlewood home hardware/.test(text)) return "bridlewood-home-hardware";
  if (/rona/.test(text)) return "rona";
  if (/decorator.?s choice|decortor.?s choice/.test(text)) return "decorators-choice";
  return text.trim().replace(/[^a-z0-9]+/g, "-");
}

const supplierLabels = {
  "sherwin-williams": "Sherwin-Williams",
  "preston-paint": "Preston Paint Center",
  "home-depot": "Home Depot",
  "merivale-century": "Merivale Century Paint",
  "canadian-tire": "Canadian Tire",
  "bridlewood-home-hardware": "Bridlewood Home Hardware",
  rona: "Rona",
  "decorators-choice": "Decorator's Choice",
};

function bankStoreNumber(transaction) {
  return `${transaction.counterparty ?? ""} ${transaction.description ?? ""}`
    .match(/(?:sherwin-williams|sherwin williams)\s*(\d{6})/i)?.[1] ?? null;
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

const [payments, transactions, invoices, portalRecords, allocations] = await Promise.all([
  fetchAll(() =>
    db
      .from("material_payment_verification")
      .select("*")
      .neq("payment_status", "fully_allocated")
      .order("posted_on"),
  ),
  fetchAll(() =>
    db
      .from("financial_transactions")
      .select("id,posted_on,counterparty,description,amount,category")
      .in("category", ["Paint & materials", "Materials"]),
  ),
  fetchAll(() =>
    db
      .from("material_invoice_verification")
      .select(
        "material_invoice_id,supplier_name,invoice_number,invoice_date,total_amount,paid_amount,amount_remaining,extraction_status,verification_status",
      )
      .order("invoice_date"),
  ),
  fetchAll(() =>
    db
      .from("material_supplier_portal_records")
      .select(
        "id,supplier_name,store_number,invoice_number,transaction_date,total_amount,po_number,portal_type,match_status,material_invoice_id",
      )
      .order("transaction_date"),
  ),
  fetchAll(() =>
    db
      .from("material_payment_allocations")
      .select(
        "financial_transaction_id,material_invoice_id,allocated_amount,evidence_reference,needs_review",
      )
      .is("reversed_at", null),
  ),
]);

const transactionById = new Map(transactions.map((row) => [row.id, row]));
const allocationsByInvoice = Map.groupBy(allocations, (row) => row.material_invoice_id);
const unresolved = payments.map((payment) => {
  const transaction = transactionById.get(payment.financial_transaction_id);
  if (!transaction) throw new Error(`Missing bank transaction ${payment.financial_transaction_id}.`);
  const vendor = supplierKey(`${transaction.counterparty ?? ""} ${transaction.description ?? ""}`);
  const remaining = cents(payment.unallocated_amount);
  const store = bankStoreNumber(transaction);
  const sameSupplierInvoices = invoices.filter(
    (invoice) => supplierKey(invoice.supplier_name) === vendor,
  );

  const unpaidPhysicalCandidates = sameSupplierInvoices
    .filter((invoice) => {
      const lag = daysBetween(transaction.posted_on, invoice.invoice_date);
      return cents(invoice.amount_remaining) === remaining && lag >= 0 && lag <= 30;
    })
    .map((invoice) => ({
      invoice_id: invoice.material_invoice_id,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      amount: Number(invoice.amount_remaining),
      posting_lag_days: daysBetween(transaction.posted_on, invoice.invoice_date),
      extraction_status: invoice.extraction_status,
      verification_status: invoice.verification_status,
    }));

  const alreadySettledSameAmount = sameSupplierInvoices
    .filter((invoice) => {
      const distance = Math.abs(daysBetween(transaction.posted_on, invoice.invoice_date));
      return (
        cents(invoice.total_amount) === remaining &&
        cents(invoice.amount_remaining) <= 2 &&
        distance <= 30
      );
    })
    .map((invoice) => ({
      invoice_id: invoice.material_invoice_id,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      amount: Number(invoice.total_amount),
      paid_amount: Number(invoice.paid_amount),
      date_distance_days: Math.abs(daysBetween(transaction.posted_on, invoice.invoice_date)),
      settlement_rows: (allocationsByInvoice.get(invoice.material_invoice_id) ?? []).map(
        (allocation) => {
          const bankRow = transactionById.get(allocation.financial_transaction_id);
          return {
            financial_transaction_id: allocation.financial_transaction_id,
            posted_on: bankRow?.posted_on ?? null,
            amount: Number(allocation.allocated_amount),
            evidence_reference: allocation.evidence_reference,
            needs_review: allocation.needs_review,
          };
        },
      ),
    }));

  const portalOnlyCandidates = portalRecords
    .filter((record) => {
      const lag = daysBetween(transaction.posted_on, record.transaction_date);
      return (
        vendor === "sherwin-williams" &&
        supplierKey(record.supplier_name) === vendor &&
        record.match_status === "source_missing" &&
        cents(record.total_amount) === remaining &&
        lag >= 0 &&
        lag <= 5 &&
        (!store || record.store_number === store)
      );
    })
    .map((record) => ({
      portal_record_id: record.id,
      invoice_number: record.invoice_number,
      invoice_date: record.transaction_date,
      store_number: record.store_number,
      po_number: record.po_number,
      amount: Number(record.total_amount),
      posting_lag_days: daysBetween(transaction.posted_on, record.transaction_date),
      limitation: "Supplier portal row exists, but the physical invoice PDF is not archived",
    }));

  let conclusion = "no_archived_supplier_document";
  if (unpaidPhysicalCandidates.length === 1) conclusion = "unique_physical_invoice_candidate";
  else if (unpaidPhysicalCandidates.length > 1) conclusion = "ambiguous_physical_invoice_candidates";
  else if (portalOnlyCandidates.length === 1) conclusion = "portal_match_missing_physical_invoice";
  else if (portalOnlyCandidates.length > 1) conclusion = "ambiguous_portal_only_candidates";
  else if (alreadySettledSameAmount.length) conclusion = "same_amount_invoice_already_settled";

  return {
    financial_transaction_id: payment.financial_transaction_id,
    posted_on: transaction.posted_on,
    supplier_key: vendor,
    counterparty: transaction.counterparty ?? transaction.description,
    description: transaction.description,
    amount: Number(payment.unallocated_amount),
    conclusion,
    unpaid_physical_candidates: unpaidPhysicalCandidates,
    portal_only_candidates: portalOnlyCandidates,
    already_settled_same_amount: alreadySettledSameAmount,
  };
});

const conclusionCounts = unresolved.reduce((counts, row) => {
  counts[row.conclusion] = (counts[row.conclusion] ?? 0) + 1;
  return counts;
}, {});

const vendorSummary = Object.values(
  unresolved.reduce((vendors, row) => {
    const vendor = vendors[row.supplier_key] ?? {
      supplier: supplierLabels[row.supplier_key] ?? row.counterparty,
      rows: 0,
      amount: 0,
      conclusions: {},
    };
    vendor.rows += 1;
    vendor.amount += cents(row.amount);
    vendor.conclusions[row.conclusion] = (vendor.conclusions[row.conclusion] ?? 0) + 1;
    vendors[row.supplier_key] = vendor;
    return vendors;
  }, {}),
)
  .map((vendor) => ({ ...vendor, amount: vendor.amount / 100 }))
  .sort((left, right) => right.amount - left.amount);

console.log(
  JSON.stringify(
    {
      unmatched_bank_rows: unresolved.length,
      unmatched_total:
        Math.round(unresolved.reduce((sum, row) => sum + cents(row.amount), 0)) / 100,
      conclusions: conclusionCounts,
      vendors: vendorSummary,
      rows: unresolved,
    },
    null,
    2,
  ),
);
