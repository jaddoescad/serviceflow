#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const capturedAt = new Date().toISOString();
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REASON = "Voided at the user's request; this management-entered record must not be payable or contribute to job cost.";

const targets = [
  {
    id: "cba821d8-4770-58a7-845a-90188e0e0f56",
    invoiceNumber: "INV-20260615-001",
    issuedOn: "2026-06-15",
    totalCents: 10_400,
    jobName: "Danielle Hards",
    jobStartedOn: "2026-06-08",
  },
  {
    id: "fd9bbf9f-74b3-5639-bcf5-d05a505f0cb8",
    invoiceNumber: "INV-20260615-001",
    issuedOn: "2026-06-15",
    totalCents: 52_000,
    jobName: "Donna Quigley",
    jobStartedOn: "2026-06-12",
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
const ids = targets.map((target) => target.id);

const invoicesResult = await db.from("invoices").select(
  "id,invoice_number,direction,category,source_system,status,issued_on,total_cents,paid_cents,balance_cents,metadata,updated_at,contact:contacts(id,name),job_allocations:invoice_job_allocations(id,invoice_id,invoice_line_id,job_id,subtotal_cents,total_cents,needs_review,metadata,updated_at,job:jobs(id,name,status,started_on,completed_on,production_month)),payment_allocations:transaction_allocations!transaction_allocations_invoice_id_fkey(id,invoice_id,transaction_id,amount_cents,reversed_at)",
).in("id", ids);
if (invoicesResult.error) throw invoicesResult.error;
assert(invoicesResult.data?.length === targets.length, `Expected ${targets.length} invoices; found ${invoicesResult.data?.length ?? 0}.`);

const plans = targets.map((target) => {
  const invoice = invoicesResult.data.find((row) => row.id === target.id);
  assert(invoice, `Missing target invoice ${target.id}.`);
  const alreadyVoid = ["void", "voided"].includes(String(invoice.status).toLowerCase()) && invoice.metadata?.accounting_status === "void";
  assert(invoice.invoice_number === target.invoiceNumber, `Invoice number changed for ${target.id}.`);
  assert(invoice.issued_on === target.issuedOn, `Invoice date changed for ${target.id}.`);
  assert(invoice.direction === "payable" && invoice.category === "labour", `Invoice classification changed for ${target.id}.`);
  assert(invoice.source_system === "direct_labour_expense", `Invoice source changed for ${target.id}.`);
  assert(invoice.contact?.name === "Abdellah Aouf", `Supplier changed for ${target.id}.`);
  assert(Number(invoice.total_cents) === target.totalCents, `Invoice total changed for ${target.id}.`);
  assert(Number(invoice.paid_cents) === 0 && Number(invoice.balance_cents) === target.totalCents, `Invoice ${target.id} is no longer wholly unpaid.`);
  assert(alreadyVoid || invoice.status === "recorded", `Invoice ${target.id} has unexpected status ${invoice.status}.`);
  const activePayments = (invoice.payment_allocations ?? []).filter((row) => !row.reversed_at);
  assert(activePayments.length === 0, `Invoice ${target.id} has an active bank/payment allocation; refusing to void.`);
  const usableJobAllocations = (invoice.job_allocations ?? []).filter((row) => !row.metadata?.reversed_at);
  if (!alreadyVoid) {
    assert(usableJobAllocations.length === 1, `Expected one active job allocation for ${target.id}; found ${usableJobAllocations.length}.`);
    const allocation = usableJobAllocations[0];
    assert(allocation.job?.name === target.jobName, `Job changed for ${target.id}.`);
    assert(allocation.job?.started_on === target.jobStartedOn, `Job start date changed for ${target.id}.`);
    assert(Number(allocation.subtotal_cents) === target.totalCents && Number(allocation.total_cents) === target.totalCents, `Job allocation amount changed for ${target.id}.`);
  } else {
    assert((invoice.job_allocations ?? []).every((row) => row.metadata?.reversed_at), `Voided invoice ${target.id} still has an active job allocation.`);
  }
  const jobAllocation = (invoice.job_allocations ?? [])[0];
  assert(jobAllocation?.job?.name === target.jobName, `Historical job evidence is missing for ${target.id}.`);
  return { target, invoice, activePayments, usableJobAllocations, alreadyVoid, jobBefore: { ...jobAllocation.job } };
});

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  invoices: plans.map(({ target, invoice, usableJobAllocations, alreadyVoid }) => ({
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    supplier: invoice.contact.name,
    job: target.jobName,
    total_cents: invoice.total_cents,
    current_status: invoice.status,
    proposed_status: "void",
    active_payment_allocations: 0,
    job_allocations_to_reverse: usableJobAllocations.map((row) => row.id),
    already_void: alreadyVoid,
  })),
  scope: "Invoice status and invoice-job allocation reversal only; no job, budget, receipt, date, production-month, or bank-transaction changes.",
}, null, 2));
if (!APPLY || plans.every((plan) => plan.alreadyVoid)) process.exit(0);

for (const plan of plans) {
  if (plan.alreadyVoid) continue;
  for (const allocation of plan.usableJobAllocations) {
    const reversal = await db.from("invoice_job_allocations").update({
      metadata: { ...(allocation.metadata ?? {}), reversed_at: capturedAt, reversal_reason: REASON, voided_invoice_id: plan.invoice.id },
      updated_at: capturedAt,
    }).eq("id", allocation.id).eq("updated_at", allocation.updated_at).select("id").maybeSingle();
    if (reversal.error) throw reversal.error;
    if (!reversal.data) throw new Error(`Concurrent job-allocation update for ${allocation.id}; stopped.`);
  }

  const invoiceUpdate = await db.from("invoices").update({
    status: "void",
    paid_cents: 0,
    balance_cents: Number(plan.invoice.total_cents),
    metadata: {
      ...(plan.invoice.metadata ?? {}),
      accounting_status: "void",
      void_reason: "User requested that this management-entered Abdellah Aouf invoice be voided.",
      voided_at: capturedAt,
      voided_by: "user_request",
      preserved_evidence: true,
      previous_status: plan.invoice.status,
    },
    updated_at: capturedAt,
  }).eq("id", plan.invoice.id).eq("updated_at", plan.invoice.updated_at).select("id").maybeSingle();
  if (invoiceUpdate.error) throw invoiceUpdate.error;
  if (!invoiceUpdate.data) throw new Error(`Concurrent invoice update for ${plan.invoice.id}; stopped.`);

  const event = await db.from("verification_events").upsert({
    id: stableUuid(`verification:invoice-voided-by-user-request:${plan.invoice.id}`),
    entity_type: "invoice",
    entity_id: plan.invoice.id,
    action: "invoice_voided_by_user_request",
    reason: REASON,
    old_values: { status: plan.invoice.status, paid_cents: plan.invoice.paid_cents, balance_cents: plan.invoice.balance_cents, active_job_allocation_ids: plan.usableJobAllocations.map((row) => row.id) },
    new_values: { status: "void", paid_cents: 0, balance_cents: Number(plan.invoice.total_cents), active_job_allocation_ids: [] },
    evidence: { user_request: true, supplier: plan.invoice.contact.name, invoice_number: plan.invoice.invoice_number, issued_on: plan.invoice.issued_on, total_cents: plan.invoice.total_cents, job_id: plan.jobBefore.id, job_name: plan.jobBefore.name, preserved_not_deleted: true },
    occurred_at: capturedAt,
  }, { onConflict: "id" });
  if (event.error) throw event.error;
}

const verifiedResult = await db.from("invoices").select(
  "id,status,total_cents,paid_cents,balance_cents,metadata,job_allocations:invoice_job_allocations(id,metadata,job:jobs(id,name,status,started_on,completed_on,production_month)),payment_allocations:transaction_allocations!transaction_allocations_invoice_id_fkey(id,reversed_at)",
).in("id", ids);
if (verifiedResult.error) throw verifiedResult.error;
for (const plan of plans) {
  const invoice = verifiedResult.data.find((row) => row.id === plan.invoice.id);
  assert(invoice?.status === "void" && invoice.metadata?.accounting_status === "void", `Void status verification failed for ${plan.invoice.id}.`);
  assert(Number(invoice.paid_cents) === 0 && Number(invoice.balance_cents) === Number(invoice.total_cents), `Unpaid balance verification failed for ${plan.invoice.id}.`);
  assert((invoice.job_allocations ?? []).every((row) => row.metadata?.reversed_at), `Job allocation reversal verification failed for ${plan.invoice.id}.`);
  assert((invoice.payment_allocations ?? []).every((row) => row.reversed_at), `Unexpected active payment allocation for ${plan.invoice.id}.`);
  const jobAfter = invoice.job_allocations[0].job;
  assert(JSON.stringify(jobAfter) === JSON.stringify(plan.jobBefore), `Job ${plan.target.jobName} changed unexpectedly.`);
}
console.log(JSON.stringify({ status: "verified", voided_invoice_ids: ids, voided_total_cents: targets.reduce((sum, target) => sum + target.totalCents, 0), active_job_allocations: 0, active_payment_allocations: 0 }, null, 2));
