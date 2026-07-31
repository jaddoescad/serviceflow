#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CONTRACTOR_NAME = "XDesign Dev Inc";
const DATE_WINDOW_DAYS = 45;
const MAX_SUBSET_SOLUTIONS = 1_000;

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

function cents(value) {
  return Math.round(Number(value) * 100);
}

function dollars(valueInCents) {
  return valueInCents / 100;
}

function invoiceGross(invoice) {
  return invoice.amount_paid == null
    ? Number(invoice.amount_before_tax ?? 0) + Number(invoice.tax_amount ?? 0)
    : Number(invoice.amount_paid);
}

function dayDifference(later, earlier) {
  return Math.round(
    (Date.parse(`${later}T12:00:00Z`) - Date.parse(`${earlier}T12:00:00Z`)) /
      86_400_000,
  );
}

function exactSubsets(candidates, targetCents) {
  const sorted = [...candidates].sort(
    (left, right) =>
      right.remaining_cents - left.remaining_cents ||
      left.invoice_date.localeCompare(right.invoice_date) ||
      left.id.localeCompare(right.id),
  );
  const solutions = [];
  let truncated = false;

  function search(index, remaining, selected) {
    if (solutions.length >= MAX_SUBSET_SOLUTIONS) {
      truncated = true;
      return;
    }
    if (remaining === 0) {
      solutions.push([...selected]);
      return;
    }
    if (remaining < 0 || index >= sorted.length) return;

    for (let current = index; current < sorted.length; current += 1) {
      const invoice = sorted[current];
      if (invoice.remaining_cents > remaining) continue;
      selected.push(invoice);
      search(current + 1, remaining - invoice.remaining_cents, selected);
      selected.pop();
      if (solutions.length >= MAX_SUBSET_SOLUTIONS) return;
    }
  }

  search(0, targetCents, []);
  return { solutions, truncated };
}

function scoreSolution(solution, paymentDate) {
  const dateGaps = solution.map((invoice) =>
    dayDifference(paymentDate, invoice.invoice_date),
  );
  return {
    total_days_before_payment: dateGaps.reduce(
      (total, value) => total + value,
      0,
    ),
    furthest_invoice_days_before_payment: Math.max(...dateGaps),
  };
}

function transactionFromRecord(record) {
  return Array.isArray(record.financial_transactions)
    ? record.financial_transactions[0]
    : record.financial_transactions;
}

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
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
  throw new Error(
    `Refusing reconciliation for unexpected project ${projectRef}.`,
  );
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const applyChanges = process.argv.includes("--apply");

const contractorResult = await db
  .from("labour_contractors")
  .select("id,supplier_name")
  .eq("supplier_name", CONTRACTOR_NAME)
  .single();
if (contractorResult.error) throw contractorResult.error;
const contractor = contractorResult.data;

const [
  invoiceResult,
  paymentRecordResult,
  verificationResult,
  allocationResult,
] = await Promise.all([
  db
    .from("labour_invoices")
    .select(
      "id,invoice_number,invoice_date,source_date,supplier_name,contractor_id,amount_before_tax,tax_amount,amount_paid,currency,document_type,original_filename",
    )
    .eq("contractor_id", contractor.id)
    .eq("document_type", "invoice")
    .order("invoice_date", { ascending: true }),
  db
    .from("labour_payment_records")
    .select(
      "financial_transaction_id,contractor_id,recipient_status,confirmation_method,financial_transactions(id,posted_on,transaction_on,description,counterparty,amount,currency,category,transaction_type,is_transfer)",
    )
    .eq("contractor_id", contractor.id)
    .eq("recipient_status", "confirmed"),
  db
    .from("labour_payment_verification")
    .select(
      "financial_transaction_id,payment_amount,total_allocated_amount,unallocated_amount,payment_status",
    )
    .eq("contractor_id", contractor.id),
  db
    .from("labour_payment_allocations")
    .select(
      "id,financial_transaction_id,invoice_id,allocated_amount,reversed_at",
    )
    .is("reversed_at", null),
]);

for (const [label, result] of Object.entries({
  invoices: invoiceResult,
  paymentRecords: paymentRecordResult,
  paymentVerification: verificationResult,
  allocations: allocationResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

const activeAllocations = allocationResult.data ?? [];
const allocatedByInvoice = new Map();
for (const allocation of activeAllocations) {
  allocatedByInvoice.set(
    allocation.invoice_id,
    (allocatedByInvoice.get(allocation.invoice_id) ?? 0) +
      cents(allocation.allocated_amount),
  );
}

const invoices = (invoiceResult.data ?? [])
  .map((invoice) => {
    const invoiceDate = invoice.invoice_date ?? invoice.source_date;
    const grossCents = cents(invoiceGross(invoice));
    return {
      ...invoice,
      invoice_date: invoiceDate,
      gross_cents: grossCents,
      remaining_cents: Math.max(
        0,
        grossCents - (allocatedByInvoice.get(invoice.id) ?? 0),
      ),
    };
  })
  .filter(
    (invoice) =>
      invoice.invoice_date &&
      invoice.currency === "CAD" &&
      invoice.remaining_cents > 0,
  );

const verificationByPayment = new Map(
  (verificationResult.data ?? []).map((verification) => [
    verification.financial_transaction_id,
    verification,
  ]),
);
const payments = (paymentRecordResult.data ?? [])
  .map((record) => {
    const transaction = transactionFromRecord(record);
    const verification = verificationByPayment.get(
      record.financial_transaction_id,
    );
    return transaction && verification
      ? {
          ...transaction,
          remaining_cents: cents(verification.unallocated_amount),
          payment_status: verification.payment_status,
        }
      : null;
  })
  .filter(
    (payment) =>
      payment &&
      payment.transaction_type === "expense" &&
      payment.is_transfer === false &&
      Number(payment.amount) < 0 &&
      payment.category === "Subcontractors" &&
      payment.currency === "CAD" &&
      payment.remaining_cents > 0,
  )
  .sort(
    (left, right) =>
      left.posted_on.localeCompare(right.posted_on) ||
      left.remaining_cents - right.remaining_cents ||
      left.id.localeCompare(right.id),
  );

const proposals = [];
const unmatched = [];

for (const payment of payments) {
  const candidates = invoices.filter((invoice) => {
    if (invoice.remaining_cents <= 0) return false;
    const daysBeforePayment = dayDifference(
      payment.posted_on,
      invoice.invoice_date,
    );
    return (
      daysBeforePayment >= 0 &&
      daysBeforePayment <= DATE_WINDOW_DAYS &&
      invoice.remaining_cents <= payment.remaining_cents
    );
  });
  const { solutions, truncated } = exactSubsets(
    candidates,
    payment.remaining_cents,
  );
  const rankedSolutions = solutions
    .map((solution) => ({
      invoices: solution,
      score: scoreSolution(solution, payment.posted_on),
    }))
    .sort(
      (left, right) =>
        left.score.total_days_before_payment -
          right.score.total_days_before_payment ||
        left.score.furthest_invoice_days_before_payment -
          right.score.furthest_invoice_days_before_payment,
    );
  const uniquelyClosest =
    rankedSolutions.length > 1 &&
    !truncated &&
    rankedSolutions[0].score.total_days_before_payment <
      rankedSolutions[1].score.total_days_before_payment;
  const selected =
    rankedSolutions.length === 1 || uniquelyClosest ? rankedSolutions[0] : null;

  if (!selected) {
    unmatched.push({
      payment_id: payment.id,
      payment_date: payment.posted_on,
      description: payment.description,
      amount: dollars(payment.remaining_cents),
      reason:
        solutions.length === 0
          ? "no_exact_invoice_total"
          : truncated
            ? "too_many_exact_invoice_totals"
            : "ambiguous_date_proximity",
      candidate_solution_count: solutions.length,
      candidate_solutions: rankedSolutions
        .slice(0, 3)
        .map(({ invoices: solution, score }) => ({
          score,
          invoices: solution.map((invoice) => ({
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            invoice_date: invoice.invoice_date,
            amount: dollars(invoice.remaining_cents),
          })),
        })),
    });
    continue;
  }

  const solution = selected.invoices;
  const proposal = {
    payment_id: payment.id,
    payment_date: payment.posted_on,
    description: payment.description,
    payment_amount: dollars(payment.remaining_cents),
    invoice_count: solution.length,
    selection_basis:
      rankedSolutions.length === 1
        ? "unique_exact_total"
        : "uniquely_closest_exact_total",
    date_proximity_score: selected.score,
    invoices: solution
      .sort(
        (left, right) =>
          left.invoice_date.localeCompare(right.invoice_date) ||
          left.id.localeCompare(right.id),
      )
      .map((invoice) => ({
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date,
        amount: dollars(invoice.remaining_cents),
        days_before_payment: dayDifference(
          payment.posted_on,
          invoice.invoice_date,
        ),
      })),
  };
  proposals.push(proposal);
  for (const invoice of solution) invoice.remaining_cents = 0;
}

const proposedRows = proposals.flatMap((proposal) =>
  proposal.invoices.map((invoice) => ({
    financial_transaction_id: proposal.payment_id,
    invoice_id: invoice.invoice_id,
    allocated_amount: invoice.amount,
    match_method: [
      "verified_contractor_identity",
      "exact_after_hst_amount_cents",
      "invoice_date_on_or_before_payment",
      proposal.invoice_count === 1
        ? `unique_invoice_total_${DATE_WINDOW_DAYS}_days`
        : proposal.selection_basis === "unique_exact_total"
          ? `unique_invoice_sum_${DATE_WINDOW_DAYS}_days`
          : `closest_invoice_sum_${DATE_WINDOW_DAYS}_days`,
    ],
    confirmed_at: new Date().toISOString(),
    notes:
      `${CONTRACTOR_NAME}: verified recipient; invoice #${invoice.invoice_number} dated ` +
      `${invoice.invoice_date}; $${invoice.amount.toFixed(2)} of exact ` +
      `$${proposal.payment_amount.toFixed(2)} bank payment ${proposal.description}.`,
  })),
);

if (applyChanges && proposedRows.length) {
  const insertResult = await db
    .from("labour_payment_allocations")
    .insert(proposedRows)
    .select(
      "id,financial_transaction_id,invoice_id,allocated_amount,match_method,confirmed_at",
    );
  if (insertResult.error) throw insertResult.error;
  if ((insertResult.data ?? []).length !== proposedRows.length) {
    throw new Error("Not every proposed XDesign allocation was inserted.");
  }
}

const postApplyVerification = applyChanges
  ? await db
      .from("labour_payment_verification")
      .select(
        "financial_transaction_id,payment_amount,invoice_allocated_amount,total_allocated_amount,unallocated_amount,payment_status",
      )
      .in(
        "financial_transaction_id",
        proposals.map((proposal) => proposal.payment_id),
      )
  : { data: [], error: null };
if (postApplyVerification.error) throw postApplyVerification.error;

if (
  applyChanges &&
  (postApplyVerification.data ?? []).some(
    (payment) =>
      cents(payment.unallocated_amount) !== 0 ||
      payment.payment_status !== "fully_allocated",
  )
) {
  throw new Error("Post-apply XDesign payment verification failed.");
}

console.log(
  JSON.stringify(
    {
      mode: applyChanges ? "applied" : "read-only",
      project_ref: projectRef,
      contractor,
      date_window_days: DATE_WINDOW_DAYS,
      open_invoice_count: invoices.filter(
        (invoice) => invoice.remaining_cents > 0,
      ).length,
      open_payment_count: payments.length,
      matched_payment_count: proposals.length,
      allocation_row_count: proposedRows.length,
      total_allocated_amount: dollars(
        proposedRows.reduce(
          (total, allocation) => total + cents(allocation.allocated_amount),
          0,
        ),
      ),
      proposals,
      unmatched,
      post_apply_verification: postApplyVerification.data ?? [],
    },
    null,
    2,
  ),
);
