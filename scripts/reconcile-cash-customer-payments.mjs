#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CONFIRMED_ON = "2026-08-02";
const CASH_ACCOUNT_SLUG = "cash-on-hand";
const EXPECTED = [
  {
    paymentNumber: "438824",
    invoiceNumber: "367905",
    customer: "Mariah Landers",
    amount: 1376.34,
    receivedOn: "2026-02-05",
  },
  {
    paymentNumber: "475691",
    invoiceNumber: "406864",
    customer: "Michelle Brunet",
    amount: 395.5,
    receivedOn: "2026-04-04",
  },
  {
    paymentNumber: "494865",
    invoiceNumber: "417073",
    customer: "Issa Daoud",
    amount: 1500.0,
    receivedOn: "2026-04-29",
  },
  {
    paymentNumber: "545243",
    invoiceNumber: "427406",
    customer: "Donna Quigley",
    amount: 4500.0,
    receivedOn: "2026-06-29",
  },
  {
    paymentNumber: "518319",
    invoiceNumber: "444663",
    customer: "René Bellavance",
    amount: 4000.0,
    receivedOn: "2026-05-28",
  },
  {
    paymentNumber: "542847",
    invoiceNumber: "447770",
    customer: "Mehaly Marinakis",
    amount: 1392.44,
    receivedOn: "2026-06-26",
  },
  {
    paymentNumber: "561039",
    invoiceNumber: "477956",
    customer: "Anjou Delplancke",
    amount: 1500.0,
    receivedOn: "2026-07-18",
  },
];

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

function money(value) {
  return Number(Number(value ?? 0).toFixed(2));
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertNoError(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
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
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
const apply = process.argv.includes("--apply");

if (!supabaseUrl || !serviceRoleKey)
  throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF) {
  throw new Error(
    "Refusing reconciliation for an unexpected Supabase project.",
  );
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const invoices = assertNoError(
  "customer invoices",
  await db
    .from("customer_invoices")
    .select(
      "id,invoice_number,customer_name,total_amount,source_paid_amount,currency,external_proposal_id",
    )
    .in(
      "invoice_number",
      EXPECTED.map((row) => row.invoiceNumber),
    ),
);
const invoiceByNumber = new Map(
  invoices.map((invoice) => [invoice.invoice_number, invoice]),
);
if (invoiceByNumber.size !== EXPECTED.length) {
  throw new Error(
    `Expected ${EXPECTED.length} customer invoices, found ${invoiceByNumber.size}.`,
  );
}

const events = assertNoError(
  "cash payment events",
  await db
    .from("customer_invoice_payment_events")
    .select(
      "id,customer_invoice_id,source_system,external_payment_id,payment_number,received_on,method,reference,amount,currency,source_payload",
    )
    .in(
      "payment_number",
      EXPECTED.map((row) => row.paymentNumber),
    ),
);
const eventByNumber = new Map(
  events.map((event) => [event.payment_number, event]),
);
if (eventByNumber.size !== EXPECTED.length) {
  throw new Error(
    `Expected ${EXPECTED.length} cash payment events, found ${eventByNumber.size}.`,
  );
}

for (const expected of EXPECTED) {
  const invoice = invoiceByNumber.get(expected.invoiceNumber);
  const event = eventByNumber.get(expected.paymentNumber);
  const checks = [
    [event.source_system, "dripjobs", "source system"],
    [event.customer_invoice_id, invoice.id, "invoice relationship"],
    [event.method, "Cash", "payment method"],
    [event.received_on, expected.receivedOn, "received date"],
    [event.currency, "CAD", "currency"],
    [invoice.currency, "CAD", "invoice currency"],
    [invoice.customer_name, expected.customer, "customer"],
    [money(event.amount), expected.amount, "amount"],
  ];
  for (const [actual, wanted, label] of checks) {
    if (actual !== wanted) {
      throw new Error(
        `Payment #${expected.paymentNumber} ${label} changed: expected ${wanted}, found ${actual}.`,
      );
    }
  }
}

const invoiceIds = invoices.map((invoice) => invoice.id);
const eventIds = events.map((event) => event.id);
const [verificationRows, allocationRows] = await Promise.all([
  db
    .from("customer_invoice_verification")
    .select(
      "customer_invoice_id,invoice_number,customer_name,total_amount,bank_paid_amount,amount_remaining,bank_payment_status,verification_status",
    )
    .in("customer_invoice_id", invoiceIds),
  db
    .from("customer_invoice_bank_allocations")
    .select(
      "id,customer_invoice_id,source_payment_event_id,financial_transaction_id,allocated_amount,invoice_applied_amount,reversed_at",
    )
    .in("customer_invoice_id", invoiceIds)
    .is("reversed_at", null),
]);
const verification = assertNoError(
  "customer invoice verification",
  verificationRows,
);
const activeAllocations = assertNoError(
  "active customer allocations",
  allocationRows,
);
const verificationByInvoiceId = new Map(
  verification.map((row) => [row.customer_invoice_id, row]),
);
const allocationByEventId = new Map(
  activeAllocations
    .filter((row) => eventIds.includes(row.source_payment_event_id))
    .map((row) => [row.source_payment_event_id, row]),
);

const candidates = EXPECTED.map((expected) => {
  const invoice = invoiceByNumber.get(expected.invoiceNumber);
  const event = eventByNumber.get(expected.paymentNumber);
  const current = verificationByInvoiceId.get(invoice.id);
  const existing = allocationByEventId.get(event.id) ?? null;
  if (!current)
    throw new Error(
      `Missing verification for invoice #${expected.invoiceNumber}.`,
    );
  if (!existing && money(current.amount_remaining) !== expected.amount) {
    throw new Error(
      `Invoice #${expected.invoiceNumber} remaining amount ${current.amount_remaining} does not equal cash event ${expected.amount}.`,
    );
  }
  return {
    customer: expected.customer,
    invoice_number: expected.invoiceNumber,
    payment_number: expected.paymentNumber,
    received_on: expected.receivedOn,
    amount: expected.amount,
    current_status: current.bank_payment_status,
    action: existing
      ? "already_reconciled"
      : "create_cash_receipt_and_allocate",
  };
});

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      project_ref: TARGET_PROJECT_REF,
      owner_confirmation: CONFIRMED_ON,
      cash_receipts: candidates.length,
      cash_total: money(candidates.reduce((sum, row) => sum + row.amount, 0)),
      candidates,
    },
    null,
    2,
  ),
);

if (!apply) process.exit(0);

const accountRows = assertNoError(
  "Cash on Hand account",
  await db
    .from("financial_accounts")
    .upsert(
      {
        slug: CASH_ACCOUNT_SLUG,
        institution: "Ottawa Painters",
        name: "Cash on Hand",
        account_type: "cash",
        last_four: null,
        currency: "CAD",
        is_active: true,
        current_balance: null,
        available_balance: null,
        credit_limit: null,
        balance_as_of: null,
        external_provider: "dripjobs",
        external_account_id: "owner-confirmed-cash-ledger",
      },
      { onConflict: "slug" },
    )
    .select("id,slug,name,account_type"),
);
if (accountRows.length !== 1 || accountRows[0].account_type !== "cash") {
  throw new Error("Cash on Hand account was not created correctly.");
}
const cashAccount = accountRows[0];

const evidenceHash = hash(
  JSON.stringify(
    EXPECTED.map((row) => ({
      payment_number: row.paymentNumber,
      invoice_number: row.invoiceNumber,
      amount: row.amount,
      received_on: row.receivedOn,
    })),
  ),
);
const importRows = assertNoError(
  "cash evidence import",
  await db
    .from("financial_imports")
    .upsert(
      {
        content_sha256: evidenceHash,
        source_email_thread_id: null,
        source_message_id: null,
        original_filename: "DripJobs cash payment confirmations — 2026-08-02",
        mime_type: "application/json",
        source_kind: "accounting_report",
        account_id: cashAccount.id,
        period_start: EXPECTED.map((row) => row.receivedOn).sort()[0],
        period_end: EXPECTED.map((row) => row.receivedOn)
          .sort()
          .at(-1),
        row_count: EXPECTED.length,
        metadata: {
          source_system: "dripjobs",
          evidence_kind: "owner_confirmed_cash_payments",
          owner_confirmed_on: CONFIRMED_ON,
          payment_numbers: EXPECTED.map((row) => row.paymentNumber),
        },
      },
      { onConflict: "content_sha256" },
    )
    .select("id,content_sha256,original_filename"),
);
if (importRows.length !== 1)
  throw new Error("Cash evidence import was not created correctly.");
const cashImport = importRows[0];

const transactionPlan = EXPECTED.map((expected) => {
  const invoice = invoiceByNumber.get(expected.invoiceNumber);
  const event = eventByNumber.get(expected.paymentNumber);
  return {
    account_id: cashAccount.id,
    import_id: cashImport.id,
    source_key: hash(`dripjobs:cash:${event.external_payment_id}`),
    posted_on: event.received_on,
    transaction_on: event.received_on,
    description: `CASH RECEIPT — ${expected.customer}`,
    counterparty: expected.customer,
    amount: expected.amount,
    tax_amount: 0,
    currency: "CAD",
    transaction_type: "income",
    category: "Painting revenue",
    is_transfer: false,
    review_status: "reconciled",
    running_balance: null,
    notes: `Recorded as Cash in DripJobs and confirmed by Ottawa Painters on ${CONFIRMED_ON}.`,
    source_data: {
      source: "dripjobs_cash_payment",
      evidence_status: "owner_confirmed",
      owner_confirmed_on: CONFIRMED_ON,
      external_payment_id: event.external_payment_id,
      payment_number: event.payment_number,
      invoice_number: invoice.invoice_number,
      customer_invoice_id: invoice.id,
      job_proposal_id: invoice.external_proposal_id,
      customer_name: invoice.customer_name,
      customer_email: event.source_payload?.customer_email ?? null,
      received_on: event.received_on,
      payment_method: event.method,
      source_url: event.source_payload?.edit_url ?? null,
    },
  };
});
const transactionKeys = transactionPlan.map((row) => row.source_key);
const existingTransactions = assertNoError(
  "existing cash transactions",
  await db
    .from("financial_transactions")
    .select(
      "id,source_key,account_id,import_id,amount,currency,category,transaction_type,review_status",
    )
    .in("source_key", transactionKeys),
);
const existingByKey = new Map(
  existingTransactions.map((row) => [row.source_key, row]),
);
const missingTransactions = transactionPlan.filter(
  (row) => !existingByKey.has(row.source_key),
);
if (missingTransactions.length > 0) {
  const insertedTransactions = assertNoError(
    "cash transactions insert",
    await db
      .from("financial_transactions")
      .insert(missingTransactions)
      .select(
        "id,source_key,account_id,import_id,amount,currency,category,transaction_type,review_status",
      ),
  );
  for (const row of insertedTransactions)
    existingByKey.set(row.source_key, row);
}

for (const plan of transactionPlan) {
  const stored = existingByKey.get(plan.source_key);
  const checks = [
    [stored.account_id, plan.account_id, "account"],
    [stored.import_id, plan.import_id, "import"],
    [money(stored.amount), plan.amount, "amount"],
    [stored.currency, "CAD", "currency"],
    [stored.category, "Painting revenue", "category"],
    [stored.transaction_type, "income", "transaction type"],
    [stored.review_status, "reconciled", "review status"],
  ];
  for (const [actual, wanted, label] of checks) {
    if (actual !== wanted)
      throw new Error(`Stored cash transaction ${label} is invalid.`);
  }
}

const allocationPlan = EXPECTED.flatMap((expected) => {
  const invoice = invoiceByNumber.get(expected.invoiceNumber);
  const event = eventByNumber.get(expected.paymentNumber);
  if (allocationByEventId.has(event.id)) return [];
  const sourceKey = hash(`dripjobs:cash:${event.external_payment_id}`);
  const transaction = existingByKey.get(sourceKey);
  return [
    {
      financial_transaction_id: transaction.id,
      customer_invoice_id: invoice.id,
      source_payment_event_id: event.id,
      allocated_amount: expected.amount,
      invoice_applied_amount: expected.amount,
      match_method: [
        "dripjobs_payment_event",
        "cash_payment_method",
        `owner_confirmed_${CONFIRMED_ON.replaceAll("-", "_")}`,
      ],
      confidence: "confirmed",
      evidence_note: `DripJobs payment #${event.payment_number} records Cash received ${event.received_on}; Ottawa Painters confirmed this cash settlement on ${CONFIRMED_ON}.`,
      confirmed_by: null,
      confirmed_at: new Date().toISOString(),
    },
  ];
});
if (allocationPlan.length > 0) {
  assertNoError(
    "cash allocation insert",
    await db
      .from("customer_invoice_bank_allocations")
      .insert(allocationPlan)
      .select("id"),
  );
}

const [finalInvoicesResult, finalTransactionsResult] = await Promise.all([
  db
    .from("customer_invoice_verification")
    .select(
      "customer_invoice_id,invoice_number,customer_name,total_amount,bank_paid_amount,bank_cash_amount,amount_remaining,bank_payment_status,verification_status",
    )
    .in("customer_invoice_id", invoiceIds),
  db
    .from("financial_transactions")
    .select("id,source_key,review_status,amount")
    .in("source_key", transactionKeys),
]);
const finalInvoices = assertNoError(
  "final invoice verification",
  finalInvoicesResult,
);
const finalTransactions = assertNoError(
  "final cash transaction verification",
  finalTransactionsResult,
);
const finalCashVerification = assertNoError(
  "final cash allocation verification",
  await db
    .from("customer_revenue_verification")
    .select(
      "financial_transaction_id,payment_status,allocated_amount,unallocated_amount",
    )
    .in(
      "financial_transaction_id",
      finalTransactions.map((row) => row.id),
    ),
);
const cashVerificationByTransactionId = new Map(
  finalCashVerification.map((row) => [row.financial_transaction_id, row]),
);

for (const invoice of finalInvoices) {
  if (
    invoice.bank_payment_status !== "paid" ||
    invoice.verification_status !== "verified" ||
    money(invoice.amount_remaining) !== 0
  ) {
    throw new Error(
      `Invoice #${invoice.invoice_number} did not reconcile completely.`,
    );
  }
}
for (const transaction of finalTransactions) {
  const verificationRow = cashVerificationByTransactionId.get(transaction.id);
  if (
    transaction.review_status !== "reconciled" ||
    verificationRow?.payment_status !== "fully_allocated" ||
    money(verificationRow?.unallocated_amount) !== 0
  ) {
    throw new Error(
      `Cash transaction ${transaction.id} did not reconcile completely.`,
    );
  }
}

console.log(
  JSON.stringify(
    {
      applied: true,
      account: cashAccount.name,
      transactions_created: missingTransactions.length,
      allocations_created: allocationPlan.length,
      cash_total: money(
        finalTransactions.reduce((sum, row) => {
          const plan = transactionPlan.find(
            (item) => item.source_key === row.source_key,
          );
          return sum + Number(plan?.amount ?? 0);
        }, 0),
      ),
      invoices: finalInvoices
        .sort((left, right) =>
          left.invoice_number.localeCompare(right.invoice_number),
        )
        .map((invoice) => ({
          invoice_number: invoice.invoice_number,
          customer: invoice.customer_name,
          cash_received: money(invoice.bank_cash_amount),
          amount_remaining: money(invoice.amount_remaining),
          status: invoice.bank_payment_status,
          verification: invoice.verification_status,
        })),
    },
    null,
    2,
  ),
);
