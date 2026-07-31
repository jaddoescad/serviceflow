#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const CONTRACTOR_ID = "4caed611-bb04-4187-9775-7638cab9b3b6";
const INVOICE_MESSAGE_ID = "19d350724dd19e98";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();

const INVOICES = [
  {
    id: "89518d10-0694-447a-8c56-0ea2de1326fc",
    number: "1",
    filename: "invoice1.pdf",
    description: "Front Stairwell Painting — 3791 Canyon Walk Drive",
    sourceText:
      "Physical invoice: Project Address 3791 Canyon Walk Drive; Scope of Work Front Stairwell Painting; Amount and Total Due $3,150.00.",
  },
  {
    id: "81b6eb38-2d96-4469-ab75-50ae9b0993fe",
    number: "2",
    filename: "invoice2.pdf",
    description: "Back Stairwell Painting — 3791 Canyon Walk Drive",
    sourceText:
      "Physical invoice: Project Address 3791 Canyon Walk Drive; Scope of Work Back Stairwell Painting; Amount and Total Due $3,150.00.",
  },
  {
    id: "a44e7b86-d6c0-4d19-aa51-4e1984f0880c",
    number: "3",
    filename: "invoice3.pdf",
    description: "Front Stairwell Painting — 3789 Canyon Walk Drive",
    sourceText:
      "Physical invoice: Project Address 3789 Canyon Walk Drive; Scope of Work Front Stairwell Painting; Amount and Total Due $3,150.00.",
  },
  {
    id: "4e1e5f5f-3ead-4a01-a58a-0fa59d7c42a7",
    number: "4",
    filename: "invoice4.pdf",
    description: "Front Stairwell Painting — 1065 Beryl Private",
    sourceText:
      "Physical invoice: Project Address 1065 Beryl Private; Scope of Work Front Stairwell Painting; Amount and Total Due $3,150.00. Related project correspondence refers to 1067 Beryl Private, so the printed address is retained without silently correcting it.",
  },
];

const PAYMENTS = [
  {
    id: "31101d5e-0c1a-43e6-82b8-e476f1343424",
    postedOn: "2026-03-30",
    description: "SEND E-TFR ***8rF",
    amount: 3000,
    confirmationMessageId: "19d3a94aab3efdf0",
  },
  {
    id: "dd3d007a-5d8f-40ee-9d37-9553f7fd8007",
    postedOn: "2026-04-01",
    description: "SEND E-TFR ***xBj",
    amount: 3000,
    confirmationMessageId: "19d4b34f28915b37",
  },
  {
    id: "ed2b0fb3-8b5f-4eb7-9d78-b22e83d2f0c1",
    postedOn: "2026-04-14",
    description: "SEND E-TFR ***R3q",
    amount: 3000,
    confirmationMessageId: "19d8a342f2f3314d",
  },
  {
    id: "24ff3033-16f8-4267-832d-3217ec07ef7f",
    postedOn: "2026-04-27",
    description: "SEND E-TFR ***7zm",
    amount: 2800,
    confirmationMessageId: "19dd1902eb5ad447",
  },
  {
    id: "7fecc380-de39-4d4e-9ad9-28f78080a5e0",
    postedOn: "2026-05-04",
    description: "SEND E-TFR ***tqR",
    amount: 3000,
    confirmationMessageId: "19df51a1b0913f79",
    noInvoiceResidual: 2200,
  },
];

const FIFO_ALLOCATIONS = [
  [PAYMENTS[0].id, INVOICES[0].id, 3000],
  [PAYMENTS[1].id, INVOICES[0].id, 150],
  [PAYMENTS[1].id, INVOICES[1].id, 2850],
  [PAYMENTS[2].id, INVOICES[1].id, 300],
  [PAYMENTS[2].id, INVOICES[2].id, 2700],
  [PAYMENTS[3].id, INVOICES[2].id, 450],
  [PAYMENTS[3].id, INVOICES[3].id, 2350],
  [PAYMENTS[4].id, INVOICES[3].id, 800],
].map(([financialTransactionId, invoiceId, allocatedAmount]) => ({
  financialTransactionId,
  invoiceId,
  allocatedAmount,
}));

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function sourceObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
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

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl =
  env.SUPABASE_URL ??
  env.NEXT_PUBLIC_SUPABASE_URL ??
  env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
assert(
  projectRef === TARGET_PROJECT_REF,
  `Refusing to use unexpected Supabase project ${projectRef}.`,
);

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const invoiceIds = INVOICES.map((invoice) => invoice.id);
const paymentIds = PAYMENTS.map((payment) => payment.id);
const [invoiceResult, lineResult, transactionResult, recordResult, allocationResult] =
  await Promise.all([
    db
      .from("labour_invoices")
      .select(
        "id,contractor_id,supplier_name,invoice_number,invoice_date,source_date,amount_before_tax,tax_amount,amount_paid,document_type,match_status,original_filename",
      )
      .in("id", invoiceIds),
    db
      .from("labour_invoice_lines")
      .select(
        "id,invoice_id,line_number,entry_type,description,amount_before_tax,tax_amount,source_kind,source_reference,source_text,needs_review",
      )
      .in("invoice_id", invoiceIds),
    db
      .from("financial_transactions")
      .select(
        "id,posted_on,description,counterparty,amount,currency,transaction_type,category,review_status,notes,source_data",
      )
      .in("id", paymentIds),
    db
      .from("labour_payment_records")
      .select(
        "financial_transaction_id,contractor_id,recipient_status,confirmation_note",
      )
      .in("financial_transaction_id", paymentIds),
    db
      .from("labour_payment_allocations")
      .select(
        "id,financial_transaction_id,invoice_id,allocated_amount,reversed_at",
      )
      .in("financial_transaction_id", paymentIds)
      .is("reversed_at", null),
  ]);
for (const [label, result] of Object.entries({
  invoices: invoiceResult,
  lines: lineResult,
  transactions: transactionResult,
  records: recordResult,
  allocations: allocationResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

assert(
  invoiceResult.data.length === INVOICES.length,
  "One or more Youssef invoice records are missing.",
);
assert(
  transactionResult.data.length === PAYMENTS.length,
  "One or more Youssef bank transactions are missing.",
);
assert(
  recordResult.data.length === PAYMENTS.length &&
    recordResult.data.every(
      (record) =>
        record.contractor_id === CONTRACTOR_ID &&
        record.recipient_status === "confirmed",
    ),
  "Youssef recipient verification is incomplete.",
);

const invoiceById = new Map(invoiceResult.data.map((invoice) => [invoice.id, invoice]));
const linesByInvoice = Map.groupBy(lineResult.data, (line) => line.invoice_id);
for (const expected of INVOICES) {
  const invoice = invoiceById.get(expected.id);
  assert(invoice, `Missing invoice #${expected.number}.`);
  assert(
    invoice.contractor_id === CONTRACTOR_ID &&
      invoice.supplier_name === "Youssef Mroueh" &&
      invoice.invoice_number === expected.number &&
      invoice.invoice_date === "2026-03-28" &&
      invoice.source_date === "2026-03-28" &&
      cents(invoice.amount_before_tax) === 315000 &&
      cents(invoice.tax_amount) === 0 &&
      cents(invoice.amount_paid) === 315000 &&
      invoice.document_type === "invoice" &&
      invoice.original_filename.endsWith(expected.filename),
    `Invoice #${expected.number} no longer matches the archived PDF evidence.`,
  );
  const lines = linesByInvoice.get(expected.id) ?? [];
  assert(
    lines.length === 1 &&
      lines[0].line_number === 1 &&
      cents(lines[0].amount_before_tax) === 315000 &&
      ["legacy_invoice_total", "extracted"].includes(lines[0].source_kind),
    `Invoice #${expected.number} entry changed since it was audited.`,
  );
}

const transactionById = new Map(
  transactionResult.data.map((transaction) => [transaction.id, transaction]),
);
for (const expected of PAYMENTS) {
  const transaction = transactionById.get(expected.id);
  assert(transaction, `Missing payment ${expected.description}.`);
  assert(
    transaction.posted_on === expected.postedOn &&
      transaction.description === expected.description &&
      transaction.counterparty === "Youssef Mroueh" &&
      cents(transaction.amount) === -cents(expected.amount) &&
      transaction.currency === "CAD" &&
      transaction.transaction_type === "expense" &&
      transaction.category === "Subcontractors",
    `Payment ${expected.description} changed since recipient verification.`,
  );
}

const existingActiveAllocations = allocationResult.data ?? [];
for (const allocation of existingActiveAllocations) {
  const desired = FIFO_ALLOCATIONS.find(
    (candidate) =>
      candidate.financialTransactionId ===
        allocation.financial_transaction_id &&
      candidate.invoiceId === allocation.invoice_id &&
      cents(candidate.allocatedAmount) === cents(allocation.allocated_amount),
  );
  assert(
    desired,
    `Unexpected active allocation ${allocation.id} blocks FIFO reconciliation.`,
  );
}

const planned = {
  mode: APPLY ? "apply" : "dry-run",
  project_ref: projectRef,
  invoice_message_id: INVOICE_MESSAGE_ID,
  invoices: INVOICES.map((invoice) => ({
    number: invoice.number,
    amount: 3150,
    exact_item: invoice.description,
  })),
  fifo_allocations: FIFO_ALLOCATIONS,
  invoice_total: 12600,
  allocated_payment_total: 12600,
  first_five_payment_total: 14800,
  documented_no_invoice_residual: 2200,
};
console.log(JSON.stringify(planned, null, 2));
if (!APPLY) {
  console.log("Dry run only. Re-run with --apply to write the evidence.");
  process.exit(0);
}

for (const expected of INVOICES) {
  const currentLine = (linesByInvoice.get(expected.id) ?? [])[0];
  const desiredLine = {
    entry_type: "labour",
    description: expected.description,
    service_started_on: null,
    service_ended_on: null,
    quantity: 1,
    unit: "job",
    unit_price: 3150,
    quantity_hours: null,
    hourly_rate: null,
    amount_before_tax: 3150,
    tax_amount: 0,
    is_adjustment: false,
    source_kind: "extracted",
    source_reference: `gmail:${INVOICE_MESSAGE_ID}:${expected.filename}`,
    source_text:
      `${expected.sourceText} Gmail message ${INVOICE_MESSAGE_ID}; ` +
      `attachment ${expected.filename}.`,
    needs_review: false,
  };
  const lineUpdate = await db
    .from("labour_invoice_lines")
    .update(desiredLine)
    .eq("id", currentLine.id)
    .eq("invoice_id", expected.id);
  if (lineUpdate.error) throw lineUpdate.error;

  await insertAuditEvent(db, {
    entity_type: "invoice_line",
    entity_id: currentLine.id,
    action: "update",
    old_values: {
      description: currentLine.description,
      source_kind: currentLine.source_kind,
      needs_review: currentLine.needs_review,
    },
    new_values: desiredLine,
    reason:
      `Extracted the exact project address, scope, and $3,150.00 total from ` +
      `${expected.filename}, submitted by Youssef Mroueh in Gmail message ` +
      `${INVOICE_MESSAGE_ID}.`,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

for (const allocation of FIFO_ALLOCATIONS) {
  const existing = existingActiveAllocations.find(
    (row) =>
      row.financial_transaction_id === allocation.financialTransactionId &&
      row.invoice_id === allocation.invoiceId,
  );
  if (existing) continue;
  const payment = PAYMENTS.find(
    (candidate) => candidate.id === allocation.financialTransactionId,
  );
  const invoice = INVOICES.find(
    (candidate) => candidate.id === allocation.invoiceId,
  );
  const notes =
    `Documented FIFO accounting allocation for Youssef invoice #${invoice.number}. ` +
    `All four $3,150 invoices were submitted together on 2026-03-28, and the ` +
    `recipient-confirmed Youssef payments begin on 2026-03-30. TD/Interac does ` +
    `not print an invoice number, so this allocation records the transparent ` +
    `FIFO rule instead of claiming a direct remittance reference.`;
  const insertion = await db.from("labour_payment_allocations").insert({
    financial_transaction_id: allocation.financialTransactionId,
    invoice_id: allocation.invoiceId,
    allocated_amount: allocation.allocatedAmount,
    match_method: [
      "verified_contractor_identity",
      "gmail_physical_invoice",
      "invoice_submission_precedes_payment",
      "documented_fifo_accounting_allocation",
      "bank_record",
    ],
    invoice_source_message_id: INVOICE_MESSAGE_ID,
    payment_confirmation_message_id: payment.confirmationMessageId,
    confirmed_by: ADMIN_USER_ID,
    confirmed_at: NOW,
    notes,
  });
  if (insertion.error) throw insertion.error;
}

for (const expected of PAYMENTS) {
  const transaction = transactionById.get(expected.id);
  const allocationTotal = FIFO_ALLOCATIONS.filter(
    (allocation) => allocation.financialTransactionId === expected.id,
  ).reduce((total, allocation) => total + Number(allocation.allocatedAmount), 0);
  const residual = expected.amount - allocationTotal;
  assert(
    cents(residual) === cents(expected.noInvoiceResidual ?? 0),
    `Unexpected residual for ${expected.description}.`,
  );
  const sourceData = sourceObject(transaction.source_data);
  const desiredSourceData = {
    ...sourceData,
    reconciliation_research: {
      status:
        residual > 0
          ? "partial_invoice_allocation_with_no_invoice_residual"
          : "invoice_allocated_fifo",
      contractor_id: CONTRACTOR_ID,
      contractor_name: "Youssef Mroueh",
      reviewed_on: "2026-07-31",
      prior_no_invoice_conclusion_superseded: true,
      payment_has_invoice: true,
      invoice_submission_message_id: INVOICE_MESSAGE_ID,
      allocated_amount: allocationTotal,
      no_invoice_residual: residual,
      allocation_method: "documented_fifo",
      evidence_conclusion:
        residual > 0
          ? `$${allocationTotal.toFixed(2)} is allocated to the archived invoices; ` +
            `$${residual.toFixed(2)} remains a documented no-invoice exception.`
          : "The full bank payment is allocated to the four archived invoices by documented FIFO.",
    },
  };
  const desiredNotes =
    residual > 0
      ? `$${allocationTotal.toFixed(2)} allocated by documented FIFO to Youssef ` +
        `invoice #4; $${residual.toFixed(2)} remains without an invoice. Gmail ` +
        `message ${INVOICE_MESSAGE_ID} contains the four source PDFs.`
      : `Fully allocated by documented FIFO to Youssef invoices submitted in ` +
        `Gmail message ${INVOICE_MESSAGE_ID}. TD confirms the recipient but does ` +
        `not identify an invoice number.`;
  const update = await db
    .from("financial_transactions")
    .update({
      review_status: "reconciled",
      notes: desiredNotes,
      source_data: desiredSourceData,
    })
    .eq("id", expected.id);
  if (update.error) throw update.error;

  await insertAuditEvent(db, {
    entity_type: "payment",
    entity_id: expected.id,
    action: "update",
    old_values: {
      review_status: transaction.review_status,
      notes: transaction.notes,
      reconciliation_research: sourceData.reconciliation_research ?? null,
    },
    new_values: {
      review_status: "reconciled",
      notes: desiredNotes,
      reconciliation_research: desiredSourceData.reconciliation_research,
    },
    reason:
      `The prior no-invoice conclusion was superseded after locating Gmail ` +
      `message ${INVOICE_MESSAGE_ID} with Youssef invoices #1–#4. Payment was ` +
      `allocated using a documented FIFO rule; no direct invoice number appears ` +
      `on the TD/Interac confirmation.${residual > 0 ? ` $${residual.toFixed(2)} remains an explicit no-invoice residual.` : ""}`,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const [invoiceVerification, paymentVerification, finalLines, finalAllocations] =
  await Promise.all([
    db
      .from("labour_invoice_verification")
      .select(
        "invoice_id,invoice_amount,paid_amount,amount_remaining,payment_status,verification_status",
      )
      .in("invoice_id", invoiceIds),
    db
      .from("labour_payment_verification")
      .select(
        "financial_transaction_id,payment_amount,total_allocated_amount,unallocated_amount,payment_status",
      )
      .in("financial_transaction_id", paymentIds),
    db
      .from("labour_invoice_lines")
      .select(
        "invoice_id,description,amount_before_tax,source_kind,needs_review",
      )
      .in("invoice_id", invoiceIds),
    db
      .from("labour_payment_allocations")
      .select(
        "financial_transaction_id,invoice_id,allocated_amount,reversed_at",
      )
      .in("financial_transaction_id", paymentIds)
      .is("reversed_at", null),
  ]);
for (const [label, result] of Object.entries({
  invoiceVerification,
  paymentVerification,
  finalLines,
  finalAllocations,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

assert(
  finalLines.data.length === 4 &&
    finalLines.data.every(
      (line) =>
        line.source_kind === "extracted" &&
        line.needs_review === false &&
        cents(line.amount_before_tax) === 315000,
    ),
  "Youssef physical invoice item verification failed.",
);
assert(
  finalAllocations.data.length === FIFO_ALLOCATIONS.length &&
    cents(
      finalAllocations.data.reduce(
        (total, allocation) => total + Number(allocation.allocated_amount),
        0,
      ),
    ) === 1260000,
  "Youssef FIFO payment allocation verification failed.",
);
assert(
  invoiceVerification.data.length === 4 &&
    invoiceVerification.data.every(
      (invoice) =>
        cents(invoice.invoice_amount) === 315000 &&
        cents(invoice.paid_amount) === 315000 &&
        cents(invoice.amount_remaining) === 0 &&
        invoice.payment_status === "paid",
    ),
  "Youssef invoices did not recalculate to paid.",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      invoices: invoiceVerification.data,
      payments: paymentVerification.data,
      active_allocations: finalAllocations.data,
    },
    null,
    2,
  ),
);
