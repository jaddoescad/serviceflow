#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const EXPECTED_ROWS = 29;
const EXPECTED_GROSS = 5584.25;
const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);

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

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function assertResult(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey)
  throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF)
  throw new Error("Unexpected Supabase project.");
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [transactionsResult, allocationsResult] = await Promise.all([
  db
    .from("financial_transactions")
    .select(
      "id,posted_on,counterparty,description,amount,tax_amount,net_amount,source_data",
    )
    .in("category", ["Paint & materials", "Materials"])
    .gte("posted_on", "2026-01-01")
    .lte("posted_on", "2026-12-31")
    .lt("amount", 0),
  db
    .from("material_payment_allocations")
    .select("financial_transaction_id")
    .is("reversed_at", null),
]);
const transactions = assertResult("transactions", transactionsResult);
const allocatedIds = new Set(
  assertResult("allocations", allocationsResult).map(
    (row) => row.financial_transaction_id,
  ),
);
const rows = transactions.filter((row) => !allocatedIds.has(row.id));
const gross = roundMoney(
  rows.reduce((sum, row) => sum + Math.abs(Number(row.amount)), 0),
);
if (rows.length !== EXPECTED_ROWS || gross !== EXPECTED_GROSS) {
  throw new Error(
    `Confirmed material scope changed: found ${rows.length} rows / $${gross.toFixed(2)}, expected ${EXPECTED_ROWS} / $${EXPECTED_GROSS.toFixed(2)}.`,
  );
}

const tax = roundMoney(
  rows.reduce((sum, row) => sum + (Math.abs(Number(row.amount)) * 13) / 113, 0),
);
console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      rows: rows.length,
      gross,
      before_hst: roundMoney(gross - tax),
      estimated_hst: tax,
      vendors: Object.entries(
        rows.reduce((groups, row) => {
          const name = row.counterparty || row.description;
          groups[name] = roundMoney(
            (groups[name] ?? 0) + Math.abs(Number(row.amount)),
          );
          return groups;
        }, {}),
      ).sort((a, b) => b[1] - a[1]),
    },
    null,
    2,
  ),
);
if (!APPLY) {
  console.log("Dry run only. Re-run with --apply.");
  process.exit(0);
}

const now = new Date().toISOString();
for (const row of rows) {
  const rowTax = roundMoney((Math.abs(Number(row.amount)) * 13) / 113);
  assertResult(
    `transaction ${row.id}`,
    await db
      .from("financial_transactions")
      .update({
        tax_amount: -rowTax,
        source_data: {
          ...(row.source_data ?? {}),
          tax_evidence: {
            status: "estimated",
            rate: 0.13,
            jurisdiction: "Ontario",
            source: "Ottawa Painters administrator confirmation",
            confirmed_on: "2026-08-02",
            reason:
              "13% HST confirmed for internal job-cost and management metrics; supplier receipt remains outstanding for CRA ITC support.",
          },
        },
        updated_at: now,
      })
      .eq("id", row.id),
  );
}

console.log(
  "Applied estimated 13% HST to the confirmed unmatched material-payment scope.",
);
