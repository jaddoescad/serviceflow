#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CURB_APPEAL_CONTACT_ID = "aa2f1617-b5c1-5cda-b10b-eead26562cb3";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function envFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      return [line.slice(0, separator).trim(), value];
    }));
}

function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function usableAllocations(rows) {
  const active = rows.filter((row) => !row.metadata?.reversed_at);
  const linePairs = new Set(active.filter((row) => row.invoice_line_id).map((row) => `${row.invoice_id}\0${row.job_id}`));
  return active.filter((row) => row.invoice_line_id || !linePairs.has(`${row.invoice_id}\0${row.job_id}`));
}

const env = {
  ...envFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")),
  ...envFile(path.join(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const invoiceResult = await db.from("invoices")
  .select("id,contact_id,invoice_number,issued_on,category,status,subtotal_cents,tax_cents,total_cents,metadata")
  .eq("direction", "payable")
  .order("issued_on")
  .order("invoice_number");
if (invoiceResult.error) throw invoiceResult.error;
const invoices = (invoiceResult.data ?? []).filter((invoice) =>
  invoice.contact_id === CURB_APPEAL_CONTACT_ID ||
  /curb appeal/i.test(invoice.metadata?.supplier_name ?? "") ||
  invoice.metadata?.cost_classification === "pressure_washing"
);
if (!invoices.length) throw new Error("No payable Curb Appeal Pro Wash invoices found.");
const invoiceIds = invoices.map((row) => row.id);

const [lineResult, jobAllocationResult, paymentAllocationResult] = await Promise.all([
  db.from("invoice_lines").select("id,invoice_id,line_number,description,subtotal_cents,tax_cents,total_cents,metadata").in("invoice_id", invoiceIds).order("invoice_id").order("line_number"),
  db.from("invoice_job_allocations").select("id,invoice_id,invoice_line_id,job_id,subtotal_cents,tax_cents,total_cents,metadata,job:jobs(name)").in("invoice_id", invoiceIds),
  db.from("transaction_allocations").select("id,invoice_id,transaction_id,allocation_type,amount_cents,reversed_at,metadata").in("invoice_id", invoiceIds),
]);
for (const [label, result] of Object.entries({ lineResult, jobAllocationResult, paymentAllocationResult })) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
const lines = lineResult.data ?? [];
const lineById = new Map(lines.map((row) => [row.id, row]));
const invoiceById = new Map(invoices.map((row) => [row.id, row]));
const jobAllocations = jobAllocationResult.data ?? [];
const paymentAllocations = paymentAllocationResult.data ?? [];
const transactionIds = [...new Set(paymentAllocations.map((row) => row.transaction_id).filter(Boolean))];
const transactionResult = transactionIds.length
  ? await db.from("transactions").select("id,posted_on,counterparty,amount_cents,category,review_status,metadata").in("id", transactionIds)
  : { data: [], error: null };
if (transactionResult.error) throw transactionResult.error;
const transactions = transactionResult.data ?? [];

const currentLabourAllocations = usableAllocations(jobAllocations).filter((allocation) => {
  const invoice = invoiceById.get(allocation.invoice_id);
  const line = allocation.invoice_line_id ? lineById.get(allocation.invoice_line_id) : null;
  const entryType = line?.metadata?.entry_type;
  if (entryType === "other" || entryType === "material") return false;
  return entryType === "labour" || invoice?.category === "labour";
});
const currentLabourSubtotalCents = currentLabourAllocations.reduce((sum, row) => sum + Number(row.subtotal_cents ?? 0), 0);

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  supplier: "Curb Appeal Pro Wash",
  invoices: invoices.map((invoice) => ({
    id: invoice.id,
    number: invoice.invoice_number,
    issued_on: invoice.issued_on,
    category: invoice.category,
    subtotal_cents: invoice.subtotal_cents,
    tax_cents: invoice.tax_cents,
    total_cents: invoice.total_cents,
    lines: lines.filter((line) => line.invoice_id === invoice.id).map((line) => ({ id: line.id, description: line.description, entry_type: line.metadata?.entry_type ?? null })),
    job_allocations: jobAllocations.filter((row) => row.invoice_id === invoice.id).map((row) => ({ id: row.id, job: row.job?.name ?? null, subtotal_cents: row.subtotal_cents })),
  })),
  current_labour_subtotal_cents: currentLabourSubtotalCents,
  transactions: transactions.map((row) => ({ id: row.id, posted_on: row.posted_on, amount_cents: row.amount_cents, category: row.category })),
}, null, 2));
if (!APPLY) process.exit(0);

const now = new Date().toISOString();
for (const invoice of invoices) {
  const result = await db.from("invoices").update({
    category: "other",
    metadata: {
      ...(invoice.metadata ?? {}),
      cost_classification: "pressure_washing",
      service_category: "Pressure washing",
      classification_confirmation: {
        status: "user_confirmed",
        confirmed_on: now,
        note: "Curb Appeal Pro Wash is pressure washing, not painter labour.",
      },
    },
    updated_at: now,
  }).eq("id", invoice.id);
  if (result.error) throw result.error;
}
for (const line of lines) {
  const result = await db.from("invoice_lines").update({
    metadata: {
      ...(line.metadata ?? {}),
      entry_type: "other",
      cost_classification: "pressure_washing",
      service_category: "Pressure washing",
    },
    updated_at: now,
  }).eq("id", line.id).eq("invoice_id", line.invoice_id);
  if (result.error) throw result.error;
}
for (const allocation of jobAllocations) {
  const result = await db.from("invoice_job_allocations").update({
    metadata: {
      ...(allocation.metadata ?? {}),
      entry_type: "other",
      cost_classification: "pressure_washing",
      service_category: "Pressure washing",
    },
    updated_at: now,
  }).eq("id", allocation.id).eq("invoice_id", allocation.invoice_id);
  if (result.error) throw result.error;
}
for (const allocation of paymentAllocations) {
  const result = await db.from("transaction_allocations").update({
    allocation_type: "pressure_washing_payment",
    metadata: {
      ...(allocation.metadata ?? {}),
      cost_classification: "pressure_washing",
      service_category: "Pressure washing",
    },
    updated_at: now,
  }).eq("id", allocation.id).eq("invoice_id", allocation.invoice_id);
  if (result.error) throw result.error;
}
for (const transaction of transactions) {
  const result = await db.from("transactions").update({
    category: "Pressure washing",
    metadata: {
      ...(transaction.metadata ?? {}),
      cost_classification: "pressure_washing",
      service_category: "Pressure washing",
    },
    updated_at: now,
  }).eq("id", transaction.id);
  if (result.error) throw result.error;
}
for (const invoice of invoices) {
  const result = await db.from("verification_events").upsert({
    id: stableUuid(`verification:curb-appeal-pressure-washing:${invoice.id}`),
    entity_type: "invoice",
    entity_id: invoice.id,
    action: "reclassified_as_pressure_washing",
    reason: "User confirmed Curb Appeal Pro Wash is pressure washing and must not contribute to painter labour.",
    old_values: { category: invoice.category },
    new_values: { category: "other", cost_classification: "pressure_washing" },
    evidence: { supplier: "Curb Appeal Pro Wash", invoice_number: invoice.invoice_number, user_confirmed: true },
    occurred_at: now,
  }, { onConflict: "id" });
  if (result.error) throw result.error;
}

const [verifyInvoices, verifyLines, verifyPayments, verifyTransactions] = await Promise.all([
  db.from("invoices").select("id,category,metadata").in("id", invoiceIds),
  db.from("invoice_lines").select("id,metadata").in("invoice_id", invoiceIds),
  db.from("transaction_allocations").select("id,allocation_type,metadata").in("invoice_id", invoiceIds),
  transactionIds.length ? db.from("transactions").select("id,category,metadata").in("id", transactionIds) : Promise.resolve({ data: [], error: null }),
]);
for (const result of [verifyInvoices, verifyLines, verifyPayments, verifyTransactions]) if (result.error) throw result.error;
if ((verifyInvoices.data ?? []).some((row) => row.category !== "other" || row.metadata?.cost_classification !== "pressure_washing")) throw new Error("Invoice verification failed.");
if ((verifyLines.data ?? []).some((row) => row.metadata?.entry_type !== "other" || row.metadata?.cost_classification !== "pressure_washing")) throw new Error("Invoice line verification failed.");
if ((verifyPayments.data ?? []).some((row) => row.allocation_type !== "pressure_washing_payment")) throw new Error("Payment allocation verification failed.");
if ((verifyTransactions.data ?? []).some((row) => row.category !== "Pressure washing")) throw new Error("Transaction category verification failed.");
console.log(JSON.stringify({
  status: "verified",
  invoices_reclassified: invoices.length,
  lines_reclassified: lines.length,
  job_allocations_preserved: jobAllocations.length,
  payment_allocations_reclassified: paymentAllocations.length,
  transactions_classified_pressure_washing: transactions.length,
  labour_subtotal_removed_cents: currentLabourSubtotalCents,
}, null, 2));
