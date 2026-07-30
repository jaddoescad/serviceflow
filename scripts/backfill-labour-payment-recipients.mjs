#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const RECONCILIATION_SOURCE =
  "OP Accounts 2025.xlsx reconciled with e-transfer reports";

const recipientMappings = new Map([
  ["Jad Mroueh", "Jad Mroueh"],
  ["Polaris Painting Ottawa", "Polaris Painters"],
  ["Painttastic Pro", "PaintTastic Pro Inc"],
  ["Phil Hyde", "Phillip Hyde"],
  [
    "Philippe Goulet (Pgoul075@Uottawa.Ca)",
    "Goulet Contracting & Painting Inc.",
  ],
  ["Scott Madden", "Scott Madden"],
  ["Katrina O’Neill (613Painting)", "613PAINTING INC"],
]);

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

function normalizedName(value) {
  return value.trim().toLocaleLowerCase("en-CA");
}

function sourceRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const env = {
  ...parseEnvFile(
    path.resolve(repoRoot, "../Ottawa Painters App/.env.local"),
  ),
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
  throw new Error(`Refusing backfill for unexpected project ${projectRef}.`);
}

const applyChanges = process.argv.includes("--apply");
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [contractorsResult, transactionsResult, existingRecordsResult] =
  await Promise.all([
    db.from("labour_contractors").select("id,supplier_name"),
    db
      .from("financial_transactions")
      .select(
        "id,posted_on,counterparty,description,amount,source_data,review_status",
      )
      .eq("category", "Subcontractors")
      .eq("transaction_type", "expense")
      .eq("is_transfer", false)
      .lt("amount", 0)
      .eq("review_status", "reconciled")
      .in("counterparty", [...recipientMappings.keys()])
      .order("posted_on", { ascending: true }),
    db
      .from("labour_payment_records")
      .select("financial_transaction_id,contractor_id,recipient_status"),
  ]);

if (contractorsResult.error) throw contractorsResult.error;
if (transactionsResult.error) throw transactionsResult.error;
if (existingRecordsResult.error) throw existingRecordsResult.error;

const candidates = (transactionsResult.data ?? []).filter(
  (transaction) =>
    sourceRecord(transaction.source_data).counterparty_source ===
    RECONCILIATION_SOURCE,
);

if (candidates.length !== 41) {
  throw new Error(
    `Expected 41 independently reconciled outgoing payments; found ${candidates.length}.`,
  );
}

const contractorByName = new Map(
  (contractorsResult.data ?? []).map((contractor) => [
    normalizedName(contractor.supplier_name),
    contractor,
  ]),
);
const missingSupplierNames = [
  ...new Set(
    [...recipientMappings.values()].filter(
      (supplierName) => !contractorByName.has(normalizedName(supplierName)),
    ),
  ),
];

if (applyChanges && missingSupplierNames.length) {
  const insertResult = await db
    .from("labour_contractors")
    .insert(
      missingSupplierNames.map((supplierName) => ({
        supplier_name: supplierName,
        notes:
          "Created from an independently reconciled bank/e-transfer recipient.",
      })),
    )
    .select("id,supplier_name");
  if (insertResult.error) throw insertResult.error;
  for (const contractor of insertResult.data ?? []) {
    contractorByName.set(normalizedName(contractor.supplier_name), contractor);
  }
}

const existingTransactionIds = new Set(
  (existingRecordsResult.data ?? []).map(
    (record) => record.financial_transaction_id,
  ),
);
const plannedRecords = candidates
  .filter((transaction) => !existingTransactionIds.has(transaction.id))
  .map((transaction) => {
    const supplierName = recipientMappings.get(transaction.counterparty);
    const contractor = supplierName
      ? contractorByName.get(normalizedName(supplierName))
      : null;
    if (!contractor && applyChanges) {
      throw new Error(
        `Missing contractor identity for ${transaction.counterparty}.`,
      );
    }
    return {
      financial_transaction_id: transaction.id,
      contractor_id: contractor?.id ?? "[create contractor]",
      recipient_status: "confirmed",
      confirmation_method: "bank_record",
      confirmation_note: `Recipient confirmed by ${RECONCILIATION_SOURCE}.`,
      confirmed_at: new Date().toISOString(),
    };
  });

if (applyChanges && plannedRecords.length) {
  const insertResult = await db
    .from("labour_payment_records")
    .insert(plannedRecords);
  if (insertResult.error) throw insertResult.error;
}

const verificationResult = applyChanges
  ? await db
      .from("labour_payment_verification")
      .select(
        "financial_transaction_id,recipient_status,payment_status,unallocated_amount",
      )
      .in(
        "financial_transaction_id",
        candidates.map((transaction) => transaction.id),
      )
  : { data: [], error: null };
if (verificationResult.error) throw verificationResult.error;

const verifiedRows = verificationResult.data ?? [];
if (
  applyChanges &&
  (verifiedRows.length !== candidates.length ||
    verifiedRows.some((row) => row.recipient_status !== "confirmed"))
) {
  throw new Error("Post-backfill recipient verification failed.");
}

console.log(
  JSON.stringify(
    {
      mode: applyChanges ? "applied" : "dry-run",
      project_ref: projectRef,
      reconciliation_source: RECONCILIATION_SOURCE,
      candidate_payment_count: candidates.length,
      existing_payment_record_count:
        candidates.length - plannedRecords.length,
      inserted_payment_record_count: applyChanges ? plannedRecords.length : 0,
      planned_payment_record_count: plannedRecords.length,
      created_contractors: applyChanges ? missingSupplierNames : [],
      recipient_counts: Object.entries(
        candidates.reduce((counts, transaction) => {
          counts[transaction.counterparty] =
            (counts[transaction.counterparty] ?? 0) + 1;
          return counts;
        }, {}),
      )
        .map(([counterparty, payment_count]) => ({
          counterparty,
          contractor: recipientMappings.get(counterparty),
          payment_count,
        }))
        .sort((left, right) =>
          left.counterparty.localeCompare(right.counterparty, "en-CA"),
        ),
      verified_status_counts: verifiedRows.reduce((counts, row) => {
        counts[row.payment_status] = (counts[row.payment_status] ?? 0) + 1;
        return counts;
      }, {}),
    },
    null,
    2,
  ),
);
