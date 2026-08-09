#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const INVOICE_ID = "cc569974-f585-5924-82ba-56ccf533cf0b";
const INVOICE_NUMBER = "8128-6";
const JOB_ID = "4499ebe1-cad6-545e-8498-6fb47ba36839";
const JOB_NAME = "Sheila McSwiggan";
const now = new Date().toISOString();
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function envFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        let value = line.slice(index + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [line.slice(0, index).trim(), value];
      }),
  );
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

const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [{ data: invoice, error: invoiceError }, { data: job, error: jobError }] = await Promise.all([
  db
    .from("invoices")
    .select("*,lines:invoice_lines(*),allocations:invoice_job_allocations(*)")
    .eq("id", INVOICE_ID)
    .single(),
  db.from("jobs").select("*").eq("id", JOB_ID).single(),
]);
if (invoiceError) throw invoiceError;
if (jobError) throw jobError;

if (
  invoice.invoice_number !== INVOICE_NUMBER ||
  invoice.source_system !== "sherwin_daily_email" ||
  invoice.category !== "material" ||
  invoice.issued_on !== "2026-07-11" ||
  Number(invoice.subtotal_cents) !== 15288 ||
  Number(invoice.tax_cents) !== 1987 ||
  Number(invoice.total_cents) !== 17275 ||
  invoice.metadata?.po_number !== "NEXT R - MICHAEL"
) {
  throw new Error("Sherwin invoice 8128-6 preconditions changed.");
}
if (
  job.name !== JOB_NAME ||
  job.status !== "completed" ||
  job.started_on !== "2026-07-13" ||
  job.completed_on !== "2026-07-14" ||
  job.metadata?.source_payload?.["Invoice ID"] !== "#469101" ||
  job.metadata?.source_payload?.["Job Schedule Date"] !== "Sat. Jul 11 - Sat. Jul 11"
) {
  throw new Error("Sheila job preconditions changed.");
}

const lines = [...(invoice.lines ?? [])].sort((left, right) => left.line_number - right.line_number);
if (
  lines.length !== 3 ||
  lines.reduce((sum, line) => sum + Number(line.subtotal_cents), 0) !== 15288 ||
  lines.reduce((sum, line) => sum + Number(line.tax_cents), 0) !== 1987 ||
  lines.reduce((sum, line) => sum + Number(line.total_cents), 0) !== 17275
) {
  throw new Error("Invoice line arithmetic changed.");
}

const expectedAllocationIds = new Set(
  lines.map((line) => uuid(`invoice-job-allocation:${line.id}:${JOB_ID}:user-confirmed-sheila-8128-6`)),
);
const activeAllocations = (invoice.allocations ?? []).filter((row) => !row.metadata?.reversed_at);
const unexpectedAllocations = activeAllocations.filter(
  (row) => !expectedAllocationIds.has(row.id) || row.job_id !== JOB_ID,
);
if (unexpectedAllocations.length > 0) {
  throw new Error(`Invoice gained ${unexpectedAllocations.length} unexpected active job allocation(s).`);
}

const evidence = {
  status: "user_confirmed",
  confirmation: "User identified the complete Sherwin invoice 8128-6 as material for the Sheila McSwiggan job.",
  customer_invoice_number: "469101",
  customer_invoice_scope: "Gazebo — solid exterior paint, not semi-transparent stain",
  supplier_invoice_number: INVOICE_NUMBER,
  supplier_invoice_date: "2026-07-11",
  supplier_po_number: "NEXT R - MICHAEL",
  supplier_product: "SuperDeck waterborne solid ultradeep — SW6991 Black Magic",
  job_schedule_date: "2026-07-11",
  job_started_on: "2026-07-13",
  job_completed_on: "2026-07-14",
  receipt_received_by: "MIKE",
  confirmed_at:
    invoice.metadata?.job_costing_classification?.evidence?.confirmed_at ?? now,
};

const allocations = lines.map((line) => ({
  id: uuid(`invoice-job-allocation:${line.id}:${JOB_ID}:user-confirmed-sheila-8128-6`),
  invoice_id: INVOICE_ID,
  invoice_line_id: line.id,
  job_id: JOB_ID,
  subtotal_cents: Number(line.subtotal_cents),
  tax_cents: Number(line.tax_cents),
  total_cents: Number(line.total_cents),
  allocation_method: "user_confirmed_scope_date_product_match",
  confidence: 1,
  needs_review: false,
  metadata: {
    allocation_scope: "job",
    entry_type: "material",
    evidence,
  },
  created_at:
    activeAllocations.find(
      (row) =>
        row.id ===
        uuid(`invoice-job-allocation:${line.id}:${JOB_ID}:user-confirmed-sheila-8128-6`),
    )?.created_at ?? now,
  updated_at: now,
}));

const preview = {
  invoice: {
    id: INVOICE_ID,
    number: INVOICE_NUMBER,
    issued_on: invoice.issued_on,
    po_number: invoice.metadata?.po_number,
    subtotal_cents: Number(invoice.subtotal_cents),
    tax_cents: Number(invoice.tax_cents),
    total_cents: Number(invoice.total_cents),
  },
  job: {
    id: JOB_ID,
    name: JOB_NAME,
    customer_invoice_number: "469101",
    started_on: job.started_on,
    completed_on: job.completed_on,
  },
  line_allocations: allocations.map((allocation) => ({
    id: allocation.id,
    invoice_line_id: allocation.invoice_line_id,
    description: lines.find((line) => line.id === allocation.invoice_line_id)?.description,
    subtotal_cents: allocation.subtotal_cents,
    tax_cents: allocation.tax_cents,
    total_cents: allocation.total_cents,
  })),
};

if (!APPLY) {
  console.log(JSON.stringify({ mode: "dry-run", ...preview }, null, 2));
  process.exit(0);
}

const allocationWrite = await db
  .from("invoice_job_allocations")
  .upsert(allocations, { onConflict: "id" });
if (allocationWrite.error) throw allocationWrite.error;

for (const line of lines) {
  const previous = line.metadata?.non_job_classification ?? null;
  const update = await db
    .from("invoice_lines")
    .update({
      metadata: {
        ...(line.metadata ?? {}),
        non_job_classification: previous
          ? {
              ...previous,
              previous_status: previous.previous_status ?? previous.status,
              status: "reversed",
              reversed_at: now,
              reversal_reason: "User confirmed Sherwin invoice 8128-6 belongs to Sheila McSwiggan invoice 469101.",
            }
          : null,
        job_cost_classification: {
          status: "allocated",
          job_id: JOB_ID,
          job_name: JOB_NAME,
          subtotal_cents: Number(line.subtotal_cents),
          evidence,
        },
      },
      updated_at: now,
    })
    .eq("id", line.id);
  if (update.error) throw update.error;
}

const invoiceUpdate = await db
  .from("invoices")
  .update({
    metadata: {
      ...(invoice.metadata ?? {}),
      prior_job_costing_classification: invoice.metadata?.job_costing_classification ?? null,
      job_costing_classification: {
        status: "job_allocated",
        job_id: JOB_ID,
        job_name: JOB_NAME,
        subtotal_cents: 15288,
        evidence,
      },
    },
    updated_at: now,
  })
  .eq("id", INVOICE_ID);
if (invoiceUpdate.error) throw invoiceUpdate.error;

const { data: verified, error: verifyError } = await db
  .from("invoices")
  .select("*,lines:invoice_lines(*),allocations:invoice_job_allocations(*)")
  .eq("id", INVOICE_ID)
  .single();
if (verifyError) throw verifyError;

const verifiedAllocations = (verified.allocations ?? []).filter(
  (row) => !row.metadata?.reversed_at && row.job_id === JOB_ID && expectedAllocationIds.has(row.id),
);
if (
  verifiedAllocations.length !== 3 ||
  verifiedAllocations.reduce((sum, row) => sum + Number(row.subtotal_cents), 0) !== 15288 ||
  verifiedAllocations.reduce((sum, row) => sum + Number(row.total_cents), 0) !== 17275 ||
  verified.metadata?.job_costing_classification?.status !== "job_allocated" ||
  (verified.lines ?? []).some((line) =>
    line.metadata?.non_job_classification && !line.metadata.non_job_classification.reversed_at,
  )
) {
  throw new Error("Post-apply verification failed.");
}

console.log(JSON.stringify({ mode: "applied", ...preview }, null, 2));
