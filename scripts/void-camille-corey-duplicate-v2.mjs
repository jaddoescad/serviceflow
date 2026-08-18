#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const capturedAt = new Date().toISOString();
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const MANUAL_ID = "efb06982-65ce-5487-bdad-53e779300ac3";
const MANUAL_NUMBER = "MANUAL-20260722-CAMILLES-TEAM-01";
const MANUAL_TOTAL_CENTS = 60_000;
const JOB_ID = "f5f15bfe-5ac7-53da-9296-bfd1cfa8dd41";
const JOB_NAME = "Corey Parsons";
const GRUTENCO_ID = "73b992b2-425d-555e-891a-ff4ed455c8af";
const GRUTENCO_NUMBER = "GT-INV-202707-04";
const GRUTENCO_TOTAL_CENTS = 265_550;
const REASON =
  "Duplicate manual placeholder superseded by the archived Grutenco invoice GT-INV-202707-04, which contains the documented $600 Corey Parsons line and is fully paid.";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
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
  ...parseEnvFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.join(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const result = await db.from("invoices").select(
  "id,invoice_number,direction,category,source_system,status,issued_on,total_cents,paid_cents,balance_cents,metadata,updated_at,contact:contacts(name),job_allocations:invoice_job_allocations(id,invoice_line_id,job_id,subtotal_cents,total_cents,metadata,updated_at,job:jobs(id,name)),payment_allocations:transaction_allocations!transaction_allocations_invoice_id_fkey(id,reversed_at)",
).in("id", [MANUAL_ID, GRUTENCO_ID]);
if (result.error) throw result.error;
assert(result.data?.length === 2, `Expected two invoices; found ${result.data?.length ?? 0}.`);

const manual = result.data.find((row) => row.id === MANUAL_ID);
const grutenco = result.data.find((row) => row.id === GRUTENCO_ID);
assert(manual && grutenco, "Target invoice lookup failed.");

const alreadyVoid = ["void", "voided"].includes(String(manual.status).toLowerCase()) && manual.metadata?.accounting_status === "void";
assert(manual.invoice_number === MANUAL_NUMBER, "Manual reference changed.");
assert(manual.direction === "payable" && manual.category === "labour" && manual.source_system === "direct_labour_expense", "Manual classification changed.");
assert(manual.contact?.name === "Camille's Team", "Manual supplier changed.");
assert(Number(manual.total_cents) === MANUAL_TOTAL_CENTS, "Manual amount changed.");
assert(Number(manual.paid_cents) === 0 && Number(manual.balance_cents) === MANUAL_TOTAL_CENTS, "Manual row is no longer wholly unpaid.");
assert(alreadyVoid || manual.status === "recorded", `Unexpected manual status ${manual.status}.`);
assert((manual.payment_allocations ?? []).every((row) => row.reversed_at), "Manual row has an active payment allocation; refusing to void.");

const activeManualJobAllocations = (manual.job_allocations ?? []).filter((row) => !row.metadata?.reversed_at);
if (alreadyVoid) {
  assert(activeManualJobAllocations.length === 0, "Voided manual row still has an active job allocation.");
} else {
  assert(activeManualJobAllocations.length === 1, `Expected one active manual job allocation; found ${activeManualJobAllocations.length}.`);
  assert(activeManualJobAllocations[0].job_id === JOB_ID && activeManualJobAllocations[0].job?.name === JOB_NAME, "Manual job link changed.");
  assert(Number(activeManualJobAllocations[0].subtotal_cents) === MANUAL_TOTAL_CENTS, "Manual job allocation amount changed.");
}

assert(grutenco.invoice_number === GRUTENCO_NUMBER, "Grutenco invoice reference changed.");
assert(grutenco.contact?.name === "Grutenco Painting & Construction Services", "Grutenco supplier changed.");
assert(Number(grutenco.total_cents) === GRUTENCO_TOTAL_CENTS, "Grutenco invoice total changed.");
assert(Number(grutenco.paid_cents) === GRUTENCO_TOTAL_CENTS && Number(grutenco.balance_cents) === 0, "Grutenco invoice is no longer fully paid.");
assert(
  (grutenco.job_allocations ?? []).some(
    (row) => !row.metadata?.reversed_at && row.job_id === JOB_ID && Number(row.subtotal_cents) === MANUAL_TOTAL_CENTS,
  ),
  "The documented $600 Corey Parsons line is missing from Grutenco invoice.",
);

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  manual_placeholder: {
    id: manual.id,
    invoice_number: manual.invoice_number,
    supplier: manual.contact.name,
    total_cents: Number(manual.total_cents),
    current_status: manual.status,
    proposed_status: "void",
    job_allocations_to_reverse: activeManualJobAllocations.map((row) => row.id),
    already_void: alreadyVoid,
  },
  preserved_source_invoice: {
    id: grutenco.id,
    invoice_number: grutenco.invoice_number,
    total_cents: Number(grutenco.total_cents),
    paid_cents: Number(grutenco.paid_cents),
    balance_cents: Number(grutenco.balance_cents),
  },
  scope: "Void the manual placeholder and reverse its job-cost allocation only. Preserve the Grutenco invoice and payment evidence unchanged.",
}, null, 2));

if (!APPLY || alreadyVoid) process.exit(0);

for (const allocation of activeManualJobAllocations) {
  const reversal = await db.from("invoice_job_allocations").update({
    metadata: {
      ...(allocation.metadata ?? {}),
      reversed_at: capturedAt,
      reversal_reason: REASON,
      superseded_by_invoice_id: GRUTENCO_ID,
    },
    updated_at: capturedAt,
  }).eq("id", allocation.id).eq("updated_at", allocation.updated_at).select("id").maybeSingle();
  if (reversal.error) throw reversal.error;
  if (!reversal.data) throw new Error(`Concurrent allocation update for ${allocation.id}; stopped.`);
}

const invoiceUpdate = await db.from("invoices").update({
  status: "void",
  paid_cents: 0,
  balance_cents: MANUAL_TOTAL_CENTS,
  metadata: {
    ...(manual.metadata ?? {}),
    accounting_status: "void",
    void_reason: REASON,
    voided_at: capturedAt,
    voided_by: "user_request",
    superseded_by_invoice_id: GRUTENCO_ID,
    preserved_evidence: true,
    previous_status: manual.status,
  },
  updated_at: capturedAt,
}).eq("id", MANUAL_ID).eq("updated_at", manual.updated_at).select("id").maybeSingle();
if (invoiceUpdate.error) throw invoiceUpdate.error;
if (!invoiceUpdate.data) throw new Error("Concurrent manual-invoice update; stopped.");

const event = await db.from("verification_events").upsert({
  id: stableUuid(`verification:void-duplicate-camille-corey:${MANUAL_ID}`),
  entity_type: "invoice",
  entity_id: MANUAL_ID,
  action: "duplicate_manual_invoice_voided",
  reason: REASON,
  old_values: {
    status: manual.status,
    paid_cents: Number(manual.paid_cents),
    balance_cents: Number(manual.balance_cents),
    active_job_allocation_ids: activeManualJobAllocations.map((row) => row.id),
  },
  new_values: {
    status: "void",
    paid_cents: 0,
    balance_cents: MANUAL_TOTAL_CENTS,
    active_job_allocation_ids: [],
  },
  evidence: {
    user_request: true,
    manual_invoice_id: MANUAL_ID,
    source_invoice_id: GRUTENCO_ID,
    source_invoice_number: GRUTENCO_NUMBER,
    job_id: JOB_ID,
    job_name: JOB_NAME,
    documented_line_subtotal_cents: MANUAL_TOTAL_CENTS,
    source_invoice_paid_cents: GRUTENCO_TOTAL_CENTS,
    preserved_not_deleted: true,
  },
  occurred_at: capturedAt,
}, { onConflict: "id" });
if (event.error) throw event.error;

const verify = await db.from("invoices").select(
  "id,invoice_number,status,total_cents,paid_cents,balance_cents,metadata,updated_at,job_allocations:invoice_job_allocations(id,job_id,subtotal_cents,metadata),payment_allocations:transaction_allocations!transaction_allocations_invoice_id_fkey(id,reversed_at)",
).in("id", [MANUAL_ID, GRUTENCO_ID]);
if (verify.error) throw verify.error;
const manualAfter = verify.data.find((row) => row.id === MANUAL_ID);
const grutencoAfter = verify.data.find((row) => row.id === GRUTENCO_ID);
assert(manualAfter?.status === "void" && manualAfter.metadata?.accounting_status === "void", "Manual void verification failed.");
assert((manualAfter.job_allocations ?? []).every((row) => row.metadata?.reversed_at), "Manual job allocation reversal verification failed.");
assert(Number(grutencoAfter?.total_cents) === GRUTENCO_TOTAL_CENTS, "Grutenco total changed unexpectedly.");
assert(Number(grutencoAfter?.paid_cents) === GRUTENCO_TOTAL_CENTS && Number(grutencoAfter?.balance_cents) === 0, "Grutenco payment state changed unexpectedly.");
assert(grutencoAfter?.updated_at === grutenco.updated_at, "Grutenco invoice was unexpectedly updated.");

console.log(JSON.stringify({
  status: "verified",
  voided_manual_invoice_id: MANUAL_ID,
  reversed_job_allocation_ids: activeManualJobAllocations.map((row) => row.id),
  preserved_grutenco_invoice_id: GRUTENCO_ID,
  preserved_grutenco_paid_cents: GRUTENCO_TOTAL_CENTS,
}, null, 2));
