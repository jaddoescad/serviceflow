#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CAPTURED_AT = "2026-09-01T14:47:30.000Z";
const OBSERVED_ON = "2026-09-01";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const sources = [
  {
    accountSlug: "td-chequing-6970",
    filePath: "/Users/jadslim/Downloads/accountactivity (7).csv",
    evidenceFilename: "TD EasyWeb Chequing 6970 downloaded 2026-09-01.csv",
  },
  {
    accountSlug: "td-visa-6650",
    filePath: "/Users/jadslim/Downloads/accountactivity (8).csv",
    evidenceFilename: "TD EasyWeb Visa 6650 downloaded 2026-09-01.csv",
  },
  {
    accountSlug: "td-visa-3660",
    filePath: "/Users/jadslim/Downloads/accountactivity (9).csv",
    evidenceFilename: "TD EasyWeb Visa 3660 downloaded 2026-09-01.csv",
  },
];

const accountSnapshots = {
  "td-chequing-6970": {
    current_balance_cents: 5_196_890,
    available_balance_cents: 5_574_027,
    pending_cents: 377_137,
    note: "EasyWeb showed a $51,968.90 current balance and $55,740.27 available balance. The $3,771.37 September 1 deposit is visible but not included in the previous-business-day CSV and is kept out of the posted ledger until it settles.",
  },
  "td-investor-7861": {
    current_balance_cents: 0,
    available_balance_cents: 0,
    pending_cents: 0,
    note: "EasyWeb showed a zero balance and no activity for the business investor account.",
  },
  "td-visa-6650": {
    current_balance_cents: 48_009,
    available_balance_cents: 433_900,
    pending_cents: 272_234,
    note: "EasyWeb showed a $480.09 current balance, $4,339.00 available credit, and $2,722.34 of pending card activity. Pending card rows are excluded from the posted ledger.",
  },
  "td-visa-3660": {
    current_balance_cents: 0,
    available_balance_cents: 750_000,
    pending_cents: 0,
    note: "EasyWeb showed a zero current balance, $7,500.00 available credit, and no pending activity.",
  },
};

const pendingObservations = [
  {
    account_slug: "td-chequing-6970",
    transaction_on: "2026-09-01",
    description: "E-TRANSFER ***xpY",
    amount_cents: 377_137,
    status: "visible_not_in_posted_csv",
  },
  {
    account_slug: "td-visa-6650",
    amount_cents: -272_234,
    status: "pending_total",
  },
];

const visiblePostedRows = [
  {
    account_slug: "td-visa-6650",
    posted_on: "2026-08-31",
    description: "PAYMENT - THANK YOU",
    amount_cents: 587_783,
    running_balance_cents: 48_009,
    evidence: {
      source: "TD EasyWeb visible posted activity",
      observed_on: OBSERVED_ON,
      reason: "EasyWeb shows the August 31 payment as posted and reflected in the current balance, while warning that recently posted payments may be absent from the CSV download.",
    },
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.trim()));
}

function cents(value) {
  const normalized = String(value ?? "").trim().replace(/[$,]/g, "");
  if (!normalized) return null;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error(`Invalid money value ${value}.`);
  return Math.round(Number(normalized) * 100);
}

function isoDate(value) {
  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error(`Invalid EasyWeb date ${value}.`);
  return `${match[3]}-${match[1]}-${match[2]}`;
}

function normalizedDescription(value) {
  return String(value ?? "").replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
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

function classify(description, amountCents, accountType) {
  const lower = normalizedDescription(description).toLocaleLowerCase("en-CA");
  const upper = lower.toLocaleUpperCase("en-CA");
  if (accountType === "credit_card") {
    if (/PAYMENT\s*[–-]\s*THANK YOU/.test(upper)) {
      return { transaction_type: "transfer", category: "Credit card payment", is_transfer: true, review_status: "reconciled", notes: "Posted credit-card payment; paired posted bank records are sufficient evidence and no supplier invoice is required." };
    }
    if (upper.includes("ANNUAL FEE") || upper.includes("OVERLIMIT FEE")) {
      return { transaction_type: amountCents > 0 ? "credit" : "expense", category: "Bank fees", is_transfer: false, review_status: "reconciled", notes: "Posted credit-card fee; the bank record is the supporting document." };
    }
    const confirmedRecurring = [
      [["facebk", "facebook"], "Advertising & marketing", "Facebook"],
      [["openphone", "quo ("], "Phone & communication", "Quo/OpenPhone"],
      [["linkedin"], "Professional subscriptions", "LinkedIn"],
    ].find(([terms]) => terms.some((term) => lower.includes(term)));
    if (confirmedRecurring) {
      return { transaction_type: amountCents > 0 ? "credit" : "expense", category: confirmedRecurring[1], is_transfer: false, review_status: "reconciled", notes: `${confirmedRecurring[2]} recurring business activity verified by the posted card record; no HST ITC is claimed without a supplier tax document.` };
    }
    if (["sherwin", "paint", "home depot", "rona", "randalls", "home hardware"].some((term) => lower.includes(term))) {
      return { transaction_type: amountCents > 0 ? "credit" : "expense", category: "Paint & materials", is_transfer: false, review_status: "needs_review", notes: "Posted material charge; supplier invoice and job allocation are required." };
    }
    return { transaction_type: amountCents > 0 ? "credit" : "expense", category: "Uncategorized", is_transfer: false, review_status: "needs_review", notes: "Posted credit-card activity; category and source document require review." };
  }
  if (upper.includes("TFR-TO C/C")) {
    return { transaction_type: "transfer", category: "Credit card payment", is_transfer: true, review_status: "reconciled", notes: "Transfer to an Ottawa Painters credit-card account; not a business expense." };
  }
  if (["SEND E-TFR FEE", "MONTHLY PLAN FEE", "SERVICE CHARGE"].some((term) => upper.includes(term))) {
    return { transaction_type: "expense", category: "Bank fees", is_transfer: false, review_status: "reconciled", notes: "Posted bank fee; the bank record is the supporting document." };
  }
  if (upper.includes("ACCT BAL REBATE")) {
    return { transaction_type: "credit", category: "Bank rebates", is_transfer: false, review_status: "reconciled", notes: "Posted account rebate; the bank record is the supporting document." };
  }
  if (amountCents > 0) {
    return { transaction_type: "income", category: "Painting revenue", is_transfer: false, review_status: "needs_review", notes: "Posted bank deposit; customer revenue allocation requires exact evidence." };
  }
  return { transaction_type: "expense", category: "Uncategorized", is_transfer: false, review_status: "needs_review", notes: "Posted bank withdrawal; recipient and invoice evidence require review." };
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

for (const source of sources) {
  if (!existsSync(source.filePath)) throw new Error(`Missing EasyWeb CSV ${source.filePath}.`);
}
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const [accounts, existingTransactions, existingDocuments] = await Promise.all([
  fetchAll(() => db.from("accounts").select("id,slug,name,account_type,last_four,current_balance_cents,available_balance_cents,balance_as_of,updated_at")),
  fetchAll(() => db.from("transactions").select("id,account_id,source_key,posted_on,transaction_on,description,amount_cents,running_balance_cents,metadata")),
  fetchAll(() => db.from("documents").select("id,content_sha256")),
]);
const accountBySlug = new Map(accounts.map((account) => [account.slug, account]));
for (const slug of Object.keys(accountSnapshots)) {
  if (!accountBySlug.has(slug)) throw new Error(`Database account ${slug} is missing.`);
}

const documents = [];
const parsedRows = [];
for (const source of sources) {
  const account = accountBySlug.get(source.accountSlug);
  const bytes = readFileSync(source.filePath);
  const contentHash = sha256(bytes);
  const rows = parseCsv(bytes.toString("utf8")).map((columns, index) => {
    if (columns.length !== 5) throw new Error(`${source.evidenceFilename} row ${index + 1} has ${columns.length} columns.`);
    const debit = cents(columns[2]);
    const credit = cents(columns[3]);
    if ((debit == null) === (credit == null)) throw new Error(`${source.evidenceFilename} row ${index + 1} needs one debit or credit.`);
    const postedOn = isoDate(columns[0]);
    const description = normalizedDescription(columns[1]);
    const amountCents = credit ?? -debit;
    const runningBalanceCents = cents(columns[4]);
    return {
      account,
      source,
      rowNumber: index + 1,
      posted_on: postedOn,
      description,
      amount_cents: amountCents,
      running_balance_cents: runningBalanceCents,
      source_key: sha256(`td-easyweb-v2:${source.accountSlug}:${postedOn}:${description}:${amountCents}:${runningBalanceCents}`),
      raw: columns,
      contentHash,
    };
  });
  const dates = rows.map((row) => row.posted_on).sort();
  const snapshot = accountSnapshots[source.accountSlug];
  const latestDate = dates.at(-1);
  const latestBalances = [
    ...rows.filter((row) => row.posted_on === latestDate).map((row) => row.running_balance_cents),
    ...visiblePostedRows.filter((row) => row.account_slug === source.accountSlug).map((row) => row.running_balance_cents),
  ];
  if (!latestBalances.includes(snapshot.current_balance_cents)) {
    throw new Error(`${source.accountSlug} CSV does not reconcile to the observed current balance.`);
  }
  documents.push({
    id: stableUuid(`document:td-easyweb:${source.accountSlug}:${contentHash}`),
    kind: "bank_activity_csv",
    original_filename: source.evidenceFilename,
    mime_type: "text/csv",
    size_bytes: bytes.length,
    content_sha256: contentHash,
    storage_bucket: null,
    storage_path: null,
    source_url: "https://easyweb.td.com/",
    captured_at: CAPTURED_AT,
    metadata: { source: "TD EasyWeb direct CSV download", account_id: account.id, account_slug: source.accountSlug, period_start: dates[0], period_end: latestDate, row_count: rows.length, original_download_name: path.basename(source.filePath), raw_csv: bytes.toString("utf8") },
  });
  parsedRows.push(...rows);
}

const observationPayload = JSON.stringify({ source: "TD EasyWeb visible balances and activity", observed_on: OBSERVED_ON, accounts: accountSnapshots, posted_rows_not_in_csv: visiblePostedRows, pending: pendingObservations });
const observationHash = sha256(observationPayload);
const observationDocument = {
  id: stableUuid(`document:td-easyweb:observation:${observationHash}`),
  kind: "bank_activity_observation",
  original_filename: "TD EasyWeb balances and pending activity observed 2026-09-01.json",
  mime_type: "application/json",
  size_bytes: Buffer.byteLength(observationPayload),
  content_sha256: observationHash,
  storage_bucket: null,
  storage_path: null,
  source_url: "https://easyweb.td.com/",
  captured_at: CAPTURED_AT,
  metadata: JSON.parse(observationPayload),
};
documents.push(observationDocument);
const documentBySlug = new Map(documents.filter((document) => document.kind === "bank_activity_csv").map((document) => [document.metadata.account_slug, document]));

const exactKey = (accountId, postedOn, description, amountCents) => [accountId, postedOn, normalizedDescription(description), Number(amountCents)].join("|");
const transferReference = (description) => normalizedDescription(description).match(/\*{1,3}([a-z0-9]{3})\b/i)?.[1]?.toUpperCase() ?? null;
const dayNumber = (value) => Math.floor(Date.parse(`${value}T00:00:00Z`) / 86_400_000);
const remainingExact = new Map();
for (const row of existingTransactions) {
  const key = exactKey(row.account_id, row.posted_on, row.description, row.amount_cents);
  remainingExact.set(key, (remainingExact.get(key) ?? 0) + 1);
}
const existingSourceKeys = new Set(existingTransactions.map((row) => row.source_key));
const remainingReferences = existingTransactions.map((row) => ({ row, reference: transferReference(row.description) })).filter((item) => item.reference);
const remainingNearbyFees = existingTransactions.filter((row) => normalizedDescription(row.description).toLocaleUpperCase("en-CA") === "SEND E-TFR FEE" && Number(row.amount_cents) === -150);
const creditCardAccountIds = new Set(accounts.filter((account) => account.account_type === "credit_card").map((account) => account.id));
const remainingNearbyCardRows = existingTransactions.filter((row) => creditCardAccountIds.has(row.account_id));
let nearbyTransferFeesToConsume = 0;
const candidates = [];
for (const row of parsedRows) {
  const key = exactKey(row.account.id, row.posted_on, row.description, row.amount_cents);
  const exactCount = remainingExact.get(key) ?? 0;
  if (existingSourceKeys.has(row.source_key) || exactCount > 0) {
    if (exactCount > 0) remainingExact.set(key, exactCount - 1);
    if (row.account.account_type === "credit_card") {
      const cardIndex = remainingNearbyCardRows.findIndex((item) => exactKey(item.account_id, item.posted_on, item.description, item.amount_cents) === key);
      if (cardIndex >= 0) remainingNearbyCardRows.splice(cardIndex, 1);
    }
    continue;
  }
  if (row.account.account_type === "credit_card") {
    const cardIndex = remainingNearbyCardRows.findIndex((item) => item.account_id === row.account.id && Number(item.amount_cents) === row.amount_cents && normalizedDescription(item.description) === row.description && Math.abs(dayNumber(item.posted_on) - dayNumber(row.posted_on)) <= 3);
    if (cardIndex >= 0) {
      remainingNearbyCardRows.splice(cardIndex, 1);
      continue;
    }
  }
  const reference = transferReference(row.description);
  if (reference) {
    const referenceIndex = remainingReferences.findIndex((item) => item.reference === reference && item.row.account_id === row.account.id && Number(item.row.amount_cents) === row.amount_cents && Math.abs(dayNumber(item.row.posted_on) - dayNumber(row.posted_on)) <= 3);
    if (referenceIndex >= 0) {
      const matched = remainingReferences[referenceIndex];
      if (Math.abs(dayNumber(matched.row.posted_on) - dayNumber(row.posted_on)) > 1) nearbyTransferFeesToConsume += 1;
      remainingReferences.splice(referenceIndex, 1);
      continue;
    }
  }
  if (normalizedDescription(row.description).toLocaleUpperCase("en-CA") === "SEND E-TFR FEE" && row.amount_cents === -150 && nearbyTransferFeesToConsume > 0) {
    const feeIndex = remainingNearbyFees.findIndex((fee) => fee.account_id === row.account.id && Math.abs(dayNumber(fee.posted_on) - dayNumber(row.posted_on)) <= 3);
    if (feeIndex >= 0) {
      remainingNearbyFees.splice(feeIndex, 1);
      nearbyTransferFeesToConsume -= 1;
      continue;
    }
  }
  const classification = classify(row.description, row.amount_cents, row.account.account_type);
  candidates.push({
    id: stableUuid(`transaction:${row.account.id}:${row.source_key}`),
    account_id: row.account.id,
    import_document_id: documentBySlug.get(row.source.accountSlug).id,
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
    ...classification,
    running_balance_cents: row.running_balance_cents,
    metadata: { source: "td_easyweb_csv", source_document_sha256: row.contentHash, source_filename: row.source.evidenceFilename, source_row_number: row.rowNumber, raw_row: row.raw, pending: false, tax_evidence: { status: "unreviewed", tax_cents: 0 } },
    created_at: CAPTURED_AT,
    updated_at: CAPTURED_AT,
  });
}

const remainingVisible = new Map();
for (const row of [...existingTransactions, ...candidates]) {
  const key = exactKey(row.account_id, row.posted_on, row.description, row.amount_cents);
  remainingVisible.set(key, (remainingVisible.get(key) ?? 0) + 1);
}
for (const row of visiblePostedRows) {
  const account = accountBySlug.get(row.account_slug);
  const sourceKey = sha256(`td-easyweb-visible:${row.account_slug}:${row.posted_on}:${row.description}:${row.amount_cents}:${row.running_balance_cents}`);
  const key = exactKey(account.id, row.posted_on, row.description, row.amount_cents);
  const matchCount = remainingVisible.get(key) ?? 0;
  if (existingSourceKeys.has(sourceKey) || matchCount > 0) {
    if (matchCount > 0) remainingVisible.set(key, matchCount - 1);
    continue;
  }
  const classification = classify(row.description, row.amount_cents, account.account_type);
  candidates.push({
    id: stableUuid(`transaction:${account.id}:${sourceKey}`),
    account_id: account.id,
    import_document_id: observationDocument.id,
    contact_id: null,
    source_key: sourceKey,
    posted_on: row.posted_on,
    transaction_on: row.posted_on,
    description: normalizedDescription(row.description),
    counterparty: null,
    amount_cents: row.amount_cents,
    tax_cents: 0,
    net_cents: row.amount_cents,
    currency: "CAD",
    ...classification,
    running_balance_cents: row.running_balance_cents,
    metadata: { ...row.evidence, source_document_sha256: observationHash, pending: false, tax_evidence: { status: "not_applicable", tax_cents: 0 } },
    created_at: CAPTURED_AT,
    updated_at: CAPTURED_AT,
  });
}

const countsBy = (rows, key) => Object.fromEntries([...new Set(rows.map((row) => row[key]))].map((value) => [value, rows.filter((row) => row[key] === value).length]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
const preview = {
  mode: APPLY ? "apply" : "dry-run",
  existingTransactionCount: existingTransactions.length,
  sourceRows: parsedRows.length,
  documents: documents.map((document) => ({ filename: document.original_filename, sha256: document.content_sha256, rows: document.metadata.row_count ?? 0 })),
  existingDocumentsMatched: documents.filter((document) => existingDocuments.some((existing) => existing.content_sha256 === document.content_sha256)).length,
  newTransactions: candidates.length,
  byAccount: Object.fromEntries(Object.keys(accountSnapshots).map((slug) => [slug, candidates.filter((row) => row.account_id === accountBySlug.get(slug).id).length])),
  byCategory: countsBy(candidates, "category"),
  byReviewStatus: countsBy(candidates, "review_status"),
  pendingExcluded: pendingObservations,
  candidates: candidates.map((row) => ({ account: accounts.find((account) => account.id === row.account_id).slug, date: row.posted_on, description: row.description, amount_cents: row.amount_cents, running_balance_cents: row.running_balance_cents, category: row.category, review_status: row.review_status })),
  balanceSnapshots: accountSnapshots,
  oldBalances: Object.fromEntries(Object.keys(accountSnapshots).map((slug) => {
    const account = accountBySlug.get(slug);
    return [slug, { current_balance_cents: account.current_balance_cents, available_balance_cents: account.available_balance_cents, balance_as_of: account.balance_as_of }];
  })),
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) process.exit(0);

for (const document of documents) {
  const existing = existingDocuments.find((item) => item.content_sha256 === document.content_sha256);
  if (existing && existing.id !== document.id) {
    for (const candidate of candidates) if (candidate.import_document_id === document.id) candidate.import_document_id = existing.id;
    continue;
  }
  const result = await db.from("documents").upsert(document, { onConflict: "id" });
  if (result.error) throw result.error;
}
if (candidates.length) {
  const result = await db.from("transactions").upsert(candidates, { onConflict: "id" });
  if (result.error) throw result.error;
}
for (const [slug, snapshot] of Object.entries(accountSnapshots)) {
  const account = accountBySlug.get(slug);
  const result = await db.from("accounts").update({ current_balance_cents: snapshot.current_balance_cents, available_balance_cents: snapshot.available_balance_cents, balance_as_of: CAPTURED_AT, updated_at: CAPTURED_AT }).eq("id", account.id).eq("updated_at", account.updated_at).select("id").maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error(`Concurrent account update detected for ${slug}.`);
  const event = await db.from("verification_events").upsert({
    id: stableUuid(`verification:easyweb-balance:${account.id}:${CAPTURED_AT}`),
    entity_type: "account_balance",
    entity_id: account.id,
    action: "balance_observed",
    reason: snapshot.note,
    old_values: { current_balance_cents: account.current_balance_cents, available_balance_cents: account.available_balance_cents, balance_as_of: account.balance_as_of },
    new_values: { current_balance_cents: snapshot.current_balance_cents, available_balance_cents: snapshot.available_balance_cents, pending_cents: snapshot.pending_cents, balance_as_of: CAPTURED_AT },
    evidence: { source: "TD EasyWeb direct CSV and visible account activity", observation_document_id: observationDocument.id, observed_on: OBSERVED_ON },
    occurred_at: CAPTURED_AT,
  }, { onConflict: "id" });
  if (event.error) throw event.error;
}

const insertedIds = candidates.map((row) => row.id);
const verified = insertedIds.length ? await db.from("transactions").select("id,account_id,posted_on,description,amount_cents,review_status").in("id", insertedIds) : { data: [], error: null };
if (verified.error) throw verified.error;
if ((verified.data ?? []).length !== insertedIds.length) throw new Error("Inserted transaction verification failed.");
const verifiedAccounts = await db.from("accounts").select("slug,current_balance_cents,available_balance_cents,balance_as_of").in("slug", Object.keys(accountSnapshots));
if (verifiedAccounts.error) throw verifiedAccounts.error;
for (const account of verifiedAccounts.data ?? []) {
  const snapshot = accountSnapshots[account.slug];
  if (account.current_balance_cents !== snapshot.current_balance_cents || account.available_balance_cents !== snapshot.available_balance_cents || Date.parse(account.balance_as_of) !== Date.parse(CAPTURED_AT)) throw new Error(`Balance verification failed for ${account.slug}.`);
}
const syncedRows = await db.from("transactions").select("id", { count: "exact", head: true }).eq("created_at", CAPTURED_AT);
if (syncedRows.error) throw syncedRows.error;
if (syncedRows.count !== 15) throw new Error(`Sync-row verification failed: expected 15, found ${syncedRows.count}.`);
const totalCount = await db.from("transactions").select("id", { count: "exact", head: true });
if (totalCount.error) throw totalCount.error;
console.log(JSON.stringify({ status: "verified", transactionsInsertedThisRun: verified.data?.length ?? 0, transactionsInThisSync: syncedRows.count, transactionCountBeforeThisRun: existingTransactions.length, transactionCountAfter: totalCount.count, accountsUpdated: verifiedAccounts.data?.length ?? 0, documentsPreserved: documents.length, pendingExcluded: pendingObservations.length }, null, 2));
