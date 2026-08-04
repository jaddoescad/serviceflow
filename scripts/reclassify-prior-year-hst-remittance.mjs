#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const TRANSACTION_ID = "de2898e6-6eed-4215-8610-d92cd2cb93f4";
const APPLY = process.argv.includes("--apply");

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertResult(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
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
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing Supabase credentials.");
assert(
  new URL(supabaseUrl).hostname.split(".")[0] === TARGET_PROJECT_REF,
  "Unexpected Supabase project.",
);
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const transaction = assertResult(
  "transaction lookup",
  await db
    .from("financial_transactions")
    .select(
      "id,posted_on,description,counterparty,amount,tax_amount,category,transaction_type,is_transfer,review_status,notes,source_data",
    )
    .eq("id", TRANSACTION_ID)
    .single(),
);
assert(
  transaction.posted_on === "2026-06-26" &&
    transaction.description === "CANADA TXD" &&
    Number(transaction.amount) === -9822.55 &&
    Number(transaction.tax_amount) === 0 &&
    transaction.transaction_type === "expense" &&
    transaction.is_transfer === false &&
    ["Taxes & licences", "HST remittance"].includes(transaction.category),
  "The confirmed HST remittance bank row changed.",
);

const desired = {
  category: "HST remittance",
  review_status: "reconciled",
  notes:
    "Ottawa Painters confirmed this $9,822.55 payment settled the prior year's HST liability. It remains in bank cash flow but is excluded from 2026 operating costs and profit.",
  source_data: {
    ...(transaction.source_data ?? {}),
    accounting_classification: {
      classification: "prior_year_hst_remittance",
      source: "Ottawa Painters administrator confirmation",
      confirmed_on: "2026-08-02",
      reason:
        "Payment settled prior-year HST payable; it is a liability payment, not a 2026 operating expense or input tax credit.",
    },
    document_exception: {
      status: "confirmed",
      label: "Prior-year HST remittance",
      detail:
        "Administrator-confirmed payment of prior-year HST payable. The posted bank record is the cash evidence; no supplier invoice applies.",
    },
  },
};

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      transaction_id: TRANSACTION_ID,
      posted_on: transaction.posted_on,
      amount: Math.abs(Number(transaction.amount)),
      old_category: transaction.category,
      new_category: desired.category,
      operating_profit_effect: 9822.55,
    },
    null,
    2,
  ),
);
if (!APPLY) {
  console.log("Dry run only. Re-run with --apply.");
  process.exit(0);
}

assertResult(
  "transaction update",
  await db
    .from("financial_transactions")
    .update({ ...desired, updated_at: new Date().toISOString() })
    .eq("id", TRANSACTION_ID),
);

const verified = assertResult(
  "transaction verification",
  await db
    .from("financial_transactions")
    .select("id,amount,category,is_transfer,review_status,source_data")
    .eq("id", TRANSACTION_ID)
    .single(),
);
assert(
  verified.category === "HST remittance" &&
    verified.is_transfer === false &&
    verified.review_status === "reconciled" &&
    verified.source_data?.accounting_classification?.classification ===
      "prior_year_hst_remittance" &&
    verified.source_data?.document_exception?.status === "confirmed",
  "Post-apply HST remittance verification failed.",
);
console.log("Reclassified prior-year HST remittance successfully.");
