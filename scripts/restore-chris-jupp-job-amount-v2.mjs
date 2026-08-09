#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const JOB_ID = "e4758c1f-6bdb-59bd-9f31-7b4f0f8e672b";
const SOURCE_BUDGET_ID = "77711b57-46bd-57cb-ad5a-85e944d22db3";
const MISTAKEN_MANUAL_BUDGET_ID = "6f447caa-a224-5b3a-871d-44dab1dc59e7";
const SOURCE_JOB_AMOUNT_CENTS = 280700;
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function envFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      return [line.slice(0, index).trim(), value];
    }));
}

const env = {
  ...envFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")),
  ...envFile(path.join(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: budgets, error } = await db.from("job_budgets").select("*")
  .eq("job_id", JOB_ID).in("id", [SOURCE_BUDGET_ID, MISTAKEN_MANUAL_BUDGET_ID]);
if (error) throw error;
const sourceBudget = budgets.find((budget) => budget.id === SOURCE_BUDGET_ID);
const mistakenBudget = budgets.find((budget) => budget.id === MISTAKEN_MANUAL_BUDGET_ID);
if (!sourceBudget || !mistakenBudget) throw new Error("Expected both Chris Jupp budget audit records.");
if (Number(sourceBudget.amount_including_tax_cents) !== SOURCE_JOB_AMOUNT_CENTS || Number(mistakenBudget.amount_including_tax_cents) !== 100000) {
  throw new Error("Chris Jupp budget amounts changed; refusing to continue.");
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  job_id: JOB_ID,
  restore_job_amount_before_hst_cents: SOURCE_JOB_AMOUNT_CENTS,
  resulting_painter_allowance_40_percent_cents: Math.round(SOURCE_JOB_AMOUNT_CENTS * 0.4),
  verified_labour_invoice_cents: 100000,
}, null, 2));
if (!APPLY) process.exit(0);

const now = new Date().toISOString();
const { error: manualError } = await db.from("job_budgets").update({
  status: "superseded",
  closed_at: now,
  metadata: {
    ...(mistakenBudget.metadata ?? {}),
    superseded_at: now,
    superseded_reason: "Reversed immediately after live verification: this field stores customer job amount before HST, not paid labour.",
  },
  updated_at: now,
}).eq("id", MISTAKEN_MANUAL_BUDGET_ID).eq("status", "active");
if (manualError) throw manualError;

const { error: sourceError } = await db.from("job_budgets").update({
  status: "active",
  closed_at: null,
  metadata: {
    ...(sourceBudget.metadata ?? {}),
    reactivated_at: now,
    reactivated_reason: "Source-backed DripJobs customer invoice 474315 subtotal is $2,807 before HST.",
    mistaken_manual_budget_id: MISTAKEN_MANUAL_BUDGET_ID,
  },
  updated_at: now,
}).eq("id", SOURCE_BUDGET_ID).eq("status", "superseded");
if (sourceError) throw sourceError;

const { data: verified, error: verifyError } = await db.from("job_budgets")
  .select("id,source,status,amount_including_tax_cents")
  .eq("job_id", JOB_ID).in("id", [SOURCE_BUDGET_ID, MISTAKEN_MANUAL_BUDGET_ID]);
if (verifyError) throw verifyError;
const active = verified.find((budget) => budget.status === "active");
if (!active || active.id !== SOURCE_BUDGET_ID || Number(active.amount_including_tax_cents) !== SOURCE_JOB_AMOUNT_CENTS) {
  throw new Error("Post-write Chris Jupp job amount verification failed.");
}
console.log(JSON.stringify({ mode: "applied-and-verified", active_budget: active }, null, 2));
