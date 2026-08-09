#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const checkpointedAt = new Date().toISOString();
function envFile(file) { if (!existsSync(file)) return {}; return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("=")).map((line) => { const i = line.indexOf("="); let value = line.slice(i + 1).trim(); if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1); return [line.slice(0, i).trim(), value]; })); }
function assert(condition, message) { if (!condition) throw new Error(message); }
const env = { ...envFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")), ...envFile(path.join(repoRoot, ".env.local")), ...process.env };
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL; if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const INVOICE_REQUIREMENTS = new Map([
  ["23d371cb-57ae-5b74-9c43-5e881a4f8a7b", { kind: "missing_bank_transaction", unresolved_cents: 76671, required_evidence: "A specific bank deposit or processor payout component for the second $766.71 payment." }],
  ["35eac182-e255-5b13-a7bf-67189ceca7aa", { kind: "missing_bank_transaction", unresolved_cents: 35000, required_evidence: "A specific bank deposit, cash confirmation, or processor payout component for the $350 payment." }],
  ["4cec1db0-2364-5859-882f-d0f854771865", { kind: "needs_job_identity", unresolved_cents: 315000, required_evidence: "Proposal/customer identity distinguishing Youssef invoice 1 at 3791 Canyon between the two stored Kim Switzer proposals." }],
  ["3ed4098a-4ae1-5564-b634-1e5550b8c623", { kind: "needs_job_identity", unresolved_cents: 315000, required_evidence: "Proposal/customer identity distinguishing Youssef invoice 2 at 3791 Canyon between the two stored Kim Switzer proposals." }],
  ["4b60e2bc-6b96-56ee-b60a-391d5111c736", { kind: "needs_job_identity", unresolved_cents: 315000, required_evidence: "A stored proposal/customer identity for the printed 3789 Canyon address." }],
  ["dc3bf16c-43da-54ff-96e9-1ed478318375", { kind: "needs_job_identity", unresolved_cents: 315000, required_evidence: "A stored proposal/customer identity for the printed 1065 Beryl Private address." }],
  ["4235e61f-7489-5a47-9cc5-b0ca54f0d31f", { kind: "needs_job_identity", unresolved_cents: 60000, required_evidence: "Customer, address, or proposal identity for Michael Prudhomme's two dated labour entries." }],
  ["893d8d51-c5e0-5874-adde-0ccc98971ea2", { kind: "needs_job_or_overhead_decision", unresolved_cents: 18000, required_evidence: "The customer job, or confirmation that 'Reza worked with Scott' is non-job business overhead." }],
  ["b7a2b25c-b265-54ab-b8b0-efbbfc07eae7", { kind: "needs_job_or_overhead_decision", unresolved_cents: 15000, required_evidence: "The customer job for the light-fixture reinstall, or confirmation it is company repairs overhead." }],
  ["ba154e98-1bdb-5ff4-98ef-9f992980f59e", { kind: "needs_explicit_job_split", unresolved_cents: 215000, required_evidence: "Printed or user-confirmed split between the two Elizabeth McCrea proposals at the same address/date." }],
  ["8d8dec64-ce3b-5d46-ad5d-412c59159631", { kind: "needs_explicit_job_split", unresolved_cents: 30000, required_evidence: "Printed or user-confirmed dollar split for XDesign invoice 8601; current proportional split remains reviewable." }],
  ["dd67aa20-16a9-5cac-a89f-0add33ae3c81", { kind: "needs_explicit_job_split", unresolved_cents: 27000, required_evidence: "Printed or user-confirmed dollar split for XDesign invoice 8597; current proportional split remains reviewable." }],
  ["927b382e-f997-505c-9d4d-979e941a48bb", { kind: "needs_job_identity_for_residual", unresolved_cents: 5437, required_evidence: "Job identity for the February 20 no-location labour entry; the one-cent adjustment remains part of the source total." }],
  ["b1437274-bc6f-596b-a6f6-793b0aba181d", { kind: "needs_explicit_job_split", unresolved_cents: 148700, required_evidence: "Printed or user-confirmed split of Phillip Hyde's $1,487 Roxanne work between the two Roxanne Dore proposals." }],
  ["df66fa15-698a-5013-8816-54c8ea3bfb48", { kind: "needs_job_identity", unresolved_cents: 9000, required_evidence: "Full customer identity for Dressing Rooms' 'Kristy — short phone consultation' entry." }],
  ["e35350db-e9dd-5afb-8da7-4836509dfe01", { kind: "needs_explicit_job_split", unresolved_cents: 8848, required_evidence: "Printed or user-confirmed dollar split for the shared Tess/Liz/Sue/Andrea site-visit entry." }],
]);

const [transactionsResult, invoicesResult] = await Promise.all([
  db.from("transactions").select("id,posted_on,description,counterparty,amount_cents,category,review_status,metadata,allocations:transaction_allocations(id,reversed_at)").eq("review_status", "needs_review").gte("posted_on", "2026-01-01").lte("posted_on", "2026-12-31"),
  db.from("invoices").select("id,invoice_number,issued_on,category,status,subtotal_cents,total_cents,paid_cents,balance_cents,metadata,contact:contacts(name)").in("id", [...INVOICE_REQUIREMENTS.keys()]),
]);
if (transactionsResult.error) throw transactionsResult.error;
if (invoicesResult.error) throw invoicesResult.error;
const transactions = transactionsResult.data;
const invoices = invoicesResult.data;
assert(transactions.length === 37, `Expected 37 unresolved transactions, found ${transactions.length}.`);
assert(invoices.length === INVOICE_REQUIREMENTS.size, `Expected ${INVOICE_REQUIREMENTS.size} unresolved invoices, found ${invoices.length}.`);

function transactionRequirement(transaction) {
  const activeCount = transaction.allocations.filter((row) => !row.reversed_at).length;
  if (transaction.category === "Paint & materials") return {
    kind: "needs_supplier_receipt_or_statement",
    required_evidence: "A targeted supplier receipt/invoice or account statement that uniquely explains this bank charge and provides any job/PO identity.",
    evidence_checked: "Current v2 material invoices and stored source documents; no unique unpaid gross match exists.",
  };
  if (transaction.id === "05a4b711-6212-4b34-af49-247705dead82") return {
    kind: "needs_processor_batch_composition",
    required_evidence: "The processor batch detail identifying the customer charges inside the $1,105 deposit.",
    evidence_checked: "Bank payout identity is confirmed; customer composition is not stored.",
  };
  if (transaction.id === "2abdb9d0-be90-48b0-8288-9619ea20d667") return {
    kind: "needs_transfer_purpose_or_invoice",
    required_evidence: "A purpose, invoice, or explicit no-invoice business classification for the $100 SM Alba/Caledonian transfer.",
    evidence_checked: "Recipient is confirmed and the stored historical invoice inventory contains no matching invoice or purpose.",
  };
  if (transaction.id === "3c81eb37-0bf5-52ec-9146-66ebe5b54084") return {
    kind: "needs_business_purpose",
    required_evidence: "Business purpose/classification for the $500 transfer to Jad Slim's Shakepay funding address.",
    evidence_checked: "Recipient and settlement are confirmed; no payable invoice matches.",
  };
  if (["Training & education", "Office supplies", "Meals & entertainment"].includes(transaction.category)) return {
    kind: "needs_business_purpose_and_tax_document",
    required_evidence: "Business purpose confirmation; supplier receipt is also required before claiming any HST input tax credit.",
    evidence_checked: "Bank merchant/date/amount only.",
  };
  throw new Error(`No checkpoint rule for unresolved transaction ${transaction.id} (${transaction.category}, active allocations ${activeCount}).`);
}

const transactionPlans = transactions.map((transaction) => ({ transaction, requirement: transactionRequirement(transaction) }));
const invoicePlans = invoices.map((invoice) => {
  const requirement = INVOICE_REQUIREMENTS.get(invoice.id);
  assert(requirement, `Unexpected unresolved invoice ${invoice.id}.`);
  return { invoice, requirement };
});

const preview = {
  mode: APPLY ? "apply" : "dry-run",
  no_email_used: true,
  historical_email_baseline: "complete",
  transaction_count: transactionPlans.length,
  invoice_count: invoicePlans.length,
  transaction_kinds: Object.entries(Object.groupBy(transactionPlans, (row) => row.requirement.kind)).map(([kind, rows]) => ({ kind, count: rows.length, absolute_cents: rows.reduce((sum, row) => sum + Math.abs(Number(row.transaction.amount_cents)), 0) })),
  invoice_kinds: Object.entries(Object.groupBy(invoicePlans, (row) => row.requirement.kind)).map(([kind, rows]) => ({ kind, count: rows.length, unresolved_cents: rows.reduce((sum, row) => sum + row.requirement.unresolved_cents, 0) })),
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) process.exit(0);

for (const { transaction, requirement } of transactionPlans) {
  const update = await db.from("transactions").update({
    metadata: {
      ...(transaction.metadata ?? {}),
      reconciliation_checkpoint: {
        status: "needs_targeted_evidence",
        issue_kind: requirement.kind,
        required_evidence: requirement.required_evidence,
        evidence_checked: requirement.evidence_checked,
        historical_email_baseline: "complete",
        no_broad_email_rescan: true,
        next_search_scope: "targeted_item_only",
        checkpointed_at: checkpointedAt,
      },
    },
    updated_at: checkpointedAt,
  }).eq("id", transaction.id).eq("review_status", "needs_review");
  if (update.error) throw update.error;
}
for (const { invoice, requirement } of invoicePlans) {
  const update = await db.from("invoices").update({
    metadata: {
      ...(invoice.metadata ?? {}),
      reconciliation_checkpoint: {
        status: "needs_targeted_evidence",
        issue_kind: requirement.kind,
        unresolved_cents: requirement.unresolved_cents,
        required_evidence: requirement.required_evidence,
        historical_email_baseline: "complete",
        no_broad_email_rescan: true,
        next_search_scope: "targeted_item_only",
        checkpointed_at: checkpointedAt,
      },
    },
    updated_at: checkpointedAt,
  }).eq("id", invoice.id);
  if (update.error) throw update.error;
}

const [verifiedTransactions, verifiedInvoices] = await Promise.all([
  db.from("transactions").select("id,review_status,metadata").in("id", transactions.map((row) => row.id)),
  db.from("invoices").select("id,metadata").in("id", invoices.map((row) => row.id)),
]);
if (verifiedTransactions.error) throw verifiedTransactions.error;
if (verifiedInvoices.error) throw verifiedInvoices.error;
assert(verifiedTransactions.data.length === transactionPlans.length && verifiedTransactions.data.every((row) => row.review_status === "needs_review" && row.metadata?.reconciliation_checkpoint?.no_broad_email_rescan === true), "Transaction checkpoint verification failed.");
assert(verifiedInvoices.data.length === invoicePlans.length && verifiedInvoices.data.every((row) => row.metadata?.reconciliation_checkpoint?.no_broad_email_rescan === true), "Invoice checkpoint verification failed.");
console.log(JSON.stringify({ applied: true, no_email_used: true, historical_email_baseline: "complete", transaction_count: transactionPlans.length, invoice_count: invoicePlans.length }, null, 2));
