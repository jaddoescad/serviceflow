#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();
const CONFIRMED_ON = "2026-08-01";

const PAYMENTS = [
  {
    id: "92b920e8-30f3-4833-8207-7e0e7fdb8b7a",
    postedOn: "2026-02-18",
    counterparty: "Mas Reno",
    description: "SEND E-TFR ***yjG",
    amount: 300,
    contractorId: "63c7140f-1ba2-4e81-b3e4-6144398a59e0",
    status: "no_invoice_provided",
    noInvoiceAmount: 300,
    note:
      "No invoice provided for this exact $300.00 Mas Reno payment. Ottawa Painters confirmed this exception on 2026-08-01. The existing Mas Reno invoice #012225 remains separate and unpaid.",
  },
  {
    id: "6680c4bf-aef6-4bf6-8ee8-7947adf9e54d",
    postedOn: "2026-02-06",
    counterparty: "M&A Nice Painting Inc.",
    description: "SEND E-TFR ***aMT",
    amount: 1017,
    contractorId: "4bb1edb6-8ab1-4557-8b04-f97d07aaff3c",
    status: "no_invoice_provided",
    noInvoiceAmount: 1017,
    note:
      "No invoice provided for this exact $1,017.00 M&A Nice Painting Inc. payment. Ottawa Painters confirmed this exception on 2026-08-01.",
  },
  {
    id: "be7dc727-5188-4079-a23a-4264fb51b291",
    postedOn: "2026-02-03",
    counterparty: "Mas Reno",
    description: "SEND E-TFR ***RZP",
    amount: 791,
    contractorId: "63c7140f-1ba2-4e81-b3e4-6144398a59e0",
    status: "no_invoice_provided",
    noInvoiceAmount: 791,
    note:
      "No invoice provided for this exact $791.00 Mas Reno payment. Ottawa Painters confirmed this exception on 2026-08-01. The existing Mas Reno invoice #012225 remains separate and unpaid.",
  },
  {
    id: "9030c57f-2b73-4963-9844-8bf756113a6b",
    postedOn: "2026-01-12",
    counterparty: "Polaris Painters",
    description: "SEND E-TFR ***tqg",
    amount: 680,
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    status: "partial_invoice_allocation_with_no_invoice_residual",
    invoiceId: "5e4d0f46-05fd-4a3a-a37d-efee90476b89",
    invoiceNumber: "51",
    invoiceAllocatedAmount: 430,
    noInvoiceAmount: 250,
    note:
      "Polaris payment of $680.00 is partially documented: $430.00 remains allocated to invoice #51, and Ottawa Painters confirmed on 2026-08-01 that the remaining $250.00 has no invoice.",
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
  if ((existing.data ?? []).length > 0) return;
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
const [transactionsResult, recordsResult, allocationsResult] =
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
      .select(
        "financial_transaction_id,invoice_id,allocated_amount,reversed_at",
      )
      .in("financial_transaction_id", paymentIds)
      .is("reversed_at", null),
  ]);
for (const [label, result] of Object.entries({
  transactions: transactionsResult,
  records: recordsResult,
  allocations: allocationsResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

assert(
  transactionsResult.data.length === PAYMENTS.length,
  "One or more exact payment rows are missing.",
);
assert(
  recordsResult.data.length === PAYMENTS.length,
  "One or more recipient-evidence rows are missing.",
);

const transactionById = new Map(
  transactionsResult.data.map((transaction) => [transaction.id, transaction]),
);
const recordById = new Map(
  recordsResult.data.map((record) => [
    record.financial_transaction_id,
    record,
  ]),
);
const allocationsById = new Map();
for (const allocation of allocationsResult.data) {
  const current = allocationsById.get(allocation.financial_transaction_id) ?? [];
  current.push(allocation);
  allocationsById.set(allocation.financial_transaction_id, current);
}

const planned = PAYMENTS.map((payment) => {
  const transaction = transactionById.get(payment.id);
  const record = recordById.get(payment.id);
  const allocations = allocationsById.get(payment.id) ?? [];
  assert(transaction, `Missing transaction ${payment.id}.`);
  assert(record, `Missing recipient evidence for ${payment.id}.`);
  assert(
    transaction.posted_on === payment.postedOn &&
      transaction.counterparty === payment.counterparty &&
      transaction.description === payment.description &&
      cents(transaction.amount) === -cents(payment.amount) &&
      transaction.currency === "CAD" &&
      transaction.transaction_type === "expense" &&
      transaction.category === "Subcontractors" &&
      transaction.is_transfer === false,
    `Transaction ${payment.description} no longer matches the reviewed bank row.`,
  );
  assert(
    record.contractor_id === payment.contractorId &&
      record.recipient_status === "confirmed",
    `Recipient evidence changed for ${payment.description}.`,
  );

  if (payment.status === "no_invoice_provided") {
    assert(
      allocations.length === 0,
      `Refusing to mark ${payment.description} no-invoice because it has an active invoice allocation.`,
    );
  } else {
    assert(
      allocations.length === 1 &&
        allocations[0].invoice_id === payment.invoiceId &&
        cents(allocations[0].allocated_amount) ===
          cents(payment.invoiceAllocatedAmount),
      `The preserved Polaris invoice allocation no longer matches invoice #${payment.invoiceNumber}.`,
    );
    assert(
      cents(payment.invoiceAllocatedAmount + payment.noInvoiceAmount) ===
        cents(payment.amount),
      "The Polaris invoice and no-invoice amounts do not explain the full payment.",
    );
  }

  const sourceData = sourceObject(transaction.source_data);
  const currentResearch = sourceObject(sourceData.reconciliation_research);
  const desired = {
    notes: payment.note,
    source_data: {
      ...sourceData,
      reconciliation_research: {
        ...currentResearch,
        status: payment.status,
        contractor_id: payment.contractorId,
        contractor_name: payment.counterparty,
        user_confirmed: true,
        user_confirmed_on: CONFIRMED_ON,
        payment_has_invoice: payment.status !== "no_invoice_provided",
        invoice_id: payment.invoiceId ?? null,
        invoice_number: payment.invoiceNumber ?? null,
        invoice_allocated_amount: payment.invoiceAllocatedAmount ?? 0,
        no_invoice_amount: payment.noInvoiceAmount,
        evidence_conclusion: payment.note,
      },
    },
  };
  return { payment, transaction, allocations, desired };
});

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      candidates: planned.map(({ payment, allocations, transaction, desired }) => ({
        id: payment.id,
        posted_on: payment.postedOn,
        counterparty: payment.counterparty,
        description: payment.description,
        payment_amount: payment.amount,
        active_invoice_allocated_amount: allocations.reduce(
          (sum, allocation) => sum + Number(allocation.allocated_amount),
          0,
        ),
        no_invoice_amount: payment.noInvoiceAmount,
        target_status: payment.status,
        current_status:
          transaction.source_data?.reconciliation_research?.status ?? null,
        will_update: changed(transaction, desired),
      })),
      total_payment_amount: PAYMENTS.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      ),
      total_no_invoice_amount: PAYMENTS.reduce(
        (sum, payment) => sum + payment.noInvoiceAmount,
        0,
      ),
      preserved_invoice_allocations: 1,
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
      `Ottawa Painters confirmed ${payment.description} on ${CONFIRMED_ON}: ` +
      (payment.status === "no_invoice_provided"
        ? `no invoice was provided for the $${payment.amount.toFixed(2)} payment.`
        : `$${payment.invoiceAllocatedAmount.toFixed(2)} remains matched to invoice #${payment.invoiceNumber}; the $${payment.noInvoiceAmount.toFixed(2)} residual has no invoice.`),
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const verification = await db
  .from("financial_transactions")
  .select("id,notes,source_data")
  .in("id", paymentIds);
if (verification.error) throw verification.error;
const verifiedById = new Map(
  verification.data.map((transaction) => [transaction.id, transaction]),
);
for (const payment of PAYMENTS) {
  const transaction = verifiedById.get(payment.id);
  assert(
    transaction?.notes === payment.note &&
      transaction.source_data?.reconciliation_research?.status ===
        payment.status &&
      transaction.source_data?.reconciliation_research?.user_confirmed ===
        true &&
      cents(
        transaction.source_data?.reconciliation_research?.no_invoice_amount,
      ) === cents(payment.noInvoiceAmount),
    `Post-apply verification failed for ${payment.description}.`,
  );
}

console.log(
  JSON.stringify(
    {
      applied: true,
      payments_updated: planned.filter(({ transaction, desired }) =>
        changed(transaction, desired),
      ).length,
      no_invoice_payments: 3,
      partial_payment_with_no_invoice_residual: 1,
      no_invoice_amount: 2358,
      preserved_polaris_invoice_allocation: 430,
    },
    null,
    2,
  ),
);
