#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const CONTRACTOR_ID = "4b5d875c-11da-4d30-8a47-ef5039bab014";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();

const MATCHES = [
  {
    payment: {
      id: "3639a261-058b-439c-b011-39d2d9505bbb",
      postedOn: "2026-03-16",
      sentOn: "2026-03-15",
      description: "SEND E-TFR ***mCy",
      suffix: "mCy",
      amount: 1921,
    },
    invoice: {
      id: "7cdb4fe8-1ff6-401b-997a-e98ea66459a2",
      number: "FM-143",
      date: "2026-03-15",
      amount: 1921,
      messageId: "19cf36e5829f7338",
    },
  },
  {
    payment: {
      id: "2e0f5cae-b149-4aa2-83c7-cab15dbfbabc",
      postedOn: "2026-04-17",
      sentOn: "2026-04-17",
      description: "SEND E-TFR ***MYK",
      suffix: "MYK",
      amount: 3271.35,
    },
    invoice: {
      id: "f2e05fbe-c7bd-41f9-ad2b-cc041662afb0",
      number: "FM-152",
      date: "2026-04-16",
      amount: 3271.35,
      messageId: "19d9753482366e4b",
    },
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
const paymentIds = MATCHES.map((match) => match.payment.id);
const invoiceIds = MATCHES.map((match) => match.invoice.id);
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
      "id,contractor_id,supplier_name,invoice_number,invoice_date,amount_before_tax,tax_amount,currency,document_type,text_excerpt",
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
  transactionsResult.data.length === MATCHES.length,
  "One or more Premium Coat payment rows are missing.",
);
assert(
  invoicesResult.data.length === MATCHES.length,
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
const allocationByPaymentId = new Map(
  allocationsResult.data.map((allocation) => [
    allocation.financial_transaction_id,
    allocation,
  ]),
);

let paymentUpdates = 0;
let paymentRecordInserts = 0;
let allocationInserts = 0;
const planned = MATCHES.map((match) => {
  const transaction = transactionById.get(match.payment.id);
  const record = recordById.get(match.payment.id);
  const invoice = invoiceById.get(match.invoice.id);
  const allocation = allocationByPaymentId.get(match.payment.id);

  assert(transaction, `Missing bank payment ${match.payment.suffix}.`);
  assert(invoice, `Missing invoice ${match.invoice.number}.`);
  assert(
    transaction.posted_on === match.payment.postedOn &&
      transaction.description === match.payment.description &&
      transaction.counterparty === "15337810 Canada Inc." &&
      cents(transaction.amount) === -cents(match.payment.amount) &&
      transaction.currency === "CAD" &&
      transaction.transaction_type === "expense" &&
      transaction.is_transfer === false &&
      ["General overhead", "Subcontractors"].includes(transaction.category),
    `Payment ${match.payment.suffix} no longer matches the reviewed bank row.`,
  );
  assert(
    invoice.contractor_id === CONTRACTOR_ID &&
      invoice.supplier_name === "Premium Coat" &&
      invoice.invoice_number === match.invoice.number &&
      invoice.invoice_date === match.invoice.date &&
      invoice.currency === "CAD" &&
      invoice.document_type === "invoice" &&
      cents(gross(invoice)) === cents(match.invoice.amount) &&
      invoice.text_excerpt?.includes("15337810 Canada Inc") &&
      invoice.text_excerpt?.includes("payments@premiumcoat.ca"),
    `Invoice ${match.invoice.number} no longer matches the reviewed source.`,
  );
  if (record) {
    assert(
      record.contractor_id === CONTRACTOR_ID &&
        record.recipient_status === "confirmed",
      `Payment ${match.payment.suffix} has an unexpected recipient record.`,
    );
  } else {
    paymentRecordInserts += 1;
  }
  if (allocation) {
    assert(
      allocation.invoice_id === match.invoice.id &&
        cents(allocation.allocated_amount) === cents(match.invoice.amount),
      `Payment ${match.payment.suffix} has an unexpected allocation.`,
    );
  } else {
    allocationInserts += 1;
  }

  const sourceData = sourceObject(transaction.source_data);
  const confirmationNote =
    `TD EasyWeb: ${match.payment.sentOn}, $${match.payment.amount.toFixed(2)}, ` +
    `Francisco Premium Coat <payments@premiumcoat.ca>, confirmation ` +
    `${match.payment.suffix}, Autodeposited. The bank counterparty is Premium ` +
    `Coat's legal company 15337810 Canada Inc.; invoice #${match.invoice.number} ` +
    "instructs payment to the same email and has the exact total.";
  const desiredTransaction = {
    category: "Subcontractors",
    review_status: "reconciled",
    notes: confirmationNote,
    source_data: {
      ...sourceData,
      easyweb_e_transfer_evidence: {
        amount: match.payment.amount,
        source: "TD EasyWeb e-transfer history reviewed 2026-07-30",
        status: "Autodeposited",
        sent_on: match.payment.sentOn,
        match_method: "confirmation_suffix_amount_date",
        bank_posted_on: match.payment.postedOn,
        recipient_name: "Francisco Premium Coat",
        recipient_email: "payments@premiumcoat.ca",
        confirmation_suffix: match.payment.suffix,
      },
    },
  };
  if (changed(transaction, desiredTransaction)) paymentUpdates += 1;

  return {
    match,
    transaction,
    record,
    allocation,
    confirmationNote,
    desiredTransaction,
  };
});

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      exact_matches: MATCHES.length,
      payment_updates: paymentUpdates,
      payment_record_inserts: paymentRecordInserts,
      allocation_inserts: allocationInserts,
      total_matched: MATCHES.reduce(
        (sum, match) => sum + match.payment.amount,
        0,
      ),
    },
    null,
    2,
  ),
);
if (!APPLY) process.exit(0);

for (const {
  match,
  transaction,
  record,
  allocation,
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
      reason:
        `Reclassified ${match.payment.suffix} from overhead to subcontractors ` +
        `using the bank legal name, EasyWeb recipient, invoice remittance email, ` +
        `and exact invoice #${match.invoice.number} total.`,
      performed_by: ADMIN_USER_ID,
      performed_at: NOW,
    });
  }

  if (!record) {
    const insertion = await db.from("labour_payment_records").insert({
      financial_transaction_id: match.payment.id,
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

  if (!allocation) {
    const insertion = await db.from("labour_payment_allocations").insert({
      financial_transaction_id: match.payment.id,
      invoice_id: match.invoice.id,
      allocated_amount: match.invoice.amount,
      match_method: [
        "legal_company_name",
        "easyweb_recipient_email",
        "invoice_remittance_email",
        "unique_exact_invoice_total",
        "invoice_precedes_payment",
        "bank_record",
      ],
      invoice_source_message_id: match.invoice.messageId,
      payment_confirmation_message_id: null,
      confirmed_by: ADMIN_USER_ID,
      confirmed_at: NOW,
      inserted_by: ADMIN_USER_ID,
      notes: confirmationNote,
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
    },
    reason:
      `Allocated exact Premium Coat payment ${match.payment.suffix} to ` +
      `invoice #${match.invoice.number} using the legal company name, ` +
      "EasyWeb recipient, matching remittance email, date, and cents.",
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
  paymentVerification.data.length === MATCHES.length &&
    paymentVerification.data.every(
      (row) =>
        row.contractor_id === CONTRACTOR_ID &&
        row.recipient_status === "confirmed" &&
        row.payment_status === "fully_allocated" &&
        cents(row.unallocated_amount) === 0 &&
        cents(row.payment_amount) === cents(row.total_allocated_amount),
    ),
  "Post-apply Premium Coat payment verification failed.",
);
assert(
  invoiceVerification.data.length === MATCHES.length &&
    invoiceVerification.data.every(
      (row) =>
        row.contractor_id === CONTRACTOR_ID &&
        row.payment_status === "paid" &&
        cents(row.amount_remaining) === 0 &&
        cents(row.invoice_amount) === cents(row.paid_amount),
    ),
  "Post-apply Premium Coat invoice verification failed.",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      payments_fully_allocated: paymentVerification.data.length,
      invoices_fully_paid: invoiceVerification.data.length,
      total_matched: MATCHES.reduce(
        (sum, match) => sum + match.payment.amount,
        0,
      ),
    },
    null,
    2,
  ),
);
