#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const MAS_RENO_CONTRACTOR_ID = "63c7140f-1ba2-4e81-b3e4-6144398a59e0";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();
const REVIEWED_ON = "2026-07-30";
const INVOICE_EMAIL_MESSAGE_ID = "19c12b8a45591b8f";

const PAYMENTS = [
  {
    id: "be7dc727-5188-4079-a23a-4264fb51b291",
    date: "2026-02-03",
    description: "SEND E-TFR ***RZP",
    amount: 791,
    confirmationMessageId: "19c255be032eb2e0",
  },
  {
    id: "92b920e8-30f3-4833-8207-7e0e7fdb8b7a",
    date: "2026-02-18",
    description: "SEND E-TFR ***yjG",
    amount: 300,
    confirmationMessageId: "19c72dab22f127dd",
  },
];

const NOTE =
  "Recipient confirmed as Mas Reno. Kept unallocated after evidence review: " +
  "Gmail message 19c12b8a45591b8f contains invoices #012223 ($1,221.00), " +
  "#012224 ($897.50), and #012225 ($1,532.50), and says a separate Amir " +
  "invoice would follow. The first two invoices already have exact bank " +
  "matches. These $791.00 and $300.00 transfers total $1,091.00, but no " +
  "invoice, transfer memo, or email proves whether they settle the promised " +
  "Amir invoice or invoice #012225. Do not allocate until that missing " +
  "evidence is obtained.";

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

function sourceObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value;
}

function changed(current, desired) {
  return Object.entries(desired).some(
    ([key, value]) =>
      JSON.stringify(canonicalJson(current[key])) !==
      JSON.stringify(canonicalJson(value)),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function insertAuditEvent(db, event) {
  const existing = await db
    .from("labour_verification_events")
    .select("id")
    .eq("entity_type", event.entity_type)
    .eq("entity_id", event.entity_id)
    .eq("action", event.action)
    .eq("reason", event.reason)
    .limit(1);
  if (existing.error) throw existing.error;
  if ((existing.data ?? []).length) return;
  const insertion = await db.from("labour_verification_events").insert(event);
  if (insertion.error) throw insertion.error;
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
  throw new Error(`Refusing reconciliation for project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const paymentIds = PAYMENTS.map((payment) => payment.id);
const [transactionsResult, recordsResult, allocationsResult, invoicesResult] =
  await Promise.all([
    db
      .from("financial_transactions")
      .select(
        "id,posted_on,description,counterparty,amount,currency,transaction_type,category,is_transfer,review_status,notes,source_data",
      )
      .in("id", paymentIds),
    db
      .from("labour_payment_records")
      .select(
        "financial_transaction_id,contractor_id,recipient_status,confirmation_note",
      )
      .in("financial_transaction_id", paymentIds),
    db
      .from("labour_payment_allocations")
      .select("financial_transaction_id,invoice_id,allocated_amount")
      .in("financial_transaction_id", paymentIds)
      .is("reversed_at", null),
    db
      .from("labour_invoices")
      .select(
        "id,contractor_id,invoice_number,amount_before_tax,tax_amount,amount_paid,document_type,match_status",
      )
      .eq("contractor_id", MAS_RENO_CONTRACTOR_ID)
      .in("invoice_number", ["012223", "012224", "012225"]),
  ]);
for (const [label, result] of Object.entries({
  transactions: transactionsResult,
  records: recordsResult,
  allocations: allocationsResult,
  invoices: invoicesResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

assert(
  transactionsResult.data.length === PAYMENTS.length,
  "One or more reviewed Mas Reno transactions are missing.",
);
assert(
  recordsResult.data.length === PAYMENTS.length &&
    recordsResult.data.every(
      (record) =>
        record.contractor_id === MAS_RENO_CONTRACTOR_ID &&
        record.recipient_status === "confirmed",
    ),
  "Mas Reno recipient evidence is incomplete.",
);
assert(
  allocationsResult.data.length === 0,
  "Refusing to annotate a Mas Reno payment that already has an allocation.",
);
assert(
  invoicesResult.data.length === 3,
  "The reviewed Mas Reno invoice batch is incomplete.",
);

const expectedInvoices = new Map([
  ["012223", 1221],
  ["012224", 897.5],
  ["012225", 1532.5],
]);
for (const invoice of invoicesResult.data) {
  const gross =
    Number(invoice.amount_before_tax ?? 0) + Number(invoice.tax_amount ?? 0);
  assert(
    invoice.document_type === "invoice" &&
      expectedInvoices.has(invoice.invoice_number) &&
      cents(gross) === cents(expectedInvoices.get(invoice.invoice_number)),
    `Mas Reno invoice #${invoice.invoice_number} no longer matches the reviewed attachment.`,
  );
}

const transactionById = new Map(
  transactionsResult.data.map((transaction) => [transaction.id, transaction]),
);
const planned = PAYMENTS.map((payment) => {
  const transaction = transactionById.get(payment.id);
  assert(
    transaction.posted_on === payment.date &&
      transaction.description === payment.description &&
      transaction.counterparty === "Mas Reno" &&
      cents(transaction.amount) === -cents(payment.amount) &&
      transaction.currency === "CAD" &&
      transaction.transaction_type === "expense" &&
      transaction.category === "Subcontractors" &&
      transaction.is_transfer === false,
    `Payment ${payment.description} no longer matches the reviewed bank row.`,
  );
  const sourceData = sourceObject(transaction.source_data);
  const desired = {
    review_status: "needs_review",
    notes: NOTE,
    source_data: {
      ...sourceData,
      reconciliation_research: {
        status: "missing_invoice_or_payment_memo",
        contractor_id: MAS_RENO_CONTRACTOR_ID,
        contractor_name: "Mas Reno",
        reviewed_on: REVIEWED_ON,
        invoice_submission_message_id: INVOICE_EMAIL_MESSAGE_ID,
        submitted_invoice_numbers: ["012223", "012224", "012225"],
        exact_matched_invoice_numbers: ["012223", "012224"],
        open_invoice_number: "012225",
        open_invoice_amount: 1532.5,
        unresolved_payment_ids: paymentIds,
        unresolved_payment_amount: 1091,
        promised_missing_invoice: "Amir's house",
        evidence_conclusion:
          "Do not allocate until the promised Amir invoice or a payment memo is obtained.",
      },
    },
  };
  return { payment, transaction, desired };
});

const updateCount = planned.filter(({ transaction, desired }) =>
  changed(transaction, desired),
).length;
console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      payments: PAYMENTS.length,
      transaction_updates: updateCount,
      unallocated_amount: 1091,
      open_invoice_amount: 1532.5,
    },
    null,
    2,
  ),
);
if (!APPLY) process.exit(0);

for (const { payment, transaction, desired } of planned) {
  if (!changed(transaction, desired)) continue;
  const oldValues = Object.fromEntries(
    Object.keys(desired).map((key) => [key, transaction[key]]),
  );
  const update = await db
    .from("financial_transactions")
    .update(desired)
    .eq("id", transaction.id);
  if (update.error) throw update.error;
  await insertAuditEvent(db, {
    entity_type: "payment",
    entity_id: transaction.id,
    action: "update",
    old_values: oldValues,
    new_values: desired,
    reason:
      `Evidence review for ${payment.description}: verified Mas Reno recipient, ` +
      "but no invoice or memo proves the payable represented by this transfer.",
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const verification = await db
  .from("financial_transactions")
  .select("id,review_status,notes,source_data")
  .in("id", paymentIds);
if (verification.error) throw verification.error;
assert(
  verification.data.length === PAYMENTS.length &&
    verification.data.every(
      (transaction) =>
        transaction.review_status === "needs_review" &&
        transaction.notes === NOTE &&
        transaction.source_data?.reconciliation_research?.status ===
          "missing_invoice_or_payment_memo",
    ),
  "Post-apply Mas Reno evidence-gap verification failed.",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      payments_annotated: PAYMENTS.length,
      allocation_changes: 0,
      conclusion:
        "Exact Mas Reno matches preserved; unresolved $1,091 kept unallocated.",
    },
    null,
    2,
  ),
);
