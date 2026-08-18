#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CONTACT_ID = "0110b963-3742-5c29-b42b-24b1be0f23fa";
const SUPPLIER = "Assmaâ Senni";
const CONFIRMED_ON = "2026-08-17";
const APPLY = process.argv.includes("--apply");
const capturedAt = new Date().toISOString();
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const expected = new Map([
  ["8307ffc8-a1cb-52ce-b272-595179189d81", ["2026-001", "2026-03-02", 27_600, "overhead_unmatched"]],
  ["6306b7c1-0b54-504c-9d06-056fc5464d34", ["2026-002", "2026-03-10", 27_000, "overhead_unmatched"]],
  ["975d2a68-f544-53a1-a8e1-b8ba164acb8f", ["2026-003", "2026-03-17", 26_800, "overhead_unmatched"]],
  ["ec0f6c99-98d8-5d6c-b7cb-f49701d604c8", ["2026-004", "2026-03-26", 27_200, "overhead_unmatched"]],
  ["815dfd7c-fc5a-5bc6-9cda-dfc9deb079be", ["2026-005", "2026-04-02", 27_200, "overhead_unmatched"]],
  ["1b384c2d-8d90-5254-a841-8c3427d971b2", ["2026-006", "2026-04-13", 115_200, "overhead_unmatched"]],
  ["462d5af5-87f3-57ac-9643-d24afdfd97c5", ["2026-007", "2026-05-15", 14_000, "overhead_unmatched"]],
  ["13e15fdd-093c-5adf-a3cb-c4b5568c34e5", ["2026-008", "2026-06-03", 125_000, "overhead_unmatched"]],
  ["dbdb9123-92d3-581e-b696-1d696da5de17", ["2026-009", "2026-07-02", 140_000, "overhead_unmatched"]],
  ["983bb2eb-b35e-55ec-bfc4-e47829844c26", ["2026-010", "2026-07-13", 211_200, "overhead_unmatched"]],
  ["be93893b-67a8-5a04-8056-fc7564fbc893", ["2026-011", "2026-08-04", 25_000, "open"]],
]);

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
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

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Refusing to update an unexpected Supabase project.");
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const result = await db.from("invoices").select(
  "id,contact_id,invoice_number,issued_on,direction,category,source_system,status,total_cents,paid_cents,balance_cents,metadata,updated_at,contact:contacts(name),job_allocations:invoice_job_allocations(id,metadata),payment_allocations:transaction_allocations!transaction_allocations_invoice_id_fkey(id,amount_cents,reversed_at)",
).eq("contact_id", CONTACT_ID).order("issued_on");
if (result.error) throw result.error;
assert(result.data?.length === expected.size, `Expected ${expected.size} Assmaa invoices; found ${result.data?.length ?? 0}.`);

const plans = result.data.map((invoice) => {
  const target = expected.get(invoice.id);
  assert(target, `Unexpected Assmaa invoice ${invoice.id}.`);
  const [invoiceNumber, issuedOn, totalCents, originalStatus] = target;
  assert(invoice.contact?.name === SUPPLIER, `Supplier identity changed for ${invoice.id}.`);
  assert(invoice.invoice_number === invoiceNumber && invoice.issued_on === issuedOn, `Invoice identity changed for ${invoice.id}.`);
  assert(invoice.direction === "payable", `${invoiceNumber} is no longer a payable.`);
  assert(Number(invoice.total_cents) === totalCents, `Total changed for ${invoiceNumber}.`);
  assert((invoice.job_allocations ?? []).length === 0, `${invoiceNumber} unexpectedly has a job allocation.`);
  assert((invoice.payment_allocations ?? []).filter((row) => !row.reversed_at).length === 0, `${invoiceNumber} has a bank payment allocation; use bank reconciliation instead.`);
  const alreadyConfirmed = invoice.status === "paid" && invoice.metadata?.payment_confirmation?.status === "paid" && invoice.metadata?.payment_confirmation?.confirmation_method === "user_confirmation";
  assert(alreadyConfirmed || invoice.status === originalStatus, `${invoiceNumber} status changed from the reviewed state.`);
  if (alreadyConfirmed) {
    assert(Number(invoice.paid_cents) === totalCents && Number(invoice.balance_cents) === 0, `${invoiceNumber} confirmed-paid totals changed.`);
  } else if (originalStatus === "overhead_unmatched") {
    assert(Number(invoice.paid_cents) === totalCents && Number(invoice.balance_cents) === 0, `${invoiceNumber} legacy paid totals changed.`);
  } else {
    assert(Number(invoice.paid_cents) === 0 && Number(invoice.balance_cents) === totalCents, `${invoiceNumber} open balance changed.`);
  }
  return { invoice, invoiceNumber, totalCents, originalStatus, alreadyConfirmed };
});

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  supplier: SUPPLIER,
  invoice_count: plans.length,
  total_cents: plans.reduce((sum, plan) => sum + plan.totalCents, 0),
  invoices: plans.map((plan) => ({
    id: plan.invoice.id,
    invoice_number: plan.invoiceNumber,
    issued_on: plan.invoice.issued_on,
    total_cents: plan.totalCents,
    current_status: plan.invoice.status,
    proposed_status: "paid",
    active_bank_allocations: 0,
    confirmation: "user_confirmation",
    already_confirmed: plan.alreadyConfirmed,
  })),
  warning: "No bank transaction is being invented or matched; the dashboard will identify these as user-confirmed paid.",
  untouched: ["jobs", "job allocations", "budgets", "production months", "bank transactions"],
}, null, 2));
if (!APPLY || plans.every((plan) => plan.alreadyConfirmed)) process.exit(0);

for (const plan of plans) {
  if (plan.alreadyConfirmed) continue;
  const update = await db.from("invoices").update({
    status: "paid",
    paid_cents: plan.totalCents,
    balance_cents: 0,
    metadata: {
      ...(plan.invoice.metadata ?? {}),
      match_status: plan.originalStatus === "overhead_unmatched" ? "overhead_unmatched" : plan.invoice.metadata?.match_status,
      job_allocation_required: false,
      previous_status: plan.originalStatus,
      payment_confirmation: {
        status: "paid",
        confirmation_method: "user_confirmation",
        confirmed_on: CONFIRMED_ON,
        confirmed_at: capturedAt,
        confirmed_scope: "all_supplier_invoices",
        bank_transaction_id: null,
        bank_match_status: "not_recorded",
      },
    },
    updated_at: capturedAt,
  }).eq("id", plan.invoice.id).eq("updated_at", plan.invoice.updated_at).select("id").maybeSingle();
  if (update.error) throw update.error;
  if (!update.data) throw new Error(`Concurrent update for ${plan.invoiceNumber}; stopped.`);

  const event = await db.from("verification_events").upsert({
    id: stableUuid(`verification:assmaa-user-confirmed-paid:${plan.invoice.id}:${CONFIRMED_ON}`),
    entity_type: "invoice",
    entity_id: plan.invoice.id,
    action: "invoice_marked_paid_by_user_confirmation",
    reason: "Ottawa Painters explicitly requested that all Assmaâ Senni invoices be marked paid.",
    old_values: { status: plan.invoice.status, paid_cents: plan.invoice.paid_cents, balance_cents: plan.invoice.balance_cents },
    new_values: { status: "paid", paid_cents: plan.totalCents, balance_cents: 0 },
    evidence: { supplier: SUPPLIER, invoice_number: plan.invoiceNumber, issued_on: plan.invoice.issued_on, total_cents: plan.totalCents, confirmation_method: "user_confirmation", confirmed_on: CONFIRMED_ON, bank_transaction_matched: false },
    occurred_at: capturedAt,
  }, { onConflict: "id" });
  if (event.error) throw event.error;
}

const verification = await db.from("invoices").select(
  "id,invoice_number,status,total_cents,paid_cents,balance_cents,metadata,job_allocations:invoice_job_allocations(id),payment_allocations:transaction_allocations!transaction_allocations_invoice_id_fkey(id,reversed_at)",
).eq("contact_id", CONTACT_ID).order("issued_on");
if (verification.error) throw verification.error;
assert(verification.data?.length === expected.size, "Post-write invoice count changed.");
for (const invoice of verification.data) {
  assert(invoice.status === "paid", `${invoice.invoice_number} is not paid.`);
  assert(Number(invoice.paid_cents) === Number(invoice.total_cents) && Number(invoice.balance_cents) === 0, `${invoice.invoice_number} paid totals failed verification.`);
  assert(invoice.metadata?.payment_confirmation?.confirmation_method === "user_confirmation", `${invoice.invoice_number} confirmation metadata is missing.`);
  assert((invoice.job_allocations ?? []).length === 0, `${invoice.invoice_number} gained a job allocation.`);
  assert((invoice.payment_allocations ?? []).filter((row) => !row.reversed_at).length === 0, `${invoice.invoice_number} gained a bank allocation.`);
}
console.log(JSON.stringify({ status: "verified", supplier: SUPPLIER, paid_invoice_count: verification.data.length, paid_total_cents: verification.data.reduce((sum, invoice) => sum + Number(invoice.total_cents), 0), bank_allocations_created: 0, job_allocations_changed: 0 }, null, 2));
