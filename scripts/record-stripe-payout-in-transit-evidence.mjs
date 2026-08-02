#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const STRIPE_ACCOUNT_ID = "acct_1TC7ZK72vdHYfMJM";
const PAYOUT = {
  id: "po_1Tz4Ow72vdHYfMJMNMEFjx5A",
  status: "in_transit",
  initiatedOn: "2026-07-31",
  expectedOn: "2026-08-04",
  destinationLastFour: "6970",
  chargeCount: 4,
  gross: 4827.97,
  fee: 141.2,
  net: 4686.77,
};
const SPECS = [
  {
    invoiceNumber: "431865",
    customer: "Carina Stark",
    paymentNumber: "564837",
    receivedOn: "2026-07-23",
    amount: 1441.32,
    paymentId: "pi_3TwMVj72vdHYfMJM0rFciXvI",
    chargeId: "ch_3TwMVj72vdHYfMJM0uOwoVe9",
    customerEmail: "carinastark07@gmail.com",
    fee: 42.1,
    net: 1399.22,
  },
  {
    invoiceNumber: "431681",
    customer: "Elaine Keveney",
    paymentNumber: "567463",
    receivedOn: "2026-07-26",
    amount: 766.71,
    paymentId: "pi_3TxZDz72vdHYfMJM0YZAqSMp",
    chargeId: "ch_3TxZDz72vdHYfMJM0HQ5JMtN",
    customerEmail: "elainekeveney@gmail.com",
    fee: 22.53,
    net: 744.18,
  },
  {
    invoiceNumber: "455713",
    customer: "Corey Parsons",
    paymentNumber: "568048",
    receivedOn: "2026-07-27",
    amount: 2126.7,
    paymentId: "pi_3TxsEj72vdHYfMJM17wfCzLo",
    chargeId: "ch_3TxsEj72vdHYfMJM195AVwxU",
    customerEmail: "corey@cpmt.ca",
    fee: 61.97,
    net: 2064.73,
  },
  {
    invoiceNumber: "471547",
    customer: "Gregg Alexander",
    paymentNumber: "568306",
    receivedOn: "2026-07-27",
    amount: 493.24,
    paymentId: "pi_3TxuxM72vdHYfMJM0MF32Bnc",
    chargeId: "ch_3TxuxM72vdHYfMJM0tyfgZZR",
    customerEmail: "gregg.alexander@rogers.com",
    fee: 14.6,
    net: 478.64,
  },
];

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

assert(
  money(SPECS.reduce((sum, spec) => sum + spec.amount, 0)) === PAYOUT.gross,
  "Stripe charge gross does not equal the payout gross.",
);
assert(
  money(SPECS.reduce((sum, spec) => sum + spec.fee, 0)) === PAYOUT.fee,
  "Stripe charge fees do not equal the payout fees.",
);
assert(
  money(SPECS.reduce((sum, spec) => sum + spec.net, 0)) === PAYOUT.net,
  "Stripe charge net does not equal the payout net.",
);
assert(
  money(PAYOUT.gross - PAYOUT.fee) === PAYOUT.net,
  "Stripe payout gross less fees does not equal its net.",
);

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
  "Refusing evidence update for an unexpected Supabase project.",
);

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const invoices = assertNoError(
  "customer invoices",
  await db
    .from("customer_invoices")
    .select("id,invoice_number,customer_name,currency,accounting_status")
    .in(
      "invoice_number",
      SPECS.map((spec) => spec.invoiceNumber),
    ),
);
assert(invoices.length === SPECS.length, "Expected invoice set changed.");
const invoiceByNumber = new Map(
  invoices.map((invoice) => [invoice.invoice_number, invoice]),
);
const events = assertNoError(
  "customer payment events",
  await db
    .from("customer_invoice_payment_events")
    .select(
      "id,customer_invoice_id,source_system,payment_number,received_on,method,amount,currency,source_payload",
    )
    .in(
      "customer_invoice_id",
      invoices.map((invoice) => invoice.id),
    ),
);

const candidates = SPECS.map((spec) => {
  const invoice = invoiceByNumber.get(spec.invoiceNumber);
  assert(invoice, `Invoice #${spec.invoiceNumber} is missing.`);
  assert(
    invoice.customer_name === spec.customer,
    `Invoice #${spec.invoiceNumber} customer changed.`,
  );
  assert(invoice.currency === "CAD", "Unexpected invoice currency.");
  assert(
    invoice.accounting_status === "active",
    `Invoice #${spec.invoiceNumber} is not active.`,
  );
  const matchingEvents = events.filter(
    (event) =>
      event.customer_invoice_id === invoice.id &&
      event.payment_number === spec.paymentNumber &&
      event.received_on === spec.receivedOn &&
      money(event.amount) === spec.amount,
  );
  assert(
    matchingEvents.length === 1,
    `Stripe payment event for invoice #${spec.invoiceNumber} resolved to ${matchingEvents.length} rows.`,
  );
  const event = matchingEvents[0];
  assert(event.source_system === "dripjobs", "Unexpected payment-event source.");
  assert(event.currency === "CAD", "Unexpected payment-event currency.");
  const paymentEvidence = sourceObject(
    sourceObject(event.source_payload).stripe_payment_evidence,
  );
  assert(
    paymentEvidence.status === "confirmed" &&
      paymentEvidence.payment_id === spec.paymentId,
    `Confirmed Stripe charge evidence is missing for ${spec.customer}.`,
  );
  const payoutEvidence = sourceObject(
    sourceObject(event.source_payload).stripe_payout_evidence,
  );
  const alreadyRecorded =
    payoutEvidence.status === PAYOUT.status &&
    payoutEvidence.payout_id === PAYOUT.id &&
    money(payoutEvidence.charge_gross) === spec.amount &&
    money(payoutEvidence.processor_fee) === spec.fee &&
    money(payoutEvidence.charge_net) === spec.net;
  return { spec, invoice, event, alreadyRecorded };
});

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      evidence_source: "Stripe dashboard payout reconciliation report",
      payout: PAYOUT,
      rows: candidates.map(({ spec, event, alreadyRecorded }) => ({
        customer: spec.customer,
        invoice_number: spec.invoiceNumber,
        payment_event_id: event.id,
        stripe_payment_id: spec.paymentId,
        stripe_charge_id: spec.chargeId,
        gross: spec.amount,
        fee: spec.fee,
        net: spec.net,
        action: alreadyRecorded ? "present" : "record",
      })),
      bank_settlement: {
        status: "awaiting_posted_bank_transaction",
        expected_on: PAYOUT.expectedOn,
        expected_amount: PAYOUT.net,
      },
    },
    null,
    2,
  ),
);

if (!APPLY) process.exit(0);

const now = new Date().toISOString();
let updated = 0;
for (const { spec, event, alreadyRecorded } of candidates) {
  if (alreadyRecorded) continue;
  const sourcePayload = sourceObject(event.source_payload);
  assertNoError(
    `Stripe payout evidence ${spec.paymentId}`,
    await db
      .from("customer_invoice_payment_events")
      .update({
        source_payload: {
          ...sourcePayload,
          stripe_payout_evidence: {
            status: PAYOUT.status,
            provider: "stripe",
            account_id: STRIPE_ACCOUNT_ID,
            payout_id: PAYOUT.id,
            initiated_on: PAYOUT.initiatedOn,
            expected_on: PAYOUT.expectedOn,
            destination_last_four: PAYOUT.destinationLastFour,
            payout_charge_count: PAYOUT.chargeCount,
            payout_gross: PAYOUT.gross,
            payout_fees: PAYOUT.fee,
            payout_net: PAYOUT.net,
            payment_id: spec.paymentId,
            charge_id: spec.chargeId,
            customer_name: spec.customer,
            customer_email: spec.customerEmail,
            charge_gross: spec.amount,
            processor_fee: spec.fee,
            charge_net: spec.net,
            currency: "CAD",
            evidence_source: "stripe_dashboard_payout_reconciliation_report",
            captured_at: now,
          },
        },
      })
      .eq("id", event.id),
  );
  updated += 1;
}

const finalEvents = assertNoError(
  "final Stripe payout evidence",
  await db
    .from("customer_invoice_payment_events")
    .select("id,source_payload")
    .in(
      "id",
      candidates.map(({ event }) => event.id),
    ),
);
for (const { spec, event } of candidates) {
  const stored = finalEvents.find((candidate) => candidate.id === event.id);
  const evidence = sourceObject(
    sourceObject(stored?.source_payload).stripe_payout_evidence,
  );
  assert(
    evidence.status === PAYOUT.status &&
      evidence.payout_id === PAYOUT.id &&
      money(evidence.charge_gross) === spec.amount &&
      money(evidence.processor_fee) === spec.fee &&
      money(evidence.charge_net) === spec.net,
    `Stripe payout evidence for ${spec.customer} was not preserved.`,
  );
}

console.log(
  JSON.stringify(
    {
      applied: true,
      evidence_rows_verified: candidates.length,
      evidence_rows_updated: updated,
      payout_status: PAYOUT.status,
      settlement_status_changed: false,
      next_step: `After ${PAYOUT.expectedOn}, link the posted ${PAYOUT.net.toFixed(2)} bank deposit to payout ${PAYOUT.id}.`,
    },
    null,
    2,
  ),
);
