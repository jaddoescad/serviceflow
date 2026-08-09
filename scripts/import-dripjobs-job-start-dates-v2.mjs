#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sourcePath = process.argv.find((arg) => arg.startsWith("--file="))?.slice(7) ??
  path.join(homedir(), "Downloads", "Jobs_List_20260806_200107.csv");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(readFileSync(filePath, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
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
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rawRows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rawRows.push(row);
  }
  const [rawHeaders, ...values] = rawRows;
  const headers = rawHeaders.map((header) => header.replace(/^\uFEFF/, "").trim());
  return values
    .filter((cells) => cells.some((cell) => cell.trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? "").trim()])));
}

function isoDate(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) throw new Error(`Invalid Job Start Date: ${value}`);
  const [, month, day, year] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) throw new Error(`Invalid Job Start Date: ${value}`);
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

if (!existsSync(sourcePath)) throw new Error(`CSV not found: ${sourcePath}`);
const sourceText = readFileSync(sourcePath, "utf8");
const sourceHash = createHash("sha256").update(sourceText).digest("hex");
const rows = parseCsv(sourceText);
const datedRows = rows
  .filter((row) => row["Job Start Date"] && row["Job Start Date"] !== "N/A")
  .map((row) => ({
    proposalId: row["Proposal ID"],
    jobName: row.Job,
    sourceStatus: row.Status,
    startedOn: isoDate(row["Job Start Date"]),
    completedOn: row["Job Completion Date"] && row["Job Completion Date"] !== "N/A"
      ? isoDate(row["Job Completion Date"])
      : null,
    sourceScheduleDate: row["Job Scheduled Date"],
  }));
const invalidChronology = datedRows
  .filter((row) => row.completedOn && row.startedOn > row.completedOn)
  .map((row) => ({
    proposal_id: row.proposalId,
    job_name: row.jobName,
    job_start_date: row.startedOn,
    job_completion_date: row.completedOn,
    job_scheduled_date: row.sourceScheduleDate,
    reason: "job_start_date_after_job_completion_date",
  }));
const duplicateProposalIds = Object.entries(Object.groupBy(datedRows, (row) => row.proposalId))
  .filter(([, matches]) => matches.length > 1)
  .map(([proposalId]) => proposalId);
if (duplicateProposalIds.length) throw new Error(`Duplicate proposal IDs in CSV: ${duplicateProposalIds.join(", ")}`);

const env = {
  ...parseEnvFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.join(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const proposalIds = datedRows.map((row) => row.proposalId);
const quoteResult = await db.from("quotes")
  .select("id,dripjobs_proposal_id,name")
  .in("dripjobs_proposal_id", proposalIds);
if (quoteResult.error) throw quoteResult.error;
const quoteByProposal = new Map((quoteResult.data ?? []).map((quote) => [quote.dripjobs_proposal_id, quote]));
const quoteIds = [...quoteByProposal.values()].map((quote) => quote.id);
const jobResult = quoteIds.length
  ? await db.from("jobs")
    .select("id,accepted_quote_id,name,status,started_on,metadata")
    .in("accepted_quote_id", quoteIds)
  : { data: [], error: null };
if (jobResult.error) throw jobResult.error;
const jobByQuote = new Map((jobResult.data ?? []).map((job) => [job.accepted_quote_id, job]));

const candidates = [];
const missing = [];
for (const source of datedRows) {
  const quote = quoteByProposal.get(source.proposalId);
  const job = quote ? jobByQuote.get(quote.id) : null;
  if (!quote || !job) {
    missing.push({ proposal_id: source.proposalId, job_name: source.jobName, missing: !quote ? "quote" : "job" });
    continue;
  }
  candidates.push({
    proposal_id: source.proposalId,
    csv_job_name: source.jobName,
    job_id: job.id,
    database_job_name: job.name,
    previous_started_on: job.started_on,
    started_on: source.startedOn,
    changed: job.started_on !== source.startedOn,
    source_status: source.sourceStatus,
    existing_metadata: job.metadata ?? {},
  });
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  source_file: path.basename(sourcePath),
  source_sha256: sourceHash,
  csv_rows: rows.length,
  rows_with_start_date: datedRows.length,
  invalid_chronology: invalidChronology,
  matched_jobs: candidates.length,
  missing,
  unchanged: candidates.filter((row) => !row.changed).length,
  changes: candidates.filter((row) => row.changed).map(({ existing_metadata, ...row }) => row),
}, null, 2));

if (!APPLY) process.exit(0);
if (invalidChronology.length) {
  throw new Error(`Refusing apply: ${invalidChronology.length} source rows have a job start date after their completion date.`);
}
if (missing.length) throw new Error(`Refusing apply: ${missing.length} proposal IDs do not have an exact job match.`);

const importedAt = new Date().toISOString();
for (const candidate of candidates.filter((row) => row.changed)) {
  const result = await db.from("jobs").update({
    started_on: candidate.started_on,
    metadata: {
      ...candidate.existing_metadata,
      job_start_date_source: {
        source: "dripjobs_jobs_csv",
        source_file: path.basename(sourcePath),
        source_sha256: sourceHash,
        proposal_id: candidate.proposal_id,
        imported_at: importedAt,
      },
    },
    updated_at: importedAt,
  }).eq("id", candidate.job_id).select("id,started_on").single();
  if (result.error) throw result.error;
  if (result.data.started_on !== candidate.started_on) {
    throw new Error(`Verification failed for proposal ${candidate.proposal_id}.`);
  }
}

const verification = await db.from("jobs")
  .select("id,accepted_quote_id,started_on")
  .in("accepted_quote_id", quoteIds);
if (verification.error) throw verification.error;
const verifiedByQuote = new Map((verification.data ?? []).map((job) => [job.accepted_quote_id, job]));
const mismatches = candidates.filter((candidate) => {
  const quote = quoteByProposal.get(candidate.proposal_id);
  return verifiedByQuote.get(quote.id)?.started_on !== candidate.started_on;
});
if (mismatches.length) throw new Error(`Post-apply verification failed for ${mismatches.length} jobs.`);
console.log(JSON.stringify({ applied: candidates.filter((row) => row.changed).length, verified: candidates.length }, null, 2));
