#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const CONFIRMED_ON = "2026-08-01";
const APPLY = process.argv.includes("--apply");
const COMPACT = process.argv.includes("--compact");

const EXPENSE_RULES = [
  {
    key: "meta_ads",
    vendor: "Meta Ads",
    terms: ["facebk", "facebook", "meta ads"],
    category: "Advertising & marketing",
    label: "Meta advertising",
    classification: "meta_advertising",
    purpose: "Facebook/Meta advertising",
  },
  {
    key: "linkedin",
    vendor: "LinkedIn",
    terms: ["linkedin"],
    category: "Professional subscriptions",
    label: "Professional subscription",
    classification: "professional_subscription",
    purpose: "LinkedIn professional subscription",
  },
  {
    key: "quo",
    vendor: "Quo",
    terms: ["openphone", "quo.com", "quo ", "quo*"],
    category: "Phone & communication",
    label: "Phone subscription",
    classification: "phone_subscription",
    purpose: "Quo business phone subscription",
  },
  {
    key: "indeed",
    vendor: "Indeed",
    terms: ["indeed"],
    category: "Recruiting & hiring",
    label: "Recruiting expense",
    classification: "recruiting",
    purpose: "Indeed recruiting",
  },
  {
    key: "onlinejobs",
    vendor: "OnlineJobs.ph",
    terms: ["onlinejobs"],
    category: "Recruiting & hiring",
    label: "Recruiting expense",
    classification: "recruiting",
    purpose: "OnlineJobs.ph recruiting",
  },
  {
    key: "upwork",
    vendor: "Upwork",
    terms: ["upwork"],
    category: "Freelance services",
    label: "Freelance services",
    classification: "freelance_services",
    purpose: "Upwork freelance services",
  },
  {
    key: "one_touch_print",
    vendor: "One Touch Print",
    terms: ["one touch print", "onetouch print"],
    category: "Printing & signage",
    label: "Printing and signage",
    classification: "printing_and_signage",
    purpose: "printed lawn signs",
  },
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

function searchableText(transaction) {
  return [
    transaction.description,
    transaction.counterparty,
    transaction.source_data?.merchant_name,
    transaction.source_data?.original_description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-CA");
}

function expenseRuleFor(transaction) {
  const text = searchableText(transaction);
  return (
    EXPENSE_RULES.find((rule) =>
      rule.terms.some((term) => text.includes(term)),
    ) ?? null
  );
}

function isCreditCardPayment(transaction) {
  const text = searchableText(transaction).toLocaleUpperCase("en-CA");
  return (
    text.includes("PAYMENT - THANK YOU") ||
    text.includes("TFR-TO C/C") ||
    text.includes("LW463")
  );
}

function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function appendNote(current, evidence) {
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

async function fetchAll(db) {
  const rows = [];
  const pageSize = 1000;
  for (let page = 0; page < 100; page += 1) {
    const result = await db
      .from("financial_transactions")
      .select(
        "id,posted_on,description,counterparty,amount,tax_amount,net_amount,currency,transaction_type,category,is_transfer,review_status,notes,source_data,financial_accounts!inner(name,last_four,account_type)",
      )
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Financial transaction scan exceeded 100,000 rows.");
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
const transactions = await fetchAll(db);
const candidates = [];

for (const transaction of transactions) {
  const account = transaction.financial_accounts;
  const cardPayment = isCreditCardPayment(transaction);
  const expenseRule = expenseRuleFor(transaction);

  if (cardPayment) {
    const note =
      "Ottawa Painters confirmed this posted row is a credit-card payment/transfer. The bank records on the two accounts are the evidence; no receipt or invoice is required.";
    const reason =
      "User-confirmed deterministic credit-card payment description (PAYMENT - THANK YOU, TFR-TO C/C, or LW463).";
    const desired = {
      category: "Credit card payment",
      transaction_type: "transfer",
      is_transfer: true,
      review_status: "reconciled",
      notes: appendNote(transaction.notes, note),
      source_data: {
        ...(transaction.source_data ?? {}),
        document_exception: {
          status: "confirmed",
          kind: "credit_card_payment",
          label: "Credit card payment",
          detail:
            "This is a transfer between Ottawa Painters bank and credit-card accounts, not a business expense. The posted bank records are the supporting evidence.",
          evidence: "posted_bank_records",
          supplier_document_status: "not_required",
          source: "Ottawa Painters administrator confirmation",
          confirmed_by: ADMIN_USER_ID,
          confirmed_on: CONFIRMED_ON,
          reason,
        },
      },
    };
    candidates.push({
      kind: "credit_card_payment",
      rule: "credit_card_payment",
      transaction,
      reason,
      desired,
      changed: objectChanged(transaction, desired),
    });
    continue;
  }

  if (!expenseRule) continue;
  const validDirection =
    (Number(transaction.amount) < 0 && transaction.transaction_type === "expense") ||
    (Number(transaction.amount) > 0 && transaction.transaction_type === "credit");
  const eligible =
    (account?.account_type === "credit_card" ||
      expenseRule.key === "one_touch_print") &&
    transaction.source_data?.pending !== true &&
    transaction.currency === "CAD" &&
    validDirection;
  if (!eligible) continue;

  const isCredit = Number(transaction.amount) > 0;
  const note = isCredit
    ? `${expenseRule.vendor} credit confirmed from the posted business credit-card record. It offsets ${expenseRule.category.toLocaleLowerCase("en-CA")} overhead; no HST adjustment is claimed without a supplier credit note.`
    : `${expenseRule.vendor} ${expenseRule.purpose} confirmed from the posted business credit-card record. Recorded as ${expenseRule.category.toLocaleLowerCase("en-CA")} overhead; no separate receipt is required and no HST input tax credit is claimed.`;
  const reason =
    `${expenseRule.vendor} is a user-confirmed recurring business overhead classification. The posted business credit-card record proves the vendor, date, and amount.`;
  const desired = {
    counterparty: expenseRule.vendor,
    category: expenseRule.category,
    tax_amount: 0,
    review_status: "reconciled",
    notes: appendNote(transaction.notes, note),
    source_data: {
      ...(transaction.source_data ?? {}),
      expense_evidence: {
        status: "bank_supported_no_itc",
        classification: isCredit
          ? `${expenseRule.classification}_credit`
          : expenseRule.classification,
        vendor: expenseRule.vendor,
        label: isCredit ? `${expenseRule.label} credit` : expenseRule.label,
        detail: isCredit
          ? `The posted business credit-card record confirms this ${expenseRule.vendor} credit. It offsets ${expenseRule.category.toLocaleLowerCase("en-CA")} overhead; no HST adjustment is claimed without a supplier credit note.`
          : `The posted business credit-card record confirms this recurring ${expenseRule.purpose} charge. No separate receipt is required, and no HST input tax credit is claimed.`,
        category: expenseRule.category,
        evidence: "posted_business_credit_card_record",
        tax_treatment: "no_itc_claimed",
        supplier_document_status: "not_required",
        source: "Ottawa Painters administrator confirmation",
        confirmed_by: ADMIN_USER_ID,
        confirmed_on: CONFIRMED_ON,
        reason,
      },
    },
  };
  candidates.push({
    kind: "recurring_overhead",
    rule: expenseRule.key,
    transaction,
    reason,
    desired,
    changed: objectChanged(transaction, desired),
  });
}

for (const transaction of transactions) {
  if (candidates.some((candidate) => candidate.transaction.id === transaction.id)) {
    continue;
  }
  const isBacklink =
    transaction.counterparty === "Purchase Backlink From Ottawa Life";
  const isUnknownJadBusiness = transaction.counterparty === "Jad Business";
  if (!isBacklink && !isUnknownJadBusiness) continue;

  const category = isBacklink ? "SEO & website" : "Uncategorized";
  const note = isBacklink
    ? "Reclassified from advertising to SEO & website because the bank description explicitly identifies a backlink purchase. The supplier document and existing HST treatment still need review."
    : "Removed from advertising because Ottawa Painters confirmed only Facebook/Meta charges are advertising for now. The purpose and existing HST treatment for this Jad Business transfer still need review.";
  const reason = isBacklink
    ? "The counterparty explicitly identifies an Ottawa Life backlink purchase; this is SEO/website overhead, not Meta advertising."
    : "Ottawa Painters confirmed that only Facebook/Meta charges are advertising for now; Jad Business is not otherwise identified by the stored bank record.";
  const desired = {
    category,
    review_status: "needs_review",
    notes: appendNote(transaction.notes, note),
    source_data: {
      ...(transaction.source_data ?? {}),
      classification_research: {
        status: "needs_review",
        classification: category,
        source: "Ottawa Painters administrator confirmation",
        confirmed_by: ADMIN_USER_ID,
        confirmed_on: CONFIRMED_ON,
        reason,
      },
    },
  };
  candidates.push({
    kind: "classification_review",
    rule: isBacklink ? "backlink_seo_review" : "jad_business_review",
    transaction,
    reason,
    desired,
    changed: objectChanged(transaction, desired),
  });
}

const remainingAdvertising = transactions
  .filter(
    (transaction) =>
      transaction.category === "Advertising & marketing" &&
      !candidates.some((candidate) => candidate.transaction.id === transaction.id),
  )
  .map((transaction) => ({
    id: transaction.id,
    date: transaction.posted_on,
    description: transaction.description,
    counterparty: transaction.counterparty,
    amount: Number(transaction.amount),
    review_status: transaction.review_status,
    transaction_type: transaction.transaction_type,
    tax_amount: Number(transaction.tax_amount),
    account_type: transaction.financial_accounts?.account_type ?? null,
    notes: transaction.notes,
    expense_evidence_status:
      transaction.source_data?.expense_evidence?.status ?? null,
    manual_category_reason:
      transaction.source_data?.manual_category_reason ?? null,
  }));

const remainingReviewByDescription = new Map();
for (const transaction of transactions) {
  if (transaction.review_status !== "needs_review") continue;
  if (candidates.some((candidate) => candidate.transaction.id === transaction.id)) {
    continue;
  }
  const key = transaction.counterparty || transaction.description;
  const item = remainingReviewByDescription.get(key) ?? {
    counterparty_or_description: key,
    rows: 0,
    amount: 0,
    categories: new Set(),
  };
  item.rows += 1;
  item.amount = Math.round((item.amount + Math.abs(Number(transaction.amount))) * 100) / 100;
  item.categories.add(transaction.category);
  remainingReviewByDescription.set(key, item);
}

const summary = {};
for (const candidate of candidates) {
  const item = summary[candidate.rule] ?? { rows: 0, total: 0, changed: 0 };
  item.rows += 1;
  item.total = Math.round((item.total + Math.abs(Number(candidate.transaction.amount))) * 100) / 100;
  if (candidate.changed) item.changed += 1;
  summary[candidate.rule] = item;
}

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      ledger_rows: transactions.length,
      legacy_manual_resolution_rows: transactions.filter(
        (transaction) =>
          transaction.source_data?.manual_settlement_resolution != null,
      ).length,
      candidates: candidates.length,
      rows_to_update: candidates.filter((candidate) => candidate.changed).length,
      first_candidate: candidates[0]
        ? {
            id: candidates[0].transaction.id,
            description: candidates[0].transaction.description,
            kind: candidates[0].kind,
          }
        : null,
      summary,
      exact_changes: candidates
        .filter(
          (candidate) =>
            !COMPACT ||
            (candidate.rule !== "meta_ads" &&
              (candidate.transaction.review_status !== "reconciled" ||
                candidate.transaction.description.includes("LW463"))),
        )
        .map((candidate) => ({
          id: candidate.transaction.id,
          date: candidate.transaction.posted_on,
          description: candidate.transaction.description,
          amount: Number(candidate.transaction.amount),
          current_category: candidate.transaction.category,
          desired_category: candidate.desired.category,
          current_status: candidate.transaction.review_status,
          desired_status: candidate.desired.review_status,
          changed: candidate.changed,
        })),
      remaining_advertising_rows: remainingAdvertising,
      low_hanging_review_groups: [...remainingReviewByDescription.values()]
        .map((item) => ({
          ...item,
          categories: [...item.categories],
        }))
        .sort((left, right) => right.rows - left.rows || right.amount - left.amount)
        .slice(0, 30),
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
    category: candidate.transaction.category,
    transaction_type: candidate.transaction.transaction_type,
    is_transfer: candidate.transaction.is_transfer,
    review_status: candidate.transaction.review_status,
    notes: candidate.transaction.notes,
    expense_evidence: candidate.transaction.source_data?.expense_evidence ?? null,
    document_exception:
      candidate.transaction.source_data?.document_exception ?? null,
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
          note: "The desired transaction state was present when this idempotent audit event was inserted.",
        },
    new_values: candidate.desired,
    reason: candidate.reason,
    performed_by: ADMIN_USER_ID,
    performed_at: performedAt,
  });
}

const verification = await db
  .from("financial_transactions")
  .select(
    "id,category,transaction_type,is_transfer,review_status,tax_amount,source_data",
  )
  .in(
    "id",
    candidates.map((candidate) => candidate.transaction.id),
  );
if (verification.error) throw verification.error;
const candidateById = new Map(
  candidates.map((candidate) => [candidate.transaction.id, candidate]),
);
for (const row of verification.data ?? []) {
  const candidate = candidateById.get(row.id);
  if (!candidate) throw new Error(`Unexpected verification row ${row.id}.`);
  const evidenceOkay =
    candidate.kind === "credit_card_payment"
      ? row.source_data?.document_exception?.status === "confirmed"
      : candidate.kind === "classification_review"
        ? row.source_data?.classification_research?.status === "needs_review"
        : row.source_data?.expense_evidence?.status === "bank_supported_no_itc";
  const taxOkay =
    candidate.kind !== "recurring_overhead" || cents(row.tax_amount) === 0;
  if (
    row.category !== candidate.desired.category ||
    (candidate.desired.transaction_type != null &&
      row.transaction_type !== candidate.desired.transaction_type) ||
    (candidate.desired.is_transfer != null &&
      row.is_transfer !== candidate.desired.is_transfer) ||
    row.review_status !== candidate.desired.review_status ||
    !evidenceOkay ||
    !taxOkay
  ) {
    throw new Error(`Recurring-overhead verification failed for ${row.id}.`);
  }
}

console.log(
  JSON.stringify(
    {
      verified_rows: verification.data?.length ?? 0,
      unresolved_candidates:
        candidates.length - (verification.data?.length ?? 0),
    },
    null,
    2,
  ),
);
