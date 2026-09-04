#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CUTOFF = "2026-06-01";
const OBSERVED_ON = "2026-09-01";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const capturedAt = new Date().toISOString();

const payments = [
  {
    key: "fennec-10-13",
    contactName: "Fennec Contracting",
    transfer: {
      amountCents: 353_600,
      description: "SEND E-TFR *e49 SUPP",
      recipient: "Bilal akkacha",
      registeredName: "Bilal Akkacha",
      destination: "akkachabilal@gmail.com",
      message: "Fennec invoices 10-13",
      purpose: "SUPP - Supplier Payment",
      confirmation: "C1AfEV***e49",
      status: "Autodeposited",
      method: "Email",
      final: true,
    },
    invoices: [
      { id: "49079e49-5a58-5b3a-905a-8a7ec9798544", number: "10", totalCents: 135_950 },
      { id: "16dc1732-d34a-5eb7-b5ac-d4a9ee52d3c6", number: "11", totalCents: 33_150 },
      { id: "5143bd08-f5ee-5dcf-ab53-690a2234fd7a", number: "12", totalCents: 91_500 },
      { id: "7e912a37-e970-525a-9767-ca92e994ade6", number: "13", totalCents: 93_000 },
    ],
  },
  {
    key: "abdellah-inv-20260829-001",
    contactName: "Abdellah Aouf",
    transfer: {
      amountCents: 37_050,
      description: "SEND E-TFR *5DZ SUPP",
      recipient: "Anas New",
      destination: "abdellahaouf2@gmail.com",
      message: "Invoice INV-20260829-001",
      purpose: "SUPP - Supplier Payment",
      confirmation: "CA***5DZ",
      status: "Sent",
      method: "Email",
      final: false,
    },
    invoices: [
      { id: "bf94e774-373b-5ce9-b44e-44558017152a", number: "INV-20260829-001", totalCents: 37_050 },
    ],
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
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function active(rows) {
  return (rows ?? []).filter((row) => !row.reversed_at);
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
}

function data(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing Supabase credentials.");
assert(
  new URL(supabaseUrl).hostname.split(".")[0] === PROJECT_REF,
  "Refusing payment reconciliation for an unexpected Supabase project.",
);
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const invoiceIds = payments.flatMap((payment) => payment.invoices.map((invoice) => invoice.id));
const [account, invoices, existingTransactions] = await Promise.all([
  data("account", await db.from("accounts").select("*").eq("slug", "td-chequing-6970").single()),
  data("invoices", await db.from("invoices")
    .select("*,contact:contacts(id,name,email),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(*),job_allocations:invoice_job_allocations(id,job_id,total_cents,needs_review,job:jobs(id,name,status,started_on,completed_on,production_month))")
    .in("id", invoiceIds)),
  data("transactions", await db.from("transactions")
    .select("*,allocations:transaction_allocations(*)")
    .eq("posted_on", OBSERVED_ON)),
]);

assert(account.last_four === "6970", "Payment account changed.");
assert(invoices.length === invoiceIds.length, `Expected ${invoiceIds.length} invoices, found ${invoices.length}.`);

for (const payment of payments) {
  const paymentInvoices = payment.invoices.map((expected) => invoices.find((row) => row.id === expected.id));
  assert(paymentInvoices.every(Boolean), `Missing one or more ${payment.contactName} invoices.`);
  const paymentContactIds = [...new Set(paymentInvoices.map((invoice) => invoice.contact_id))];
  assert(paymentContactIds.length === 1, `${payment.contactName} invoices do not share one canonical contact.`);
  payment.contactId = paymentContactIds[0];
  assert(sum(payment.invoices, "totalCents") === payment.transfer.amountCents, `${payment.key} invoice total does not equal its transfer.`);
  for (const expected of payment.invoices) {
    const invoice = invoices.find((row) => row.id === expected.id);
    assert(invoice, `Missing ${payment.contactName} invoice #${expected.number}.`);
    assert(invoice.invoice_number === expected.number, `Invoice #${expected.number} number changed.`);
    assert(invoice.direction === "payable", `Invoice #${expected.number} is not payable.`);
    assert(invoice.category === "labour", `Invoice #${expected.number} is not a labour invoice.`);
    assert(invoice.contact_id === payment.contactId, `Invoice #${expected.number} contact changed.`);
    assert(invoice.contact?.name === payment.contactName, `Invoice #${expected.number} supplier changed.`);
    assert(Number(invoice.total_cents) === expected.totalCents, `Invoice #${expected.number} total changed.`);
    assert((invoice.job_allocations ?? []).length > 0, `Invoice #${expected.number} has no job allocation.`);
    assert(sum(invoice.job_allocations ?? [], "total_cents") === expected.totalCents, `Invoice #${expected.number} job allocations do not total.`);
    assert(!(invoice.job_allocations ?? []).some((allocation) => allocation.needs_review), `Invoice #${expected.number} has a review allocation.`);
    for (const allocation of invoice.job_allocations ?? []) {
      assert(allocation.job, `Invoice #${expected.number} has a missing allocated job.`);
      if (allocation.job.started_on) {
        assert(allocation.job.started_on >= CUTOFF, `Invoice #${expected.number} is linked to historical job ${allocation.job.name}.`);
      } else {
        assert(
          !["completed", "archived", "cancelled", "canceled"].includes(String(allocation.job.status).toLowerCase()),
          `Invoice #${expected.number} is linked to a locked undated job ${allocation.job.name}.`,
        );
      }
    }
  }
}

const evidence = {
  source: "TD EasyWeb send confirmation and Interac e-Transfer history",
  observed_on: OBSERVED_ON,
  account_last_four: "6970",
  transfers: payments.map((payment) => ({
    contractor: payment.contactName,
    invoice_numbers: payment.invoices.map((invoice) => invoice.number),
    amount_cents: payment.transfer.amountCents,
    recipient: payment.transfer.recipient,
    registered_name: payment.transfer.registeredName ?? null,
    recipient_destination: payment.transfer.destination,
    message: payment.transfer.message,
    purpose: payment.transfer.purpose,
    fee_cents: 0,
    confirmation_masked: payment.transfer.confirmation,
    method: payment.transfer.method,
    status: payment.transfer.status,
    cancellable_when_observed: !payment.transfer.final,
  })),
};
const evidenceBytes = Buffer.from(JSON.stringify(evidence, null, 2));
const evidenceHash = crypto.createHash("sha256").update(evidenceBytes).digest("hex");
const documentId = stableUuid(`document:td-easyweb-september1-contractor-payment-batch:${evidenceHash}`);

const plans = payments.map((payment) => {
  const sourceKey = `td-easyweb-transfer-history:${OBSERVED_ON}:${payment.transfer.confirmation}:${payment.transfer.amountCents}`;
  const bySource = existingTransactions.find((row) => row.source_key === sourceKey) ?? null;
  const sameAmount = existingTransactions.filter((row) =>
    row.account_id === account.id && Number(row.amount_cents) === -payment.transfer.amountCents,
  );
  assert(bySource || sameAmount.length <= 1, `Multiple same-day ${payment.transfer.amountCents} cent payment candidates exist.`);
  const existing = bySource ?? sameAmount[0] ?? null;
  if (existing) {
    assert(existing.contact_id === payment.contactId, `${payment.key} existing transaction contact changed.`);
    assert(Number(existing.amount_cents) === -payment.transfer.amountCents, `${payment.key} existing transaction amount changed.`);
  }
  const id = existing?.id ?? stableUuid(`transaction:${account.id}:${sourceKey}`);
  const allocationIds = payment.invoices.map((expected) =>
    stableUuid(`transaction-allocation:${payment.key}:${id}:invoice:${expected.id}`),
  );
  const settlement = payment.transfer.final
    ? {
        status: "settled",
        invoice_ids: payment.invoices.map((invoice) => invoice.id),
        invoice_numbers: payment.invoices.map((invoice) => invoice.number),
        allocated_cents: payment.transfer.amountCents,
        allocation_ids: allocationIds,
        method: "easyweb_recipient,recipient_destination,exact_bank_message,exact_invoice_sum,autodeposit_status",
        reconciled_at: capturedAt,
      }
    : {
        status: "sent_pending_bank_deposit",
        invoice_ids: payment.invoices.map((invoice) => invoice.id),
        invoice_numbers: payment.invoices.map((invoice) => invoice.number),
        dispatched_cents: payment.transfer.amountCents,
        reason: "EasyWeb shows Sent, so the transfer remains cancellable and no invoice allocation is active yet.",
        observed_at: capturedAt,
      };
  return {
    payment,
    existing,
    allocationIds,
    row: {
      id,
      account_id: account.id,
      import_document_id: documentId,
      contact_id: payment.contactId,
      source_key: sourceKey,
      posted_on: OBSERVED_ON,
      transaction_on: OBSERVED_ON,
      description: payment.transfer.description,
      counterparty: payment.contactName,
      amount_cents: -payment.transfer.amountCents,
      tax_cents: 0,
      net_cents: -payment.transfer.amountCents,
      currency: "CAD",
      transaction_type: "expense",
      category: "Subcontractors",
      is_transfer: false,
      review_status: payment.transfer.final ? "reconciled" : "needs_review",
      notes: payment.transfer.final
        ? `TD EasyWeb autodeposited payment for ${payment.invoices.map((invoice) => `#${invoice.number}`).join(" + ")}.`
        : `TD EasyWeb payment sent for #${payment.invoices[0].number}; awaiting recipient deposit before settlement.`,
      metadata: {
        ...(existing?.metadata ?? {}),
        source: "td_easyweb_transfer_history",
        pending: !payment.transfer.final,
        status: payment.transfer.status,
        recipient: payment.transfer.recipient,
        recipient_registered_name: payment.transfer.registeredName ?? null,
        recipient_destination: payment.transfer.destination,
        message: payment.transfer.message,
        purpose: payment.transfer.purpose,
        fee_cents: 0,
        confirmation_masked: payment.transfer.confirmation,
        method: payment.transfer.method,
        observed_on: OBSERVED_ON,
        cancellable_when_observed: !payment.transfer.final,
        source_document_sha256: evidenceHash,
        settlement_confirmation: settlement,
      },
      created_at: existing?.created_at ?? capturedAt,
      updated_at: capturedAt,
    },
  };
});

for (const plan of plans) {
  const payment = plan.payment;
  for (let index = 0; index < payment.invoices.length; index += 1) {
    const expected = payment.invoices[index];
    const invoice = invoices.find((row) => row.id === expected.id);
    const knownAllocationId = plan.allocationIds[index];
    const otherPayments = active(invoice.payments).filter((row) => row.id !== knownAllocationId);
    assert(sum(otherPayments, "amount_cents") === 0, `Invoice #${expected.number} has an unexpected prior payment.`);
    if (!payment.transfer.final) {
      assert(active(invoice.payments).length === 0, `Pending invoice #${expected.number} already has a bank payment.`);
    }
  }
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  evidence_sha256: evidenceHash,
  transfers: plans.map((plan) => ({
    contractor: plan.payment.contactName,
    status: plan.payment.transfer.status,
    amount_cents: plan.payment.transfer.amountCents,
    fee_cents: 0,
    confirmation_masked: plan.payment.transfer.confirmation,
    invoice_numbers: plan.payment.invoices.map((invoice) => invoice.number),
    proposed_invoice_state: plan.payment.transfer.final ? "paid" : "sent_pending_bank_deposit",
    transaction_id: plan.row.id,
    existing_transaction: Boolean(plan.existing),
  })),
}, null, 2));
if (!APPLY) process.exit(0);

const existingDocument = data("evidence document lookup", await db.from("documents")
  .select("id,content_sha256")
  .eq("content_sha256", evidenceHash)
  .maybeSingle());
const resolvedDocumentId = existingDocument?.id ?? documentId;
if (!existingDocument) {
  data("evidence document", await db.from("documents").insert({
    id: documentId,
    kind: "bank_transfer_batch",
    original_filename: "td-easyweb-contractor-payments-2026-09-01.json",
    mime_type: "application/json",
    size_bytes: evidenceBytes.length,
    content_sha256: evidenceHash,
    storage_bucket: null,
    storage_path: null,
    source_url: "https://easyweb.td.com/waw/webui/emt/#/",
    captured_at: capturedAt,
    metadata: evidence,
  }));
}

for (const plan of plans) {
  plan.row.import_document_id = resolvedDocumentId;
  data("payment transaction", await db.from("transactions").upsert(plan.row, { onConflict: "id" }));
  data("transaction evidence", await db.from("evidence_links").upsert({
    id: stableUuid(`evidence-link:${resolvedDocumentId}:transaction:${plan.row.id}:bank_transfer_observation`),
    document_id: resolvedDocumentId,
    entity_type: "transaction",
    entity_id: plan.row.id,
    evidence_role: "bank_transfer_observation",
    metadata: {
      confirmation_masked: plan.payment.transfer.confirmation,
      status: plan.payment.transfer.status,
    },
    created_at: capturedAt,
  }, { onConflict: "id" }));
}

for (const plan of plans) {
  const payment = plan.payment;
  for (let index = 0; index < payment.invoices.length; index += 1) {
    const expected = payment.invoices[index];
    const invoice = invoices.find((row) => row.id === expected.id);
    const allocationId = plan.allocationIds[index];
    const existingAllocation = active(invoice.payments).find((row) => row.id === allocationId);

    data("invoice payment evidence", await db.from("evidence_links").upsert({
      id: stableUuid(`evidence-link:${resolvedDocumentId}:invoice:${invoice.id}:payment-dispatch`),
      document_id: resolvedDocumentId,
      entity_type: "invoice",
      entity_id: invoice.id,
      evidence_role: payment.transfer.final ? "payment_evidence" : "payment_dispatch_evidence",
      metadata: {
        confirmation_masked: payment.transfer.confirmation,
        status: payment.transfer.status,
        transaction_id: plan.row.id,
      },
      created_at: capturedAt,
    }, { onConflict: "id" }));

    if (payment.transfer.final) {
      data("invoice payment allocation", await db.from("transaction_allocations").upsert({
        id: allocationId,
        transaction_id: plan.row.id,
        invoice_id: invoice.id,
        contact_id: payment.contactId,
        source_system: "td_easyweb",
        external_id: `${payment.transfer.confirmation}:${invoice.invoice_number}`,
        allocation_type: "labour_payment",
        amount_cents: expected.totalCents,
        allocation_method: "easyweb_recipient,recipient_destination,exact_bank_message,exact_invoice_sum,autodeposit_status",
        confidence: 1,
        needs_review: false,
        metadata: {
          classification: "subcontractor_labour",
          invoice_number: invoice.invoice_number,
          bank_status: payment.transfer.status,
          bank_recipient: payment.transfer.recipient,
          recipient_registered_name: payment.transfer.registeredName ?? null,
          recipient_destination: payment.transfer.destination,
          bank_message: payment.transfer.message,
          confirmation_masked: payment.transfer.confirmation,
          paid_on: OBSERVED_ON,
          evidence_document_id: resolvedDocumentId,
          evidence_document_sha256: evidenceHash,
        },
        created_at: existingAllocation?.created_at ?? capturedAt,
        updated_at: capturedAt,
      }, { onConflict: "id" }));
    }

    const priorSettlement = invoice.metadata?.settlement && typeof invoice.metadata.settlement === "object"
      ? invoice.metadata.settlement
      : {};
    const paymentDispatch = {
      status: payment.transfer.final ? "autodeposited" : "sent_pending_bank_deposit",
      dispatched_on: OBSERVED_ON,
      amount_cents: expected.totalCents,
      grouped_payment_cents: payment.transfer.amountCents,
      grouped_invoice_numbers: payment.invoices.map((row) => row.number),
      transaction_id: plan.row.id,
      bank_status: payment.transfer.status,
      recipient: payment.transfer.recipient,
      recipient_registered_name: payment.transfer.registeredName ?? null,
      recipient_destination: payment.transfer.destination,
      bank_message: payment.transfer.message,
      confirmation_masked: payment.transfer.confirmation,
      cancellable_when_observed: !payment.transfer.final,
      evidence_document_id: resolvedDocumentId,
      evidence_document_sha256: evidenceHash,
    };
    const invoiceValues = payment.transfer.final
      ? {
          status: "paid",
          paid_cents: expected.totalCents,
          balance_cents: 0,
          metadata: {
            ...(invoice.metadata ?? {}),
            payment_dispatch: paymentDispatch,
            settlement: {
              ...priorSettlement,
              status: "paid",
              paid_cents: expected.totalCents,
              balance_cents: 0,
              transaction_ids: [...new Set([...(priorSettlement.transaction_ids ?? []), plan.row.id])],
              allocation_ids: [...new Set([...(priorSettlement.allocation_ids ?? []), allocationId])],
              last_payment_on: OBSERVED_ON,
              evidence: paymentDispatch,
            },
          },
        }
      : {
          metadata: {
            ...(invoice.metadata ?? {}),
            payment_dispatch: paymentDispatch,
          },
        };
    data("invoice settlement update", await db.from("invoices").update({
      ...invoiceValues,
      updated_at: capturedAt,
    }).eq("id", invoice.id).eq("updated_at", invoice.updated_at).select("id").maybeSingle());

    data("verification event", await db.from("verification_events").upsert({
      id: stableUuid(`verification:${payment.key}:invoice:${invoice.id}:transfer:${payment.transfer.confirmation}`),
      entity_type: payment.transfer.final ? "transaction_allocation" : "invoice",
      entity_id: payment.transfer.final ? allocationId : invoice.id,
      action: payment.transfer.final ? "supplier_invoice_payment_reconciled" : "supplier_invoice_payment_sent",
      reason: payment.transfer.final
        ? `TD EasyWeb autodeposited the exact ${payment.contactName} payment for invoice #${invoice.invoice_number}.`
        : `TD EasyWeb confirms the exact ${payment.contactName} payment for invoice #${invoice.invoice_number} was sent; settlement remains pending until deposit.`,
      old_values: {
        invoice_status: invoice.status,
        invoice_paid_cents: invoice.paid_cents,
        invoice_balance_cents: invoice.balance_cents,
      },
      new_values: payment.transfer.final
        ? { invoice_status: "paid", invoice_paid_cents: expected.totalCents, invoice_balance_cents: 0 }
        : { dispatch_status: "sent_pending_bank_deposit", invoice_status: invoice.status },
      evidence: paymentDispatch,
      occurred_at: capturedAt,
    }, { onConflict: "id" }));
  }
}

const [verifiedTransactions, verifiedInvoices] = await Promise.all([
  db.from("transactions")
    .select("id,source_key,amount_cents,review_status,metadata,allocations:transaction_allocations(id,invoice_id,amount_cents,reversed_at)")
    .in("id", plans.map((plan) => plan.row.id)),
  db.from("invoices")
    .select("id,invoice_number,status,total_cents,paid_cents,balance_cents,metadata,payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,transaction_id,amount_cents,reversed_at)")
    .in("id", invoiceIds),
]);
if (verifiedTransactions.error) throw verifiedTransactions.error;
if (verifiedInvoices.error) throw verifiedInvoices.error;
assert(verifiedTransactions.data.length === plans.length, "Not all contractor transfers were recorded.");
assert(verifiedInvoices.data.length === invoiceIds.length, "Not all contractor invoices were verified.");
for (const plan of plans) {
  const transaction = verifiedTransactions.data.find((row) => row.id === plan.row.id);
  assert(transaction, `Missing ${plan.payment.key} transaction.`);
  const allocated = sum(active(transaction.allocations), "amount_cents");
  assert(
    allocated === (plan.payment.transfer.final ? plan.payment.transfer.amountCents : 0),
    `${plan.payment.key} transaction allocation total is wrong.`,
  );
  for (const expected of plan.payment.invoices) {
    const invoice = verifiedInvoices.data.find((row) => row.id === expected.id);
    assert(invoice.metadata?.payment_dispatch?.confirmation_masked === plan.payment.transfer.confirmation, `Invoice #${expected.number} dispatch evidence is missing.`);
    if (plan.payment.transfer.final) {
      assert(invoice.status === "paid", `Invoice #${expected.number} was not marked paid.`);
      assert(Number(invoice.paid_cents) === expected.totalCents, `Invoice #${expected.number} paid total is wrong.`);
      assert(Number(invoice.balance_cents) === 0, `Invoice #${expected.number} balance is wrong.`);
      assert(sum(active(invoice.payments), "amount_cents") === expected.totalCents, `Invoice #${expected.number} payment allocation is wrong.`);
    } else {
      assert(invoice.status !== "paid", `Invoice #${expected.number} was prematurely marked paid.`);
      assert(active(invoice.payments).length === 0, `Invoice #${expected.number} was prematurely allocated.`);
    }
  }
}

console.log(JSON.stringify({
  status: "verified",
  evidence_document_id: resolvedDocumentId,
  transactions_recorded: verifiedTransactions.data.length,
  invoice_results: verifiedInvoices.data.map((invoice) => ({
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    paid_cents: Number(invoice.paid_cents),
    balance_cents: Number(invoice.balance_cents),
    dispatch_status: invoice.metadata?.payment_dispatch?.status ?? null,
    confirmation_masked: invoice.metadata?.payment_dispatch?.confirmation_masked ?? null,
  })),
}, null, 2));
