#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const resolvedAt = new Date().toISOString();

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const env = { ...envFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")), ...envFile(path.join(repoRoot, ".env.local")), ...process.env };
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const INVOICE_ID = "f6da1573-1e7b-54bb-82de-4eca48039c4e";
const LINE_ID = "dd676df0-f79c-5d85-b40d-209dcb6f676f";
const ALLOCATION_ID = "3abf53ce-1fc6-5033-b4ef-52fffc5bc3fe";
const JOB_ID = "e3f3842c-238d-59de-b71c-13eefff23430";

const [invoiceResult, allocationResult, greggJobsResult, evidenceResult] = await Promise.all([
  db.from("invoices").select("id,invoice_number,issued_on,subtotal_cents,total_cents,lines:invoice_lines(id,description,subtotal_cents,metadata)").eq("id", INVOICE_ID).single(),
  db.from("invoice_job_allocations").select("*").eq("invoice_id", INVOICE_ID).eq("invoice_line_id", LINE_ID).eq("job_id", JOB_ID).single(),
  db.from("jobs").select("id,name,status,started_on,completed_on,formatted_address,metadata,contact:contacts(id,name,email)").ilike("name", "%Gregg Alexander%"),
  db.from("evidence_links").select("id,evidence_role,document:documents(id,kind,mime_type,metadata)").eq("entity_type", "invoice").eq("entity_id", INVOICE_ID),
]);
for (const [label, result] of [["invoice", invoiceResult], ["allocation", allocationResult], ["Gregg jobs", greggJobsResult], ["evidence", evidenceResult]]) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

const invoice = invoiceResult.data;
const allocation = allocationResult.data;
const line = invoice.lines.find((row) => row.id === LINE_ID);
const greggJobs = greggJobsResult.data ?? [];
const targetJob = greggJobs.find((row) => row.id === JOB_ID);
const sourceDocument = (evidenceResult.data ?? []).find((row) => row.document?.metadata?.text_excerpt)?.document;
const sourceText = sourceDocument?.metadata?.text_excerpt ?? "";

assert(invoice.invoice_number === "20260311" && invoice.issued_on === "2026-03-11", "Niels invoice identity changed.");
assert(Number(invoice.subtotal_cents) === 45900 && Number(invoice.total_cents) === 45900, "Niels invoice total changed.");
assert(line?.description === "Gregg Alexander — proposal 2484669 (completed)" && Number(line?.subtotal_cents) === 45900, "Niels line changed.");
assert(allocation.id === ALLOCATION_ID && allocation.needs_review === true, `Target review allocation changed: ${allocation.id}, needs_review=${allocation.needs_review}.`);
assert(Number(allocation.subtotal_cents) === 45900, "Target allocation total changed.");
assert(targetJob?.started_on === "2026-03-11" && targetJob?.metadata?.source_payload?.["Proposal ID"] === "2484669", "March Gregg job identity changed.");
assert(targetJob?.formatted_address === "1953 Oakdean Crescent, Ottawa, ON, K1J 6H6", "March Gregg job address changed.");
assert(greggJobs.length === 2, "Gregg job set changed; review again before resolving.");
assert(greggJobs.filter((row) => row.started_on === invoice.issued_on).length === 1, "More than one Gregg job starts on the invoice date.");
assert(sourceText.includes("Gregg and Alice $459.00") && sourceText.includes("153, Oakdean Crescent") && sourceText.includes("Ottawa, ON K1J 6H6"), "Saved physical invoice evidence changed.");

const update = {
  allocation_method: `${allocation.allocation_method},resolved_saved_document_address_typo_by_unique_customer_date_postal_code`,
  confidence: 0.98,
  needs_review: false,
  metadata: {
    ...(allocation.metadata ?? {}),
    review_resolution: {
      status: "resolved",
      resolved_at: resolvedAt,
      no_email_used: true,
      evidence_document_id: sourceDocument.id,
      printed_customer: "Gregg and Alice",
      printed_address: "153 Oakdean Crescent, Ottawa, ON K1J 6H6",
      linked_address: "1953 Oakdean Crescent, Ottawa, ON K1J 6H6",
      discrepancy: "The physical invoice omits the leading 19 from house number 1953.",
      basis: "Unique Gregg Alexander job at Oakdean with the same postal code and a start date equal to the invoice date; the other Gregg job began in July.",
    },
  },
  updated_at: resolvedAt,
};

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  no_email_used: true,
  invoice: { id: invoice.id, invoice_number: invoice.invoice_number, issued_on: invoice.issued_on },
  target_job: targetJob,
  other_gregg_job: greggJobs.find((row) => row.id !== JOB_ID),
  allocation_before: allocation,
  allocation_update: update,
}, null, 2));
if (!APPLY) process.exit(0);

const write = await db.from("invoice_job_allocations").update(update).eq("id", ALLOCATION_ID).eq("needs_review", true);
if (write.error) throw write.error;
const verifiedResult = await db.from("invoice_job_allocations").select("id,invoice_id,invoice_line_id,job_id,subtotal_cents,needs_review,confidence,allocation_method,metadata").eq("id", ALLOCATION_ID).single();
if (verifiedResult.error) throw verifiedResult.error;
const verified = verifiedResult.data;
assert(verified.needs_review === false && Number(verified.confidence) === 0.98, "Review resolution verification failed.");
assert(verified.metadata?.review_resolution?.status === "resolved" && verified.metadata?.review_resolution?.no_email_used === true, "Review resolution audit metadata verification failed.");
console.log(JSON.stringify({ applied: true, no_email_used: true, allocation: verified }, null, 2));
