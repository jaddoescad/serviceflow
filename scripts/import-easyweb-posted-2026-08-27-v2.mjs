#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CAPTURED_AT = "2026-08-27T18:25:58.000Z";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const accountObservations = [
  {
    lastFour: "6970",
    currentBalanceCents: 5_369_620,
    availableBalanceCents: 5_165_200,
    creditLimitCents: null,
  },
  {
    lastFour: "6650",
    currentBalanceCents: 367_141,
    availableBalanceCents: 193_600,
    creditLimitCents: 750_000,
  },
];

const observedRows = [
  {
    key: "chequing-6970-2026-08-26-e-transfer-7e6-3000",
    accountLastFour: "6970",
    postedOn: "2026-08-26",
    transactionOn: "2026-08-26",
    description: "E-TRANSFER ***7E6",
    counterparty: "Darya Rafi Pour",
    contactId: "5e4d400b-d992-5d1f-8773-86984914cf95",
    amountCents: 300_000,
    runningBalanceCents: 5_426_270,
    transactionType: "income",
    category: "Painting revenue",
    isTransfer: false,
    reviewStatus: "needs_review",
    notes: "Posted TD EasyWeb customer receipt. Sender identity is confirmed, but no new DripJobs payment record was used to settle the customer invoice.",
    evidence: {
      kind: "interac_incoming",
      status: "Autodeposited",
      sender: "DARYA RAFI POUR",
      amount_cents: 300_000,
      date_deposited: "2026-08-26",
      confirmation_masked: "C1AGqw***7E6",
      recipient: "Ottawa Painters info@paintersottawa.com",
      method: "Email",
    },
  },
  {
    key: "chequing-6970-2026-08-27-send-e-transfer-bvj-565",
    accountLastFour: "6970",
    postedOn: "2026-08-27",
    transactionOn: "2026-08-27",
    description: "SEND E-TFR ***bvJ",
    counterparty: "BM Group",
    contactId: null,
    amountCents: -56_500,
    runningBalanceCents: 5_369_770,
    transactionType: "expense",
    category: "General overhead",
    isTransfer: false,
    reviewStatus: "needs_review",
    notes: "Recipient confirmed as BM Group, the accounting company. This is not Burim/BM Contracting and is not a labour-invoice payment.",
    evidence: {
      kind: "interac_outgoing",
      status: "Autodeposited",
      recipient: "bm group",
      recipient_destination: "info@thebmgroup.ca",
      amount_cents: 56_500,
      date_sent: "2026-08-27",
      confirmation_masked: "C1Aq66***bvJ",
      sent_by: "OTTAWA PAINTERS",
      method: "Email",
      classification_confirmation: "BM Group is the accounting company and is distinct from Burim/BM Contracting.",
    },
  },
  {
    key: "chequing-6970-2026-08-27-send-e-transfer-fee-150",
    accountLastFour: "6970",
    postedOn: "2026-08-27",
    transactionOn: "2026-08-27",
    description: "SEND E-TFR FEE",
    counterparty: null,
    contactId: null,
    amountCents: -150,
    runningBalanceCents: 5_369_620,
    transactionType: "expense",
    category: "Bank fees",
    isTransfer: false,
    reviewStatus: "reconciled",
    notes: "Posted TD EasyWeb Interac e-Transfer fee; no supplier document required.",
    evidence: {
      kind: "bank_fee",
      related_transfer_confirmation_masked: "C1Aq66***bvJ",
      supplier_document_status: "not_required",
    },
  },
  {
    key: "visa-6650-2026-08-24-payment-thank-you-149151",
    accountLastFour: "6650",
    postedOn: "2026-08-24",
    transactionOn: "2026-08-24",
    description: "PAYMENT - THANK YOU",
    counterparty: null,
    contactId: null,
    amountCents: 149_151,
    runningBalanceCents: 154_833,
    transactionType: "transfer",
    category: "Credit card payment",
    isTransfer: true,
    reviewStatus: "reconciled",
    notes: "Posted Visa-side payment paired to the exact $1,491.51 chequing transfer.",
    evidence: {
      kind: "credit_card_payment",
      paired_account_last_four: "6970",
      paired_description: "RH403 TFR-TO C/C",
      paired_posted_on: "2026-08-24",
      paired_amount_cents: -149_151,
      supplier_document_status: "not_required",
    },
  },
  {
    key: "visa-6650-2026-08-24-quo-openphone-18668",
    accountLastFour: "6650",
    postedOn: "2026-08-24",
    transactionOn: "2026-08-24",
    description: "QUO (OPENPHONE)",
    counterparty: "Quo (OpenPhone)",
    contactId: null,
    amountCents: -18_668,
    runningBalanceCents: 173_501,
    transactionType: "expense",
    category: "Phone & communication",
    isTransfer: false,
    reviewStatus: "reconciled",
    notes: "Recognized recurring business phone charge from the posted corporate card record; no HST input tax credit is claimed without the supplier document.",
    evidence: {
      kind: "recognized_recurring_overhead",
      vendor: "Quo (OpenPhone)",
      classification: "business_phone_subscription",
      tax_treatment: "no_itc_claimed",
      supplier_document_status: "not_required",
    },
  },
  {
    key: "visa-6650-2026-08-26-sherwin-williams-193640",
    accountLastFour: "6650",
    postedOn: "2026-08-26",
    transactionOn: "2026-08-26",
    description: "Sherwin Williams Canada",
    counterparty: "Sherwin-Williams Canada",
    contactId: null,
    amountCents: -193_640,
    runningBalanceCents: 367_141,
    transactionType: "expense",
    category: "Paint & materials",
    isTransfer: false,
    reviewStatus: "needs_review",
    notes: "Posted TD EasyWeb corporate-card charge; supplier invoice, HST, and job allocation still require review.",
    evidence: {
      kind: "corporate_card_charge",
      vendor: "Sherwin-Williams Canada",
      supplier_document_status: "required_for_hst_and_job_allocation",
    },
  },
];

const pendingExcluded = [
  { transactionOn: "2026-08-27", description: "SECOND CUP 9601", amountCents: -826 },
  { transactionOn: "2026-08-27", description: "SECOND CUP 9601", amountCents: -942 },
  { transactionOn: "2026-08-27", description: "PRESTON PAINT CENTER", amountCents: -60_758 },
  { transactionOn: "2026-08-26", description: "FACEBK *T936R36JW4", amountCents: -126_500 },
];

const evidenceManifest = {
  source: "TD EasyWeb visible posted activity and transaction detail pages",
  captured_at: CAPTURED_AT,
  accounts: accountObservations,
  posted_rows: observedRows.map(({ evidence, ...row }) => ({ ...row, evidence })),
  pending_rows_excluded: pendingExcluded,
  pending_total_cents: 189_026,
};
const evidenceBytes = Buffer.from(JSON.stringify(evidenceManifest));
const evidenceHash = sha256(evidenceBytes);
const documentId = stableUuid(`document:td-easyweb-visible:${evidenceHash}`);

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing Supabase credentials.");
assert(new URL(supabaseUrl).hostname.split(".")[0] === PROJECT_REF, "Unexpected Supabase project.");
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const [accountResult, existingResult, documentResult, daryaContactResult] = await Promise.all([
  db.from("accounts").select("*").in("last_four", accountObservations.map((row) => row.lastFour)),
  db.from("transactions").select("id,account_id,source_key,posted_on,description,amount_cents,running_balance_cents").gte("posted_on", "2026-08-24").lte("posted_on", "2026-08-27"),
  db.from("documents").select("id,content_sha256").eq("content_sha256", evidenceHash).maybeSingle(),
  db.from("contacts").select("id,name").eq("id", "5e4d400b-d992-5d1f-8773-86984914cf95").maybeSingle(),
]);
for (const result of [accountResult, existingResult, documentResult, daryaContactResult]) if (result.error) throw result.error;
assert(daryaContactResult.data?.name === "Darya Rafi", "Expected Darya Rafi contact was not found.");

const accounts = accountResult.data ?? [];
assert(accounts.length === accountObservations.length, "Expected both EasyWeb accounts.");
const accountByLastFour = new Map(accounts.map((row) => [row.last_four, row]));

const candidates = [];
const duplicates = [];
for (const row of observedRows) {
  const account = accountByLastFour.get(row.accountLastFour);
  assert(account, `Missing account ending ${row.accountLastFour}.`);
  const exact = (existingResult.data ?? []).filter((existing) =>
    existing.account_id === account.id &&
    existing.posted_on === row.postedOn &&
    existing.description === row.description &&
    Number(existing.amount_cents) === row.amountCents
  );
  assert(exact.length <= 1, `Multiple exact transactions already exist for ${row.key}.`);
  if (exact.length === 1) {
    duplicates.push({ key: row.key, transactionId: exact[0].id });
    continue;
  }
  candidates.push({
    id: stableUuid(`transaction:td-easyweb-visible:${row.key}`),
    account_id: account.id,
    import_document_id: documentResult.data?.id ?? documentId,
    contact_id: row.contactId,
    source_key: `td-easyweb-visible:${row.key}`,
    posted_on: row.postedOn,
    transaction_on: row.transactionOn,
    description: row.description,
    counterparty: row.counterparty,
    amount_cents: row.amountCents,
    tax_cents: 0,
    net_cents: row.amountCents,
    currency: "CAD",
    transaction_type: row.transactionType,
    category: row.category,
    is_transfer: row.isTransfer,
    review_status: row.reviewStatus,
    running_balance_cents: row.runningBalanceCents,
    notes: row.notes,
    metadata: {
      source: "td_easyweb_visible_posted_activity",
      pending: false,
      observed_at: CAPTURED_AT,
      source_document_sha256: evidenceHash,
      tax_evidence: { status: row.reviewStatus === "reconciled" ? "not_applicable_or_no_itc_claimed" : "unreviewed", tax_cents: 0 },
      easyweb_evidence: row.evidence,
    },
    created_at: CAPTURED_AT,
    updated_at: CAPTURED_AT,
  });
}

const preview = {
  mode: APPLY ? "apply" : "dry-run",
  evidence_sha256: evidenceHash,
  posted_observed: observedRows.length,
  new_transactions: candidates.length,
  duplicates_skipped: duplicates,
  pending_excluded: pendingExcluded,
  account_updates: accountObservations,
  candidates: candidates.map((row) => ({
    id: row.id,
    account: accounts.find((account) => account.id === row.account_id)?.slug,
    posted_on: row.posted_on,
    description: row.description,
    counterparty: row.counterparty,
    amount_cents: row.amount_cents,
    category: row.category,
    review_status: row.review_status,
  })),
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) process.exit();

if (!documentResult.data) {
  const write = await db.from("documents").insert({
    id: documentId,
    kind: "bank_activity_snapshot",
    original_filename: "td-easyweb-visible-posted-activity-2026-08-27.json",
    mime_type: "application/json",
    size_bytes: evidenceBytes.length,
    content_sha256: evidenceHash,
    storage_bucket: null,
    storage_path: null,
    source_url: null,
    captured_at: CAPTURED_AT,
    metadata: evidenceManifest,
  });
  if (write.error) throw write.error;
}

if (candidates.length) {
  const write = await db.from("transactions").insert(candidates);
  if (write.error) throw write.error;
}

for (const observation of accountObservations) {
  const account = accountByLastFour.get(observation.lastFour);
  const update = await db.from("accounts").update({
    current_balance_cents: observation.currentBalanceCents,
    available_balance_cents: observation.availableBalanceCents,
    credit_limit_cents: observation.creditLimitCents,
    balance_as_of: CAPTURED_AT,
    updated_at: CAPTURED_AT,
  }).eq("id", account.id).eq("updated_at", account.updated_at).select("id").maybeSingle();
  if (update.error) throw update.error;
  assert(update.data, `Concurrent account update detected for ${account.slug}.`);

  const event = await db.from("verification_events").upsert({
    id: stableUuid(`verification:easyweb-visible-balance:${account.id}:${CAPTURED_AT}`),
    entity_type: "account_balance",
    entity_id: account.id,
    action: "balance_observed",
    reason: "TD EasyWeb displayed the current and available balances after the posted activity was observed.",
    old_values: {
      current_balance_cents: account.current_balance_cents,
      available_balance_cents: account.available_balance_cents,
      credit_limit_cents: account.credit_limit_cents,
      balance_as_of: account.balance_as_of,
    },
    new_values: {
      current_balance_cents: observation.currentBalanceCents,
      available_balance_cents: observation.availableBalanceCents,
      credit_limit_cents: observation.creditLimitCents,
      balance_as_of: CAPTURED_AT,
    },
    evidence: { document_id: documentResult.data?.id ?? documentId, source_document_sha256: evidenceHash },
    occurred_at: CAPTURED_AT,
  }, { onConflict: "id" });
  if (event.error) throw event.error;
}

const ids = candidates.map((row) => row.id);
const verified = ids.length
  ? await db.from("transactions").select("id,source_key").in("id", ids)
  : { data: [], error: null };
if (verified.error) throw verified.error;
assert((verified.data ?? []).length === ids.length, "Not all inserted transactions were verified.");

console.log(JSON.stringify({
  status: "verified",
  document_id: documentResult.data?.id ?? documentId,
  transactions_inserted: candidates.length,
  transactions_verified: verified.data?.length ?? 0,
  account_balances_updated: accountObservations.length,
  pending_rows_excluded: pendingExcluded.length,
}, null, 2));
