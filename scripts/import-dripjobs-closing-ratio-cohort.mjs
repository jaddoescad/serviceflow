#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { validateDripJobsClosingRatioCohort } from "./lib/dripjobs-closing-ratio-cohort.mjs";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const fileArgument = process.argv.find((value) => value.startsWith("--file="));
const envArgument = process.argv.find((value) => value.startsWith("--env="));

if (!fileArgument) {
  throw new Error("Provide --file=/absolute/path/to/dripjobs-closing-ratio-cohort.json");
}

const filePath = path.resolve(fileArgument.slice("--file=".length));
if (!existsSync(filePath)) throw new Error(`Closing-ratio evidence not found: ${filePath}`);

function parseEnvFile(envPath) {
  if (!existsSync(envPath)) return {};
  const values = {};
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

function resultData(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

const validation = validateDripJobsClosingRatioCohort(readFileSync(filePath));
const preview = {
  project_ref: TARGET_PROJECT_REF,
  apply: APPLY,
  ...validation.manifest,
};

if (!APPLY) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...(envArgument ? parseEnvFile(path.resolve(envArgument.slice("--env=".length))) : {}),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const backendKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !backendKey) throw new Error("Missing Supabase backend credentials");
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF) {
  throw new Error("Refusing closing-ratio import for an unexpected Supabase project");
}

const db = createClient(supabaseUrl, backendKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const existingParent = resultData(
  "Read existing closing-ratio snapshot",
  await db
    .from("dripjobs_closing_ratio_snapshots")
    .select("id,qualified_proposals_count,accepted_proposals_count,jobs_won_count,metadata,captured_at")
    .eq("period_start", validation.parent.period_start)
    .eq("period_end", validation.parent.period_end)
    .eq("source_sha256", validation.parent.source_sha256)
    .maybeSingle(),
);

let parent = existingParent;
if (!parent) {
  parent = resultData(
    "Insert closing-ratio snapshot",
    await db
      .from("dripjobs_closing_ratio_snapshots")
      .insert(validation.parent)
      .select("id,qualified_proposals_count,accepted_proposals_count,jobs_won_count,metadata,captured_at")
      .single(),
  );
}
if (
  Number(parent.qualified_proposals_count) !== validation.parent.qualified_proposals_count
  || Number(parent.accepted_proposals_count) !== validation.parent.accepted_proposals_count
  || Number(parent.jobs_won_count) !== validation.parent.jobs_won_count
) {
  throw new Error("Existing closing-ratio parent disagrees with the validated evidence");
}
if (parent.metadata?.validation_status !== "accepted") {
  throw new Error("Existing closing-ratio parent is not an accepted snapshot");
}
if (Date.parse(parent.captured_at) !== Date.parse(validation.parent.captured_at)) {
  throw new Error("Existing closing-ratio parent has a different capture timestamp");
}

const existingRows = resultData(
  "Read existing closing-ratio rows",
  await db
    .from("dripjobs_closing_ratio_snapshot_rows")
    .select("source_row_number,row_sha256")
    .eq("snapshot_id", parent.id)
    .order("source_row_number", { ascending: true }),
) ?? [];
const expectedByNumber = new Map(validation.rows.map((row) => [row.source_row_number, row]));
for (const row of existingRows) {
  const expected = expectedByNumber.get(Number(row.source_row_number));
  if (!expected || expected.row_sha256 !== row.row_sha256) {
    throw new Error(`Existing closing-ratio row ${row.source_row_number} disagrees with the evidence`);
  }
}
const existingNumbers = new Set(existingRows.map((row) => Number(row.source_row_number)));
const missingRows = validation.rows
  .filter((row) => !existingNumbers.has(row.source_row_number))
  .map((row) => ({ ...row, snapshot_id: parent.id }));
if (missingRows.length) {
  resultData(
    "Insert closing-ratio rows",
    await db.from("dripjobs_closing_ratio_snapshot_rows").insert(missingRows),
  );
}

const verifiedRows = resultData(
  "Verify closing-ratio rows",
  await db
    .from("dripjobs_closing_ratio_snapshot_rows")
    .select("source_row_number,row_sha256,is_accepted")
    .eq("snapshot_id", parent.id)
    .order("source_row_number", { ascending: true }),
) ?? [];
if (verifiedRows.length !== validation.rows.length) {
  throw new Error(`Verification found ${verifiedRows.length} rows; expected ${validation.rows.length}`);
}
for (const row of verifiedRows) {
  const expected = expectedByNumber.get(Number(row.source_row_number));
  if (!expected || expected.row_sha256 !== row.row_sha256 || expected.is_accepted !== row.is_accepted) {
    throw new Error(`Verification failed for closing-ratio row ${row.source_row_number}`);
  }
}
const verifiedAccepted = verifiedRows.filter((row) => row.is_accepted).length;
if (verifiedAccepted !== validation.parent.accepted_proposals_count) {
  throw new Error(`Verification found ${verifiedAccepted} accepted rows; expected ${validation.parent.accepted_proposals_count}`);
}

resultData(
  "Refresh closing-ratio appointment metrics",
  await db.rpc("refresh_dripjobs_closing_ratio_appointment_metrics"),
);

console.log(JSON.stringify({
  ...preview,
  snapshot_id: parent.id,
  imported_rows: missingRows.length,
  verified_rows: verifiedRows.length,
  verified_accepted_rows: verifiedAccepted,
}, null, 2));
