#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FROM = process.argv.find((argument) => argument.startsWith("--from="))?.slice(7) ?? "2026-08-01";
const TO = process.argv.find((argument) => argument.startsWith("--to="))?.slice(5) ?? "2026-08-25";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

async function fetchAll(queryFactory) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const result = await queryFactory().range(from, from + 999);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < 1000) return rows;
  }
}

const LABOUR = new Set(["Subcontractors", "Payroll", "Payroll taxes", "Colour consultation", "Pressure washing"]);
const MATERIAL = new Set(["Paint & materials", "Waste & disposal"]);
const OTHER = new Set(["Uncategorized", "HST remittance", "Tax payment", "Taxes & licences", "Taxes & licenses", "Customer refunds", "Owner draw"]);

function bucket(category) {
  if (LABOUR.has(category)) return "Labour";
  if (MATERIAL.has(category)) return "Material";
  if (OTHER.has(category)) return "Other";
  return "Overhead";
}

function isCancelledEvidence(row) {
  const metadata = row.metadata ?? {};
  return metadata.cancelled_e_transfer?.status === "cancelled" ||
    metadata.reconciliation_research?.status === "cancelled" ||
    metadata.document_exception?.kind === "cancelled_transfer";
}

const env = {
  ...parseEnvFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.join(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const rows = await fetchAll(() => db.from("transactions")
  .select("id,posted_on,description,counterparty,amount_cents,category,transaction_type,is_transfer,review_status,notes,metadata,account:accounts(slug,name,last_four)")
  .gte("posted_on", FROM)
  .lte("posted_on", TO)
  .order("posted_on")
  .order("id"));

const exclusions = rows.filter((row) => Number(row.amount_cents) < 0 && (row.is_transfer || isCancelledEvidence(row)));
const spendingRows = rows.filter((row) => Number(row.amount_cents) < 0 && !row.is_transfer && !isCancelledEvidence(row));
const groups = new Map(["Labour", "Material", "Overhead", "Other"].map((name) => [name, { name, cents: 0, rows: 0, needsReviewCents: 0, needsReviewRows: 0, categories: new Map() }]));
for (const row of spendingRows) {
  const amountCents = Math.abs(Number(row.amount_cents));
  const group = groups.get(bucket(row.category));
  group.cents += amountCents;
  group.rows += 1;
  if (row.review_status !== "reconciled") {
    group.needsReviewCents += amountCents;
    group.needsReviewRows += 1;
  }
  const category = row.category ?? "Uncategorized";
  group.categories.set(category, (group.categories.get(category) ?? 0) + amountCents);
}
const totalCents = [...groups.values()].reduce((total, group) => total + group.cents, 0);
const summary = [...groups.values()].map((group) => ({
  bucket: group.name,
  cents: group.cents,
  percent: totalCents ? Math.round(group.cents / totalCents * 10000) / 100 : 0,
  rows: group.rows,
  needs_review_cents: group.needsReviewCents,
  needs_review_rows: group.needsReviewRows,
  categories: [...group.categories.entries()]
    .map(([category, cents]) => ({ category, cents, percent_of_total: totalCents ? Math.round(cents / totalCents * 10000) / 100 : 0 }))
    .sort((left, right) => right.cents - left.cents),
}));

console.log(JSON.stringify({
  period: { from: FROM, to: TO },
  posted_through: rows.map((row) => row.posted_on).sort().at(-1) ?? null,
  transaction_rows: rows.length,
  spending_rows: spendingRows.length,
  total_spent_cents: totalCents,
  summary,
  excluded_internal_or_cancelled: exclusions.map((row) => ({
    id: row.id,
    posted_on: row.posted_on,
    description: row.description,
    amount_cents: row.amount_cents,
    category: row.category,
    reason: row.is_transfer ? "internal transfer" : "cancelled/reclaimed transfer",
  })),
  unresolved_outflows: spendingRows
    .filter((row) => row.review_status !== "reconciled")
    .map((row) => ({
      id: row.id,
      posted_on: row.posted_on,
      description: row.description,
      counterparty: row.counterparty,
      amount_cents: Math.abs(Number(row.amount_cents)),
      category: row.category,
      bucket: bucket(row.category),
      review_status: row.review_status,
    }))
    .sort((left, right) => right.amount_cents - left.amount_cents),
}, null, 2));
