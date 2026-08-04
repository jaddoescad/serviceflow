#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const CONTRACTOR_ID = "4b5d875c-11da-4d30-8a47-ef5039bab014";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();

const INVOICES = [
  {
    id: "083fe4ae-5409-4ab1-b560-6aef0a2f5991",
    number: "FM-149",
    date: "2026-03-21",
    amount: 7232.19,
    expectedPaid: 7032.19,
    messageId: "19d124562e182ecf",
  },
  {
    id: "e88f0338-9b36-4d66-b23a-4e9cf8078f87",
    number: "FM-160",
    date: "2026-05-01",
    amount: 2034,
    expectedPaid: 2034,
    messageId: "19de50131ef7a3b4",
  },
  {
    id: "b2810f58-154d-4ec2-9a01-480f417522cb",
    number: "FM-161",
    date: "2026-05-01",
    amount: 1073.5,
    expectedPaid: 1073.5,
    messageId: "19de50267a3af657",
  },
  {
    id: "93cb9825-7164-43c7-bb34-c7c869e7495d",
    number: "FM-162",
    date: "2026-05-04",
    amount: 118.65,
    expectedPaid: 118.65,
    messageId: "19df39a931c1792b",
  },
  {
    id: "52e2da99-e0fd-4c9a-a0f4-cc7c3eac46b1",
    number: "FM-165",
    date: "2026-05-15",
    amount: 3758.47,
    expectedPaid: 3758.47,
    messageId: "19e2ccbd6f8db787",
    expectedCategory: "General overhead",
    allowContractorBackfill: true,
  },
];

const PAYMENTS = [
  {
    id: "6a60a7b5-1324-4361-aadc-6fbd162b547f",
    postedOn: "2026-03-24",
    sentOn: "2026-03-24",
    description: "SEND E-TFR ***FrV",
    suffix: "FrV",
    amount: 3000,
    desiredCategory: "Subcontractors",
    allocations: [{ invoiceNumber: "FM-149", amount: 3000 }],
    matchSummary: "First partial payment toward FM-149.",
  },
  {
    id: "c8fbfee4-b4b0-4430-b97c-37f7cbb3f650",
    postedOn: "2026-03-30",
    sentOn: "2026-03-28",
    description: "SEND E-TFR ***35F",
    suffix: "35F",
    amount: 4032.19,
    desiredCategory: "Subcontractors",
    allocations: [{ invoiceNumber: "FM-149", amount: 4032.19 }],
    matchSummary:
      "Second partial payment; together with FrV it pays $7,032.19 and leaves $200.00 unpaid on FM-149.",
  },
  {
    id: "f39b11a6-9a11-48e1-95cc-32f19f33734d",
    postedOn: "2026-05-04",
    sentOn: "2026-05-04",
    description: "SEND E-TFR ***BK5",
    suffix: "BK5",
    amount: 3226.15,
    desiredCategory: "Subcontractors",
    allocations: [
      { invoiceNumber: "FM-160", amount: 2034 },
      { invoiceNumber: "FM-161", amount: 1073.5 },
      { invoiceNumber: "FM-162", amount: 118.65 },
    ],
    matchSummary:
      "Unique same-recipient invoice group: FM-160 + FM-161 + FM-162 equals the transfer exactly.",
  },
  {
    id: "876cd780-cda1-48e8-b674-e0355dc8ef19",
    postedOn: "2026-05-15",
    sentOn: "2026-05-15",
    description: "SEND E-TFR ***jEY",
    suffix: "jEY",
    amount: 3758.47,
    desiredCategory: "General overhead",
    allocations: [{ invoiceNumber: "FM-165", amount: 3758.47 }],
    matchSummary:
      "Exact same-day payment of Premium Coat operations invoice FM-165; retained as General overhead.",
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

function sourceObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value;
}

function changed(current, desired) {
  return Object.entries(desired).some(
    ([key, value]) =>
      JSON.stringify(canonicalJson(current[key])) !==
      JSON.stringify(canonicalJson(value)),
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
const paymentIds = PAYMENTS.map((payment) => payment.id);
const invoiceIds = INVOICES.map((invoice) => invoice.id);
const [
  contractorResult,
  transactionsResult,
  recordsResult,
  invoicesResult,
  allocationsResult,
] = await Promise.all([
  db
    .from("labour_contractors")
    .select("id,supplier_name")
    .eq("id", CONTRACTOR_ID)
    .single(),
  db
    .from("financial_transactions")
    .select(
      "id,posted_on,description,counterparty,amount,currency,transaction_type,category,is_transfer,review_status,notes,source_data",
    )
    .in("id", paymentIds),
  db
    .from("labour_payment_records")
    .select(
      "financial_transaction_id,contractor_id,recipient_status,confirmation_method,confirmation_note",
    )
    .in("financial_transaction_id", paymentIds),
  db
    .from("labour_invoices")
    .select(
      "id,contractor_id,supplier_name,invoice_number,invoice_date,amount_before_tax,tax_amount,currency,document_type,match_status,text_excerpt",
    )
    .in("id", invoiceIds),
  db
    .from("labour_payment_allocations")
    .select(
      "id,financial_transaction_id,invoice_id,allocated_amount,notes,reversed_at",
    )
    .in("financial_transaction_id", paymentIds)
    .is("reversed_at", null),
]);
for (const [label, result] of Object.entries({
  contractor: contractorResult,
  transactions: transactionsResult,
  records: recordsResult,
  invoices: invoicesResult,
  allocations: allocationsResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

assert(
  contractorResult.data.supplier_name === "Premium Coat",
  "Premium Coat contractor identity changed.",
);
assert(
  transactionsResult.data.length === PAYMENTS.length,
  "One or more Premium Coat payment rows are missing.",
);
assert(
  invoicesResult.data.length === INVOICES.length,
  "One or more Premium Coat invoices are missing.",
);

const transactionById = new Map(
  transactionsResult.data.map((transaction) => [transaction.id, transaction]),
);
const recordById = new Map(
  recordsResult.data.map((record) => [record.financial_transaction_id, record]),
);
const invoiceById = new Map(
  invoicesResult.data.map((invoice) => [invoice.id, invoice]),
);
const expectedInvoiceByNumber = new Map(
  INVOICES.map((invoice) => [invoice.number, invoice]),
);
const storedInvoiceByNumber = new Map(
  invoicesResult.data.map((invoice) => [invoice.invoice_number, invoice]),
);
const allocationsByPaymentId = new Map();
for (const allocation of allocationsResult.data) {
  const values =
    allocationsByPaymentId.get(allocation.financial_transaction_id) ?? [];
  values.push(allocation);
  allocationsByPaymentId.set(allocation.financial_transaction_id, values);
}

let invoiceIdentityUpdates = 0;
for (const expected of INVOICES) {
  const invoice = invoiceById.get(expected.id);
  assert(invoice, `Missing invoice ${expected.number}.`);
  assert(
    invoice.supplier_name === "Premium Coat" &&
      invoice.invoice_number === expected.number &&
      invoice.invoice_date === expected.date &&
      invoice.currency === "CAD" &&
      invoice.document_type === "invoice" &&
      cents(gross(invoice)) === cents(expected.amount) &&
      invoice.text_excerpt?.includes("payments@premiumcoat.ca"),
    `Invoice ${expected.number} no longer matches the reviewed source.`,
  );
  if (expected.allowContractorBackfill) {
    assert(
      invoice.contractor_id == null || invoice.contractor_id === CONTRACTOR_ID,
      `Invoice ${expected.number} belongs to another contractor.`,
    );
    if (invoice.contractor_id !== CONTRACTOR_ID) invoiceIdentityUpdates += 1;
  } else {
    assert(
      invoice.contractor_id === CONTRACTOR_ID,
      `Invoice ${expected.number} lost its Premium Coat identity.`,
    );
  }
}

let paymentUpdates = 0;
let paymentRecordInserts = 0;
let allocationInserts = 0;
let allocationNoteUpdates = 0;
const planned = PAYMENTS.map((payment) => {
  const transaction = transactionById.get(payment.id);
  const record = recordById.get(payment.id);
  const activeAllocations = allocationsByPaymentId.get(payment.id) ?? [];
  assert(transaction, `Missing bank payment ${payment.suffix}.`);
  assert(
    transaction.posted_on === payment.postedOn &&
      transaction.description === payment.description &&
      transaction.counterparty === "15337810 Canada Inc." &&
      cents(transaction.amount) === -cents(payment.amount) &&
      transaction.currency === "CAD" &&
      transaction.transaction_type === "expense" &&
      transaction.is_transfer === false &&
      ["General overhead", "Subcontractors"].includes(transaction.category),
    `Payment ${payment.suffix} no longer matches the reviewed bank row.`,
  );
  assert(
    cents(
      payment.allocations.reduce(
        (sum, allocation) => sum + allocation.amount,
        0,
      ),
    ) === cents(payment.amount),
    `Planned allocations for ${payment.suffix} do not equal the bank payment.`,
  );
  assert(
    activeAllocations.every((allocation) =>
      payment.allocations.some(
        (expectedAllocation) =>
          allocation.invoice_id ===
            expectedInvoiceByNumber.get(expectedAllocation.invoiceNumber)?.id &&
          cents(allocation.allocated_amount) ===
            cents(expectedAllocation.amount),
      ),
    ),
    `Payment ${payment.suffix} has an unexpected active allocation.`,
  );
  allocationInserts += payment.allocations.filter(
    (expectedAllocation) =>
      !activeAllocations.some(
        (allocation) =>
          allocation.invoice_id ===
          expectedInvoiceByNumber.get(expectedAllocation.invoiceNumber)?.id,
      ),
  ).length;

  if (record) {
    assert(
      record.contractor_id === CONTRACTOR_ID &&
        record.recipient_status === "confirmed",
      `Payment ${payment.suffix} has an unexpected recipient record.`,
    );
  } else {
    paymentRecordInserts += 1;
  }

  const sourceData = sourceObject(transaction.source_data);
  const confirmationNote =
    `TD EasyWeb: ${payment.sentOn}, $${payment.amount.toFixed(2)}, Francisco ` +
    `Premium Coat <payments@premiumcoat.ca>, confirmation ${payment.suffix}, ` +
    `Autodeposited. ${payment.matchSummary}`;
  const desiredTransaction = {
    category: payment.desiredCategory,
    review_status: "reconciled",
    notes: confirmationNote,
    source_data: {
      ...sourceData,
      easyweb_e_transfer_evidence: {
        amount: payment.amount,
        source: "TD EasyWeb e-transfer history reviewed 2026-07-30",
        status: "Autodeposited",
        sent_on: payment.sentOn,
        match_method: "confirmation_suffix_amount_date",
        bank_posted_on: payment.postedOn,
        recipient_name: "Francisco Premium Coat",
        recipient_email: "payments@premiumcoat.ca",
        confirmation_suffix: payment.suffix,
      },
    },
  };
  if (changed(transaction, desiredTransaction)) paymentUpdates += 1;
  for (const expectedAllocation of payment.allocations) {
    const expectedInvoice = expectedInvoiceByNumber.get(
      expectedAllocation.invoiceNumber,
    );
    const active = activeAllocations.find(
      (allocation) => allocation.invoice_id === expectedInvoice?.id,
    );
    const desiredAllocationNote =
      `${confirmationNote} Allocated $${expectedAllocation.amount.toFixed(2)} ` +
      `to invoice #${expectedInvoice?.number}.`;
    if (active && active.notes !== desiredAllocationNote) {
      allocationNoteUpdates += 1;
    }
  }
  return {
    payment,
    transaction,
    record,
    activeAllocations,
    confirmationNote,
    desiredTransaction,
  };
});

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      payments: PAYMENTS.length,
      invoices: INVOICES.length,
      payment_updates: paymentUpdates,
      payment_record_inserts: paymentRecordInserts,
      allocation_inserts: allocationInserts,
      allocation_note_updates: allocationNoteUpdates,
      invoice_identity_updates: invoiceIdentityUpdates,
      total_matched: PAYMENTS.reduce((sum, payment) => sum + payment.amount, 0),
    },
    null,
    2,
  ),
);
if (!APPLY) process.exit(0);

for (const expected of INVOICES) {
  const invoice = invoiceById.get(expected.id);
  if (
    !expected.allowContractorBackfill ||
    invoice.contractor_id === CONTRACTOR_ID
  ) {
    continue;
  }
  const update = await db
    .from("labour_invoices")
    .update({ contractor_id: CONTRACTOR_ID })
    .eq("id", invoice.id);
  if (update.error) throw update.error;
  await insertAuditEvent(db, {
    entity_type: "invoice",
    entity_id: invoice.id,
    action: "update",
    old_values: { contractor_id: invoice.contractor_id },
    new_values: { contractor_id: CONTRACTOR_ID },
    reason:
      `Invoice #${expected.number} names Premium Coat, legal company 15337810 ` +
      "Canada Inc., and the same payments@premiumcoat.ca remittance address as EasyWeb.",
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

for (const {
  payment,
  transaction,
  record,
  activeAllocations,
  confirmationNote,
  desiredTransaction,
} of planned) {
  if (changed(transaction, desiredTransaction)) {
    const oldValues = Object.fromEntries(
      Object.keys(desiredTransaction).map((key) => [key, transaction[key]]),
    );
    const update = await db
      .from("financial_transactions")
      .update(desiredTransaction)
      .eq("id", transaction.id);
    if (update.error) throw update.error;
    await insertAuditEvent(db, {
      entity_type: "payment",
      entity_id: transaction.id,
      action: "update",
      old_values: oldValues,
      new_values: desiredTransaction,
      reason: `Verified Premium Coat payment ${payment.suffix}. ${payment.matchSummary}`,
      performed_by: ADMIN_USER_ID,
      performed_at: NOW,
    });
  }

  if (!record) {
    const insertion = await db.from("labour_payment_records").insert({
      financial_transaction_id: payment.id,
      contractor_id: CONTRACTOR_ID,
      recipient_status: "confirmed",
      confirmation_method: "bank_record",
      confirmation_note: confirmationNote,
      confirmed_by: ADMIN_USER_ID,
      confirmed_at: NOW,
      inserted_by: ADMIN_USER_ID,
    });
    if (insertion.error) throw insertion.error;
  }

  for (const expectedAllocation of payment.allocations) {
    const expectedInvoice = expectedInvoiceByNumber.get(
      expectedAllocation.invoiceNumber,
    );
    const storedInvoice = storedInvoiceByNumber.get(
      expectedAllocation.invoiceNumber,
    );
    assert(
      expectedInvoice && storedInvoice,
      `Missing allocation invoice ${expectedAllocation.invoiceNumber}.`,
    );
    if (
      activeAllocations.some(
        (allocation) => allocation.invoice_id === expectedInvoice.id,
      )
    ) {
      const active = activeAllocations.find(
        (allocation) => allocation.invoice_id === expectedInvoice.id,
      );
      const desiredNote =
        `${confirmationNote} Allocated $${expectedAllocation.amount.toFixed(2)} ` +
        `to invoice #${expectedInvoice.number}.`;
      if (active.notes !== desiredNote) {
        const reversalReason =
          "Corrected the FM-149 arithmetic in the allocation evidence: FrV plus 35F pays $7,032.19 and leaves $200.00 outstanding.";
        const reversal = await db
          .from("labour_payment_allocations")
          .update({
            reversed_at: NOW,
            reversed_by: ADMIN_USER_ID,
            reversal_reason: reversalReason,
          })
          .eq("id", active.id)
          .is("reversed_at", null);
        if (reversal.error) throw reversal.error;

        const replacement = await db.from("labour_payment_allocations").insert({
          financial_transaction_id: payment.id,
          invoice_id: expectedInvoice.id,
          allocated_amount: expectedAllocation.amount,
          match_method: [
            "legal_company_name",
            "easyweb_recipient_email",
            "invoice_remittance_email",
            "split_payment_component",
            "bank_record",
          ],
          invoice_source_message_id: expectedInvoice.messageId,
          payment_confirmation_message_id: null,
          confirmed_by: ADMIN_USER_ID,
          confirmed_at: NOW,
          inserted_by: ADMIN_USER_ID,
          notes: desiredNote,
        });
        if (replacement.error) throw replacement.error;
        await insertAuditEvent(db, {
          entity_type: "invoice_payment",
          entity_id: active.id,
          action: "reverse",
          old_values: { reversed_at: null, notes: active.notes },
          new_values: {
            reversed_at: NOW,
            reversed_by: ADMIN_USER_ID,
            reversal_reason: reversalReason,
            replacement_notes: desiredNote,
          },
          reason: reversalReason,
          performed_by: ADMIN_USER_ID,
          performed_at: NOW,
        });
      }
      continue;
    }
    const insertion = await db.from("labour_payment_allocations").insert({
      financial_transaction_id: payment.id,
      invoice_id: expectedInvoice.id,
      allocated_amount: expectedAllocation.amount,
      match_method: [
        "legal_company_name",
        "easyweb_recipient_email",
        "invoice_remittance_email",
        payment.allocations.length > 1
          ? "unique_exact_invoice_sum"
          : expectedAllocation.amount < expectedInvoice.amount
            ? "split_payment_component"
            : "unique_exact_invoice_total",
        "bank_record",
      ],
      invoice_source_message_id: expectedInvoice.messageId,
      payment_confirmation_message_id: null,
      confirmed_by: ADMIN_USER_ID,
      confirmed_at: NOW,
      inserted_by: ADMIN_USER_ID,
      notes:
        `${confirmationNote} Allocated $${expectedAllocation.amount.toFixed(2)} ` +
        `to invoice #${expectedInvoice.number}.`,
    });
    if (insertion.error) throw insertion.error;
  }
  await insertAuditEvent(db, {
    entity_type: "payment",
    entity_id: payment.id,
    action: "insert",
    old_values: { invoice_allocated_amount: 0 },
    new_values: {
      invoice_allocated_amount: payment.amount,
      allocations: payment.allocations,
    },
    reason: `Allocated Premium Coat payment ${payment.suffix}. ${payment.matchSummary}`,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const [paymentVerification, invoiceVerification] = await Promise.all([
  db
    .from("labour_payment_verification")
    .select(
      "financial_transaction_id,contractor_id,recipient_status,payment_amount,total_allocated_amount,unallocated_amount,payment_status",
    )
    .in("financial_transaction_id", paymentIds),
  db
    .from("labour_invoice_verification")
    .select(
      "invoice_id,contractor_id,invoice_amount,paid_amount,amount_remaining,payment_status",
    )
    .in("invoice_id", invoiceIds),
]);
if (paymentVerification.error) throw paymentVerification.error;
if (invoiceVerification.error) throw invoiceVerification.error;
assert(
  paymentVerification.data.length === PAYMENTS.length &&
    paymentVerification.data.every(
      (row) =>
        row.contractor_id === CONTRACTOR_ID &&
        row.recipient_status === "confirmed" &&
        row.payment_status === "fully_allocated" &&
        cents(row.unallocated_amount) === 0 &&
        cents(row.payment_amount) === cents(row.total_allocated_amount),
    ),
  "Post-apply Premium Coat grouped payment verification failed.",
);
assert(
  invoiceVerification.data.length === INVOICES.length &&
    invoiceVerification.data.every((row) => {
      const expected = INVOICES.find(
        (invoice) => invoice.id === row.invoice_id,
      );
      if (!expected || row.contractor_id !== CONTRACTOR_ID) return false;
      const expectedRemaining = expected.amount - expected.expectedPaid;
      return (
        row.payment_status ===
          (cents(expectedRemaining) === 0 ? "paid" : "partially_paid") &&
        cents(row.paid_amount) === cents(expected.expectedPaid) &&
        cents(row.amount_remaining) === cents(expectedRemaining) &&
        cents(row.invoice_amount) === cents(expected.amount)
      );
    }),
  "Post-apply Premium Coat grouped invoice verification failed.",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      payments_fully_allocated: paymentVerification.data.length,
      invoices_fully_paid: invoiceVerification.data.filter(
        (row) => row.payment_status === "paid",
      ).length,
      invoices_partially_paid: invoiceVerification.data.filter(
        (row) => row.payment_status === "partially_paid",
      ).length,
      total_matched: PAYMENTS.reduce((sum, payment) => sum + payment.amount, 0),
    },
    null,
    2,
  ),
);
