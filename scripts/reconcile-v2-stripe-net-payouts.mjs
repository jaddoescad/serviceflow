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
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
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

const TARGET_TRANSACTION_IDS = [
  "12c9c7f4-a5f6-4d3b-a907-a6719db035b5",
  "13c4335c-524c-4982-a548-ea19d2bf2787",
  "4621b44e-48a0-4850-8f4b-39201b9dbe94",
  "506df989-bae5-4f95-8dec-022e990bbe47",
  "6c5fd84f-a094-419c-8086-f83dfd44dad5",
  "6d69ab11-2a97-40f3-99bb-13b17a198686",
  "71ed7278-7802-4393-912c-4c0d5cf10645",
  "74d5453f-d54d-41a9-9691-ff1a8217818c",
  "a164af26-6df8-41e3-8e5b-2812a3e687b8",
  "b8ba1dbe-be95-4173-85f0-b700af76b6fc",
  "bbc59d9e-bc0a-48b6-8eb6-7f78eb34d850",
  "f34f37d9-21de-4d84-bdf9-9b2ab2c8fcc9",
  "fba62957-25a1-40c4-91c5-f429d6d5561a",
];

const { data: transactions, error } = await db.from("transactions")
  .select("id,posted_on,description,counterparty,amount_cents,category,review_status,notes,metadata,allocations:transaction_allocations(id,invoice_id,amount_cents,needs_review,reversed_at,metadata,invoice:invoices!transaction_allocations_invoice_id_fkey(id,invoice_number,contact:contacts(name)))")
  .in("id", TARGET_TRANSACTION_IDS);
if (error) throw error;
assert(transactions.length === TARGET_TRANSACTION_IDS.length, `Expected ${TARGET_TRANSACTION_IDS.length} Stripe transactions, found ${transactions.length}.`);

const plans = transactions.map((transaction) => {
  const allocations = (transaction.allocations ?? []).filter((row) => !row.reversed_at);
  assert(transaction.description === "STRIPE MSP" && transaction.counterparty === "Stripe", `Transaction ${transaction.id} is no longer a Stripe payout.`);
  assert(Number(transaction.amount_cents) > 0 && transaction.category === "Painting revenue", `Transaction ${transaction.id} payout identity changed.`);
  assert(transaction.review_status === "reconciled", `Transaction ${transaction.id} must already be reconciled.`);
  assert(allocations.length > 0 && allocations.every((row) => row.invoice_id && !row.needs_review), `Transaction ${transaction.id} has an unreviewed or missing invoice link.`);
  const netCents = Number(transaction.amount_cents);
  const grossCents = allocations.reduce((sum, row) => sum + Number(row.amount_cents), 0);
  const feeCents = grossCents - netCents;
  assert(feeCents > 0 && feeCents < grossCents * 0.05, `Transaction ${transaction.id} has an implausible Stripe payout difference of ${feeCents} cents.`);
  const prior = transaction.metadata?.stripe_payout_reconciliation;
  if (prior?.status === "confirmed") {
    assert(Number(prior.gross_cents) === grossCents && Number(prior.net_bank_cents) === netCents && Number(prior.fee_cents) === feeCents, `Transaction ${transaction.id} prior Stripe reconciliation differs.`);
  }

  let assignedCash = 0;
  const allocationPlans = allocations
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((allocation, index, rows) => {
      const grossAllocation = Number(allocation.amount_cents);
      const bankCashCents = index === rows.length - 1
        ? netCents - assignedCash
        : Math.round(netCents * grossAllocation / grossCents);
      assignedCash += bankCashCents;
      const allocationFeeCents = grossAllocation - bankCashCents;
      assert(bankCashCents > 0 && allocationFeeCents >= 0, `Transaction ${transaction.id} produced an invalid allocation split.`);
      const existingCash = Number(allocation.metadata?.bank_cash_cents);
      if (Number.isFinite(existingCash) && existingCash > 0) assert(existingCash === bankCashCents, `Transaction ${transaction.id} allocation ${allocation.id} already has a different bank cash amount.`);
      return {
        allocation,
        bank_cash_cents: bankCashCents,
        stripe_fee_cents: allocationFeeCents,
      };
    });
  assert(allocationPlans.reduce((sum, row) => sum + row.bank_cash_cents, 0) === netCents, `Transaction ${transaction.id} cash split does not equal the bank deposit.`);
  assert(allocationPlans.reduce((sum, row) => sum + row.stripe_fee_cents, 0) === feeCents, `Transaction ${transaction.id} fee split does not equal the withheld fee.`);
  return { transaction, net_cents: netCents, gross_cents: grossCents, fee_cents: feeCents, allocation_plans: allocationPlans };
});

const preview = {
  mode: APPLY ? "apply" : "dry-run",
  no_email_used: true,
  payout_count: plans.length,
  gross_cents: plans.reduce((sum, row) => sum + row.gross_cents, 0),
  fee_cents: plans.reduce((sum, row) => sum + row.fee_cents, 0),
  net_bank_cents: plans.reduce((sum, row) => sum + row.net_cents, 0),
  payouts: plans.map((plan) => ({
    transaction_id: plan.transaction.id,
    posted_on: plan.transaction.posted_on,
    gross_cents: plan.gross_cents,
    fee_cents: plan.fee_cents,
    net_bank_cents: plan.net_cents,
    allocations: plan.allocation_plans.map((row) => ({
      allocation_id: row.allocation.id,
      invoice_id: row.allocation.invoice_id,
      invoice_number: row.allocation.invoice?.invoice_number ?? null,
      customer: row.allocation.invoice?.contact?.name ?? null,
      gross_cents: Number(row.allocation.amount_cents),
      stripe_fee_cents: row.stripe_fee_cents,
      bank_cash_cents: row.bank_cash_cents,
    })),
  })),
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) process.exit(0);

for (const plan of plans) {
  for (const row of plan.allocation_plans) {
    const update = await db.from("transaction_allocations").update({
      metadata: {
        ...(row.allocation.metadata ?? {}),
        bank_cash_cents: row.bank_cash_cents,
        stripe_fee_cents: row.stripe_fee_cents,
        stripe_settlement: {
          status: "confirmed",
          transaction_id: plan.transaction.id,
          method: plan.allocation_plans.length === 1 ? "exact_single_invoice_payout" : "proportional_net_cash_across_confirmed_gross_invoice_allocations",
          no_email_used: true,
          reconciled_at: reconciledAt,
        },
      },
      updated_at: reconciledAt,
    }).eq("id", row.allocation.id).is("reversed_at", null);
    if (update.error) throw update.error;
  }
  const transactionUpdate = await db.from("transactions").update({
    metadata: {
      ...(plan.transaction.metadata ?? {}),
      stripe_payout_reconciliation: {
        status: "confirmed",
        gross_cents: plan.gross_cents,
        fee_cents: plan.fee_cents,
        net_bank_cents: plan.net_cents,
        invoice_allocation_count: plan.allocation_plans.length,
        cash_allocation_method: plan.allocation_plans.length === 1 ? "exact_single_invoice_payout" : "proportional_across_confirmed_gross_invoice_allocations",
        fee_classification: "Payment processing fees — non-job overhead",
        no_email_used: true,
        reconciled_at: reconciledAt,
      },
    },
    updated_at: reconciledAt,
  }).eq("id", plan.transaction.id).eq("review_status", "reconciled");
  if (transactionUpdate.error) throw transactionUpdate.error;
}

const { data: verifiedTransactions, error: verifyError } = await db.from("transactions")
  .select("id,amount_cents,metadata,allocations:transaction_allocations(id,amount_cents,reversed_at,metadata)")
  .in("id", TARGET_TRANSACTION_IDS);
if (verifyError) throw verifyError;
assert(verifiedTransactions.length === plans.length, "Stripe verification count failed.");
for (const transaction of verifiedTransactions) {
  const active = transaction.allocations.filter((row) => !row.reversed_at);
  const cash = active.reduce((sum, row) => sum + Number(row.metadata?.bank_cash_cents ?? 0), 0);
  const fees = active.reduce((sum, row) => sum + Number(row.metadata?.stripe_fee_cents ?? 0), 0);
  const gross = active.reduce((sum, row) => sum + Number(row.amount_cents), 0);
  assert(cash === Number(transaction.amount_cents), `Stripe net verification failed for ${transaction.id}.`);
  assert(gross - cash === fees, `Stripe fee verification failed for ${transaction.id}.`);
  assert(transaction.metadata?.stripe_payout_reconciliation?.status === "confirmed", `Stripe transaction metadata verification failed for ${transaction.id}.`);
}
console.log(JSON.stringify({ applied: true, no_email_used: true, payout_count: plans.length, gross_cents: preview.gross_cents, fee_cents: preview.fee_cents, net_bank_cents: preview.net_bank_cents }, null, 2));
