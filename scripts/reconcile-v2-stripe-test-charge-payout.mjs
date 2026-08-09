#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const reconciledAt = new Date().toISOString();

function envFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("=")).map((line) => {
    const i = line.indexOf("=");
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [line.slice(0, i).trim(), value];
  }));
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const env = { ...envFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")), ...envFile(path.join(repoRoot, ".env.local")), ...process.env };
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const TRANSACTION_ID = "e99085d5-0960-41d9-9b08-7b2e2ed0628a";
const EXPECTED_ALLOCATIONS = new Map([
  ["00315142-c5e0-4fb9-bf16-680fc488443d", {
    invoice_number: "368741",
    customer: "Christine Leclair",
    invoice_credit_cents: 318575,
    processor_charge_cents: 331318,
    processor_fee_cents: 9638,
    bank_cash_cents: 321680,
  }],
  ["664fc1f2-6c98-4d1d-8169-3eb02186686d", {
    invoice_number: "413691",
    customer: "Rachelle Paul",
    invoice_credit_cents: 35200,
    processor_charge_cents: 35200,
    processor_fee_cents: 1051,
    bank_cash_cents: 34149,
  }],
]);

const result = await db.from("transactions")
  .select("id,posted_on,description,counterparty,amount_cents,category,review_status,notes,metadata,allocations:transaction_allocations(id,invoice_id,amount_cents,needs_review,reversed_at,metadata,invoice:invoices!transaction_allocations_invoice_id_fkey(id,invoice_number,contact:contacts(name)))")
  .eq("id", TRANSACTION_ID).single();
if (result.error) throw result.error;
const transaction = result.data;
const allocations = transaction.allocations.filter((row) => !row.reversed_at);
assert(transaction.posted_on === "2026-04-13" && transaction.description === "STRIPE MSP" && transaction.counterparty === "Stripe", "Stripe payout identity changed.");
assert(Number(transaction.amount_cents) === 355898 && transaction.category === "Painting revenue" && transaction.review_status === "reconciled", "Stripe payout state changed.");
assert(allocations.length === EXPECTED_ALLOCATIONS.size, "Stripe payout allocation count changed.");
for (const allocation of allocations) {
  const expected = EXPECTED_ALLOCATIONS.get(allocation.id);
  assert(expected, `Unexpected Stripe allocation ${allocation.id}.`);
  assert(allocation.invoice?.invoice_number === expected.invoice_number && allocation.invoice?.contact?.name === expected.customer, `Stripe allocation customer changed for ${allocation.id}.`);
  assert(Number(allocation.amount_cents) === expected.invoice_credit_cents && allocation.needs_review === false, `Stripe allocation amount/review state changed for ${allocation.id}.`);
  const note = allocation.metadata?.evidence_note ?? "";
  assert(note.includes(`charged $${(expected.processor_charge_cents / 100).toFixed(2)}`) && note.includes(`withheld a $${(expected.processor_fee_cents / 100).toFixed(2)} fee`) && note.includes(`deposited $${(expected.bank_cash_cents / 100).toFixed(2)}`), `Saved Stripe evidence changed for ${allocation.id}.`);
}
const exception = transaction.metadata?.customer_revenue_exception;
assert(exception?.status === "confirmed" && exception?.kind === "processor_test_charge" && exception?.resolution?.includes("$0.69"), "Saved Stripe test-charge exception changed.");

const processorGrossCents = [...EXPECTED_ALLOCATIONS.values()].reduce((sum, row) => sum + row.processor_charge_cents, 0) + 102;
const processorFeeCents = [...EXPECTED_ALLOCATIONS.values()].reduce((sum, row) => sum + row.processor_fee_cents, 0) + 33;
const allocatedNetCashCents = [...EXPECTED_ALLOCATIONS.values()].reduce((sum, row) => sum + row.bank_cash_cents, 0);
assert(processorGrossCents === 366620 && processorFeeCents === 10722 && allocatedNetCashCents === 355829, "Stripe component arithmetic changed.");
assert(processorGrossCents - processorFeeCents === Number(transaction.amount_cents), "Stripe gross less fees does not equal the bank deposit.");
assert(Number(transaction.amount_cents) - allocatedNetCashCents === 69, "Stripe test-charge net residual changed.");

const preview = {
  mode: APPLY ? "apply" : "dry-run",
  no_email_used: true,
  transaction_id: TRANSACTION_ID,
  processor_gross_cents: processorGrossCents,
  processor_fee_cents: processorFeeCents,
  net_bank_cents: Number(transaction.amount_cents),
  allocated_customer_net_cash_cents: allocatedNetCashCents,
  non_invoice_test_charge_gross_cents: 102,
  non_invoice_test_charge_fee_cents: 33,
  non_invoice_test_charge_net_cents: 69,
  allocations: allocations.map((allocation) => ({ allocation_id: allocation.id, ...EXPECTED_ALLOCATIONS.get(allocation.id) })),
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) process.exit(0);

for (const allocation of allocations) {
  const expected = EXPECTED_ALLOCATIONS.get(allocation.id);
  const update = await db.from("transaction_allocations").update({
    metadata: {
      ...(allocation.metadata ?? {}),
      bank_cash_cents: expected.bank_cash_cents,
      stripe_processor_charge_cents: expected.processor_charge_cents,
      stripe_fee_cents: expected.processor_fee_cents,
      stripe_settlement: {
        status: "confirmed_from_saved_payment_evidence",
        transaction_id: TRANSACTION_ID,
        no_email_used: true,
        reconciled_at: reconciledAt,
      },
    },
    updated_at: reconciledAt,
  }).eq("id", allocation.id).is("reversed_at", null);
  if (update.error) throw update.error;
}
const transactionUpdate = await db.from("transactions").update({
  metadata: {
    ...(transaction.metadata ?? {}),
    stripe_payout_reconciliation: {
      status: "confirmed",
      payout_id: "po_1TKTKG72vdHYfMJMjS2wl8cz",
      processor_gross_cents: processorGrossCents,
      fee_cents: processorFeeCents,
      net_bank_cents: Number(transaction.amount_cents),
      allocated_customer_net_cash_cents: allocatedNetCashCents,
      non_invoice_test_charge_gross_cents: 102,
      non_invoice_test_charge_fee_cents: 33,
      non_invoice_test_charge_net_cents: 69,
      fee_classification: "Payment processing fees — non-job overhead",
      no_email_used: true,
      reconciled_at: reconciledAt,
    },
  },
  updated_at: reconciledAt,
}).eq("id", TRANSACTION_ID).eq("review_status", "reconciled");
if (transactionUpdate.error) throw transactionUpdate.error;

const verifiedResult = await db.from("transactions").select("id,amount_cents,metadata,allocations:transaction_allocations(id,reversed_at,metadata)").eq("id", TRANSACTION_ID).single();
if (verifiedResult.error) throw verifiedResult.error;
const verified = verifiedResult.data;
const activeCash = verified.allocations.filter((row) => !row.reversed_at).reduce((sum, row) => sum + Number(row.metadata?.bank_cash_cents ?? 0), 0);
assert(activeCash === 355829 && Number(verified.amount_cents) - activeCash === 69, "Stripe net cash verification failed.");
assert(verified.metadata?.stripe_payout_reconciliation?.non_invoice_test_charge_net_cents === 69, "Stripe test-charge verification failed.");
console.log(JSON.stringify({ applied: true, no_email_used: true, transaction_id: TRANSACTION_ID, allocated_customer_net_cash_cents: activeCash, non_invoice_test_charge_net_cents: 69 }, null, 2));
