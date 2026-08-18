#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const TRANSACTION_ID = "a40ab9e2-eef5-5d08-9376-370882555a25";
const INVOICE_ID = "3e859614-a397-5670-b0ab-af0963807eb1";
const PAYMENT_CENTS = 1_000_000;
const capturedAt = new Date().toISOString();
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const allocationId = stableUuid(`transaction-allocation:caledonian-239609:${TRANSACTION_ID}`);

const [transactionResult, invoiceResult, allocationResult] = await Promise.all([
  db.from("transactions").select("*").eq("id", TRANSACTION_ID).single(),
  db.from("invoices").select("*,contact:contacts(id,name,email)").eq("id", INVOICE_ID).single(),
  db.from("transaction_allocations").select("*").or(`transaction_id.eq.${TRANSACTION_ID},invoice_id.eq.${INVOICE_ID}`).is("reversed_at", null),
]);
if (transactionResult.error) throw transactionResult.error;
if (invoiceResult.error) throw invoiceResult.error;
if (allocationResult.error) throw allocationResult.error;
const transaction = transactionResult.data;
const invoice = invoiceResult.data;
const activeAllocations = allocationResult.data ?? [];

if (
  transaction.posted_on !== "2026-08-10" ||
  transaction.description !== "SEND E-TFR ***qzd" ||
  Number(transaction.amount_cents) !== -PAYMENT_CENTS ||
  transaction.counterparty !== "Scott Madden" ||
  transaction.metadata?.recipient_destination !== "scott@caledonianpainting.ca" ||
  transaction.metadata?.status !== "Autodeposited"
) throw new Error("The EasyWeb transaction evidence changed; refusing to apply.");
if (
  invoice.invoice_number !== "239609" ||
  invoice.issued_on !== "2026-08-06" ||
  invoice.direction !== "payable" ||
  invoice.contact?.name !== "Caledonian Painting Ltd" ||
  Number(invoice.total_cents) !== 1_095_352
) throw new Error("The Caledonian invoice evidence changed; refusing to apply.");
const conflicts = activeAllocations.filter((row) => row.id !== allocationId);
if (conflicts.length) throw new Error(`Conflicting active allocation(s): ${conflicts.map((row) => row.id).join(", ")}`);

const newPaidCents = PAYMENT_CENTS;
const newBalanceCents = Number(invoice.total_cents) - newPaidCents;
console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  transaction: { id: transaction.id, posted_on: transaction.posted_on, recipient: transaction.counterparty, amount_cents: transaction.amount_cents, bank_status: transaction.metadata?.status },
  invoice: { id: invoice.id, invoice_number: invoice.invoice_number, supplier: invoice.contact?.name, issued_on: invoice.issued_on, total_cents: invoice.total_cents, current_paid_cents: invoice.paid_cents, proposed_paid_cents: newPaidCents, proposed_balance_cents: newBalanceCents },
  classification: "Sales commissions / business-development overhead; not subcontractor labour",
  allocation_id: allocationId,
}, null, 2));
if (!APPLY) process.exit(0);

const allocationWrite = await db.from("transaction_allocations").upsert({
  id: allocationId,
  transaction_id: TRANSACTION_ID,
  invoice_id: INVOICE_ID,
  source_system: "td_easyweb",
  external_id: "C1AeYs***qzd",
  allocation_type: "supplier_payment",
  amount_cents: PAYMENT_CENTS,
  allocation_method: "supplier_identity,bank_recipient_email,unique_open_supplier_invoice,established_split_payment_pattern",
  confidence: 0.99,
  needs_review: false,
  metadata: {
    classification: "sales_commission_and_business_development_overhead",
    not_subcontractor_labour: true,
    bank_status: transaction.metadata?.status,
    recipient: transaction.counterparty,
    recipient_destination: transaction.metadata?.recipient_destination,
    invoice_number: invoice.invoice_number,
    evidence_summary: "Autodeposited $10,000 transfer to Scott Madden at Caledonian, three days after the only open Caledonian invoice; prior Caledonian invoices use the same split-payment pattern.",
  },
  created_at: activeAllocations.length ? activeAllocations[0].created_at : capturedAt,
  updated_at: capturedAt,
}, { onConflict: "id" });
if (allocationWrite.error) throw allocationWrite.error;

const transactionWrite = await db.from("transactions").update({
  category: "Sales commissions",
  review_status: "reconciled",
  notes: "Autodeposited payment to Scott Madden/Caledonian; allocated as the first $10,000 payment on invoice #239609. This is sales-commission/business-development overhead, not subcontractor labour.",
  metadata: {
    ...(transaction.metadata ?? {}),
    invoice_match: { invoice_id: INVOICE_ID, invoice_number: "239609", allocation_id: allocationId, status: "partial_payment", remaining_cents: newBalanceCents },
  },
  updated_at: capturedAt,
}).eq("id", TRANSACTION_ID).eq("updated_at", transaction.updated_at).select("id").maybeSingle();
if (transactionWrite.error) throw transactionWrite.error;
if (!transactionWrite.data) throw new Error("Concurrent transaction update; allocation requires review.");

const invoiceWrite = await db.from("invoices").update({
  status: "partially_paid",
  paid_cents: newPaidCents,
  balance_cents: newBalanceCents,
  metadata: {
    ...(invoice.metadata ?? {}),
    settlement: { status: "partially_paid", paid_cents: newPaidCents, balance_cents: newBalanceCents, transaction_ids: [TRANSACTION_ID], allocation_ids: [allocationId], last_payment_on: transaction.posted_on },
  },
  updated_at: capturedAt,
}).eq("id", INVOICE_ID).eq("updated_at", invoice.updated_at).select("id").maybeSingle();
if (invoiceWrite.error) throw invoiceWrite.error;
if (!invoiceWrite.data) throw new Error("Concurrent invoice update; allocation requires review.");

const eventWrite = await db.from("verification_events").upsert({
  id: stableUuid(`verification:caledonian-239609-partial:${TRANSACTION_ID}`),
  entity_type: "transaction_allocation",
  entity_id: allocationId,
  action: "supplier_invoice_partial_payment_reconciled",
  reason: "Direct recipient evidence and established Caledonian split-payment pattern identify the transfer as a partial payment of invoice #239609.",
  old_values: { transaction_review_status: transaction.review_status, invoice_status: invoice.status, invoice_paid_cents: invoice.paid_cents, invoice_balance_cents: invoice.balance_cents },
  new_values: { transaction_review_status: "reconciled", invoice_status: "partially_paid", invoice_paid_cents: newPaidCents, invoice_balance_cents: newBalanceCents },
  evidence: { bank_status: transaction.metadata?.status, posted_on: transaction.posted_on, recipient: transaction.counterparty, recipient_destination: transaction.metadata?.recipient_destination, invoice_number: invoice.invoice_number, classification: "sales_commission_and_business_development_overhead" },
  occurred_at: capturedAt,
}, { onConflict: "id" });
if (eventWrite.error) throw eventWrite.error;

const [verifiedTransaction, verifiedInvoice] = await Promise.all([
  db.from("transactions").select("id,category,review_status,allocations:transaction_allocations(id,invoice_id,amount_cents,allocation_type,needs_review,reversed_at)").eq("id", TRANSACTION_ID).single(),
  db.from("invoices").select("id,invoice_number,status,total_cents,paid_cents,balance_cents").eq("id", INVOICE_ID).single(),
]);
if (verifiedTransaction.error) throw verifiedTransaction.error;
if (verifiedInvoice.error) throw verifiedInvoice.error;
const activeTotal = (verifiedTransaction.data.allocations ?? []).filter((row) => !row.reversed_at).reduce((sum, row) => sum + Number(row.amount_cents), 0);
if (verifiedTransaction.data.review_status !== "reconciled" || activeTotal !== PAYMENT_CENTS || Number(verifiedInvoice.data.paid_cents) !== newPaidCents || Number(verifiedInvoice.data.balance_cents) !== newBalanceCents) {
  throw new Error("Post-write verification failed.");
}
console.log(JSON.stringify({ status: "verified", transaction: verifiedTransaction.data, invoice: verifiedInvoice.data }, null, 2));
