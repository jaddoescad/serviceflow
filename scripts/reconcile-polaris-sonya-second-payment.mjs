#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const CONTRACTOR_ID = "c5e12a25-2f40-4c05-af51-4f9f8401b573";
const PAYMENT_ID = "ba41388b-ac51-4612-a9d2-b977562a352e";
const INVOICE_ID = "288f3152-d9ab-4236-a6da-68f6b38e96b2";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();
const NOTE =
  "TD confirmation 19d50c507849b9f3 identifies this $1,010.00 Aref/Polaris " +
  "transfer as “Sonya (part payment 2) (pending 1300).” Applied to final " +
  "Polaris invoice #70 after the $990.00 first deposit; total paid is " +
  "$2,000.00 and the remaining balance is exactly $1,300.00.";

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
const [transactionResult, recordResult, invoiceResult, allocationsResult] =
  await Promise.all([
    db
      .from("financial_transactions")
      .select(
        "id,posted_on,description,counterparty,amount,currency,transaction_type,category,is_transfer,review_status,notes",
      )
      .eq("id", PAYMENT_ID)
      .single(),
    db
      .from("labour_payment_records")
      .select("contractor_id,recipient_status")
      .eq("financial_transaction_id", PAYMENT_ID)
      .single(),
    db
      .from("labour_invoices")
      .select(
        "id,contractor_id,supplier_name,invoice_number,amount_before_tax,tax_amount,currency,document_type,text_excerpt",
      )
      .eq("id", INVOICE_ID)
      .single(),
    db
      .from("labour_payment_allocations")
      .select("id,invoice_id,allocated_amount,reversed_at")
      .eq("financial_transaction_id", PAYMENT_ID)
      .is("reversed_at", null),
  ]);
for (const [label, result] of Object.entries({
  transaction: transactionResult,
  record: recordResult,
  invoice: invoiceResult,
  allocations: allocationsResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

const transaction = transactionResult.data;
const invoice = invoiceResult.data;
assert(
  transaction.posted_on === "2026-04-02" &&
    transaction.description === "SEND E-TFR ***ujd" &&
    transaction.counterparty === "Aref Hosain Mohammadi" &&
    cents(transaction.amount) === -101000 &&
    transaction.currency === "CAD" &&
    transaction.transaction_type === "expense" &&
    transaction.category === "Subcontractors" &&
    transaction.is_transfer === false,
  "The Sonya second-payment bank row changed.",
);
assert(
  recordResult.data.contractor_id === CONTRACTOR_ID &&
    recordResult.data.recipient_status === "confirmed",
  "The Aref payment is no longer confirmed as Polaris.",
);
assert(
  invoice.contractor_id === CONTRACTOR_ID &&
    invoice.supplier_name === "Polaris Painters" &&
    invoice.invoice_number === "70" &&
    invoice.document_type === "invoice" &&
    invoice.currency === "CAD" &&
    cents(gross(invoice)) === 330000 &&
    invoice.text_excerpt?.includes("$990 Received on Feb 16th"),
  "Polaris final invoice #70 changed.",
);
assert(
  allocationsResult.data.every(
    (allocation) =>
      allocation.invoice_id === INVOICE_ID &&
      cents(allocation.allocated_amount) === 101000,
  ),
  "The Sonya second payment has an unexpected allocation.",
);
const activeAllocation = allocationsResult.data[0] ?? null;
const transactionUpdate =
  transaction.review_status !== "reconciled" || transaction.notes !== NOTE;

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      transaction_update: transactionUpdate ? 1 : 0,
      allocation_insert: activeAllocation ? 0 : 1,
      payment_amount: 1010,
      invoice_total_paid: 2000,
      invoice_balance: 1300,
    },
    null,
    2,
  ),
);
if (!APPLY) process.exit(0);

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

if (!activeAllocation) {
  const insertion = await db.from("labour_payment_allocations").insert({
    financial_transaction_id: PAYMENT_ID,
    invoice_id: INVOICE_ID,
    allocated_amount: 1010,
    match_method: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "payment_sequence",
      "memo_remaining_balance",
      "td_payment_confirmation",
      "bank_record",
    ],
    invoice_source_message_id: "19d50bd59c915cc3",
    payment_confirmation_message_id: "19d50c507849b9f3",
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
    old_values: { invoice_id: null, allocated_amount: 0 },
    new_values: { invoice_id: INVOICE_ID, allocated_amount: 1010 },
    reason: NOTE,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const [paymentVerification, invoiceVerification] = await Promise.all([
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
    .eq("invoice_id", INVOICE_ID)
    .single(),
]);
if (paymentVerification.error) throw paymentVerification.error;
if (invoiceVerification.error) throw invoiceVerification.error;
assert(
  paymentVerification.data.payment_status === "fully_allocated" &&
    cents(paymentVerification.data.unallocated_amount) === 0 &&
    cents(paymentVerification.data.total_allocated_amount) === 101000,
  "Sonya second-payment verification failed.",
);
assert(
  invoiceVerification.data.payment_status === "partially_paid" &&
    cents(invoiceVerification.data.invoice_amount) === 330000 &&
    cents(invoiceVerification.data.paid_amount) === 200000 &&
    cents(invoiceVerification.data.amount_remaining) === 130000,
  "Sonya invoice #70 balance does not match the TD memo.",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      payment_fully_allocated: true,
      invoice: "70",
      paid: 2000,
      remaining: 1300,
    },
    null,
    2,
  ),
);
