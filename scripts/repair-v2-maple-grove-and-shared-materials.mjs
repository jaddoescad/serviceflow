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

const ANGEL_INVOICE_ID = "927b382e-f997-505c-9d4d-979e941a48bb";
const KIM_JOB_ID = "5f6ca26b-e988-5255-8d3b-0568cd52c930";
const MAPLE_LINES = [
  ["e1a29a6a-70d7-5167-9032-c16b89941c73", "Maple Grove Road — February 18", 32500, "2026-02-18"],
  ["efca5cce-718f-534d-a851-2392a0d7f2b2", "Maple Grove Road — February 19", 30500, "2026-02-19"],
].map(([line_id, description, subtotal_cents, service_on]) => ({ line_id, description, subtotal_cents, service_on }));

const GENERAL_SUPPLY_LINES = [
  {
    invoice_id: "27769996-c1c5-53cb-9d32-8fb38470586e",
    invoice_number: "20260128",
    line_id: "4a341c2e-4f98-51f9-a474-fc6f383c6d37",
    description: "Paint",
    subtotal_cents: 30000,
    reason: "The physical invoice identifies paint shared across four jobs but does not print a per-job split.",
  },
  {
    invoice_id: "c6121f64-8c3d-501a-988a-72e8ad5757ad",
    invoice_number: "108",
    line_id: "3c68efff-e461-5b18-aed5-911874efbef2",
    description: "Materials — primer, flat paint, masking paper",
    subtotal_cents: 9726,
    reason: "The physical invoice lists supplies after several jobs but does not print which job used them.",
  },
];

const invoiceIds = [ANGEL_INVOICE_ID, ...GENERAL_SUPPLY_LINES.map((row) => row.invoice_id)];
const [{ data: invoices, error: invoiceError }, { data: job, error: jobError }] = await Promise.all([
  db.from("invoices").select("id,invoice_number,subtotal_cents,metadata,lines:invoice_lines(*),job_allocations:invoice_job_allocations(*)").in("id", invoiceIds),
  db.from("jobs").select("*").eq("id", KIM_JOB_ID).single(),
]);
if (invoiceError) throw invoiceError;
if (jobError) throw jobError;
if (invoices.length !== invoiceIds.length) throw new Error("Target invoice count changed.");
if (job.name !== "Kim Johnston — proposal 2383685 (completed)" || job.formatted_address !== "1821 Maple Grove Rd, Ottawa, ON, K2S 0M7" ||
    job.started_on !== "2026-02-20" || job.metadata?.source_payload?.["Job Schedule Date"] !== "Wed. Feb 18 - Thu. Feb 19") {
  throw new Error("Kim Johnston Maple Grove job evidence changed.");
}
const invoiceById = new Map(invoices.map((row) => [row.id, row]));
const angelInvoice = invoiceById.get(ANGEL_INVOICE_ID);
if (angelInvoice.invoice_number !== "2" || Number(angelInvoice.subtotal_cents) !== 166562) throw new Error("Angel invoice precondition changed.");
for (const expected of MAPLE_LINES) {
  const line = angelInvoice.lines.find((row) => row.id === expected.line_id);
  if (!line || line.description !== expected.description || Number(line.subtotal_cents) !== expected.subtotal_cents) throw new Error(`Maple line changed: ${expected.line_id}.`);
}
for (const expected of GENERAL_SUPPLY_LINES) {
  const invoice = invoiceById.get(expected.invoice_id);
  const line = invoice?.lines?.find((row) => row.id === expected.line_id);
  if (!invoice || invoice.invoice_number !== expected.invoice_number || !line || line.description !== expected.description || Number(line.subtotal_cents) !== expected.subtotal_cents) {
    throw new Error(`General-supplies precondition changed for ${expected.invoice_number}.`);
  }
}

const linkWrites = MAPLE_LINES.map((line) => ({
  id: uuid(`invoice-job-allocation:${line.line_id}:${KIM_JOB_ID}:exact-maple-grove-schedule`),
  invoice_id: ANGEL_INVOICE_ID,
  invoice_line_id: line.line_id,
  job_id: KIM_JOB_ID,
  subtotal_cents: line.subtotal_cents,
  tax_cents: 0,
  total_cents: line.subtotal_cents,
  allocation_method: "exact_printed_street_and_service_date_matches_job_schedule",
  confidence: 1,
  needs_review: false,
  metadata: {
    source: "saved_invoice_and_dripjobs_job_evidence",
    printed_location: "Maple Grove Road",
    service_on: line.service_on,
    job_schedule: "2026-02-18 through 2026-02-19",
    evidence: "The only current DripJobs Maple Grove job is Kim Johnston at 1821 Maple Grove Rd, scheduled on the same two printed service dates.",
    reconciled_at: now,
  },
  created_at: now,
  updated_at: now,
}));

const preview = {
  maple_grove_job_links: linkWrites.map((row) => ({ line_id: row.invoice_line_id, job_id: row.job_id, subtotal_cents: row.subtotal_cents })),
  general_paint_supplies: GENERAL_SUPPLY_LINES.map((row) => ({ invoice_number: row.invoice_number, line: row.description, subtotal_cents: row.subtotal_cents, reason: row.reason })),
};
if (!APPLY) {
  console.log(JSON.stringify({ mode: "dry-run", ...preview }, null, 2));
  process.exit(0);
}

const linkWrite = await db.from("invoice_job_allocations").upsert(linkWrites, { onConflict: "id" });
if (linkWrite.error) throw linkWrite.error;
for (const expected of GENERAL_SUPPLY_LINES) {
  const invoice = invoiceById.get(expected.invoice_id);
  const line = invoice.lines.find((row) => row.id === expected.line_id);
  const update = await db.from("invoice_lines").update({
    metadata: {
      ...(line.metadata ?? {}),
      non_job_classification: {
        status: "confirmed",
        category: "General paint supplies",
        allocated_subtotal_cents: expected.subtotal_cents,
        reason: expected.reason,
        classification_rule: "material_consumables_without_exact_job_split",
        classified_at: now,
      },
    },
    updated_at: now,
  }).eq("id", expected.line_id);
  if (update.error) throw update.error;
}
for (const invoice of invoices) {
  const update = await db.from("invoices").update({
    metadata: {
      ...(invoice.metadata ?? {}),
      job_costing_repair: {
        ...(invoice.metadata?.job_costing_repair ?? {}),
        status: "evidence_backed_partial_or_non_job_classification",
        repaired_at: now,
      },
    },
    updated_at: now,
  }).eq("id", invoice.id);
  if (update.error) throw update.error;
}

const [{ data: verifiedLinks, error: verifyLinkError }, { data: verifiedLines, error: verifyLineError }] = await Promise.all([
  db.from("invoice_job_allocations").select("id,invoice_line_id,job_id,subtotal_cents,needs_review").in("id", linkWrites.map((row) => row.id)),
  db.from("invoice_lines").select("id,subtotal_cents,metadata").in("id", GENERAL_SUPPLY_LINES.map((row) => row.line_id)),
]);
if (verifyLinkError) throw verifyLinkError;
if (verifyLineError) throw verifyLineError;
if (verifiedLinks.length !== linkWrites.length || verifiedLinks.some((row) => row.needs_review || row.job_id !== KIM_JOB_ID)) throw new Error("Maple Grove verification failed.");
for (const expected of GENERAL_SUPPLY_LINES) {
  const line = verifiedLines.find((row) => row.id === expected.line_id);
  if (line?.metadata?.non_job_classification?.status !== "confirmed" || Number(line.metadata.non_job_classification.allocated_subtotal_cents) !== expected.subtotal_cents) {
    throw new Error(`General-supplies verification failed for ${expected.line_id}.`);
  }
}

console.log(JSON.stringify({ mode: "applied", ...preview }, null, 2));
