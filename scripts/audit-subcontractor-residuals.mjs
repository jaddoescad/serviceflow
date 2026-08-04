#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";

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

function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function money(value) {
  return cents(value) / 100;
}

function sourceObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
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
  env.SUPABASE_URL ||
  env.NEXT_PUBLIC_SUPABASE_URL ||
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

const [
  invoiceVerification,
  paymentVerification,
  invoices,
  contractors,
  transactions,
  paymentRecords,
] = await Promise.all([
  fetchAll(() => db.from("labour_invoice_verification").select("*")),
  fetchAll(() => db.from("labour_payment_verification").select("*")),
  fetchAll(() =>
    db
      .from("labour_invoices")
      .select(
        "id,contractor_id,supplier_name,invoice_number,invoice_date,source_date,amount_before_tax,tax_amount,amount_paid,currency,document_type,match_status,duplicate_group_id,supporting_invoice_reference,original_filename,text_excerpt",
      ),
  ),
  fetchAll(() =>
    db
      .from("labour_contractors")
      .select("id,supplier_name,worker_user_id,notes"),
  ),
  fetchAll(() =>
    db
      .from("financial_transactions")
      .select(
        "id,posted_on,transaction_on,description,counterparty,amount,currency,category,transaction_type,is_transfer,review_status,notes,source_data,financial_accounts(name,last_four),financial_imports(original_filename,source_kind)",
      )
      .eq("category", "Subcontractors"),
  ),
  fetchAll(() =>
    db
      .from("labour_payment_records")
      .select(
        "financial_transaction_id,contractor_id,recipient_status,confirmation_method,confirmation_note,confirmed_at",
      ),
  ),
]);

const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
const invoiceVerificationById = new Map(
  invoiceVerification.map((invoice) => [invoice.invoice_id, invoice]),
);
const paymentVerificationById = new Map(
  paymentVerification.map((payment) => [
    payment.financial_transaction_id,
    payment,
  ]),
);
const paymentRecordById = new Map(
  paymentRecords.map((record) => [record.financial_transaction_id, record]),
);
const contractorById = new Map(
  contractors.map((contractor) => [contractor.id, contractor]),
);

const excludedInvoiceStatuses = new Set([
  "supporting_document",
  "overhead_unmatched",
]);
const canonicalInvoices = invoiceVerification
  .map((verification) => {
    const invoice = invoiceById.get(verification.invoice_id);
    return invoice ? { invoice, verification } : null;
  })
  .filter(Boolean)
  .filter(
    ({ invoice }) =>
      invoice.document_type === "invoice" &&
      !excludedInvoiceStatuses.has(invoice.match_status),
  );

const openInvoices = canonicalInvoices
  .filter(({ verification }) => cents(verification.amount_remaining) > 0)
  .map(({ invoice, verification }) => ({
    invoice_id: invoice.id,
    contractor_id: verification.contractor_id ?? invoice.contractor_id,
    supplier_name: verification.supplier_name ?? invoice.supplier_name,
    invoice_number: verification.invoice_number ?? invoice.invoice_number,
    invoice_date: verification.invoice_date ?? invoice.invoice_date,
    source_date: invoice.source_date,
    invoice_amount: money(verification.invoice_amount),
    paid_amount: money(verification.paid_amount),
    amount_remaining: money(verification.amount_remaining),
    payment_status: verification.payment_status,
    verification_status: verification.verification_status,
    match_status: invoice.match_status,
    original_filename: invoice.original_filename,
    text_excerpt: invoice.text_excerpt,
  }))
  .sort(
    (left, right) =>
      (left.invoice_date ?? left.source_date ?? "").localeCompare(
        right.invoice_date ?? right.source_date ?? "",
      ) ||
      left.supplier_name.localeCompare(right.supplier_name, "en-CA") ||
      left.invoice_number.localeCompare(right.invoice_number, "en-CA"),
  );

const residualPayments = transactions
  .filter((transaction) => {
    const sourceData = sourceObject(transaction.source_data);
    const cancelledTransfer = sourceObject(sourceData.cancelled_e_transfer);
    return (
      transaction.is_transfer !== true &&
      cancelledTransfer.status !== "cancelled"
    );
  })
  .map((transaction) => {
    const verification = paymentVerificationById.get(transaction.id);
    const paymentRecord = paymentRecordById.get(transaction.id);
    const sourceData = sourceObject(transaction.source_data);
    const confirmedOverpayment = sourceObject(sourceData.confirmed_overpayment);
    const reconciliationResearch = sourceObject(
      sourceData.reconciliation_research,
    );
    return {
      financial_transaction_id: transaction.id,
      contractor_id:
        verification?.contractor_id ?? paymentRecord?.contractor_id ?? null,
      posted_on: transaction.posted_on,
      transaction_on: transaction.transaction_on,
      counterparty: transaction.counterparty,
      description: transaction.description,
      payment_amount: money(
        verification?.payment_amount ?? Math.abs(transaction.amount),
      ),
      invoice_allocated_amount: money(
        verification?.invoice_allocated_amount ?? 0,
      ),
      bonus_allocated_amount: money(verification?.bonus_allocated_amount ?? 0),
      other_allocated_amount: money(verification?.other_allocated_amount ?? 0),
      total_allocated_amount: money(verification?.total_allocated_amount ?? 0),
      unallocated_amount: money(
        verification?.unallocated_amount ?? Math.abs(transaction.amount),
      ),
      payment_status: verification?.payment_status ?? "missing_record",
      recipient_status: paymentRecord?.recipient_status ?? "missing_record",
      review_status: transaction.review_status,
      account_name: transaction.financial_accounts?.name ?? null,
      account_last_four: transaction.financial_accounts?.last_four ?? null,
      source_filename: transaction.financial_imports?.original_filename ?? null,
      source_kind: transaction.financial_imports?.source_kind ?? null,
      confirmed_overpayment:
        confirmedOverpayment.status === "confirmed"
          ? {
              status: "confirmed",
              amount: money(confirmedOverpayment.amount),
              reason: confirmedOverpayment.reason ?? transaction.notes,
            }
          : null,
      invoice_evidence_status:
        reconciliationResearch.status === "no_invoice_provided" ||
        reconciliationResearch.status === "invoice_not_found"
          ? reconciliationResearch.status
          : null,
      transaction_notes: transaction.notes,
      confirmation_method: paymentRecord?.confirmation_method ?? null,
      confirmation_note: paymentRecord?.confirmation_note ?? null,
      bank_evidence:
        sourceData.easyweb_e_transfer_evidence ??
        sourceData.td_interac_email_evidence ??
        null,
    };
  })
  .filter(
    (payment) =>
      payment.payment_status !== "fully_allocated" ||
      payment.recipient_status !== "confirmed",
  )
  .sort(
    (left, right) =>
      left.posted_on.localeCompare(right.posted_on) ||
      left.payment_amount - right.payment_amount,
  );

function groupKey(contractorId, fallback) {
  return contractorId ?? `unidentified:${fallback || "Unknown"}`;
}

const groups = new Map();
function ensureGroup(contractorId, fallback) {
  const key = groupKey(contractorId, fallback);
  let group = groups.get(key);
  if (!group) {
    const contractor = contractorId ? contractorById.get(contractorId) : null;
    group = {
      contractor_id: contractorId,
      contractor_name: contractor?.supplier_name ?? fallback ?? "Unknown",
      worker_user_id: contractor?.worker_user_id ?? null,
      open_invoices: [],
      residual_payments: [],
    };
    groups.set(key, group);
  }
  return group;
}

for (const invoice of openInvoices) {
  ensureGroup(invoice.contractor_id, invoice.supplier_name).open_invoices.push(
    invoice,
  );
}
for (const payment of residualPayments) {
  ensureGroup(
    payment.contractor_id,
    payment.counterparty,
  ).residual_payments.push(payment);
}

const contractorResiduals = [...groups.values()]
  .map((group) => ({
    ...group,
    totals: {
      open_invoice_amount: money(
        group.open_invoices.reduce(
          (total, invoice) => total + invoice.amount_remaining,
          0,
        ),
      ),
      unallocated_payment_amount: money(
        group.residual_payments.reduce(
          (total, payment) => total + payment.unallocated_amount,
          0,
        ),
      ),
      confirmed_overpayment_amount: money(
        group.residual_payments.reduce(
          (total, payment) =>
            total + Number(payment.confirmed_overpayment?.amount ?? 0),
          0,
        ),
      ),
      documented_no_invoice_amount: money(
        group.residual_payments.reduce(
          (total, payment) =>
            total +
            (payment.invoice_evidence_status === "no_invoice_provided"
              ? payment.unallocated_amount
              : 0),
          0,
        ),
      ),
      invoice_not_found_amount: money(
        group.residual_payments.reduce(
          (total, payment) =>
            total +
            (payment.invoice_evidence_status === "invoice_not_found"
              ? payment.unallocated_amount
              : 0),
          0,
        ),
      ),
    },
  }))
  .sort(
    (left, right) =>
      Math.max(
        right.totals.open_invoice_amount,
        right.totals.unallocated_payment_amount,
      ) -
        Math.max(
          left.totals.open_invoice_amount,
          left.totals.unallocated_payment_amount,
        ) || left.contractor_name.localeCompare(right.contractor_name, "en-CA"),
  );

const invoiceStatusCounts = Object.values(
  invoices.reduce((counts, invoice) => {
    const key = `${invoice.document_type}\u0000${invoice.match_status}`;
    const current = counts[key] ?? {
      document_type: invoice.document_type,
      match_status: invoice.match_status,
      count: 0,
    };
    current.count += 1;
    counts[key] = current;
    return counts;
  }, {}),
).sort(
  (left, right) =>
    left.document_type.localeCompare(right.document_type, "en-CA") ||
    String(left.match_status).localeCompare(
      String(right.match_status),
      "en-CA",
    ),
);

console.log(
  JSON.stringify(
    {
      mode: "read-only",
      project_ref: projectRef,
      audited_at: new Date().toISOString(),
      scope: {
        subcontractor_bank_transactions: transactions.length,
        canonical_invoices: canonicalInvoices.length,
        active_contractors: contractors.length,
      },
      residual_summary: {
        contractors: contractorResiduals.length,
        open_invoices: openInvoices.length,
        open_invoice_amount: money(
          openInvoices.reduce(
            (total, invoice) => total + invoice.amount_remaining,
            0,
          ),
        ),
        residual_payments: residualPayments.length,
        unallocated_payment_amount: money(
          residualPayments.reduce(
            (total, payment) => total + payment.unallocated_amount,
            0,
          ),
        ),
        documented_no_invoice_payments: residualPayments.filter(
          (payment) =>
            payment.invoice_evidence_status === "no_invoice_provided",
        ).length,
        documented_no_invoice_amount: money(
          residualPayments.reduce(
            (total, payment) =>
              total +
              (payment.invoice_evidence_status === "no_invoice_provided"
                ? payment.unallocated_amount
                : 0),
            0,
          ),
        ),
        invoice_not_found_payments: residualPayments.filter(
          (payment) =>
            payment.invoice_evidence_status === "invoice_not_found",
        ).length,
        invoice_not_found_amount: money(
          residualPayments.reduce(
            (total, payment) =>
              total +
              (payment.invoice_evidence_status === "invoice_not_found"
                ? payment.unallocated_amount
                : 0),
            0,
          ),
        ),
        unresolved_unallocated_amount: money(
          residualPayments.reduce(
            (total, payment) =>
              total +
              (payment.invoice_evidence_status === "no_invoice_provided" ||
              payment.invoice_evidence_status === "invoice_not_found"
                ? 0
                : payment.unallocated_amount),
            0,
          ),
        ),
        confirmed_overpayment_amount: money(
          residualPayments.reduce(
            (total, payment) =>
              total + Number(payment.confirmed_overpayment?.amount ?? 0),
            0,
          ),
        ),
      },
      invoice_status_counts: invoiceStatusCounts,
      contractor_residuals: contractorResiduals,
    },
    null,
    2,
  ),
);
