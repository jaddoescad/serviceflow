#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

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

function money(value) {
  return Number(Number(value ?? 0).toFixed(2));
}

function total(rows, field) {
  return money(rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0));
}

function closeEnough(left, right) {
  return Math.abs(Number(left ?? 0) - Number(right ?? 0)) <= 0.02;
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const value = String(row[field] ?? "unknown");
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [jobResult, invoiceResult, exceptionResult] = await Promise.all([
  db.rpc("read_job_accounting_reconciliation", {
    p_companycam_project_id: null,
  }),
  db.rpc("read_customer_invoice_reconciliation"),
  db
    .from("accounting_reconciliation_exceptions")
    .select("exception_key,exception_scope,amount,reason,resolution_status"),
]);

if (jobResult.error) throw jobResult.error;
if (invoiceResult.error) throw invoiceResult.error;
if (exceptionResult.error) throw exceptionResult.error;

const jobs = jobResult.data ?? [];
const invoices = invoiceResult.data ?? [];
const exceptions = exceptionResult.data ?? [];
const failures = [];

const duplicateProposalIds = Object.entries(countBy(jobs, "job_proposal_id"))
  .filter(([, count]) => count > 1)
  .map(([proposalId]) => proposalId);
if (duplicateProposalIds.length > 0) {
  failures.push({ control: "unique_job_proposal", ids: duplicateProposalIds });
}

for (const job of jobs) {
  const proposalId = job.job_proposal_id;
  const controls = [
    [
      "customer_invoice_math",
      Number(job.booked_revenue_before_hst) + Number(job.customer_hst_billed),
      job.customer_invoice_total,
    ],
    [
      "supplier_invoice_math",
      Number(job.supplier_cost_before_hst) + Number(job.supplier_hst_documented),
      job.supplier_cost_after_hst,
    ],
    [
      "material_invoice_math",
      Number(job.material_cost_before_hst) + Number(job.material_hst_documented),
      job.material_cost_after_hst,
    ],
    [
      "direct_cost_math",
      Number(job.supplier_cost_before_hst) +
        Number(job.material_cost_before_hst),
      job.direct_cost_before_hst,
    ],
    [
      "direct_cost_hst_math",
      Number(job.supplier_hst_documented) +
        Number(job.material_hst_documented),
      job.direct_cost_hst_documented,
    ],
    [
      "gross_profit_math",
      Number(job.booked_revenue_before_hst) -
        Number(job.direct_cost_before_hst),
      job.gross_profit_before_hst,
    ],
  ];
  for (const [control, expected, actual] of controls) {
    if (!closeEnough(expected, actual)) {
      failures.push({ control, proposalId, expected: money(expected), actual: money(actual) });
    }
  }
}

for (const invoice of invoices) {
  const invoiceId = invoice.customer_invoice_id;
  const controls = [
    [
      "customer_invoice_total_math",
      Number(invoice.billed_before_hst) + Number(invoice.billed_hst),
      invoice.billed_after_hst,
    ],
    [
      "customer_invoice_credit_math",
      Number(invoice.invoice_credited_before_hst) +
        Number(invoice.invoice_credited_hst),
      invoice.invoice_credited_after_hst,
    ],
    [
      "customer_receivable_math",
      Math.max(
        Number(invoice.billed_after_hst) -
          Number(invoice.invoice_credited_after_hst),
        0,
      ),
      invoice.amount_receivable,
    ],
  ];
  for (const [control, expected, actual] of controls) {
    if (!closeEnough(expected, actual)) {
      failures.push({ control, invoiceId, expected: money(expected), actual: money(actual) });
    }
  }
}

const jobStates = {
  needs_review: jobs.filter((job) => (job.review_reasons ?? []).length > 0).length,
  connected_open: jobs.filter(
    (job) =>
      (job.review_reasons ?? []).length === 0 && (job.open_items ?? []).length > 0,
  ).length,
  connected_settled: jobs.filter(
    (job) =>
      (job.review_reasons ?? []).length === 0 && (job.open_items ?? []).length === 0,
  ).length,
};

const audit = {
  projectRef: new URL(supabaseUrl).hostname.split(".")[0],
  controls: {
    passed: failures.length === 0,
    jobsChecked: jobs.length,
    customerInvoicesChecked: invoices.length,
    failures,
  },
  jobs: {
    states: jobStates,
    bookedBeforeHst: total(jobs, "booked_revenue_before_hst"),
    customerHst: total(jobs, "customer_hst_billed"),
    bankCash: total(jobs, "customer_bank_cash_received"),
    receivable: total(jobs, "customer_amount_receivable"),
    supplierBeforeHst: total(jobs, "supplier_cost_before_hst"),
    supplierHst: total(jobs, "supplier_hst_documented"),
    materialBeforeHst: total(jobs, "material_cost_before_hst"),
    materialHst: total(jobs, "material_hst_documented"),
  },
  customerInvoices: {
    beforeHst: total(invoices, "billed_before_hst"),
    hst: total(invoices, "billed_hst"),
    afterHst: total(invoices, "billed_after_hst"),
    bankCash: total(invoices, "bank_cash_received"),
    receivable: total(invoices, "amount_receivable"),
  },
  exceptionQueue: {
    count: exceptions.length,
    amount: total(exceptions, "amount"),
    byScope: countBy(exceptions, "exception_scope"),
    byReason: countBy(exceptions, "reason"),
  },
};

console.log(JSON.stringify(audit, null, 2));
if (failures.length > 0) process.exitCode = 1;
