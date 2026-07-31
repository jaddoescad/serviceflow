#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();
const CONFIRMED_ON = "2026-07-30";

const PAIRS = [
  {
    reference: "9ck",
    counterparty: "XDesign Dev Inc",
    amount: 1627.2,
    evidenceStatus: "Cancelled",
    original: {
      id: "e8d9a9e5-7405-435a-be0c-8fcaf72a0366",
      date: "2026-05-15",
      description: "SEND E-TFR ***9ck",
    },
    reversal: {
      id: "5b37a9b6-0c3b-408f-8d41-b6d4d45bd3b9",
      date: "2026-05-19",
      description: "CANCEL E-TFR ***9ck",
    },
  },
  {
    reference: "26e",
    counterparty: "PixReno Construction Inc.",
    amount: 525.45,
    evidenceStatus: "Cancelled (Expired)",
    original: {
      id: "340c36d9-3b32-43ee-b25f-4305b3cb1cc2",
      date: "2026-05-04",
      description: "SEND E-TFR ***26e",
    },
    reversal: {
      id: "9d41e22a-e969-4e72-89a8-67c658431209",
      date: "2026-06-04",
      description: "RECLAIM E-TFR ***26e",
    },
  },
  {
    reference: "SjP",
    counterparty: "JAD SLIM",
    amount: 400,
    evidenceStatus: "Cancelled (Accept Request failed)",
    original: {
      id: "d3840efb-d3d9-46b1-81ff-b9c948ba3b5f",
      date: "2026-03-02",
      description: "SEND E-TFR ***SjP",
    },
    reversal: {
      id: "ab1c67e7-29bd-4098-8534-b6ad681d9aa1",
      date: "2026-03-02",
      description: "RECLAIM E-TFR ***SjP",
    },
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
const transactionIds = PAIRS.flatMap((pair) => [
  pair.original.id,
  pair.reversal.id,
]);
const [transactionsResult, paymentRecordsResult, allocationsResult] =
  await Promise.all([
    db
      .from("financial_transactions")
      .select(
        "id,posted_on,description,counterparty,amount,currency,transaction_type,category,is_transfer,review_status,notes,source_data",
      )
      .in("id", transactionIds),
    db
      .from("labour_payment_records")
      .select("financial_transaction_id")
      .in("financial_transaction_id", transactionIds),
    db
      .from("labour_payment_allocations")
      .select("financial_transaction_id")
      .in("financial_transaction_id", transactionIds)
      .is("reversed_at", null),
  ]);
for (const [label, result] of Object.entries({
  transactions: transactionsResult,
  paymentRecords: paymentRecordsResult,
  allocations: allocationsResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
assert(
  transactionsResult.data.length === transactionIds.length,
  "One or more reviewed cancellation transactions are missing.",
);
assert(
  (paymentRecordsResult.data ?? []).length === 0,
  "Refusing to cancel a transfer with a labour payment record.",
);
assert(
  (allocationsResult.data ?? []).length === 0,
  "Refusing to cancel a transfer with an active invoice allocation.",
);

const transactionById = new Map(
  transactionsResult.data.map((transaction) => [transaction.id, transaction]),
);
const planned = [];
for (const pair of PAIRS) {
  const original = transactionById.get(pair.original.id);
  const reversal = transactionById.get(pair.reversal.id);
  assert(
    original.posted_on === pair.original.date &&
      original.description === pair.original.description &&
      original.counterparty === pair.counterparty &&
      cents(original.amount) === -cents(pair.amount) &&
      original.currency === "CAD",
    `Original transfer ${pair.reference} no longer matches the reviewed bank row.`,
  );
  assert(
    reversal.posted_on === pair.reversal.date &&
      reversal.description === pair.reversal.description &&
      reversal.counterparty === pair.counterparty &&
      cents(reversal.amount) === cents(pair.amount) &&
      reversal.currency === "CAD",
    `Reversal ${pair.reference} no longer matches the reviewed bank row.`,
  );
  assert(
    cents(original.amount) + cents(reversal.amount) === 0,
    `Cancellation pair ${pair.reference} does not net to zero.`,
  );
  for (const [role, transaction, counterpart] of [
    ["original_send", original, reversal],
    ["reversal", reversal, original],
  ]) {
    const sourceData = sourceObject(transaction.source_data);
    const easyWeb = sourceObject(sourceData.easyweb_e_transfer_evidence);
    assert(
      easyWeb.status === pair.evidenceStatus,
      `EasyWeb evidence for ${pair.reference} does not confirm ${pair.evidenceStatus}.`,
    );
    const reason =
      `${pair.original.description} and ${pair.reversal.description} share ` +
      `reference ${pair.reference}, equal $${pair.amount.toFixed(2)} amounts, ` +
      `and net to zero. TD EasyWeb reports ${pair.evidenceStatus}.`;
    const desired = {
      transaction_type: "transfer",
      is_transfer: true,
      review_status: "reconciled",
      notes:
        `Cancelled/reclaimed Interac e-transfer ***${pair.reference}; ` +
        "fully reversed and excluded from operating income and expenses.",
      source_data: {
        ...sourceData,
        cancelled_e_transfer: {
          status: "cancelled",
          confirmation_suffix: pair.reference,
          counterparty: pair.counterparty,
          amount: pair.amount,
          role,
          paired_transaction_id: counterpart.id,
          original_transaction_id: original.id,
          reversal_transaction_id: reversal.id,
          evidence_status: pair.evidenceStatus,
          evidence_source:
            easyWeb.source ??
            "TD EasyWeb Interac e-Transfer history viewed 2026-07-30",
          confirmed_on: CONFIRMED_ON,
        },
      },
    };
    planned.push({ transaction, desired, reason });
  }
}

const updateCount = planned.filter(({ transaction, desired }) =>
  changed(transaction, desired),
).length;
console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      pairs: PAIRS.length,
      transaction_updates: updateCount,
      net_effect: 0,
    },
    null,
    2,
  ),
);
if (!APPLY) process.exit(0);

for (const { transaction, desired, reason } of planned) {
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
    reason,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const verification = await db
  .from("financial_transactions")
  .select(
    "id,amount,transaction_type,is_transfer,review_status,notes,source_data",
  )
  .in("id", transactionIds);
if (verification.error) throw verification.error;
assert(
  verification.data.length === transactionIds.length &&
    verification.data.every(
      (transaction) =>
        transaction.transaction_type === "transfer" &&
        transaction.is_transfer === true &&
        transaction.review_status === "reconciled" &&
        transaction.source_data?.cancelled_e_transfer?.status === "cancelled",
    ),
  "Post-apply cancellation verification failed.",
);
console.log(
  JSON.stringify(
    {
      applied: true,
      pairs_verified: PAIRS.map((pair) => ({
        reference: pair.reference,
        counterparty: pair.counterparty,
        amount: pair.amount,
        net_effect: 0,
      })),
    },
    null,
    2,
  ),
);
