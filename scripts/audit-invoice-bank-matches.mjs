#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { buildInvoiceBankMatchReport } from "../src/lib/invoice-bank-matcher.ts";

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

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function addAmount(totals, key, amount) {
  totals.set(key, money((totals.get(key) ?? 0) + numberValue(amount)));
}

function sourceEvidence(sourceData) {
  const evidence = sourceData?.easyweb_e_transfer_evidence;
  return {
    recipientName:
      typeof evidence?.recipient_name === "string"
        ? evidence.recipient_name
        : null,
    recipientEmail:
      typeof evidence?.recipient_email === "string"
        ? evidence.recipient_email
        : null,
    confirmationSuffix:
      typeof evidence?.confirmation_suffix === "string"
        ? evidence.confirmation_suffix
        : null,
  };
}

function compareVersions(left, right) {
  const leftDate = left.source_date ?? left.invoice_date ?? "";
  const rightDate = right.source_date ?? right.invoice_date ?? "";
  return (
    leftDate.localeCompare(rightDate) ||
    numberValue(left.amount_paid) - numberValue(right.amount_paid) ||
    left.original_filename.localeCompare(right.original_filename, "en-CA")
  );
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
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
if (projectRef !== "bwbckdkouqghdadpkjvn") {
  throw new Error(`Refusing audit for unexpected project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchPaymentRows() {
  const rows = [];
  const pageSize = 1000;
  for (let page = 0; page < 20; page += 1) {
    const from = page * pageSize;
    const result = await db
      .from("financial_transactions")
      .select(
        "id,posted_on,amount,currency,description,counterparty,category,source_data,financial_accounts(name,last_four),financial_imports(original_filename)",
      )
      .eq("transaction_type", "expense")
      .eq("is_transfer", false)
      .lt("amount", 0)
      .order("posted_on", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Payment audit exceeded the 20,000-row read limit.");
}

const [
  invoiceResult,
  paymentRows,
  recordResult,
  invoiceAllocationResult,
  bonusAllocationResult,
  otherAllocationResult,
] = await Promise.all([
  db
    .from("labour_invoices")
    .select(
      "id,contractor_id,supplier_name,invoice_number,invoice_date,source_date,currency,amount_paid,amount_before_tax,tax_amount,original_filename,duplicate_group_id",
    )
    .eq("document_type", "invoice")
    .order("invoice_date", { ascending: true, nullsFirst: true })
    .limit(1000),
  fetchPaymentRows(),
  db
    .from("labour_payment_records")
    .select(
      "financial_transaction_id,contractor_id,recipient_status,confirmation_method,confirmation_note,confirmed_at,labour_contractors(supplier_name)",
    ),
  db
    .from("labour_payment_allocations")
    .select("financial_transaction_id,invoice_id,allocated_amount")
    .is("reversed_at", null),
  db
    .from("labour_bonus_payment_allocations")
    .select("financial_transaction_id,allocated_amount")
    .is("reversed_at", null),
  db
    .from("labour_payment_other_allocations")
    .select("financial_transaction_id,allocated_amount")
    .is("reversed_at", null),
]);

for (const result of [
  invoiceResult,
  recordResult,
  invoiceAllocationResult,
  bonusAllocationResult,
  otherAllocationResult,
]) {
  if (result.error) throw result.error;
}

const invoiceRows = invoiceResult.data ?? [];
const invoiceGroupById = new Map();
const invoiceGroups = new Map();
for (const invoice of invoiceRows) {
  const groupId = invoice.duplicate_group_id ?? invoice.id;
  invoiceGroupById.set(invoice.id, groupId);
  invoiceGroups.set(groupId, [...(invoiceGroups.get(groupId) ?? []), invoice]);
}

const allocatedByInvoiceGroup = new Map();
const allocatedByPayment = new Map();
for (const allocation of invoiceAllocationResult.data ?? []) {
  const groupId = invoiceGroupById.get(allocation.invoice_id);
  if (groupId) {
    addAmount(allocatedByInvoiceGroup, groupId, allocation.allocated_amount);
  }
  addAmount(
    allocatedByPayment,
    allocation.financial_transaction_id,
    allocation.allocated_amount,
  );
}
for (const allocation of [
  ...(bonusAllocationResult.data ?? []),
  ...(otherAllocationResult.data ?? []),
]) {
  addAmount(
    allocatedByPayment,
    allocation.financial_transaction_id,
    allocation.allocated_amount,
  );
}

const invoices = [...invoiceGroups.entries()].map(([groupId, versions]) => {
  const selected = [...versions].sort(compareVersions).at(-1);
  const grossAmount = money(
    selected.amount_paid ??
      numberValue(selected.amount_before_tax) + numberValue(selected.tax_amount),
  );
  const allocatedAmount = money(allocatedByInvoiceGroup.get(groupId) ?? 0);
  return {
    id: selected.id,
    contractorId: selected.contractor_id,
    supplierName: selected.supplier_name,
    invoiceNumber: selected.invoice_number,
    invoiceDate: selected.invoice_date ?? selected.source_date ?? "1900-01-01",
    sourceDate: selected.source_date,
    currency: selected.currency || "CAD",
    grossAmount,
    allocatedAmount,
    remainingAmount: money(Math.max(0, grossAmount - allocatedAmount)),
    originalFilename: selected.original_filename,
    duplicateVersionCount: versions.length,
  };
});

const recordByPayment = new Map(
  (recordResult.data ?? []).map((record) => [
    record.financial_transaction_id,
    record,
  ]),
);
const payments = paymentRows
  .filter(
    (payment) =>
      payment.category === "Subcontractors" ||
      recordByPayment.has(payment.id),
  )
  .map((payment) => {
    const record = recordByPayment.get(payment.id);
    const evidence = sourceEvidence(payment.source_data);
    const paymentAmount = money(Math.abs(numberValue(payment.amount)));
    const allocatedAmount = money(allocatedByPayment.get(payment.id) ?? 0);
    return {
      id: payment.id,
      contractorId: record?.contractor_id ?? null,
      supplierName:
        record?.labour_contractors?.supplier_name ??
        evidence.recipientName ??
        payment.counterparty,
      recipientStatus:
        record?.recipient_status === "confirmed" ? "confirmed" : "unknown",
      confirmationMethod: record?.confirmation_method ?? null,
      confirmationNote: record?.confirmation_note ?? null,
      confirmedAt: record?.confirmed_at ?? null,
      postedOn: payment.posted_on,
      currency: payment.currency || "CAD",
      paymentAmount,
      allocatedAmount,
      availableAmount: money(Math.max(0, paymentAmount - allocatedAmount)),
      description: payment.description,
      counterparty: payment.counterparty,
      category: payment.category,
      accountName: payment.financial_accounts?.name ?? "Unknown account",
      accountLastFour: payment.financial_accounts?.last_four ?? null,
      sourceFilename:
        payment.financial_imports?.original_filename ?? "Unknown bank import",
      recipientName: evidence.recipientName,
      recipientEmail: evidence.recipientEmail,
      confirmationSuffix: evidence.confirmationSuffix,
    };
  });

const report = buildInvoiceBankMatchReport({
  invoices,
  payments,
  metadata: {
    sourceInvoiceFiles: invoiceRows.length,
    duplicateVersionsExcluded: invoiceRows.length - invoices.length,
    invoicesAlreadyAllocated: invoices.filter(
      (invoice) => invoice.allocatedAmount > 0.005,
    ).length,
    paymentsAlreadyAllocated: payments.filter(
      (payment) => payment.allocatedAmount > 0.005,
    ).length,
  },
});

console.log(
  JSON.stringify(
    {
      projectRef,
      generatedAt: report.generatedAt,
      stats: report.stats,
      proposals: report.proposals.map((proposal) => ({
        id: proposal.id,
        queue: proposal.queue,
        kind: proposal.kind,
        confidence: proposal.confidence,
        supplier: proposal.supplierName,
        invoiceNumbers: proposal.invoices.map(
          (invoice) => invoice.invoiceNumber,
        ),
        paymentDates: proposal.payments.map((payment) => payment.postedOn),
        invoiceAmount: proposal.invoiceAmount,
        paymentAmount: proposal.paymentAmount,
        difference: proposal.difference,
      })),
      unmatchedReasons: Object.fromEntries(
        [...Map.groupBy(report.unmatched, (item) => item.reason).entries()]
          .map(([reason, items]) => [reason, items.length])
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
      invariants: {
        everyCanonicalInvoiceRepresented:
          report.stats.outstandingInvoices ===
          report.stats.readyToConfirm +
            report.proposals
              .filter(
                (proposal) =>
                  proposal.queue !== "ready_to_confirm" &&
                  proposal.queue !== "recipient_confirmation",
              )
              .reduce(
                (total, proposal) => total + proposal.invoices.length,
                0,
              ) +
            report.proposals
              .filter(
                (proposal) =>
                  proposal.queue === "recipient_confirmation",
              )
              .reduce(
                (total, proposal) => total + proposal.invoices.length,
                0,
              ) +
            report.stats.unmatchedInvoices,
        noProposalReusesInvoice:
          new Set(
            report.proposals.flatMap((proposal) =>
              proposal.invoices.map((invoice) => invoice.id),
            ),
          ).size ===
          report.proposals.reduce(
            (total, proposal) => total + proposal.invoices.length,
            0,
          ),
        noProposalReusesPayment:
          new Set(
            report.proposals.flatMap((proposal) =>
              proposal.payments.map((payment) => payment.id),
            ),
          ).size ===
          report.proposals.reduce(
            (total, proposal) => total + proposal.payments.length,
            0,
          ),
      },
    },
    null,
    2,
  ),
);
