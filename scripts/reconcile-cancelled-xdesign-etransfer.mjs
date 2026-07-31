#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CONFIRMATION_SUFFIX = "9ck";
const COUNTERPARTY = "XDesign Dev Inc";

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

function sourceRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
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
  env.SUPABASE_URL ??
  env.NEXT_PUBLIC_SUPABASE_URL ??
  env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== TARGET_PROJECT_REF) {
  throw new Error(
    `Refusing reconciliation for unexpected project ${projectRef}.`,
  );
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const applyChanges = process.argv.includes("--apply");

const transactionResult = await db
  .from("financial_transactions")
  .select(
    "id,posted_on,description,counterparty,amount,net_amount,tax_amount,transaction_type,category,is_transfer,review_status,notes,source_data",
  )
  .ilike("description", `%***${CONFIRMATION_SUFFIX}%`)
  .order("posted_on", { ascending: true });
if (transactionResult.error) throw transactionResult.error;

const transactions = transactionResult.data ?? [];
const original = transactions.find(
  (transaction) =>
    transaction.description === `SEND E-TFR ***${CONFIRMATION_SUFFIX}` &&
    Number(transaction.amount) < 0,
);
const reversal = transactions.find(
  (transaction) =>
    transaction.description === `CANCEL E-TFR ***${CONFIRMATION_SUFFIX}` &&
    Number(transaction.amount) > 0,
);

if (!original || !reversal || transactions.length !== 2) {
  throw new Error("Expected one original send and one cancellation reversal.");
}
if (
  original.counterparty !== COUNTERPARTY ||
  reversal.counterparty !== COUNTERPARTY ||
  Math.abs(Number(original.amount) + Number(reversal.amount)) >= 0.005
) {
  throw new Error(
    "Cancelled XDesign transfer identity or amount does not balance.",
  );
}
if (
  sourceRecord(original.source_data).easyweb_e_transfer_evidence?.status !==
    "Cancelled" ||
  sourceRecord(reversal.source_data).easyweb_e_transfer_evidence?.status !==
    "Cancelled"
) {
  throw new Error("EasyWeb evidence does not confirm cancellation.");
}

const transactionIds = [original.id, reversal.id];
const [paymentRecordResult, allocationResult] = await Promise.all([
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
if (paymentRecordResult.error) throw paymentRecordResult.error;
if (allocationResult.error) throw allocationResult.error;
if (
  (paymentRecordResult.data ?? []).length ||
  (allocationResult.data ?? []).length
) {
  throw new Error(
    "Refusing to cancel a transfer with payment evidence attached.",
  );
}

const reconciledAt = new Date().toISOString();
const updates = [
  {
    transaction: original,
    role: "original_send",
    pairedTransactionId: reversal.id,
  },
  {
    transaction: reversal,
    role: "cancellation_reversal",
    pairedTransactionId: original.id,
  },
];

if (applyChanges) {
  for (const { transaction, role, pairedTransactionId } of updates) {
    const updateResult = await db
      .from("financial_transactions")
      .update({
        category: "Subcontractors",
        transaction_type: "transfer",
        is_transfer: true,
        review_status: "reconciled",
        notes:
          `Cancelled Interac e-transfer ***${CONFIRMATION_SUFFIX}; fully reversed ` +
          `and excluded from operating income and expenses.`,
        source_data: {
          ...sourceRecord(transaction.source_data),
          cancelled_e_transfer: {
            status: "cancelled",
            confirmation_suffix: CONFIRMATION_SUFFIX,
            counterparty: COUNTERPARTY,
            amount: Math.abs(Number(original.amount)),
            role,
            paired_transaction_id: pairedTransactionId,
            original_transaction_id: original.id,
            reversal_transaction_id: reversal.id,
            evidence_source:
              "TD EasyWeb Interac e-Transfer history viewed 2026-07-30",
            reconciled_at: reconciledAt,
          },
        },
      })
      .eq("id", transaction.id);
    if (updateResult.error) throw updateResult.error;
  }
}

const verificationResult = applyChanges
  ? await db
      .from("financial_transactions")
      .select(
        "id,description,amount,transaction_type,category,is_transfer,review_status,notes,source_data",
      )
      .in("id", transactionIds)
      .order("posted_on", { ascending: true })
  : { data: transactions, error: null };
if (verificationResult.error) throw verificationResult.error;

if (
  applyChanges &&
  ((verificationResult.data ?? []).length !== 2 ||
    (verificationResult.data ?? []).some(
      (transaction) =>
        transaction.category !== "Subcontractors" ||
        transaction.transaction_type !== "transfer" ||
        transaction.is_transfer !== true ||
        transaction.review_status !== "reconciled" ||
        transaction.source_data?.cancelled_e_transfer?.status !== "cancelled",
    ))
) {
  throw new Error("Post-apply cancelled transfer verification failed.");
}

console.log(
  JSON.stringify(
    {
      mode: applyChanges ? "applied" : "read-only",
      project_ref: projectRef,
      confirmation_suffix: CONFIRMATION_SUFFIX,
      counterparty: COUNTERPARTY,
      original_transaction_id: original.id,
      reversal_transaction_id: reversal.id,
      amount: Math.abs(Number(original.amount)),
      net_effect: Number(original.amount) + Number(reversal.amount),
      excluded_from_operating_results: true,
      transactions: verificationResult.data ?? [],
    },
    null,
    2,
  ),
);
