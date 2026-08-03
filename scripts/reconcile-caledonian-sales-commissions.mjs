#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const CONTRACTOR_ID = "365924ed-9da7-46d8-ac9c-2eec79373ced";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();
const JAN_PDF =
  "/Users/jadslim/.workspace-mcp/attachments/invoice-371282_99370bf3.pdf";

const invoices = [
  ["371282", "2026-01-15", 4000, 520, 4520, "19bc22252c52b71f", null],
  ["380069", "2026-02-05", 5107.86, 607.36, 5715.22, "19c2dce3553f487a", "eea3d610-7db9-4b85-a0bf-0e39579b8aaf"],
  ["1", "2026-03-06", 7525.65, 888.82, 8414.47, "19cc08bbb60d5842", "f9e1aa0a-3121-4172-882c-91008638e2da"],
  ["239605", "2026-04-13", 12299.83, 1408.77, 13708.6, "19d8885ee533da8d", "e921e252-1c25-47d7-adc2-f9fd731a3772"],
  ["239606", "2026-05-01", 10256.71, 1319.15, 11575.86, "19de56453a5cf2eb", "ab85002a-026b-43ba-a57b-f25ea824385a"],
  ["239607", "2026-06-11", 10863.6, 1392.5, 12256.1, "19eb7e24e5ae859d", "b006a973-44c3-4bcd-aa45-0408268ecb82"],
  ["239608", "2026-06-30", 9032.67, 1160.38, 10193.05, "19f1a312d15080c1", "4cabfd2a-98af-4422-810c-9e57fabd42c3"],
].map(([number, date, net, tax, gross, messageId, id]) => ({
  number, date, net, tax, gross, messageId, id,
  expectedPaid: number === "239606" ? 11575 : gross,
}));

const payments = [
  ["91939f3f-c4d7-4b75-9db7-ab70c224920d", "371282", 4520],
  ["d89a64f0-3ad1-4bd4-8be7-0c99471e012b", "380069", 5715.22],
  ["fb866c0f-8851-4249-bac4-92eb7dc9f9b9", "1", 8414.47],
  ["d1e3d24e-af53-4367-a459-ebf2ff5114ac", "239605", 5000],
  ["aad9f725-f4f0-4828-bbe1-4de9fb24b531", "239605", 8708.6],
  ["8dbf25c3-c891-4a02-9df0-0493f87fb432", "239606", 6000],
  ["ada27a86-f5a1-4a8a-a312-ef9f19decfd0", "239606", 5575],
  ["001a4b4c-f37f-4f91-b028-8596bb27e9f7", "239607", 10000],
  ["932dde93-2a0c-48e2-8b45-dd156035f8cc", "239607", 2256.1],
  ["76b9e16b-e026-4bc6-a58a-96078bef085d", "239608", 5000],
  ["0f174e06-b833-4b8f-9cb5-c9926790e4b1", "239608", 5193.05],
];
const unresolvedId = "2abdb9d0-be90-48b0-8288-9619ea20d667";

function envFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const split = line.indexOf("=");
      return [line.slice(0, split).trim(), line.slice(split + 1).trim()
        .replace(/^(['"])(.*)\1$/, "$2")];
    }));
}
function cents(value) { return Math.round(Number(value ?? 0) * 100); }
function money(value) { return cents(value) / 100; }
function assert(value, message) { if (!value) throw new Error(message); }
function ok(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = {
  ...envFile(path.resolve(root, "../Ottawa Painters App/.env.local")),
  ...envFile(path.resolve(root, ".env.local")), ...process.env,
};
const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
assert(url && env.SUPABASE_SERVICE_ROLE_KEY, "Missing Supabase credentials.");
assert(new URL(url).hostname.split(".")[0] === PROJECT_REF, "Wrong project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const paymentIds = [...payments.map(([id]) => id), unresolvedId];
const [contractorResult, invoiceResult, transactionResult, allocationResult] =
  await Promise.all([
    db.from("labour_contractors").select("id,supplier_name")
      .eq("id", CONTRACTOR_ID).single(),
    db.from("labour_invoices").select("*").eq("contractor_id", CONTRACTOR_ID),
    db.from("financial_transactions")
      .select("id,posted_on,amount,currency,transaction_type,category,source_data")
      .in("id", paymentIds),
    db.from("labour_payment_allocations").select("*")
      .in("financial_transaction_id", paymentIds).is("reversed_at", null),
  ]);
const contractor = ok("contractor", contractorResult);
const stored = ok("invoices", invoiceResult);
const bankRows = ok("transactions", transactionResult);
const existingAllocations = ok("allocations", allocationResult);
assert(contractor.supplier_name === "Caledonian Painting Ltd", "Contractor changed.");
assert(bankRows.length === paymentIds.length, "A reviewed bank row is missing.");
const bankById = new Map(bankRows.map((row) => [row.id, row]));
const invoiceByNumber = new Map(stored.map((row) => [row.invoice_number, row]));

for (const expected of invoices.filter((row) => row.id)) {
  const actual = invoiceByNumber.get(expected.number);
  assert(actual?.id === expected.id && actual.invoice_date === expected.date &&
    cents(actual.amount_before_tax) === cents(expected.net) &&
    cents(actual.tax_amount) === cents(expected.tax) &&
    cents(actual.amount_paid) === cents(expected.gross),
  `Archived invoice #${expected.number} changed.`);
}
for (const [id, number, amount] of payments) {
  const row = bankById.get(id);
  assert(row && cents(row.amount) === -cents(amount) && row.currency === "CAD" &&
    row.transaction_type === "expense" && row.category === "Sales commissions",
  `Bank payment ${id} changed.`);
  assert(invoices.some((invoice) => invoice.number === number), `Unknown invoice ${number}.`);
}
assert(cents(bankById.get(unresolvedId)?.amount) === -10000,
  "The separate $100 Caledonian transfer changed.");

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  physical_invoices: invoices.length,
  invoice_gross: money(invoices.reduce((sum, row) => sum + row.gross, 0)),
  invoice_hst: money(invoices.reduce((sum, row) => sum + row.tax, 0)),
  bank_rows_to_match: payments.length,
  allocated_gross: money(payments.reduce((sum, [, , amount]) => sum + amount, 0)),
  unresolved_payment: 100,
  invoice_239606_underpayment: 0.86,
}, null, 2));
if (!APPLY) process.exit(0);

let janInvoice = invoiceByNumber.get("371282");
if (!janInvoice) {
  assert(existsSync(JAN_PDF), "Invoice #371282 PDF is missing.");
  const pdf = readFileSync(JAN_PDF);
  const hash = createHash("sha256").update(pdf).digest("hex");
  assert(hash === "35ae65965f79e4441d7fbf2f0e5a3d551f6717f719d1aa47334c31a1810bc140",
    "Invoice #371282 hash changed.");
  const storagePath = `gmail-labour-invoices/2026-01-15/${hash.slice(0, 16)}-2026-01-15 - invoice-371282.pdf`;
  const upload = await db.storage.from("labour-invoices").upload(storagePath, pdf, {
    contentType: "application/pdf", upsert: false,
  });
  if (upload.error && !/already exists/i.test(upload.error.message)) throw upload.error;
  janInvoice = ok("invoice #371282 insert", await db.from("labour_invoices").insert({
    contractor_id: CONTRACTOR_ID, supplier_name: "Caledonian Painting Ltd",
    invoice_number: "371282", invoice_date: "2026-01-15", currency: "CAD",
    amount_paid: 4520, amount_before_tax: 4000, tax_amount: 520,
    payment_basis: "invoice_total", document_type: "invoice",
    match_status: "overhead_unmatched", storage_bucket: "labour-invoices",
    storage_path: storagePath, original_filename: "invoice-371282.pdf",
    mime_type: "application/pdf", file_size: statSync(JAN_PDF).size,
    content_sha256: hash, source_date: "2026-01-15",
    source_label: "Gmail / Labour Invoices", duplicate_group_size: 1,
    text_excerpt: "Invoice #371282 dated 2026-01-15. Base Sales Manager Cost $4,000.00; HST $520.00; invoice total $4,520.00. Gmail 19bc22252c52b71f. The PDF requests a 25% deposit, while the bank paid the full total on 2026-01-16.",
  }).select("*").single());
  ok("invoice #371282 line", await db.from("labour_invoice_lines").insert({
    invoice_id: janInvoice.id, line_number: 1,
    description: "Base sales manager cost", amount_before_tax: 4000,
    is_adjustment: false, source_kind: "extracted", needs_review: false,
    entry_type: "commission", quantity: 1, unit: "service", unit_price: 4000,
    tax_amount: 520,
    source_text: "Invoice #371282: Base Sales Manager Cost $4,000.00; HST $520.00; total $4,520.00.",
    source_reference: "gmail:19bc22252c52b71f:invoice:371282:line:1",
  }));
  invoiceByNumber.set("371282", janInvoice);
}

for (const [id, number, amount] of payments) {
  const bank = bankById.get(id);
  const invoice = invoiceByNumber.get(number);
  assert(invoice, `Invoice #${number} is missing.`);
  const active = existingAllocations.find((row) =>
    row.financial_transaction_id === id && row.invoice_id === invoice.id);
  if (active) {
    assert(cents(active.allocated_amount) === cents(amount),
      `Allocation ${id} changed.`);
  } else {
    ok(`payment record ${id}`, await db.from("labour_payment_records").upsert({
      financial_transaction_id: id, contractor_id: CONTRACTOR_ID,
      recipient_status: "confirmed", confirmation_method: "bank_record",
      confirmation_note: "SM Alba Premium Painting Ltd. is the Interac recipient for Caledonian Painting / Scott Madden; bank and archived invoice evidence were reviewed together.",
      confirmed_by: ADMIN_ID, confirmed_at: NOW, inserted_by: ADMIN_ID,
    }, { onConflict: "financial_transaction_id" }));
    const source = invoices.find((row) => row.number === number);
    ok(`allocation ${id}/${number}`, await db.from("labour_payment_allocations").insert({
      financial_transaction_id: id, invoice_id: invoice.id, allocated_amount: amount,
      match_method: ["supplier_identity", "archived_physical_invoice", "bank_record",
        cents(amount) === cents(invoice.amount_paid) ? "unique_exact_invoice_total" : "split_payment_component"],
      invoice_source_message_id: source.messageId,
      payment_confirmation_message_id: bank.source_data?.interac_gmail_message_id ?? null,
      confirmed_by: ADMIN_ID, confirmed_at: NOW, inserted_by: ADMIN_ID,
      notes: number === "239606"
        ? "Payments total $11,575.00 against invoice #239606 for $11,575.86; $0.86 remains unpaid."
        : `Bank payment allocated to archived Caledonian invoice #${number}.`,
    }));
  }
  ok(`transaction ${id}`, await db.from("financial_transactions").update({
    review_status: "reconciled",
    notes: number === "239606"
      ? "Allocated to Caledonian invoice #239606; $0.86 remains unpaid."
      : `Allocated to physical Caledonian invoice #${number}.`,
    source_data: { ...(bank.source_data ?? {}), caledonian_invoice_evidence: {
      status: "documented", supplier: "Caledonian Painting Ltd",
      legal_payment_recipient: "SM Alba Premium Painting Ltd.",
      invoice_number: number,
      invoice_gmail_message_id: invoices.find((row) => row.number === number).messageId,
      confirmed_on: "2026-08-02",
    }}, updated_at: NOW,
  }).eq("id", id));
}

const unresolved = bankById.get(unresolvedId);
ok("unresolved recipient", await db.from("labour_payment_records").upsert({
  financial_transaction_id: unresolvedId, contractor_id: CONTRACTOR_ID,
  recipient_status: "confirmed", confirmation_method: "bank_record",
  confirmation_note: "Recipient is confirmed as SM Alba / Caledonian, but no invoice or purpose evidence was found for this $100 transfer.",
  confirmed_by: ADMIN_ID, confirmed_at: NOW, inserted_by: ADMIN_ID,
}, { onConflict: "financial_transaction_id" }));
ok("unresolved annotation", await db.from("financial_transactions").update({
  review_status: "needs_review",
  notes: "Recipient verified as Caledonian / SM Alba. No invoice or purpose was found for this separate $100 transfer.",
  source_data: { ...(unresolved.source_data ?? {}), reconciliation_research: {
    status: "unresolved", reviewed_on: "2026-08-02",
    detail: "All seven located Caledonian invoices matched other bank payments. Gmail contains only the Interac confirmation for this $100 transfer.",
  }}, updated_at: NOW,
}).eq("id", unresolvedId));

const invoiceIds = invoices.map((row) => invoiceByNumber.get(row.number).id);
const [paymentVerification, invoiceVerification] = await Promise.all([
  db.from("labour_payment_verification")
    .select("financial_transaction_id,unallocated_amount,payment_status")
    .in("financial_transaction_id", payments.map(([id]) => id)),
  db.from("labour_invoice_verification")
    .select("invoice_id,paid_amount,amount_remaining,payment_status")
    .in("invoice_id", invoiceIds),
]);
const verifiedPayments = ok("payment verification", paymentVerification);
const verifiedInvoices = ok("invoice verification", invoiceVerification);
assert(verifiedPayments.length === payments.length && verifiedPayments.every((row) =>
  row.payment_status === "fully_allocated" && cents(row.unallocated_amount) === 0),
"A payment did not fully allocate.");
for (const expected of invoices) {
  const row = verifiedInvoices.find((item) =>
    item.invoice_id === invoiceByNumber.get(expected.number).id);
  const remaining = expected.gross - expected.expectedPaid;
  assert(row && cents(row.paid_amount) === cents(expected.expectedPaid) &&
    cents(row.amount_remaining) === cents(remaining) &&
    row.payment_status === (cents(remaining) ? "partially_paid" : "paid"),
  `Invoice #${expected.number} did not verify.`);
}
console.log(JSON.stringify({ applied: true, matched_bank_rows: payments.length,
  allocated_gross: money(payments.reduce((sum, [, , amount]) => sum + amount, 0)),
  unresolved_payment: 100, invoice_239606_underpayment: 0.86 }, null, 2));
