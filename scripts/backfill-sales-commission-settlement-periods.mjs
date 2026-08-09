#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const EXPECTED_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const EXPECTED_PAID_COUNT = 116;
const EXPECTED_NOT_APPLICABLE_COUNT = 40;
const NOT_APPLICABLE_PERIOD = "2026-07";
const USER_CONFIRMED_ON = "2026-08-06";
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

function periodLabel(period) {
  const match = String(period).match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) throw new Error(`Invalid settlement period ${period}.`);
  return `${new Intl.DateTimeFormat("en-CA", { month: "long", timeZone: "UTC" }).format(
    new Date(`${period}-01T00:00:00Z`),
  )} ${match[1]}`;
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
const jobs = await fetchAll(() =>
  db.from("jobs").select("id,name,status,completed_on,metadata,updated_at"),
);
const commissionJobs = jobs
  .map((job) => ({
    job,
    payment: objectValue(objectValue(job.metadata).sales_commission_payment),
  }))
  .filter(({ payment }) => ["paid", "not_applicable"].includes(payment.status));
const paidJobs = commissionJobs.filter(({ payment }) => payment.status === "paid");
const notApplicableJobs = commissionJobs.filter(
  ({ payment }) => payment.status === "not_applicable",
);
if (
  paidJobs.length !== EXPECTED_PAID_COUNT ||
  notApplicableJobs.length !== EXPECTED_NOT_APPLICABLE_COUNT
) {
  throw new Error(
    `Expected paid=${EXPECTED_PAID_COUNT} and N/A=${EXPECTED_NOT_APPLICABLE_COUNT}; found paid=${paidJobs.length} and N/A=${notApplicableJobs.length}.`,
  );
}

const conflicts = [];
const changes = [];
const alreadySet = [];
for (const entry of commissionJobs) {
  const evidence = objectValue(entry.payment.evidence);
  const settlementPeriod =
    entry.payment.status === "paid" ? evidence.csv_month : NOT_APPLICABLE_PERIOD;
  if (!/^2026-(0[1-9]|1[0-2])$/.test(settlementPeriod ?? "")) {
    conflicts.push({
      jobId: entry.job.id,
      jobName: entry.job.name,
      status: entry.payment.status,
      reason: `Invalid or missing source period ${settlementPeriod ?? "null"}`,
    });
    continue;
  }
  const label = periodLabel(settlementPeriod);
  if (
    entry.payment.settlement_period &&
    (entry.payment.settlement_period !== settlementPeriod ||
      entry.payment.settlement_period_label !== label)
  ) {
    conflicts.push({
      jobId: entry.job.id,
      jobName: entry.job.name,
      status: entry.payment.status,
      reason: "Existing settlement period conflicts with source evidence.",
      existingPeriod: entry.payment.settlement_period,
      expectedPeriod: settlementPeriod,
    });
    continue;
  }
  if (
    entry.payment.settlement_period === settlementPeriod &&
    entry.payment.settlement_period_label === label
  ) {
    alreadySet.push(entry);
    continue;
  }
  const source =
    entry.payment.status === "paid"
      ? "2026_profit_sheet_month"
      : "user_confirmed_historical_settlement_batch";
  const payment = {
    ...entry.payment,
    settlement_period: settlementPeriod,
    settlement_period_label: label,
    settlement_period_source: source,
    evidence: {
      ...evidence,
      settlement_period: settlementPeriod,
      settlement_period_label: label,
      settlement_period_source: source,
      settlement_period_confirmed_on: USER_CONFIRMED_ON,
    },
  };
  changes.push({
    ...entry,
    oldPayment: entry.payment,
    payment,
    settlementPeriod,
    label,
    source,
  });
}

const byPeriod = {};
for (const entry of [...alreadySet, ...changes]) {
  const period = entry.payment.settlement_period;
  byPeriod[period] = (byPeriod[period] ?? 0) + 1;
}

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      paidJobs: paidJobs.length,
      notApplicableJobs: notApplicableJobs.length,
      alreadySet: alreadySet.length,
      changes: changes.length,
      conflicts,
      finalBySettlementPeriod: byPeriod,
      candidates: changes.map(({ job, payment }) => ({
        id: job.id,
        name: job.name,
        status: payment.status,
        settlement_period: payment.settlement_period,
        settlement_period_label: payment.settlement_period_label,
      })),
    },
    null,
    2,
  ),
);

if (!APPLY) process.exit(0);
if (conflicts.length) {
  throw new Error(`Refusing apply with ${conflicts.length} settlement-period conflicts.`);
}

let applied = 0;
for (const change of changes) {
  const oldMetadata = objectValue(change.job.metadata);
  const newMetadata = { ...oldMetadata, sales_commission_payment: change.payment };
  const now = new Date().toISOString();
  const updateResult = await db
    .from("jobs")
    .update({ metadata: newMetadata, updated_at: now })
    .eq("id", change.job.id)
    .eq("updated_at", change.job.updated_at)
    .select("id,name,metadata,updated_at")
    .maybeSingle();
  if (updateResult.error) throw updateResult.error;
  if (!updateResult.data) {
    throw new Error(
      `Concurrent job update detected for ${change.job.name} (${change.job.id}).`,
    );
  }
  const eventResult = await db.from("verification_events").insert({
    id: crypto.randomUUID(),
    entity_type: "job_sales_commission",
    entity_id: change.job.id,
    action: "settlement_period_set",
    reason:
      change.payment.status === "paid"
        ? "Added the job's month-year from its 2026 Profit Sheet section."
        : "User confirmed July 2026 as the settlement month for the historical N/A batch.",
    old_values: {
      settlement_period: change.oldPayment.settlement_period ?? null,
      settlement_period_label: change.oldPayment.settlement_period_label ?? null,
    },
    new_values: {
      settlement_period: change.settlementPeriod,
      settlement_period_label: change.label,
      settlement_period_source: change.source,
    },
    evidence: change.payment.evidence,
    occurred_at: now,
  });
  if (eventResult.error) throw eventResult.error;
  applied += 1;
}

const verifiedJobs = await fetchAll(() =>
  db.from("jobs").select("id,name,metadata"),
);
const verifiedCommissionJobs = verifiedJobs
  .map((job) => ({
    job,
    payment: objectValue(objectValue(job.metadata).sales_commission_payment),
  }))
  .filter(({ payment }) => ["paid", "not_applicable"].includes(payment.status));
const missing = verifiedCommissionJobs.filter(
  ({ payment }) =>
    !/^2026-(0[1-9]|1[0-2])$/.test(payment.settlement_period ?? "") ||
    payment.settlement_period_label !== periodLabel(payment.settlement_period),
);
if (
  verifiedCommissionJobs.length !== EXPECTED_PAID_COUNT + EXPECTED_NOT_APPLICABLE_COUNT ||
  missing.length
) {
  throw new Error(
    `Verification failed: commission jobs=${verifiedCommissionJobs.length}, missing/invalid periods=${missing.length}.`,
  );
}

console.log(
  JSON.stringify(
    {
      applied,
      verifiedCommissionJobs: verifiedCommissionJobs.length,
      missingOrInvalidSettlementPeriods: missing.length,
    },
    null,
    2,
  ),
);
