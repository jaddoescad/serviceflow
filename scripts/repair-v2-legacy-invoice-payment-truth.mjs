#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const now = new Date().toISOString();

function envFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      let value = line.slice(i + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      return [line.slice(0, i).trim(), value];
    }));
}

const env = {
  ...envFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")),
  ...envFile(path.join(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const PAYMENT_CORRECTIONS = [
  {
    id: "270948b2-5533-521a-95d0-535ee93e6fe5",
    invoice_number: "403",
    expected_total_cents: 61020,
    paid_cents: 61002,
    reason: "The only linked bank payment is $610.02; the supplier invoice total is $610.20.",
  },
  {
    id: "3e737146-db0f-5cfc-ac02-bdb4b66b248a",
    invoice_number: "62",
    expected_total_cents: 20000,
    paid_cents: 0,
    reason: "The saved invoice email states a $200 balance and no bank payment is linked. The separate $1,200 Marilyn payment belongs to invoice #58.",
    gmail_invoice_message_id: "19c9a137a51532a3",
  },
  {
    id: "4b7a2be0-0752-57e9-bbdc-aed7a7bdb458",
    invoice_number: "70",
    expected_total_cents: 330000,
    paid_cents: 200000,
    reason: "Two linked bank payments total $2,000.00; $1,300.00 remains outstanding.",
  },
  {
    id: "5d5adb57-4552-5c56-95c2-634674607c5c",
    invoice_number: "012225",
    expected_total_cents: 153250,
    paid_cents: 0,
    reason: "This invoice is a separate unpaid Mas Reno payable; no bank payment is linked.",
  },
  {
    id: "9ef68450-5537-5ef9-b3c7-582a7b764fc5",
    invoice_number: "73",
    expected_total_cents: 120000,
    paid_cents: 0,
    reason: "The saved invoice email states a $1,200 balance and no bank payment is linked. The separate $1,300 Darian payment belongs to invoice #72.",
    gmail_invoice_message_id: "19d79ede5f9bde60",
  },
  {
    id: "c7481b9f-c212-5182-b550-97bebcfbd33e",
    invoice_number: "FM-149",
    expected_total_cents: 723219,
    paid_cents: 703219,
    reason: "Linked bank payments total $7,032.19; $200.00 remains outstanding.",
  },
  {
    id: "d85733d9-86c6-5c42-85fc-41563887ba22",
    invoice_number: "82",
    expected_total_cents: 229500,
    paid_cents: 220000,
    reason: "Linked bank payments total $2,200.00; $95.00 remains outstanding.",
  },
  {
    id: "f7535b13-d2d9-5a76-9d38-84380c812fd2",
    invoice_number: "84",
    expected_total_cents: 112500,
    paid_cents: 0,
    reason: "The saved invoice email states a $1,125 balance and no bank payment is linked.",
    gmail_invoice_message_id: "19df54fadb1d52a3",
  },
];

const SUPPORTING_DOCUMENTS = [
  ["1052f357-3db1-5929-b6ff-732e380e5cba", "FILE-D061DF851155", 2500, "Unknown supplier receipt with no invoice lines or matching bank payment."],
  ["a7d9f172-e69d-5759-b856-81b861b7d6ad", "FILE-1471929AB1AC", 3000, "Unknown supplier receipt with no invoice lines or matching bank payment."],
  ["cd230b92-e343-5049-864e-2d9b79cd9686", "FILE-8D1AB8E94D0D", 3090, "Unknown supplier receipt with no invoice lines or matching bank payment."],
  ["dca38a38-f301-55d6-ac1f-932057cd96db", "FILE-97098E629224", 6153, "Sherwin-Williams receipt file with no invoice lines or matching bank payment."],
].map(([id, invoice_number, expected_total_cents, reason]) => ({ id, invoice_number, expected_total_cents, reason }));

const DUPLICATE = {
  id: "98597351-7113-5e9c-a079-01727b42213b",
  invoice_number: "84",
  expected_total_cents: 112500,
  canonical_invoice_id: "f7535b13-d2d9-5a76-9d38-84380c812fd2",
};

const allIds = [...PAYMENT_CORRECTIONS, ...SUPPORTING_DOCUMENTS, DUPLICATE].map((row) => row.id);
const { data: invoices, error } = await db.from("invoices")
  .select("id,invoice_number,status,total_cents,paid_cents,balance_cents,metadata,job_allocations:invoice_job_allocations(*)")
  .in("id", allIds);
if (error) throw error;
if (invoices.length !== allIds.length) throw new Error(`Expected ${allIds.length} invoices, found ${invoices.length}.`);
const byId = new Map(invoices.map((row) => [row.id, row]));

for (const expected of [...PAYMENT_CORRECTIONS, ...SUPPORTING_DOCUMENTS, DUPLICATE]) {
  const invoice = byId.get(expected.id);
  if (!invoice || invoice.invoice_number !== expected.invoice_number || Number(invoice.total_cents) !== expected.expected_total_cents) {
    throw new Error(`Invoice precondition changed for ${expected.id}.`);
  }
}

const paymentPreview = PAYMENT_CORRECTIONS.map((correction) => {
  const invoice = byId.get(correction.id);
  return {
    id: correction.id,
    invoice_number: correction.invoice_number,
    old_paid_cents: Number(invoice.paid_cents),
    new_paid_cents: correction.paid_cents,
    new_balance_cents: correction.expected_total_cents - correction.paid_cents,
    reason: correction.reason,
  };
});

const duplicateInvoice = byId.get(DUPLICATE.id);
const duplicateActiveAllocations = (duplicateInvoice.job_allocations ?? []).filter((row) => !row.metadata?.reversed_at);
const preview = {
  payment_corrections: paymentPreview,
  supporting_documents: SUPPORTING_DOCUMENTS.map((row) => ({
    id: row.id,
    invoice_number: row.invoice_number,
    total_cents: row.expected_total_cents,
    reason: row.reason,
  })),
  duplicate: {
    id: DUPLICATE.id,
    canonical_invoice_id: DUPLICATE.canonical_invoice_id,
    active_job_allocations_to_reverse: duplicateActiveAllocations.length,
  },
};

if (!APPLY) {
  console.log(JSON.stringify({ mode: "dry-run", ...preview }, null, 2));
  process.exit(0);
}

for (const correction of PAYMENT_CORRECTIONS) {
  const invoice = byId.get(correction.id);
  const update = await db.from("invoices").update({
    paid_cents: correction.paid_cents,
    balance_cents: correction.expected_total_cents - correction.paid_cents,
    metadata: {
      ...(invoice.metadata ?? {}),
      payment_reconciliation: {
        status: correction.paid_cents === 0 ? "unpaid" : correction.paid_cents === correction.expected_total_cents ? "paid" : "partially_paid",
        bank_backed_paid_cents: correction.paid_cents,
        balance_cents: correction.expected_total_cents - correction.paid_cents,
        basis: correction.reason,
        gmail_invoice_message_id: correction.gmail_invoice_message_id ?? null,
        reconciled_at: now,
        source: "saved_invoice_and_bank_evidence",
      },
    },
    updated_at: now,
  }).eq("id", correction.id);
  if (update.error) throw update.error;
}

for (const supporting of SUPPORTING_DOCUMENTS) {
  const invoice = byId.get(supporting.id);
  const update = await db.from("invoices").update({
    status: "supporting_document",
    paid_cents: 0,
    balance_cents: supporting.expected_total_cents,
    metadata: {
      ...(invoice.metadata ?? {}),
      financial_classification: {
        status: "supporting_document",
        reason: supporting.reason,
        classified_at: now,
        source: "v2_unified_model_audit",
      },
    },
    updated_at: now,
  }).eq("id", supporting.id);
  if (update.error) throw update.error;
}

for (const allocation of duplicateActiveAllocations) {
  const reverse = await db.from("invoice_job_allocations").update({
    metadata: {
      ...(allocation.metadata ?? {}),
      reversed_at: now,
      reversal_reason: "Duplicate manual record of the canonical Gmail invoice.",
      duplicate_of_invoice_id: DUPLICATE.canonical_invoice_id,
    },
    updated_at: now,
  }).eq("id", allocation.id);
  if (reverse.error) throw reverse.error;
}

const duplicateUpdate = await db.from("invoices").update({
  status: "supporting_document",
  paid_cents: 0,
  balance_cents: DUPLICATE.expected_total_cents,
  metadata: {
    ...(duplicateInvoice.metadata ?? {}),
    duplicate_resolution: {
      status: "duplicate_supporting_record",
      canonical_invoice_id: DUPLICATE.canonical_invoice_id,
      reason: "This direct-labour record duplicates Polaris invoice #84 from Gmail for the same Martin Huot job and amount.",
      resolved_at: now,
    },
  },
  updated_at: now,
}).eq("id", DUPLICATE.id);
if (duplicateUpdate.error) throw duplicateUpdate.error;

const { data: verified, error: verifyError } = await db.from("invoices")
  .select("id,status,total_cents,paid_cents,balance_cents,job_allocations:invoice_job_allocations(id,metadata)")
  .in("id", allIds);
if (verifyError) throw verifyError;
const verifiedById = new Map(verified.map((row) => [row.id, row]));
for (const correction of PAYMENT_CORRECTIONS) {
  const invoice = verifiedById.get(correction.id);
  if (Number(invoice.paid_cents) !== correction.paid_cents || Number(invoice.balance_cents) !== correction.expected_total_cents - correction.paid_cents) {
    throw new Error(`Payment verification failed for ${correction.id}.`);
  }
}
for (const supporting of SUPPORTING_DOCUMENTS) {
  const invoice = verifiedById.get(supporting.id);
  if (invoice.status !== "supporting_document" || Number(invoice.paid_cents) !== 0 || Number(invoice.balance_cents) !== supporting.expected_total_cents) {
    throw new Error(`Supporting-document verification failed for ${supporting.id}.`);
  }
}
const verifiedDuplicate = verifiedById.get(DUPLICATE.id);
if (verifiedDuplicate.status !== "supporting_document" || verifiedDuplicate.job_allocations.some((row) => !row.metadata?.reversed_at)) {
  throw new Error("Duplicate-invoice verification failed.");
}

console.log(JSON.stringify({ mode: "applied", ...preview }, null, 2));
