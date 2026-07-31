#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";

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
  return Math.round(Math.abs(Number(value ?? 0)) * 100);
}

const requestedAmounts = process.argv
  .slice(2)
  .map(Number)
  .filter(Number.isFinite);
if (!requestedAmounts.length) {
  throw new Error(
    "Provide one or more absolute amounts, for example: 193.78 359.62",
  );
}
const requestedCents = new Set(requestedAmounts.map(cents));

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
  throw new Error(`Refusing audit for unexpected project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const transactions = [];
const pageSize = 1000;
for (let page = 0; page < 100; page += 1) {
  const from = page * pageSize;
  const result = await db
    .from("financial_transactions")
    .select(
      "id,posted_on,transaction_on,description,counterparty,amount,tax_amount,net_amount,currency,category,transaction_type,is_transfer,review_status,notes,source_data,financial_accounts(name,last_four),financial_imports(original_filename,source_kind)",
    )
    .range(from, from + pageSize - 1);
  if (result.error) throw result.error;
  transactions.push(...(result.data ?? []));
  if ((result.data?.length ?? 0) < pageSize) break;
}

const matches = transactions
  .filter((transaction) => requestedCents.has(cents(transaction.amount)))
  .sort(
    (left, right) =>
      left.posted_on.localeCompare(right.posted_on) ||
      Number(left.amount) - Number(right.amount),
  )
  .map((transaction) => ({
    id: transaction.id,
    posted_on: transaction.posted_on,
    transaction_on: transaction.transaction_on,
    description: transaction.description,
    counterparty: transaction.counterparty,
    amount: Number(transaction.amount),
    tax_amount: Number(transaction.tax_amount),
    net_amount: Number(transaction.net_amount),
    currency: transaction.currency,
    category: transaction.category,
    transaction_type: transaction.transaction_type,
    is_transfer: transaction.is_transfer,
    review_status: transaction.review_status,
    account_name: transaction.financial_accounts?.name ?? null,
    account_last_four: transaction.financial_accounts?.last_four ?? null,
    source_filename: transaction.financial_imports?.original_filename ?? null,
    source_kind: transaction.financial_imports?.source_kind ?? null,
    notes: transaction.notes,
    bank_evidence:
      transaction.source_data?.easyweb_e_transfer_evidence ??
      transaction.source_data?.td_interac_email_evidence ??
      null,
  }));

console.log(
  JSON.stringify(
    {
      project_ref: projectRef,
      requested_amounts: requestedAmounts,
      matches,
    },
    null,
    2,
  ),
);
