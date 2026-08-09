#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CAPTURED_AT = "2026-08-06T21:30:00.000Z";
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
    ) {
      value = value.slice(1, -1);
    }
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

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) {
  throw new Error("Refusing reconciliation for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const expected = [
  {
    key: "paul-toonders-xdj",
    postedOn: "2026-07-31",
    amountCents: 211_310,
    descriptionIncludes: "***xDJ",
    invoiceNumber: "436241",
    allocationType: "customer_payment",
    counterparty: "Paul Toonders",
    evidence: {
      status: "Autodeposited",
      date_deposited: "2026-07-31",
      sender: "PAUL TOONDERS",
      amount_cents: 211_310,
      deposited_to: "TD EVERY DAY A BUSINESS PLAN - 5276970",
      confirmation_masked: "C1AecP****xDJ",
      recipient: "Ottawa Painters",
    },
    method: "exact_sender_amount_and_open_invoice_balance",
  },
  {
    key: "amal-malik-vmn",
    postedOn: "2026-08-05",
    amountCents: 28_815,
    descriptionIncludes: "***VMN",
    invoiceNumber: "477186",
    allocationType: "customer_payment",
    counterparty: "Amal Malik",
    evidence: {
      status: "Autodeposited",
      date_deposited: "2026-08-05",
      sender: "Amal Malik",
      amount_cents: 28_815,
      deposited_to: "TD EVERY DAY A BUSINESS PLAN - 5276970",
      message: "186 Lamprey St.",
      confirmation_masked: "C1Aefn***VMN",
      purpose: "EPAY - E-Payment",
      recipient: "Ottawa Painters info@paintersottawa.com",
      method: "Email",
    },
    method: "exact_sender_amount_and_open_invoice_balance",
  },
  {
    key: "home-depot-7026-aug-1",
    postedOn: "2026-08-01",
    amountCents: -7_114,
    descriptionIncludes: "HOME DEPOT #7026",
    invoiceNumber: "7026-00009-98971",
    allocationType: "material_payment",
    counterparty: "Home Depot",
    evidence: {
      supplier: "Home Depot",
      posted_on: "2026-08-01",
      charged_cents: 7_114,
      invoice_number: "7026-00009-98971",
      invoice_total_cents: 7_114,
      purchase_order: "BARRY",
      source_system: "gmail_home_depot_receipt",
    },
    method: "exact_supplier_amount_date_and_archived_invoice",
  },
];

const [transactionResult, invoiceResult] = await Promise.all([
  db
    .from("transactions")
    .select("id,account_id,posted_on,description,amount_cents,counterparty,review_status,notes,metadata,updated_at")
    .gte("posted_on", "2026-07-31")
    .lte("posted_on", "2026-08-05"),
  db
    .from("invoices")
    .select("id,invoice_number,direction,category,status,total_cents,paid_cents,balance_cents,metadata,updated_at")
    .in("invoice_number", expected.map((item) => item.invoiceNumber)),
]);
if (transactionResult.error) throw transactionResult.error;
if (invoiceResult.error) throw invoiceResult.error;

for (const item of expected) {
  const transactions = (transactionResult.data ?? []).filter(
    (row) =>
      row.posted_on === item.postedOn &&
      Number(row.amount_cents) === item.amountCents &&
      row.description.includes(item.descriptionIncludes),
  );
  if (transactions.length !== 1) {
    throw new Error(`${item.key}: expected one transaction, found ${transactions.length}.`);
  }
  const invoices = (invoiceResult.data ?? []).filter(
    (row) => row.invoice_number === item.invoiceNumber,
  );
  if (invoices.length !== 1) {
    throw new Error(`${item.key}: expected one invoice, found ${invoices.length}.`);
  }
  item.transaction = transactions[0];
  item.invoice = invoices[0];
  item.alreadySettled =
    Number(item.invoice.balance_cents) === 0 &&
    Number(item.invoice.paid_cents) === Number(item.invoice.total_cents);
  if (
    !item.alreadySettled &&
    Math.abs(item.amountCents) !== Number(item.invoice.balance_cents)
  ) {
    throw new Error(
      `${item.key}: transaction ${Math.abs(item.amountCents)} does not equal open invoice balance ${item.invoice.balance_cents}.`,
    );
  }
}

const ids = expected.flatMap((item) => [item.transaction.id, item.invoice.id]);
const [allocationResult, jobAllocationResult] = await Promise.all([
  db
    .from("transaction_allocations")
    .select("*")
    .or(
      `transaction_id.in.(${expected.map((item) => item.transaction.id).join(",")}),invoice_id.in.(${expected.map((item) => item.invoice.id).join(",")})`,
    )
    .is("reversed_at", null),
  db
    .from("invoice_job_allocations")
    .select("id,invoice_id,invoice_line_id,job_id,subtotal_cents,tax_cents,total_cents,allocation_method,confidence,needs_review,metadata,job:jobs(id,name,status)")
    .in("invoice_id", expected.map((item) => item.invoice.id)),
]);
if (allocationResult.error) throw allocationResult.error;
if (jobAllocationResult.error) throw jobAllocationResult.error;

for (const item of expected) {
  item.activeAllocations = (allocationResult.data ?? []).filter(
    (row) => row.transaction_id === item.transaction.id || row.invoice_id === item.invoice.id,
  );
  item.invoiceJobAllocations = (jobAllocationResult.data ?? []).filter(
    (row) => row.invoice_id === item.invoice.id,
  );
  item.reusableAllocation = item.activeAllocations.find(
    (row) =>
      row.invoice_id === item.invoice.id &&
      row.transaction_id == null &&
      Number(row.amount_cents) === Math.abs(item.amountCents) &&
      row.allocation_type === "customer_payment_event",
  );
  const conflictingTransactionAllocation = item.activeAllocations.find(
    (row) =>
      row.transaction_id === item.transaction.id &&
      !(
        row.invoice_id === item.invoice.id &&
        Number(row.amount_cents) === Math.abs(item.amountCents)
      ),
  );
  if (conflictingTransactionAllocation) {
    throw new Error(`${item.key}: transaction already has a conflicting allocation.`);
  }
}

const evidencePayload = JSON.stringify(
  expected.slice(0, 2).map((item) => ({ key: item.key, ...item.evidence })),
);
const evidenceHash = sha256(evidencePayload);
const evidenceDocument = {
  id: stableUuid(`document:td-easyweb-payment-details:${evidenceHash}`),
  kind: "bank_payment_detail_observation",
  original_filename: "TD EasyWeb Interac payment details observed 2026-08-06.json",
  mime_type: "application/json",
  size_bytes: Buffer.byteLength(evidencePayload),
  content_sha256: evidenceHash,
  source_url: "https://easyweb.td.com/waw/webui/emt/#/",
  captured_at: CAPTURED_AT,
  metadata: {
    source: "TD EasyWeb visible Interac e-Transfer detail pages",
    no_email_used: true,
    observations: JSON.parse(evidencePayload),
  },
};

const preview = {
  mode: APPLY ? "apply" : "dry-run",
  evidenceDocument: {
    id: evidenceDocument.id,
    filename: evidenceDocument.original_filename,
    sha256: evidenceDocument.content_sha256,
  },
  reconciliations: expected.map((item) => ({
    key: item.key,
    transaction: {
      id: item.transaction.id,
      posted_on: item.transaction.posted_on,
      description: item.transaction.description,
      amount_cents: item.transaction.amount_cents,
      review_status: item.transaction.review_status,
    },
    invoice: {
      id: item.invoice.id,
      invoice_number: item.invoice.invoice_number,
      category: item.invoice.category,
      status: item.invoice.status,
      total_cents: item.invoice.total_cents,
      paid_cents: item.invoice.paid_cents,
      balance_cents: item.invoice.balance_cents,
    },
    activeAllocations: item.activeAllocations.map((row) => ({
      id: row.id,
      transaction_id: row.transaction_id,
      invoice_id: row.invoice_id,
      allocation_type: row.allocation_type,
      amount_cents: row.amount_cents,
      source_system: row.source_system,
      external_id: row.external_id,
    })),
    reusableAllocationId: item.reusableAllocation?.id ?? null,
    alreadySettled: item.alreadySettled,
    invoiceJobAllocations: item.invoiceJobAllocations,
  })),
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) process.exit(0);

const documentResult = await db
  .from("documents")
  .upsert(evidenceDocument, { onConflict: "id" })
  .select("id")
  .single();
if (documentResult.error) throw documentResult.error;

for (const item of expected) {
  const allocationId =
    item.reusableAllocation?.id ?? stableUuid(`transaction-allocation:${item.key}`);
  const allocation = {
    id: allocationId,
    transaction_id: item.transaction.id,
    invoice_id: item.invoice.id,
    source_system: "bank_reconciliation",
    external_id: item.key,
    allocation_type: item.allocationType,
    amount_cents: Math.abs(item.amountCents),
    allocation_method: item.method,
    confidence: 1,
    needs_review: false,
    metadata: {
      ...(item.reusableAllocation?.metadata ?? {}),
      evidence: item.evidence,
      reconciled_on: "2026-08-06",
      no_email_used: true,
    },
    updated_at: CAPTURED_AT,
  };
  if (!item.reusableAllocation) allocation.created_at = CAPTURED_AT;
  const allocationWrite = await db
    .from("transaction_allocations")
    .upsert(allocation, { onConflict: "id" })
    .select("id")
    .single();
  if (allocationWrite.error) throw allocationWrite.error;

  const transactionWrite = await db
    .from("transactions")
    .update({
      counterparty: item.counterparty,
      review_status: "reconciled",
      notes: `Verified exact ${item.allocationType.replaceAll("_", " ")} to invoice ${item.invoiceNumber}.`,
      metadata: {
        ...(item.transaction.metadata ?? {}),
        bank_reconciliation: {
          invoice_id: item.invoice.id,
          invoice_number: item.invoiceNumber,
          allocation_id: allocationId,
          method: item.method,
          evidence: item.evidence,
        },
      },
      updated_at: CAPTURED_AT,
    })
    .eq("id", item.transaction.id)
    .eq("updated_at", item.transaction.updated_at)
    .select("id")
    .maybeSingle();
  if (transactionWrite.error) throw transactionWrite.error;
  if (!transactionWrite.data) throw new Error(`${item.key}: concurrent transaction update.`);

  const newPaidCents = item.alreadySettled
    ? Number(item.invoice.total_cents)
    : Number(item.invoice.paid_cents) + Number(item.invoice.balance_cents);
  if (newPaidCents !== Number(item.invoice.total_cents)) {
    throw new Error(`${item.key}: settling balance would not equal invoice total.`);
  }
  const invoiceWrite = await db
    .from("invoices")
    .update({
      status: "paid",
      paid_cents: newPaidCents,
      balance_cents: 0,
      metadata: {
        ...(item.invoice.metadata ?? {}),
        settlement: {
          transaction_id: item.transaction.id,
          allocation_id: allocationId,
          settled_on: item.postedOn,
          method: item.method,
        },
      },
      updated_at: CAPTURED_AT,
    })
    .eq("id", item.invoice.id)
    .eq("updated_at", item.invoice.updated_at)
    .select("id")
    .maybeSingle();
  if (invoiceWrite.error) throw invoiceWrite.error;
  if (!invoiceWrite.data) throw new Error(`${item.key}: concurrent invoice update.`);

  if (item.allocationType === "customer_payment") {
    for (const entity of [
      { type: "transaction", id: item.transaction.id },
      { type: "invoice", id: item.invoice.id },
    ]) {
      const evidenceLink = await db.from("evidence_links").upsert(
        {
          id: stableUuid(`evidence-link:${evidenceDocument.id}:${entity.type}:${entity.id}`),
          document_id: evidenceDocument.id,
          entity_type: entity.type,
          entity_id: entity.id,
          evidence_role: "bank_payment_detail",
          metadata: { reconciliation_key: item.key },
          created_at: CAPTURED_AT,
        },
        { onConflict: "id" },
      );
      if (evidenceLink.error) throw evidenceLink.error;
    }
  }

  const eventWrite = await db.from("verification_events").upsert(
    {
      id: stableUuid(`verification:${item.key}`),
      entity_type: "transaction_allocation",
      entity_id: allocationId,
      action: "exact_payment_reconciled",
      reason: `Exact posted transaction matched invoice ${item.invoiceNumber}.`,
      old_values: {
        transaction_review_status: item.transaction.review_status,
        invoice_status: item.invoice.status,
        invoice_paid_cents: item.invoice.paid_cents,
        invoice_balance_cents: item.invoice.balance_cents,
      },
      new_values: {
        transaction_review_status: "reconciled",
        invoice_status: "paid",
        invoice_paid_cents: newPaidCents,
        invoice_balance_cents: 0,
        allocation_type: item.allocationType,
        allocation_amount_cents: Math.abs(item.amountCents),
      },
      evidence: item.evidence,
      occurred_at: CAPTURED_AT,
    },
    { onConflict: "id" },
  );
  if (eventWrite.error) throw eventWrite.error;
}

const verification = await db
  .from("transactions")
  .select("id,review_status,allocations:transaction_allocations(id,invoice_id,amount_cents,allocation_type,needs_review,invoice:invoices!transaction_allocations_invoice_id_fkey(id,invoice_number,status,paid_cents,balance_cents))")
  .in("id", expected.map((item) => item.transaction.id));
if (verification.error) throw verification.error;
console.log(JSON.stringify({ status: "verified", rows: verification.data }, null, 2));
