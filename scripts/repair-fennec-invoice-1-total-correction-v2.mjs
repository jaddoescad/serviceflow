#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const INVOICE_ID = "738f052f-6f7c-5f18-b5c6-6c75ebc76a01";
const CORRECTION_LINE_ID = "dab1a25e-80b2-5f8b-a9a3-a563267e1199";
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

const { data: invoice, error } = await db.from("invoices")
  .select("id,invoice_number,subtotal_cents,tax_cents,total_cents,metadata,lines:invoice_lines(*),job_allocations:invoice_job_allocations(*)")
  .eq("id", INVOICE_ID)
  .single();
if (error) throw error;
if (invoice.invoice_number !== "1" || Number(invoice.subtotal_cents) !== 369000 || Number(invoice.total_cents) !== 369000) throw new Error("Fennec invoice #1 totals changed.");
const correctionLine = invoice.lines.find((row) => row.id === CORRECTION_LINE_ID);
if (!correctionLine || Number(correctionLine.subtotal_cents) !== -1500 || correctionLine.description !== "Printed-total correction — detailed hours exceed invoice total") throw new Error("Fennec correction line changed.");

const activePositive = invoice.job_allocations.filter((row) => !row.metadata?.reversed_at && row.invoice_line_id && row.invoice_line_id !== CORRECTION_LINE_ID);
const byJob = new Map();
for (const row of activePositive) byJob.set(row.job_id, (byJob.get(row.job_id) ?? 0) + Number(row.subtotal_cents));
const expected = new Map([
  ["0842152d-9d95-5160-9243-403e278d9018", [60750, -246]],
  ["2d8c4129-67a4-55e1-ac96-71a76fbe5594", [48000, -194]],
  ["06dd173d-ceb9-5e5c-b59b-ddd8d6c6d9e2", [54750, -222]],
  ["ad273558-c0ef-5abf-bf9c-6aad8178d886", [54000, -219]],
  ["fa9d5e0b-4192-5251-8d16-5d7d7dd0ac16", [54000, -219]],
  ["12fd7d4d-7648-5360-ae20-2bcc02e64498", [51000, -206]],
  ["b33ba56b-eb80-5496-8104-7ce504d7354c", [48000, -194]],
]);
if (byJob.size !== expected.size) throw new Error("Unexpected job set on Fennec invoice #1.");
for (const [jobId, [positive]] of expected) if (byJob.get(jobId) !== positive) throw new Error(`Positive allocation changed for job ${jobId}.`);
if ([...expected.values()].reduce((sum, [, correction]) => sum + correction, 0) !== -1500) throw new Error("Correction distribution does not total -$15.00.");

const writes = [...expected.entries()].map(([jobId, [positive, correction]]) => ({
  id: uuid(`invoice-job-allocation:${CORRECTION_LINE_ID}:${jobId}:proportional-total-correction`),
  invoice_id: INVOICE_ID,
  invoice_line_id: CORRECTION_LINE_ID,
  job_id: jobId,
  subtotal_cents: correction,
  tax_cents: 0,
  total_cents: correction,
  allocation_method: "invoice_total_correction_proportional_to_printed_work",
  confidence: 1,
  needs_review: false,
  metadata: {
    source: "printed_invoice_total_correction",
    positive_job_subtotal_cents: positive,
    correction_basis_cents: 370500,
    correction_total_cents: -1500,
    repair_reason: "The printed invoice contains a -$15 total correction after detailed job lines; the discount is distributed proportionally so job costs equal the supplier invoice.",
  },
  created_at: now,
  updated_at: now,
}));

if (!APPLY) {
  console.log(JSON.stringify({ mode: "dry-run", invoice_id: INVOICE_ID, correction_cents: -1500, allocations: writes.map((row) => ({ job_id: row.job_id, subtotal_cents: row.subtotal_cents })) }, null, 2));
  process.exit(0);
}

const write = await db.from("invoice_job_allocations").upsert(writes, { onConflict: "id" });
if (write.error) throw write.error;
const update = await db.from("invoices").update({
  metadata: {
    ...(invoice.metadata ?? {}),
    job_costing_total_correction: {
      status: "allocated",
      correction_cents: -1500,
      allocation_method: "proportional_to_printed_work_by_job",
      repaired_at: now,
    },
  },
  updated_at: now,
}).eq("id", INVOICE_ID);
if (update.error) throw update.error;

const { data: verified, error: verifyError } = await db.from("invoice_job_allocations").select("id,subtotal_cents,needs_review").eq("invoice_id", INVOICE_ID);
if (verifyError) throw verifyError;
const active = invoice.job_allocations.filter((row) => !row.metadata?.reversed_at && row.invoice_line_id && row.invoice_line_id !== CORRECTION_LINE_ID).reduce((sum, row) => sum + Number(row.subtotal_cents), 0) +
  verified.filter((row) => writes.some((writeRow) => writeRow.id === row.id)).reduce((sum, row) => sum + Number(row.subtotal_cents), 0);
if (active !== 369000 || writes.some((row) => !verified.find((stored) => stored.id === row.id && !stored.needs_review))) throw new Error("Post-write Fennec correction verification failed.");

console.log(JSON.stringify({ mode: "applied", invoice_id: INVOICE_ID, correction_cents: -1500, corrected_job_cost_cents: active, allocation_count: writes.length }, null, 2));
