#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const CONFIRMED_ON = "2026-08-06";
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

const targets = [
  {
    suffix: "wJA",
    transactionId: "226de67e-fe2b-5364-9c53-44cd416d1372",
    amountCents: 83_620,
    recipient: "grutenco",
    category: "Subcontractors",
    invoiceNumber: null,
  },
  {
    suffix: "N2Q",
    transactionId: "d27d240e-c0ce-508b-a2a6-d54a254b79d8",
    amountCents: 88_140,
    recipient: "Michael Matambo",
    category: "Subcontractors",
    invoiceNumber: null,
  },
  {
    suffix: "fwu",
    transactionId: "88f8a793-9c91-57a6-b1ad-b652a7f27d31",
    amountCents: 47_460,
    recipient: "Michael Matambo",
    category: "Subcontractors",
    invoiceNumber: null,
  },
  {
    suffix: "Pud",
    transactionId: "4127fad5-bfbc-5b4c-916e-b7b02d0f2074",
    amountCents: 142_380,
    recipient: "Darlene",
    category: "Colour consultation",
    invoiceNumber: "414",
  },
];

const [transactionResult, invoiceResult] = await Promise.all([
  db
    .from("transactions")
    .select("id,posted_on,description,amount_cents,counterparty,category,review_status,notes,metadata,updated_at")
    .in("id", targets.map((target) => target.transactionId)),
  db
    .from("invoices")
    .select("id,invoice_number,direction,category,status,total_cents,paid_cents,balance_cents,metadata,updated_at,contact:contacts(id,name)")
    .eq("direction", "payable")
    .eq("invoice_number", "414"),
]);
if (transactionResult.error) throw transactionResult.error;
if (invoiceResult.error) throw invoiceResult.error;

const transactions = transactionResult.data ?? [];
for (const target of targets) {
  const matches = transactions.filter((row) => row.id === target.transactionId);
  if (matches.length !== 1) {
    throw new Error(`${target.suffix}: expected one transaction, found ${matches.length}.`);
  }
  const transaction = matches[0];
  if (
    transaction.posted_on !== "2026-08-06" ||
    transaction.description !== `SEND E-TFR ***${target.suffix}` ||
    Number(transaction.amount_cents) !== -target.amountCents ||
    String(transaction.counterparty).toLocaleLowerCase("en-CA") !==
      target.recipient.toLocaleLowerCase("en-CA")
  ) {
    throw new Error(`${target.suffix}: transaction evidence changed; refusing to apply.`);
  }
  target.transaction = transaction;
}

const darleneInvoices = (invoiceResult.data ?? []).filter(
  (invoice) =>
    invoice.invoice_number === "414" &&
    Number(invoice.total_cents) === 142_380 &&
    invoice.contact?.name === "Dressing Rooms",
);
if (darleneInvoices.length !== 1) {
  throw new Error(`Invoice 414: expected one exact Dressing Rooms invoice, found ${darleneInvoices.length}.`);
}
const darleneInvoice = darleneInvoices[0];
targets.find((target) => target.invoiceNumber === "414").invoice = darleneInvoice;

const allocationResult = await db
  .from("transaction_allocations")
  .select("id,transaction_id,invoice_id,allocation_type,amount_cents,allocation_method,needs_review,reversed_at,metadata")
  .or(
    `transaction_id.in.(${targets.map((target) => target.transactionId).join(",")}),invoice_id.eq.${darleneInvoice.id}`,
  )
  .is("reversed_at", null);
if (allocationResult.error) throw allocationResult.error;
const activeAllocations = allocationResult.data ?? [];

for (const target of targets) {
  target.allocationId = stableUuid(
    `transaction-allocation:user-confirmed-accepted:${target.transactionId}`,
  );
  target.existingAllocations = activeAllocations.filter(
    (allocation) => allocation.transaction_id === target.transactionId,
  );
  const conflict = target.existingAllocations.find(
    (allocation) =>
      allocation.id !== target.allocationId ||
      Number(allocation.amount_cents) !== target.amountCents ||
      (target.invoice && allocation.invoice_id !== target.invoice.id) ||
      (!target.invoice && allocation.invoice_id != null),
  );
  if (conflict) {
    throw new Error(`${target.suffix}: conflicting active allocation ${conflict.id}.`);
  }
}

const unrelatedInvoiceAllocation = activeAllocations.find(
  (allocation) =>
    allocation.invoice_id === darleneInvoice.id &&
    allocation.id !== targets.find((target) => target.invoiceNumber === "414").allocationId,
);
if (unrelatedInvoiceAllocation) {
  throw new Error(`Invoice 414 already has an unrelated active allocation ${unrelatedInvoiceAllocation.id}.`);
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  confirmation: "User confirmed the recipients will accept the transfers.",
  transfers: targets.map((target) => ({
    suffix: target.suffix,
    transaction_id: target.transaction.id,
    recipient: target.recipient,
    amount_cents: target.amountCents,
    current_review_status: target.transaction.review_status,
    allocation_id: target.allocationId,
    allocation_type: target.invoice ? "supplier_payment" : "confirmed_transfer_payment",
    invoice: target.invoice ? {
      id: target.invoice.id,
      invoice_number: target.invoice.invoice_number,
      contact: target.invoice.contact?.name ?? null,
      status: target.invoice.status,
      total_cents: target.invoice.total_cents,
      paid_cents: target.invoice.paid_cents,
      balance_cents: target.invoice.balance_cents,
    } : null,
    existing_allocations: target.existingAllocations,
  })),
  total_cents: targets.reduce((sum, target) => sum + target.amountCents, 0),
}, null, 2));
if (!APPLY) process.exit(0);

for (const target of targets) {
  const allocation = {
    id: target.allocationId,
    transaction_id: target.transaction.id,
    invoice_id: target.invoice?.id ?? null,
    source_system: "user_confirmation",
    external_id: `2026-08-06-${target.suffix}`,
    allocation_type: target.invoice ? "supplier_payment" : "confirmed_transfer_payment",
    amount_cents: target.amountCents,
    allocation_method: "user_confirmed_recipient_will_accept",
    confidence: 1,
    needs_review: false,
    metadata: {
      confirmed_on: CONFIRMED_ON,
      confirmation_method: "user_confirmation",
      source_bank_status_when_observed: target.transaction.metadata?.status ?? null,
      invoice_link_status: target.invoice ? "exact_invoice_linked" : "no_invoice_link_requested",
      no_email_used: true,
    },
    updated_at: capturedAt,
  };
  if (!target.existingAllocations.length) allocation.created_at = capturedAt;
  const allocationWrite = await db
    .from("transaction_allocations")
    .upsert(allocation, { onConflict: "id" });
  if (allocationWrite.error) throw allocationWrite.error;

  const notes = target.invoice
    ? `Settled by user confirmation and linked to Dressing Rooms invoice ${target.invoice.invoice_number}.`
    : "Settled by user confirmation that the recipient will accept the transfer; no invoice was linked.";
  const transactionWrite = await db
    .from("transactions")
    .update({
      category: target.category,
      review_status: "reconciled",
      notes,
      metadata: {
        ...(target.transaction.metadata ?? {}),
        recipient_verification: {
          ...(target.transaction.metadata?.recipient_verification ?? {}),
          settlement_blocker: null,
          invoice_match_status: target.invoice
            ? "exact_invoice_linked"
            : "no_invoice_link_requested",
        },
        settlement_confirmation: {
          status: "settled",
          confirmed_on: CONFIRMED_ON,
          confirmation_method: "user_confirmation",
          confirmation_detail: "User confirmed the recipient will accept the transfer.",
          allocation_id: target.allocationId,
          invoice_id: target.invoice?.id ?? null,
          invoice_number: target.invoice?.invoice_number ?? null,
        },
      },
      updated_at: capturedAt,
    })
    .eq("id", target.transaction.id)
    .eq("updated_at", target.transaction.updated_at)
    .select("id")
    .maybeSingle();
  if (transactionWrite.error) throw transactionWrite.error;
  if (!transactionWrite.data) throw new Error(`${target.suffix}: concurrent transaction update.`);

  const eventWrite = await db.from("verification_events").upsert({
    id: stableUuid(`verification:user-confirmed-settlement:${target.transaction.id}`),
    entity_type: "transaction_allocation",
    entity_id: target.allocationId,
    action: "transfer_settled_by_user_confirmation",
    reason: "User confirmed the recipient will accept the outgoing transfer.",
    old_values: {
      transaction_review_status: target.transaction.review_status,
      source_bank_status: target.transaction.metadata?.status ?? null,
      settlement_blocker:
        target.transaction.metadata?.recipient_verification?.settlement_blocker ?? null,
    },
    new_values: {
      transaction_review_status: "reconciled",
      settlement_status: "settled",
      allocation_amount_cents: target.amountCents,
      invoice_id: target.invoice?.id ?? null,
      invoice_number: target.invoice?.invoice_number ?? null,
    },
    evidence: {
      confirmation_method: "user_confirmation",
      confirmed_on: CONFIRMED_ON,
      recipient: target.recipient,
      transfer_suffix: target.suffix,
      source_bank_status_when_observed: target.transaction.metadata?.status ?? null,
      no_email_used: true,
    },
    occurred_at: capturedAt,
  }, { onConflict: "id" });
  if (eventWrite.error) throw eventWrite.error;
}

const darleneTarget = targets.find((target) => target.invoiceNumber === "414");
const invoiceWrite = await db
  .from("invoices")
  .update({
    status: "paid",
    paid_cents: darleneInvoice.total_cents,
    balance_cents: 0,
    metadata: {
      ...(darleneInvoice.metadata ?? {}),
      settlement: {
        transaction_id: darleneTarget.transaction.id,
        allocation_id: darleneTarget.allocationId,
        settled_on: CONFIRMED_ON,
        method: "user_confirmed_recipient_will_accept",
      },
    },
    updated_at: capturedAt,
  })
  .eq("id", darleneInvoice.id)
  .eq("updated_at", darleneInvoice.updated_at)
  .select("id")
  .maybeSingle();
if (invoiceWrite.error) throw invoiceWrite.error;
if (!invoiceWrite.data) throw new Error("Invoice 414: concurrent invoice update.");

const verificationResult = await db
  .from("transactions")
  .select("id,description,counterparty,amount_cents,review_status,notes,metadata,allocations:transaction_allocations(id,invoice_id,allocation_type,amount_cents,needs_review,reversed_at)")
  .in("id", targets.map((target) => target.transactionId));
if (verificationResult.error) throw verificationResult.error;

const invoiceVerificationResult = await db
  .from("invoices")
  .select("id,invoice_number,status,total_cents,paid_cents,balance_cents,payment_allocations:transaction_allocations!transaction_allocations_invoice_id_fkey(id,transaction_id,amount_cents,reversed_at)")
  .eq("id", darleneInvoice.id)
  .single();
if (invoiceVerificationResult.error) throw invoiceVerificationResult.error;

for (const target of targets) {
  const row = verificationResult.data?.find((transaction) => transaction.id === target.transactionId);
  const activeTotal = (row?.allocations ?? [])
    .filter((allocation) => !allocation.reversed_at)
    .reduce((sum, allocation) => sum + Number(allocation.amount_cents), 0);
  if (
    row?.review_status !== "reconciled" ||
    row?.metadata?.settlement_confirmation?.status !== "settled" ||
    activeTotal !== target.amountCents
  ) {
    throw new Error(`${target.suffix}: post-write verification failed.`);
  }
}
const invoiceVerification = invoiceVerificationResult.data;
if (
  invoiceVerification.status !== "paid" ||
  Number(invoiceVerification.paid_cents) !== Number(invoiceVerification.total_cents) ||
  Number(invoiceVerification.balance_cents) !== 0
) {
  throw new Error("Invoice 414: post-write settlement verification failed.");
}

console.log(JSON.stringify({
  status: "verified",
  total_settled_cents: targets.reduce((sum, target) => sum + target.amountCents, 0),
  transactions: verificationResult.data,
  invoice: invoiceVerification,
}, null, 2));
