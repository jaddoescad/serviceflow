#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const CONFIRMED_ON = "2026-07-31";
const APPLY = process.argv.includes("--apply");
const GOOGLE_WORKSPACE_PAYMENT_EVIDENCE = new Map([
  [
    "e3a409ca-7099-47be-b363-42b3abf3ccaf",
    {
      gmail_message_id: "19c61a7016b3c324",
      payment_date: "2026-02-15",
      amount: 62.38,
      payments_profile_id: "6126-0365-9633",
      source: "Google Payments email",
    },
  ],
]);

const SOFTWARE_VENDORS = [
  { name: "DripJobs CRM", terms: ["dripjobs"] },
  { name: "CompanyCam", terms: ["companycam"] },
  { name: "QuickBooks Online", terms: ["qbooks", "quickbooks", "intuit"] },
  { name: "Perspective Software", terms: ["perspective software"] },
  {
    name: "Google Workspace",
    terms: ["google*workspace", "workspace_pain", "google workspace"],
  },
  { name: "Zapier", terms: ["zapier"] },
  { name: "Connecteam", terms: ["connecteam"] },
  { name: "OpenAI", terms: ["openai", "chatgpt"] },
  { name: "Slack", terms: ["slack"] },
  { name: "CapCut", terms: ["capcut"] },
];

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

function vendorFor(transaction) {
  const text = [
    transaction.description,
    transaction.counterparty,
    transaction.source_data?.merchant_name,
    transaction.source_data?.original_description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-CA");
  return (
    SOFTWARE_VENDORS.find((vendor) =>
      vendor.terms.some((term) => text.includes(term)),
    ) ?? null
  );
}

function cents(value) {
  return Math.round(Number(value) * 100);
}

function evidenceNote(vendor, isCredit) {
  return isCredit
    ? `${vendor} software-subscription credit verified from the posted business credit-card record. It offsets software overhead; no HST adjustment is claimed without a supplier credit note.`
    : `${vendor} business software subscription verified from the posted business credit-card record. Recorded as overhead; no HST input tax credit is claimed without a supplier receipt.`;
}

function desiredNote(current, evidence) {
  const existing = String(current ?? "").trim();
  if (!existing || existing === "Live bank feed; category and HST require review.") {
    return evidence;
  }
  return existing.includes(evidence) ? existing : `${existing} ${evidence}`;
}

function objectChanged(current, desired) {
  return Object.entries(desired).some(
    ([key, value]) => !isDeepStrictEqual(current[key], value),
  );
}

async function insertAuditEvent(db, row) {
  const existing = await db
    .from("labour_verification_events")
    .select("id")
    .eq("entity_type", row.entity_type)
    .eq("entity_id", row.entity_id)
    .eq("action", row.action)
    .eq("reason", row.reason)
    .limit(1);
  if (existing.error) throw existing.error;
  if ((existing.data ?? []).length) return;
  const result = await db.from("labour_verification_events").insert(row);
  if (result.error) throw result.error;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
  throw new Error(`Refusing accounting changes for project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const transactionSelect =
  "id,posted_on,transaction_on,description,counterparty,amount,tax_amount,net_amount,currency,transaction_type,category,review_status,notes,source_data,financial_accounts!inner(name,last_four,account_type)";
const [softwareResult, knownMisclassificationResult] = await Promise.all([
  db
    .from("financial_transactions")
    .select(transactionSelect)
    .eq("category", "Software & subscriptions")
    .order("posted_on", { ascending: true }),
  db
    .from("financial_transactions")
    .select(transactionSelect)
    .in("id", [...GOOGLE_WORKSPACE_PAYMENT_EVIDENCE.keys()]),
]);
if (softwareResult.error) throw softwareResult.error;
if (knownMisclassificationResult.error) {
  throw knownMisclassificationResult.error;
}
const transactionsById = new Map(
  [...(softwareResult.data ?? []), ...(knownMisclassificationResult.data ?? [])]
    .map((transaction) => [transaction.id, transaction]),
);
const transactions = [...transactionsById.values()].sort((left, right) =>
  String(left.posted_on).localeCompare(String(right.posted_on)),
);

const candidates = [];
const skipped = [];
for (const transaction of transactions) {
  const vendor = vendorFor(transaction);
  const gmailPaymentEvidence = GOOGLE_WORKSPACE_PAYMENT_EVIDENCE.get(
    transaction.id,
  );
  if (
    gmailPaymentEvidence &&
    (transaction.transaction_on !== gmailPaymentEvidence.payment_date ||
      cents(Math.abs(Number(transaction.amount))) !==
        cents(gmailPaymentEvidence.amount) ||
      transaction.source_data?.original_description !==
        "GOOGLE*WORKSPACE PAINT")
  ) {
    throw new Error(
      `Google Workspace payment evidence no longer matches transaction ${transaction.id}.`,
    );
  }
  const account = transaction.financial_accounts;
  const reason = vendor
    ? gmailPaymentEvidence
      ? `Google Payments Gmail ${gmailPaymentEvidence.gmail_message_id} confirms the CA$${gmailPaymentEvidence.amount.toFixed(2)} Google Workspace payment on ${gmailPaymentEvidence.payment_date}; the posted business credit-card row has the exact date, amount, and GOOGLE*WORKSPACE descriptor. HST remains zero because no supplier tax invoice is attached.`
      : `${vendor.name} is a user-confirmed business software subscription. The posted business credit-card row proves the vendor, date, and amount; HST remains zero because no supplier tax document is attached.`
    : "No recognized software vendor rule.";
  const validDirection =
    (Number(transaction.amount) < 0 && transaction.transaction_type === "expense") ||
    (Number(transaction.amount) > 0 && transaction.transaction_type === "credit");
  const eligible =
    vendor != null &&
    account?.account_type === "credit_card" &&
    transaction.source_data?.pending !== true &&
    transaction.currency === "CAD" &&
    cents(transaction.tax_amount) === 0 &&
    validDirection;

  if (!eligible) {
    skipped.push({
      id: transaction.id,
      date: transaction.posted_on,
      description: transaction.description,
      counterparty: transaction.counterparty,
      amount: Number(transaction.amount),
      tax: Number(transaction.tax_amount),
      account_type: account?.account_type ?? null,
      reason:
        cents(transaction.tax_amount) !== 0
          ? "Existing HST is present; preserve this previously reviewed tax treatment and exclude it from the zero-HST bank-evidence rule."
          : reason,
    });
    continue;
  }

  const isCredit = Number(transaction.amount) > 0;
  const note = evidenceNote(vendor.name, isCredit);
  const expenseEvidence = {
    status: "bank_supported_no_itc",
    classification: isCredit
      ? "software_subscription_credit"
      : "software_subscription",
    vendor: vendor.name,
    evidence: gmailPaymentEvidence
      ? "posted_business_credit_card_record_and_google_payment_email"
      : "posted_business_credit_card_record",
    tax_treatment: "no_itc_claimed",
    supplier_document_status: "not_attached",
    source: gmailPaymentEvidence
      ? "Google Payments Gmail and posted business credit-card record"
      : "Ottawa Painters administrator confirmation",
    ...(gmailPaymentEvidence
      ? { gmail_payment_evidence: gmailPaymentEvidence }
      : {}),
    confirmed_by: ADMIN_USER_ID,
    confirmed_on: CONFIRMED_ON,
    reason,
  };
  const desired = {
    category: "Software & subscriptions",
    counterparty: vendor.name,
    review_status: "reconciled",
    notes: desiredNote(transaction.notes, note),
    source_data: {
      ...(transaction.source_data ?? {}),
      expense_evidence: expenseEvidence,
    },
  };
  candidates.push({
    transaction,
    vendor: vendor.name,
    reason,
    desired,
    changed: objectChanged(transaction, desired),
  });
}

const summary = {};
for (const candidate of candidates) {
  const item = summary[candidate.vendor] ?? {
    rows: 0,
    expenses: 0,
    credits: 0,
    net_expense: 0,
  };
  item.rows += 1;
  if (Number(candidate.transaction.amount) < 0) item.expenses += 1;
  else item.credits += 1;
  item.net_expense =
    Math.round((item.net_expense - Number(candidate.transaction.amount)) * 100) /
    100;
  summary[candidate.vendor] = item;
}

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      eligible_rows: candidates.length,
      rows_to_update: candidates.filter((candidate) => candidate.changed).length,
      skipped_rows: skipped.length,
      summary,
      candidates: candidates.map((candidate) => ({
        id: candidate.transaction.id,
        date: candidate.transaction.posted_on,
        vendor: candidate.vendor,
        description: candidate.transaction.description,
        amount: Number(candidate.transaction.amount),
        current_status: candidate.transaction.review_status,
        desired_status: candidate.desired.review_status,
        changed: candidate.changed,
      })),
      skipped,
    },
    null,
    2,
  ),
);
if (!APPLY) process.exit(0);

const performedAt = new Date().toISOString();
for (const candidate of candidates) {
  const oldValues = {
    counterparty: candidate.transaction.counterparty,
    review_status: candidate.transaction.review_status,
    notes: candidate.transaction.notes,
    expense_evidence: candidate.transaction.source_data?.expense_evidence ?? null,
  };
  if (candidate.changed) {
    const update = await db
      .from("financial_transactions")
      .update(candidate.desired)
      .eq("id", candidate.transaction.id);
    if (update.error) throw update.error;
  }
  await insertAuditEvent(db, {
    entity_type: "payment",
    entity_id: candidate.transaction.id,
    action: "update",
    old_values: candidate.changed
      ? oldValues
      : {
          state: "already_reconciled_before_audit_event",
          note: "The desired transaction state was present when the idempotent audit event was inserted.",
        },
    new_values: {
      counterparty: candidate.desired.counterparty,
      review_status: candidate.desired.review_status,
      notes: candidate.desired.notes,
      expense_evidence: candidate.desired.source_data.expense_evidence,
    },
    reason: candidate.reason,
    performed_by: ADMIN_USER_ID,
    performed_at: performedAt,
  });
}

const verification = await db
  .from("financial_transactions")
  .select("id,review_status,tax_amount,source_data")
  .in(
    "id",
    candidates.map((candidate) => candidate.transaction.id),
  );
if (verification.error) throw verification.error;
for (const row of verification.data ?? []) {
  if (
    row.review_status !== "reconciled" ||
    cents(row.tax_amount) !== 0 ||
    row.source_data?.expense_evidence?.status !== "bank_supported_no_itc"
  ) {
    throw new Error(`Software reconciliation verification failed for ${row.id}.`);
  }
}

console.log(
  JSON.stringify(
    {
      verified_rows: verification.data?.length ?? 0,
      unresolved_recognized_rows: candidates.length - (verification.data?.length ?? 0),
    },
    null,
    2,
  ),
);
