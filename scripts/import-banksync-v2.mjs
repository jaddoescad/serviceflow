#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function optionValue(flag) {
  const inline = process.argv.find((argument) => argument.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

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
    ) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function lastFour(value) {
  return String(value ?? "").replace(/\D/g, "").slice(-4);
}

function dateOnly(value) {
  return String(value).slice(0, 10);
}

function normalizedDescription(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sourceKey(transactionId) {
  return sha256(`banksync:td-canada-trust:${transactionId}`);
}

function exactTransactionKey(accountId, postedOn, description, amountCents) {
  return [accountId, postedOn, normalizedDescription(description), Number(amountCents)].join("|");
}

function transferReference(description) {
  return normalizedDescription(description).match(/\*{3}([a-z0-9]{3})/i)?.[1]?.toUpperCase() ?? null;
}

function dayNumber(value) {
  return Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000);
}

function recurringOverheadRule(transaction) {
  const text = [transaction.description, transaction.originalDescription, transaction.merchantName]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-CA");
  const rules = [
    ["Meta Ads", ["facebk", "facebook", "meta ads"], "Advertising & marketing", "Meta advertising", "meta_advertising"],
    ["LinkedIn", ["linkedin"], "Professional subscriptions", "Professional subscription", "professional_subscription"],
    ["Indeed", ["indeed"], "Recruiting & hiring", "Recruiting expense", "recruiting"],
    ["OnlineJobs.ph", ["onlinejobs"], "Recruiting & hiring", "Recruiting expense", "recruiting"],
    ["Upwork", ["upwork"], "Freelance services", "Freelance services", "freelance_services"],
    ["Quo", ["openphone", "quo.com", "quo ("], "Phone & communication", "Phone subscription", "phone_subscription"],
    ["One Touch Print", ["one touch print", "onetouch print"], "Printing & signage", "Printing and signage", "printing_and_signage"],
    ["DripJobs CRM", ["dripjobs"], "Software & subscriptions", "Software subscription", "software_subscription"],
    ["CompanyCam", ["companycam"], "Software & subscriptions", "Software subscription", "software_subscription"],
    ["QuickBooks Online", ["qbooks", "quickbooks", "intuit"], "Software & subscriptions", "Software subscription", "software_subscription"],
    ["Perspective Software", ["perspective software"], "Software & subscriptions", "Software subscription", "software_subscription"],
    ["Google Workspace", ["google*workspace", "workspace_pain", "google workspace"], "Software & subscriptions", "Software subscription", "software_subscription"],
    ["Zapier", ["zapier"], "Software & subscriptions", "Software subscription", "software_subscription"],
    ["Connecteam", ["connecteam"], "Software & subscriptions", "Software subscription", "software_subscription"],
    ["OpenAI", ["openai", "chatgpt"], "Software & subscriptions", "Software subscription", "software_subscription"],
    ["Slack", ["slack"], "Software & subscriptions", "Software subscription", "software_subscription"],
    ["CapCut", ["capcut"], "Software & subscriptions", "Software subscription", "software_subscription"],
  ];
  const match = rules.find(([, terms]) => terms.some((term) => text.includes(term)));
  return match
    ? { vendor: match[0], category: match[2], label: match[3], classification: match[4] }
    : null;
}

function cardCategory(transaction) {
  const text = [transaction.description, transaction.originalDescription, transaction.merchantName, transaction.category]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-CA");
  if (
    text.includes("sherwin") || text.includes("paint") ||
    text.includes("home depot") || text.includes("rona") ||
    text.includes("home hardware") || text.includes("canadian tire") ||
    text.includes("randalls")
  ) return "Paint & materials";
  if (text.includes("archambault handyman")) return "Repairs & maintenance";
  if (text.includes("imperial pfs") || text.includes("workplace safety") || text.includes("insurance")) return "Insurance";
  if (text.includes("waste connections")) return "Waste & disposal";
  if (text.includes("staples") || text.includes("office supplies")) return "Office supplies";
  if (text.includes("vistaprint")) return "Printing & signage";
  if (text.includes("restaurant") || text.includes("nando") || text.includes("coffee") || text.includes("cafe")) return "Meals & entertainment";
  if (text.includes("p.skool") || text.includes("education")) return "Training & education";
  if (text.includes("interest charge")) return "Interest & charges";
  if (text.includes("overlimit fee") || text.includes("paymentus-service-fee") || text.includes("bank fees")) return "Bank fees";
  return "Uncategorized";
}

function classifyTransaction(transaction, accountType) {
  const description = normalizedDescription(transaction.description).toLocaleUpperCase("en-CA");
  const searchable = [transaction.description, transaction.originalDescription, transaction.merchantName]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-CA");
  if (Number(transaction.amount) < 0 && searchable.includes("shakepay")) {
    return { transaction_type: "expense", category: "Virtual assistant salaries", is_transfer: false, review_status: "reconciled" };
  }
  if (accountType === "credit_card") {
    if (description.includes("PAYMENT - THANK YOU")) {
      return { transaction_type: "transfer", category: "Credit card payment", is_transfer: true, review_status: "reconciled" };
    }
    const recurring = recurringOverheadRule(transaction);
    if (recurring) {
      return {
        transaction_type: Number(transaction.amount) > 0 ? "credit" : "expense",
        category: recurring.category,
        is_transfer: false,
        review_status: "reconciled",
      };
    }
    const category = cardCategory(transaction);
    return {
      transaction_type: Number(transaction.amount) > 0 ? "credit" : "expense",
      category,
      is_transfer: false,
      review_status: "needs_review",
    };
  }
  if (description.includes("TFR-TO C/C")) {
    return { transaction_type: "transfer", category: "Credit card payment", is_transfer: true, review_status: "reconciled" };
  }
  if (description.includes("SEND E-TFR FEE") || description.includes("MONTHLY PLAN FEE") || description.includes("SERVICE CHARGE")) {
    return { transaction_type: "expense", category: "Bank fees", is_transfer: false, review_status: "reconciled" };
  }
  if (description.includes("ACCT BAL REBATE") || description.includes("REVERSE E-TFR FEE")) {
    return { transaction_type: "credit", category: "Bank rebates", is_transfer: false, review_status: "reconciled" };
  }
  if (description.includes("CANCEL E-TFR") || description.includes("RECLAIM E-TFR")) {
    return { transaction_type: "credit", category: "Uncategorized", is_transfer: false, review_status: "needs_review" };
  }
  if (Number(transaction.amount) > 0) {
    return { transaction_type: "income", category: "Painting revenue", is_transfer: false, review_status: "needs_review" };
  }
  if (description.includes("WISE MSP")) {
    return { transaction_type: "expense", category: "Virtual assistant salaries", is_transfer: false, review_status: "reconciled" };
  }
  if (description.includes("CANADA TXD")) {
    return { transaction_type: "expense", category: "Taxes & licences", is_transfer: false, review_status: "needs_review" };
  }
  return { transaction_type: "expense", category: "Uncategorized", is_transfer: false, review_status: "needs_review" };
}

function countsBy(rows, key) {
  return Object.fromEntries(
    [...new Set(rows.map((row) => row[key]))]
      .map((value) => [value, rows.filter((row) => row[key] === value).length])
      .sort((left, right) => right[1] - left[1]),
  );
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await queryFactory().range(page * pageSize, page * pageSize + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Pagination exceeded 100,000 rows.");
}

const snapshotPath = path.resolve(optionValue("--snapshot") ?? path.join(repoRoot, "tmp/ottawa-painters-banksync-2026-08-25.json"));
const snapshotBytes = await fs.readFile(snapshotPath);
const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
if (snapshot.source !== "BankSync/Plaid live TD Canada Trust connection") throw new Error("Unexpected snapshot source.");
if (!Array.isArray(snapshot.accounts) || !Array.isArray(snapshot.transactionSets)) throw new Error("Invalid BankSync snapshot shape.");

const env = {
  ...parseEnvFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.join(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const [accounts, existingTransactions, existingDocuments] = await Promise.all([
  fetchAll(() => db.from("accounts").select("id,slug,name,account_type,last_four,current_balance_cents,available_balance_cents,credit_limit_cents,balance_as_of,external_provider,external_account_id,updated_at")),
  fetchAll(() => db.from("transactions").select("id,account_id,source_key,posted_on,transaction_on,description,amount_cents,running_balance_cents,metadata,created_at,updated_at")),
  fetchAll(() => db.from("documents").select("id,content_sha256,original_filename")),
]);

const accountByLastFour = new Map(accounts.map((account) => [account.last_four, account]));
for (const sourceAccount of snapshot.accounts) {
  const suffix = lastFour(sourceAccount.accountNumber);
  if (!accountByLastFour.has(suffix)) throw new Error(`Missing V2 account ending ${suffix}.`);
}

const remainingExactCounts = new Map();
for (const row of existingTransactions) {
  const key = exactTransactionKey(row.account_id, row.posted_on, row.description, row.amount_cents);
  remainingExactCounts.set(key, (remainingExactCounts.get(key) ?? 0) + 1);
}
const remainingReferenceMatches = existingTransactions
  .map((transaction) => ({ transaction, reference: transferReference(transaction.description) }))
  .filter((row) => row.reference);
const existingSourceKeys = new Set(existingTransactions.map((row) => row.source_key));
const existingBankSyncIds = new Set(existingTransactions.map((row) => row.metadata?.bank_sync_transaction_id).filter(Boolean));

let duplicateCount = 0;
let pendingCount = 0;
const candidates = [];
for (const transactionSet of snapshot.transactionSets) {
  const sourceAccount = snapshot.accounts.find((account) => account.id === transactionSet.accountId);
  if (!sourceAccount) throw new Error(`Missing source account ${transactionSet.accountId}.`);
  const account = accountByLastFour.get(lastFour(sourceAccount.accountNumber));
  for (const transaction of transactionSet.transactions) {
    if (transaction.pending) {
      pendingCount += 1;
      continue;
    }
    const transactionSourceKey = sourceKey(transaction.id);
    if (existingSourceKeys.has(transactionSourceKey) || existingBankSyncIds.has(transaction.id)) {
      duplicateCount += 1;
      continue;
    }
    const amountCents = Math.round(Number(transaction.amount) * 100);
    const postedOn = dateOnly(transaction.date);
    const possibleDates = [...new Set([postedOn, transaction.authorizedDate ? dateOnly(transaction.authorizedDate) : null].filter(Boolean))];
    const possibleDescriptions = [...new Set([transaction.description, transaction.originalDescription].filter(Boolean))];
    let exactMatched = false;
    for (const possibleDate of possibleDates) {
      for (const possibleDescription of possibleDescriptions) {
        const key = exactTransactionKey(account.id, possibleDate, possibleDescription, amountCents);
        const count = remainingExactCounts.get(key) ?? 0;
        if (count > 0) {
          remainingExactCounts.set(key, count - 1);
          exactMatched = true;
          break;
        }
      }
      if (exactMatched) break;
    }
    if (exactMatched) {
      duplicateCount += 1;
      continue;
    }
    const reference = transferReference(transaction.description);
    if (reference) {
      const referenceMatchIndex = remainingReferenceMatches.findIndex(({ transaction: existing, reference: existingReference }) =>
        existingReference === reference &&
        existing.account_id === account.id &&
        Number(existing.amount_cents) === amountCents &&
        Math.abs(dayNumber(existing.posted_on) - dayNumber(postedOn)) <= 1
      );
      if (referenceMatchIndex >= 0) {
        remainingReferenceMatches.splice(referenceMatchIndex, 1);
        duplicateCount += 1;
        continue;
      }
    }
    const classification = classifyTransaction(transaction, account.account_type);
    const recurring = recurringOverheadRule(transaction);
    const isRecurringCredit = recurring && Number(transaction.amount) > 0;
    candidates.push({
      id: stableUuid(`transaction:${account.id}:${transactionSourceKey}`),
      account_id: account.id,
      import_document_id: null,
      contact_id: null,
      source_key: transactionSourceKey,
      posted_on: postedOn,
      transaction_on: transaction.authorizedDate ? dateOnly(transaction.authorizedDate) : postedOn,
      description: normalizedDescription(transaction.description),
      counterparty: recurring?.vendor ?? transaction.merchantName ?? null,
      amount_cents: amountCents,
      tax_cents: 0,
      net_cents: amountCents,
      currency: transaction.currency ?? "CAD",
      ...classification,
      running_balance_cents: null,
      notes: recurring
        ? isRecurringCredit
          ? `${recurring.vendor} credit verified from the posted business credit-card record; no HST adjustment is claimed without a supplier credit note.`
          : `${recurring.vendor} recurring business charge verified from the posted business credit-card record; no separate receipt is required and no HST input tax credit is claimed.`
        : classification.review_status === "needs_review"
          ? "Live TD bank feed; category, counterparty, allocation, and HST require review where applicable."
          : "Live TD bank feed; deterministic transfer or bank-fee classification.",
      metadata: {
        source: "banksync_plaid",
        bank_sync_transaction_id: transaction.id,
        bank_sync_account_id: transaction.accountId,
        bank_sync_bank_id: transaction.bankId,
        authorized_date: transaction.authorizedDate ?? null,
        merchant_name: transaction.merchantName ?? null,
        original_description: transaction.originalDescription ?? null,
        bank_category: transaction.category ?? null,
        bank_type: transaction.type ?? null,
        bank_reference: transaction.reference ?? null,
        pending: false,
        tax_evidence: { status: "unreviewed", tax_cents: 0 },
        ...(recurring ? {
          expense_evidence: {
            status: "bank_supported_no_itc",
            classification: isRecurringCredit ? `${recurring.classification}_credit` : recurring.classification,
            vendor: recurring.vendor,
            label: isRecurringCredit ? `${recurring.label} credit` : recurring.label,
            category: recurring.category,
            evidence: "posted_business_credit_card_record",
            tax_treatment: "no_itc_claimed",
            supplier_document_status: "not_required",
            source: "deterministic recognized vendor rule",
            confirmed_on: dateOnly(snapshot.fetchedAt),
          },
        } : {}),
        ...(classification.category === "Credit card payment" ? {
          document_exception: {
            status: "confirmed",
            kind: "credit_card_payment",
            label: "Credit card payment",
            evidence: "posted_bank_records",
            supplier_document_status: "not_required",
            source: "deterministic credit-card payment rule",
            confirmed_on: dateOnly(snapshot.fetchedAt),
          },
        } : {}),
      },
      created_at: snapshot.fetchedAt,
      updated_at: snapshot.fetchedAt,
    });
  }
}

const accountSnapshotByLastFour = new Map(snapshot.accounts.map((account) => [lastFour(account.accountNumber), account]));
const balanceChecks = [];
for (const account of accounts.filter((row) => accountSnapshotByLastFour.has(row.last_four))) {
  const sourceAccount = accountSnapshotByLastFour.get(account.last_four);
  const accountCandidates = candidates.filter((row) => row.account_id === account.id);
  const existingRowsCreatedAfterStartingBalance = existingTransactions.filter((row) =>
    row.account_id === account.id &&
    account.balance_as_of &&
    row.created_at > account.balance_as_of &&
    row.posted_on >= dateOnly(account.balance_as_of) &&
    row.posted_on <= snapshot.to
  );
  const existingPostBalanceActivityCents = existingRowsCreatedAfterStartingBalance
    .reduce((total, row) => total + Number(row.amount_cents), 0);
  const newPostedActivityCents = accountCandidates.reduce((total, row) => total + Number(row.amount_cents), 0);
  const signedActivityCents = existingPostBalanceActivityCents + newPostedActivityCents;
  const startingBalanceCents = Number(account.current_balance_cents ?? 0);
  const calculatedBalanceCents = account.account_type === "credit_card"
    ? startingBalanceCents - signedActivityCents
    : startingBalanceCents + signedActivityCents;
  const institutionBalanceCents = Math.round(Number(sourceAccount.balance) * 100);
  const differenceCents = calculatedBalanceCents - institutionBalanceCents;
  let status = Math.abs(differenceCents) <= 1 ? "pass" : "fail";
  let explanation = null;
  if (status === "fail" && account.account_type === "credit_card" && differenceCents > 0) {
    const pairedTransfer = [...candidates, ...existingTransactions].find((row) =>
      row.amount_cents < 0 &&
      Math.abs(row.amount_cents) === differenceCents &&
      normalizedDescription(row.description).toLocaleUpperCase("en-CA").includes("TFR-TO C/C") &&
      row.posted_on >= snapshot.from &&
      row.posted_on <= snapshot.to
    );
    if (pairedTransfer) {
      status = "explained_by_recent_card_payment";
      explanation = `The TD account balance includes the ${pairedTransfer.description} payment, while the card-side PAYMENT - THANK YOU row has not reached the posted transaction feed.`;
    }
  }
  balanceChecks.push({
    account: account.slug,
    starting_balance_cents: startingBalanceCents,
    existing_post_balance_activity_cents: existingPostBalanceActivityCents,
    new_posted_activity_cents: newPostedActivityCents,
    total_post_balance_activity_cents: signedActivityCents,
    calculated_balance_cents: calculatedBalanceCents,
    institution_balance_cents: institutionBalanceCents,
    difference_cents: differenceCents,
    status,
    explanation,
    provider_balance_as_of: sourceAccount.balanceAsOf ?? null,
    existing_rows_created_after_starting_balance: existingRowsCreatedAfterStartingBalance
      .map((row) => ({
        id: row.id,
        posted_on: row.posted_on,
        description: row.description,
        amount_cents: row.amount_cents,
        created_at: row.created_at,
        running_balance_cents: row.running_balance_cents,
      })),
  });
  if (status === "pass" && accountCandidates.length) {
    [...accountCandidates].sort((left, right) => right.posted_on.localeCompare(left.posted_on) || right.id.localeCompare(left.id))[0].running_balance_cents = institutionBalanceCents;
  }
}
const balanceReconciliationFailed = balanceChecks.some((row) => row.status === "fail");

const sourceHash = sha256(snapshotBytes);
const document = {
  id: stableUuid(`document:banksync-v2:${sourceHash}`),
  kind: "bank_feed_snapshot",
  original_filename: path.basename(snapshotPath),
  mime_type: "application/json",
  size_bytes: snapshotBytes.length,
  content_sha256: sourceHash,
  storage_bucket: null,
  storage_path: null,
  source_url: null,
  captured_at: snapshot.fetchedAt,
  metadata: {
    source: snapshot.source,
    from: snapshot.from,
    to: snapshot.to,
    sync_job: snapshot.syncJob ?? null,
    account_count: snapshot.accounts.length,
    source_transaction_count: snapshot.transactionSets.reduce((total, set) => total + set.transactions.length, 0),
    pending_skipped: pendingCount,
    duplicates_skipped: duplicateCount,
  },
};
const existingDocument = existingDocuments.find((row) => row.content_sha256 === sourceHash);
const documentId = existingDocument?.id ?? document.id;
for (const candidate of candidates) candidate.import_document_id = documentId;

const accountsWithAuthoritativeBalanceTime = accounts
  .filter((account) => accountSnapshotByLastFour.get(account.last_four)?.balanceAsOf)
  .map((account) => ({ account, source: accountSnapshotByLastFour.get(account.last_four) }));
const preview = {
  mode: APPLY ? "apply" : "dry-run",
  snapshot: path.basename(snapshotPath),
  snapshot_sha256: sourceHash,
  fetched_at: snapshot.fetchedAt,
  source_transactions: snapshot.transactionSets.reduce((total, set) => total + set.transactions.length, 0),
  duplicates_skipped: duplicateCount,
  pending_skipped: pendingCount,
  new_transactions: candidates.length,
  by_account: Object.fromEntries(accounts.map((account) => [account.slug, candidates.filter((row) => row.account_id === account.id).length])),
  by_category: countsBy(candidates, "category"),
  by_review_status: countsBy(candidates, "review_status"),
  balance_checks: balanceChecks,
  balance_reconciliation_failed: balanceReconciliationFailed,
  balance_updates: accountsWithAuthoritativeBalanceTime.map(({ account, source }) => ({
    account: account.slug,
    current_balance_cents: Math.round(Number(source.balance) * 100),
    available_balance_cents: Math.round(Number(source.availableBalance) * 100),
    balance_as_of: source.balanceAsOf,
  })),
  candidates: candidates.map((row) => ({
    account: accounts.find((account) => account.id === row.account_id)?.slug,
    date: row.posted_on,
    description: row.description,
    counterparty: row.counterparty,
    amount_cents: row.amount_cents,
    category: row.category,
    review_status: row.review_status,
    possible_existing_matches: existingTransactions
      .filter((existing) =>
        existing.account_id === row.account_id &&
        Number(existing.amount_cents) === Number(row.amount_cents) &&
        Math.abs(dayNumber(existing.posted_on) - dayNumber(row.posted_on)) <= 5
      )
      .map((existing) => ({
        id: existing.id,
        date: existing.posted_on,
        description: existing.description,
        amount_cents: existing.amount_cents,
      })),
  })),
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) {
  if (balanceReconciliationFailed) process.exitCode = 2;
  process.exit();
}
if (balanceReconciliationFailed) {
  throw new Error(`Account balance reconciliation failed: ${JSON.stringify(balanceChecks)}`);
}

if (!existingDocument) {
  const write = await db.from("documents").insert(document).select("id").single();
  if (write.error) throw write.error;
}

let inserted = 0;
for (const candidate of candidates) {
  const write = await db.from("transactions").insert(candidate).select("id").single();
  if (write.error) throw write.error;
  inserted += 1;
}

for (const { account, source } of accountsWithAuthoritativeBalanceTime) {
  const update = await db.from("accounts").update({
    current_balance_cents: Math.round(Number(source.balance) * 100),
    available_balance_cents: Math.round(Number(source.availableBalance) * 100),
    credit_limit_cents: Number(source.creditLimit) > 0 ? Math.round(Number(source.creditLimit) * 100) : null,
    balance_as_of: source.balanceAsOf,
    external_provider: "banksync_plaid",
    external_account_id: source.id,
    updated_at: snapshot.fetchedAt,
  }).eq("id", account.id).eq("updated_at", account.updated_at).select("id").maybeSingle();
  if (update.error) throw update.error;
  if (!update.data) throw new Error(`Concurrent account update detected for ${account.slug}.`);
  const event = await db.from("verification_events").upsert({
    id: stableUuid(`verification:banksync-v2-balance:${account.id}:${source.balanceAsOf}`),
    entity_type: "account_balance",
    entity_id: account.id,
    action: "balance_observed",
    reason: "BankSync/Plaid returned a provider-reported balance timestamp for this TD account.",
    old_values: {
      current_balance_cents: account.current_balance_cents,
      available_balance_cents: account.available_balance_cents,
      balance_as_of: account.balance_as_of,
    },
    new_values: {
      current_balance_cents: Math.round(Number(source.balance) * 100),
      available_balance_cents: Math.round(Number(source.availableBalance) * 100),
      balance_as_of: source.balanceAsOf,
    },
    evidence: {
      source: snapshot.source,
      snapshot_sha256: sourceHash,
      sync_job: snapshot.syncJob ?? null,
    },
    occurred_at: snapshot.fetchedAt,
  }, { onConflict: "id" });
  if (event.error) throw event.error;
}

const insertedIds = candidates.map((row) => row.id);
const verification = insertedIds.length
  ? await db.from("transactions").select("id,source_key").in("id", insertedIds)
  : { data: [], error: null };
if (verification.error) throw verification.error;
if ((verification.data ?? []).length !== insertedIds.length) throw new Error(`Expected ${insertedIds.length} inserted transactions but verified ${verification.data?.length ?? 0}.`);

console.log(JSON.stringify({
  status: "verified",
  document_id: documentId,
  transactions_inserted: inserted,
  transactions_verified: verification.data?.length ?? 0,
  accounts_updated: accountsWithAuthoritativeBalanceTime.length,
}, null, 2));
