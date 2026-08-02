#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const ACCOUNT_LAST_FOUR = "6970";
const EVIDENCE = {
  invoiceNumber: "469677",
  customer: "Lorraine Ulrick",
  paymentReceivedOn: "2026-07-22",
  stripeGross: 2545.89,
  stripeFee: 74.13,
  bankCash: 2471.76,
  bankPostedOn: "2026-07-27",
  bankDescription: "STRIPE MSP",
  bankSyncBankId: "9Xn70zRr1OTkxjdXxobqSxYREbVNN4fXoMwgg",
  bankSyncAccountId: "mNXLer6Q5duO4bPN45ExcyZgaxBV4PuEEXpjLJ",
  bankSyncTransactionId: "BX1L5EwbvpTJ13Oe1EYYIkvzmqOvv7h8V17EE",
  stripePaymentId: "pi_3Tw26S72vdHYfMJM1Gsr4BNS",
  stripePayoutId: "po_1TwWlq72vdHYfMJMLfgSPHhr",
  stripePaymentGmailId: "19f8a747c127fe9d",
  stripePayoutGmailId: "19fa45c20b6c8489",
};

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

function money(value) {
  return Number(Number(value ?? 0).toFixed(2));
}

function sourceObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function sourceKey(transactionId) {
  return createHash("sha256")
    .update(`banksync:td-canada-trust:${transactionId}`)
    .digest("hex");
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
assert(
  money(EVIDENCE.stripeGross - EVIDENCE.stripeFee) === EVIDENCE.bankCash,
  "Stripe gross less fee does not equal the bank deposit.",
);

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [accounts, invoices] = await Promise.all([
  db
    .from("financial_accounts")
    .select("id,name,account_type,last_four,currency")
    .eq("last_four", ACCOUNT_LAST_FOUR),
  db
    .from("customer_invoices")
    .select(
      "id,invoice_number,customer_name,total_amount,source_paid_amount,currency,external_proposal_id,accounting_status",
    )
    .eq("invoice_number", EVIDENCE.invoiceNumber),
]);
const accountRows = assertNoError("business chequing account", accounts);
const invoiceRows = assertNoError("customer invoice", invoices);
assert(accountRows.length === 1, "Expected one account ending 6970.");
assert(invoiceRows.length === 1, "Expected one invoice #469677.");
const account = accountRows[0];
const invoice = invoiceRows[0];
assert(account.account_type === "chequing", "Account 6970 is not chequing.");
assert(account.currency === "CAD", "Account 6970 is not CAD.");
assert(invoice.customer_name === EVIDENCE.customer, "Invoice customer changed.");
assert(invoice.currency === "CAD", "Invoice #469677 is not CAD.");
assert(invoice.accounting_status === "active", "Invoice #469677 is not active.");

const [eventResult, verificationResult, existingTransactionResult] =
  await Promise.all([
    db
      .from("customer_invoice_payment_events")
      .select(
        "id,customer_invoice_id,source_system,external_payment_id,payment_number,received_on,method,reference,amount,currency,source_payload",
      )
      .eq("customer_invoice_id", invoice.id)
      .eq("received_on", EVIDENCE.paymentReceivedOn),
    db
      .from("customer_invoice_verification")
      .select(
        "customer_invoice_id,invoice_number,customer_name,total_amount,source_paid_amount,bank_paid_amount,bank_cash_amount,amount_remaining,bank_payment_status,verification_status",
      )
      .eq("customer_invoice_id", invoice.id),
    db
      .from("financial_transactions")
      .select(
        "id,source_key,account_id,posted_on,description,counterparty,amount,currency,transaction_type,category,review_status,source_data",
      )
      .or(
        `source_key.eq.${sourceKey(EVIDENCE.bankSyncTransactionId)},and(account_id.eq.${account.id},posted_on.eq.${EVIDENCE.bankPostedOn},amount.eq.${EVIDENCE.bankCash},description.ilike.%25STRIPE%25)`,
      ),
  ]);
const events = assertNoError("customer payment event", eventResult).filter(
  (event) => money(event.amount) === EVIDENCE.stripeGross,
);
const verifications = assertNoError("invoice verification", verificationResult);
const existingTransactions = assertNoError(
  "existing Stripe bank transaction",
  existingTransactionResult,
);
assert(events.length === 1, "Expected one exact Lorraine Stripe payment event.");
assert(verifications.length === 1, "Expected one invoice verification row.");
assert(
  existingTransactions.length <= 1,
  "Multiple financial rows match the Jul 27 Stripe payout.",
);
const event = events[0];
const verification = verifications[0];
assert(event.source_system === "dripjobs", "Unexpected payment-event source.");
assert(event.currency === "CAD", "Unexpected payment-event currency.");

let transaction = existingTransactions[0] ?? null;
const allocationResult = await db
  .from("customer_invoice_bank_allocations")
  .select(
    "id,financial_transaction_id,customer_invoice_id,source_payment_event_id,allocated_amount,invoice_applied_amount,reversed_at",
  )
  .eq("customer_invoice_id", invoice.id)
  .eq("source_payment_event_id", event.id)
  .is("reversed_at", null);
const existingAllocations = assertNoError(
  "existing customer allocation",
  allocationResult,
);
assert(
  existingAllocations.length <= 1,
  "Duplicate active Lorraine allocations.",
);
assert(
  existingAllocations.length > 0 ||
    money(verification.source_paid_amount) -
      money(verification.bank_paid_amount) >=
      EVIDENCE.stripeGross - 0.01,
  "Invoice no longer has this source payment awaiting bank evidence.",
);

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      evidence: {
        invoice: `#${EVIDENCE.invoiceNumber} · ${EVIDENCE.customer}`,
        stripe_payment: EVIDENCE.stripePaymentId,
        stripe_payout: EVIDENCE.stripePayoutId,
        gross: EVIDENCE.stripeGross,
        fee: EVIDENCE.stripeFee,
        bank_cash: EVIDENCE.bankCash,
        bank_posted_on: EVIDENCE.bankPostedOn,
        bank_sync_transaction: EVIDENCE.bankSyncTransactionId,
      },
      payment_event: {
        id: event.id,
        payment_number: event.payment_number,
        received_on: event.received_on,
        amount: money(event.amount),
      },
      bank_row: transaction ? "present" : "create",
      allocation: existingAllocations.length ? "present" : "create",
      before: {
        source_paid: money(verification.source_paid_amount),
        bank_paid: money(verification.bank_paid_amount),
        bank_cash: money(verification.bank_cash_amount),
        amount_remaining: money(verification.amount_remaining),
        status: verification.verification_status,
      },
    },
    null,
    2,
  ),
);

if (!APPLY) process.exit(0);

const now = new Date().toISOString();
if (!transaction) {
  const importPayload = {
    provider: "banksync_plaid",
    bank_id: EVIDENCE.bankSyncBankId,
    account_id: EVIDENCE.bankSyncAccountId,
    transaction_id: EVIDENCE.bankSyncTransactionId,
    posted_on: EVIDENCE.bankPostedOn,
    description: EVIDENCE.bankDescription,
    amount: EVIDENCE.bankCash,
    stripe_payment_id: EVIDENCE.stripePaymentId,
    stripe_payout_id: EVIDENCE.stripePayoutId,
    stripe_payment_gmail_id: EVIDENCE.stripePaymentGmailId,
    stripe_payout_gmail_id: EVIDENCE.stripePayoutGmailId,
  };
  const importRows = assertNoError(
    "Stripe payout evidence import",
    await db
      .from("financial_imports")
      .upsert(
        {
          content_sha256: createHash("sha256")
            .update(JSON.stringify(importPayload))
            .digest("hex"),
          source_email_thread_id: null,
          source_message_id: EVIDENCE.stripePayoutGmailId,
          original_filename:
            "BankSync + Stripe payout evidence — 2026-07-27 — po_1TwWlq72vdHYfMJMLfgSPHhr.json",
          mime_type: "application/json",
          source_kind: "bank_feed",
          account_id: account.id,
          period_start: EVIDENCE.bankPostedOn,
          period_end: EVIDENCE.bankPostedOn,
          row_count: 1,
          metadata: importPayload,
        },
        { onConflict: "content_sha256" },
      )
      .select("id"),
  );
  assert(importRows.length === 1, "Stripe payout evidence import failed.");

  const inserted = assertNoError(
    "Stripe bank transaction insert",
    await db
      .from("financial_transactions")
      .insert({
        account_id: account.id,
        import_id: importRows[0].id,
        source_key: sourceKey(EVIDENCE.bankSyncTransactionId),
        posted_on: EVIDENCE.bankPostedOn,
        transaction_on: EVIDENCE.bankPostedOn,
        description: EVIDENCE.bankDescription,
        counterparty: "Stripe",
        amount: EVIDENCE.bankCash,
        tax_amount: 0,
        currency: "CAD",
        transaction_type: "income",
        category: "Painting revenue",
        is_transfer: false,
        review_status: "reconciled",
        notes:
          "Stripe payout po_1TwWlq72vdHYfMJMLfgSPHhr: Lorraine Ulrick paid $2,545.89; Stripe withheld $74.13 and deposited $2,471.76 to TD 6970.",
        source_data: {
          source: "banksync_plaid",
          bank_sync_transaction_id: EVIDENCE.bankSyncTransactionId,
          bank_sync_account_id: EVIDENCE.bankSyncAccountId,
          bank_sync_bank_id: EVIDENCE.bankSyncBankId,
          pending: false,
          stripe_payment_id: EVIDENCE.stripePaymentId,
          stripe_payout_id: EVIDENCE.stripePayoutId,
          stripe_payment_gmail_id: EVIDENCE.stripePaymentGmailId,
          stripe_payout_gmail_id: EVIDENCE.stripePayoutGmailId,
        },
      })
      .select(
        "id,source_key,account_id,posted_on,description,counterparty,amount,currency,transaction_type,category,review_status,source_data",
      ),
  );
  assert(inserted.length === 1, "Stripe bank transaction was not inserted.");
  transaction = inserted[0];
}

assert(transaction.account_id === account.id, "Stripe bank account mismatch.");
assert(transaction.posted_on === EVIDENCE.bankPostedOn, "Stripe date mismatch.");
assert(money(transaction.amount) === EVIDENCE.bankCash, "Stripe amount mismatch.");
assert(transaction.transaction_type === "income", "Stripe row is not income.");
assert(transaction.category === "Painting revenue", "Stripe category mismatch.");

if (existingAllocations.length === 0) {
  assertNoError(
    "Lorraine Stripe allocation insert",
    await db.from("customer_invoice_bank_allocations").insert({
      financial_transaction_id: transaction.id,
      customer_invoice_id: invoice.id,
      source_payment_event_id: event.id,
      allocated_amount: EVIDENCE.bankCash,
      invoice_applied_amount: EVIDENCE.stripeGross,
      match_method: [
        "banksync_posted_bank_transaction",
        "stripe_payment_confirmation",
        "stripe_payout_confirmation",
        "gross_less_processor_fee",
        "dripjobs_payment_event",
      ],
      confidence: "confirmed",
      evidence_note:
        "Stripe payment pi_3Tw26S72vdHYfMJM1Gsr4BNS charged Lorraine Ulrick $2,545.89 on Jul 22. Stripe payout po_1TwWlq72vdHYfMJMLfgSPHhr deposited $2,471.76 to TD 6970 on Jul 27 after a $74.13 processor fee. BankSync transaction BX1L5EwbvpTJ13Oe1EYYIkvzmqOvv7h8V17EE confirms the posted cash.",
      confirmed_by: null,
      confirmed_at: now,
    }),
  );
}

const transactionSource = sourceObject(transaction.source_data);
const revenueVerificationRows = assertNoError(
  "customer revenue verification",
  await db
    .from("customer_revenue_verification")
    .select(
      "financial_transaction_id,payment_status,allocated_amount,unallocated_amount",
    )
    .eq("financial_transaction_id", transaction.id),
);
assert(revenueVerificationRows.length === 1, "Missing revenue verification row.");
const revenueVerification = revenueVerificationRows[0];
assert(
  revenueVerification.payment_status === "fully_allocated" &&
    money(revenueVerification.unallocated_amount) === 0,
  "Stripe deposit is not fully allocated.",
);

assertNoError(
  "Stripe transaction evidence update",
  await db
    .from("financial_transactions")
    .update({
      counterparty: "Stripe",
      review_status: "reconciled",
      source_data: {
        ...transactionSource,
        customer_revenue_identity: {
          status: "confirmed",
          provider: "stripe",
          payout_id: EVIDENCE.stripePayoutId,
          payment_id: EVIDENCE.stripePaymentId,
          customer: EVIDENCE.customer,
          invoice_number: EVIDENCE.invoiceNumber,
          stripe_gross_charges: EVIDENCE.stripeGross,
          processor_fee: EVIDENCE.stripeFee,
          bank_cash: EVIDENCE.bankCash,
          stripe_payment_gmail_id: EVIDENCE.stripePaymentGmailId,
          stripe_payout_gmail_id: EVIDENCE.stripePayoutGmailId,
          verified_at: now,
        },
        customer_revenue_settlement: {
          status: revenueVerification.payment_status,
          allocated_amount: money(revenueVerification.allocated_amount),
          unallocated_amount: money(revenueVerification.unallocated_amount),
          rule: "customer_invoice_bank_allocations_are_settlement_truth",
          updated_at: now,
        },
      },
    })
    .eq("id", transaction.id),
);

const finalInvoices = assertNoError(
  "final invoice verification",
  await db
    .from("customer_invoice_verification")
    .select(
      "customer_invoice_id,invoice_number,customer_name,total_amount,source_paid_amount,bank_paid_amount,bank_cash_amount,processing_fee_amount,amount_remaining,bank_payment_status,verification_status",
    )
    .eq("customer_invoice_id", invoice.id),
);
assert(finalInvoices.length === 1, "Final invoice verification disappeared.");
const finalInvoice = finalInvoices[0];
assert(
  money(finalInvoice.bank_paid_amount) + 0.005 >=
    money(finalInvoice.source_paid_amount),
  "Lorraine still has a recorded payment without evidence.",
);
assert(
  money(finalInvoice.processing_fee_amount) >= EVIDENCE.stripeFee,
  "Stripe processing fee was not recorded.",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      transaction_id: transaction.id,
      bank_cash_linked: EVIDENCE.bankCash,
      invoice_credit_linked: EVIDENCE.stripeGross,
      processor_fee_recorded: EVIDENCE.stripeFee,
      invoice: finalInvoice,
    },
    null,
    2,
  ),
);
