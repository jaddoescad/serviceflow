#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const apply = process.argv.includes("--apply");

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
          line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
}

function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function dollars(value) {
  return Math.round(value) / 100;
}

function monthOf(value) {
  return String(value ?? "").slice(0, 7);
}

function datePlusDays(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function exactSubset(rows, target) {
  const totals = new Map([[0, []]]);
  rows.forEach((row, index) => {
    const amount = Math.abs(cents(row.amount));
    for (const [sum, indexes] of [...totals.entries()].sort((left, right) => right[0] - left[0])) {
      const next = sum + amount;
      if (next > target || totals.has(next)) continue;
      totals.set(next, [...indexes, index]);
    }
  });
  return (totals.get(target) ?? []).map((index) => rows[index]);
}

function sherwinText(transaction) {
  return [
    transaction.counterparty,
    transaction.description,
    transaction.source_data?.merchant_name,
    transaction.source_data?.raw_description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await queryFactory().range(page * pageSize, page * pageSize + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Pagination exceeded 100,000 rows.");
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF) {
  throw new Error("Refusing reconciliation for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [documents, invoices, transactions, paymentAllocations, creditAllocations] =
  await Promise.all([
    fetchAll(() =>
      db
        .from("material_invoice_documents")
        .select("id,document_date,original_filename,source_reference,source_payload")
        .eq("source_system", "gmail_sherwin_monthly_statement")
        .order("document_date"),
    ),
    fetchAll(() =>
      db
        .from("material_invoices")
        .select(
          "id,document_id,source_system,invoice_number,invoice_date,invoice_time,invoice_type,total_amount,supplier_name",
        )
        .eq("supplier_name", "Sherwin-Williams Canada")
        .order("invoice_date")
        .order("invoice_time"),
    ),
    fetchAll(() =>
      db
        .from("financial_transactions")
        .select(
          "id,posted_on,description,counterparty,amount,currency,transaction_type,category,is_transfer,source_data",
        )
        .eq("transaction_type", "expense")
        .eq("is_transfer", false)
        .lt("amount", 0)
        .order("posted_on")
        .order("id"),
    ),
    fetchAll(() =>
      db
        .from("material_payment_allocations")
        .select("financial_transaction_id,material_invoice_id,allocated_amount")
        .is("reversed_at", null),
    ),
    fetchAll(() =>
      db
        .from("material_credit_allocations")
        .select("credit_material_invoice_id,charge_material_invoice_id,allocated_amount")
        .is("reversed_at", null),
    ),
  ]);

const statements = documents
  .map((document) => ({
    ...document,
    asOf: document.source_payload?.statement_as_of ?? document.document_date,
    charges: cents(document.source_payload?.current_month_charges),
    payments: cents(document.source_payload?.current_month_payments),
    storeCredits: cents(document.source_payload?.current_month_store_credits),
    otherCredits: cents(document.source_payload?.current_month_other_credits),
  }))
  .sort((left, right) => left.asOf.localeCompare(right.asOf));

const bankPayments = transactions.filter(
  (transaction) =>
    transaction.currency === "CAD" &&
    /sherwin/.test(sherwinText(transaction)),
);

// Monthly Sherwin statements cover purchases charged to the account. A store
// cash/card receipt is a separate settlement chain and must not inflate either
// the statement's monthly charges or the FIFO balance paid by the statement.
const accountInvoices = invoices.filter(
  (invoice) => invoice.source_system === "sherwin_daily_email",
);

const monthlyInvoiceTotals = new Map();
for (const invoice of accountInvoices) {
  const month = monthOf(invoice.invoice_date);
  const current = monthlyInvoiceTotals.get(month) ?? { charges: 0, credits: 0, count: 0 };
  const amount = cents(invoice.total_amount);
  if (amount >= 0) current.charges += amount;
  else current.credits += Math.abs(amount);
  current.count += 1;
  monthlyInvoiceTotals.set(month, current);
}

const monthlyAudit = statements.map((statement) => {
  const invoiceTotals = monthlyInvoiceTotals.get(monthOf(statement.asOf)) ?? {
    charges: 0,
    credits: 0,
    count: 0,
  };
  const statementCredits = statement.storeCredits + statement.otherCredits;
  return {
    statement: statement.asOf,
    invoice_count: invoiceTotals.count,
    statement_charges: dollars(statement.charges),
    invoice_charges: dollars(invoiceTotals.charges),
    charge_difference: dollars(invoiceTotals.charges - statement.charges),
    statement_credits: dollars(statementCredits),
    invoice_credits: dollars(invoiceTotals.credits),
    credit_difference: dollars(invoiceTotals.credits - statementCredits),
    statement_payments: dollars(statement.payments),
  };
});

const bankGroups = [];
const assignedBankIds = new Set();
let previousStatementDate = statements.length
  ? datePlusDays(`${statements[0].asOf.slice(0, 7)}-01`, -1)
  : "0001-01-01";
for (const statement of statements.filter((row) => row.payments > 0)) {
  const candidates = bankPayments.filter(
    (payment) =>
      !assignedBankIds.has(payment.id) &&
      payment.posted_on > previousStatementDate &&
      payment.posted_on <= datePlusDays(statement.asOf, 2),
  );
  const rows = exactSubset(candidates, statement.payments);
  const total = rows.reduce((sum, row) => sum + Math.abs(cents(row.amount)), 0);
  rows.forEach((row) => assignedBankIds.add(row.id));
  bankGroups.push({
    statement,
    rows,
    total,
    matches: total === statement.payments,
  });
  previousStatementDate = statement.asOf;
}

const statementErrors = monthlyAudit.filter(
  (row) => Math.abs(cents(row.charge_difference)) > 2 || Math.abs(cents(row.credit_difference)) > 2,
);
const paymentGroupErrors = bankGroups.filter((group) => !group.matches);

const paidByInvoice = new Map();
const allocatedByTransaction = new Map();
for (const allocation of paymentAllocations) {
  const amount = cents(allocation.allocated_amount);
  paidByInvoice.set(
    allocation.material_invoice_id,
    (paidByInvoice.get(allocation.material_invoice_id) ?? 0) + amount,
  );
  allocatedByTransaction.set(
    allocation.financial_transaction_id,
    (allocatedByTransaction.get(allocation.financial_transaction_id) ?? 0) + amount,
  );
}
const creditedToCharge = new Map();
const usedByCredit = new Map();
for (const allocation of creditAllocations) {
  const amount = cents(allocation.allocated_amount);
  creditedToCharge.set(
    allocation.charge_material_invoice_id,
    (creditedToCharge.get(allocation.charge_material_invoice_id) ?? 0) + amount,
  );
  usedByCredit.set(
    allocation.credit_material_invoice_id,
    (usedByCredit.get(allocation.credit_material_invoice_id) ?? 0) + amount,
  );
}

const chargeBalances = accountInvoices
  .filter((invoice) => cents(invoice.total_amount) > 0)
  .map((invoice) => ({
    invoice,
    remaining:
      cents(invoice.total_amount) -
      (paidByInvoice.get(invoice.id) ?? 0) -
      (creditedToCharge.get(invoice.id) ?? 0),
  }));

function allocateToOpenCharges(amount, effectiveDate, allocationFactory) {
  let remaining = amount;
  const allocations = [];
  for (const charge of chargeBalances) {
    if (remaining <= 0) break;
    if (charge.remaining <= 0 || charge.invoice.invoice_date > effectiveDate) continue;
    const allocated = Math.min(remaining, charge.remaining);
    allocations.push(allocationFactory(charge.invoice, allocated));
    charge.remaining -= allocated;
    remaining -= allocated;
  }
  return { allocations, remaining };
}

const settlementEvents = [];
for (const credit of accountInvoices.filter((invoice) => cents(invoice.total_amount) < 0)) {
  const residual = Math.abs(cents(credit.total_amount)) - (usedByCredit.get(credit.id) ?? 0);
  if (residual > 0) settlementEvents.push({ type: "credit", date: credit.invoice_date, credit, residual });
}
for (const group of bankGroups) {
  for (const payment of group.rows) {
    const residual = Math.abs(cents(payment.amount)) - (allocatedByTransaction.get(payment.id) ?? 0);
    if (residual > 0) {
      settlementEvents.push({
        type: "payment",
        date: group.statement.asOf,
        orderKey: payment.posted_on,
        payment,
        group,
        residual,
      });
    }
  }
}
settlementEvents.sort(
  (left, right) =>
    left.date.localeCompare(right.date) ||
    (left.type === right.type ? (left.orderKey ?? "").localeCompare(right.orderKey ?? "") : left.type === "credit" ? -1 : 1),
);

const plannedCredits = [];
const plannedPayments = [];
for (const event of settlementEvents) {
  if (event.type === "credit") {
    const result = allocateToOpenCharges(
      event.residual,
      event.date,
      (charge, amount) => ({
        credit_material_invoice_id: event.credit.id,
        charge_material_invoice_id: charge.id,
        allocated_amount: dollars(amount),
        allocation_method: "statement_fifo",
        evidence_reference: `Sherwin daily invoice credit ${event.credit.invoice_number}`,
        source_payload: {
          supplier: "Sherwin-Williams Canada",
          rule: "FIFO supplier credit against prior open charge",
          credit_invoice_number: event.credit.invoice_number,
          charge_invoice_number: charge.invoice_number,
        },
      }),
    );
    plannedCredits.push(...result.allocations);
    if (result.remaining > 0) {
      throw new Error(
        `Credit ${event.credit.invoice_number} has ${dollars(result.remaining).toFixed(2)} ` +
          "with no prior open charge.",
      );
    }
    continue;
  }

  const result = allocateToOpenCharges(
    event.residual,
    event.date,
    (invoice, amount) => ({
        financial_transaction_id: event.payment.id,
        material_invoice_id: invoice.id,
        allocated_amount: dollars(amount),
        allocation_method: "statement_exact",
        evidence_reference: `${event.group.statement.original_filename} · payments ${dollars(event.group.total).toFixed(2)}`,
        confidence: 1,
        needs_review: false,
        source_payload: {
          supplier: "Sherwin-Williams Canada",
          statement_document_id: event.group.statement.id,
          statement_as_of: event.group.statement.asOf,
          statement_payment_total: dollars(event.group.statement.payments),
          bank_payment_date: event.payment.posted_on,
          rule: "Statement-total-verified monthly FIFO allocation",
        },
    }),
  );
  plannedPayments.push(...result.allocations);
  if (result.remaining > 0) {
    throw new Error(
      `Bank payment ${event.payment.posted_on} ` +
        `${dollars(Math.abs(cents(event.payment.amount))).toFixed(2)} has ` +
        `${dollars(result.remaining).toFixed(2)} with no open invoice on or before that date.`,
    );
  }
}

const report = {
  mode: apply ? "apply" : "dry-run",
  evidence: {
    statements: statements.length,
    invoices: invoices.length,
    statement_account_invoices: accountInvoices.length,
    direct_store_receipts_excluded: invoices.length - accountInvoices.length,
    sherwin_bank_payments: bankPayments.length,
  },
  monthly_audit: monthlyAudit,
  payment_groups: bankGroups.map((group) => ({
    statement: group.statement.asOf,
    statement_total: dollars(group.statement.payments),
    bank_total: dollars(group.total),
    matches: group.matches,
    bank_rows: group.rows.map((row) => ({ date: row.posted_on, amount: dollars(Math.abs(cents(row.amount))) })),
  })),
  ungrouped_bank_rows: bankPayments.filter((row) => !assignedBankIds.has(row.id)).map((row) => ({
    id: row.id,
    date: row.posted_on,
    amount: dollars(Math.abs(cents(row.amount))),
    description: row.description,
    counterparty: row.counterparty,
    invoice_amount_candidates: invoices
      .filter(
        (invoice) =>
          cents(invoice.total_amount) > 0 &&
          cents(invoice.total_amount) === Math.abs(cents(row.amount)) &&
          Math.abs(
            (new Date(`${invoice.invoice_date}T12:00:00Z`) -
              new Date(`${row.posted_on}T12:00:00Z`)) /
              86_400_000,
          ) <= 14,
      )
      .map((invoice) => ({
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date,
      })),
  })),
  planned_credit_allocations: plannedCredits.length,
  planned_credit_total: dollars(plannedCredits.reduce((sum, row) => sum + cents(row.allocated_amount), 0)),
  planned_payment_allocations: plannedPayments.length,
  planned_payment_total: dollars(plannedPayments.reduce((sum, row) => sum + cents(row.allocated_amount), 0)),
  inserted_credit_allocations: 0,
  inserted_payment_allocations: 0,
};

if (statementErrors.length || paymentGroupErrors.length) {
  console.log(JSON.stringify(report, null, 2));
  throw new Error(
    `Refusing reconciliation: ${statementErrors.length} statement invoice mismatch(es), ` +
      `${paymentGroupErrors.length} statement payment mismatch(es).`,
  );
}

if (apply) {
  if (plannedCredits.length) {
    const inserted = await db.from("material_credit_allocations").insert(plannedCredits);
    if (inserted.error) throw inserted.error;
    report.inserted_credit_allocations = plannedCredits.length;
  }
  if (plannedPayments.length) {
    const inserted = await db.from("material_payment_allocations").insert(plannedPayments);
    if (inserted.error) throw inserted.error;
    report.inserted_payment_allocations = plannedPayments.length;
  }
}

console.log(JSON.stringify(report, null, 2));
