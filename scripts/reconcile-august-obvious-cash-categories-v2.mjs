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
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const decisions = [
  {
    id: "3c81eb37-0bf5-52ec-9146-66ebe5b54084",
    posted_on: "2026-08-06",
    description: "SEND E-TFR ***8WE",
    amount_cents: -50000,
    category: "Virtual assistant salaries",
    counterparty: "Jad Slim",
    review_status: "reconciled",
    notes: "Ottawa Painters administrator confirmed that transfers to the Shakepay funding destination are virtual-assistant payments. EasyWeb verifies this $500 transfer was deposited to Jad Slim's Shakepay funding e-transfer address.",
    evidence: {
      kind: "expense_evidence",
      value: {
        status: "user_confirmed_bank_supported",
        evidence: "td_easyweb_transfer_detail",
        source: "Ottawa Painters administrator confirmation",
        recipient: "Jad Slim",
        recipient_destination: "Shakepay funding e-transfer address",
        category: "Virtual assistant salaries",
        classification: "virtual_assistant_payment_via_shakepay",
        job_allocation: "not_applicable_company_overhead",
        tax_treatment: "no_itc_claimed",
        confirmed_on: "2026-08-20",
      },
    },
  },
  {
    id: "5ac4976d-0148-55a7-80ea-6e1a8066652b",
    posted_on: "2026-08-06",
    description: "SLACK T0B1C250FGT",
    amount_cents: -5052,
    category: "Software & subscriptions",
    counterparty: "Slack",
    review_status: "reconciled",
    notes: "Slack business software subscription confirmed by the Ottawa Painters administrator. Recorded as overhead; no HST input tax credit is claimed without a supplier receipt.",
    evidence: {
      kind: "expense_evidence",
      value: {
        status: "bank_supported_no_itc",
        evidence: "posted_business_credit_card_record",
        source: "Ottawa Painters administrator confirmation",
        vendor: "Slack",
        category: "Software & subscriptions",
        classification: "software_subscription",
        job_allocation: "not_applicable_company_overhead",
        tax_treatment: "no_itc_claimed",
        confirmed_on: "2026-08-20",
      },
    },
  },
  {
    id: "0262391b-93cd-5a9a-8659-36a56a2355d2",
    posted_on: "2026-08-17",
    description: "RANDALLS",
    amount_cents: -51565,
    category: "Paint & materials",
    counterparty: "Randalls",
    review_status: "needs_review",
    notes: "Ottawa Painters administrator confirmed this is paint/materials. Receipt and job/general-supplies allocation remain under review.",
    evidence: {
      kind: "category_evidence",
      value: {
        status: "user_confirmed",
        source: "Ottawa Painters administrator confirmation",
        vendor: "Randalls",
        category: "Paint & materials",
        confirmed_on: "2026-08-20",
        remaining_review: "supplier_document_and_job_or_general_supplies_allocation",
      },
    },
  },
  {
    id: "4ff02602-4f2b-50a7-b603-ca938cf7205a",
    posted_on: "2026-08-18",
    description: "IMPERIAL PFS PAYMENTS CAN",
    amount_cents: -10762,
    category: "Insurance",
    counterparty: "Imperial Pfs",
    review_status: "reconciled",
    notes: "Recurring Imperial PFS insurance-premium financing payment verified from the posted business credit-card record. No HST input tax credit is claimed.",
    evidence: {
      kind: "expense_evidence",
      value: {
        status: "bank_supported_no_itc",
        evidence: "posted_business_credit_card_record_and_recurring_history",
        vendor: "Imperial Pfs",
        category: "Insurance",
        job_allocation: "not_applicable_company_overhead",
        tax_treatment: "no_itc_claimed",
        reconciled_at: now,
      },
    },
  },
];

const { data: rows, error } = await db.from("transactions")
  .select("id,posted_on,description,amount_cents,category,counterparty,review_status,metadata")
  .in("id", decisions.map((decision) => decision.id));
if (error) throw error;
if (rows.length !== decisions.length) throw new Error(`Expected ${decisions.length} exact rows; found ${rows.length}.`);

const preview = decisions.map((decision) => {
  const row = rows.find((candidate) => candidate.id === decision.id);
  if (!row || row.posted_on !== decision.posted_on || row.description !== decision.description || Number(row.amount_cents) !== decision.amount_cents) {
    throw new Error(`Source identity changed for ${decision.id}; refusing to update.`);
  }
  return {
    id: decision.id,
    posted_on: decision.posted_on,
    description: decision.description,
    amount_cents: decision.amount_cents,
    before: { category: row.category, counterparty: row.counterparty, review_status: row.review_status },
    after: { category: decision.category, counterparty: decision.counterparty, review_status: decision.review_status },
  };
});

if (!APPLY) {
  console.log(JSON.stringify({ mode: "dry-run", count: preview.length, transactions: preview }, null, 2));
  process.exit(0);
}

for (const decision of decisions) {
  const row = rows.find((candidate) => candidate.id === decision.id);
  const update = {
    category: decision.category,
    counterparty: decision.counterparty,
    review_status: decision.review_status,
    notes: decision.notes,
    tax_cents: 0,
    metadata: {
      ...(row.metadata ?? {}),
      [decision.evidence.kind]: decision.evidence.value,
    },
    updated_at: now,
  };
  if (decision.review_status === "reconciled") update.net_cents = Math.abs(decision.amount_cents);
  const result = await db.from("transactions").update(update)
    .eq("id", decision.id)
    .eq("posted_on", decision.posted_on)
    .eq("description", decision.description)
    .eq("amount_cents", decision.amount_cents);
  if (result.error) throw result.error;
}

const { data: verified, error: verifyError } = await db.from("transactions")
  .select("id,category,counterparty,review_status,metadata")
  .in("id", decisions.map((decision) => decision.id));
if (verifyError) throw verifyError;
for (const decision of decisions) {
  const row = verified.find((candidate) => candidate.id === decision.id);
  if (!row || row.category !== decision.category || row.counterparty !== decision.counterparty || row.review_status !== decision.review_status || !row.metadata?.[decision.evidence.kind]) {
    throw new Error(`Post-write verification failed for ${decision.id}.`);
  }
}

console.log(JSON.stringify({ mode: "applied", count: preview.length, transactions: preview }, null, 2));
