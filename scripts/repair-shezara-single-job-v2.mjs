#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const OLD_PROPOSAL_ID = "2873427";
const CURRENT_PROPOSAL_ID = "3159412";
const OLD_JOB_ID = "a401f302-c764-5153-a2e4-75d0ae13606f";
const CURRENT_JOB_ID = "f0cd9e9f-f153-5bae-a68f-4b940e99fbee";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function envFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      return [line.slice(0, separator).trim(), value];
    }));
}

function stableUuid(value) {
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

const [jobsResult, quotesResult, budgetsResult, allocationsResult, timeEntriesResult, assignmentsResult, tasksResult, issuesResult, transactionAllocationsResult, attributionResult] = await Promise.all([
  db.from("jobs").select("*").in("id", [OLD_JOB_ID, CURRENT_JOB_ID]),
  db.from("quotes").select("*").in("dripjobs_proposal_id", [OLD_PROPOSAL_ID, CURRENT_PROPOSAL_ID]),
  db.from("job_budgets").select("*").in("job_id", [OLD_JOB_ID, CURRENT_JOB_ID]),
  db.from("invoice_job_allocations").select("*,invoice:invoices(invoice_number,category,issued_on),line:invoice_lines(description)").in("job_id", [OLD_JOB_ID, CURRENT_JOB_ID]),
  db.from("time_entries").select("id,job_id,job_name,started_at,status").in("job_id", [OLD_JOB_ID, CURRENT_JOB_ID]),
  db.from("job_assignments").select("*").in("job_id", [OLD_JOB_ID, CURRENT_JOB_ID]),
  db.from("job_tasks").select("*").in("job_id", [OLD_JOB_ID, CURRENT_JOB_ID]),
  db.from("job_issues").select("*").in("job_id", [OLD_JOB_ID, CURRENT_JOB_ID]),
  db.from("transaction_allocations").select("*").in("job_id", [OLD_JOB_ID, CURRENT_JOB_ID]),
  db.from("acquisition_attributions").select("*").in("job_id", [OLD_JOB_ID, CURRENT_JOB_ID]),
]);
for (const [label, result] of Object.entries({ jobsResult, quotesResult, budgetsResult, allocationsResult, timeEntriesResult, assignmentsResult, tasksResult, issuesResult, transactionAllocationsResult, attributionResult })) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

const jobs = jobsResult.data ?? [];
const oldJob = jobs.find((row) => row.id === OLD_JOB_ID);
const currentJob = jobs.find((row) => row.id === CURRENT_JOB_ID);
if (!oldJob || !currentJob) throw new Error("Expected both the synthetic and current Shezara job rows.");
if (!oldJob.name.toLowerCase().includes("shezara") || !currentJob.name.toLowerCase().includes("shezara")) throw new Error("Shezara job identity changed.");
const quotes = quotesResult.data ?? [];
const oldQuote = quotes.find((row) => row.dripjobs_proposal_id === OLD_PROPOSAL_ID);
const currentQuote = quotes.find((row) => row.dripjobs_proposal_id === CURRENT_PROPOSAL_ID);
if (!oldQuote || !currentQuote || oldJob.accepted_quote_id !== oldQuote.id || currentJob.accepted_quote_id !== currentQuote.id) throw new Error("Shezara quote/job relationships changed.");

const allocations = allocationsResult.data ?? [];
const oldAllocations = allocations.filter((row) => row.job_id === OLD_JOB_ID && !row.metadata?.reversed_at);
const currentAllocations = allocations.filter((row) => row.job_id === CURRENT_JOB_ID && !row.metadata?.reversed_at);
const duplicateCurrentAllocation = (allocation) => currentAllocations.find((row) =>
  row.invoice_id === allocation.invoice_id &&
  row.invoice_line_id === allocation.invoice_line_id &&
  Number(row.subtotal_cents) === Number(allocation.subtotal_cents)
);
const allocationPlan = oldAllocations.map((allocation) => ({
  id: allocation.id,
  invoice_number: allocation.invoice?.invoice_number ?? null,
  line: allocation.line?.description ?? null,
  subtotal_cents: allocation.subtotal_cents,
  action: duplicateCurrentAllocation(allocation) ? "reverse_duplicate" : "move_to_current_job",
}));

const dependencies = {
  budgets: (budgetsResult.data ?? []).filter((row) => row.job_id === OLD_JOB_ID),
  invoice_allocations: allocationPlan,
  time_entries: (timeEntriesResult.data ?? []).filter((row) => row.job_id === OLD_JOB_ID),
  assignments: (assignmentsResult.data ?? []).filter((row) => row.job_id === OLD_JOB_ID),
  tasks: (tasksResult.data ?? []).filter((row) => row.job_id === OLD_JOB_ID),
  issues: (issuesResult.data ?? []).filter((row) => row.job_id === OLD_JOB_ID),
  transaction_allocations: (transactionAllocationsResult.data ?? []).filter((row) => row.job_id === OLD_JOB_ID),
  acquisition_attributions: (attributionResult.data ?? []).filter((row) => row.job_id === OLD_JOB_ID),
};
if (dependencies.assignments.length || dependencies.tasks.length || dependencies.issues.length) {
  throw new Error("Synthetic Shezara row has operational assignments, tasks, or issues; refusing automatic repair.");
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  current_export_truth: { proposal_id: CURRENT_PROPOSAL_ID, invoice_number: "492286", current_job_id: CURRENT_JOB_ID },
  synthetic_record: { proposal_id: OLD_PROPOSAL_ID, job_id: OLD_JOB_ID, job_name: oldJob.name, status: oldJob.status, is_feed_visible: oldJob.is_feed_visible, contract_amount_cents: oldJob.contract_amount_cents },
  current_record: { proposal_id: CURRENT_PROPOSAL_ID, job_id: CURRENT_JOB_ID, job_name: currentJob.name, status: currentJob.status, is_feed_visible: currentJob.is_feed_visible, contract_amount_cents: currentJob.contract_amount_cents },
  dependencies,
}, null, 2));
if (!APPLY) process.exit(0);

const now = new Date().toISOString();
for (const allocation of oldAllocations) {
  const duplicate = duplicateCurrentAllocation(allocation);
  const metadata = {
    ...(allocation.metadata ?? {}),
    user_confirmed_single_job: {
      old_proposal_id: OLD_PROPOSAL_ID,
      current_proposal_id: CURRENT_PROPOSAL_ID,
      confirmed_at: now,
      reason: "Proposal acceptance email did not establish a second real job; current DripJobs export contains one Shezara job.",
    },
  };
  const result = duplicate
    ? await db.from("invoice_job_allocations").update({
      metadata: { ...metadata, reversed_at: now, reversal_reason: "Duplicate allocation on synthetic Shezara job row." },
      updated_at: now,
    }).eq("id", allocation.id).eq("job_id", OLD_JOB_ID)
    : await db.from("invoice_job_allocations").update({
      job_id: CURRENT_JOB_ID,
      allocation_method: "user_confirmed_single_job",
      confidence: 1,
      needs_review: false,
      metadata: { ...metadata, previous_job_id: OLD_JOB_ID },
      updated_at: now,
    }).eq("id", allocation.id).eq("job_id", OLD_JOB_ID);
  if (result.error) throw result.error;
}

for (const row of dependencies.time_entries) {
  const result = await db.from("time_entries").update({ job_id: CURRENT_JOB_ID, job_name: currentJob.name, updated_at: now }).eq("id", row.id).eq("job_id", OLD_JOB_ID);
  if (result.error) throw result.error;
}
for (const row of dependencies.transaction_allocations) {
  const result = await db.from("transaction_allocations").update({ job_id: CURRENT_JOB_ID, metadata: { ...(row.metadata ?? {}), previous_job_id: OLD_JOB_ID, user_confirmed_single_job: true }, updated_at: now }).eq("id", row.id).eq("job_id", OLD_JOB_ID);
  if (result.error) throw result.error;
}
for (const row of dependencies.acquisition_attributions) {
  const result = await db.from("acquisition_attributions").update({ job_id: CURRENT_JOB_ID, evidence: { ...(row.evidence ?? {}), previous_job_id: OLD_JOB_ID, user_confirmed_single_job: true } }).eq("id", row.id).eq("job_id", OLD_JOB_ID);
  if (result.error) throw result.error;
}
for (const budget of dependencies.budgets) {
  const result = await db.from("job_budgets").update({
    status: "superseded",
    closed_at: now,
    notes: [budget.notes, "Superseded: proposal 2873427 did not create a second Shezara job."].filter(Boolean).join(" "),
    metadata: { ...(budget.metadata ?? {}), superseded_by_job_id: CURRENT_JOB_ID, current_proposal_id: CURRENT_PROPOSAL_ID, user_confirmed_single_job: true },
    updated_at: now,
  }).eq("id", budget.id).eq("job_id", OLD_JOB_ID);
  if (result.error) throw result.error;
}
const quoteWrite = await db.from("quotes").update({
  status: "superseded",
  metadata: { ...(oldQuote.metadata ?? {}), accounting_status: "superseded", superseded_by_proposal_id: CURRENT_PROPOSAL_ID, user_confirmed_not_a_separate_job: true },
  updated_at: now,
}).eq("id", oldQuote.id).eq("dripjobs_proposal_id", OLD_PROPOSAL_ID);
if (quoteWrite.error) throw quoteWrite.error;

const currentJobWrite = await db.from("jobs").update({
  metadata: { ...(currentJob.metadata ?? {}), superseded_proposal_ids: [...new Set([...(currentJob.metadata?.superseded_proposal_ids ?? []), OLD_PROPOSAL_ID])], user_confirmed_single_job: true },
  updated_at: now,
}).eq("id", CURRENT_JOB_ID).eq("accepted_quote_id", currentQuote.id);
if (currentJobWrite.error) throw currentJobWrite.error;
const oldJobWrite = await db.from("jobs").update({
  status: "archived",
  is_feed_visible: false,
  archived_at: now,
  metadata: { ...(oldJob.metadata ?? {}), accounting_status: "superseded", superseded_by_job_id: CURRENT_JOB_ID, superseded_by_proposal_id: CURRENT_PROPOSAL_ID, user_confirmed_not_a_separate_job: true },
  updated_at: now,
}).eq("id", OLD_JOB_ID).eq("accepted_quote_id", oldQuote.id);
if (oldJobWrite.error) throw oldJobWrite.error;

const event = await db.from("verification_events").upsert({
  id: stableUuid(`verification:shezara-single-job:${OLD_JOB_ID}:${CURRENT_JOB_ID}`),
  entity_type: "job",
  entity_id: OLD_JOB_ID,
  action: "synthetic_job_superseded",
  reason: "User confirmed Shezara Ali has one job; the current DripJobs jobs export contains only proposal 3159412 / invoice 492286.",
  old_values: { is_feed_visible: oldJob.is_feed_visible, status: oldJob.status, proposal_id: OLD_PROPOSAL_ID },
  new_values: { is_feed_visible: false, status: "archived", superseded_by_job_id: CURRENT_JOB_ID, proposal_id: CURRENT_PROPOSAL_ID },
  evidence: { source_file: "Jobs_List_20260806_200107.csv", current_invoice_number: "492286", user_confirmed: true },
  occurred_at: now,
}, { onConflict: "id" });
if (event.error) throw event.error;

const [verifyOldJob, verifyCurrentJob, verifyOldQuote, verifyOldBudgets, verifyOldAllocations] = await Promise.all([
  db.from("jobs").select("id,status,is_feed_visible,metadata").eq("id", OLD_JOB_ID).single(),
  db.from("jobs").select("id,status,is_feed_visible,metadata").eq("id", CURRENT_JOB_ID).single(),
  db.from("quotes").select("id,status,metadata").eq("id", oldQuote.id).single(),
  db.from("job_budgets").select("id,status").eq("job_id", OLD_JOB_ID),
  db.from("invoice_job_allocations").select("id,job_id,metadata").eq("job_id", OLD_JOB_ID),
]);
for (const result of [verifyOldJob, verifyCurrentJob, verifyOldQuote, verifyOldBudgets, verifyOldAllocations]) if (result.error) throw result.error;
if (verifyOldJob.data.is_feed_visible || verifyOldJob.data.status !== "archived") throw new Error("Synthetic job is still visible.");
if (!verifyCurrentJob.data.is_feed_visible) throw new Error("Current Shezara job is not visible.");
if (verifyOldQuote.data.status !== "superseded") throw new Error("Old proposal is not superseded.");
if ((verifyOldBudgets.data ?? []).some((row) => row.status !== "superseded")) throw new Error("Synthetic job budget remains active.");
if ((verifyOldAllocations.data ?? []).some((row) => !row.metadata?.reversed_at)) throw new Error("Active job-cost allocation remains on the synthetic job.");
console.log(JSON.stringify({ status: "verified", visible_shezara_jobs: 1, current_job_id: CURRENT_JOB_ID, synthetic_job_hidden: OLD_JOB_ID, proposal_superseded: OLD_PROPOSAL_ID }, null, 2));
