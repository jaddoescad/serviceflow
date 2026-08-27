#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import {
  META_ACCOUNT_ID,
  META_API_VERSION,
  addDays,
  chunkDateRange,
  dateInZone,
  insightToPerformanceRow,
  summarizePerformanceRows,
} from "./lib/meta-marketing-sync.mjs";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const DEFAULT_META_ENV = "/opt/data/hermes-meta-ads.env";
const DEFAULT_SUPABASE_ENV = "/opt/data/hermes-job-amounts.env";
const DEFAULT_BACKFILL_SINCE = "2025-08-01";

function parseEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) return {};
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

function option(argv, name, fallback = null) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

function parseArgs(argv, now = new Date()) {
  const allowedFlags = new Set(["--apply", "--backfill", "--json"]);
  const allowedOptions = new Set(["--since", "--until", "--lookback-days"]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (allowedFlags.has(token)) continue;
    if (allowedOptions.has(token)) {
      index += 1;
      if (index >= argv.length) throw new Error(`${token} requires a value.`);
      continue;
    }
    throw new Error(`Unknown option: ${token}`);
  }
  const today = dateInZone(now);
  const until = option(argv, "until", today);
  const lookbackDays = Number(option(argv, "lookback-days", "14"));
  if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > 90) {
    throw new Error("--lookback-days must be an integer from 1 to 90.");
  }
  const since = option(
    argv,
    "since",
    argv.includes("--backfill") ? DEFAULT_BACKFILL_SINCE : addDays(until, -(lookbackDays - 1)),
  );
  for (const [name, value] of [["since", since], ["until", until]]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`--${name} must use YYYY-MM-DD.`);
  }
  if (since > until) throw new Error("--since must be on or before --until.");
  return {
    apply: argv.includes("--apply"),
    backfill: argv.includes("--backfill"),
    json: argv.includes("--json"),
    since,
    until,
    lookbackDays,
  };
}

function credentials() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const env = {
    ...parseEnvFile(path.join(repoRoot, ".env.local")),
    ...parseEnvFile(process.env.HERMES_META_ADS_ENV_FILE || DEFAULT_META_ENV),
    ...parseEnvFile(process.env.HERMES_META_SUPABASE_ENV_FILE || DEFAULT_SUPABASE_ENV),
    ...process.env,
  };
  const token = String(env.HERMES_META_ADS_TOKEN || env.META_ACCESS_TOKEN || "").trim();
  const accountId = String(
    env.HERMES_META_AD_ACCOUNT_ID || env.META_AD_ACCOUNT_ID || META_ACCOUNT_ID,
  ).trim();
  const apiVersion = String(
    env.HERMES_META_GRAPH_API_VERSION || env.META_GRAPH_API_VERSION || META_API_VERSION,
  ).trim();
  const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const backendKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!token) throw new Error("Meta Ads reporting is not connected.");
  if (!/^act_\d+$/.test(accountId)) throw new Error("Configured Meta ad account ID is invalid.");
  if (!supabaseUrl || !backendKey) throw new Error("Missing server-side Supabase credentials.");
  if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) {
    throw new Error("Refusing Meta sync for an unexpected Supabase project.");
  }
  return { token, accountId, apiVersion, supabaseUrl, backendKey };
}

async function graphRequest(auth, pathname, params = {}) {
  const url = new URL(
    `https://graph.facebook.com/${auth.apiVersion}/${pathname.replace(/^\//, "")}`,
  );
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Bearer ${auth.token}` },
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `Meta API request failed (${response.status}).`);
  }
  return payload;
}

async function graphPages(auth, pathname, params) {
  const first = await graphRequest(auth, pathname, params);
  const rows = [...(first.data ?? [])];
  let next = first.paging?.next;
  while (next) {
    const response = await fetch(next, {
      headers: { Accept: "application/json", Authorization: `Bearer ${auth.token}` },
    });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message || `Meta API request failed (${response.status}).`);
    }
    rows.push(...(payload.data ?? []));
    next = payload.paging?.next;
  }
  return rows;
}

async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const auth = credentials();
  const account = await graphRequest(auth, auth.accountId, {
    fields: "id,name,account_status,currency,timezone_name",
  });
  const ranges = chunkDateRange(options.since, options.until);
  const insights = [];
  for (const range of ranges) {
    insights.push(...await graphPages(auth, `${auth.accountId}/insights`, {
      time_range: JSON.stringify(range),
      time_increment: 1,
      level: "campaign",
      fields: [
        "account_id",
        "account_name",
        "campaign_id",
        "campaign_name",
        "objective",
        "attribution_setting",
        "date_start",
        "date_stop",
        "spend",
        "impressions",
        "reach",
        "frequency",
        "clicks",
        "unique_clicks",
        "inline_link_clicks",
        "inline_link_click_ctr",
        "cpc",
        "cpm",
        "ctr",
        "actions",
        "cost_per_action_type",
      ].join(","),
      action_report_time: "conversion",
      limit: 500,
    }));
  }
  const capturedAt = new Date().toISOString();
  const context = {
    accountId: auth.accountId,
    accountName: account.name,
    accountTimezone: account.timezone_name,
    apiVersion: auth.apiVersion,
    currency: account.currency,
    since: options.since,
    until: options.until,
    capturedAt,
  };
  const rows = insights.map((insight) => insightToPerformanceRow(insight, context));
  const preview = {
    schema_version: 1,
    status: "ok",
    mode: options.apply ? "apply" : "dry_run",
    scope: options.backfill ? "backfill" : "rolling_window",
    account_id: account.id,
    account_name: account.name,
    currency: account.currency,
    timezone: account.timezone_name,
    api_version: auth.apiVersion,
    since: options.since,
    until: options.until,
    captured_at: capturedAt,
    insight_rows: insights.length,
    insight_requests: ranges.length,
    metrics: summarizePerformanceRows(rows),
  };
  if (!options.apply) return preview;

  const db = createClient(auth.supabaseUrl, auth.backendKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (let index = 0; index < rows.length; index += 500) {
    const result = await db
      .from("marketing_performance")
      .upsert(rows.slice(index, index + 500), {
        onConflict: "platform,account_id,grain,period_start,period_end,entity_level,entity_id",
      });
    if (result.error) throw new Error(`Meta backend upsert failed: ${result.error.message}`);
  }
  const verify = await db
    .from("marketing_performance")
    .select("id", { count: "exact", head: true })
    .eq("platform", "meta")
    .eq("account_id", String(account.id).replace(/^act_/, ""))
    .eq("grain", "daily")
    .eq("entity_level", "campaign")
    .gte("period_start", options.since)
    .lte("period_end", options.until);
  if (verify.error) throw new Error(`Meta backend verification failed: ${verify.error.message}`);
  if (Number(verify.count ?? 0) < rows.length) {
    throw new Error(`Meta backend verification found ${verify.count ?? 0} rows; expected at least ${rows.length}.`);
  }
  return { ...preview, persisted_rows: rows.length, verified_scope_rows: verify.count };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  run()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`Meta backend sync failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}

export { parseArgs, run };
