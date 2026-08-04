#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const CONTRACTOR_ID = "4caed611-bb04-4187-9775-7638cab9b3b6";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();
const REVIEWED_ON = "2026-07-30";

const EXPECTED_PAYMENTS = [
  [
    "31101d5e-0c1a-43e6-82b8-e476f1343424",
    "2026-03-30",
    "SEND E-TFR ***8rF",
    3000,
  ],
  [
    "dd3d007a-5d8f-40ee-9d37-9553f7fd8007",
    "2026-04-01",
    "SEND E-TFR ***xBj",
    3000,
  ],
  [
    "ed2b0fb3-8b5f-4eb7-9d78-b22e83d2f0c1",
    "2026-04-14",
    "SEND E-TFR ***R3q",
    3000,
  ],
  [
    "24ff3033-16f8-4267-832d-3217ec07ef7f",
    "2026-04-27",
    "SEND E-TFR ***7zm",
    2800,
  ],
  [
    "7fecc380-de39-4d4e-9ad9-28f78080a5e0",
    "2026-05-04",
    "SEND E-TFR ***tqR",
    3000,
  ],
  [
    "bdd7b861-0518-44d9-a2b8-12db22549767",
    "2026-05-28",
    "SEND E-TFR ***YSf",
    3000,
  ],
  [
    "b1939ba0-7021-4f6e-9730-7c03f734ac45",
    "2026-06-09",
    "SEND E-TFR ***Csj",
    3000,
  ],
  [
    "5528fe63-cf89-471f-b86e-36617cf5443e",
    "2026-06-10",
    "SEND E-TFR ***r2C",
    2100,
  ],
].map(([id, postedOn, description, amount]) => ({
  id,
  postedOn,
  description,
  amount,
}));

const NOTE =
  "No invoice provided. Ottawa Painters confirmed on 2026-07-30 that this " +
  "Youssef Mroueh transfer has no corresponding invoice. The recipient and " +
  "bank payment are confirmed, but the payment remains unallocated because " +
  "there is no invoice evidence for this transfer.";

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
const paymentIds = EXPECTED_PAYMENTS.map((payment) => payment.id);
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
      .select("financial_transaction_id,invoice_id,allocated_amount")
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
  transactionsResult.data.length === EXPECTED_PAYMENTS.length,
  "One or more reviewed Youssef Mroueh transactions are missing.",
);
assert(
  recordsResult.data.length === EXPECTED_PAYMENTS.length &&
    recordsResult.data.every(
      (record) =>
        record.contractor_id === CONTRACTOR_ID &&
        record.recipient_status === "confirmed",
    ),
  "Youssef Mroueh recipient evidence is incomplete.",
);
assert(
  allocationsResult.data.length === 0,
  "Refusing to mark a Youssef Mroueh payment with an active invoice allocation.",
);

const transactionById = new Map(
  transactionsResult.data.map((transaction) => [transaction.id, transaction]),
);
const planned = EXPECTED_PAYMENTS.map((payment) => {
  const transaction = transactionById.get(payment.id);
  assert(transaction, `Missing transaction ${payment.id}.`);
  assert(
    transaction.posted_on === payment.postedOn &&
      transaction.description === payment.description &&
      transaction.counterparty === "Youssef Mroueh" &&
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
        status: "no_invoice_provided",
        contractor_id: CONTRACTOR_ID,
        contractor_name: "Youssef Mroueh",
        reviewed_on: REVIEWED_ON,
        user_confirmed: true,
        payment_has_invoice: false,
        evidence_conclusion:
          "Keep the confirmed bank payment unallocated and display it as No invoice.",
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
      payments: EXPECTED_PAYMENTS.length,
      transaction_updates: updateCount,
      unallocated_amount: EXPECTED_PAYMENTS.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      ),
      allocation_changes: 0,
    },
    null,
    2,
  ),
);
if (!APPLY) process.exit(0);

for (const { payment, transaction, desired } of planned) {
  if (changed(transaction, desired)) {
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
        `User-confirmed evidence status for ${payment.description}: ` +
        "the bank payment is real, but no invoice was provided for it.",
      performed_by: ADMIN_USER_ID,
      performed_at: NOW,
    });
  }
}

const verification = await db
  .from("financial_transactions")
  .select("id,review_status,notes,source_data")
  .in("id", paymentIds);
if (verification.error) throw verification.error;
assert(
  verification.data.length === EXPECTED_PAYMENTS.length &&
    verification.data.every(
      (transaction) =>
        transaction.review_status === "needs_review" &&
        transaction.notes === NOTE &&
        transaction.source_data?.reconciliation_research?.status ===
          "no_invoice_provided" &&
        transaction.source_data?.reconciliation_research
          ?.payment_has_invoice === false,
    ),
  "Post-apply Youssef Mroueh evidence verification failed.",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      payments_marked_no_invoice: EXPECTED_PAYMENTS.length,
      allocation_changes: 0,
    },
    null,
    2,
  ),
);
