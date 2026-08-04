#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();

const MATCHES = [
  {
    contractor: {
      id: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
      name: "Polaris Painters",
    },
    payment: {
      id: "63a2235b-2582-4fb9-bc61-af17e3dc4026",
      date: "2026-02-17",
      description: "SEND E-TFR *vgP EPAY",
      amount: 180,
      confirmationMessageId: "19c671a49d473116",
    },
    invoice: {
      id: "d6b60fff-bc60-41e7-a61d-6d5bac366304",
      number: "56",
      date: "2026-02-12",
      amount: 180,
    },
    methods: [
      "verified_contractor_identity",
      "unique_exact_invoice_total",
      "invoice_precedes_payment",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Exact $180.00 Polaris invoice and payment. TD confirmation email 19c671a49d473116 confirms Polaris Painting Ottawa accepted the transfer.",
  },
  {
    contractor: {
      id: "a30d8df6-8f46-4069-b4af-6061c43b1cd6",
      name: "Phillip Hyde",
    },
    payment: {
      id: "63877ca6-8b92-4ede-8c5c-548200b57dc5",
      date: "2025-07-23",
      description: "SEND E-TFR ***EjP",
      amount: 2574,
      confirmationMessageId: null,
    },
    invoice: {
      id: "c4ee3621-56f5-4f52-a88b-a088ed9e2e2f",
      number: "FILE-1EC137DDC9A7",
      date: "2025-07-23",
      amount: 2574,
      desiredSupplierName: "Phillip Hyde",
      desiredContractorId: "a30d8df6-8f46-4069-b4af-6061c43b1cd6",
      expectedContact: "phil.hyde33@gmail.com",
    },
    methods: [
      "invoice_contact_email_exact",
      "verified_contractor_identity",
      "same_day_exact_amount",
      "unique_exact_invoice_total",
      "bank_record",
    ],
    note: "The same-day $2,574.00 debit note contains phil.hyde33@gmail.com and exactly equals the confirmed Phil Hyde bank payment.",
  },
];

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
const contractorIds = MATCHES.map((match) => match.contractor.id);
const paymentIds = MATCHES.map((match) => match.payment.id);
const invoiceIds = MATCHES.map((match) => match.invoice.id);
const [
  contractorsResult,
  paymentsResult,
  paymentRecordsResult,
  invoicesResult,
  allocationsResult,
] = await Promise.all([
  db
    .from("labour_contractors")
    .select("id,supplier_name")
    .in("id", contractorIds),
  db
    .from("financial_transactions")
    .select(
      "id,posted_on,description,counterparty,amount,currency,transaction_type,category,is_transfer,review_status",
    )
    .in("id", paymentIds),
  db
    .from("labour_payment_records")
    .select(
      "financial_transaction_id,contractor_id,recipient_status,confirmation_note",
    )
    .in("financial_transaction_id", paymentIds),
  db
    .from("labour_invoices")
    .select(
      "id,contractor_id,supplier_name,invoice_number,invoice_date,amount_before_tax,tax_amount,document_type,match_status,text_excerpt",
    )
    .in("id", invoiceIds),
  db
    .from("labour_payment_allocations")
    .select(
      "id,financial_transaction_id,invoice_id,allocated_amount,reversed_at",
    )
    .in("financial_transaction_id", paymentIds)
    .is("reversed_at", null),
]);
for (const [label, result] of Object.entries({
  contractors: contractorsResult,
  payments: paymentsResult,
  paymentRecords: paymentRecordsResult,
  invoices: invoicesResult,
  allocations: allocationsResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
assert(
  contractorsResult.data.length === MATCHES.length,
  "One or more reviewed contractors are missing.",
);
assert(
  paymentsResult.data.length === MATCHES.length,
  "One or more reviewed payments are missing.",
);
assert(
  paymentRecordsResult.data.length === MATCHES.length,
  "One or more recipient records are missing.",
);
assert(
  invoicesResult.data.length === MATCHES.length,
  "One or more reviewed invoices are missing.",
);

const contractorById = new Map(
  contractorsResult.data.map((contractor) => [contractor.id, contractor]),
);
const paymentById = new Map(
  paymentsResult.data.map((payment) => [payment.id, payment]),
);
const paymentRecordById = new Map(
  paymentRecordsResult.data.map((record) => [
    record.financial_transaction_id,
    record,
  ]),
);
const invoiceById = new Map(
  invoicesResult.data.map((invoice) => [invoice.id, invoice]),
);
const allocationByPaymentId = new Map(
  allocationsResult.data.map((allocation) => [
    allocation.financial_transaction_id,
    allocation,
  ]),
);

let invoiceUpdates = 0;
let allocationInserts = 0;
let paymentUpdates = 0;
for (const match of MATCHES) {
  const contractor = contractorById.get(match.contractor.id);
  const payment = paymentById.get(match.payment.id);
  const paymentRecord = paymentRecordById.get(match.payment.id);
  const invoice = invoiceById.get(match.invoice.id);
  const allocation = allocationByPaymentId.get(match.payment.id);

  assert(
    contractor?.supplier_name === match.contractor.name,
    `Contractor ${match.contractor.id} no longer matches ${match.contractor.name}.`,
  );
  assert(
    payment.posted_on === match.payment.date &&
      payment.description === match.payment.description &&
      cents(payment.amount) === -cents(match.payment.amount) &&
      payment.currency === "CAD" &&
      payment.transaction_type === "expense" &&
      payment.category === "Subcontractors" &&
      payment.is_transfer === false,
    `Payment ${match.payment.description} no longer matches the reviewed bank row.`,
  );
  assert(
    paymentRecord.contractor_id === match.contractor.id &&
      paymentRecord.recipient_status === "confirmed",
    `Payment ${match.payment.description} lacks confirmed recipient evidence.`,
  );
  assert(
    invoice.invoice_number === match.invoice.number &&
      invoice.invoice_date === match.invoice.date &&
      invoice.document_type === "invoice" &&
      cents(gross(invoice)) === cents(match.invoice.amount),
    `Invoice ${match.invoice.number} no longer matches the reviewed source.`,
  );
  if (match.invoice.expectedContact) {
    assert(
      invoice.text_excerpt
        ?.toLowerCase()
        .includes(match.invoice.expectedContact.toLowerCase()),
      `Invoice ${match.invoice.number} no longer contains the reviewed contractor contact.`,
    );
  }
  if (allocation) {
    assert(
      allocation.invoice_id === match.invoice.id &&
        cents(allocation.allocated_amount) === cents(match.invoice.amount),
      `Payment ${match.payment.description} has an unexpected allocation.`,
    );
  } else {
    allocationInserts += 1;
  }
  if (
    match.invoice.desiredSupplierName &&
    (invoice.supplier_name !== match.invoice.desiredSupplierName ||
      invoice.contractor_id !== match.invoice.desiredContractorId)
  ) {
    assert(
      invoice.supplier_name === "Unknown supplier",
      "Refusing to overwrite a non-placeholder invoice supplier.",
    );
    invoiceUpdates += 1;
  } else {
    assert(
      invoice.contractor_id === match.contractor.id,
      `Invoice ${match.invoice.number} belongs to an unexpected contractor.`,
    );
  }
  if (payment.review_status !== "reconciled") paymentUpdates += 1;
}

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      exact_matches: MATCHES.length,
      invoice_identity_updates: invoiceUpdates,
      allocation_inserts: allocationInserts,
      payment_status_updates: paymentUpdates,
      total_matched: MATCHES.reduce(
        (total, match) => total + match.invoice.amount,
        0,
      ),
    },
    null,
    2,
  ),
);
if (!APPLY) process.exit(0);

for (const match of MATCHES) {
  const payment = paymentById.get(match.payment.id);
  const invoice = invoiceById.get(match.invoice.id);
  const allocation = allocationByPaymentId.get(match.payment.id);

  if (
    match.invoice.desiredSupplierName &&
    (invoice.supplier_name !== match.invoice.desiredSupplierName ||
      invoice.contractor_id !== match.invoice.desiredContractorId)
  ) {
    const desired = {
      supplier_name: match.invoice.desiredSupplierName,
      contractor_id: match.invoice.desiredContractorId,
    };
    const update = await db
      .from("labour_invoices")
      .update(desired)
      .eq("id", invoice.id);
    if (update.error) throw update.error;
    await insertAuditEvent(db, {
      entity_type: "invoice",
      entity_id: invoice.id,
      action: "update",
      old_values: {
        supplier_name: invoice.supplier_name,
        contractor_id: invoice.contractor_id,
      },
      new_values: desired,
      reason:
        "Invoice contact email phil.hyde33@gmail.com identifies the supplier as Phillip Hyde.",
      performed_by: ADMIN_USER_ID,
      performed_at: NOW,
    });
  }

  if (!allocation) {
    const insertion = await db.from("labour_payment_allocations").insert({
      financial_transaction_id: match.payment.id,
      invoice_id: match.invoice.id,
      allocated_amount: match.invoice.amount,
      match_method: match.methods,
      invoice_source_message_id: null,
      payment_confirmation_message_id:
        match.payment.confirmationMessageId ?? null,
      confirmed_by: ADMIN_USER_ID,
      confirmed_at: NOW,
      notes:
        `${match.note} Allocated $${match.invoice.amount.toFixed(2)} ` +
        `to invoice #${match.invoice.number}.`,
    });
    if (insertion.error) throw insertion.error;
  }
  await insertAuditEvent(db, {
    entity_type: "payment",
    entity_id: match.payment.id,
    action: "insert",
    old_values: { invoice_id: null, allocated_amount: 0 },
    new_values: {
      invoice_id: match.invoice.id,
      allocated_amount: match.invoice.amount,
      match_method: match.methods,
    },
    reason: match.note,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });

  if (payment.review_status !== "reconciled") {
    const update = await db
      .from("financial_transactions")
      .update({ review_status: "reconciled" })
      .eq("id", payment.id);
    if (update.error) throw update.error;
  }
}

const [paymentVerification, invoiceVerification] = await Promise.all([
  db
    .from("labour_payment_verification")
    .select(
      "financial_transaction_id,payment_amount,total_allocated_amount,unallocated_amount,payment_status",
    )
    .in("financial_transaction_id", paymentIds),
  db
    .from("labour_invoice_verification")
    .select(
      "invoice_id,contractor_id,supplier_name,invoice_amount,paid_amount,amount_remaining,payment_status",
    )
    .in("invoice_id", invoiceIds),
]);
if (paymentVerification.error) throw paymentVerification.error;
if (invoiceVerification.error) throw invoiceVerification.error;
assert(
  paymentVerification.data.length === MATCHES.length &&
    paymentVerification.data.every(
      (row) =>
        row.payment_status === "fully_allocated" &&
        cents(row.unallocated_amount) === 0 &&
        cents(row.payment_amount) === cents(row.total_allocated_amount),
    ),
  "Post-apply payment verification failed.",
);
assert(
  invoiceVerification.data.length === MATCHES.length &&
    invoiceVerification.data.every(
      (row) =>
        row.payment_status === "paid" &&
        cents(row.amount_remaining) === 0 &&
        cents(row.invoice_amount) === cents(row.paid_amount),
    ),
  "Post-apply invoice verification failed.",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      payments_fully_allocated: paymentVerification.data.length,
      invoices_fully_paid: invoiceVerification.data.length,
      total_matched: MATCHES.reduce(
        (total, match) => total + match.invoice.amount,
        0,
      ),
    },
    null,
    2,
  ),
);
