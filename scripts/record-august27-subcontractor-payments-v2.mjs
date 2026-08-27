#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CUTOFF = "2026-06-01";
const OBSERVED_ON = "2026-08-27";
const OBSERVED_BALANCE_CENTS = 4_831_909;
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const capturedAt = new Date().toISOString();

const payments = [
  {
    key: "xdesign-8616-8619",
    contactId: "ac2a71c8-5082-5bad-af43-d785ed98b30a",
    contactName: "XDesign Dev Inc",
    transfer: {
      amountCents: 233_910,
      description: "SEND E-TFR *PUw AP",
      recipient: "Michael Matambo",
      destination: "xdesign.ottawa@gmail.com",
      message: "Invoices 8616, 8617, 8618, 8619",
      confirmation: "CA***PUw",
      status: "Sent",
      method: "Email",
      final: false,
    },
    invoices: [
      { id: "f2ca9fa9-e5b7-50dd-809f-4421160d638d", number: "8616", totalCents: 40_680 },
      { id: "69849ca1-2a0d-5448-8f98-6221bbaf3b63", number: "8617", totalCents: 23_730 },
      { id: "0b2440a5-2879-5d69-b06e-105704b4c934", number: "8618", totalCents: 98_310 },
      { id: "cd23000a-53b1-519f-88be-a6c5dec9ce1e", number: "8619", totalCents: 71_190 },
    ],
  },
  {
    key: "grutenco-gt-inv-202608-03",
    contactId: "2d6edf7a-2a0e-585e-8d62-adf89506e6d6",
    contactName: "Grutenco Painting & Construction Services",
    transfer: {
      amountCents: 175_661,
      description: "SEND E-TFR *eQH AP",
      recipient: "grutenco",
      destination: "hello@grutenco.ca",
      message: "GT-INV-202608-03",
      confirmation: "CA***eQH",
      status: "Sent",
      method: "Email",
      final: false,
    },
    invoices: [
      { id: "1d04c0f2-3713-58ef-a371-423a6c7e3edd", number: "GT-INV-202608-03", totalCents: 175_661 },
    ],
  },
  {
    key: "bm-contracting-015",
    contactId: "a9d2b259-1c04-5d6f-b657-eb601d90e5fd",
    contactName: "BM Contracting",
    transfer: {
      amountCents: 127_690,
      description: "SEND E-TFR *mfZ AP",
      recipient: "BM Contracting - Burim",
      registeredName: "BURIM MUSLIJA",
      destination: "bur_imi@hotmail.com",
      message: "Invoice 015",
      confirmation: "C1Aqha***mfZ",
      status: "Autodeposited",
      method: "Email/Mobile",
      final: true,
    },
    invoices: [
      { id: "94d88d3c-1052-5a2f-b273-0b2833263d5b", number: "015", totalCents: 127_690 },
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

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) {
  throw new Error("Refusing payment reconciliation for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const invoiceIds = payments.flatMap((payment) => payment.invoices.map((invoice) => invoice.id));
const principalSourceKeys = payments.map((payment) =>
  `td-easyweb-transfer-history:${OBSERVED_ON}:${payment.transfer.confirmation}:${payment.transfer.amountCents}`,
);
const feeSourceKeys = payments.map((payment) =>
  `td-easyweb-transfer-fee:${OBSERVED_ON}:${payment.transfer.confirmation}:150`,
);

const [accountResult, invoiceResult, transactionResult] = await Promise.all([
  db.from("accounts").select("*").eq("slug", "td-chequing-6970").single(),
  db.from("invoices")
    .select("*,contact:contacts(id,name,email),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(*),job_allocations:invoice_job_allocations(id,job_id,total_cents,needs_review,job:jobs(id,name,status,started_on,completed_on,production_month))")
    .in("id", invoiceIds),
  db.from("transactions")
    .select("*,allocations:transaction_allocations(*)")
    .eq("posted_on", OBSERVED_ON),
]);
if (accountResult.error) throw accountResult.error;
if (invoiceResult.error) throw invoiceResult.error;
if (transactionResult.error) throw transactionResult.error;

const account = accountResult.data;
const invoices = invoiceResult.data ?? [];
const existingTransactions = transactionResult.data ?? [];
assert(account.last_four === "6970", "Payment account changed.");
assert(invoices.length === invoiceIds.length, `Expected ${invoiceIds.length} invoices, found ${invoices.length}.`);

const rowsByPayment = new Map();
for (const payment of payments) {
  const rows = payment.invoices.map((expected) => {
    const invoice = invoices.find((row) => row.id === expected.id);
    assert(invoice, `Missing ${payment.contactName} invoice #${expected.number}.`);
    assert(invoice.invoice_number === expected.number, `Invoice #${expected.number} number changed.`);
    assert(invoice.direction === "payable", `Invoice #${expected.number} is not payable.`);
    assert(invoice.category === "labour", `Invoice #${expected.number} is not a labour invoice.`);
    assert(invoice.contact_id === payment.contactId, `Invoice #${expected.number} contact changed.`);
    assert(invoice.contact?.name === payment.contactName, `Invoice #${expected.number} supplier changed.`);
    assert(Number(invoice.total_cents) === expected.totalCents, `Invoice #${expected.number} total changed.`);
    assert((invoice.job_allocations ?? []).length > 0, `Invoice #${expected.number} has no job allocation.`);
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
    assert(active(invoice.payments).length === 0 || payment.transfer.final, `Invoice #${expected.number} already has a bank payment.`);
    return { expected, invoice };
  });
  assert(sum(payment.invoices, "totalCents") === payment.transfer.amountCents, `${payment.key} invoice total does not equal its transfer.`);
  rowsByPayment.set(payment.key, rows);
}

const evidence = {
  source: "TD EasyWeb send confirmations, Interac e-Transfer history, and My Accounts balance",
  observed_on: OBSERVED_ON,
  account_last_four: "6970",
  balance_before_sends_cents: 5_369_620,
  balance_after_sends_cents: OBSERVED_BALANCE_CENTS,
  principal_sent_cents: sum(payments.map((payment) => payment.transfer), "amountCents"),
  fees_cents: payments.length * 150,
  transfers: payments.map((payment) => ({
    contractor: payment.contactName,
    invoice_numbers: payment.invoices.map((invoice) => invoice.number),
    amount_cents: payment.transfer.amountCents,
    recipient: payment.transfer.recipient,
    registered_name: payment.transfer.registeredName ?? null,
    recipient_destination: payment.transfer.destination,
    message: payment.transfer.message,
    purpose: "AP - Accounts Payable",
    fee_cents: 150,
    confirmation_masked: payment.transfer.confirmation,
    method: payment.transfer.method,
    status: payment.transfer.status,
    cancellable_when_observed: !payment.transfer.final,
  })),
};
const evidenceBytes = Buffer.from(JSON.stringify(evidence, null, 2));
const evidenceHash = crypto.createHash("sha256").update(evidenceBytes).digest("hex");
const documentId = stableUuid(`document:td-easyweb-august27-subcontractor-payment-batch:${evidenceHash}`);

function findExisting(sourceKey, description, amountCents) {
  const bySource = existingTransactions.find((row) => row.source_key === sourceKey);
  if (bySource) return bySource;
  const exact = existingTransactions.filter((row) =>
    row.account_id === account.id &&
    row.description === description &&
    Number(row.amount_cents) === amountCents
  );
  assert(exact.length <= 1, `Multiple exact transactions exist for ${description} ${amountCents}.`);
  return exact[0] ?? null;
}

const transactionPlans = [];
for (let index = 0; index < payments.length; index += 1) {
  const payment = payments[index];
  const sourceKey = principalSourceKeys[index];
  const existing = findExisting(sourceKey, payment.transfer.description, -payment.transfer.amountCents);
  const id = existing?.id ?? stableUuid(`transaction:${account.id}:${sourceKey}`);
  const invoiceRows = rowsByPayment.get(payment.key);
  const settlement = payment.transfer.final
    ? {
        status: "settled",
        invoice_ids: invoiceRows.map(({ invoice }) => invoice.id),
        invoice_numbers: payment.invoices.map((invoice) => invoice.number),
        allocated_cents: payment.transfer.amountCents,
        method: "easyweb_recipient,recipient_destination,exact_bank_message,exact_invoice_sum,autodeposit_status",
        reconciled_at: capturedAt,
      }
    : {
        status: "sent_pending_bank_deposit",
        invoice_ids: invoiceRows.map(({ invoice }) => invoice.id),
        invoice_numbers: payment.invoices.map((invoice) => invoice.number),
        dispatched_cents: payment.transfer.amountCents,
        reason: "EasyWeb still shows Sent, so the transfer remains cancellable and no invoice allocation is active yet.",
        observed_at: capturedAt,
      };
  transactionPlans.push({
    kind: "principal",
    payment,
    existing,
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
        : `TD EasyWeb payment sent for ${payment.invoices.map((invoice) => `#${invoice.number}`).join(" + ")}; awaiting recipient deposit before settlement.`,
      metadata: {
        ...(existing?.metadata ?? {}),
        source: "td_easyweb_transfer_history",
        pending: !payment.transfer.final,
        status: payment.transfer.status,
        recipient: payment.transfer.recipient,
        recipient_registered_name: payment.transfer.registeredName ?? null,
        recipient_destination: payment.transfer.destination,
        message: payment.transfer.message,
        purpose: "AP - Accounts Payable",
        fee_cents: 150,
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
  });

  const feeSourceKey = feeSourceKeys[index];
  const existingFee = existingTransactions.find((row) => row.source_key === feeSourceKey) ?? null;
  transactionPlans.push({
    kind: "fee",
    payment,
    existing: existingFee,
    row: {
      id: existingFee?.id ?? stableUuid(`transaction:${account.id}:${feeSourceKey}`),
      account_id: account.id,
      import_document_id: documentId,
      contact_id: null,
      source_key: feeSourceKey,
      posted_on: OBSERVED_ON,
      transaction_on: OBSERVED_ON,
      description: "SEND E-TFR FEE",
      counterparty: "TD Bank",
      amount_cents: -150,
      tax_cents: 0,
      net_cents: -150,
      currency: "CAD",
      transaction_type: "expense",
      category: "Bank fees",
      is_transfer: false,
      review_status: "reconciled",
      notes: `Interac e-Transfer fee for ${payment.contactName} payment ${payment.transfer.confirmation}.`,
      metadata: {
        ...(existingFee?.metadata ?? {}),
        source: "td_easyweb_send_confirmation",
        pending: false,
        related_transfer_confirmation_masked: payment.transfer.confirmation,
        related_recipient: payment.transfer.recipient,
        observed_on: OBSERVED_ON,
        source_document_sha256: evidenceHash,
        tax_evidence: { status: "not_applicable", tax_cents: 0 },
      },
      created_at: existingFee?.created_at ?? capturedAt,
      updated_at: capturedAt,
    },
  });
}

for (const plan of transactionPlans) {
  if (!plan.existing) continue;
  assert(plan.existing.account_id === account.id, `${plan.row.source_key} account changed.`);
  assert(Number(plan.existing.amount_cents) === Number(plan.row.amount_cents), `${plan.row.source_key} amount changed.`);
}

const preview = {
  mode: APPLY ? "apply" : "dry-run",
  account: {
    slug: account.slug,
    current_balance_cents: account.current_balance_cents,
    observed_balance_cents: OBSERVED_BALANCE_CENTS,
  },
  evidence_sha256: evidenceHash,
  transfers: payments.map((payment) => ({
    contractor: payment.contactName,
    status: payment.transfer.status,
    amount_cents: payment.transfer.amountCents,
    confirmation_masked: payment.transfer.confirmation,
    invoice_numbers: payment.invoices.map((invoice) => invoice.number),
    proposed_invoice_state: payment.transfer.final ? "paid" : "sent_pending_bank_deposit",
  })),
  transactions: transactionPlans.map((plan) => ({
    id: plan.row.id,
    source_key: plan.row.source_key,
    description: plan.row.description,
    amount_cents: plan.row.amount_cents,
    review_status: plan.row.review_status,
    existing: Boolean(plan.existing),
  })),
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) process.exit(0);

const documentResult = await db.from("documents").select("id,content_sha256").eq("content_sha256", evidenceHash).maybeSingle();
if (documentResult.error) throw documentResult.error;
const resolvedDocumentId = documentResult.data?.id ?? documentId;
if (!documentResult.data) {
  const write = await db.from("documents").insert({
    id: documentId,
    kind: "bank_transfer_batch",
    original_filename: "td-easyweb-subcontractor-payments-2026-08-27.json",
    mime_type: "application/json",
    size_bytes: evidenceBytes.length,
    content_sha256: evidenceHash,
    storage_bucket: null,
    storage_path: null,
    source_url: "https://easyweb.td.com/waw/webui/emt/#/",
    captured_at: capturedAt,
    metadata: evidence,
  });
  if (write.error) throw write.error;
}

for (const plan of transactionPlans) {
  plan.row.import_document_id = resolvedDocumentId;
  const write = await db.from("transactions").upsert(plan.row, { onConflict: "id" });
  if (write.error) throw write.error;
  const link = await db.from("evidence_links").upsert({
    id: stableUuid(`evidence-link:${resolvedDocumentId}:transaction:${plan.row.id}:bank_transfer_observation`),
    document_id: resolvedDocumentId,
    entity_type: "transaction",
    entity_id: plan.row.id,
    evidence_role: "bank_transfer_observation",
    metadata: { confirmation_masked: plan.payment.transfer.confirmation, status: plan.payment.transfer.status },
    created_at: capturedAt,
  }, { onConflict: "id" });
  if (link.error) throw link.error;
}

for (const payment of payments) {
  const principalPlan = transactionPlans.find((plan) => plan.kind === "principal" && plan.payment.key === payment.key);
  const invoiceRows = rowsByPayment.get(payment.key);
  const allocationIds = [];
  for (const { expected, invoice } of invoiceRows) {
    const evidenceLink = await db.from("evidence_links").upsert({
      id: stableUuid(`evidence-link:${resolvedDocumentId}:invoice:${invoice.id}:payment_dispatch_evidence`),
      document_id: resolvedDocumentId,
      entity_type: "invoice",
      entity_id: invoice.id,
      evidence_role: payment.transfer.final ? "payment_evidence" : "payment_dispatch_evidence",
      metadata: {
        confirmation_masked: payment.transfer.confirmation,
        status: payment.transfer.status,
        transaction_id: principalPlan.row.id,
      },
      created_at: capturedAt,
    }, { onConflict: "id" });
    if (evidenceLink.error) throw evidenceLink.error;

    if (payment.transfer.final) {
      const allocationId = stableUuid(`transaction-allocation:${payment.key}:${principalPlan.row.id}:invoice:${invoice.id}`);
      allocationIds.push(allocationId);
      const existingAllocation = active(invoice.payments).find((row) => row.id === allocationId);
      const otherPayments = active(invoice.payments).filter((row) => row.id !== allocationId);
      assert(sum(otherPayments, "amount_cents") === 0, `Invoice #${invoice.invoice_number} has an unexpected prior payment.`);
      const allocationWrite = await db.from("transaction_allocations").upsert({
        id: allocationId,
        transaction_id: principalPlan.row.id,
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
      }, { onConflict: "id" });
      if (allocationWrite.error) throw allocationWrite.error;
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
      transaction_id: principalPlan.row.id,
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
              transaction_ids: [...new Set([...(priorSettlement.transaction_ids ?? []), principalPlan.row.id])],
              allocation_ids: [...new Set([...(priorSettlement.allocation_ids ?? []), ...allocationIds])],
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
    const invoiceWrite = await db.from("invoices").update({
      ...invoiceValues,
      updated_at: capturedAt,
    }).eq("id", invoice.id).eq("updated_at", invoice.updated_at).select("id").maybeSingle();
    if (invoiceWrite.error) throw invoiceWrite.error;
    if (!invoiceWrite.data) throw new Error(`Concurrent invoice update detected for #${invoice.invoice_number}.`);

    const event = await db.from("verification_events").upsert({
      id: stableUuid(`verification:${payment.key}:invoice:${invoice.id}:transfer:${payment.transfer.confirmation}`),
      entity_type: payment.transfer.final ? "transaction_allocation" : "invoice",
      entity_id: payment.transfer.final ? allocationIds.at(-1) : invoice.id,
      action: payment.transfer.final ? "supplier_invoice_payment_reconciled" : "supplier_invoice_payment_sent",
      reason: payment.transfer.final
        ? `TD EasyWeb autodeposited the exact BM Contracting payment for invoice #${invoice.invoice_number}.`
        : `TD EasyWeb confirms the exact supplier payment for invoice #${invoice.invoice_number} was sent; settlement remains pending until deposit.`,
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
    }, { onConflict: "id" });
    if (event.error) throw event.error;
  }

  if (payment.transfer.final) {
    const transactionWrite = await db.from("transactions").update({
      metadata: {
        ...principalPlan.row.metadata,
        settlement_confirmation: {
          ...principalPlan.row.metadata.settlement_confirmation,
          allocation_ids: allocationIds,
        },
      },
      updated_at: capturedAt,
    }).eq("id", principalPlan.row.id);
    if (transactionWrite.error) throw transactionWrite.error;
  }
}

if (Number(account.current_balance_cents) !== OBSERVED_BALANCE_CENTS || Number(account.available_balance_cents) !== OBSERVED_BALANCE_CENTS) {
  const accountWrite = await db.from("accounts").update({
    current_balance_cents: OBSERVED_BALANCE_CENTS,
    available_balance_cents: OBSERVED_BALANCE_CENTS,
    balance_as_of: capturedAt,
    updated_at: capturedAt,
  }).eq("id", account.id).eq("updated_at", account.updated_at).select("id").maybeSingle();
  if (accountWrite.error) throw accountWrite.error;
  if (!accountWrite.data) throw new Error("Concurrent chequing account update detected.");
}

const accountEvent = await db.from("verification_events").upsert({
  id: stableUuid(`verification:easyweb-payment-batch-balance:${account.id}:${evidenceHash}`),
  entity_type: "account_balance",
  entity_id: account.id,
  action: "balance_observed",
  reason: "TD EasyWeb displayed the chequing balance after the three subcontractor payments and their fees were deducted.",
  old_values: {
    current_balance_cents: account.current_balance_cents,
    available_balance_cents: account.available_balance_cents,
    balance_as_of: account.balance_as_of,
  },
  new_values: {
    current_balance_cents: OBSERVED_BALANCE_CENTS,
    available_balance_cents: OBSERVED_BALANCE_CENTS,
    principal_sent_cents: evidence.principal_sent_cents,
    fees_cents: evidence.fees_cents,
  },
  evidence: { document_id: resolvedDocumentId, source_document_sha256: evidenceHash },
  occurred_at: capturedAt,
}, { onConflict: "id" });
if (accountEvent.error) throw accountEvent.error;

const [verifiedTransactions, verifiedInvoices, verifiedAccount] = await Promise.all([
  db.from("transactions")
    .select("id,source_key,amount_cents,review_status,metadata,allocations:transaction_allocations(id,invoice_id,amount_cents,reversed_at)")
    .in("id", transactionPlans.map((plan) => plan.row.id)),
  db.from("invoices")
    .select("id,invoice_number,status,total_cents,paid_cents,balance_cents,metadata,payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,transaction_id,amount_cents,reversed_at)")
    .in("id", invoiceIds),
  db.from("accounts").select("id,current_balance_cents,available_balance_cents,balance_as_of").eq("id", account.id).single(),
]);
if (verifiedTransactions.error) throw verifiedTransactions.error;
if (verifiedInvoices.error) throw verifiedInvoices.error;
if (verifiedAccount.error) throw verifiedAccount.error;
assert(verifiedTransactions.data.length === transactionPlans.length, "Not all transfer and fee transactions were recorded.");
assert(Number(verifiedAccount.data.current_balance_cents) === OBSERVED_BALANCE_CENTS, "Chequing current balance verification failed.");
assert(Number(verifiedAccount.data.available_balance_cents) === OBSERVED_BALANCE_CENTS, "Chequing available balance verification failed.");
for (const payment of payments) {
  const principal = verifiedTransactions.data.find((row) => row.source_key === principalSourceKeys[payments.indexOf(payment)]);
  assert(principal, `Missing verified ${payment.key} transfer.`);
  if (payment.transfer.final) {
    assert(sum(active(principal.allocations), "amount_cents") === payment.transfer.amountCents, `${payment.key} allocation verification failed.`);
  } else {
    assert(active(principal.allocations).length === 0, `${payment.key} must remain unallocated until deposit.`);
  }
  for (const expected of payment.invoices) {
    const invoice = verifiedInvoices.data.find((row) => row.id === expected.id);
    assert(invoice.metadata?.payment_dispatch?.confirmation_masked === payment.transfer.confirmation, `Invoice #${expected.number} dispatch evidence verification failed.`);
    if (payment.transfer.final) {
      assert(invoice.status === "paid", `Invoice #${expected.number} was not marked paid.`);
      assert(Number(invoice.paid_cents) === expected.totalCents, `Invoice #${expected.number} paid total verification failed.`);
      assert(Number(invoice.balance_cents) === 0, `Invoice #${expected.number} balance verification failed.`);
      assert(sum(active(invoice.payments), "amount_cents") === expected.totalCents, `Invoice #${expected.number} payment allocation verification failed.`);
    } else {
      assert(invoice.status !== "paid", `Invoice #${expected.number} was prematurely marked paid.`);
      assert(active(invoice.payments).length === 0, `Invoice #${expected.number} was prematurely allocated.`);
    }
  }
}

console.log(JSON.stringify({
  status: "verified",
  evidence_document_id: resolvedDocumentId,
  account_balance_cents: verifiedAccount.data.current_balance_cents,
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
