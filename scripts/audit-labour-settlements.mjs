#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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

function settlementRows(sourceData) {
  if (
    sourceData == null ||
    typeof sourceData !== "object" ||
    Array.isArray(sourceData) ||
    !Array.isArray(sourceData.settlements)
  ) {
    return [];
  }
  return sourceData.settlements.filter(
    (value) => value != null && typeof value === "object" && !Array.isArray(value),
  );
}

function round(value, precision = 2) {
  const scale = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl =
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== "bwbckdkouqghdadpkjvn") {
  throw new Error(`Refusing audit for unexpected project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchAllFinancialSettlementSources() {
  const rows = [];
  const pageSize = 1000;
  for (let page = 0; page < 20; page += 1) {
    const from = page * pageSize;
    const result = await db
      .from("financial_transactions")
      .select(
        "id,posted_on,description,counterparty,amount,category,review_status,source_data",
      )
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (result.error) return result;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) {
      return { data: rows, error: null };
    }
  }
  return {
    data: null,
    error: new Error("Financial transaction audit exceeded 20,000 rows."),
  };
}

const [
  invoiceResult,
  profileResult,
  timeEntryResult,
  expenseResult,
  subcontractorTransactionsResult,
  allInvoicesResult,
  allInvoiceLinksResult,
  allSettlementSourcesResult,
  contractorCountResult,
  invoiceLineCountResult,
  lineAllocationCountResult,
  lineTimeEntryCountResult,
  paymentAllocationResult,
  resolutionCountResult,
  invoiceReconciliationResult,
  paymentReconciliationResult,
] = await Promise.all([
  db
    .from("labour_invoices")
    .select(
      "id,supplier_name,invoice_number,invoice_date,source_date,amount_paid,amount_before_tax,tax_amount,currency,document_type,match_status,payment_basis,original_filename,text_excerpt",
    )
    .or(
      "supplier_name.ilike.%Fennec%,supplier_name.ilike.%Bilal%,text_excerpt.ilike.%Fennec%,text_excerpt.ilike.%Bilal%",
    )
    .order("invoice_date", { ascending: true, nullsFirst: false }),
  db
    .from("employee_profiles")
    .select("user_id,full_name,email,role,is_active")
    .or("full_name.ilike.%Bilal%,email.ilike.%bilal%"),
  db
    .from("time_entries")
    .select(
      "id,user_id,user_name,user_email,companycam_project_id,project_name,project_address,started_at,ended_at,status,approved_at,approved_by",
    )
    .or("user_name.ilike.%Bilal%,user_email.ilike.%bilal%")
    .gte("started_at", "2026-06-20T00:00:00Z")
    .lt("started_at", "2026-08-01T00:00:00Z")
    .order("started_at", { ascending: true }),
  db
    .from("project_labour_expenses")
    .select(
      "id,companycam_project_id,invoice_date,invoice_number,supplier_name,worker_name,worker_user_id,amount_before_tax,tax_amount,notes",
    )
    .or(
      "worker_name.ilike.%Bilal%,supplier_name.ilike.%Fennec%,supplier_name.ilike.%Bilal%",
    )
    .order("invoice_date", { ascending: true }),
  db
    .from("financial_transactions")
    .select(
      "id,posted_on,transaction_on,description,counterparty,amount,net_amount,currency,category,review_status,source_data,account_id",
    )
    .eq("category", "Subcontractors")
    .gte("posted_on", "2026-06-20")
    .lte("posted_on", "2026-07-31")
    .order("posted_on", { ascending: true })
    .limit(1000),
  db
    .from("labour_invoices")
    .select("id,amount_before_tax,amount_paid,document_type"),
  db
    .from("labour_invoice_projects")
    .select("invoice_id,companycam_project_id,allocated_amount,needs_review"),
  fetchAllFinancialSettlementSources(),
  db.from("labour_contractors").select("id", { count: "exact", head: true }),
  db.from("labour_invoice_lines").select("id", { count: "exact", head: true }),
  db
    .from("labour_invoice_line_allocations")
    .select("invoice_line_id", { count: "exact", head: true }),
  db
    .from("labour_invoice_line_time_entries")
    .select("invoice_line_id", { count: "exact", head: true }),
  db
    .from("labour_payment_allocations")
    .select(
      "id,financial_transaction_id,invoice_id,allocated_amount,match_method,confirmed_at",
    ),
  db
    .from("labour_reconciliation_resolutions")
    .select("id", { count: "exact", head: true }),
  db.from("labour_invoice_reconciliation").select("*"),
  db.from("labour_payment_reconciliation").select("*"),
]);

for (const [label, result] of Object.entries({
  invoices: invoiceResult,
  profiles: profileResult,
  timeEntries: timeEntryResult,
  labourExpenses: expenseResult,
  subcontractorTransactions: subcontractorTransactionsResult,
  allInvoices: allInvoicesResult,
  allInvoiceLinks: allInvoiceLinksResult,
  allSettlementSources: allSettlementSourcesResult,
  contractorCount: contractorCountResult,
  invoiceLineCount: invoiceLineCountResult,
  lineAllocationCount: lineAllocationCountResult,
  lineTimeEntryCount: lineTimeEntryCountResult,
  paymentAllocations: paymentAllocationResult,
  resolutionCount: resolutionCountResult,
  invoiceReconciliation: invoiceReconciliationResult,
  paymentReconciliation: paymentReconciliationResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

const invoices = invoiceResult.data ?? [];
const invoiceIds = invoices.map((invoice) => invoice.id);
const invoiceLinkResult = invoiceIds.length
  ? await db
      .from("labour_invoice_projects")
      .select(
        "invoice_id,companycam_project_id,allocated_amount,match_score,match_method,is_primary,needs_review,companycam_projects(name,formatted_address,is_archived,is_lead,is_deleted)",
      )
      .in("invoice_id", invoiceIds)
  : { data: [], error: null };

if (invoiceLinkResult.error) {
  throw new Error(`invoiceLinks: ${invoiceLinkResult.error.message}`);
}

const invoiceIdSet = new Set(invoiceIds);
const invoiceAmounts = new Set(
  invoices
    .flatMap((invoice) => [invoice.amount_paid, invoice.amount_before_tax])
    .filter((value) => value != null)
    .map((value) => round(Math.abs(value))),
);
const candidateTransactions = (subcontractorTransactionsResult.data ?? [])
  .filter((transaction) => {
    const text = `${transaction.counterparty ?? ""} ${transaction.description}`.toLowerCase();
    const linked = settlementRows(transaction.source_data).some(
      (settlement) =>
        typeof settlement.labour_invoice_id === "string" &&
        invoiceIdSet.has(settlement.labour_invoice_id),
    );
    return (
      linked ||
      text.includes("bilal") ||
      text.includes("fennec") ||
      invoiceAmounts.has(round(Math.abs(transaction.amount)))
    );
  })
  .map((transaction) => ({
    id: transaction.id,
    posted_on: transaction.posted_on,
    transaction_on: transaction.transaction_on,
    description: transaction.description,
    counterparty: transaction.counterparty,
    amount: transaction.amount,
    net_amount: transaction.net_amount,
    currency: transaction.currency,
    category: transaction.category,
    review_status: transaction.review_status,
    settlements: settlementRows(transaction.source_data),
  }));

const timeEntries = (timeEntryResult.data ?? []).map((entry) => {
  const startedAt = Date.parse(entry.started_at);
  const endedAt = entry.ended_at ? Date.parse(entry.ended_at) : Number.NaN;
  const hours =
    Number.isFinite(startedAt) && Number.isFinite(endedAt)
      ? Math.max(0, endedAt - startedAt) / 3_600_000
      : null;
  return {
    ...entry,
    hours: hours == null ? null : round(hours, 4),
  };
});

const timeByProject = [...new Set(timeEntries.map((entry) => entry.project_name))]
  .map((projectName) => {
    const entries = timeEntries.filter((entry) => entry.project_name === projectName);
    return {
      project_name: projectName,
      companycam_project_ids: [
        ...new Set(entries.map((entry) => entry.companycam_project_id).filter(Boolean)),
      ],
      entry_count: entries.length,
      hours: round(
        entries.reduce((sum, entry) => sum + Number(entry.hours ?? 0), 0),
        4,
      ),
      entries,
    };
  })
  .sort((left, right) => left.project_name.localeCompare(right.project_name, "en-CA"));

const allInvoices = allInvoicesResult.data ?? [];
const allInvoiceLinks = allInvoiceLinksResult.data ?? [];
const linksByInvoice = new Map();
for (const link of allInvoiceLinks) {
  const links = linksByInvoice.get(link.invoice_id) ?? [];
  links.push(link);
  linksByInvoice.set(link.invoice_id, links);
}
const invoiceAllocationAudit = allInvoices
  .filter(
    (invoice) =>
      invoice.document_type === "invoice" && invoice.amount_before_tax != null,
  )
  .map((invoice) => {
    const links = linksByInvoice.get(invoice.id) ?? [];
    const allocatedAmount = round(
      links.reduce(
        (sum, link) => sum + Number(link.allocated_amount ?? 0),
        0,
      ),
    );
    const invoiceAmount = round(invoice.amount_before_tax);
    return {
      invoice_id: invoice.id,
      invoice_amount: invoiceAmount,
      allocated_amount: allocatedAmount,
      variance: round(allocatedAmount - invoiceAmount),
      link_count: links.length,
      has_null_allocation: links.some((link) => link.allocated_amount == null),
      needs_review: links.some((link) => link.needs_review),
    };
  });
const legacySettlements = (allSettlementSourcesResult.data ?? []).flatMap(
  (transaction) =>
    settlementRows(transaction.source_data).map((settlement) => ({
      transaction_id: transaction.id,
      transaction_amount: transaction.amount,
      ...settlement,
    })),
);
const financialTransactions = allSettlementSourcesResult.data ?? [];
const categorySummary = Object.values(
  financialTransactions.reduce((summary, transaction) => {
    const key = `${transaction.category}\u0000${transaction.review_status}`;
    const current = summary[key] ?? {
      category: transaction.category,
      review_status: transaction.review_status,
      transaction_count: 0,
      absolute_amount: 0,
    };
    current.transaction_count += 1;
    current.absolute_amount = round(
      current.absolute_amount + Math.abs(Number(transaction.amount)),
    );
    summary[key] = current;
    return summary;
  }, {}),
).sort(
  (left, right) =>
    right.absolute_amount - left.absolute_amount ||
    left.category.localeCompare(right.category, "en-CA"),
);
const subcontractorSummary = Object.values(
  financialTransactions
    .filter((transaction) => transaction.category === "Subcontractors")
    .reduce((summary, transaction) => {
      const counterparty = transaction.counterparty?.trim() || "Unknown";
      const current = summary[counterparty] ?? {
        counterparty,
        transaction_count: 0,
        absolute_amount: 0,
        needs_review_count: 0,
      };
      current.transaction_count += 1;
      current.absolute_amount = round(
        current.absolute_amount + Math.abs(Number(transaction.amount)),
      );
      if (transaction.review_status !== "reconciled") {
        current.needs_review_count += 1;
      }
      summary[counterparty] = current;
      return summary;
    }, {}),
).sort(
  (left, right) =>
    right.absolute_amount - left.absolute_amount ||
    left.counterparty.localeCompare(right.counterparty, "en-CA"),
);
const subcontractorReviewRows = financialTransactions
  .filter(
    (transaction) =>
      transaction.category === "Subcontractors" &&
      transaction.review_status !== "reconciled",
  )
  .map((transaction) => ({
    id: transaction.id,
    posted_on: transaction.posted_on,
    description: transaction.description,
    counterparty: transaction.counterparty,
    amount: transaction.amount,
  }))
  .sort(
    (left, right) =>
      Math.abs(Number(right.amount)) - Math.abs(Number(left.amount)) ||
      left.posted_on.localeCompare(right.posted_on),
  );

console.log(
  JSON.stringify(
    {
      mode: "read-only",
      project_ref: projectRef,
      audited_at: new Date().toISOString(),
      table_counts: {
        labour_invoices: allInvoices.length,
        labour_invoice_projects: allInvoiceLinks.length,
        financial_transactions: (allSettlementSourcesResult.data ?? []).length,
      },
      archive_health: {
        invoices_with_project_links: invoiceAllocationAudit.filter(
          (invoice) => invoice.link_count > 0,
        ).length,
        invoices_without_project_links: invoiceAllocationAudit.filter(
          (invoice) => invoice.link_count === 0,
        ).length,
        invoices_with_null_allocations: invoiceAllocationAudit.filter(
          (invoice) => invoice.has_null_allocation,
        ).length,
        invoices_with_amount_variance: invoiceAllocationAudit.filter(
          (invoice) => Math.abs(invoice.variance) > 0.01,
        ).length,
        project_links_needing_review: allInvoiceLinks.filter(
          (link) => link.needs_review,
        ).length,
      },
      financial_classification_health: {
        by_category_and_review_status: categorySummary,
        subcontractors: subcontractorSummary,
        subcontractor_needs_review: subcontractorReviewRows,
      },
      legacy_json_settlements: {
        allocation_count: legacySettlements.length,
        transaction_count: new Set(
          legacySettlements.map((settlement) => settlement.transaction_id),
        ).size,
        invoice_count: new Set(
          legacySettlements
            .map((settlement) => settlement.labour_invoice_id)
            .filter(Boolean),
        ).size,
        allocated_amount: round(
          legacySettlements.reduce(
            (sum, settlement) =>
              sum + Number(settlement.allocated_amount ?? 0),
            0,
          ),
        ),
      },
      settlement_model: {
        table_counts: {
          labour_contractors: contractorCountResult.count ?? 0,
          labour_invoice_lines: invoiceLineCountResult.count ?? 0,
          labour_invoice_line_allocations:
            lineAllocationCountResult.count ?? 0,
          labour_invoice_line_time_entries:
            lineTimeEntryCountResult.count ?? 0,
          labour_payment_allocations:
            (paymentAllocationResult.data ?? []).length,
          labour_reconciliation_resolutions:
            resolutionCountResult.count ?? 0,
        },
        payment_allocations: paymentAllocationResult.data ?? [],
        audited_invoices: (invoiceReconciliationResult.data ?? []).filter(
          (invoice) => invoiceIdSet.has(invoice.invoice_id),
        ),
        candidate_payments: (paymentReconciliationResult.data ?? []).filter(
          (payment) =>
            candidateTransactions.some(
              (candidate) =>
                candidate.id === payment.financial_transaction_id,
            ),
        ),
      },
      contractor_profiles: profileResult.data ?? [],
      invoices,
      invoice_project_links: invoiceLinkResult.data ?? [],
      candidate_bank_transactions: candidateTransactions,
      timesheets: {
        entry_count: timeEntries.length,
        total_hours: round(
          timeEntries.reduce((sum, entry) => sum + Number(entry.hours ?? 0), 0),
          4,
        ),
        by_project: timeByProject,
      },
      project_labour_expenses: expenseResult.data ?? [],
    },
    null,
    2,
  ),
);
