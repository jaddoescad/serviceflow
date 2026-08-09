#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const now = new Date().toISOString();

function envFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      let value = line.slice(i + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      return [line.slice(0, i).trim(), value];
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

const { data: transactions, error } = await db.from("transactions")
  .select("id,posted_on,description,counterparty,amount_cents,category,review_status,notes,metadata,allocations:transaction_allocations(*)")
  .gte("posted_on", "2026-01-01")
  .lte("posted_on", "2026-12-31")
  .eq("review_status", "needs_review");
if (error) throw error;

function supported(transaction) {
  const counterparty = String(transaction.counterparty ?? "").toLowerCase();
  if (transaction.category === "Bank fees") return true;
  if (transaction.category === "Interest & charges") return true;
  if (transaction.category === "Insurance") return counterparty.includes("imperial pfs") || counterparty.includes("workplace safety");
  if (transaction.category === "Taxes & licences") return counterparty.includes("canada txd");
  if (transaction.category === "Waste & disposal") return counterparty.includes("waste connections");
  return false;
}

const candidates = transactions.filter((transaction) => supported(transaction) &&
  (transaction.allocations ?? []).filter((row) => !row.reversed_at).length === 0 &&
  Number(transaction.amount_cents) < 0);

const preview = candidates.map((transaction) => ({
  id: transaction.id,
  posted_on: transaction.posted_on,
  counterparty: transaction.counterparty,
  amount_cents: transaction.amount_cents,
  category: transaction.category,
}));

if (!APPLY) {
  console.log(JSON.stringify({ mode: "dry-run", count: preview.length, transactions: preview }, null, 2));
  process.exit(0);
}

for (const transaction of candidates) {
  const update = await db.from("transactions").update({
    review_status: "reconciled",
    tax_cents: 0,
    net_cents: Math.abs(Number(transaction.amount_cents)),
    metadata: {
      ...(transaction.metadata ?? {}),
      expense_evidence: {
        status: "bank_supported_no_itc",
        evidence: "bank_transaction",
        category: transaction.category,
        itc_tax_cents: 0,
        job_allocation: "not_applicable_company_overhead",
        reconciled_at: now,
        reason: "The bank record proves this unambiguous recurring overhead payment; no supplier invoice is on file, so no HST input tax credit is claimed.",
      },
    },
    updated_at: now,
  }).eq("id", transaction.id).eq("review_status", "needs_review");
  if (update.error) throw update.error;
}

const { data: verified, error: verifyError } = await db.from("transactions").select("id,review_status,tax_cents,metadata").in("id", candidates.map((row) => row.id));
if (verifyError) throw verifyError;
if (verified.length !== candidates.length || verified.some((row) => row.review_status !== "reconciled" || Number(row.tax_cents) !== 0 || row.metadata?.expense_evidence?.status !== "bank_supported_no_itc")) {
  throw new Error("Post-write overhead verification failed.");
}

console.log(JSON.stringify({ mode: "applied", count: preview.length, transactions: preview }, null, 2));
