#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const now = new Date().toISOString();

function envFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      let value = line.slice(i + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      return [line.slice(0, i).trim(), value];
    }));
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

const { data: transactions, error } = await db.from("transactions")
  .select("id,posted_on,description,counterparty,amount_cents,category,review_status,notes,metadata,allocations:transaction_allocations(*)")
  .gte("posted_on", "2026-01-01")
  .lte("posted_on", "2026-12-31")
  .eq("review_status", "needs_review");
if (error) throw error;

function activeAllocations(transaction) {
  return (transaction.allocations ?? []).filter((row) => !row.reversed_at);
}

function allocatedCents(transaction) {
  return activeAllocations(transaction).reduce((sum, row) => sum + Number(row.amount_cents), 0);
}

function materialCandidate(transaction) {
  const active = activeAllocations(transaction);
  return transaction.category === "Paint & materials" && active.length > 0 &&
    active.every((row) => !row.needs_review && row.invoice_id) &&
    allocatedCents(transaction) === Math.abs(Number(transaction.amount_cents));
}

function noInvoiceExpenseCandidate(transaction) {
  const active = activeAllocations(transaction);
  const explicit = [
    "no_invoice_provided",
    "invoice_not_found",
    "partial_invoice_allocation_with_no_invoice_residual",
  ].includes(transaction.metadata?.reconciliation_research?.status);
  return ["Subcontractors", "Sales commissions"].includes(transaction.category) && explicit &&
    active.length > 0 && active.every((row) => !row.needs_review) &&
    allocatedCents(transaction) === Math.abs(Number(transaction.amount_cents));
}

function confirmedOverpaymentCandidate(transaction) {
  return transaction.category === "Subcontractors" &&
    transaction.metadata?.confirmed_overpayment?.status === "confirmed" &&
    activeAllocations(transaction).length === 0;
}

function confirmedPartialNoInvoiceCandidate(transaction) {
  const research = transaction.metadata?.reconciliation_research ?? {};
  const residual = Math.abs(Number(transaction.amount_cents)) - allocatedCents(transaction);
  return transaction.category === "Subcontractors" &&
    research.status === "partial_invoice_allocation_with_no_invoice_residual" &&
    research.user_confirmed === true &&
    residual > 0 && residual === Math.round(Number(research.no_invoice_amount) * 100) &&
    activeAllocations(transaction).every((row) => !row.needs_review);
}

const candidates = transactions.filter((transaction) =>
  materialCandidate(transaction) || noInvoiceExpenseCandidate(transaction) || confirmedOverpaymentCandidate(transaction) || confirmedPartialNoInvoiceCandidate(transaction)
);

const preview = candidates.map((transaction) => ({
  id: transaction.id,
  posted_on: transaction.posted_on,
  counterparty: transaction.counterparty,
  amount_cents: transaction.amount_cents,
  category: transaction.category,
  allocation_count: activeAllocations(transaction).length,
  allocated_cents: allocatedCents(transaction),
  basis: materialCandidate(transaction) ? "exact_invoice_allocations" :
    confirmedOverpaymentCandidate(transaction) ? "confirmed_supplier_overpayment" :
    confirmedPartialNoInvoiceCandidate(transaction) ? "partial_invoice_plus_confirmed_no_invoice_residual" : "explicit_no_invoice_expense_allocation",
}));

if (!APPLY) {
  console.log(JSON.stringify({ mode: "dry-run", count: preview.length, transactions: preview }, null, 2));
  process.exit(0);
}

for (const transaction of candidates) {
  const basis = materialCandidate(transaction) ? "exact_invoice_allocations" :
    confirmedOverpaymentCandidate(transaction) ? "confirmed_supplier_overpayment" :
    confirmedPartialNoInvoiceCandidate(transaction) ? "partial_invoice_plus_confirmed_no_invoice_residual" : "explicit_no_invoice_expense_allocation";
  const update = await db.from("transactions").update({
    review_status: "reconciled",
    metadata: {
      ...(transaction.metadata ?? {}),
      review_status_repair: {
        status: "reconciled",
        basis,
        allocation_count: activeAllocations(transaction).length,
        allocated_cents: allocatedCents(transaction),
        repaired_at: now,
        source: "v2_unified_model_audit",
      },
    },
    updated_at: now,
  }).eq("id", transaction.id).eq("review_status", "needs_review");
  if (update.error) throw update.error;
}

const { data: verified, error: verifyError } = await db.from("transactions").select("id,review_status").in("id", candidates.map((row) => row.id));
if (verifyError) throw verifyError;
if (verified.length !== candidates.length || verified.some((row) => row.review_status !== "reconciled")) {
  throw new Error("Post-write review-status verification failed.");
}

console.log(JSON.stringify({ mode: "applied", count: preview.length, transactions: preview }, null, 2));
