#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const SOURCE_ARGUMENT = process.argv.find((argument) =>
  argument.startsWith("--source="),
);
const SOURCE_PATH = SOURCE_ARGUMENT
  ? SOURCE_ARGUMENT.slice("--source=".length)
  : "/Users/jadslim/Downloads/quote_947.pdf";
const TRANSACTION_ID = "9aee7d96-2473-4a4d-bc7e-6871e40b0524";
const STORAGE_BUCKET = "customer-invoices";
const STORAGE_PATH =
  "customer-revenue-evidence/jobber/2025/quote-947-joseph-veryard.pdf";
const EXPECTED_SHA256 =
  "cb5f5b04731f13c40679c087275b43d1021b3ab2a5d1db1989f032dedf679c01";
const BANK_PAYMENT = 881.6;
const QUOTE_TOTAL = 1101.75;
const REQUIRED_DEPOSIT = 220.4;
const QUOTED_BALANCE = 881.35;
const VARIANCE = 0.25;

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    values[line.slice(0, separator).trim()] = line
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoError(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

function objectValue(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing Supabase credentials.");
assert(
  new URL(supabaseUrl).hostname.split(".")[0] === TARGET_PROJECT_REF,
  "Refusing reconciliation for an unexpected Supabase project.",
);
assert(existsSync(SOURCE_PATH), `Quote source not found: ${SOURCE_PATH}`);

const sourceBuffer = readFileSync(SOURCE_PATH);
const sourceSha256 = sha256(sourceBuffer);
assert(sourceSha256 === EXPECTED_SHA256, "Quote #947 source hash changed.");

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const transaction = assertNoError(
  "Joseph Veryard bank transaction",
  await db
    .from("financial_transactions")
    .select(
      "id,posted_on,description,counterparty,amount,currency,transaction_type,category,is_transfer,review_status,notes,source_data",
    )
    .eq("id", TRANSACTION_ID)
    .single(),
);
assert(transaction.posted_on === "2025-06-05", "Bank date changed.");
assert(transaction.description === "E-TRANSFER ***pNg", "Bank row changed.");
assert(Number(transaction.amount) === BANK_PAYMENT, "Bank amount changed.");
assert(transaction.currency === "CAD", "Bank currency changed.");
assert(transaction.transaction_type === "income", "Bank row is not income.");
assert(transaction.category === "Painting revenue", "Bank category changed.");
assert(!transaction.is_transfer, "Bank row is marked as a transfer.");

const sourceData = objectValue(transaction.source_data);
const identity = objectValue(sourceData.customer_revenue_identity);
assert(identity.status === "confirmed", "Interac identity is not confirmed.");
assert(
  identity.reference === "C1A8J4dvApNg" &&
    identity.bank_reference_suffix === "pNg",
  "Interac reference changed.",
);
assert(identity.sender_name === "JOSEPH A. VERYARD", "Interac sender changed.");

const storageDirectory = path.posix.dirname(STORAGE_PATH);
const storageFilename = path.posix.basename(STORAGE_PATH);
const storageList = assertNoError(
  "stored quote lookup",
  await db.storage.from(STORAGE_BUCKET).list(storageDirectory, {
    search: storageFilename,
    limit: 10,
  }),
);
const storageObject = storageList.find(
  (candidate) => candidate.name === storageFilename,
);

if (storageObject) {
  const existingDownload = await db.storage
    .from(STORAGE_BUCKET)
    .download(STORAGE_PATH);
  if (existingDownload.error) {
    throw new Error(`stored quote download: ${existingDownload.error.message}`);
  }
  const existingBuffer = Buffer.from(await existingDownload.data.arrayBuffer());
  assert(
    sha256(existingBuffer) === EXPECTED_SHA256,
    "Stored quote #947 hash does not match the source.",
  );
}

const currentException = objectValue(sourceData.customer_revenue_exception);
const alreadyApplied =
  storageObject != null &&
  transaction.review_status === "reconciled" &&
  currentException.status === "confirmed" &&
  currentException.kind === "legacy_invoice_not_imported" &&
  currentException.review === false &&
  currentException.quote_number === "947" &&
  currentException.content_sha256 === EXPECTED_SHA256;

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      transaction: {
        id: transaction.id,
        posted_on: transaction.posted_on,
        counterparty: transaction.counterparty,
        amount: Number(transaction.amount),
        interac_reference: identity.reference,
      },
      quote: {
        number: "947",
        customer: "Joe Veryard",
        address: "160 Tartan Drive, Nepean, Ottawa, Ontario K2J 3X2",
        subtotal: 975,
        hst: 126.75,
        total: QUOTE_TOTAL,
        required_deposit: REQUIRED_DEPOSIT,
        quoted_balance: QUOTED_BALANCE,
        bank_payment: BANK_PAYMENT,
        variance: VARIANCE,
        sha256: EXPECTED_SHA256,
        storage_bucket: STORAGE_BUCKET,
        storage_path: STORAGE_PATH,
      },
      action:
        "archive the owner-confirmed Jobber quote and settle the bank row as a documented customer-identified, final-invoice-missing exception",
      storage_already_archived: storageObject != null,
      already_applied: alreadyApplied,
    },
    null,
    2,
  ),
);

if (!APPLY || alreadyApplied) process.exit(0);

if (!storageObject) {
  assertNoError(
    "quote upload",
    await db.storage.from(STORAGE_BUCKET).upload(STORAGE_PATH, sourceBuffer, {
      contentType: "application/pdf",
      upsert: false,
      cacheControl: "3600",
    }),
  );
}

const now = new Date().toISOString();
const resolution =
  "Ottawa Painters confirmed the $881.60 Joseph A. Veryard transfer belongs to Jobber quote #947 for 160 Tartan Drive. The archived quote totals $1,101.75 and states a $220.40 deposit, leaving an $881.35 quoted balance; the payment is $0.25 higher. No final invoice is archived, so this remains an explicit invoice-missing exception rather than a fabricated invoice match.";

assertNoError(
  "Joseph Veryard evidence update",
  await db
    .from("financial_transactions")
    .update({
      counterparty: "Joseph A. Veryard",
      review_status: "reconciled",
      notes:
        "Owner-confirmed Jobber quote #947 archived for Joseph Veryard at 160 Tartan Drive; no final invoice is archived.",
      source_data: {
        ...sourceData,
        customer_revenue_exception: {
          kind: "legacy_invoice_not_imported",
          status: "confirmed",
          review: false,
          resolution,
          quote_number: "947",
          quote_customer: "Joe Veryard",
          quote_address: "160 Tartan Drive, Nepean, Ottawa, Ontario K2J 3X2",
          quote_subtotal: 975,
          quote_hst: 126.75,
          quote_total: QUOTE_TOTAL,
          required_deposit: REQUIRED_DEPOSIT,
          quoted_balance: QUOTED_BALANCE,
          bank_payment: BANK_PAYMENT,
          variance: VARIANCE,
          storage_bucket: STORAGE_BUCKET,
          storage_path: STORAGE_PATH,
          original_filename: path.basename(SOURCE_PATH),
          content_sha256: EXPECTED_SHA256,
          file_size: sourceBuffer.length,
          owner_confirmed_on: "2026-08-02",
          confirmed_at: now,
        },
        customer_revenue_settlement: {
          ...objectValue(sourceData.customer_revenue_settlement),
          status: "unmatched",
          allocated_amount: 0,
          unallocated_amount: BANK_PAYMENT,
          exception_status: "confirmed",
          rule: "customer_invoice_bank_allocations_are_settlement_truth",
          updated_at: now,
        },
      },
    })
    .eq("id", TRANSACTION_ID),
);

const verified = assertNoError(
  "Joseph Veryard verification",
  await db
    .from("financial_transactions")
    .select("id,counterparty,amount,review_status,source_data")
    .eq("id", TRANSACTION_ID)
    .single(),
);
const verifiedException = objectValue(
  objectValue(verified.source_data).customer_revenue_exception,
);
assert(verified.review_status === "reconciled", "Bank row remains in review.");
assert(
  verifiedException.status === "confirmed" &&
    verifiedException.review === false &&
    verifiedException.quote_number === "947" &&
    verifiedException.content_sha256 === EXPECTED_SHA256,
  "Quote evidence did not persist.",
);

const remainingException = assertNoError(
  "remaining accounting exception",
  await db
    .from("accounting_reconciliation_exceptions")
    .select("exception_key")
    .eq("source_id", TRANSACTION_ID),
);
assert(
  remainingException.length === 0,
  "Joseph Veryard still appears in the accounting exception queue.",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      transaction_id: TRANSACTION_ID,
      bank_payment: BANK_PAYMENT,
      settlement_display: "Customer identified · invoice missing",
      quote_archived: `${STORAGE_BUCKET}/${STORAGE_PATH}`,
      removed_from_needs_review: true,
    },
    null,
    2,
  ),
);
