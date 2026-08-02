#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const OLD_INVOICE_ID = "13b12af6-0518-420f-8b2b-89ddee04360e";
const CURRENT_INVOICE_ID = "fff52881-874d-4605-acbf-1ecd3c3c04bd";
const BANK_TRANSACTION_ID = "24d7ce51-f51e-4583-a9e5-9c6a9a8b5630";
const OLD_ALLOCATION_ID = "c841d844-18d6-4fe9-bd40-7430985b41f8";
const CURRENT_PAYMENT_EVENT_ID = "1ee6523b-8840-46db-8cba-bd537855e616";
const OLD_PROPOSAL_ID = "2096038";
const CURRENT_PROPOSAL_ID = "2967529";
const AMOUNT = 800;

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

function assertNoError(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
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
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF) {
  throw new Error("Refusing reconciliation for an unexpected Supabase project.");
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function loadState() {
  const [invoiceResult, allocationResult, transactionResult, eventResult, jobResult] =
    await Promise.all([
      db
        .from("customer_invoices")
        .select(
          "id,invoice_number,customer_name,billing_address,external_proposal_id,total_amount,source_status,accounting_status,superseded_by_invoice_id,void_reason,voided_at",
        )
        .in("id", [OLD_INVOICE_ID, CURRENT_INVOICE_ID]),
      db
        .from("customer_invoice_bank_allocations")
        .select(
          "id,financial_transaction_id,customer_invoice_id,source_payment_event_id,allocated_amount,invoice_applied_amount,reversed_at,reversal_reason",
        )
        .eq("financial_transaction_id", BANK_TRANSACTION_ID),
      db
        .from("financial_transactions")
        .select(
          "id,posted_on,description,counterparty,amount,currency,transaction_type,category,review_status,source_data",
        )
        .eq("id", BANK_TRANSACTION_ID)
        .single(),
      db
        .from("customer_invoice_payment_events")
        .select(
          "id,customer_invoice_id,payment_number,received_on,method,amount,currency",
        )
        .eq("id", CURRENT_PAYMENT_EVENT_ID)
        .single(),
      db
        .from("dripjobs_jobs")
        .select(
          "proposal_id,job_name,email,status,invoice_id,amount,accounting_status,superseded_by_proposal_id,accounting_note",
        )
        .in("proposal_id", [OLD_PROPOSAL_ID, CURRENT_PROPOSAL_ID]),
    ]);

  const invoices = assertNoError("customer invoices", invoiceResult);
  const allocations = assertNoError("bank allocations", allocationResult);
  const transaction = assertNoError("bank transaction", transactionResult);
  const event = assertNoError("payment event", eventResult);
  const jobs = assertNoError("DripJobs jobs", jobResult);
  return { invoices, allocations, transaction, event, jobs };
}

function validate(state) {
  const oldInvoice = state.invoices.find((row) => row.id === OLD_INVOICE_ID);
  const currentInvoice = state.invoices.find(
    (row) => row.id === CURRENT_INVOICE_ID,
  );
  const oldJob = state.jobs.find(
    (row) => row.proposal_id === OLD_PROPOSAL_ID,
  );
  const currentJob = state.jobs.find(
    (row) => row.proposal_id === CURRENT_PROPOSAL_ID,
  );
  const oldAllocation = state.allocations.find(
    (row) => row.id === OLD_ALLOCATION_ID,
  );
  const currentAllocation = state.allocations.find(
    (row) =>
      row.customer_invoice_id === CURRENT_INVOICE_ID &&
      row.reversed_at == null,
  );

  assert(oldInvoice?.invoice_number === "328142", "Old invoice changed.");
  assert(currentInvoice?.invoice_number === "460926", "Current invoice changed.");
  assert(
    oldInvoice.customer_name === "Ian Rothwell" &&
      currentInvoice.customer_name === "Ian Rothwell",
    "Invoice owner mismatch.",
  );
  assert(
    oldInvoice.billing_address === currentInvoice.billing_address,
    "Invoice address mismatch.",
  );
  assert(Number(oldInvoice.total_amount) === 1638.5, "Old invoice total changed.");
  assert(
    Number(currentInvoice.total_amount) === 1173.58,
    "Current invoice total changed.",
  );
  assert(oldJob?.invoice_id === "#328142", "Old job invoice changed.");
  assert(currentJob?.invoice_id === "#460926", "Current job invoice changed.");
  assert(Number(state.transaction.amount) === AMOUNT, "Bank amount changed.");
  assert(state.transaction.posted_on === "2025-10-01", "Bank date changed.");
  assert(
    state.transaction.description === "E-TRANSFER ***wh5",
    "Bank reference changed.",
  );
  assert(Number(state.event.amount) === AMOUNT, "Payment-event amount changed.");
  assert(
    state.event.customer_invoice_id === CURRENT_INVOICE_ID,
    "Payment event no longer belongs to current invoice.",
  );
  assert(
    oldAllocation && Number(oldAllocation.allocated_amount) === AMOUNT,
    "Original allocation changed.",
  );

  return {
    oldInvoice,
    currentInvoice,
    oldJob,
    currentJob,
    oldAllocation,
    currentAllocation,
  };
}

const before = await loadState();
const validated = validate(before);
const preview = {
  project_ref: TARGET_PROJECT_REF,
  apply: APPLY,
  action: "void obsolete invoice and move its bank evidence",
  bank_transaction: {
    id: BANK_TRANSACTION_ID,
    posted_on: before.transaction.posted_on,
    description: before.transaction.description,
    amount: Number(before.transaction.amount),
  },
  void_invoice: {
    id: OLD_INVOICE_ID,
    invoice_number: validated.oldInvoice.invoice_number,
    proposal_id: OLD_PROPOSAL_ID,
    total: Number(validated.oldInvoice.total_amount),
  },
  surviving_invoice: {
    id: CURRENT_INVOICE_ID,
    invoice_number: validated.currentInvoice.invoice_number,
    proposal_id: CURRENT_PROPOSAL_ID,
    total: Number(validated.currentInvoice.total_amount),
    payment_event: before.event.payment_number,
  },
  already_applied:
    validated.oldInvoice.accounting_status === "void" &&
    validated.oldJob.accounting_status === "superseded" &&
    validated.oldAllocation.reversed_at != null &&
    validated.currentAllocation != null,
};
console.log(JSON.stringify(preview, null, 2));

if (!APPLY || preview.already_applied) process.exit(0);

const now = new Date().toISOString();
const reason =
  "Ottawa Painters confirmed Ian Rothwell has one active invoice. Archived invoice #328142 is void and superseded by completed invoice #460926; the original $800 deposit belongs to the surviving invoice.";

assertNoError(
  "reverse obsolete allocation",
  await db
    .from("customer_invoice_bank_allocations")
    .update({
      reversed_at: now,
      reversal_reason: reason,
    })
    .eq("id", OLD_ALLOCATION_ID)
    .is("reversed_at", null),
);

const existingCurrent = before.allocations.find(
  (row) =>
    row.customer_invoice_id === CURRENT_INVOICE_ID && row.reversed_at == null,
);
if (!existingCurrent) {
  assertNoError(
    "insert surviving-invoice allocation",
    await db.from("customer_invoice_bank_allocations").insert({
      financial_transaction_id: BANK_TRANSACTION_ID,
      customer_invoice_id: CURRENT_INVOICE_ID,
      source_payment_event_id: CURRENT_PAYMENT_EVENT_ID,
      allocated_amount: AMOUNT,
      invoice_applied_amount: AMOUNT,
      match_method: [
        "interac_confirmation",
        "reference_suffix",
        "sender_identity",
        "original_contract_reference",
        "invoice_supersession",
        "owner_confirmed_2026_08_02",
      ],
      confidence: "confirmed",
      evidence_note:
        "Interac C1ASKaKZfwh5 from IAN ROTHWELL for $800.00 posted 2025-10-01. Message references original contract 2096038; Ottawa Painters confirmed its invoice #328142 is void and the deposit belongs to surviving invoice #460926 / DripJobs payment #539341.",
      confirmed_at: now,
    }),
  );
}

assertNoError(
  "void obsolete invoice",
  await db
    .from("customer_invoices")
    .update({
      accounting_status: "void",
      superseded_by_invoice_id: CURRENT_INVOICE_ID,
      void_reason: reason,
      voided_at: now,
    })
    .eq("id", OLD_INVOICE_ID),
);

assertNoError(
  "supersede obsolete job",
  await db
    .from("dripjobs_jobs")
    .update({
      accounting_status: "superseded",
      superseded_by_proposal_id: CURRENT_PROPOSAL_ID,
      accounting_note: reason,
      accounting_status_updated_at: now,
    })
    .eq("proposal_id", OLD_PROPOSAL_ID),
);

const currentSourceData = before.transaction.source_data ?? {};
assertNoError(
  "update bank evidence identity",
  await db
    .from("financial_transactions")
    .update({
      review_status: "reconciled",
      source_data: {
        ...currentSourceData,
        customer_revenue_identity: {
          ...(currentSourceData.customer_revenue_identity ?? {}),
          status: "confirmed",
          active_invoice_number: "460926",
          active_proposal_id: CURRENT_PROPOSAL_ID,
          void_invoice_number: "328142",
          original_contract_reference: OLD_PROPOSAL_ID,
        },
        customer_revenue_settlement: {
          ...(currentSourceData.customer_revenue_settlement ?? {}),
          status: "fully_allocated",
          allocated_amount: AMOUNT,
          unallocated_amount: 0,
          active_invoice_id: CURRENT_INVOICE_ID,
          void_invoice_id: OLD_INVOICE_ID,
          reassigned_at: now,
          rule: "customer_invoice_bank_allocations_are_settlement_truth",
        },
      },
    })
    .eq("id", BANK_TRANSACTION_ID),
);

const after = await loadState();
const checked = validate(after);
assert(checked.oldInvoice.accounting_status === "void", "Old invoice not void.");
assert(
  checked.oldInvoice.superseded_by_invoice_id === CURRENT_INVOICE_ID,
  "Old invoice supersession missing.",
);
assert(
  checked.oldJob.accounting_status === "superseded",
  "Old job not superseded.",
);
assert(checked.oldAllocation.reversed_at != null, "Old allocation still active.");
assert(
  checked.currentAllocation?.source_payment_event_id ===
    CURRENT_PAYMENT_EVENT_ID,
  "Current allocation missing payment event.",
);

const verification = assertNoError(
  "surviving invoice verification",
  await db
    .from("customer_invoice_verification")
    .select(
      "invoice_number,bank_cash_amount,processing_fee_amount,bank_paid_amount,amount_remaining,bank_payment_status,verification_status",
    )
    .eq("customer_invoice_id", CURRENT_INVOICE_ID)
    .single(),
);
assert(Number(verification.bank_paid_amount) === 1173.58, "Invoice credit mismatch.");
assert(Number(verification.amount_remaining) === 0, "Invoice still open.");
assert(verification.bank_payment_status === "paid", "Invoice not paid.");
assert(verification.verification_status === "verified", "Invoice not verified.");

console.log(
  JSON.stringify(
    {
      applied: true,
      void_invoice: "328142",
      surviving_invoice: "460926",
      reassigned_bank_cash: AMOUNT,
      surviving_invoice_verification: verification,
    },
    null,
    2,
  ),
);
