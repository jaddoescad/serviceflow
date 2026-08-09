#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DETAILS = process.argv.includes("--details");
const FROM = process.argv.find((arg) => arg.startsWith("--from="))?.slice(7) ?? "2026-01-01";
const TO = process.argv.find((arg) => arg.startsWith("--to="))?.slice(5) ?? "2026-12-31";

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

async function all(table, columns = "*", apply = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const result = await apply(db.from(table).select(columns).order("id").range(from, from + 999));
    if (result.error) throw new Error(`${table}: ${result.error.message}`);
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < 1000) break;
  }
  return rows;
}

const [transactions, allocations, invoices, lines, jobAllocations, jobs, contacts, evidenceLinks] = await Promise.all([
  all("transactions", "id,posted_on,description,counterparty,amount_cents,currency,transaction_type,category,is_transfer,review_status,notes,metadata,contact_id", (query) => query.gte("posted_on", FROM).lte("posted_on", TO)),
  all("transaction_allocations"),
  all("invoices"),
  all("invoice_lines"),
  all("invoice_job_allocations"),
  all("jobs", "id,name,status,metadata"),
  all("contacts", "id,name"),
  all("evidence_links", "id,document_id,entity_type,entity_id,evidence_role,metadata"),
]);

const transactionIds = new Set(transactions.map((row) => row.id));
const transactionById = new Map(transactions.map((row) => [row.id, row]));
const periodAllocations = allocations.filter((row) => row.transaction_id && transactionIds.has(row.transaction_id));
const activeTransactionAllocations = periodAllocations.filter((row) => !row.reversed_at);
const contactById = new Map(contacts.map((row) => [row.id, row.name]));
const jobById = new Map(jobs.map((row) => [row.id, row]));
const invoiceById = new Map(invoices.map((row) => [row.id, row]));
const linesByInvoice = Map.groupBy(lines, (row) => row.invoice_id);
const txAllocationsByTransaction = Map.groupBy(activeTransactionAllocations, (row) => row.transaction_id);
const paymentAllocationsByInvoice = Map.groupBy(
  allocations.filter((row) => row.invoice_id && row.transaction_id && !row.reversed_at),
  (row) => row.invoice_id,
);

const activeJobAllocations = jobAllocations.filter((row) => !row.metadata?.reversed_at);
const linePairs = new Set(activeJobAllocations.filter((row) => row.invoice_line_id).map((row) => `${row.invoice_id}\0${row.job_id}`));
const usableJobAllocations = activeJobAllocations.filter((row) => row.invoice_line_id || !linePairs.has(`${row.invoice_id}\0${row.job_id}`));
const usableJobAllocationsByInvoice = Map.groupBy(usableJobAllocations, (row) => row.invoice_id);
const activeJobAllocationsByLine = Map.groupBy(activeJobAllocations.filter((row) => row.invoice_line_id), (row) => row.invoice_line_id);
const evidenceByInvoice = Map.groupBy(evidenceLinks.filter((row) => row.entity_type === "invoice"), (row) => row.entity_id);
const nonCostingStatuses = new Set(["not_invoice", "overhead_unmatched", "supporting_document"]);

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row?.[field] ?? 0), 0);
}

function explicitLineNonJobSubtotal(line) {
  const confirmed = line.metadata?.non_job_classification;
  if (confirmed?.status === "confirmed" && Number.isFinite(Number(confirmed.allocated_subtotal_cents))) {
    return Number(confirmed.allocated_subtotal_cents);
  }
  const allocations = Array.isArray(line.metadata?.overhead_allocations)
    ? line.metadata.overhead_allocations
    : [];
  return allocations
    .filter((row) => !row.reversed_at)
    .reduce((total, row) => total + Math.round(Number(row.allocated_before_tax ?? 0) * 100), 0);
}

function explicitTransactionException(transaction) {
  const metadata = transaction.metadata ?? {};
  return Boolean(
    transaction.is_transfer ||
    metadata.cancelled_e_transfer?.status === "cancelled" ||
    metadata.confirmed_overpayment?.status === "confirmed" ||
    metadata.reconciliation_research?.status === "no_invoice_provided" ||
    metadata.reconciliation_research?.status === "invoice_not_found" ||
    metadata.reconciliation_research?.status === "partial_invoice_allocation_with_no_invoice_residual" ||
    metadata.expense_evidence?.status === "bank_supported_no_itc" ||
    metadata.document_exception?.status === "confirmed" ||
    (metadata.customer_revenue_exception?.status === "confirmed" && metadata.customer_revenue_exception?.review !== true) ||
    ["Bank fees", "Credit card payment", "Owner draw", "Payroll", "Payroll taxes", "Tax payment"].includes(transaction.category)
  );
}

function allocationCash(row) {
  const metadataCash = Number(row.metadata?.bank_cash_cents);
  return Number.isFinite(metadataCash) && metadataCash > 0 ? metadataCash : Number(row.amount_cents ?? 0);
}

const transactionIssues = [];
for (const transaction of transactions) {
  const active = txAllocationsByTransaction.get(transaction.id) ?? [];
  const grossAllocated = sum(active, "amount_cents");
  const cashAllocated = active.reduce((total, row) => total + allocationCash(row), 0);
  const bankAmount = Math.abs(Number(transaction.amount_cents));
  const expectedAllocation = ["Subcontractors", "Pressure washing", "Paint & materials", "Colour consultation", "Painting revenue"].includes(transaction.category);
  const exception = explicitTransactionException(transaction);
  const balance = transaction.amount_cents > 0 ? bankAmount - cashAllocated : bankAmount - grossAllocated;
  const reasons = [];
  if (transaction.review_status !== "reconciled") reasons.push(`review_status=${transaction.review_status}`);
  if (expectedAllocation && !exception && active.length === 0) reasons.push("missing allocation");
  const reconciliationResearch = transaction.metadata?.reconciliation_research ?? {};
  const confirmedNoInvoiceResidual = reconciliationResearch.status === "partial_invoice_allocation_with_no_invoice_residual" &&
    (reconciliationResearch.user_confirmed === true || reconciliationResearch.confirmation_status === "confirmed_from_stored_invoice_batch_and_payment_inventory") &&
    Math.abs(balance) === Math.round(Number(reconciliationResearch.no_invoice_amount ?? 0) * 100);
  const revenueException = transaction.metadata?.customer_revenue_exception;
  const confirmedCustomerRevenueResidual = transaction.amount_cents > 0 &&
    revenueException?.status === "confirmed" &&
    revenueException?.review !== true &&
    typeof revenueException?.kind === "string" &&
    typeof revenueException?.resolution === "string" &&
    revenueException.resolution.length > 0 &&
    (revenueException.kind !== "processor_test_charge" ||
      Math.abs(balance) === Number(transaction.metadata?.stripe_payout_reconciliation?.non_invoice_test_charge_net_cents));
  if (active.length > 0 && Math.abs(balance) > 1 && !confirmedNoInvoiceResidual && !confirmedCustomerRevenueResidual) reasons.push(`allocation difference ${balance} cents`);
  if (active.some((row) => row.needs_review)) reasons.push("allocation needs review");
  if (reasons.length) transactionIssues.push({
    id: transaction.id,
    posted_on: transaction.posted_on,
    description: transaction.description,
    counterparty: transaction.counterparty,
    amount_cents: transaction.amount_cents,
    category: transaction.category,
    active_allocation_count: active.length,
    gross_allocated_cents: grossAllocated,
    cash_allocated_cents: cashAllocated,
    reasons,
    notes: transaction.notes,
  });
}

const invoiceIssues = [];
const lineIssues = [];
for (const invoice of invoices) {
  const invoiceLines = linesByInvoice.get(invoice.id) ?? [];
  const lineSubtotal = sum(invoiceLines, "subtotal_cents");
  const lineTax = sum(invoiceLines, "tax_cents");
  const lineTotal = sum(invoiceLines, "total_cents");
  const jobRows = usableJobAllocationsByInvoice.get(invoice.id) ?? [];
  const jobSubtotal = sum(jobRows, "subtotal_cents");
  const jobTotal = sum(jobRows, "total_cents");
  const explicitNonJobSubtotal = ["labour", "material"].includes(invoice.category)
    ? invoiceLines.reduce((total, line) => total + explicitLineNonJobSubtotal(line), 0)
    : 0;
  const classifiedCostSubtotal = jobSubtotal + explicitNonJobSubtotal;
  const paymentRows = paymentAllocationsByInvoice.get(invoice.id) ?? [];
  const bankBackedPaid = sum(paymentRows, "amount_cents");
  const customerPaidGap = Number(invoice.paid_cents) - bankBackedPaid;
  const confirmedCustomerOverpayment = customerPaidGap > 0 && paymentRows.some((row) => {
    const transaction = transactionById.get(row.transaction_id);
    const exception = transaction?.metadata?.customer_revenue_exception;
    const residual = Math.abs(Number(transaction?.amount_cents ?? 0)) - Number(row.amount_cents ?? 0);
    return exception?.status === "confirmed" && exception?.kind === "overpayment" && Math.abs(residual - customerPaidGap) <= 2;
  });
  const reasons = [];
  if (!nonCostingStatuses.has(invoice.status) && Number(invoice.total_cents) > 0 && invoiceLines.length === 0) reasons.push("no invoice lines");
  if (invoiceLines.length && Math.abs(lineSubtotal - Number(invoice.subtotal_cents)) > 2) reasons.push(`line subtotal difference ${lineSubtotal - Number(invoice.subtotal_cents)} cents`);
  // Many migrated supplier invoices carry tax only at the header. If line subtotals
  // agree, zero line tax is an acceptable representation of the same source invoice.
  const headerTaxOnly = lineSubtotal === Number(invoice.subtotal_cents) && lineTax === 0 && Number(invoice.tax_cents) !== 0;
  if (invoiceLines.length && !headerTaxOnly && Math.abs(lineTax - Number(invoice.tax_cents)) > 2) reasons.push(`line tax difference ${lineTax - Number(invoice.tax_cents)} cents`);
  if (invoiceLines.length && !headerTaxOnly && Math.abs(lineTotal - Number(invoice.total_cents)) > 2) reasons.push(`line total difference ${lineTotal - Number(invoice.total_cents)} cents`);
  if (jobSubtotal > Math.max(Number(invoice.subtotal_cents), 0) + 2) reasons.push(`job allocations exceed pre-tax invoice subtotal by ${jobSubtotal - Math.max(Number(invoice.subtotal_cents), 0)} cents`);
  if (!nonCostingStatuses.has(invoice.status) && jobRows.some((row) => row.needs_review)) reasons.push("job allocation needs review");
  if (invoice.category === "customer" && !nonCostingStatuses.has(invoice.status) && Number(invoice.subtotal_cents) > 0 && Math.abs(jobSubtotal - Number(invoice.subtotal_cents)) > 2) reasons.push(`customer invoice pre-tax job-link difference ${jobSubtotal - Number(invoice.subtotal_cents)} cents`);
  if (["labour", "material"].includes(invoice.category) && !nonCostingStatuses.has(invoice.status) && Number(invoice.subtotal_cents) > 0 && classifiedCostSubtotal === 0) reasons.push("costing invoice has no job allocation or explicit non-job classification");
  if (["labour", "material"].includes(invoice.category) && !nonCostingStatuses.has(invoice.status) && classifiedCostSubtotal !== 0 && Math.abs(classifiedCostSubtotal - Number(invoice.subtotal_cents)) > 2) reasons.push(`costing pre-tax classification difference ${classifiedCostSubtotal - Number(invoice.subtotal_cents)} cents`);
  if (invoice.direction === "payable" && !nonCostingStatuses.has(invoice.status) && Math.abs(bankBackedPaid - Number(invoice.paid_cents)) > 2) reasons.push(`payable bank-backed difference ${bankBackedPaid - Number(invoice.paid_cents)} cents`);
  if (invoice.direction === "receivable" && !nonCostingStatuses.has(invoice.status) && Number(invoice.paid_cents) > 0 && bankBackedPaid + 2 < Number(invoice.paid_cents) && !confirmedCustomerOverpayment) reasons.push(`customer paid amount lacks ${customerPaidGap} cents of bank linkage`);
  if (Number(invoice.balance_cents) !== Number(invoice.total_cents) - Number(invoice.paid_cents)) reasons.push("stored balance arithmetic mismatch");
  if (!nonCostingStatuses.has(invoice.status) && Number(invoice.total_cents) > 0 && !(evidenceByInvoice.get(invoice.id)?.length)) reasons.push("no source evidence link");
  if (reasons.length) invoiceIssues.push({
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    contact: contactById.get(invoice.contact_id) ?? null,
    direction: invoice.direction,
    category: invoice.category,
    status: invoice.status,
    issued_on: invoice.issued_on,
    total_cents: invoice.total_cents,
    paid_cents: invoice.paid_cents,
    balance_cents: invoice.balance_cents,
    line_count: invoiceLines.length,
    line_total_cents: lineTotal,
    job_allocation_count: jobRows.length,
    job_subtotal_cents: jobSubtotal,
    job_total_cents: jobTotal,
    explicit_non_job_subtotal_cents: explicitNonJobSubtotal,
    classified_cost_subtotal_cents: classifiedCostSubtotal,
    bank_backed_paid_cents: bankBackedPaid,
    reasons,
  });
}

for (const line of lines) {
  const invoice = invoiceById.get(line.invoice_id);
  if (!invoice || nonCostingStatuses.has(invoice.status)) continue;
  const allocationsForLine = activeJobAllocationsByLine.get(line.id) ?? [];
  const allocated = sum(allocationsForLine, "subtotal_cents");
  if (allocated > Math.max(Number(line.subtotal_cents), 0) + 2) lineIssues.push({
    invoice_id: line.invoice_id,
    invoice_number: invoice.invoice_number,
    line_id: line.id,
    line_number: line.line_number,
    description: line.description,
    subtotal_cents: line.subtotal_cents,
    allocated_subtotal_cents: allocated,
    reason: "line job allocations exceed pre-tax line subtotal",
  });
}

const missingJobs = usableJobAllocations.filter((row) => !jobById.has(row.job_id)).map((row) => ({ id: row.id, invoice_id: row.invoice_id, job_id: row.job_id }));
const jobCostSummary = ["customer", "labour", "material", "other"].map((category) => {
  const rows = usableJobAllocations.filter((row) => invoiceById.get(row.invoice_id)?.category === category && !nonCostingStatuses.has(invoiceById.get(row.invoice_id)?.status));
  return { category, allocation_count: rows.length, job_count: new Set(rows.map((row) => row.job_id)).size, subtotal_cents: sum(rows, "subtotal_cents"), total_cents: sum(rows, "total_cents") };
});

const unresolvedTransactions = transactionIssues.filter((row) => row.reasons.some((reason) => reason.startsWith("review_status=") || reason === "missing allocation"));
const result = {
  period: { from: FROM, to: TO },
  counts: {
    transactions: transactions.length,
    reconciled_transactions: transactions.filter((row) => row.review_status === "reconciled").length,
    transaction_issues: transactionIssues.length,
    unresolved_transactions: unresolvedTransactions.length,
    invoices: invoices.length,
    invoice_lines: lines.length,
    active_transaction_allocations: activeTransactionAllocations.length,
    active_job_allocations: activeJobAllocations.length,
    usable_job_cost_allocations: usableJobAllocations.length,
    invoice_issues: invoiceIssues.length,
    line_overallocation_issues: lineIssues.length,
    missing_job_references: missingJobs.length,
  },
  job_cost_summary: jobCostSummary,
  unresolved_transactions: unresolvedTransactions,
  transaction_issues: DETAILS ? transactionIssues : transactionIssues.slice(0, 50),
  invoice_issues: DETAILS ? invoiceIssues : invoiceIssues.slice(0, 100),
  line_issues: lineIssues,
  missing_jobs: missingJobs,
};
console.log(JSON.stringify(result, null, 2));

if (missingJobs.length || lineIssues.length) process.exitCode = 2;
