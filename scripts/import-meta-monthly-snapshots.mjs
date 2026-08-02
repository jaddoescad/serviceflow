#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = path.join(repoRoot, "data", "marketing", "meta", "api");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
}

function latestMonthlyFiles() {
  if (!existsSync(apiRoot)) return [];
  const latestDirectory = readdirSync(apiRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .at(-1);
  if (!latestDirectory) return [];
  return readdirSync(path.join(apiRoot, latestDirectory))
    .filter((name) => name.endsWith("-monthly.json"))
    .sort()
    .map((name) => path.join(apiRoot, latestDirectory, name));
}

function purpose(name) {
  return /hiring|painter recruitment|recruit|employ|emloy/i.test(name ?? "")
    ? "recruiting"
    : "customer_acquisition";
}

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function leadResults(actions) {
  return number(
    (actions ?? []).find((action) => action.action_type === "lead")?.value,
  );
}

function rowsForFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  const snapshot = JSON.parse(source);
  if (
    snapshot.source !== "meta_marketing_api" ||
    snapshot.time_increment !== "monthly"
  ) {
    throw new Error(`Unexpected monthly Meta source in ${filePath}.`);
  }
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  const filename = path.basename(filePath);
  const rows = (snapshot.rows.campaigns ?? []).map((row, index) => ({
    platform: "meta",
    account_id: snapshot.account_id,
    account_name: snapshot.account_name,
    currency: snapshot.currency,
    month_start: `${row.date_start.slice(0, 7)}-01`,
    purpose: purpose(row.campaign_name),
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    spend: number(row.spend),
    leads: leadResults(row.actions),
    impressions: Math.round(number(row.impressions)),
    reach: Math.round(number(row.reach)),
    source_filename: filename,
    source_sha256: sourceSha256,
    source_row_number: index + 2,
    source_payload: {
      ...row,
      source_system: snapshot.source,
      api_version: snapshot.api_version,
      reporting_since: snapshot.since,
      reporting_until: snapshot.until,
      time_increment: snapshot.time_increment,
    },
    captured_at: snapshot.captured_at,
  }));
  return { filename, snapshot, sourceSha256, rows };
}

const files = latestMonthlyFiles();
if (!files.length) {
  throw new Error("No monthly Meta snapshots found. Run the Meta CLI monthly pull first.");
}
const prepared = files.map(rowsForFile);
const rows = prepared.flatMap((entry) => entry.rows);
const preview = {
  project_ref: TARGET_PROJECT_REF,
  apply: APPLY,
  files: prepared.map((entry) => ({
    filename: entry.filename,
    account_id: entry.snapshot.account_id,
    account_name: entry.snapshot.account_name,
    currency: entry.snapshot.currency,
    rows: entry.rows.length,
    spend: Math.round(
      entry.rows.reduce((total, row) => total + row.spend, 0) * 100,
    ) / 100,
    leads: entry.rows.reduce((total, row) => total + row.leads, 0),
  })),
  total_rows: rows.length,
};

if (!APPLY) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.join(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== TARGET_PROJECT_REF) {
  throw new Error(`Refusing import for unexpected Supabase project ${projectRef}.`);
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const result = await db
  .from("marketing_platform_monthly_performance")
  .upsert(rows, { onConflict: "source_sha256,source_row_number" });
if (result.error) throw result.error;
const hashes = prepared.map((entry) => entry.sourceSha256);
const verify = await db
  .from("marketing_platform_monthly_performance")
  .select("id", { count: "exact", head: true })
  .in("source_sha256", hashes);
if (verify.error) throw verify.error;
if (verify.count !== rows.length) {
  throw new Error(`Verification failed: expected ${rows.length}, found ${verify.count}.`);
}
console.log(JSON.stringify({ ...preview, imported_rows: verify.count }, null, 2));
