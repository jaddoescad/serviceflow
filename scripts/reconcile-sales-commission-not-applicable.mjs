#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const CUTOFF_COMPLETED_ON = "2026-07-01";
const USER_CONFIRMED_ON = "2026-08-06";
const EXPECTED_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const EXPECTED_HISTORICAL_COUNT = 40;
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

function objectValue(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let page = 0; page < 100; page += 1) {
    const from = page * pageSize;
    const result = await queryFactory().range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Pagination exceeded 100,000 rows.");
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl =
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== EXPECTED_PROJECT_REF) {
  throw new Error(`Refusing reconciliation for unexpected project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [completedJobs, paidLedgerEvents] = await Promise.all([
  fetchAll(() =>
    db
      .from("jobs")
      .select("id,name,status,completed_on,metadata,updated_at")
      .eq("status", "completed")
      .lte("completed_on", CUTOFF_COMPLETED_ON),
  ),
  fetchAll(() =>
    db
      .from("verification_events")
      .select("id,entity_id,new_values,evidence,occurred_at")
      .eq("entity_type", "sales_commission_ledger_row")
      .eq("action", "marked_paid"),
  ),
]);

const justinJob = completedJobs.find((job) => job.name === "Justin Wagar");
const justinLedgerEvent = paidLedgerEvents.find(
  (event) => objectValue(event.evidence).csv_job_name === "Justin Wager",
);
if (!justinJob || !justinLedgerEvent) {
  throw new Error("Could not link the confirmed Justin Wager ledger row to Justin Wagar.");
}

const statusFor = (job) =>
  objectValue(objectValue(job.metadata).sales_commission_payment).status || null;
const paidJobs = completedJobs.filter((job) => statusFor(job) === "paid");
const existingNotApplicable = completedJobs.filter(
  (job) => statusFor(job) === "not_applicable",
);
const unsupportedStatuses = completedJobs.filter(
  (job) => statusFor(job) && !["paid", "not_applicable"].includes(statusFor(job)),
);
if (unsupportedStatuses.length) {
  throw new Error(
    `Refusing reconciliation with unsupported statuses: ${unsupportedStatuses
      .map((job) => `${job.name}=${statusFor(job)}`)
      .join(", ")}`,
  );
}

const justinNeedsPaidLink = statusFor(justinJob) !== "paid";
const historicalCandidates = completedJobs.filter(
  (job) => job.id !== justinJob.id && statusFor(job) == null,
);
const historicalScopeCount = historicalCandidates.length + existingNotApplicable.length;
if (historicalScopeCount !== EXPECTED_HISTORICAL_COUNT) {
  throw new Error(
    `Expected ${EXPECTED_HISTORICAL_COUNT} historical N/A jobs through ${CUTOFF_COMPLETED_ON}; found ${historicalScopeCount}.`,
  );
}

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      cutoffCompletedOn: CUTOFF_COMPLETED_ON,
      completedJobsInScope: completedJobs.length,
      alreadyPaid: paidJobs.length,
      alreadyNotApplicable: existingNotApplicable.length,
      toMarkNotApplicable: historicalCandidates.length,
      justinNeedsPaidLink,
      notApplicableCandidates: historicalCandidates.map((job) => ({
        id: job.id,
        name: job.name,
        completed_on: job.completed_on,
      })),
    },
    null,
    2,
  ),
);

if (!APPLY) process.exit(0);

async function updateJobWithAudit({ job, payment, action, reason }) {
  const oldMetadata = objectValue(job.metadata);
  const newMetadata = { ...oldMetadata, sales_commission_payment: payment };
  const now = new Date().toISOString();
  const updateResult = await db
    .from("jobs")
    .update({ metadata: newMetadata, updated_at: now })
    .eq("id", job.id)
    .eq("updated_at", job.updated_at)
    .select("id,name,metadata,updated_at")
    .maybeSingle();
  if (updateResult.error) throw updateResult.error;
  if (!updateResult.data) {
    throw new Error(`Concurrent job update detected for ${job.name} (${job.id}).`);
  }
  const eventResult = await db.from("verification_events").insert({
    id: crypto.randomUUID(),
    entity_type: "job_sales_commission",
    entity_id: job.id,
    action,
    reason,
    old_values: {
      sales_commission_payment: oldMetadata.sales_commission_payment ?? null,
    },
    new_values: { sales_commission_payment: payment },
    evidence: payment.evidence,
    occurred_at: now,
  });
  if (eventResult.error) throw eventResult.error;
  return updateResult.data;
}

let linkedJustinPaid = false;
if (justinNeedsPaidLink) {
  const ledgerValues = objectValue(justinLedgerEvent.new_values);
  const ledgerEvidence = objectValue(justinLedgerEvent.evidence);
  const payment = {
    status: "paid",
    recipient: ledgerValues.recipient,
    rate_percent: ledgerValues.rate_percent,
    base_before_hst_cents: ledgerValues.base_before_hst_cents,
    commission_paid_cents: ledgerValues.commission_paid_cents,
    confirmation_method: "user_confirmed_2026_profit_sheet",
    confirmed_at: justinLedgerEvent.occurred_at,
    evidence: {
      ...ledgerEvidence,
      canonical_job_missing: false,
      linked_ledger_event_id: justinLedgerEvent.id,
      matched_job_name: justinJob.name,
      name_spelling_reconciled: {
        profit_sheet: ledgerEvidence.csv_job_name,
        database: justinJob.name,
      },
    },
  };
  await updateJobWithAudit({
    job: justinJob,
    payment,
    action: "marked_paid",
    reason:
      "Linked the user-confirmed Justin Wager profit-sheet payment to the Justin Wagar job record.",
  });
  linkedJustinPaid = true;
}

let markedNotApplicable = 0;
for (const job of historicalCandidates) {
  const payment = {
    status: "not_applicable",
    reason: "historical_completed_job",
    confirmation_method: "user_confirmed_historical_completed_jobs",
    confirmed_at: new Date().toISOString(),
    evidence: {
      completed_on: job.completed_on,
      cutoff_completed_on: CUTOFF_COMPLETED_ON,
      user_confirmed_on: USER_CONFIRMED_ON,
      scope: "completed jobs only; newer and non-completed jobs excluded",
    },
  };
  await updateJobWithAudit({
    job,
    payment,
    action: "marked_not_applicable",
    reason:
      "User directed that historical completed jobs through July 1, 2026 are not applicable for sales commission tracking.",
  });
  markedNotApplicable += 1;
}

const verifiedResult = await db
  .from("jobs")
  .select("id,name,status,completed_on,metadata")
  .eq("status", "completed")
  .lte("completed_on", CUTOFF_COMPLETED_ON);
if (verifiedResult.error) throw verifiedResult.error;
const verified = verifiedResult.data ?? [];
const verifiedNotApplicable = verified.filter(
  (job) => statusFor(job) === "not_applicable",
);
const verifiedJustin = verified.find((job) => job.id === justinJob.id);
const remainingUnmarked = verified.filter((job) => statusFor(job) == null);
if (
  verifiedNotApplicable.length !== EXPECTED_HISTORICAL_COUNT ||
  statusFor(verifiedJustin) !== "paid" ||
  remainingUnmarked.length
) {
  throw new Error(
    `Verification failed: N/A=${verifiedNotApplicable.length}, Justin=${statusFor(
      verifiedJustin,
    )}, unmarked=${remainingUnmarked.length}.`,
  );
}

console.log(
  JSON.stringify(
    {
      markedNotApplicable,
      linkedJustinPaid,
      verifiedNotApplicable: verifiedNotApplicable.length,
      verifiedJustinStatus: statusFor(verifiedJustin),
      remainingUnmarked: remainingUnmarked.length,
    },
    null,
    2,
  ),
);
