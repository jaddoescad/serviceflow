#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const apply = process.argv.includes("--apply");

// Evidence transcribed from the authenticated Sherwin-Williams PRO+ account on
// 2026-08-01. The payment date is the supplier-account date; TD posts the debit
// on the following business day.
const PORTAL_PAYMENTS = [
  {
    portalDate: "2026-07-06",
    bankDate: "2026-07-07",
    amount: 1234.05,
    reference: "04940",
    checkNumber: "613134297",
    invoiceStart: "2026-06-29",
    invoiceEnd: "2026-07-04",
  },
  {
    portalDate: "2026-07-13",
    bankDate: "2026-07-14",
    amount: 1552.49,
    reference: "08560",
    checkNumber: "613877760",
    invoiceStart: "2026-07-06",
    invoiceEnd: "2026-07-11",
  },
  {
    portalDate: "2026-07-20",
    bankDate: "2026-07-21",
    amount: 1619.48,
    reference: "13040",
    checkNumber: "614634099",
    invoiceStart: "2026-07-13",
    invoiceEnd: "2026-07-17",
  },
  {
    portalDate: "2026-07-27",
    bankDate: "2026-07-28",
    amount: 1102.32,
    reference: "16900",
    checkNumber: "615401035",
    invoiceStart: "2026-07-20",
    invoiceEnd: "2026-07-24",
  },
];

const EXCHANGE_CREDIT = {
  creditInvoiceNumber: "3906-9",
  chargeInvoiceNumber: "3905-1",
  amount: 6.21,
};

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

const [invoices, transactions, paymentAllocations, creditAllocations] = await Promise.all([
  fetchAll(() =>
    db
      .from("material_invoices")
      .select(
        "id,invoice_number,invoice_date,invoice_time,invoice_type,po_number,total_amount,source_system,supplier_name",
      )
      .eq("supplier_name", "Sherwin-Williams Canada")
      .eq("source_system", "sherwin_daily_email")
      .gte("invoice_date", "2026-06-29")
      .lte("invoice_date", "2026-07-24")
      .order("invoice_date")
      .order("invoice_time")
      .order("id"),
  ),
  fetchAll(() =>
    db
      .from("financial_transactions")
      .select(
        "id,posted_on,description,counterparty,amount,currency,transaction_type,is_transfer,source_data",
      )
      .gte("posted_on", "2026-07-01")
      .lte("posted_on", "2026-07-31")
      .eq("transaction_type", "expense")
      .eq("is_transfer", false)
      .lt("amount", 0)
      .order("posted_on")
      .order("id"),
  ),
  fetchAll(() =>
    db
      .from("material_payment_allocations")
      .select(
        "id,financial_transaction_id,material_invoice_id,allocated_amount,evidence_reference,source_payload",
      )
      .is("reversed_at", null),
  ),
  fetchAll(() =>
    db
      .from("material_credit_allocations")
      .select(
        "id,credit_material_invoice_id,charge_material_invoice_id,allocated_amount,evidence_reference,source_payload",
      )
      .is("reversed_at", null),
  ),
]);

const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
const invoiceByNumber = new Map(invoices.map((invoice) => [invoice.invoice_number, invoice]));
const sherwinTransactions = transactions.filter(
  (transaction) => transaction.currency === "CAD" && /sherwin/.test(sherwinText(transaction)),
);

const creditInvoice = invoiceByNumber.get(EXCHANGE_CREDIT.creditInvoiceNumber);
const chargeInvoice = invoiceByNumber.get(EXCHANGE_CREDIT.chargeInvoiceNumber);
if (!creditInvoice || !chargeInvoice) {
  throw new Error("The verified Sherwin exchange invoices are missing.");
}
if (cents(creditInvoice.total_amount) !== -cents(EXCHANGE_CREDIT.amount)) {
  throw new Error("The Sherwin exchange credit amount no longer matches its source invoice.");
}

const existingExchangeAllocations = creditAllocations.filter(
  (allocation) => allocation.credit_material_invoice_id === creditInvoice.id,
);
if (existingExchangeAllocations.length !== 1) {
  throw new Error(
    `Expected one active allocation for credit ${creditInvoice.invoice_number}; found ${existingExchangeAllocations.length}.`,
  );
}
const existingExchange = existingExchangeAllocations[0];
if (cents(existingExchange.allocated_amount) !== cents(EXCHANGE_CREDIT.amount)) {
  throw new Error("The active Sherwin exchange-credit allocation has an unexpected amount.");
}

const exchangeAlreadyCorrect = existingExchange.charge_material_invoice_id === chargeInvoice.id;
const plannedCreditReversal = exchangeAlreadyCorrect
  ? null
  : {
      id: existingExchange.id,
      current_charge_invoice: invoiceById.get(existingExchange.charge_material_invoice_id)
        ?.invoice_number,
      replacement_charge_invoice: chargeInvoice.invoice_number,
      amount: EXCHANGE_CREDIT.amount,
      reason:
        "Source-document correction: invoice 3906-9 is the net product exchange immediately following invoice 3905-1, not a general FIFO credit.",
    };
const plannedCreditReplacement = exchangeAlreadyCorrect
  ? null
  : {
      credit_material_invoice_id: creditInvoice.id,
      charge_material_invoice_id: chargeInvoice.id,
      allocated_amount: EXCHANGE_CREDIT.amount,
      allocation_method: "manual",
      evidence_reference:
        "INVOICES-E_20260708100751.pdf · invoices 3905-1 and 3906-9 · one-minute product exchange",
      source_payload: {
        supplier: "Sherwin-Williams Canada",
        rule: "Source-document product-exchange match",
        observed_on: "2026-08-01",
        credit_invoice_number: creditInvoice.invoice_number,
        charge_invoice_number: chargeInvoice.invoice_number,
        returned_sales_number: "6514-25746",
        explanation:
          "Credit memo 3906-9 returns the product sold on invoice 3905-1 and substitutes another product; its net credit is 6.21.",
      },
    };

// Simulate the corrected exchange allocation before planning any payment rows.
const simulatedCredits = creditAllocations
  .filter((allocation) => allocation.id !== plannedCreditReversal?.id)
  .map((allocation) => ({ ...allocation }));
if (plannedCreditReplacement) simulatedCredits.push(plannedCreditReplacement);

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
const creditedByInvoice = new Map();
for (const allocation of simulatedCredits) {
  const amount = cents(allocation.allocated_amount);
  creditedByInvoice.set(
    allocation.charge_material_invoice_id,
    (creditedByInvoice.get(allocation.charge_material_invoice_id) ?? 0) + amount,
  );
}

const plannedPayments = [];
const paymentGroups = [];
for (const portalPayment of PORTAL_PAYMENTS) {
  const groupInvoices = invoices.filter(
    (invoice) =>
      invoice.invoice_date >= portalPayment.invoiceStart &&
      invoice.invoice_date <= portalPayment.invoiceEnd,
  );
  const chargeInvoices = groupInvoices.filter((invoice) => cents(invoice.total_amount) > 0);
  const creditInvoices = groupInvoices.filter((invoice) => cents(invoice.total_amount) < 0);
  const grossCharges = chargeInvoices.reduce(
    (sum, invoice) => sum + cents(invoice.total_amount),
    0,
  );
  const supplierCredits = creditInvoices.reduce(
    (sum, invoice) => sum + Math.abs(cents(invoice.total_amount)),
    0,
  );
  const netInvoices = grossCharges - supplierCredits;
  if (netInvoices !== cents(portalPayment.amount)) {
    throw new Error(
      `Portal payment ${portalPayment.portalDate} is ${portalPayment.amount.toFixed(2)}, ` +
        `but its invoice window nets to ${dollars(netInvoices).toFixed(2)}.`,
    );
  }

  const bankMatches = sherwinTransactions.filter(
    (transaction) =>
      transaction.posted_on === portalPayment.bankDate &&
      Math.abs(cents(transaction.amount)) === cents(portalPayment.amount),
  );
  if (bankMatches.length > 1) {
    throw new Error(
      `Multiple Sherwin bank rows match ${portalPayment.bankDate} ${portalPayment.amount.toFixed(2)}.`,
    );
  }

  const bankTransaction = bankMatches[0] ?? null;
  if (!bankTransaction) {
    paymentGroups.push({
      ...portalPayment,
      invoiceCount: groupInvoices.length,
      invoiceNumbers: groupInvoices.map((invoice) => invoice.invoice_number),
      invoiceNet: dollars(netInvoices),
      bankStatus: "awaiting_bank_import",
      plannedAllocationCount: 0,
      plannedAllocationTotal: 0,
    });
    continue;
  }

  const groupInvoiceIds = new Set(chargeInvoices.map((invoice) => invoice.id));
  const existingBankAllocations = paymentAllocations.filter(
    (allocation) => allocation.financial_transaction_id === bankTransaction.id,
  );
  const outsideGroup = existingBankAllocations.filter(
    (allocation) => !groupInvoiceIds.has(allocation.material_invoice_id),
  );
  if (outsideGroup.length) {
    throw new Error(
      `Sherwin bank row ${bankTransaction.id} already has allocations outside its verified invoice window.`,
    );
  }

  const bankRemaining =
    cents(portalPayment.amount) - (allocatedByTransaction.get(bankTransaction.id) ?? 0);
  const openCharges = chargeInvoices.map((invoice) => ({
    invoice,
    remaining:
      cents(invoice.total_amount) -
      (paidByInvoice.get(invoice.id) ?? 0) -
      (creditedByInvoice.get(invoice.id) ?? 0),
  }));
  if (openCharges.some((row) => row.remaining < -2)) {
    throw new Error(`An invoice in the ${portalPayment.portalDate} payment group is oversettled.`);
  }
  const openTotal = openCharges.reduce((sum, row) => sum + Math.max(0, row.remaining), 0);
  if (openTotal !== bankRemaining) {
    throw new Error(
      `Portal payment ${portalPayment.portalDate} has ${dollars(bankRemaining).toFixed(2)} ` +
        `unallocated, but its corrected invoice window has ${dollars(openTotal).toFixed(2)} open.`,
    );
  }

  const groupPlanned = [];
  for (const row of openCharges) {
    if (row.remaining <= 0) continue;
    groupPlanned.push({
      financial_transaction_id: bankTransaction.id,
      material_invoice_id: row.invoice.id,
      allocated_amount: dollars(row.remaining),
      allocation_method: "date_amount_exact",
      evidence_reference:
        `Sherwin PRO+ Payment History ${portalPayment.portalDate} · ref ${portalPayment.reference} · check ${portalPayment.checkNumber}`,
      confidence: 1,
      needs_review: false,
      source_payload: {
        supplier: "Sherwin-Williams Canada",
        evidence_system: "Sherwin-Williams PRO+ authenticated account",
        evidence_observed_on: "2026-08-01",
        account: "XXXX-X272-9 - OTTAWA PAINTERS",
        job_account: "1 - Ottawa Painters",
        portal_payment_date: portalPayment.portalDate,
        bank_posted_on: bankTransaction.posted_on,
        portal_reference: portalPayment.reference,
        portal_check_number: portalPayment.checkNumber,
        portal_payment_total: portalPayment.amount,
        invoice_window_start: portalPayment.invoiceStart,
        invoice_window_end: portalPayment.invoiceEnd,
        invoice_window_net: dollars(netInvoices),
        rule: "Authenticated portal payment total equals a non-overlapping supplier-invoice window exactly",
      },
    });
  }
  plannedPayments.push(...groupPlanned);
  paymentGroups.push({
    ...portalPayment,
    invoiceCount: groupInvoices.length,
    invoiceNumbers: groupInvoices.map((invoice) => invoice.invoice_number),
    invoiceNet: dollars(netInvoices),
    bankStatus: bankRemaining === 0 ? "already_allocated" : "exact_match",
    bankTransactionId: bankTransaction.id,
    alreadyAllocated: dollars(cents(portalPayment.amount) - bankRemaining),
    plannedAllocationCount: groupPlanned.length,
    plannedAllocationTotal: dollars(
      groupPlanned.reduce((sum, allocation) => sum + cents(allocation.allocated_amount), 0),
    ),
  });
}

const report = {
  mode: apply ? "apply" : "dry-run",
  evidence: {
    system: "Sherwin-Williams PRO+ authenticated account",
    observed_on: "2026-08-01",
    account: "XXXX-X272-9 - OTTAWA PAINTERS",
    job_account: "1 - Ottawa Painters",
    july_statement_available: false,
    proof:
      "Portal payment history plus exact, non-overlapping invoice-window totals; no July statement was posted as of the observation date.",
  },
  exchange_credit: {
    creditInvoice: creditInvoice.invoice_number,
    correctChargeInvoice: chargeInvoice.invoice_number,
    amount: EXCHANGE_CREDIT.amount,
    alreadyCorrect: exchangeAlreadyCorrect,
    plannedReversal: plannedCreditReversal,
    plannedReplacement: Boolean(plannedCreditReplacement),
  },
  payment_groups: paymentGroups,
  planned_payment_allocations: plannedPayments.length,
  planned_payment_total: dollars(
    plannedPayments.reduce((sum, allocation) => sum + cents(allocation.allocated_amount), 0),
  ),
  applied: {
    credit_reversals: 0,
    credit_replacements: 0,
    payment_allocations: 0,
  },
};

if (apply) {
  if (plannedCreditReversal) {
    const reversed = await db
      .from("material_credit_allocations")
      .update({
        reversed_at: new Date().toISOString(),
        reversal_reason: plannedCreditReversal.reason,
      })
      .eq("id", plannedCreditReversal.id)
      .is("reversed_at", null)
      .select("id");
    if (reversed.error) throw reversed.error;
    if (reversed.data?.length !== 1) {
      throw new Error("The incorrect exchange-credit allocation was not reversed exactly once.");
    }
    report.applied.credit_reversals = 1;
  }
  if (plannedCreditReplacement) {
    const inserted = await db
      .from("material_credit_allocations")
      .insert(plannedCreditReplacement)
      .select("id");
    if (inserted.error) throw inserted.error;
    if (inserted.data?.length !== 1) {
      throw new Error("The corrected exchange-credit allocation was not inserted exactly once.");
    }
    report.applied.credit_replacements = 1;
  }
  if (plannedPayments.length) {
    const inserted = await db
      .from("material_payment_allocations")
      .insert(plannedPayments)
      .select("id");
    if (inserted.error) throw inserted.error;
    if (inserted.data?.length !== plannedPayments.length) {
      throw new Error("Not all exact Sherwin payment allocations were inserted.");
    }
    report.applied.payment_allocations = plannedPayments.length;
  }
}

console.log(JSON.stringify(report, null, 2));
