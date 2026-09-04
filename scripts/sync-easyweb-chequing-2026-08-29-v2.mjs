#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CAPTURED_AT = "2026-08-29T20:31:56.000Z";
const CSV_PATH = "/Users/jadslim/Downloads/accountactivity (6).csv";
const ACCOUNT_SLUG = "td-chequing-6970";
const CURRENT_BALANCE_CENTS = 5_401_263;
const AVAILABLE_BALANCE_CENTS = 5_335_158;
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const visibleRows = [
  {
    posted_on: "2026-08-31",
    description: "E-TRANSFER ***vd3",
    amount_cents: 299_568,
    running_balance_cents: 5_401_263,
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
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseCsvLine(line) {
  const columns = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      columns.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  columns.push(value);
  return columns;
}

function cents(value) {
  const normalized = String(value ?? "").replace(/[$,\s]/g, "");
  if (!normalized) return null;
  assert(/^-?\d+(?:\.\d{1,2})?$/.test(normalized), `Invalid money value ${value}.`);
  return Math.round(Number(normalized) * 100);
}

function isoDate(value) {
  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  assert(match, `Invalid EasyWeb date ${value}.`);
  return `${match[3]}-${match[1]}-${match[2]}`;
}

function normalizedDescription(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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

assert(existsSync(CSV_PATH), `Missing EasyWeb CSV ${CSV_PATH}.`);
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing Supabase credentials.");
assert(new URL(supabaseUrl).hostname.split(".")[0] === PROJECT_REF, "Unexpected Supabase project.");
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [accountResult, existingTransactions, existingDocuments] = await Promise.all([
  db.from("accounts").select("id,slug,account_type,current_balance_cents,available_balance_cents,balance_as_of,updated_at").eq("slug", ACCOUNT_SLUG).single(),
  fetchAll(() => db.from("transactions").select("id,account_id,source_key,posted_on,description,amount_cents")),
  fetchAll(() => db.from("documents").select("id,content_sha256")),
]);
if (accountResult.error) throw accountResult.error;
const account = accountResult.data;

const csvBytes = readFileSync(CSV_PATH);
const csvHash = sha256(csvBytes);
const csvRows = csvBytes.toString("utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
  const columns = parseCsvLine(line);
  assert(columns.length === 5, `CSV row ${index + 1} has ${columns.length} columns.`);
  const debit = cents(columns[2]);
  const credit = cents(columns[3]);
  assert((debit == null) !== (credit == null), `CSV row ${index + 1} needs one debit or credit.`);
  const postedOn = isoDate(columns[0]);
  const description = normalizedDescription(columns[1]);
  const amountCents = credit ?? -debit;
  const runningBalanceCents = cents(columns[4]);
  return {
    posted_on: postedOn,
    description,
    amount_cents: amountCents,
    running_balance_cents: runningBalanceCents,
    source_key: sha256(`td-easyweb-v2:${ACCOUNT_SLUG}:${postedOn}:${description}:${amountCents}:${runningBalanceCents}`),
    source_row_number: index + 1,
    raw_row: columns,
  };
});

const csvDocument = {
  id: stableUuid(`document:td-easyweb:${ACCOUNT_SLUG}:${csvHash}`),
  kind: "bank_activity_csv",
  original_filename: "TD EasyWeb Chequing 6970 downloaded 2026-08-29.csv",
  mime_type: "text/csv",
  size_bytes: csvBytes.length,
  content_sha256: csvHash,
  storage_bucket: null,
  storage_path: null,
  source_url: "https://easyweb.td.com/",
  captured_at: CAPTURED_AT,
  metadata: {
    source: "TD EasyWeb direct CSV download",
    account_id: account.id,
    account_slug: ACCOUNT_SLUG,
    period_start: csvRows[0].posted_on,
    period_end: csvRows.at(-1).posted_on,
    row_count: csvRows.length,
    original_download_name: path.basename(CSV_PATH),
    raw_csv: csvBytes.toString("utf8"),
  },
};
const visiblePayload = JSON.stringify({
  source: "TD EasyWeb visible posted account activity",
  captured_at: CAPTURED_AT,
  account_slug: ACCOUNT_SLUG,
  rows: visibleRows,
});
const visibleHash = sha256(visiblePayload);
const visibleDocument = {
  id: stableUuid(`document:td-easyweb:visible:${visibleHash}`),
  kind: "bank_activity_observation",
  original_filename: "TD EasyWeb visible posted activity observed 2026-08-29.json",
  mime_type: "application/json",
  size_bytes: Buffer.byteLength(visiblePayload),
  content_sha256: visibleHash,
  storage_bucket: null,
  storage_path: null,
  source_url: "https://easyweb.td.com/",
  captured_at: CAPTURED_AT,
  metadata: JSON.parse(visiblePayload),
};

const exactKey = (row) => [row.account_id ?? account.id, row.posted_on, normalizedDescription(row.description), Number(row.amount_cents)].join("|");
const transferReference = (description) =>
  normalizedDescription(description).match(/\*{1,3}([a-z0-9]{3})\b/i)?.[1]?.toUpperCase() ?? null;
const dayNumber = (value) => Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000);
const remainingExact = new Map();
for (const row of existingTransactions.filter((item) => item.account_id === account.id)) {
  remainingExact.set(exactKey(row), (remainingExact.get(exactKey(row)) ?? 0) + 1);
}
const existingSourceKeys = new Set(existingTransactions.map((row) => row.source_key));
const remainingReferenceMatches = existingTransactions
  .filter((row) => row.account_id === account.id)
  .map((row) => ({ row, reference: transferReference(row.description) }))
  .filter((item) => item.reference);
const candidates = [];
function addCandidate(row, document, sourceName, extraMetadata = {}) {
  const key = exactKey(row);
  const exactCount = remainingExact.get(key) ?? 0;
  if (existingSourceKeys.has(row.source_key) || exactCount > 0) {
    if (exactCount > 0) remainingExact.set(key, exactCount - 1);
    return;
  }
  const reference = transferReference(row.description);
  if (reference) {
    const referenceMatchIndex = remainingReferenceMatches.findIndex(
      (item) =>
        item.reference === reference &&
        Number(item.row.amount_cents) === Number(row.amount_cents) &&
        Math.abs(dayNumber(item.row.posted_on) - dayNumber(row.posted_on)) <= 1,
    );
    if (referenceMatchIndex >= 0) {
      remainingReferenceMatches.splice(referenceMatchIndex, 1);
      return;
    }
  }
  const isIncome = row.amount_cents > 0;
  candidates.push({
    id: stableUuid(`transaction:${account.id}:${row.source_key}`),
    account_id: account.id,
    import_document_id: document.id,
    contact_id: null,
    source_key: row.source_key,
    posted_on: row.posted_on,
    transaction_on: row.posted_on,
    description: row.description,
    counterparty: null,
    amount_cents: row.amount_cents,
    tax_cents: 0,
    net_cents: row.amount_cents,
    currency: "CAD",
    transaction_type: isIncome ? "income" : "expense",
    category: isIncome ? "Painting revenue" : "Uncategorized",
    is_transfer: false,
    review_status: "needs_review",
    running_balance_cents: row.running_balance_cents,
    notes: isIncome
      ? "Posted bank deposit; customer revenue allocation requires exact evidence."
      : "Posted bank withdrawal; recipient and invoice evidence require review.",
    metadata: {
      source: sourceName,
      source_document_sha256: document.content_sha256,
      pending: false,
      tax_evidence: { status: "unreviewed", tax_cents: 0 },
      ...extraMetadata,
    },
    created_at: CAPTURED_AT,
    updated_at: CAPTURED_AT,
  });
}

for (const row of csvRows) {
  addCandidate(row, csvDocument, "td_easyweb_csv", {
    source_filename: csvDocument.original_filename,
    source_row_number: row.source_row_number,
    raw_row: row.raw_row,
  });
}
for (const row of visibleRows) {
  addCandidate({
    ...row,
    source_key: sha256(`td-easyweb-visible:${ACCOUNT_SLUG}:${row.posted_on}:${row.description}:${row.amount_cents}:${row.running_balance_cents}`),
  }, visibleDocument, "td_easyweb_visible_activity", { observed_on: "2026-08-29" });
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  csv_sha256: csvHash,
  csv_rows: csvRows.length,
  new_transactions: candidates.map(({ posted_on, description, amount_cents, running_balance_cents }) => ({ posted_on, description, amount_cents, running_balance_cents })),
  old_balance: {
    current_balance_cents: account.current_balance_cents,
    available_balance_cents: account.available_balance_cents,
    balance_as_of: account.balance_as_of,
  },
  new_balance: {
    current_balance_cents: CURRENT_BALANCE_CENTS,
    available_balance_cents: AVAILABLE_BALANCE_CENTS,
    balance_as_of: CAPTURED_AT,
  },
}, null, 2));
if (!APPLY) process.exit(0);

for (const document of [csvDocument, visibleDocument]) {
  const existing = existingDocuments.find((item) => item.content_sha256 === document.content_sha256);
  if (existing && existing.id !== document.id) {
    for (const candidate of candidates) {
      if (candidate.import_document_id === document.id) candidate.import_document_id = existing.id;
    }
    continue;
  }
  const write = await db.from("documents").upsert(document, { onConflict: "id" });
  if (write.error) throw write.error;
}
if (candidates.length) {
  const write = await db.from("transactions").insert(candidates);
  if (write.error) throw write.error;
}
const balanceWrite = await db.from("accounts").update({
  current_balance_cents: CURRENT_BALANCE_CENTS,
  available_balance_cents: AVAILABLE_BALANCE_CENTS,
  balance_as_of: CAPTURED_AT,
  updated_at: CAPTURED_AT,
}).eq("id", account.id).eq("updated_at", account.updated_at).select("id").maybeSingle();
if (balanceWrite.error) throw balanceWrite.error;
assert(balanceWrite.data, "Concurrent account update detected.");

const eventWrite = await db.from("verification_events").upsert({
  id: stableUuid(`verification:easyweb-balance:${account.id}:${CAPTURED_AT}`),
  entity_type: "account_balance",
  entity_id: account.id,
  action: "balance_observed",
  reason: "TD EasyWeb displayed the current and available balances after the posted activity was downloaded and reviewed.",
  old_values: {
    current_balance_cents: account.current_balance_cents,
    available_balance_cents: account.available_balance_cents,
    balance_as_of: account.balance_as_of,
  },
  new_values: {
    current_balance_cents: CURRENT_BALANCE_CENTS,
    available_balance_cents: AVAILABLE_BALANCE_CENTS,
    balance_as_of: CAPTURED_AT,
  },
  evidence: {
    csv_document_id: candidates.find((row) => row.import_document_id === csvDocument.id)?.import_document_id ?? csvDocument.id,
    visible_document_id: visibleDocument.id,
    source: "TD EasyWeb direct CSV and visible account activity",
  },
  occurred_at: CAPTURED_AT,
}, { onConflict: "id" });
if (eventWrite.error) throw eventWrite.error;

const verification = await db.from("transactions").select("id,posted_on,description,amount_cents").in("id", candidates.map((row) => row.id));
if (verification.error) throw verification.error;
assert((verification.data ?? []).length === candidates.length, "Inserted transaction verification failed.");
const accountVerification = await db.from("accounts").select("current_balance_cents,available_balance_cents,balance_as_of").eq("id", account.id).single();
if (accountVerification.error) throw accountVerification.error;
assert(accountVerification.data.current_balance_cents === CURRENT_BALANCE_CENTS, "Current balance verification failed.");
assert(accountVerification.data.available_balance_cents === AVAILABLE_BALANCE_CENTS, "Available balance verification failed.");

console.log(JSON.stringify({
  status: "verified",
  transactions_inserted: candidates.length,
  transactions_verified: verification.data?.length ?? 0,
  account: accountVerification.data,
}, null, 2));
