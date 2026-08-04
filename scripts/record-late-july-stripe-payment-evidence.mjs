#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const STRIPE_ACCOUNT_ID = "acct_1TC7ZK72vdHYfMJM";
const SPECS = [
  {
    invoiceNumber: "431865",
    customer: "Carina Stark",
    paymentNumber: "564837",
    receivedOn: "2026-07-23",
    amount: 1441.32,
    paymentId: "pi_3TwMVj72vdHYfMJM0rFciXvI",
    gmailMessageId: "19f8f21d6c03471b",
    customerEmail: "carinastark07@gmail.com",
  },
  {
    invoiceNumber: "469677",
    customer: "Lorraine Ulrick",
    paymentNumber: "563898",
    receivedOn: "2026-07-22",
    amount: 2545.89,
    paymentId: "pi_3Tw26S72vdHYfMJM1Gsr4BNS",
    gmailMessageId: "19f8a747c127fe9d",
    customerEmail: "glulrick63@gmail.com",
  },
  {
    invoiceNumber: "431681",
    customer: "Elaine Keveney",
    paymentNumber: "567463",
    receivedOn: "2026-07-26",
    amount: 766.71,
    paymentId: "pi_3TxZDz72vdHYfMJM0YZAqSMp",
    gmailMessageId: "19fa03fd4da72fdf",
    customerEmail: "elainekeveney@gmail.com",
  },
  {
    invoiceNumber: "455713",
    customer: "Corey Parsons",
    paymentNumber: "568048",
    receivedOn: "2026-07-27",
    amount: 2126.7,
    paymentId: "pi_3TxsEj72vdHYfMJM17wfCzLo",
    gmailMessageId: "19fa49af8e2faaa1",
    customerEmail: "corey@cpmt.ca",
  },
  {
    invoiceNumber: "471547",
    customer: "Gregg Alexander",
    paymentNumber: "568306",
    receivedOn: "2026-07-27",
    amount: 493.24,
    paymentId: "pi_3TxuxM72vdHYfMJM0MF32Bnc",
    gmailMessageId: "19fa53a7fd6a927e",
    customerEmail: "gregg.alexander@rogers.com",
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
const invoiceIds = invoices.map((invoice) => invoice.id);
const events = assertNoError(
  "customer payment events",
  await db
    .from("customer_invoice_payment_events")
    .select(
      "id,customer_invoice_id,source_system,payment_number,received_on,method,amount,currency,source_payload",
    )
    .in("customer_invoice_id", invoiceIds),
);

const candidates = SPECS.map((spec) => {
  const invoice = invoiceByNumber.get(spec.invoiceNumber);
  assert(invoice, `Invoice #${spec.invoiceNumber} is missing.`);
  assert(
    invoice.customer_name === spec.customer,
    `Invoice #${spec.invoiceNumber} customer changed.`,
  );
  assert(
    invoice.currency === "CAD",
    `Invoice #${spec.invoiceNumber} is not CAD.`,
  );
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
  const existingEvidence = sourceObject(
    sourceObject(event.source_payload).stripe_payment_evidence,
  );
  const alreadyRecorded =
    existingEvidence.status === "confirmed" &&
    existingEvidence.payment_id === spec.paymentId &&
    existingEvidence.gmail_message_id === spec.gmailMessageId;
  return { spec, invoice, event, alreadyRecorded };
});

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      evidence_source: "Stripe successful-payment confirmation emails",
      rows: candidates.map(({ spec, event, alreadyRecorded }) => ({
        customer: spec.customer,
        invoice_number: spec.invoiceNumber,
        payment_event_id: event.id,
        amount: spec.amount,
        stripe_payment_id: spec.paymentId,
        gmail_message_id: spec.gmailMessageId,
        action: alreadyRecorded ? "present" : "record",
      })),
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
    `Stripe payment evidence ${spec.paymentId}`,
    await db
      .from("customer_invoice_payment_events")
      .update({
        source_payload: {
          ...sourcePayload,
          stripe_payment_evidence: {
            status: "confirmed",
            provider: "stripe",
            account_id: STRIPE_ACCOUNT_ID,
            payment_id: spec.paymentId,
            gmail_message_id: spec.gmailMessageId,
            customer_name: spec.customer,
            customer_email: spec.customerEmail,
            amount: spec.amount,
            currency: "CAD",
            received_on: spec.receivedOn,
            captured_at: now,
          },
        },
      })
      .eq("id", event.id),
  );
  updated += 1;
}

const finalEvents = assertNoError(
  "final Stripe payment evidence",
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
    sourceObject(stored?.source_payload).stripe_payment_evidence,
  );
  assert(
    evidence.status === "confirmed" &&
      evidence.payment_id === spec.paymentId &&
      evidence.gmail_message_id === spec.gmailMessageId,
    `Stripe evidence for ${spec.customer} was not preserved.`,
  );
}

console.log(
  JSON.stringify(
    {
      applied: true,
      evidence_rows_verified: candidates.length,
      evidence_rows_updated: updated,
      settlement_status_changed: false,
    },
    null,
    2,
  ),
);
