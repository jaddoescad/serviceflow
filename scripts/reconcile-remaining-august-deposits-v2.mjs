#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CAPTURED_AT = "2026-08-06T22:15:00.000Z";
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

const deposits = [
  {
    key: "shezara-ali-aaq",
    postedOn: "2026-08-05",
    descriptionIncludes: "***AAq",
    amountCents: 61_615,
    sender: "shezara ali",
    preferredInvoiceNumber: "492286",
    nameHints: ["Shezara Ali"],
    evidence: {
      status: "Autodeposited",
      date_deposited: "2026-08-05",
      sender: "shezara ali",
      amount_cents: 61_615,
      deposited_to: "TD EVERY DAY A BUSINESS PLAN - 5276970",
      message: "balance paid for painting job",
      confirmation_masked: "C1AsSu***AAq",
      recipient: "Scott info@paintersottawa.com",
      method: "Email and Mobile",
    },
  },
  {
    key: "darya-rafi-pour-gar",
    postedOn: "2026-08-04",
    descriptionIncludes: "***GAR",
    amountCents: 144_471,
    sender: "DARYA RAFI POUR",
    preferredInvoiceNumber: null,
    nameHints: ["Darya Rafi Pour"],
    evidence: {
      status: "Autodeposited",
      date_deposited: "2026-08-04",
      sender: "DARYA RAFI POUR",
      amount_cents: 144_471,
      deposited_to: "TD EVERY DAY A BUSINESS PLAN - 5276970",
      confirmation_masked: "C1ApYu***GAR",
      recipient: "Ottawa Painters info@paintersottawa.com",
      method: "Email",
    },
  },
  {
    key: "thomas-benton-6ds",
    postedOn: "2026-08-04",
    descriptionIncludes: "***6Ds",
    amountCents: 100_000,
    sender: "THOMAS H BENTON",
    preferredInvoiceNumber: "487895",
    nameHints: ["Thomas Benton", "Tom Benton"],
    evidence: {
      status: "Autodeposited",
      date_deposited: "2026-08-03",
      sender: "THOMAS H BENTON",
      amount_cents: 100_000,
      deposited_to: "TD EVERY DAY A BUSINESS PLAN - 5276970",
      confirmation_masked: "C1Aqvh***6Ds",
      recipient: "Ottawa Painters info@paintersottawa.com",
      method: "Email",
      bank_posted_on: "2026-08-04",
    },
  },
];

const [transactionResult, invoiceResult] = await Promise.all([
  db
    .from("transactions")
    .select("id,posted_on,description,amount_cents,counterparty,review_status,notes,metadata,updated_at")
    .gte("posted_on", "2026-08-04")
    .lte("posted_on", "2026-08-05"),
  db
    .from("invoices")
    .select("id,invoice_number,status,total_cents,paid_cents,balance_cents,contact:contacts(name),job_allocations:invoice_job_allocations(job:jobs(id,name,status)),metadata,updated_at")
    .eq("category", "customer")
    .eq("direction", "receivable"),
]);
if (transactionResult.error) throw transactionResult.error;
if (invoiceResult.error) throw invoiceResult.error;

for (const deposit of deposits) {
  const matches = (transactionResult.data ?? []).filter(
    (row) =>
      row.posted_on === deposit.postedOn &&
      Number(row.amount_cents) === deposit.amountCents &&
      row.description.includes(deposit.descriptionIncludes),
  );
  if (matches.length !== 1) {
    throw new Error(`${deposit.key}: expected one transaction, found ${matches.length}.`);
  }
  deposit.transaction = matches[0];
  deposit.exactBalanceCandidates = (invoiceResult.data ?? []).filter(
    (invoice) => Number(invoice.balance_cents) === deposit.amountCents,
  );
  deposit.nameCandidates = (invoiceResult.data ?? []).filter((invoice) => {
    const searchable = [
      invoice.contact?.name,
      ...(invoice.job_allocations ?? []).map((allocation) => allocation.job?.name),
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase("en-CA");
    return deposit.nameHints.some((hint) =>
      searchable.includes(hint.toLocaleLowerCase("en-CA")),
    );
  });
  deposit.preferredCandidate = deposit.preferredInvoiceNumber
    ? (invoiceResult.data ?? []).find(
        (invoice) => invoice.invoice_number === deposit.preferredInvoiceNumber,
      )
    : deposit.nameCandidates.length === 1
      ? deposit.nameCandidates[0]
      : null;
}

const selectedInvoiceIds = deposits
  .map((deposit) => deposit.preferredCandidate?.id)
  .filter(Boolean);
const selectedAllocationResult = selectedInvoiceIds.length
  ? await db
      .from("transaction_allocations")
      .select("id,transaction_id,invoice_id,source_system,external_id,allocation_type,amount_cents,allocation_method,metadata,reversed_at")
      .in("invoice_id", selectedInvoiceIds)
      .is("reversed_at", null)
  : { data: [], error: null };
if (selectedAllocationResult.error) throw selectedAllocationResult.error;
for (const deposit of deposits) {
  deposit.invoiceAllocations = (selectedAllocationResult.data ?? []).filter(
    (allocation) => allocation.invoice_id === deposit.preferredCandidate?.id,
  );
}

const preview = {
  mode: APPLY ? "apply" : "dry-run",
  deposits: deposits.map((deposit) => ({
    key: deposit.key,
    sender: deposit.sender,
    transaction: deposit.transaction,
    exactBalanceCandidates: deposit.exactBalanceCandidates.map((invoice) => ({
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      status: invoice.status,
      total_cents: invoice.total_cents,
      paid_cents: invoice.paid_cents,
      balance_cents: invoice.balance_cents,
      contact: invoice.contact,
      jobs: invoice.job_allocations?.map((allocation) => allocation.job),
    })),
    nameCandidates: deposit.nameCandidates.map((invoice) => ({
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      status: invoice.status,
      total_cents: invoice.total_cents,
      paid_cents: invoice.paid_cents,
      balance_cents: invoice.balance_cents,
      contact: invoice.contact,
      jobs: invoice.job_allocations?.map((allocation) => allocation.job),
    })),
    selectedInvoiceNumber: deposit.preferredCandidate?.invoice_number ?? null,
    selectedInvoiceAllocations: deposit.invoiceAllocations,
  })),
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) process.exit(0);

const evidencePayload = JSON.stringify(
  deposits.map((deposit) => ({ key: deposit.key, ...deposit.evidence })),
);
const evidenceHash = sha256(evidencePayload);
const evidenceDocument = {
  id: stableUuid(`document:td-easyweb-payment-details:${evidenceHash}`),
  kind: "bank_payment_detail_observation",
  original_filename: "TD EasyWeb remaining Interac payment details observed 2026-08-06.json",
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
const documentWrite = await db
  .from("documents")
  .upsert(evidenceDocument, { onConflict: "id" })
  .select("id")
  .single();
if (documentWrite.error) throw documentWrite.error;

for (const deposit of deposits) {
  const invoice = deposit.preferredCandidate;
  if (!invoice) {
    const unmatchedTransactionWrite = await db
      .from("transactions")
      .update({
        counterparty: deposit.sender,
        notes: "Sender verified in EasyWeb; matching customer invoice/job is not present in the current database and still requires DripJobs evidence.",
        metadata: {
          ...(deposit.transaction.metadata ?? {}),
          bank_sender_evidence: {
            method: "easyweb_interac_detail",
            evidence: deposit.evidence,
            invoice_match_status: "not_found_in_current_database",
          },
        },
        updated_at: CAPTURED_AT,
      })
      .eq("id", deposit.transaction.id)
      .eq("updated_at", deposit.transaction.updated_at)
      .select("id")
      .maybeSingle();
    if (unmatchedTransactionWrite.error) throw unmatchedTransactionWrite.error;
    if (!unmatchedTransactionWrite.data) {
      throw new Error(`${deposit.key}: concurrent transaction update.`);
    }
    const unmatchedLinkWrite = await db.from("evidence_links").upsert(
      {
        id: stableUuid(
          `evidence-link:${evidenceDocument.id}:transaction:${deposit.transaction.id}`,
        ),
        document_id: evidenceDocument.id,
        entity_type: "transaction",
        entity_id: deposit.transaction.id,
        evidence_role: "bank_sender_detail",
        metadata: { reconciliation_key: deposit.key },
        created_at: CAPTURED_AT,
      },
      { onConflict: "id" },
    );
    if (unmatchedLinkWrite.error) throw unmatchedLinkWrite.error;
    const unmatchedEventWrite = await db.from("verification_events").upsert(
      {
        id: stableUuid(`verification:sender:${deposit.key}`),
        entity_type: "transaction",
        entity_id: deposit.transaction.id,
        action: "sender_verified_invoice_pending",
        reason: "Interac sender was verified, but no matching current invoice/job record was found.",
        old_values: {
          counterparty: deposit.transaction.counterparty,
          review_status: deposit.transaction.review_status,
        },
        new_values: {
          counterparty: deposit.sender,
          review_status: "needs_review",
          invoice_match_status: "not_found_in_current_database",
        },
        evidence: deposit.evidence,
        occurred_at: CAPTURED_AT,
      },
      { onConflict: "id" },
    );
    if (unmatchedEventWrite.error) throw unmatchedEventWrite.error;
    continue;
  }
  const existingAllocation = await db
    .from("transaction_allocations")
    .select("id,transaction_id,invoice_id,amount_cents,reversed_at")
    .eq("transaction_id", deposit.transaction.id)
    .is("reversed_at", null)
    .maybeSingle();
  if (existingAllocation.error) throw existingAllocation.error;
  if (
    existingAllocation.data &&
    (existingAllocation.data.invoice_id !== invoice.id ||
      Number(existingAllocation.data.amount_cents) !== deposit.amountCents)
  ) {
    throw new Error(`${deposit.key}: transaction has a conflicting active allocation.`);
  }
  const alreadyAllocated = Boolean(existingAllocation.data);
  const allocationId =
    existingAllocation.data?.id ?? stableUuid(`transaction-allocation:${deposit.key}`);
  const allocationWrite = await db.from("transaction_allocations").upsert(
    {
      id: allocationId,
      transaction_id: deposit.transaction.id,
      invoice_id: invoice.id,
      source_system: "bank_reconciliation",
      external_id: deposit.key,
      allocation_type: "customer_payment",
      amount_cents: deposit.amountCents,
      allocation_method: "exact_sender_amount_and_open_invoice_balance",
      confidence: 1,
      needs_review: false,
      metadata: {
        evidence: deposit.evidence,
        reconciled_on: "2026-08-06",
        no_email_used: true,
      },
      created_at: CAPTURED_AT,
      updated_at: CAPTURED_AT,
    },
    { onConflict: "id" },
  );
  if (allocationWrite.error) throw allocationWrite.error;

  const transactionWrite = await db
    .from("transactions")
    .update({
      counterparty: deposit.sender,
      review_status: "reconciled",
      notes: `Verified exact customer payment to invoice ${invoice.invoice_number}.`,
      metadata: {
        ...(deposit.transaction.metadata ?? {}),
        bank_reconciliation: {
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number,
          allocation_id: allocationId,
          method: "exact_sender_amount_and_open_invoice_balance",
          evidence: deposit.evidence,
        },
      },
      updated_at: CAPTURED_AT,
    })
    .eq("id", deposit.transaction.id)
    .eq("updated_at", deposit.transaction.updated_at)
    .select("id")
    .maybeSingle();
  if (transactionWrite.error) throw transactionWrite.error;
  if (!transactionWrite.data) throw new Error(`${deposit.key}: concurrent transaction update.`);

  const newPaidCents = alreadyAllocated
    ? Number(invoice.paid_cents)
    : Number(invoice.paid_cents) + deposit.amountCents;
  const newBalanceCents = alreadyAllocated
    ? Number(invoice.balance_cents)
    : Number(invoice.balance_cents) - deposit.amountCents;
  if (newPaidCents + newBalanceCents !== Number(invoice.total_cents)) {
    throw new Error(`${deposit.key}: payment would violate the invoice total.`);
  }
  const invoiceWrite = await db
    .from("invoices")
    .update({
      status: newBalanceCents === 0 ? "paid" : "Partially Paid",
      paid_cents: newPaidCents,
      balance_cents: newBalanceCents,
      metadata: {
        ...(invoice.metadata ?? {}),
        settlement: {
          transaction_id: deposit.transaction.id,
          allocation_id: allocationId,
          settled_on: deposit.evidence.date_deposited,
          method: "exact_sender_amount_and_open_invoice_balance",
        },
      },
      updated_at: CAPTURED_AT,
    })
    .eq("id", invoice.id)
    .eq("updated_at", invoice.updated_at)
    .select("id")
    .maybeSingle();
  if (invoiceWrite.error) throw invoiceWrite.error;
  if (!invoiceWrite.data) throw new Error(`${deposit.key}: concurrent invoice update.`);

  for (const entity of [
    { type: "transaction", id: deposit.transaction.id },
    { type: "invoice", id: invoice.id },
  ]) {
    const linkWrite = await db.from("evidence_links").upsert(
      {
        id: stableUuid(`evidence-link:${evidenceDocument.id}:${entity.type}:${entity.id}`),
        document_id: evidenceDocument.id,
        entity_type: entity.type,
        entity_id: entity.id,
        evidence_role: "bank_payment_detail",
        metadata: { reconciliation_key: deposit.key },
        created_at: CAPTURED_AT,
      },
      { onConflict: "id" },
    );
    if (linkWrite.error) throw linkWrite.error;
  }

  const eventWrite = await db.from("verification_events").upsert(
    {
      id: stableUuid(`verification:${deposit.key}`),
      entity_type: "transaction_allocation",
      entity_id: allocationId,
      action: "exact_payment_reconciled",
      reason: `Exact posted transaction matched invoice ${invoice.invoice_number}.`,
      old_values: {
        transaction_review_status: deposit.transaction.review_status,
        invoice_status: invoice.status,
        invoice_paid_cents: invoice.paid_cents,
        invoice_balance_cents: invoice.balance_cents,
      },
      new_values: {
        transaction_review_status: "reconciled",
        invoice_status: newBalanceCents === 0 ? "paid" : "Partially Paid",
        invoice_paid_cents: newPaidCents,
        invoice_balance_cents: newBalanceCents,
        allocation_amount_cents: deposit.amountCents,
      },
      evidence: deposit.evidence,
      occurred_at: CAPTURED_AT,
    },
    { onConflict: "id" },
  );
  if (eventWrite.error) throw eventWrite.error;
}

const verification = await db
  .from("transactions")
  .select("id,review_status,allocations:transaction_allocations(id,invoice_id,amount_cents,allocation_type,needs_review,invoice:invoices!transaction_allocations_invoice_id_fkey(invoice_number,status,paid_cents,balance_cents))")
  .in("id", deposits.map((deposit) => deposit.transaction.id));
if (verification.error) throw verification.error;
console.log(JSON.stringify({ status: "verified", rows: verification.data }, null, 2));
