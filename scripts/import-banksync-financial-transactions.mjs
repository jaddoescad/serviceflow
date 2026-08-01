#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

globalThis.WebSocket = WebSocket;
const { createClient } = await import("@supabase/supabase-js");

const accountDefinitions = {
  "3660": {
    slug: "td-visa-3660",
    name: "Business Travel Visa 3660",
    account_type: "credit_card",
  },
  "6650": {
    slug: "td-visa-6650",
    name: "Business Travel Visa 6650",
    account_type: "credit_card",
  },
  "6970": {
    slug: "td-chequing-6970",
    name: "Business Chequing",
    account_type: "chequing",
  },
  "7861": {
    slug: "td-investor-7861",
    name: "Business Investor Account",
    account_type: "savings",
  },
};

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

function optionValue(flag) {
  const inline = process.argv.find((argument) => argument.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function lastFour(accountNumber) {
  return String(accountNumber).replace(/\D/g, "").slice(-4);
}

function dateOnly(value) {
  return String(value).slice(0, 10);
}

function sourceKey(transactionId) {
  return createHash("sha256")
    .update(`banksync:td-canada-trust:${transactionId}`)
    .digest("hex");
}

function cardCategory(transaction) {
  const text = [
    transaction.description,
    transaction.originalDescription,
    transaction.merchantName,
    transaction.category,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-CA");

  const recurringOverhead = recurringOverheadRule(transaction);
  if (recurringOverhead) return recurringOverhead.category;
  if (
    text.includes("sherwin") ||
    text.includes("paint") ||
    text.includes("home depot") ||
    text.includes("rona") ||
    text.includes("home hardware") ||
    text.includes("canadian tire")
  ) {
    return "Paint & materials";
  }
  if (text.includes("archambault handyman")) return "Repairs & maintenance";
  if (text.includes("openphone") || text.includes("quo")) {
    return "Phone & communication";
  }
  if (
    text.includes("dripjobs") ||
    text.includes("perspective software") ||
    text.includes("companycam") ||
    text.includes("zapier") ||
    text.includes("slack") ||
    text.includes("workspace") ||
    text.includes("openai") ||
    text.includes("chatgpt") ||
    text.includes("connecteam") ||
    text.includes("capcut") ||
    text.includes("qbooks") ||
    text.includes("intuit")
  ) {
    return "Software & subscriptions";
  }
  if (
    text.includes("imperial pfs") ||
    text.includes("workplace safety") ||
    text.includes("insurance")
  ) {
    return "Insurance";
  }
  if (text.includes("waste connections")) return "Waste & disposal";
  if (text.includes("staples") || text.includes("office supplies")) {
    return "Office supplies";
  }
  if (
    text.includes("restaurant") ||
    text.includes("nando") ||
    text.includes("coffee") ||
    text.includes("cafe")
  ) {
    return "Meals & entertainment";
  }
  if (text.includes("p.skool") || text.includes("education")) {
    return "Training & education";
  }
  if (text.includes("interest charge")) return "Interest & charges";
  if (
    text.includes("overlimit fee") ||
    text.includes("paymentus-service-fee") ||
    text.includes("bank fees")
  ) {
    return "Bank fees";
  }
  return "Uncategorized";
}

function recurringOverheadRule(transaction) {
  const text = [
    transaction.description,
    transaction.originalDescription,
    transaction.merchantName,
  ]
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
    ["Google Workspace", ["workspace_pain", "google workspace"], "Software & subscriptions", "Software subscription", "software_subscription"],
    ["Zapier", ["zapier"], "Software & subscriptions", "Software subscription", "software_subscription"],
    ["Connecteam", ["connecteam"], "Software & subscriptions", "Software subscription", "software_subscription"],
    ["OpenAI", ["openai", "chatgpt"], "Software & subscriptions", "Software subscription", "software_subscription"],
    ["Slack", ["slack"], "Software & subscriptions", "Software subscription", "software_subscription"],
    ["CapCut", ["capcut"], "Software & subscriptions", "Software subscription", "software_subscription"],
  ];
  const match = rules.find(([, terms]) =>
    terms.some((term) => text.includes(term)),
  );
  return match
    ? {
        vendor: match[0],
        category: match[2],
        label: match[3],
        classification: match[4],
      }
    : null;
}

function classifyTransaction(transaction, accountType) {
  const description = transaction.description.toLocaleUpperCase("en-CA");

  if (accountType === "credit_card") {
    if (description.includes("PAYMENT - THANK YOU")) {
      return {
        transaction_type: "transfer",
        category: "Credit card payment",
        is_transfer: true,
        review_status: "reconciled",
      };
    }
    const category = cardCategory(transaction);
    return {
      transaction_type: transaction.amount > 0 ? "credit" : "expense",
      category,
      is_transfer: false,
      review_status: recurringOverheadRule(transaction)
        ? "reconciled"
        : "needs_review",
    };
  }

  if (description.includes("TFR-TO C/C")) {
    return {
      transaction_type: "transfer",
      category: "Credit card payment",
      is_transfer: true,
      review_status: "reconciled",
    };
  }
  if (
    description.includes("SEND E-TFR FEE") ||
    description.includes("MONTHLY PLAN FEE") ||
    description.includes("SERVICE CHARGE")
  ) {
    return {
      transaction_type: "expense",
      category: "Bank fees",
      is_transfer: false,
      review_status: "reconciled",
    };
  }
  if (
    description.includes("ACCT BAL REBATE") ||
    description.includes("REVERSE E-TFR FEE")
  ) {
    return {
      transaction_type: "credit",
      category: "Bank rebates",
      is_transfer: false,
      review_status: "reconciled",
    };
  }
  if (
    description.includes("CANCEL E-TFR") ||
    description.includes("RECLAIM E-TFR")
  ) {
    return {
      transaction_type: "credit",
      category: "Uncategorized",
      is_transfer: false,
      review_status: "needs_review",
    };
  }
  if (transaction.amount > 0) {
    return {
      transaction_type: "income",
      category: "Painting revenue",
      is_transfer: false,
      review_status: "needs_review",
    };
  }
  if (description.includes("SEND E-TFR")) {
    return {
      transaction_type: "expense",
      category: "Uncategorized",
      is_transfer: false,
      review_status: "needs_review",
    };
  }
  if (description.includes("WISE MSP")) {
    return {
      transaction_type: "expense",
      category: "Virtual assistant salaries",
      is_transfer: false,
      review_status: "reconciled",
    };
  }
  if (description.includes("CANADA TXD")) {
    return {
      transaction_type: "expense",
      category: "Taxes & licences",
      is_transfer: false,
      review_status: "needs_review",
    };
  }
  return {
    transaction_type: "expense",
    category: "Uncategorized",
    is_transfer: false,
    review_status: "needs_review",
  };
}

function matchesExisting(transaction, accountId, existing) {
  const postedOn = dateOnly(transaction.date);
  const transactionOn = dateOnly(transaction.authorizedDate ?? transaction.date);
  return existing.some(
    (row) =>
      row.account_id === accountId &&
      Number(row.amount) === Number(transaction.amount) &&
      row.description === transaction.description &&
      (row.posted_on === postedOn ||
        row.transaction_on === transactionOn ||
        row.posted_on === transactionOn),
  );
}

function countsBy(items, key) {
  return Object.fromEntries(
    [...new Set(items.map((item) => item[key]))]
      .map((value) => [value, items.filter((item) => item[key] === value).length])
      .sort((left, right) => right[1] - left[1]),
  );
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = path.resolve(
  optionValue("--snapshot") ?? "/tmp/ottawa-painters-banksync-2026.json",
);
const apply = process.argv.includes("--apply");
const snapshotBytes = await fs.readFile(snapshotPath);
const snapshot = JSON.parse(snapshotBytes.toString("utf8"));
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl =
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}
if (snapshot.source !== "BankSync/Plaid live TD Canada Trust connection") {
  throw new Error("Refusing import from an unexpected snapshot source.");
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchExistingTransactions() {
  const transactions = [];
  const pageSize = 1000;
  for (let page = 0; page < 20; page += 1) {
    const from = page * pageSize;
    const result = await db
      .from("financial_transactions")
      .select(
        "id,account_id,posted_on,transaction_on,amount,description,source_key,source_data,running_balance",
      )
      .order("posted_on", { ascending: false })
      .order("transaction_on", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    transactions.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return transactions;
  }
  throw new Error("Financial ledger exceeded the 20,000-row import scan limit.");
}

const [{ data: existingAccounts, error: accountsError }, existingTransactions] =
  await Promise.all([
    db
      .from("financial_accounts")
      .select("id,slug,last_four"),
    fetchExistingTransactions(),
  ]);

if (accountsError) throw accountsError;

const accountRows = snapshot.accounts.map((account) => {
  const suffix = lastFour(account.accountNumber);
  const definition = accountDefinitions[suffix];
  if (!definition) throw new Error(`Unexpected TD account ending in ${suffix}.`);
  return {
    ...definition,
    institution: "TD Canada Trust",
    last_four: suffix,
    currency: account.currency,
    is_active: true,
    current_balance: account.balance,
    available_balance: account.availableBalance,
    credit_limit: account.creditLimit || null,
    balance_as_of: snapshot.fetchedAt,
    external_provider: "banksync_plaid",
    external_account_id: account.id,
  };
});

const accountIdByLastFour = new Map(
  (existingAccounts ?? []).map((account) => [account.last_four, account.id]),
);
const sourceHash = createHash("sha256").update(snapshotBytes).digest("hex");
const transactionCandidates = [];
let duplicateCount = 0;
let pendingCount = 0;

for (const transactionSet of snapshot.transactionSets) {
  const feedAccount = snapshot.accounts.find(
    (account) => account.id === transactionSet.accountId,
  );
  if (!feedAccount) {
    throw new Error(`Missing account metadata for ${transactionSet.accountId}.`);
  }
  const suffix = lastFour(feedAccount.accountNumber);
  const definition = accountDefinitions[suffix];
  const accountId = accountIdByLastFour.get(suffix);
  if (!accountId) {
    if (apply) continue;
    accountIdByLastFour.set(suffix, `pending-account-${suffix}`);
  }

  for (const transaction of transactionSet.transactions) {
    if (transaction.pending) {
      pendingCount += 1;
      continue;
    }
    const resolvedAccountId = accountIdByLastFour.get(suffix);
    const alreadyImported = existingTransactions.some(
      (row) =>
        row.source_data?.bank_sync_transaction_id === transaction.id ||
        row.source_key === sourceKey(transaction.id),
    );
    if (
      alreadyImported ||
      matchesExisting(transaction, resolvedAccountId, existingTransactions)
    ) {
      duplicateCount += 1;
      continue;
    }

    const classification = classifyTransaction(
      transaction,
      definition.account_type,
    );
    const recurringOverhead = recurringOverheadRule(transaction);
    const isOverheadCredit = transaction.amount > 0;
    const recurringOverheadNote = recurringOverhead
      ? isOverheadCredit
        ? `${recurringOverhead.vendor} credit verified from the posted business credit-card record. It offsets ${recurringOverhead.category.toLocaleLowerCase("en-CA")} overhead; no HST adjustment is claimed without a supplier credit note.`
        : `${recurringOverhead.vendor} recurring business charge verified from the posted business credit-card record. Recorded as ${recurringOverhead.category.toLocaleLowerCase("en-CA")} overhead; no separate receipt is required and no HST input tax credit is claimed.`
      : null;
    transactionCandidates.push({
      account_id: resolvedAccountId,
      source_key: sourceKey(transaction.id),
      posted_on: dateOnly(transaction.date),
      transaction_on: dateOnly(transaction.authorizedDate ?? transaction.date),
      description: transaction.description,
      counterparty: recurringOverhead?.vendor ?? transaction.merchantName,
      amount: transaction.amount,
      tax_amount: 0,
      currency: transaction.currency,
      ...classification,
      running_balance: null,
      notes:
        recurringOverheadNote ??
        (classification.review_status === "needs_review"
          ? "Live bank feed; category and HST require review."
          : "Live bank feed; deterministic bank transfer or fee."),
      source_data: {
        source: "banksync_plaid",
        bank_sync_transaction_id: transaction.id,
        bank_sync_account_id: transaction.accountId,
        authorized_date: transaction.authorizedDate ?? null,
        merchant_name: transaction.merchantName,
        original_description: transaction.originalDescription,
        bank_category: transaction.category,
        bank_type: transaction.type,
        pending: transaction.pending,
        ...(recurringOverhead
          ? {
              expense_evidence: {
                status: "bank_supported_no_itc",
                classification: isOverheadCredit
                  ? `${recurringOverhead.classification}_credit`
                  : recurringOverhead.classification,
                vendor: recurringOverhead.vendor,
                label: isOverheadCredit
                  ? `${recurringOverhead.label} credit`
                  : recurringOverhead.label,
                detail: isOverheadCredit
                  ? `The posted business credit-card record confirms this ${recurringOverhead.vendor} credit. It offsets ${recurringOverhead.category.toLocaleLowerCase("en-CA")} overhead; no HST adjustment is claimed without a supplier credit note.`
                  : `The posted business credit-card record confirms this recurring ${recurringOverhead.vendor} charge. No separate receipt is required, and no HST input tax credit is claimed.`,
                category: recurringOverhead.category,
                evidence: "posted_business_credit_card_record",
                tax_treatment: "no_itc_claimed",
                supplier_document_status: "not_required",
                source: "deterministic recognized vendor rule",
                confirmed_on: dateOnly(snapshot.fetchedAt),
                reason:
                  "Recognized recurring overhead vendor on the posted business credit-card feed; HST remains zero until supported by a supplier tax document.",
              },
            }
          : {}),
        ...(classification.category === "Credit card payment"
          ? {
              document_exception: {
                status: "confirmed",
                kind: "credit_card_payment",
                label: "Credit card payment",
                detail:
                  "This is a transfer between Ottawa Painters bank and credit-card accounts, not a business expense. The posted bank records are the supporting evidence.",
                evidence: "posted_bank_records",
                supplier_document_status: "not_required",
                source: "deterministic credit-card payment rule",
                confirmed_on: dateOnly(snapshot.fetchedAt),
                reason:
                  "PAYMENT - THANK YOU and TFR-TO C/C are paired credit-card payment descriptions; no receipt or invoice is required.",
              },
            }
          : {}),
      },
    });
  }
}

const balanceChecks = [];
for (const account of accountRows) {
  const accountId = accountIdByLastFour.get(account.last_four);
  if (!accountId || String(accountId).startsWith("pending-account-")) continue;
  const accountTransactions = transactionCandidates.filter(
    (transaction) => transaction.account_id === accountId,
  );
  if (!accountTransactions.length) continue;

  const priorBalance = existingTransactions
    .filter(
      (transaction) =>
        transaction.account_id === accountId &&
        transaction.running_balance != null,
    )
    .sort((left, right) => {
      const dateComparison = right.posted_on.localeCompare(left.posted_on);
      return dateComparison || right.transaction_on.localeCompare(left.transaction_on);
    })[0];
  if (!priorBalance) {
    throw new Error(`No prior statement balance found for ${account.slug}.`);
  }

  const signedActivity = accountTransactions.reduce(
    (total, transaction) => total + Number(transaction.amount),
    0,
  );
  const calculatedBalance =
    account.account_type === "credit_card"
      ? Number(priorBalance.running_balance) - signedActivity
      : Number(priorBalance.running_balance) + signedActivity;
  const difference =
    Math.round((calculatedBalance - Number(account.current_balance)) * 100) / 100;
  balanceChecks.push({
    account: account.slug,
    starting_balance: Number(priorBalance.running_balance),
    posted_activity: Math.round(signedActivity * 100) / 100,
    calculated_balance: Math.round(calculatedBalance * 100) / 100,
    institution_balance: Number(account.current_balance),
    difference,
    status: Math.abs(difference) <= 0.01 ? "pass" : "fail",
  });

  accountTransactions.sort((left, right) => {
    const dateComparison = right.posted_on.localeCompare(left.posted_on);
    return dateComparison || right.transaction_on.localeCompare(left.transaction_on);
  })[0].running_balance = account.current_balance;
}
if (balanceChecks.some((check) => check.status !== "pass")) {
  throw new Error(
    `Refusing import because an account balance did not reconcile: ${JSON.stringify(balanceChecks)}`,
  );
}

const preview = {
  mode: apply ? "apply" : "dry-run",
  snapshot: path.basename(snapshotPath),
  snapshotSha256: sourceHash,
  fetchedAt: snapshot.fetchedAt,
  accountBalances: Object.fromEntries(
    accountRows.map((account) => [
      account.slug,
      {
        balance: account.current_balance,
        available: account.available_balance,
        creditLimit: account.credit_limit,
      },
    ]),
  ),
  sourceTransactions: snapshot.transactionSets.reduce(
    (total, item) => total + item.transactions.length,
    0,
  ),
  duplicatesSkipped: duplicateCount,
  pendingSkipped: pendingCount,
  newTransactions: transactionCandidates.length,
  transactionTypes: countsBy(transactionCandidates, "transaction_type"),
  categories: countsBy(transactionCandidates, "category"),
  reviewStatuses: countsBy(transactionCandidates, "review_status"),
  balanceChecks,
};
console.log(JSON.stringify(preview, null, 2));
if (!apply) process.exit(0);

const accountResult = await db
  .from("financial_accounts")
  .upsert(accountRows, { onConflict: "slug" })
  .select("id,slug,last_four");
if (accountResult.error) {
  throw new Error(`Account balance refresh failed: ${accountResult.error.message}`);
}

const appliedAccountIdByLastFour = new Map(
  (accountResult.data ?? []).map((account) => [account.last_four, account.id]),
);
for (const transaction of transactionCandidates) {
  if (String(transaction.account_id).startsWith("pending-account-")) {
    const suffix = String(transaction.account_id).slice(-4);
    transaction.account_id = appliedAccountIdByLastFour.get(suffix);
  }
}

const importRow = {
  content_sha256: sourceHash,
  original_filename: `BankSync TD Canada Trust ${snapshot.from} to ${snapshot.to}.json`,
  mime_type: "application/json",
  source_kind: "bank_feed",
  account_id: null,
  period_start: snapshot.from,
  period_end: snapshot.to,
  row_count: preview.sourceTransactions,
  metadata: {
    source: snapshot.source,
    fetched_at: snapshot.fetchedAt,
    accounts: accountRows.map((account) => ({
      slug: account.slug,
      last_four: account.last_four,
      balance: account.current_balance,
    })),
    pending_skipped: pendingCount,
    duplicates_skipped: duplicateCount,
  },
};
const importResult = await db
  .from("financial_imports")
  .upsert(importRow, { onConflict: "content_sha256" })
  .select("id")
  .single();
if (importResult.error) {
  throw new Error(`Bank-feed source import failed: ${importResult.error.message}`);
}

const rowsToInsert = transactionCandidates.map((transaction) => ({
  ...transaction,
  import_id: importResult.data.id,
}));
let inserted = 0;
for (let index = 0; index < rowsToInsert.length; index += 100) {
  const result = await db
    .from("financial_transactions")
    .insert(rowsToInsert.slice(index, index + 100))
    .select("id");
  if (result.error) {
    throw new Error(`Bank-feed transaction import failed: ${result.error.message}`);
  }
  inserted += result.data?.length ?? 0;
}

const verificationResult = await db
  .from("financial_transactions")
  .select("id", { count: "exact", head: true });
if (verificationResult.error) throw verificationResult.error;
if (inserted !== transactionCandidates.length) {
  throw new Error(
    `Inserted ${inserted} rows but expected ${transactionCandidates.length}.`,
  );
}

console.log(
  JSON.stringify(
    {
      accountsRefreshed: accountResult.data?.length ?? 0,
      sourceImportId: importResult.data.id,
      transactionsInserted: inserted,
      remoteTransactionCount: verificationResult.count,
      status: "verified",
    },
    null,
    2,
  ),
);
