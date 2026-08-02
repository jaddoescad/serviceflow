#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const OBSERVED_ON = "2026-08-02";
const ACCOUNT_LAST_FOUR = "6970";
const EXPECTED = [
  {
    invoiceNumber: "474315",
    customer: "Chris Jupp",
    payer: "Christopher J Jupp",
    amount: 2476.96,
    postedOn: "2026-07-28",
    eventDates: ["2026-07-28"],
    suffix: "YJg",
    runningBalance: 50329.59,
    gmailMessageId: "19fa8891320f086d",
    interacReference: "C1AS8pthqYJg",
  },
  {
    invoiceNumber: "487869",
    customer: "Pauline Burton",
    payer: "Gregory Burton",
    amount: 1654.43,
    postedOn: "2026-07-28",
    eventDates: ["2026-07-28"],
    suffix: "TA2",
    runningBalance: 51984.02,
    gmailMessageId: "19fa91034ea932f2",
    interacReference: "C1AgmQ7GMTA2",
  },
  {
    invoiceNumber: "487895",
    customer: "Tom Benton",
    payer: "Thomas H Benton",
    amount: 479.97,
    postedOn: "2026-07-28",
    eventDates: ["2026-07-28"],
    suffix: "BWS",
    runningBalance: 52463.99,
    gmailMessageId: "19fa91ec291d6b4f",
    interacReference: "C1AEANbYdBWS",
  },
  {
    invoiceNumber: "436544",
    customer: "Phil Anido",
    payer: "Philip J Anido",
    amount: 1500,
    postedOn: "2026-07-30",
    eventDates: ["2026-07-29", "2026-07-30"],
    suffix: "9Ag",
    runningBalance: 52342.82,
    gmailMessageId: "19fb2f657b970073",
    interacReference: "C1AZVNTpQ9Ag",
  },
];

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

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sourceKey(row) {
  return hash(
    `td-easyweb:${ACCOUNT_LAST_FOUR}:${row.postedOn}:${row.suffix}:${row.amount.toFixed(2)}`,
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

assert(supabaseUrl && serviceRoleKey, "Missing Supabase credentials.");
assert(
  new URL(supabaseUrl).hostname.split(".")[0] === TARGET_PROJECT_REF,
  "Refusing reconciliation for an unexpected Supabase project.",
);

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const accounts = assertNoError(
  "business chequing account",
  await db
    .from("financial_accounts")
    .select("id,slug,name,account_type,last_four,currency")
    .eq("last_four", ACCOUNT_LAST_FOUR),
);
assert(
  accounts.length === 1,
  `Expected one account ending ${ACCOUNT_LAST_FOUR}.`,
);
const account = accounts[0];
assert(account.account_type === "chequing", "Account 6970 is not chequing.");
assert(account.currency === "CAD", "Account 6970 is not in CAD.");

const invoices = assertNoError(
  "customer invoices",
  await db
    .from("customer_invoices")
    .select(
      "id,invoice_number,customer_name,total_amount,source_paid_amount,currency,external_proposal_id,accounting_status",
    )
    .in(
      "invoice_number",
      EXPECTED.map((row) => row.invoiceNumber),
    ),
);
assert(
  invoices.length === EXPECTED.length,
  "The expected invoice set changed.",
);
const invoiceByNumber = new Map(
  invoices.map((invoice) => [invoice.invoice_number, invoice]),
);

for (const expected of EXPECTED) {
  const invoice = invoiceByNumber.get(expected.invoiceNumber);
  assert(invoice, `Invoice #${expected.invoiceNumber} is missing.`);
  assert(
    invoice.customer_name === expected.customer,
    `Invoice #${expected.invoiceNumber} customer changed.`,
  );
  assert(
    invoice.currency === "CAD",
    `Invoice #${expected.invoiceNumber} is not CAD.`,
  );
  assert(
    invoice.accounting_status === "active",
    `Invoice #${expected.invoiceNumber} is not active.`,
  );
}

const invoiceIds = invoices.map((invoice) => invoice.id);
const events = assertNoError(
  "customer payment events",
  await db
    .from("customer_invoice_payment_events")
    .select(
      "id,customer_invoice_id,source_system,external_payment_id,payment_number,received_on,method,reference,amount,currency,source_payload",
    )
    .in("customer_invoice_id", invoiceIds),
);
const eventByInvoiceNumber = new Map();
for (const expected of EXPECTED) {
  const invoice = invoiceByNumber.get(expected.invoiceNumber);
  const candidates = events.filter(
    (event) =>
      event.customer_invoice_id === invoice.id &&
      money(event.amount) === expected.amount &&
      expected.eventDates.includes(event.received_on),
  );
  assert(
    candidates.length === 1,
    `Expected one ${expected.amount.toFixed(2)} payment event for invoice #${expected.invoiceNumber}; found ${candidates.length}.`,
  );
  const event = candidates[0];
  assert(
    event.source_system === "dripjobs",
    "Unexpected payment-event source.",
  );
  assert(event.currency === "CAD", "Unexpected payment-event currency.");
  eventByInvoiceNumber.set(expected.invoiceNumber, event);
}

const eventIds = [...eventByInvoiceNumber.values()].map((event) => event.id);
const [verificationResult, allocationResult, transactionResult] =
  await Promise.all([
    db
      .from("customer_invoice_verification")
      .select(
        "customer_invoice_id,invoice_number,customer_name,total_amount,source_paid_amount,bank_paid_amount,bank_cash_amount,amount_remaining,bank_payment_status,verification_status",
      )
      .in("customer_invoice_id", invoiceIds),
    db
      .from("customer_invoice_bank_allocations")
      .select(
        "id,customer_invoice_id,source_payment_event_id,financial_transaction_id,allocated_amount,invoice_applied_amount,reversed_at",
      )
      .in("source_payment_event_id", eventIds)
      .is("reversed_at", null),
    db
      .from("financial_transactions")
      .select(
        "id,source_key,account_id,posted_on,description,counterparty,amount,currency,transaction_type,category,review_status,source_data",
      )
      .eq("account_id", account.id)
      .gte("posted_on", "2026-07-28")
      .lte("posted_on", "2026-07-30"),
  ]);
const verifications = assertNoError("invoice verification", verificationResult);
const allocations = assertNoError("customer allocations", allocationResult);
const recentTransactions = assertNoError(
  "recent financial transactions",
  transactionResult,
);
const verificationByInvoiceId = new Map(
  verifications.map((row) => [row.customer_invoice_id, row]),
);
const allocationByEventId = new Map(
  allocations.map((row) => [row.source_payment_event_id, row]),
);

const transactionBySourceKey = new Map(
  recentTransactions.map((transaction) => [
    transaction.source_key,
    transaction,
  ]),
);
for (const expected of EXPECTED) {
  const matchingRows = recentTransactions.filter(
    (transaction) =>
      transaction.posted_on === expected.postedOn &&
      money(transaction.amount) === expected.amount &&
      (transaction.description?.includes(`***${expected.suffix}`) ||
        transaction.source_data?.transfer_suffix === expected.suffix),
  );
  assert(
    matchingRows.length <= 1,
    `Multiple financial rows match ${expected.suffix} ${expected.amount.toFixed(2)}.`,
  );
  if (matchingRows[0]) {
    transactionBySourceKey.set(sourceKey(expected), matchingRows[0]);
  }
}

const candidates = EXPECTED.map((expected) => {
  const invoice = invoiceByNumber.get(expected.invoiceNumber);
  const event = eventByInvoiceNumber.get(expected.invoiceNumber);
  const verification = verificationByInvoiceId.get(invoice.id);
  const allocation = allocationByEventId.get(event.id) ?? null;
  const transaction = transactionBySourceKey.get(sourceKey(expected)) ?? null;
  assert(
    verification,
    `Invoice #${expected.invoiceNumber} has no verification row.`,
  );
  assert(
    allocation || money(verification.amount_remaining) >= expected.amount,
    `Invoice #${expected.invoiceNumber} no longer has room for this payment.`,
  );
  return {
    customer: expected.customer,
    invoice_number: expected.invoiceNumber,
    posted_on: expected.postedOn,
    suffix: expected.suffix,
    amount: expected.amount,
    bank_row: transaction ? "present" : "create",
    allocation: allocation ? "present" : "create",
    current_bank_credit: money(verification.bank_paid_amount),
    current_receivable: money(verification.amount_remaining),
  };
});

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      project_ref: TARGET_PROJECT_REF,
      account: `${account.name} •••• ${ACCOUNT_LAST_FOUR}`,
      evidence:
        "TD EasyWeb posted account activity plus Interac confirmation emails",
      rows: candidates.length,
      total: money(EXPECTED.reduce((sum, row) => sum + row.amount, 0)),
      candidates,
    },
    null,
    2,
  ),
);

if (!apply) process.exit(0);

const evidencePayload = EXPECTED.map((row) => ({
  posted_on: row.postedOn,
  account_last_four: ACCOUNT_LAST_FOUR,
  description: `E-TRANSFER ***${row.suffix}`,
  amount: row.amount,
  running_balance: row.runningBalance,
  payer: row.payer,
  customer: row.customer,
  invoice_number: row.invoiceNumber,
  interac_reference: row.interacReference,
  gmail_message_id: row.gmailMessageId,
}));
const evidenceHash = hash(JSON.stringify(evidencePayload));
const importRows = assertNoError(
  "EasyWeb evidence import",
  await db
    .from("financial_imports")
    .upsert(
      {
        content_sha256: evidenceHash,
        source_email_thread_id: null,
        source_message_id: null,
        original_filename:
          "TD EasyWeb 6970 posted transactions — 2026-07-28 to 2026-07-30",
        mime_type: "application/json",
        source_kind: "bank_feed",
        account_id: account.id,
        period_start: "2026-07-28",
        period_end: "2026-07-30",
        row_count: EXPECTED.length,
        metadata: {
          source_system: "td_easyweb",
          evidence_kind: "posted_account_activity",
          observed_on: OBSERVED_ON,
          account_last_four: ACCOUNT_LAST_FOUR,
          transfer_suffixes: EXPECTED.map((row) => row.suffix),
          interac_message_ids: EXPECTED.map((row) => row.gmailMessageId),
        },
      },
      { onConflict: "content_sha256" },
    )
    .select("id,content_sha256,original_filename"),
);
assert(importRows.length === 1, "EasyWeb evidence import was not created.");
const evidenceImport = importRows[0];

const transactionPlan = EXPECTED.map((expected) => {
  const invoice = invoiceByNumber.get(expected.invoiceNumber);
  const event = eventByInvoiceNumber.get(expected.invoiceNumber);
  return {
    account_id: account.id,
    import_id: evidenceImport.id,
    source_key: sourceKey(expected),
    posted_on: expected.postedOn,
    transaction_on: expected.postedOn,
    description: `E-TFR ***${expected.suffix} EPAY`,
    counterparty: expected.payer,
    amount: expected.amount,
    tax_amount: 0,
    currency: "CAD",
    transaction_type: "income",
    category: "Painting revenue",
    is_transfer: false,
    review_status: "reconciled",
    running_balance: expected.runningBalance,
    notes: `TD EasyWeb posted deposit matched to ${expected.customer}, invoice #${expected.invoiceNumber}, by exact date, amount and Interac suffix ${expected.suffix}.`,
    source_data: {
      source: "td_easyweb",
      evidence_status: "posted",
      observed_on: OBSERVED_ON,
      account_last_four: ACCOUNT_LAST_FOUR,
      easyweb_description: `E-TRANSFER ***${expected.suffix}`,
      transfer_suffix: expected.suffix,
      interac_reference: expected.interacReference,
      interac_gmail_message_id: expected.gmailMessageId,
      payer_name: expected.payer,
      customer_name: expected.customer,
      customer_invoice_id: invoice.id,
      invoice_number: expected.invoiceNumber,
      job_proposal_id: invoice.external_proposal_id,
      dripjobs_payment_event_id: event.id,
    },
  };
});

const missingTransactions = transactionPlan.filter(
  (plan) => !transactionBySourceKey.has(plan.source_key),
);
if (missingTransactions.length > 0) {
  const inserted = assertNoError(
    "financial transaction insert",
    await db
      .from("financial_transactions")
      .insert(missingTransactions)
      .select(
        "id,source_key,account_id,posted_on,description,counterparty,amount,currency,transaction_type,category,review_status,source_data",
      ),
  );
  for (const transaction of inserted) {
    transactionBySourceKey.set(transaction.source_key, transaction);
  }
}

for (const plan of transactionPlan) {
  const stored = transactionBySourceKey.get(plan.source_key);
  assert(stored, `Financial row ${plan.source_key} is missing after insert.`);
  const checks = [
    [stored.account_id, plan.account_id, "account"],
    [stored.posted_on, plan.posted_on, "posted date"],
    [money(stored.amount), plan.amount, "amount"],
    [stored.currency, "CAD", "currency"],
    [stored.transaction_type, "income", "transaction type"],
    [stored.category, "Painting revenue", "category"],
    [stored.review_status, "reconciled", "review status"],
  ];
  for (const [actual, wanted, label] of checks) {
    assert(
      actual === wanted,
      `Stored ${plan.description} ${label} is invalid.`,
    );
  }
}

const allocationPlan = EXPECTED.flatMap((expected) => {
  const invoice = invoiceByNumber.get(expected.invoiceNumber);
  const event = eventByInvoiceNumber.get(expected.invoiceNumber);
  if (allocationByEventId.has(event.id)) return [];
  const transaction = transactionBySourceKey.get(sourceKey(expected));
  return [
    {
      financial_transaction_id: transaction.id,
      customer_invoice_id: invoice.id,
      source_payment_event_id: event.id,
      allocated_amount: expected.amount,
      invoice_applied_amount: expected.amount,
      match_method: [
        "td_easyweb_posted_transaction",
        "interac_suffix_amount_date",
        "dripjobs_payment_event",
      ],
      confidence: "confirmed",
      evidence_note: `TD EasyWeb account 6970 shows E-TRANSFER ***${expected.suffix} for $${expected.amount.toFixed(2)} posted ${expected.postedOn}; Interac reference ${expected.interacReference} identifies ${expected.payer}.`,
      confirmed_by: null,
      confirmed_at: new Date().toISOString(),
    },
  ];
});
if (allocationPlan.length > 0) {
  assertNoError(
    "customer allocation insert",
    await db
      .from("customer_invoice_bank_allocations")
      .insert(allocationPlan)
      .select("id"),
  );
}

const finalTransactions = assertNoError(
  "final financial rows",
  await db
    .from("financial_transactions")
    .select(
      "id,source_key,posted_on,description,counterparty,amount,review_status",
    )
    .in(
      "source_key",
      EXPECTED.map((row) => sourceKey(row)),
    ),
);
assert(
  finalTransactions.length === EXPECTED.length,
  "Final financial row count is wrong.",
);

const [finalInvoiceResult, finalRevenueResult] = await Promise.all([
  db
    .from("customer_invoice_verification")
    .select(
      "customer_invoice_id,invoice_number,customer_name,total_amount,source_paid_amount,bank_paid_amount,bank_cash_amount,amount_remaining,bank_payment_status,verification_status",
    )
    .in("customer_invoice_id", invoiceIds),
  db
    .from("customer_revenue_verification")
    .select(
      "financial_transaction_id,payment_status,allocated_amount,unallocated_amount",
    )
    .in(
      "financial_transaction_id",
      finalTransactions.map((row) => row.id),
    ),
]);
const finalInvoices = assertNoError(
  "final invoice verification",
  finalInvoiceResult,
);
const finalRevenue = assertNoError(
  "final revenue verification",
  finalRevenueResult,
);
const revenueByTransactionId = new Map(
  finalRevenue.map((row) => [row.financial_transaction_id, row]),
);

for (const expected of EXPECTED) {
  const invoice = finalInvoices.find(
    (row) => row.invoice_number === expected.invoiceNumber,
  );
  assert(invoice, `Invoice #${expected.invoiceNumber} disappeared.`);
  assert(
    invoice.verification_status === "verified",
    `Invoice #${expected.invoiceNumber} still needs payment review.`,
  );
  assert(
    money(invoice.bank_paid_amount) + 0.005 >=
      money(invoice.source_paid_amount),
    `Invoice #${expected.invoiceNumber} has unverified source payments.`,
  );
  const transaction = finalTransactions.find(
    (row) => row.source_key === sourceKey(expected),
  );
  const revenue = revenueByTransactionId.get(transaction.id);
  assert(
    transaction.review_status === "reconciled" &&
      revenue?.payment_status === "fully_allocated" &&
      money(revenue?.unallocated_amount) === 0,
    `Bank row ${expected.suffix} is not fully allocated.`,
  );
}

console.log(
  JSON.stringify(
    {
      applied: true,
      transactions_created: missingTransactions.length,
      allocations_created: allocationPlan.length,
      bank_cash_linked: money(
        EXPECTED.reduce((sum, row) => sum + row.amount, 0),
      ),
      invoices: finalInvoices
        .sort((left, right) =>
          left.customer_name.localeCompare(right.customer_name),
        )
        .map((invoice) => ({
          customer: invoice.customer_name,
          invoice_number: invoice.invoice_number,
          bank_cash: money(invoice.bank_cash_amount),
          invoice_credit: money(invoice.bank_paid_amount),
          amount_remaining: money(invoice.amount_remaining),
          payment_status: invoice.bank_payment_status,
          verification: invoice.verification_status,
        })),
    },
    null,
    2,
  ),
);
