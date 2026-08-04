#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);

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
          line
            .slice(separator + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function assertResult(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey)
  throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF)
  throw new Error("Unexpected Supabase project.");
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [
  labourAllocationsResult,
  labourInvoicesResult,
  materialAllocationsResult,
  materialInvoicesResult,
] = await Promise.all([
  db
    .from("labour_payment_allocations")
    .select("financial_transaction_id,invoice_id,allocated_amount")
    .is("reversed_at", null),
  db
    .from("labour_invoices")
    .select(
      "id,invoice_number,supplier_name,amount_before_tax,tax_amount,amount_paid",
    ),
  db
    .from("material_payment_allocations")
    .select("financial_transaction_id,material_invoice_id,allocated_amount")
    .is("reversed_at", null),
  db
    .from("material_invoices")
    .select(
      "id,invoice_number,supplier_name,amount_before_tax,tax_amount,total_amount",
    ),
]);
const labourAllocations = assertResult(
  "labour allocations",
  labourAllocationsResult,
);
const labourInvoices = new Map(
  assertResult("labour invoices", labourInvoicesResult).map((invoice) => [
    invoice.id,
    invoice,
  ]),
);
const materialAllocations = assertResult(
  "material allocations",
  materialAllocationsResult,
);
const materialInvoices = new Map(
  assertResult("material invoices", materialInvoicesResult).map((invoice) => [
    invoice.id,
    invoice,
  ]),
);

const taxByTransaction = new Map();
function addTax(transactionId, allocation, invoice, kind) {
  const gross =
    Math.abs(Number(invoice.amount_paid ?? invoice.total_amount ?? 0)) ||
    roundMoney(
      Math.abs(Number(invoice.amount_before_tax ?? 0)) +
        Math.abs(Number(invoice.tax_amount ?? 0)),
    );
  if (gross <= 0)
    throw new Error(`${kind} invoice ${invoice.id} has no usable gross total.`);
  const tax = roundMoney(
    (Math.abs(Number(allocation.allocated_amount)) *
      Math.abs(Number(invoice.tax_amount ?? 0))) /
      gross,
  );
  const current = taxByTransaction.get(transactionId) ?? {
    tax: 0,
    invoices: [],
    kinds: new Set(),
  };
  current.tax = roundMoney(current.tax + tax);
  current.invoices.push({
    id: invoice.id,
    number: invoice.invoice_number,
    supplier: invoice.supplier_name,
    allocated_amount: Number(allocation.allocated_amount),
    tax,
  });
  current.kinds.add(kind);
  taxByTransaction.set(transactionId, current);
}
for (const allocation of labourAllocations)
  addTax(
    allocation.financial_transaction_id,
    allocation,
    labourInvoices.get(allocation.invoice_id),
    "labour_invoice",
  );
for (const allocation of materialAllocations)
  addTax(
    allocation.financial_transaction_id,
    allocation,
    materialInvoices.get(allocation.material_invoice_id),
    "material_invoice",
  );

const ids = [...taxByTransaction.keys()];
const transactions = assertResult(
  "financial transactions",
  await db
    .from("financial_transactions")
    .select("id,amount,tax_amount,source_data")
    .in("id", ids),
);
if (transactions.length !== ids.length)
  throw new Error("One or more allocated financial transactions are missing.");
const changed = transactions.filter(
  (row) =>
    roundMoney(Math.abs(Number(row.tax_amount))) !==
    taxByTransaction.get(row.id).tax,
);
const totals = [...taxByTransaction.values()].reduce(
  (summary, item) => ({
    tax: roundMoney(summary.tax + item.tax),
    rows: summary.rows + 1,
  }),
  { tax: 0, rows: 0 },
);
console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      allocated_payment_rows: totals.rows,
      documented_hst: totals.tax,
      rows_changed: changed.length,
    },
    null,
    2,
  ),
);
if (!APPLY) {
  console.log("Dry run only. Re-run with --apply.");
  process.exit(0);
}

const now = new Date().toISOString();
for (const row of transactions) {
  const evidence = taxByTransaction.get(row.id);
  const sign = Number(row.amount) < 0 ? -1 : 1;
  assertResult(
    `transaction ${row.id}`,
    await db
      .from("financial_transactions")
      .update({
        tax_amount: sign * evidence.tax,
        source_data: {
          ...(row.source_data ?? {}),
          tax_evidence: {
            status: "documented",
            source: "allocated supplier invoices",
            confirmed_on: "2026-08-02",
            evidence_kinds: [...evidence.kinds],
            invoices: evidence.invoices,
          },
        },
        updated_at: now,
      })
      .eq("id", row.id),
  );
}

console.log(
  "Synchronized payment HST from active supplier-invoice allocations.",
);
