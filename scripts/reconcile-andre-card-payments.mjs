#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const CONTRACTOR_ID = "b01eded9-6584-4882-91fa-ddf39a45fbfb";
const CONTRACTOR_NAME = "Andre Archambault Handyman Services Inc.";
const CANONICAL_INVOICE_ID = "bacab46c-9aa5-483a-b622-f0578453bfa0";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();

const SUPPORTING_DOCUMENTS = [
  {
    id: "5bf20bba-e842-49ac-a7e8-ce7d930013f9",
    filename: "2026-04-07 - invoice_797 (2).pdf",
    messageId: "19d69566710d8fa9",
    reason:
      "Final Invoice2go payment receipt for invoice #797. It records both Visa 6650 charges and a zero balance; it is evidence for the canonical April 1 invoice, not a second payable.",
  },
  {
    id: "0a4fcdf1-3d2c-4085-900b-9e2e476cda60",
    filename: "2026-04-07 - invoice_797.pdf",
    messageId: "19d68ee937e37e77",
    reason:
      "Updated copy of invoice #797 showing the remaining balance after the first Visa payment. It is a version of the canonical April 1 invoice, not a second payable.",
  },
];

const PAYMENTS = [
  {
    id: "7fb127bb-8ad2-4265-81e1-1b000429e993",
    postedOn: "2026-04-02",
    transactionOn: "2026-04-01",
    amount: 193.78,
    invoiceAmount: 187.86,
    feeAmount: 5.92,
    receiptMessageId: "19d4a443ea316210",
  },
  {
    id: "28685b8f-fd56-4c40-be8a-f39f694c4286",
    postedOn: "2026-04-08",
    transactionOn: "2026-04-07",
    amount: 359.62,
    invoiceAmount: 348.89,
    feeAmount: 10.73,
    receiptMessageId: "19d69566710d8fa9",
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

function sourceObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
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
const paymentIds = PAYMENTS.map((payment) => payment.id);
const invoiceIds = [
  CANONICAL_INVOICE_ID,
  ...SUPPORTING_DOCUMENTS.map((document) => document.id),
];
const [
  contractorResult,
  transactionsResult,
  invoicesResult,
  paymentRecordsResult,
  allocationsResult,
  otherAllocationsResult,
] = await Promise.all([
  db
    .from("labour_contractors")
    .select("id,supplier_name")
    .eq("id", CONTRACTOR_ID)
    .single(),
  db
    .from("financial_transactions")
    .select(
      "id,posted_on,transaction_on,description,counterparty,amount,currency,category,transaction_type,is_transfer,review_status,notes,source_data,financial_accounts(name,last_four)",
    )
    .in("id", paymentIds),
  db
    .from("labour_invoices")
    .select(
      "id,invoice_number,invoice_date,source_date,amount_before_tax,tax_amount,document_type,match_status,original_filename,duplicate_group_id,supporting_invoice_reference,text_excerpt",
    )
    .in("id", invoiceIds),
  db
    .from("labour_payment_records")
    .select(
      "financial_transaction_id,contractor_id,recipient_status,confirmation_method,confirmation_note",
    )
    .in("financial_transaction_id", paymentIds),
  db
    .from("labour_payment_allocations")
    .select(
      "id,financial_transaction_id,invoice_id,allocated_amount,reversed_at",
    )
    .in("financial_transaction_id", paymentIds)
    .is("reversed_at", null),
  db
    .from("labour_payment_other_allocations")
    .select(
      "id,financial_transaction_id,contractor_id,allocation_type,allocated_amount,explanation,reversed_at",
    )
    .in("financial_transaction_id", paymentIds)
    .is("reversed_at", null),
]);
for (const [label, result] of Object.entries({
  contractor: contractorResult,
  transactions: transactionsResult,
  invoices: invoicesResult,
  paymentRecords: paymentRecordsResult,
  allocations: allocationsResult,
  otherAllocations: otherAllocationsResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
assert(
  contractorResult.data.supplier_name === CONTRACTOR_NAME,
  "Andre contractor record no longer matches.",
);
assert(
  transactionsResult.data.length === PAYMENTS.length,
  "One or more Andre card transactions are missing.",
);
assert(
  invoicesResult.data.length === invoiceIds.length,
  "One or more Andre invoice documents are missing.",
);

const invoiceById = new Map(
  invoicesResult.data.map((invoice) => [invoice.id, invoice]),
);
const canonicalInvoice = invoiceById.get(CANONICAL_INVOICE_ID);
assert(
  canonicalInvoice.invoice_number === "797" &&
    canonicalInvoice.invoice_date === "2026-04-01" &&
    cents(canonicalInvoice.amount_before_tax) === 47500 &&
    cents(canonicalInvoice.tax_amount) === 6175 &&
    canonicalInvoice.document_type === "invoice" &&
    canonicalInvoice.duplicate_group_id === "737cc1c61f49b162",
  "Canonical Andre invoice #797 no longer matches the reviewed source.",
);
for (const supporting of SUPPORTING_DOCUMENTS) {
  const invoice = invoiceById.get(supporting.id);
  assert(
    invoice.invoice_number === "797" &&
      invoice.original_filename === supporting.filename &&
      invoice.duplicate_group_id === canonicalInvoice.duplicate_group_id &&
      cents(invoice.amount_before_tax) === 47500 &&
      cents(invoice.tax_amount) === 6175,
    `Andre supporting document ${supporting.filename} no longer matches.`,
  );
}

const transactionById = new Map(
  transactionsResult.data.map((transaction) => [transaction.id, transaction]),
);
const recordById = new Map(
  paymentRecordsResult.data.map((record) => [
    record.financial_transaction_id,
    record,
  ]),
);
const allocationById = new Map(
  allocationsResult.data.map((allocation) => [
    allocation.financial_transaction_id,
    allocation,
  ]),
);
const otherAllocationById = new Map(
  otherAllocationsResult.data.map((allocation) => [
    allocation.financial_transaction_id,
    allocation,
  ]),
);

let supportingUpdates = 0;
let transactionUpdates = 0;
let paymentRecordUpserts = 0;
let invoiceAllocationInserts = 0;
let feeAllocationInserts = 0;
for (const supporting of SUPPORTING_DOCUMENTS) {
  const invoice = invoiceById.get(supporting.id);
  if (
    invoice.document_type !== "payment_receipt" ||
    invoice.match_status !== "supporting_document" ||
    invoice.supporting_invoice_reference !== CANONICAL_INVOICE_ID
  ) {
    supportingUpdates += 1;
  }
}
for (const payment of PAYMENTS) {
  const transaction = transactionById.get(payment.id);
  assert(
    transaction.posted_on === payment.postedOn &&
      transaction.transaction_on === payment.transactionOn &&
      transaction.description === "ARCHAMBAULT HANDYMAN S" &&
      transaction.counterparty === "Archambault Handyman" &&
      cents(transaction.amount) === -cents(payment.amount) &&
      transaction.currency === "CAD" &&
      transaction.transaction_type === "expense" &&
      transaction.is_transfer === false &&
      transaction.financial_accounts?.last_four === "6650",
    `Andre card charge ${payment.id} no longer matches the bank row.`,
  );
  assert(
    cents(payment.invoiceAmount) + cents(payment.feeAmount) ===
      cents(payment.amount),
    `Andre card charge ${payment.id} does not split to its bank amount.`,
  );
  const record = recordById.get(payment.id);
  if (record) {
    assert(
      record.contractor_id === CONTRACTOR_ID &&
        record.recipient_status === "confirmed",
      `Andre card charge ${payment.id} has an unexpected recipient record.`,
    );
  } else {
    paymentRecordUpserts += 1;
  }
  const allocation = allocationById.get(payment.id);
  if (allocation) {
    assert(
      allocation.invoice_id === CANONICAL_INVOICE_ID &&
        cents(allocation.allocated_amount) === cents(payment.invoiceAmount),
      `Andre card charge ${payment.id} has an unexpected invoice allocation.`,
    );
  } else {
    invoiceAllocationInserts += 1;
  }
  const fee = otherAllocationById.get(payment.id);
  if (fee) {
    assert(
      fee.contractor_id === CONTRACTOR_ID &&
        fee.allocation_type === "other" &&
        cents(fee.allocated_amount) === cents(payment.feeAmount),
      `Andre card charge ${payment.id} has an unexpected fee allocation.`,
    );
  } else {
    feeAllocationInserts += 1;
  }
  if (
    transaction.category !== "Subcontractors" ||
    transaction.review_status !== "reconciled"
  ) {
    transactionUpdates += 1;
  }
}

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      supporting_document_updates: supportingUpdates,
      transaction_updates: transactionUpdates,
      payment_record_inserts: paymentRecordUpserts,
      invoice_allocation_inserts: invoiceAllocationInserts,
      fee_allocation_inserts: feeAllocationInserts,
      invoice_principal: 536.75,
      card_fees: 16.65,
      bank_total: 553.4,
    },
    null,
    2,
  ),
);
if (!APPLY) process.exit(0);

for (const supporting of SUPPORTING_DOCUMENTS) {
  const invoice = invoiceById.get(supporting.id);
  const desired = {
    document_type: "payment_receipt",
    match_status: "supporting_document",
    supporting_invoice_reference: CANONICAL_INVOICE_ID,
  };
  if (
    invoice.document_type !== desired.document_type ||
    invoice.match_status !== desired.match_status ||
    invoice.supporting_invoice_reference !==
      desired.supporting_invoice_reference
  ) {
    const update = await db
      .from("labour_invoices")
      .update(desired)
      .eq("id", supporting.id);
    if (update.error) throw update.error;
    await insertAuditEvent(db, {
      entity_type: "invoice",
      entity_id: supporting.id,
      action: "update",
      old_values: {
        document_type: invoice.document_type,
        match_status: invoice.match_status,
        supporting_invoice_reference: invoice.supporting_invoice_reference,
      },
      new_values: {
        ...desired,
        gmail_message_id: supporting.messageId,
      },
      reason: supporting.reason,
      performed_by: ADMIN_USER_ID,
      performed_at: NOW,
    });
  }
}

for (const payment of PAYMENTS) {
  const transaction = transactionById.get(payment.id);
  const record = recordById.get(payment.id);
  const allocation = allocationById.get(payment.id);
  const fee = otherAllocationById.get(payment.id);
  const confirmationNote =
    `Invoice2go receipt Gmail message ${payment.receiptMessageId} confirms ` +
    `$${payment.amount.toFixed(2)} charged to Visa ending 6650 for Andre ` +
    `invoice #797: $${payment.invoiceAmount.toFixed(2)} invoice principal ` +
    `plus $${payment.feeAmount.toFixed(2)} processing fee.`;

  const desiredSourceData = {
    ...sourceObject(transaction.source_data),
    invoice2go_payment_evidence: {
      gmail_message_id: payment.receiptMessageId,
      contractor: CONTRACTOR_NAME,
      invoice_number: "797",
      card_last_four: "6650",
      charged_amount: payment.amount,
      invoice_principal: payment.invoiceAmount,
      processing_fee: payment.feeAmount,
      status: "paid",
    },
  };
  const desiredTransaction = {
    category: "Subcontractors",
    review_status: "reconciled",
    notes: confirmationNote,
    source_data: desiredSourceData,
  };
  if (
    transaction.category !== desiredTransaction.category ||
    transaction.review_status !== desiredTransaction.review_status ||
    transaction.notes !== desiredTransaction.notes ||
    JSON.stringify(transaction.source_data) !==
      JSON.stringify(desiredTransaction.source_data)
  ) {
    const update = await db
      .from("financial_transactions")
      .update(desiredTransaction)
      .eq("id", payment.id);
    if (update.error) throw update.error;
    await insertAuditEvent(db, {
      entity_type: "payment",
      entity_id: payment.id,
      action: "update",
      old_values: {
        category: transaction.category,
        review_status: transaction.review_status,
        notes: transaction.notes,
      },
      new_values: desiredTransaction,
      reason:
        "The Invoice2go receipt and Visa 6650 bank row identify this charge as payment of Andre invoice #797.",
      performed_by: ADMIN_USER_ID,
      performed_at: NOW,
    });
  }

  if (!record) {
    const insertion = await db.from("labour_payment_records").insert({
      financial_transaction_id: payment.id,
      contractor_id: CONTRACTOR_ID,
      recipient_status: "confirmed",
      confirmation_method: "payment_confirmation",
      confirmation_note: confirmationNote,
      confirmed_by: ADMIN_USER_ID,
      confirmed_at: NOW,
      inserted_by: ADMIN_USER_ID,
    });
    if (insertion.error) throw insertion.error;
  }

  if (!allocation) {
    const insertion = await db.from("labour_payment_allocations").insert({
      financial_transaction_id: payment.id,
      invoice_id: CANONICAL_INVOICE_ID,
      allocated_amount: payment.invoiceAmount,
      match_method: [
        "invoice2go_payment_receipt",
        "card_last_four",
        "same_day_amount_component",
        "bank_record",
      ],
      invoice_source_message_id: null,
      payment_confirmation_message_id: payment.receiptMessageId,
      confirmed_by: ADMIN_USER_ID,
      confirmed_at: NOW,
      inserted_by: ADMIN_USER_ID,
      notes: confirmationNote,
    });
    if (insertion.error) throw insertion.error;
  }

  if (!fee) {
    const insertion = await db.from("labour_payment_other_allocations").insert({
      financial_transaction_id: payment.id,
      contractor_id: CONTRACTOR_ID,
      companycam_project_id: null,
      allocation_type: "other",
      allocated_amount: payment.feeAmount,
      explanation: `Invoice2go card processing fee for Andre invoice #797, confirmed by Gmail message ${payment.receiptMessageId}.`,
      inserted_by: ADMIN_USER_ID,
    });
    if (insertion.error) throw insertion.error;
  }

  await insertAuditEvent(db, {
    entity_type: "payment",
    entity_id: payment.id,
    action: "insert",
    old_values: { allocated_amount: 0 },
    new_values: {
      invoice_id: CANONICAL_INVOICE_ID,
      invoice_allocated_amount: payment.invoiceAmount,
      fee_allocated_amount: payment.feeAmount,
      gmail_message_id: payment.receiptMessageId,
    },
    reason: confirmationNote,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const [paymentVerification, invoiceVerification, supportingVerification] =
  await Promise.all([
    db
      .from("labour_payment_verification")
      .select(
        "financial_transaction_id,payment_amount,invoice_allocated_amount,other_allocated_amount,total_allocated_amount,unallocated_amount,payment_status,recipient_status",
      )
      .in("financial_transaction_id", paymentIds),
    db
      .from("labour_invoice_verification")
      .select(
        "invoice_id,invoice_amount,paid_amount,amount_remaining,payment_status",
      )
      .eq("invoice_id", CANONICAL_INVOICE_ID)
      .single(),
    db
      .from("labour_invoices")
      .select("id,document_type,match_status,supporting_invoice_reference")
      .in(
        "id",
        SUPPORTING_DOCUMENTS.map((document) => document.id),
      ),
  ]);
if (paymentVerification.error) throw paymentVerification.error;
if (invoiceVerification.error) throw invoiceVerification.error;
if (supportingVerification.error) throw supportingVerification.error;
assert(
  paymentVerification.data.length === PAYMENTS.length &&
    paymentVerification.data.every(
      (row) =>
        row.recipient_status === "confirmed" &&
        row.payment_status === "fully_allocated" &&
        cents(row.payment_amount) === cents(row.total_allocated_amount) &&
        cents(row.unallocated_amount) === 0,
    ),
  "Andre card payment verification failed.",
);
assert(
  invoiceVerification.data.payment_status === "paid" &&
    cents(invoiceVerification.data.invoice_amount) === 53675 &&
    cents(invoiceVerification.data.paid_amount) === 53675 &&
    cents(invoiceVerification.data.amount_remaining) === 0,
  "Andre invoice #797 did not become fully paid.",
);
assert(
  supportingVerification.data.length === SUPPORTING_DOCUMENTS.length &&
    supportingVerification.data.every(
      (document) =>
        document.document_type === "payment_receipt" &&
        document.match_status === "supporting_document" &&
        document.supporting_invoice_reference === CANONICAL_INVOICE_ID,
    ),
  "Andre supporting documents were not consolidated.",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      canonical_invoice: "797",
      invoice_principal_paid: 536.75,
      card_fees_paid: 16.65,
      bank_total: 553.4,
      duplicate_payables_removed: SUPPORTING_DOCUMENTS.length,
    },
    null,
    2,
  ),
);
