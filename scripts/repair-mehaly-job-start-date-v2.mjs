#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const OLD_PROPOSAL_ID = "2846697";
const NEW_PROPOSAL_ID = "2959424";
const OLD_JOB_ID = "f34caa2c-4b8f-5600-9642-abc7f228ab50";
const NEW_JOB_ID = "ec24398b-3137-5b77-b59a-6497cd648aa9";
const INCORRECT_START = "2026-07-30";
const CORRECT_START = "2026-06-08";
const COMPLETION_DATE = "2026-06-26";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function envFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(readFileSync(filePath, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      return [line.slice(0, separator).trim(), value];
    }));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const env = {
  ...envFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...envFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [quotesResult, jobsResult, allocationsResult] = await Promise.all([
  db.from("quotes").select("id,dripjobs_proposal_id,metadata").in("dripjobs_proposal_id", [OLD_PROPOSAL_ID, NEW_PROPOSAL_ID]),
  db.from("jobs").select("id,accepted_quote_id,name,status,started_on,completed_on,metadata").in("id", [OLD_JOB_ID, NEW_JOB_ID]),
  db.from("invoice_job_allocations")
    .select("id,job_id,invoice_line_id,metadata,invoice:invoices(invoice_number,issued_on,category)")
    .in("job_id", [OLD_JOB_ID, NEW_JOB_ID]),
]);
for (const [label, result] of Object.entries({ quotesResult, jobsResult, allocationsResult })) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

const quoteByProposal = new Map((quotesResult.data ?? []).map((row) => [row.dripjobs_proposal_id, row]));
const jobById = new Map((jobsResult.data ?? []).map((row) => [row.id, row]));
const oldQuote = quoteByProposal.get(OLD_PROPOSAL_ID);
const newQuote = quoteByProposal.get(NEW_PROPOSAL_ID);
const oldJob = jobById.get(OLD_JOB_ID);
const newJob = jobById.get(NEW_JOB_ID);
assert(oldQuote && newQuote && oldJob && newJob, "Expected both Mehaly proposals and jobs.");
assert(oldJob.accepted_quote_id === oldQuote.id, "Older Mehaly job is not proposal 2846697.");
assert(newJob.accepted_quote_id === newQuote.id, "Newer Mehaly job is not proposal 2959424.");
assert(oldJob.completed_on === COMPLETION_DATE, `Unexpected older completion date: ${oldJob.completed_on}`);
assert(newJob.started_on === "2026-08-03", `Unexpected newer job start date: ${newJob.started_on}`);
assert(newJob.completed_on == null, `Newer job unexpectedly has completion date ${newJob.completed_on}`);

const activeAllocations = (allocationsResult.data ?? []).filter((row) => !row.metadata?.reversed_at);
const invoiceAssignments = activeAllocations.map((row) => {
  const invoice = Array.isArray(row.invoice) ? row.invoice[0] : row.invoice;
  return {
    allocation_id: row.id,
    job_id: row.job_id,
    invoice_number: invoice?.invoice_number ?? null,
    invoice_date: invoice?.issued_on ?? null,
    category: invoice?.category ?? null,
    line_level: Boolean(row.invoice_line_id),
  };
});
assert(invoiceAssignments.some((row) => row.job_id === OLD_JOB_ID && row.invoice_number === "8587" && row.invoice_date === "2026-06-10"), "Older job is missing XDesign invoice 8587.");
assert(invoiceAssignments.some((row) => row.job_id === NEW_JOB_ID && row.invoice_number === "8610" && row.invoice_date === "2026-08-05"), "Newer job is missing XDesign invoice 8610.");
assert(!invoiceAssignments.some((row) => row.job_id === OLD_JOB_ID && row.invoice_number === "8610"), "XDesign invoice 8610 is incorrectly linked to the older job.");
assert(!invoiceAssignments.some((row) => row.job_id === NEW_JOB_ID && row.invoice_number === "8587"), "XDesign invoice 8587 is incorrectly linked to the newer job.");

const alreadyCorrect = oldJob.started_on === CORRECT_START;
assert(alreadyCorrect || oldJob.started_on === INCORRECT_START, `Unexpected older start date: ${oldJob.started_on}`);
console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  already_correct: alreadyCorrect,
  correction: {
    proposal_id: OLD_PROPOSAL_ID,
    job_id: OLD_JOB_ID,
    previous_started_on: oldJob.started_on,
    corrected_started_on: CORRECT_START,
    completed_on: oldJob.completed_on,
    source_schedule_date: oldQuote.metadata?.source_payload?.["Job Schedule Date"] ?? null,
    contradictory_source_start_date: oldQuote.metadata?.source_payload?.["Job Start Date"] ?? null,
    evidence: [
      "DripJobs scheduled range Mon. Jun 8 - Wed. Jun 10",
      "Gmail 19e935d0e671306a confirms the project started Monday June 8",
      "Sherwin invoices dated June 8 and June 9",
      "XDesign invoice 8587 dated June 10",
      "DripJobs completion date June 26",
    ],
  },
  verified_invoice_assignments: invoiceAssignments.filter((row) => ["8587", "8610"].includes(row.invoice_number)),
}, null, 2));

if (!APPLY || alreadyCorrect) process.exit(0);

const correctedAt = new Date().toISOString();
const updateResult = await db.from("jobs").update({
  started_on: CORRECT_START,
  metadata: {
    ...(oldJob.metadata ?? {}),
    job_start_date_source: {
      source: "verified_dripjobs_schedule_and_gmail_start_confirmation",
      proposal_id: OLD_PROPOSAL_ID,
      source_job_schedule_date: oldQuote.metadata?.source_payload?.["Job Schedule Date"] ?? null,
      gmail_message_id: "19e935d0e671306a",
      verified_started_on: CORRECT_START,
      corrected_at: correctedAt,
    },
    job_start_date_correction: {
      previous_started_on: INCORRECT_START,
      corrected_started_on: CORRECT_START,
      completion_date: COMPLETION_DATE,
      reason: "The imported start date was after completion and contradicted the scheduled range, Gmail start confirmation, and dated job invoices.",
      corrected_at: correctedAt,
    },
  },
  updated_at: correctedAt,
}).eq("id", OLD_JOB_ID).eq("started_on", INCORRECT_START).eq("completed_on", COMPLETION_DATE)
  .select("id,started_on,completed_on,metadata").single();
if (updateResult.error) throw updateResult.error;
assert(updateResult.data.started_on === CORRECT_START, "Start-date update did not persist.");

const verifyResult = await db.from("jobs")
  .select("id,started_on,completed_on")
  .in("id", [OLD_JOB_ID, NEW_JOB_ID]);
if (verifyResult.error) throw verifyResult.error;
const verifiedById = new Map((verifyResult.data ?? []).map((row) => [row.id, row]));
assert(verifiedById.get(OLD_JOB_ID)?.started_on === CORRECT_START, "Older job verification failed.");
assert(verifiedById.get(NEW_JOB_ID)?.started_on === "2026-08-03", "Newer job changed unexpectedly.");
console.log(JSON.stringify({
  applied: true,
  older_job_started_on: verifiedById.get(OLD_JOB_ID).started_on,
  newer_job_started_on: verifiedById.get(NEW_JOB_ID).started_on,
}, null, 2));
