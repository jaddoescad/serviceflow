#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const PERIOD_START = "2026-08-01";
const PERIOD_END = "2026-08-31";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

function one(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function active(rows) {
  return (rows ?? []).filter((row) => !row.reversed_at);
}

function cents(value) {
  return Math.round(Number(value ?? 0));
}

function dollarsToCents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + cents(row[field]), 0);
}

function inAugust(value) {
  const date = String(value ?? "").slice(0, 10);
  return date >= PERIOD_START && date <= PERIOD_END;
}

function paymentMethod(allocation) {
  return String(
    allocation.metadata?.payment_method ??
      allocation.metadata?.method ??
      allocation.metadata?.source_payload?.method ??
      "",
  ).trim() || null;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) {
  throw new Error("Unexpected Supabase project.");
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [jobsResult, invoicesResult] = await Promise.all([
  db.from("jobs").select(
    "id,name,status,contract_amount_cents,production_month,started_on,completed_on,archived_at,metadata",
  ),
  db.from("invoices").select(
    "id,invoice_number,direction,category,status,subtotal_cents,tax_cents,total_cents,paid_cents,balance_cents,metadata,job_allocations:invoice_job_allocations(id,invoice_line_id,job_id,subtotal_cents,tax_cents,total_cents,needs_review,metadata),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,transaction_id,invoice_id,job_id,allocation_type,amount_cents,needs_review,reversed_at,metadata,transaction:transactions(id,posted_on,amount_cents,category,is_transfer,review_status,account:accounts(slug,name,account_type,last_four)))",
  ),
]);

for (const [label, result] of [
  ["jobs", jobsResult],
  ["invoices", invoicesResult],
]) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

const jobs = jobsResult.data ?? [];
const invoices = invoicesResult.data ?? [];
const nonCostingStatuses = new Set(["not_invoice", "overhead_unmatched", "supporting_document"]);
const invoicesByJob = new Map();
for (const invoice of invoices) {
  if (nonCostingStatuses.has(invoice.status)) continue;
  const activeJobAllocations = (invoice.job_allocations ?? []).filter(
    (allocation) => !allocation.metadata?.reversed_at,
  );
  const linePairs = new Set(
    activeJobAllocations
      .filter((allocation) => allocation.invoice_line_id)
      .map((allocation) => `${allocation.invoice_id ?? invoice.id}\0${allocation.job_id}`),
  );
  const usableAllocations = activeJobAllocations.filter(
    (allocation) =>
      allocation.invoice_line_id ||
      !linePairs.has(`${allocation.invoice_id ?? invoice.id}\0${allocation.job_id}`),
  );
  const allocationByJob = new Map();
  for (const allocation of usableAllocations) {
    const current = allocationByJob.get(allocation.job_id) ?? {
      subtotal_cents: 0,
      tax_cents: 0,
      total_cents: 0,
      needs_review: false,
    };
    current.subtotal_cents += cents(allocation.subtotal_cents);
    current.tax_cents += cents(allocation.tax_cents);
    current.total_cents += cents(allocation.total_cents);
    current.needs_review ||= allocation.needs_review === true;
    allocationByJob.set(allocation.job_id, current);
  }
  for (const [jobId, jobAllocation] of allocationByJob) {
    const rows = invoicesByJob.get(jobId) ?? [];
    rows.push({ invoice, jobAllocation });
    invoicesByJob.set(jobId, rows);
  }
}

const augustJobs = jobs.filter((job) =>
  String(job.production_month ?? "").slice(0, 10) === PERIOD_START ||
  inAugust(job.completed_on) ||
  inAugust(job.metadata?.dripjobs_operational_authority?.job_completion_date) ||
  (
    String(job.metadata?.dripjobs_operational_authority?.normalized_production_stage ?? "") &&
    inAugust(job.metadata?.dripjobs_operational_authority?.deal_stage_date)
  ),
);

const rows = augustJobs.map((job) => {
  const authority = job.metadata?.job_amount_authority ?? {};
  const operational = job.metadata?.dripjobs_operational_authority ?? {};
  const proposalId = String(
    authority.proposal_id ?? operational.proposal_id ?? job.metadata?.dripjobs_job_number ?? "",
  );
  const related = invoicesByJob.get(job.id) ?? [];
  const customerInvoices = related.filter(({ invoice }) =>
    invoice.direction === "receivable" && invoice.category === "customer",
  );
  const supplierInvoices = related.filter(({ invoice }) => invoice.direction === "payable");
  const customerPayments = customerInvoices.flatMap(({ invoice }) =>
    active(invoice.payments).map((payment) => ({ ...payment, invoice })),
  );
  const bankPayments = customerPayments.filter((payment) => payment.transaction_id);
  const sourceOnlyPayments = customerPayments.filter((payment) => !payment.transaction_id);
  const cashPayments = customerPayments.filter((payment) => {
    const account = one(payment.transaction)?.account;
    return one(account)?.account_type === "cash" || /^cash$/i.test(paymentMethod(payment) ?? "");
  });
  const creditCardPayments = sourceOnlyPayments.filter((payment) =>
    /credit\s*card/i.test(paymentMethod(payment) ?? ""),
  );
  const unknownSourcePayments = sourceOnlyPayments.filter((payment) =>
    !/^cash$/i.test(paymentMethod(payment) ?? "") &&
    !/credit\s*card/i.test(paymentMethod(payment) ?? ""),
  );
  const augustSupplierPayments = supplierInvoices.flatMap(({ invoice, jobAllocation }) =>
    active(invoice.payments)
      .filter((payment) => payment.transaction_id && inAugust(one(payment.transaction)?.posted_on))
      .map((payment) => ({ ...payment, invoice, jobAllocation })),
  );
  const sourcePaidCents = cents(authority.paid_cents);
  const customerAllocatedCents = sum(customerPayments, "amount_cents");
  const bankAllocatedCents = sum(bankPayments, "amount_cents");
  const cashCents = sum(cashPayments, "amount_cents");
  const creditCardCents = sum(creditCardPayments, "amount_cents");
  const unknownSourceCents = sum(unknownSourcePayments, "amount_cents");
  const settledDirectCostCents = supplierInvoices.reduce(
    (total, { invoice, jobAllocation }) =>
      total + (cents(invoice.paid_cents) >= cents(invoice.total_cents) ? cents(jobAllocation.total_cents) : 0),
    0,
  );
  const allDirectCostCents = supplierInvoices.reduce(
    (total, { jobAllocation }) => total + cents(jobAllocation.total_cents),
    0,
  );
  const bookedRevenueBeforeHstCents = customerInvoices.reduce(
    (total, { jobAllocation }) => total + cents(jobAllocation.subtotal_cents),
    0,
  );
  const bankCashReceivedCents = bankPayments.reduce((total, payment) => {
    const metadataCash = Number(payment.metadata?.bank_cash_cents);
    return total + (
      Number.isFinite(metadataCash) && metadataCash > 0
        ? Math.round(metadataCash)
        : cents(payment.amount_cents)
    );
  }, 0);

  return {
    job_id: job.id,
    job_name: job.name,
    proposal_id: proposalId || null,
    invoice_number: authority.invoice_id ?? customerInvoices[0]?.invoice.invoice_number ?? null,
    job_status: job.status,
    production_month: job.production_month,
    completed_on: job.completed_on ?? operational.job_completion_date ?? null,
    deal_stage: operational.deal_stage ?? null,
    deal_stage_date: operational.deal_stage_date ?? null,
    dripjobs_invoice_status: authority.invoice_status ?? null,
    dripjobs_gross_cents: cents(authority.gross_amount_cents ?? job.contract_amount_cents),
    dripjobs_paid_cents: sourcePaidCents,
    dripjobs_balance_cents: cents(authority.balance_cents),
    recorded_customer_allocated_cents: customerAllocatedCents,
    recorded_bank_allocated_cents: bankAllocatedCents,
    recorded_cash_cents: cashCents,
    recorded_credit_card_cents: creditCardCents,
    recorded_unknown_source_cents: unknownSourceCents,
    dripjobs_paid_gap_cents: Math.max(sourcePaidCents - customerAllocatedCents, 0),
    bank_evidence_gap_cents: Math.max(sourcePaidCents - bankAllocatedCents, 0),
    booked_revenue_before_hst_cents: bookedRevenueBeforeHstCents,
    bank_cash_received_cents: bankCashReceivedCents,
    settled_direct_cost_cents: settledDirectCostCents,
    all_direct_cost_cents: allDirectCostCents,
    august_supplier_payment_cents: sum(augustSupplierPayments, "amount_cents"),
    customer_payment_evidence: customerPayments.map((payment) => ({
      allocation_type: payment.allocation_type,
      amount_cents: cents(payment.amount_cents),
      payment_method: paymentMethod(payment),
      transaction_id: payment.transaction_id,
      posted_on: one(payment.transaction)?.posted_on ?? null,
      account_type: one(one(payment.transaction)?.account)?.account_type ?? null,
      account_slug: one(one(payment.transaction)?.account)?.slug ?? null,
      transaction_category: one(payment.transaction)?.category ?? null,
    })),
    supplier_payment_evidence: augustSupplierPayments.map((payment) => ({
      invoice_number: payment.invoice.invoice_number,
      amount_cents: cents(payment.amount_cents),
      job_allocated_subtotal_cents: cents(payment.jobAllocation.subtotal_cents),
      job_allocated_tax_cents: cents(payment.jobAllocation.tax_cents),
      job_allocated_total_cents: cents(payment.jobAllocation.total_cents),
      posted_on: one(payment.transaction)?.posted_on ?? null,
      counterparty: payment.invoice.metadata?.supplier_name ?? null,
    })),
    review_reasons: related
      .filter(({ jobAllocation }) => jobAllocation.needs_review)
      .map(({ invoice }) => `invoice ${invoice.invoice_number} job allocation needs review`),
    open_items: [
      ...(customerInvoices.some(({ invoice }) => cents(invoice.balance_cents) > 0)
        ? ["customer_payment_open"]
        : []),
      ...(supplierInvoices.some(({ invoice }) => cents(invoice.balance_cents) > 0)
        ? ["supplier_payment_open"]
        : []),
    ],
  };
}).sort((left, right) =>
  right.settled_direct_cost_cents - left.settled_direct_cost_cents ||
  left.job_name.localeCompare(right.job_name, "en-CA"),
);

const costWithoutCash = rows.filter((row) =>
  row.settled_direct_cost_cents > 0 && row.bank_cash_received_cents === 0,
);
const completedPaidGaps = rows.filter((row) =>
  /complete/i.test(`${row.job_status} ${row.deal_stage ?? ""}`) &&
  row.dripjobs_paid_cents > row.recorded_customer_allocated_cents,
);
const completedBankGaps = rows.filter((row) =>
  /complete/i.test(`${row.job_status} ${row.deal_stage ?? ""}`) &&
  row.dripjobs_paid_cents > row.recorded_bank_allocated_cents,
);

console.log(JSON.stringify({
  period: { start: PERIOD_START, end: PERIOD_END },
  august_jobs: rows.length,
  cost_without_recorded_customer_cash: {
    count: costWithoutCash.length,
    settled_direct_cost_cents: sum(costWithoutCash, "settled_direct_cost_cents"),
    rows: costWithoutCash,
  },
  completed_dripjobs_paid_but_not_recorded: {
    count: completedPaidGaps.length,
    gap_cents: sum(completedPaidGaps, "dripjobs_paid_gap_cents"),
    rows: completedPaidGaps,
  },
  completed_dripjobs_paid_without_bank_evidence: {
    count: completedBankGaps.length,
    gap_cents: sum(completedBankGaps, "bank_evidence_gap_cents"),
    rows: completedBankGaps,
  },
  all_august_jobs: rows,
}, null, 2));
