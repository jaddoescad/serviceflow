#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const CONTRACTOR_ID = "c5e12a25-2f40-4c05-af51-4f9f8401b573";
const PAYMENT_ID = "e755f2ce-e9cb-4a75-bbd5-47bde3fcf1a3";
const DEPOSIT_INVOICE_ID = "36a5d113-089a-4fca-b6af-12bcdcff3035";
const FINAL_INVOICE_ID = "288f3152-d9ab-4236-a6da-68f6b38e96b2";
const PAYMENT_AMOUNT = 990;
const FINAL_INVOICE_AMOUNT = 3300;
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();
const NOTE =
  "Sonya Lee deposit reconciliation: TD confirmation 19c671aeb79c6f9c " +
  "states “Sonya Lee (30%)” for $990.00 on 2026-02-16. Final Polaris " +
  "invoice #70 is $3,300.00 and explicitly records “$990 Received on Feb " +
  "16th.” Invoice #57 is retained as supporting deposit evidence; the bank " +
  "payment is allocated to final invoice #70, leaving $2,310.00 unpaid.";

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

function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function gross(invoice) {
  return (
    Number(invoice.amount_before_tax ?? 0) + Number(invoice.tax_amount ?? 0)
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function insertAuditEvent(db, event) {
  const existing = await db
    .from("labour_verification_events")
    .select("id")
    .eq("entity_type", event.entity_type)
    .eq("entity_id", event.entity_id)
    .eq("action", event.action)
    .eq("reason", event.reason)
    .limit(1);
  if (existing.error) throw existing.error;
  if ((existing.data ?? []).length) return;
  const insertion = await db.from("labour_verification_events").insert(event);
  if (insertion.error) throw insertion.error;
}

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
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
  throw new Error(`Refusing reconciliation for project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const [
  contractorResult,
  transactionResult,
  recordResult,
  invoicesResult,
  allocationsResult,
] = await Promise.all([
  db
    .from("labour_contractors")
    .select("id,supplier_name")
    .eq("id", CONTRACTOR_ID)
    .single(),
  db
    .from("financial_transactions")
    .select(
      "id,posted_on,description,counterparty,amount,currency,transaction_type,category,is_transfer,review_status,notes",
    )
    .eq("id", PAYMENT_ID)
    .single(),
  db
    .from("labour_payment_records")
    .select("financial_transaction_id,contractor_id,recipient_status")
    .eq("financial_transaction_id", PAYMENT_ID)
    .single(),
  db
    .from("labour_invoices")
    .select(
      "id,contractor_id,supplier_name,invoice_number,invoice_date,amount_before_tax,tax_amount,currency,document_type,match_status,supporting_invoice_reference,text_excerpt",
    )
    .in("id", [DEPOSIT_INVOICE_ID, FINAL_INVOICE_ID]),
  db
    .from("labour_payment_allocations")
    .select(
      "id,financial_transaction_id,invoice_id,allocated_amount,reversed_at",
    )
    .eq("financial_transaction_id", PAYMENT_ID),
]);
for (const [label, result] of Object.entries({
  contractor: contractorResult,
  transaction: transactionResult,
  record: recordResult,
  invoices: invoicesResult,
  allocations: allocationsResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

assert(
  contractorResult.data.supplier_name === "Polaris Painters",
  "Polaris contractor identity changed.",
);
const transaction = transactionResult.data;
assert(
  transaction.posted_on === "2026-02-17" &&
    transaction.description === "SEND E-TFR *5dk EPAY" &&
    transaction.counterparty === "Polaris Painters" &&
    cents(transaction.amount) === -cents(PAYMENT_AMOUNT) &&
    transaction.currency === "CAD" &&
    transaction.transaction_type === "expense" &&
    transaction.category === "Subcontractors" &&
    transaction.is_transfer === false,
  "The Sonya Lee deposit bank row changed.",
);
assert(
  recordResult.data.contractor_id === CONTRACTOR_ID &&
    recordResult.data.recipient_status === "confirmed",
  "The Sonya Lee payment lost its confirmed Polaris recipient.",
);

const invoiceById = new Map(
  invoicesResult.data.map((invoice) => [invoice.id, invoice]),
);
const depositInvoice = invoiceById.get(DEPOSIT_INVOICE_ID);
const finalInvoice = invoiceById.get(FINAL_INVOICE_ID);
assert(
  depositInvoice?.contractor_id === CONTRACTOR_ID &&
    depositInvoice.supplier_name === "Polaris Painters" &&
    depositInvoice.invoice_number === "57" &&
    depositInvoice.invoice_date === "2026-02-12" &&
    depositInvoice.document_type === "invoice" &&
    cents(gross(depositInvoice)) === cents(PAYMENT_AMOUNT),
  "Polaris deposit invoice #57 changed.",
);
assert(
  finalInvoice?.contractor_id === CONTRACTOR_ID &&
    finalInvoice.supplier_name === "Polaris Painters" &&
    finalInvoice.invoice_number === "70" &&
    finalInvoice.invoice_date === "2026-04-03" &&
    finalInvoice.document_type === "invoice" &&
    cents(gross(finalInvoice)) === cents(FINAL_INVOICE_AMOUNT) &&
    finalInvoice.text_excerpt?.includes("$990 Received on Feb 16th"),
  "Polaris final invoice #70 no longer contains the deposit evidence.",
);

const activeDepositAllocation = allocationsResult.data.find(
  (allocation) =>
    allocation.invoice_id === DEPOSIT_INVOICE_ID &&
    allocation.reversed_at == null,
);
const activeFinalAllocation = allocationsResult.data.find(
  (allocation) =>
    allocation.invoice_id === FINAL_INVOICE_ID &&
    allocation.reversed_at == null,
);
assert(
  allocationsResult.data
    .filter((allocation) => allocation.reversed_at == null)
    .every((allocation) =>
      [DEPOSIT_INVOICE_ID, FINAL_INVOICE_ID].includes(allocation.invoice_id),
    ),
  "The Sonya Lee payment has an unrelated active allocation.",
);
if (activeDepositAllocation) {
  assert(
    cents(activeDepositAllocation.allocated_amount) === cents(PAYMENT_AMOUNT),
    "The existing #57 allocation amount changed.",
  );
}
if (activeFinalAllocation) {
  assert(
    cents(activeFinalAllocation.allocated_amount) === cents(PAYMENT_AMOUNT),
    "The existing #70 allocation amount changed.",
  );
}

const desiredDepositInvoice = {
  match_status: "supporting_document",
  supporting_invoice_reference: FINAL_INVOICE_ID,
};
const invoiceUpdate =
  depositInvoice.match_status !== desiredDepositInvoice.match_status ||
  depositInvoice.supporting_invoice_reference !==
    desiredDepositInvoice.supporting_invoice_reference;
const transactionUpdate =
  transaction.review_status !== "reconciled" || transaction.notes !== NOTE;
console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      deposit_invoice_update: invoiceUpdate ? 1 : 0,
      incorrect_allocation_reversal: activeDepositAllocation ? 1 : 0,
      final_invoice_allocation_insert: activeFinalAllocation ? 0 : 1,
      transaction_update: transactionUpdate ? 1 : 0,
      final_invoice_amount: FINAL_INVOICE_AMOUNT,
      deposit_paid: PAYMENT_AMOUNT,
      final_balance: FINAL_INVOICE_AMOUNT - PAYMENT_AMOUNT,
    },
    null,
    2,
  ),
);
if (!APPLY) process.exit(0);

if (invoiceUpdate) {
  const update = await db
    .from("labour_invoices")
    .update(desiredDepositInvoice)
    .eq("id", DEPOSIT_INVOICE_ID);
  if (update.error) throw update.error;
  await insertAuditEvent(db, {
    entity_type: "invoice",
    entity_id: DEPOSIT_INVOICE_ID,
    action: "update",
    old_values: {
      match_status: depositInvoice.match_status,
      supporting_invoice_reference: depositInvoice.supporting_invoice_reference,
    },
    new_values: desiredDepositInvoice,
    reason:
      "Invoice #57 is the 30% Sonya Lee deposit document represented inside final invoice #70, not a second payable.",
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

if (transactionUpdate) {
  const update = await db
    .from("financial_transactions")
    .update({ review_status: "reconciled", notes: NOTE })
    .eq("id", PAYMENT_ID);
  if (update.error) throw update.error;
  await insertAuditEvent(db, {
    entity_type: "payment",
    entity_id: PAYMENT_ID,
    action: "update",
    old_values: {
      review_status: transaction.review_status,
      notes: transaction.notes,
    },
    new_values: { review_status: "reconciled", notes: NOTE },
    reason: NOTE,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

if (activeDepositAllocation) {
  const reversalReason =
    "Moved the Sonya Lee 30% deposit from supporting invoice #57 to final invoice #70, whose source text records the same $990 payment and date.";
  const reversal = await db
    .from("labour_payment_allocations")
    .update({
      reversed_at: NOW,
      reversed_by: ADMIN_USER_ID,
      reversal_reason: reversalReason,
    })
    .eq("id", activeDepositAllocation.id)
    .is("reversed_at", null);
  if (reversal.error) throw reversal.error;
  await insertAuditEvent(db, {
    entity_type: "invoice_payment",
    entity_id: activeDepositAllocation.id,
    action: "reverse",
    old_values: {
      invoice_id: DEPOSIT_INVOICE_ID,
      allocated_amount: PAYMENT_AMOUNT,
      reversed_at: null,
    },
    new_values: {
      reversed_at: NOW,
      reversed_by: ADMIN_USER_ID,
      reversal_reason: reversalReason,
    },
    reason: reversalReason,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

if (!activeFinalAllocation) {
  const insertion = await db.from("labour_payment_allocations").insert({
    financial_transaction_id: PAYMENT_ID,
    invoice_id: FINAL_INVOICE_ID,
    allocated_amount: PAYMENT_AMOUNT,
    match_method: [
      "verified_contractor_identity",
      "payment_memo_job_name",
      "deposit_percentage",
      "final_invoice_received_note",
      "td_payment_confirmation",
      "bank_record",
    ],
    invoice_source_message_id: "19d50bd59c915cc3",
    payment_confirmation_message_id: "19c671aeb79c6f9c",
    confirmed_by: ADMIN_USER_ID,
    confirmed_at: NOW,
    inserted_by: ADMIN_USER_ID,
    notes: NOTE,
  });
  if (insertion.error) throw insertion.error;
  await insertAuditEvent(db, {
    entity_type: "payment",
    entity_id: PAYMENT_ID,
    action: "insert",
    old_values: { invoice_id: DEPOSIT_INVOICE_ID },
    new_values: {
      invoice_id: FINAL_INVOICE_ID,
      allocated_amount: PAYMENT_AMOUNT,
    },
    reason: NOTE,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const [paymentVerification, finalVerification, supportVerification] =
  await Promise.all([
    db
      .from("labour_payment_verification")
      .select(
        "payment_amount,total_allocated_amount,unallocated_amount,payment_status",
      )
      .eq("financial_transaction_id", PAYMENT_ID)
      .single(),
    db
      .from("labour_invoice_verification")
      .select("invoice_amount,paid_amount,amount_remaining,payment_status")
      .eq("invoice_id", FINAL_INVOICE_ID)
      .single(),
    db
      .from("labour_invoices")
      .select("match_status,supporting_invoice_reference")
      .eq("id", DEPOSIT_INVOICE_ID)
      .single(),
  ]);
if (paymentVerification.error) throw paymentVerification.error;
if (finalVerification.error) throw finalVerification.error;
if (supportVerification.error) throw supportVerification.error;
assert(
  paymentVerification.data.payment_status === "fully_allocated" &&
    cents(paymentVerification.data.unallocated_amount) === 0 &&
    cents(paymentVerification.data.total_allocated_amount) ===
      cents(PAYMENT_AMOUNT),
  "Sonya Lee deposit payment verification failed.",
);
assert(
  finalVerification.data.payment_status === "partially_paid" &&
    cents(finalVerification.data.invoice_amount) ===
      cents(FINAL_INVOICE_AMOUNT) &&
    cents(finalVerification.data.paid_amount) === cents(PAYMENT_AMOUNT) &&
    cents(finalVerification.data.amount_remaining) ===
      cents(FINAL_INVOICE_AMOUNT - PAYMENT_AMOUNT),
  "Polaris final invoice #70 balance verification failed.",
);
assert(
  supportVerification.data.match_status === "supporting_document" &&
    supportVerification.data.supporting_invoice_reference === FINAL_INVOICE_ID,
  "Polaris invoice #57 was not retained as supporting evidence.",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      payment_fully_allocated: true,
      canonical_invoice: "70",
      deposit_document: "57",
      paid: PAYMENT_AMOUNT,
      remaining: FINAL_INVOICE_AMOUNT - PAYMENT_AMOUNT,
    },
    null,
    2,
  ),
);
