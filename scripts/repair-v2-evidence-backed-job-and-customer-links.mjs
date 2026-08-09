#!/usr/bin/env node

import crypto from "node:crypto";
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

function uuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

const EXACT_JOB_LINKS = [
  {
    invoice_id: "69458ffa-deed-5ada-8d1e-c7ac301a9b37",
    invoice_number: "320438",
    line_id: "2abb19f3-5368-52fe-a7c9-a7fa0bd48d5b",
    job_id: "c17cad11-30a2-5e8e-ba01-d3e5e48b99f7",
    expected_job_name: "Louis Titley — proposal 2002431 (completed)",
    expected_line_description: "Materials reimbursement — 36 Marchbrook exterior project",
    subtotal_cents: 200000,
    tax_cents: 26000,
    total_cents: 226000,
    method: "exact_printed_street_address",
    evidence: "Invoice line says 36 Marchbrook exterior project; the database has one job at 36 Marchbrook Circle.",
  },
  {
    invoice_id: "b1437274-bc6f-596b-a6f6-793b0aba181d",
    invoice_number: "FILE-1EC137DDC9A7",
    line_id: "162a5ea0-2da2-5592-8b21-e260087f7bff",
    job_id: "8f9d990f-f22f-5dcd-95a9-ad178b66a90c",
    expected_job_name: "Bradley McDermid — proposal 1767363 (completed)",
    expected_line_description: "Bradley — PO #250001",
    subtotal_cents: 108700,
    tax_cents: 0,
    total_cents: 108700,
    method: "unique_exact_customer_first_name_and_printed_po",
    evidence: "The physical invoice identifies Bradley and PO #250001; Bradley McDermid is the only Bradley job in the database.",
  },
];

const CURB_REVIEW_ALLOCATION_IDS = [
  "b5da6729-8879-5ce6-8407-43964062c936",
  "63c807fb-dd9f-53c1-983d-5a54e58da1d5",
  "f3d476f7-ebd1-5133-a093-239d404d456e",
];

const KIM_VOID_INVOICE_ID = "c9a7d03c-8cb5-549f-93df-8d1551b98e35";
const KIM_CANONICAL_INVOICE_ID = "28a3a71a-a650-4eb5-9231-f72f1d470695";
const MICHAEL_INVOICE_ID = "e2e30055-69e2-5376-8441-ca97d7d377c9";
const MICHAEL_FALSE_SOURCE_PAYMENT_ID = "f58cbcad-24d9-5a87-9278-fba8784ce0ed";
const MICHAEL_PREMIUM_COAT_TRANSACTION_ID = "2e0f5cae-b149-4aa2-83c7-cab15dbfbabc";
const MANUAL_UNVERIFIED = [
  ["cba821d8-4770-58a7-845a-90188e0e0f56", "INV-20260615-001", 10400],
  ["efb06982-65ce-5487-bdad-53e779300ac3", "MANUAL-20260722-CAMILLES-TEAM-01", 60000],
  ["fd9bbf9f-74b3-5639-bcf5-d05a505f0cb8", "INV-20260615-001", 52000],
].map(([id, invoice_number, total_cents]) => ({ id, invoice_number, total_cents }));

const targetInvoiceIds = [
  ...EXACT_JOB_LINKS.map((row) => row.invoice_id),
  KIM_VOID_INVOICE_ID,
  MICHAEL_INVOICE_ID,
  ...MANUAL_UNVERIFIED.map((row) => row.id),
];
const [{ data: invoices, error: invoiceError }, { data: curbAllocations, error: curbError }, { data: premiumTransaction, error: premiumError }] = await Promise.all([
  db.from("invoices").select("*,lines:invoice_lines(*),job_allocations:invoice_job_allocations(*)").in("id", targetInvoiceIds),
  db.from("invoice_job_allocations").select("*").in("id", CURB_REVIEW_ALLOCATION_IDS),
  db.from("transactions").select("*,allocations:transaction_allocations(*)").eq("id", MICHAEL_PREMIUM_COAT_TRANSACTION_ID).single(),
]);
if (invoiceError) throw invoiceError;
if (curbError) throw curbError;
if (premiumError) throw premiumError;
if (invoices.length !== targetInvoiceIds.length) throw new Error("Target invoice count changed.");
if (curbAllocations.length !== CURB_REVIEW_ALLOCATION_IDS.length) throw new Error("Curb allocation count changed.");
const invoiceById = new Map(invoices.map((row) => [row.id, row]));

for (const link of EXACT_JOB_LINKS) {
  const invoice = invoiceById.get(link.invoice_id);
  const line = invoice?.lines?.find((row) => row.id === link.line_id);
  if (!invoice || invoice.invoice_number !== link.invoice_number || !line || line.description !== link.expected_line_description ||
      Number(line.subtotal_cents) !== link.subtotal_cents || Number(line.tax_cents) !== link.tax_cents || Number(line.total_cents) !== link.total_cents) {
    throw new Error(`Exact-link precondition changed for ${link.invoice_number}.`);
  }
}
const { data: exactJobs, error: jobError } = await db.from("jobs").select("id,name,formatted_address").in("id", EXACT_JOB_LINKS.map((row) => row.job_id));
if (jobError) throw jobError;
for (const link of EXACT_JOB_LINKS) {
  const job = exactJobs.find((row) => row.id === link.job_id);
  if (!job || job.name !== link.expected_job_name) throw new Error(`Exact job changed for invoice ${link.invoice_number}.`);
}
const { count: bradleyCount, error: bradleyError } = await db.from("jobs").select("id", { count: "exact", head: true }).ilike("name", "Bradley%");
if (bradleyError) throw bradleyError;
if (bradleyCount !== 1) throw new Error(`Bradley is no longer unique (${bradleyCount}).`);

const kimInvoice = invoiceById.get(KIM_VOID_INVOICE_ID);
if (kimInvoice.invoice_number !== "399599" || kimInvoice.metadata?.accounting_status !== "void" || kimInvoice.metadata?.superseded_by_invoice_id !== KIM_CANONICAL_INVOICE_ID) {
  throw new Error("Kim supersession precondition changed.");
}
const michaelInvoice = invoiceById.get(MICHAEL_INVOICE_ID);
if (michaelInvoice.invoice_number !== "417102" || Number(michaelInvoice.total_cents) !== 973834) throw new Error("Michael invoice precondition changed.");
const michaelFalsePayment = (await db.from("transaction_allocations").select("*").eq("id", MICHAEL_FALSE_SOURCE_PAYMENT_ID).single());
if (michaelFalsePayment.error) throw michaelFalsePayment.error;
if (michaelFalsePayment.data.invoice_id !== MICHAEL_INVOICE_ID || Number(michaelFalsePayment.data.amount_cents) !== 327135 || michaelFalsePayment.data.transaction_id !== null) {
  throw new Error("Michael source-payment precondition changed.");
}
const premiumActive = (premiumTransaction.allocations ?? []).filter((row) => !row.reversed_at);
if (premiumTransaction.posted_on !== "2026-04-17" || Number(premiumTransaction.amount_cents) !== -327135 ||
    !String(premiumTransaction.description).endsWith("***MYK") || premiumActive.reduce((sum, row) => sum + Number(row.amount_cents), 0) !== 327135) {
  throw new Error("Premium Coat bank-reference precondition changed.");
}
for (const expected of MANUAL_UNVERIFIED) {
  const invoice = invoiceById.get(expected.id);
  if (!invoice || invoice.invoice_number !== expected.invoice_number || Number(invoice.total_cents) !== expected.total_cents || invoice.source_system !== "direct_labour_expense") {
    throw new Error(`Manual invoice precondition changed for ${expected.id}.`);
  }
}

const linkWrites = EXACT_JOB_LINKS.map((link) => ({
  id: uuid(`invoice-job-allocation:${link.line_id}:${link.job_id}:saved-evidence-exact`),
  invoice_id: link.invoice_id,
  invoice_line_id: link.line_id,
  job_id: link.job_id,
  subtotal_cents: link.subtotal_cents,
  tax_cents: link.tax_cents,
  total_cents: link.total_cents,
  allocation_method: link.method,
  confidence: 1,
  needs_review: false,
  metadata: {
    source: "saved_invoice_and_job_database_evidence",
    evidence: link.evidence,
    reconciled_at: now,
  },
  created_at: now,
  updated_at: now,
}));

const preview = {
  exact_job_links: EXACT_JOB_LINKS.map((row) => ({ invoice_number: row.invoice_number, line: row.expected_line_description, job: row.expected_job_name, subtotal_cents: row.subtotal_cents })),
  curb_allocations_confirmed: CURB_REVIEW_ALLOCATION_IDS.length,
  void_customer_invoice_excluded: { invoice_number: "399599", canonical_invoice_id: KIM_CANONICAL_INVOICE_ID },
  contradicted_customer_payment_reversed: { invoice_number: "417102", amount_cents: 327135, bank_reference: "MYK", actual_bank_direction: "outgoing_to_Premium_Coat" },
  manual_payment_claims_reset_to_unverified: MANUAL_UNVERIFIED.map((row) => ({ invoice_number: row.invoice_number, total_cents: row.total_cents })),
};
if (!APPLY) {
  console.log(JSON.stringify({ mode: "dry-run", ...preview }, null, 2));
  process.exit(0);
}

const jobLinkWrite = await db.from("invoice_job_allocations").upsert(linkWrites, { onConflict: "id" });
if (jobLinkWrite.error) throw jobLinkWrite.error;
for (const link of EXACT_JOB_LINKS) {
  const invoice = invoiceById.get(link.invoice_id);
  const update = await db.from("invoices").update({
    metadata: {
      ...(invoice.metadata ?? {}),
      job_costing_repair: {
        status: "partially_or_fully_linked_from_exact_saved_evidence",
        linked_line_id: link.line_id,
        job_id: link.job_id,
        evidence: link.evidence,
        repaired_at: now,
      },
    },
    updated_at: now,
  }).eq("id", link.invoice_id);
  if (update.error) throw update.error;
}

for (const allocation of curbAllocations) {
  if (!allocation.needs_review) continue;
  const update = await db.from("invoice_job_allocations").update({
    needs_review: false,
    confidence: 1,
    metadata: {
      ...(allocation.metadata ?? {}),
      review_resolution: {
        status: "confirmed",
        basis: "The physical Curb Appeal invoice prints the exact customer name, and the linked job is the unique exact customer match.",
        resolved_at: now,
      },
    },
    updated_at: now,
  }).eq("id", allocation.id);
  if (update.error) throw update.error;
}

for (const allocation of (kimInvoice.job_allocations ?? []).filter((row) => !row.metadata?.reversed_at)) {
  const reverse = await db.from("invoice_job_allocations").update({
    metadata: {
      ...(allocation.metadata ?? {}),
      reversed_at: now,
      reversal_reason: "Superseded customer invoice #399599 is fully included in canonical invoice #399590.",
      canonical_invoice_id: KIM_CANONICAL_INVOICE_ID,
    },
    updated_at: now,
  }).eq("id", allocation.id);
  if (reverse.error) throw reverse.error;
}
const kimUpdate = await db.from("invoices").update({
  status: "supporting_document",
  paid_cents: 0,
  balance_cents: Number(kimInvoice.total_cents),
  metadata: {
    ...(kimInvoice.metadata ?? {}),
    duplicate_resolution: {
      status: "superseded_customer_invoice",
      canonical_invoice_id: KIM_CANONICAL_INVOICE_ID,
      reason: kimInvoice.metadata?.void_reason,
      resolved_at: now,
    },
  },
  updated_at: now,
}).eq("id", KIM_VOID_INVOICE_ID);
if (kimUpdate.error) throw kimUpdate.error;

const falsePaymentReverse = await db.from("transaction_allocations").update({
  reversed_at: now,
  reversal_reason: "DripJobs payment reference MYK is the exact same-date outgoing Premium Coat bank transfer, not incoming customer cash.",
  metadata: {
    ...(michaelFalsePayment.data.metadata ?? {}),
    reversal_evidence: {
      status: "contradicted_by_bank_direction",
      actual_transaction_id: MICHAEL_PREMIUM_COAT_TRANSACTION_ID,
      actual_direction: "outgoing",
      actual_counterparty: "15337810 Canada Inc. / Premium Coat",
      amount_cents: 327135,
      reference_suffix: "MYK",
      reversed_at: now,
    },
  },
  updated_at: now,
}).eq("id", MICHAEL_FALSE_SOURCE_PAYMENT_ID).is("reversed_at", null);
if (falsePaymentReverse.error) throw falsePaymentReverse.error;
const michaelUpdate = await db.from("invoices").update({
  status: "Partially Paid",
  paid_cents: 646699,
  balance_cents: 327135,
  metadata: {
    ...(michaelInvoice.metadata ?? {}),
    bank_payment_reconciliation: {
      status: "partially_paid",
      bank_backed_paid_cents: 646699,
      balance_cents: 327135,
      contradicted_source_payment_cents: 327135,
      contradicted_reference_suffix: "MYK",
      actual_bank_transaction_id: MICHAEL_PREMIUM_COAT_TRANSACTION_ID,
      actual_bank_direction: "outgoing_to_Premium_Coat",
      reconciled_at: now,
    },
  },
  updated_at: now,
}).eq("id", MICHAEL_INVOICE_ID);
if (michaelUpdate.error) throw michaelUpdate.error;

for (const expected of MANUAL_UNVERIFIED) {
  const invoice = invoiceById.get(expected.id);
  const update = await db.from("invoices").update({
    paid_cents: 0,
    balance_cents: expected.total_cents,
    metadata: {
      ...(invoice.metadata ?? {}),
      payment_reconciliation: {
        status: "unverified",
        bank_backed_paid_cents: 0,
        reason: "Management-entered job cost has no linked bank transaction; it must not be shown as paid until payment evidence is linked.",
        reconciled_at: now,
      },
    },
    updated_at: now,
  }).eq("id", expected.id);
  if (update.error) throw update.error;
}

const [{ data: verifiedLinks, error: verifyLinkError }, { data: verifiedInvoices, error: verifyInvoiceError }, { data: verifiedCurb, error: verifyCurbError }, { data: verifiedFalsePayment, error: verifyPaymentError }] = await Promise.all([
  db.from("invoice_job_allocations").select("id,invoice_id,invoice_line_id,job_id,subtotal_cents,needs_review,metadata").in("id", linkWrites.map((row) => row.id)),
  db.from("invoices").select("id,status,total_cents,paid_cents,balance_cents,metadata,job_allocations:invoice_job_allocations(id,metadata)").in("id", [KIM_VOID_INVOICE_ID, MICHAEL_INVOICE_ID, ...MANUAL_UNVERIFIED.map((row) => row.id)]),
  db.from("invoice_job_allocations").select("id,needs_review,confidence").in("id", CURB_REVIEW_ALLOCATION_IDS),
  db.from("transaction_allocations").select("id,reversed_at,reversal_reason").eq("id", MICHAEL_FALSE_SOURCE_PAYMENT_ID).single(),
]);
if (verifyLinkError) throw verifyLinkError;
if (verifyInvoiceError) throw verifyInvoiceError;
if (verifyCurbError) throw verifyCurbError;
if (verifyPaymentError) throw verifyPaymentError;
if (verifiedLinks.length !== linkWrites.length || verifiedLinks.some((row) => row.needs_review)) throw new Error("Exact job-link verification failed.");
if (verifiedCurb.some((row) => row.needs_review || Number(row.confidence) !== 1)) throw new Error("Curb review verification failed.");
const verifiedKim = verifiedInvoices.find((row) => row.id === KIM_VOID_INVOICE_ID);
if (verifiedKim.status !== "supporting_document" || verifiedKim.job_allocations.some((row) => !row.metadata?.reversed_at)) throw new Error("Kim void verification failed.");
const verifiedMichael = verifiedInvoices.find((row) => row.id === MICHAEL_INVOICE_ID);
if (verifiedMichael.status !== "Partially Paid" || Number(verifiedMichael.paid_cents) !== 646699 || Number(verifiedMichael.balance_cents) !== 327135 || !verifiedFalsePayment.reversed_at) throw new Error("Michael payment verification failed.");
for (const expected of MANUAL_UNVERIFIED) {
  const invoice = verifiedInvoices.find((row) => row.id === expected.id);
  if (Number(invoice.paid_cents) !== 0 || Number(invoice.balance_cents) !== expected.total_cents) throw new Error(`Manual payment verification failed for ${expected.id}.`);
}

console.log(JSON.stringify({ mode: "applied", ...preview }, null, 2));
