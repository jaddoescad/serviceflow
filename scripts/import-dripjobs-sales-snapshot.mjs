#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { createClient } from "@supabase/supabase-js";

import { validateDripJobsSalesSnapshot } from "./lib/dripjobs-sales-snapshot.mjs";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const fileArgument = process.argv.find((value) => value.startsWith("--file="));
const envArgument = process.argv.find((value) => value.startsWith("--env="));

if (!fileArgument) {
  throw new Error("Provide --file=/absolute/path/to/dripjobs-sales-snapshot.json");
}

const filePath = path.resolve(fileArgument.slice("--file=".length));
if (!existsSync(filePath)) throw new Error(`Sales snapshot evidence not found: ${filePath}`);

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

const validation = validateDripJobsSalesSnapshot(readFileSync(filePath));
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
  throw new Error("Refusing Sales snapshot import for an unexpected Supabase project");
}

const db = createClient(supabaseUrl, backendKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let snapshot = resultData(
  "Read existing Sales snapshot",
  await db
    .from("dripjobs_sales_report_snapshots")
    .select("id,sales_count,gross_sales_cents,source_sha256,source_rows,metadata,captured_at")
    .eq("period_start", validation.snapshot.period_start)
    .eq("period_end", validation.snapshot.period_end)
    .eq("source_sha256", validation.snapshot.source_sha256)
    .maybeSingle(),
);
let inserted = false;
if (!snapshot) {
  snapshot = resultData(
    "Insert Sales snapshot",
    await db
      .from("dripjobs_sales_report_snapshots")
      .insert(validation.snapshot)
      .select("id,sales_count,gross_sales_cents,source_sha256,source_rows,metadata,captured_at")
      .single(),
  );
  inserted = true;
}

if (Number(snapshot.sales_count) !== validation.snapshot.sales_count) {
  throw new Error(`Verification found ${snapshot.sales_count} Sales rows; expected ${validation.snapshot.sales_count}`);
}
if (Number(snapshot.gross_sales_cents) !== validation.snapshot.gross_sales_cents) {
  throw new Error(`Verification found ${snapshot.gross_sales_cents} gross cents; expected ${validation.snapshot.gross_sales_cents}`);
}
if (snapshot.source_sha256 !== validation.snapshot.source_sha256) {
  throw new Error("Verification found an unexpected Sales source hash");
}
if (snapshot.metadata?.validation_status !== "accepted") {
  throw new Error("Verification found a Sales snapshot that is not accepted");
}
if (Date.parse(snapshot.captured_at) !== Date.parse(validation.snapshot.captured_at)) {
  throw new Error("Verification found a different Sales capture timestamp");
}
if (!isDeepStrictEqual(snapshot.source_rows, validation.snapshot.source_rows)) {
  throw new Error("Verification found Sales source rows that disagree with the validated evidence");
}

console.log(JSON.stringify({
  ...preview,
  snapshot_id: snapshot.id,
  inserted,
  verified_rows: Number(snapshot.sales_count),
  verified_gross_sales_cents: Number(snapshot.gross_sales_cents),
}, null, 2));
