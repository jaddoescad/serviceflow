#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const CAPTURED_AT = "2026-08-06T23:58:00.000Z";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

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
    ) value = value.slice(1, -1);
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

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) {
  throw new Error("Refusing audit for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [transactionsResult, invoicesResult] = await Promise.all([
  db
    .from("transactions")
    .select("id,posted_on,description,amount_cents,counterparty,category,review_status,notes,metadata,updated_at")
    .eq("posted_on", "2026-08-06")
    .lt("amount_cents", 0)
    .order("running_balance_cents", { ascending: true }),
  db
    .from("invoices")
    .select("id,invoice_number,direction,category,source_system,external_id,status,issued_on,subtotal_cents,tax_cents,total_cents,paid_cents,balance_cents,metadata,contact:contacts(id,name,email),job_allocations:invoice_job_allocations(id,job:jobs(id,name,status)),payment_allocations:transaction_allocations!transaction_allocations_invoice_id_fkey(id,transaction_id,amount_cents,allocation_type,reversed_at)")
    .eq("direction", "payable"),
]);
if (transactionsResult.error) throw transactionsResult.error;
if (invoicesResult.error) throw invoicesResult.error;

const transfers = (transactionsResult.data ?? []).filter((row) => row.description.startsWith("SEND E-TFR ***"));
const invoices = invoicesResult.data ?? [];
const activePaymentTotal = (invoice) => (invoice.payment_allocations ?? [])
  .filter((allocation) => !allocation.reversed_at)
  .reduce((sum, allocation) => sum + Number(allocation.amount_cents), 0);
const settlementRemaining = (invoice) => Math.max(0, Number(invoice.total_cents) - activePaymentTotal(invoice));
const recipientAliases = new Map([
  ["grutenco", ["grutenco"]],
  ["curb appeal softwash", ["curb appeal pro wash", "curb appeal"]],
  ["michael matambo", ["xdesign dev inc", "xdesign"]],
  ["bilal akkacha", ["bilal akkacha"]],
  ["darlene", ["dressing rooms"]],
]);
const results = transfers.map((transaction) => {
  const recipient = String(transaction.metadata?.recipient ?? transaction.counterparty ?? "");
  const recipientDestination = String(transaction.metadata?.recipient_destination ?? "");
  const recipientTokens = `${recipient} ${recipientDestination}`.toLocaleLowerCase("en-CA");
  const amount = Math.abs(Number(transaction.amount_cents));
  const amountCandidates = invoices.filter((invoice) => settlementRemaining(invoice) === amount);
  const nameCandidates = invoices.filter((invoice) => {
    const searchable = [
      invoice.contact?.name,
      invoice.contact?.email,
      invoice.metadata?.supplier_name,
      invoice.metadata?.worker_name,
      ...(invoice.job_allocations ?? []).map((allocation) => allocation.job?.name),
    ].filter(Boolean).join(" ").toLocaleLowerCase("en-CA");
    const aliases = recipientAliases.get(recipient.toLocaleLowerCase("en-CA")) ?? [];
    const words = recipientTokens.split(/[^a-z0-9@.]+/).filter((word) => word.length >= 4);
    return aliases.some((alias) => searchable.includes(alias)) ||
      words.some((word) => searchable.includes(word));
  });
  const exactCandidates = nameCandidates.filter((invoice) => settlementRemaining(invoice) === amount);
  return {
    transaction,
    amount_candidates: amountCandidates,
    name_candidates: nameCandidates,
    exact_candidates: exactCandidates,
  };
});

function summarizeInvoice(invoice) {
  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    issued_on: invoice.issued_on,
    category: invoice.category,
    source_system: invoice.source_system,
    status: invoice.status,
    contact: invoice.contact?.name ?? null,
    total_cents: Number(invoice.total_cents),
    active_payment_cents: activePaymentTotal(invoice),
    settlement_remaining_cents: settlementRemaining(invoice),
    jobs: [...new Set((invoice.job_allocations ?? []).map((allocation) => allocation.job?.name).filter(Boolean))],
  };
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run-audit",
  transfers: results.map((result) => ({
    transaction: result.transaction,
    amount_candidates: result.amount_candidates.map(summarizeInvoice),
    unsettled_name_candidates: result.name_candidates
      .filter((invoice) => settlementRemaining(invoice) > 0)
      .map(summarizeInvoice),
    exact_candidates: result.exact_candidates.map(summarizeInvoice),
  })),
}, null, 2));
if (!APPLY) process.exit(0);

for (const result of results) {
  const transaction = result.transaction;
  const recipient = transaction.metadata?.recipient;
  if (!recipient) throw new Error(`${transaction.description}: recipient evidence is missing.`);
  const sourceStatus = transaction.metadata?.status;
  const exactCandidateSummaries = result.exact_candidates.map(summarizeInvoice);
  const categoryByRecipient = new Map([
    ["grutenco", "Subcontractors"],
    ["curb appeal softwash", "Pressure washing"],
    ["michael matambo", "Subcontractors"],
    ["darlene", "Colour consultation"],
  ]);
  const verifiedCategory = categoryByRecipient.get(recipient.toLocaleLowerCase("en-CA")) ?? transaction.category;
  const notes = sourceStatus === "Sent" && exactCandidateSummaries.length === 1
    ? `Exact payable invoice ${exactCandidateSummaries[0].invoice_number} identified, but the transfer was still cancellable when observed; settlement allocation is deferred.`
    : sourceStatus === "Sent"
      ? "Recipient verified in EasyWeb. Transfer was still cancellable when observed; no exact payable invoice settlement is present in the database."
    : sourceStatus === "Request deposited"
      ? "Recipient and deposited request verified in EasyWeb. Business purpose and accounting classification require review."
      : "Recipient and completed transfer verified in EasyWeb; payable invoice and job allocation are not present in the database.";
  const transactionWrite = await db
    .from("transactions")
    .update({
      counterparty: recipient,
      category: verifiedCategory,
      notes,
      review_status: "needs_review",
      metadata: {
        ...(transaction.metadata ?? {}),
        recipient_verification: {
          source: "TD EasyWeb transfer detail",
          verified_on: "2026-08-06",
          recipient,
          recipient_destination: transaction.metadata?.recipient_destination ?? null,
          source_status: sourceStatus,
          confirmation_masked: transaction.metadata?.confirmation_masked ?? null,
          invoice_match_status: result.exact_candidates.length === 0
            ? "no_exact_payable_invoice"
            : "exact_candidate_requires_review",
          exact_invoice_candidates: exactCandidateSummaries,
          settlement_blocker: sourceStatus === "Sent" ? "transfer_still_cancellable" : null,
        },
      },
      updated_at: CAPTURED_AT,
    })
    .eq("id", transaction.id)
    .eq("updated_at", transaction.updated_at)
    .select("id")
    .maybeSingle();
  if (transactionWrite.error) throw transactionWrite.error;
  if (!transactionWrite.data) throw new Error(`${transaction.description}: concurrent transaction update.`);

  const eventWrite = await db.from("verification_events").upsert({
    id: stableUuid(`verification:august6-recipient:${transaction.id}`),
    entity_type: "transaction",
    entity_id: transaction.id,
    action: "recipient_verified_invoice_pending",
    reason: notes,
    old_values: {
      counterparty: transaction.counterparty,
      notes: transaction.notes,
      review_status: transaction.review_status,
    },
    new_values: {
      counterparty: recipient,
      category: verifiedCategory,
      notes,
      review_status: "needs_review",
      exact_payable_invoice_candidates: result.exact_candidates.length,
    },
    evidence: {
      posted_on: transaction.posted_on,
      amount_cents: transaction.amount_cents,
      source_status: sourceStatus,
      recipient,
      recipient_destination: transaction.metadata?.recipient_destination ?? null,
      confirmation_masked: transaction.metadata?.confirmation_masked ?? null,
      no_email_used: true,
    },
    occurred_at: CAPTURED_AT,
  }, { onConflict: "id" });
  if (eventWrite.error) throw eventWrite.error;
}

const verificationResult = await db
  .from("transactions")
  .select("id,description,counterparty,review_status,notes,metadata")
  .in("id", transfers.map((transaction) => transaction.id));
if (verificationResult.error) throw verificationResult.error;
if ((verificationResult.data ?? []).some((row) => !row.counterparty || row.review_status !== "needs_review")) {
  throw new Error("Post-write recipient verification failed.");
}
console.log(JSON.stringify({ status: "verified", transactions: verificationResult.data }, null, 2));
