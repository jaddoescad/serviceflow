#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sourcePath = process.argv.find((arg) => arg.startsWith("--file="))?.slice(7) ?? path.join(homedir(), "Downloads", "Jobs_List_20260806_200107.csv");

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

function parseCsv(text) {
  const rawRows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n") { row.push(field.replace(/\r$/, "")); rawRows.push(row); row = []; field = ""; }
    else field += character;
  }
  if (field || row.length) { row.push(field.replace(/\r$/, "")); rawRows.push(row); }
  const [rawHeaders, ...values] = rawRows;
  const headers = rawHeaders.map((header) => header.replace(/^\uFEFF/, "").trim());
  return values.filter((cells) => cells.some((cell) => cell.trim())).map((cells) => Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? "").trim()])));
}

function groupCount(rows, field) {
  return Object.fromEntries([...Map.groupBy(rows, (row) => row[field] ?? "(null)")].map(([key, values]) => [key, values.length]).sort());
}

function normalized(value) {
  return String(value ?? "").toLowerCase().replace(/\bproposal\s+\d+\b/g, "").replace(/\bcompleted\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const env = { ...envFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")), ...envFile(path.join(repoRoot, ".env.local")), ...process.env };
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const csvRows = parseCsv(readFileSync(sourcePath, "utf8"));
const currentProposalIds = new Set(csvRows.map((row) => row["Proposal ID"]).filter(Boolean));
const [jobsResult, quotesResult, contactsResult, allocationsResult, timeResult, taskResult, budgetResult] = await Promise.all([
  db.from("jobs").select("id,contact_id,lead_id,accepted_quote_id,name,status,contract_amount_cents,formatted_address,started_on,completed_on,is_feed_visible,source,metadata,created_at,updated_at"),
  db.from("quotes").select("id,dripjobs_proposal_id,name,status,amount_cents,tax_cents,source,metadata,created_at,updated_at"),
  db.from("contacts").select("id,name,email"),
  db.from("invoice_job_allocations").select("id,job_id,invoice_id,invoice_line_id,subtotal_cents,metadata"),
  db.from("time_entries").select("id,job_id,status"),
  db.from("job_tasks").select("id,job_id,status"),
  db.from("job_budgets").select("id,job_id,status,amount_including_tax_cents,source"),
]);
for (const [label, result] of Object.entries({ jobsResult, quotesResult, contactsResult, allocationsResult, timeResult, taskResult, budgetResult })) if (result.error) throw new Error(`${label}: ${result.error.message}`);

const jobs = jobsResult.data ?? [];
const quoteById = new Map((quotesResult.data ?? []).map((row) => [row.id, row]));
const contactById = new Map((contactsResult.data ?? []).map((row) => [row.id, row]));
const allocationsByJob = Map.groupBy((allocationsResult.data ?? []).filter((row) => !row.metadata?.reversed_at), (row) => row.job_id);
const timeByJob = Map.groupBy(timeResult.data ?? [], (row) => row.job_id);
const tasksByJob = Map.groupBy(taskResult.data ?? [], (row) => row.job_id);
const budgetsByJob = Map.groupBy(budgetResult.data ?? [], (row) => row.job_id);

function summary(job) {
  const quote = quoteById.get(job.accepted_quote_id);
  const allocations = allocationsByJob.get(job.id) ?? [];
  const budgets = budgetsByJob.get(job.id) ?? [];
  return {
    job_id: job.id,
    name: job.name,
    contact: contactById.get(job.contact_id)?.name ?? null,
    proposal_id: quote?.dripjobs_proposal_id ?? null,
    proposal_status: quote?.status ?? null,
    job_status: job.status,
    visible: job.is_feed_visible,
    source: job.source,
    in_current_export: Boolean(quote?.dripjobs_proposal_id && currentProposalIds.has(quote.dripjobs_proposal_id)),
    contract_amount_cents: job.contract_amount_cents,
    active_job_cost_cents: allocations.reduce((sum, row) => sum + Number(row.subtotal_cents ?? 0), 0),
    active_job_cost_allocations: allocations.length,
    time_entries: (timeByJob.get(job.id) ?? []).length,
    tasks: (tasksByJob.get(job.id) ?? []).length,
    active_budgets: budgets.filter((row) => ["active", "closed"].includes(row.status)).length,
    address: job.formatted_address,
  };
}

const visibleJobs = jobs.filter((job) => job.is_feed_visible);
const emailEvidenceJobs = jobs.filter((job) => job.source === "dripjobs_email_evidence");
const generatedNameJobs = visibleJobs.filter((job) => /\bproposal\s+\d+\b/i.test(job.name));
const visibleMissingCurrentExport = visibleJobs.filter((job) => {
  const proposalId = quoteById.get(job.accepted_quote_id)?.dripjobs_proposal_id;
  return proposalId && !currentProposalIds.has(proposalId);
});

const potentialDuplicateGroups = [...Map.groupBy(visibleJobs, (job) => `${job.contact_id ?? ""}\0${normalized(job.formatted_address)}\0${normalized(job.name)}`)]
  .filter(([key, group]) => !key.startsWith("\0") && group.length > 1)
  .map(([, group]) => group.map(summary));

console.log(JSON.stringify({
  source_file: path.basename(sourcePath),
  current_export_rows: csvRows.length,
  total_jobs: jobs.length,
  visible_jobs: visibleJobs.length,
  jobs_by_source: groupCount(jobs, "source"),
  visible_jobs_by_source: groupCount(visibleJobs, "source"),
  email_evidence_jobs: emailEvidenceJobs.map(summary),
  visible_generated_proposal_name_jobs: generatedNameJobs.map(summary),
  visible_proposal_rows_absent_from_current_export_count: visibleMissingCurrentExport.length,
  potential_duplicate_groups: potentialDuplicateGroups,
}, null, 2));
