#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const DOCUMENTED_RESEARCH_STATUSES = new Set([
  "no_invoice_provided",
  "invoice_not_found",
  "partial_invoice_allocation_with_no_invoice_residual",
]);

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

function sourceObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function money(value) {
  return Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let page = 0; page < 100; page += 1) {
    const from = page * pageSize;
    const result = await queryFactory().range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Audit pagination exceeded 100,000 rows.");
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl =
  env.SUPABASE_URL ??
  env.NEXT_PUBLIC_SUPABASE_URL ??
  env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== TARGET_PROJECT_REF) {
  throw new Error(`Refusing audit for unexpected project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const [transactions, verifications] = await Promise.all([
  fetchAll(() =>
    db
      .from("financial_transactions")
      .select(
        "id,posted_on,description,counterparty,amount,transaction_type,category,is_transfer,review_status,source_data",
      )
      .eq("category", "Subcontractors"),
  ),
  fetchAll(() =>
    db
      .from("labour_payment_verification")
      .select(
        "financial_transaction_id,recipient_status,invoice_allocated_amount,bonus_allocated_amount,other_allocated_amount,total_allocated_amount,unallocated_amount,payment_status",
      ),
  ),
]);
const verificationByTransaction = new Map(
  verifications.map((verification) => [
    verification.financial_transaction_id,
    verification,
  ]),
);

const audited = transactions.map((transaction) => {
  const sourceData = sourceObject(transaction.source_data);
  const cancellation = sourceObject(sourceData.cancelled_e_transfer);
  const overpayment = sourceObject(sourceData.confirmed_overpayment);
  const research = sourceObject(sourceData.reconciliation_research);
  const verification = verificationByTransaction.get(transaction.id);
  const unallocatedAmount = money(
    verification?.unallocated_amount ?? Math.abs(transaction.amount),
  );
  const totalAllocatedAmount = money(
    verification?.total_allocated_amount ?? 0,
  );
  const evidence = {
    invoice: Number(verification?.invoice_allocated_amount ?? 0) > 0,
    bonus: Number(verification?.bonus_allocated_amount ?? 0) > 0,
    other: Number(verification?.other_allocated_amount ?? 0) > 0,
    overpayment: overpayment.status === "confirmed",
    invoice_exception: DOCUMENTED_RESEARCH_STATUSES.has(research.status),
    cancelled: cancellation.status === "cancelled",
    internal_transfer: transaction.is_transfer === true,
  };
  const hasAllocation =
    evidence.invoice || evidence.bonus || evidence.other;
  const allocationCoversPayment =
    hasAllocation &&
    unallocatedAmount <= 0.005 &&
    totalAllocatedAmount > 0;
  const residualHasException =
    evidence.overpayment || evidence.invoice_exception;
  const hasEvidenceOrException =
    evidence.cancelled ||
    evidence.internal_transfer ||
    allocationCoversPayment ||
    residualHasException;
  const mustBeNeedsReview = !hasEvidenceOrException;
  return {
    id: transaction.id,
    posted_on: transaction.posted_on,
    counterparty: transaction.counterparty,
    description: transaction.description,
    amount: money(Math.abs(transaction.amount)),
    transaction_type: transaction.transaction_type,
    review_status: transaction.review_status,
    payment_status: verification?.payment_status ?? "missing",
    recipient_status: verification?.recipient_status ?? "missing",
    invoice_allocated_amount: money(
      verification?.invoice_allocated_amount ?? 0,
    ),
    bonus_allocated_amount: money(verification?.bonus_allocated_amount ?? 0),
    other_allocated_amount: money(verification?.other_allocated_amount ?? 0),
    total_allocated_amount: totalAllocatedAmount,
    unallocated_amount: unallocatedAmount,
    research_status:
      typeof research.status === "string" ? research.status : null,
    evidence,
    allocation_covers_payment: allocationCoversPayment,
    residual_has_exception: residualHasException,
    must_be_needs_review: mustBeNeedsReview,
    rule_violation:
      mustBeNeedsReview && transaction.review_status !== "needs_review",
  };
});

const violations = audited.filter((transaction) => transaction.rule_violation);
const needsReviewWithoutEvidence = audited.filter(
  (transaction) =>
    transaction.must_be_needs_review &&
    transaction.review_status === "needs_review",
);
const counts = {
  subcontractor_transactions: audited.length,
  linked_to_invoice: audited.filter((transaction) => transaction.evidence.invoice)
    .length,
  linked_to_bonus: audited.filter((transaction) => transaction.evidence.bonus)
    .length,
  linked_to_other_settlement: audited.filter(
    (transaction) => transaction.evidence.other,
  ).length,
  documented_overpayment: audited.filter(
    (transaction) => transaction.evidence.overpayment,
  ).length,
  documented_invoice_exception: audited.filter(
    (transaction) => transaction.evidence.invoice_exception,
  ).length,
  cancelled: audited.filter((transaction) => transaction.evidence.cancelled)
    .length,
  internal_transfer: audited.filter(
    (transaction) => transaction.evidence.internal_transfer,
  ).length,
  needs_review_without_evidence: needsReviewWithoutEvidence.length,
  rule_violations: violations.length,
};

console.log(
  JSON.stringify(
    {
      project_ref: projectRef,
      audited_at: new Date().toISOString(),
      rule:
        "Every Subcontractors transaction must be fully covered by invoice/bonus/other allocations, have a documented exception for any residual, be a cancelled/internal transfer, or have review_status needs_review.",
      counts,
      violations,
      needs_review_without_evidence: needsReviewWithoutEvidence,
    },
    null,
    2,
  ),
);

if (violations.length > 0) process.exitCode = 1;
