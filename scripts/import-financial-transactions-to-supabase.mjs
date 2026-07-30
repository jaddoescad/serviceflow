#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

globalThis.WebSocket = WebSocket;
const { createClient } = await import("@supabase/supabase-js");

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

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function optionValue(flag) {
  const inline = process.argv.find((argument) => argument.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.resolve(
  optionValue("--manifest") ?? "/tmp/ottawa-painters-financials-manifest.json",
);
const apply = process.argv.includes("--apply");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl =
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== manifest.project_ref) {
  throw new Error(
    `Refusing import: manifest project ${manifest.project_ref} does not match ${projectRef}.`,
  );
}
if (
  !Array.isArray(manifest.checks) ||
  manifest.checks.some((check) => check.status !== "pass")
) {
  throw new Error("Refusing import because the manifest has a failed reconciliation check.");
}

const sourceKeys = manifest.transactions.map((transaction) => transaction.source_key);
if (sourceKeys.length !== new Set(sourceKeys).size) {
  throw new Error("Refusing import because source_key values are not unique.");
}
const importHashes = new Set(manifest.imports.map((item) => item.content_sha256));
for (const transaction of manifest.transactions) {
  if (!importHashes.has(transaction.source_sha256)) {
    throw new Error(`Transaction source is missing from imports: ${transaction.source_key}`);
  }
}

const preview = {
  mode: apply ? "apply" : "dry-run",
  projectRef,
  sourceThread: manifest.thread_id,
  accounts: manifest.accounts.length,
  documents: manifest.imports.length,
  transactions: manifest.transactions.length,
  summary: manifest.summary,
  reconciliationChecks: manifest.checks.length,
};
console.log(JSON.stringify(preview, null, 2));
if (!apply) process.exit(0);

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const accountResult = await db
  .from("financial_accounts")
  .upsert(manifest.accounts, { onConflict: "slug" })
  .select("id,slug");
if (accountResult.error) {
  throw new Error(`Financial account import failed: ${accountResult.error.message}`);
}
const accountIdBySlug = new Map(
  (accountResult.data ?? []).map((account) => [account.slug, account.id]),
);
if (accountIdBySlug.size !== manifest.accounts.length) {
  throw new Error("Not every financial account returned an ID.");
}

const importRows = manifest.imports.map(({ account_slug: accountSlug, ...item }) => ({
  ...item,
  account_id: accountSlug ? accountIdBySlug.get(accountSlug) : null,
}));
const importResult = await db
  .from("financial_imports")
  .upsert(importRows, { onConflict: "content_sha256" })
  .select("id,content_sha256");
if (importResult.error) {
  throw new Error(`Financial source import failed: ${importResult.error.message}`);
}
const importIdByHash = new Map(
  (importResult.data ?? []).map((item) => [item.content_sha256, item.id]),
);
if (importIdByHash.size !== manifest.imports.length) {
  throw new Error("Not every financial source returned an ID.");
}

const transactionRows = manifest.transactions.map(
  ({ account_slug: accountSlug, source_sha256: sourceSha256, ...transaction }) => ({
    ...transaction,
    account_id: accountIdBySlug.get(accountSlug),
    import_id: importIdByHash.get(sourceSha256),
  }),
);
let upserted = 0;
for (const rows of chunk(transactionRows, 100)) {
  const result = await db
    .from("financial_transactions")
    .upsert(rows, { onConflict: "source_key" })
    .select("id");
  if (result.error) {
    throw new Error(`Financial transaction import failed: ${result.error.message}`);
  }
  upserted += result.data?.length ?? 0;
}

const importIds = [...importIdByHash.values()];
const remoteResult = await db
  .from("financial_transactions")
  .select(
    "id,posted_on,amount,tax_amount,net_amount,category,is_transfer,account_id,import_id",
  )
  .in("import_id", importIds)
  .limit(1000);
if (remoteResult.error) {
  throw new Error(`Financial import verification failed: ${remoteResult.error.message}`);
}
const remoteTransactions = remoteResult.data ?? [];
if (remoteTransactions.length !== manifest.transactions.length) {
  throw new Error(
    `Remote transaction count mismatch: expected ${manifest.transactions.length}, got ${remoteTransactions.length}.`,
  );
}

const remote2025 = remoteTransactions.filter(
  (transaction) =>
    transaction.posted_on.startsWith("2025-") && !transaction.is_transfer,
);
const remoteSummary = {
  netRevenue: roundMoney(
    remote2025
      .filter((transaction) => transaction.category === "Painting revenue")
      .reduce((sum, transaction) => sum + Number(transaction.net_amount), 0),
  ),
  netExpenses: roundMoney(
    -remote2025
      .filter((transaction) => transaction.category !== "Painting revenue")
      .reduce((sum, transaction) => sum + Number(transaction.net_amount), 0),
  ),
  netIncome: roundMoney(
    remote2025.reduce((sum, transaction) => sum + Number(transaction.net_amount), 0),
  ),
  hstPayable: roundMoney(
    remote2025.reduce((sum, transaction) => sum + Number(transaction.tax_amount), 0),
  ),
};

const expectedSummary = {
  netRevenue: Number(manifest.summary["2025_net_revenue"]),
  netExpenses: Number(manifest.summary["2025_net_expenses"]),
  netIncome: Number(manifest.summary["2025_net_income"]),
  hstPayable: Number(manifest.summary["2025_hst_payable"]),
};
for (const key of Object.keys(expectedSummary)) {
  if (remoteSummary[key] !== expectedSummary[key]) {
    throw new Error(
      `Remote ${key} mismatch: expected ${expectedSummary[key]}, got ${remoteSummary[key]}.`,
    );
  }
}

console.log(
  JSON.stringify(
    {
      accountsUpserted: accountResult.data?.length ?? 0,
      documentsUpserted: importResult.data?.length ?? 0,
      transactionsUpserted: upserted,
      remoteTransactionCount: remoteTransactions.length,
      remote2025Summary: remoteSummary,
      status: "verified",
    },
    null,
    2,
  ),
);
