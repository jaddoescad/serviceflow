#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
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

function latestSnapshotFiles() {
  if (!existsSync(apiRoot)) return [];
  const captureDirectories = readdirSync(apiRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const latest = captureDirectories.at(-1);
  if (!latest) return [];
  return readdirSync(path.join(apiRoot, latest))
    .filter((name) => /^insights-\d+-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .map((name) => path.join(apiRoot, latest, name));
}

function performanceRows(filePath) {
  const source = readFileSync(filePath, "utf8");
  const snapshot = JSON.parse(source);
  if (snapshot.source !== "meta_marketing_api") {
    throw new Error(`Unexpected source in ${filePath}.`);
  }
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  const filename = path.basename(filePath);
  const levels = [
    ["campaign", snapshot.rows.campaigns ?? []],
    ["ad_set", snapshot.rows.ad_sets ?? []],
    ["ad", snapshot.rows.ads ?? []],
  ];
  let sourceRowNumber = 2;
  const rows = [];
  for (const [entityLevel, sourceRows] of levels) {
    for (const sourceRow of sourceRows) {
      const entityName =
        entityLevel === "campaign"
          ? sourceRow.campaign_name
          : entityLevel === "ad_set"
            ? sourceRow.adset_name
            : sourceRow.ad_name;
      if (!entityName) continue;
      rows.push({
        platform: "meta",
        account_id: snapshot.account_id,
        entity_level: entityLevel,
        entity_name: entityName,
        parent_campaign_name: sourceRow.campaign_name ?? null,
        parent_ad_set_name: sourceRow.adset_name ?? null,
        delivery_state: null,
        purpose: purpose(sourceRow.campaign_name),
        reporting_start: sourceRow.date_start,
        reporting_end: sourceRow.date_stop,
        currency: snapshot.currency,
        results: leadResults(sourceRow.actions),
        result_indicator: "lead",
        amount_spent: number(sourceRow.spend),
        impressions: Math.round(number(sourceRow.impressions)),
        reach: Math.round(number(sourceRow.reach)),
        source_filename: filename,
        source_sha256: sourceSha256,
        source_row_number: sourceRowNumber,
        source_payload: {
          ...sourceRow,
          source_system: snapshot.source,
          account_name: snapshot.account_name,
          api_version: snapshot.api_version,
        },
        captured_at: snapshot.captured_at,
      });
      sourceRowNumber += 1;
    }
  }
  return { snapshot, rows, filename };
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

const files = latestSnapshotFiles();
if (!files.length) throw new Error("No Meta API snapshots found. Run `npm run meta -- pull` first.");
const prepared = files.map(performanceRows);
const rows = prepared.flatMap((entry) => entry.rows);
const preview = {
  project_ref: projectRef,
  apply: APPLY,
  files: prepared.map((entry) => ({
    filename: entry.filename,
    account_id: entry.snapshot.account_id,
    account_name: entry.snapshot.account_name,
    currency: entry.snapshot.currency,
    period: `${entry.snapshot.since} to ${entry.snapshot.until}`,
    rows: entry.rows.length,
  })),
  total_rows: rows.length,
};

if (!APPLY) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
for (let index = 0; index < rows.length; index += 500) {
  const result = await db
    .from("marketing_platform_performance")
    .upsert(rows.slice(index, index + 500), {
      onConflict: "source_sha256,source_row_number",
      ignoreDuplicates: true,
    });
  if (result.error) throw result.error;
}

const hashes = [...new Set(rows.map((row) => row.source_sha256))];
const verify = await db
  .from("marketing_platform_performance")
  .select("id", { count: "exact", head: true })
  .in("source_sha256", hashes);
if (verify.error) throw verify.error;
if (verify.count !== rows.length) {
  throw new Error(`Verification failed: expected ${rows.length} rows, found ${verify.count}.`);
}
console.log(JSON.stringify({ ...preview, imported_rows: verify.count }, null, 2));
