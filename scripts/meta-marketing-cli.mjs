#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localEnvPath = path.join(repoRoot, ".env.local");
const DEFAULT_API_VERSION = "v25.0";
const DEFAULT_ACCOUNT_ID = "act_762696206838329";

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

function setEnvValue(filePath, key, value) {
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  const next = pattern.test(existing)
    ? existing.replace(pattern, line)
    : `${existing.trimEnd()}${existing.trim() ? "\n" : ""}${line}\n`;
  writeFileSync(filePath, next, { encoding: "utf8", mode: 0o600 });
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function dateOnly(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) {
    throw new Error(`--${name} must use YYYY-MM-DD.`);
  }
  return value;
}

function credentials() {
  const env = { ...parseEnvFile(localEnvPath), ...process.env };
  const token = env.META_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Meta is not connected. Copy a token in Meta Graph API Explorer, then run `npm run meta -- login --from-clipboard`.",
    );
  }
  return {
    token,
    apiVersion: env.META_GRAPH_API_VERSION || DEFAULT_API_VERSION,
    accountId: env.META_AD_ACCOUNT_ID || DEFAULT_ACCOUNT_ID,
  };
}

async function graphRequest(pathname, params = {}, tokenOverride = null) {
  const auth = tokenOverride
    ? {
        token: tokenOverride,
        apiVersion: DEFAULT_API_VERSION,
        accountId: DEFAULT_ACCOUNT_ID,
      }
    : credentials();
  const url = new URL(
    `https://graph.facebook.com/${auth.apiVersion}/${pathname.replace(/^\//, "")}`,
  );
  Object.entries(params).forEach(([key, value]) => {
    if (value != null) url.searchParams.set(key, String(value));
  });
  url.searchParams.set("access_token", auth.token);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error?.message || `Meta API request failed (${response.status}).`);
  }
  return payload;
}

async function graphPages(pathname, params) {
  const first = await graphRequest(pathname, params);
  const rows = [...(first.data ?? [])];
  let next = first.paging?.next;
  while (next) {
    const response = await fetch(next, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message || `Meta API request failed (${response.status}).`);
    }
    rows.push(...(payload.data ?? []));
    next = payload.paging?.next;
  }
  return rows;
}

function asNumber(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function purpose(name) {
  return /hiring|painter recruitment|recruit|employ|emloy/i.test(name ?? "")
    ? "recruiting"
    : "customer_acquisition";
}

function summarizeCampaigns(rows) {
  const grouped = Object.groupBy(rows, (row) => purpose(row.campaign_name));
  return Object.fromEntries(
    ["customer_acquisition", "recruiting"].map((key) => [
      key,
      {
        rows: (grouped[key] ?? []).length,
        spend: roundMoney(
          (grouped[key] ?? []).reduce(
            (total, row) => total + asNumber(row.spend),
            0,
          ),
        ),
      },
    ]),
  );
}

async function login() {
  if (!process.argv.includes("--from-clipboard")) {
    throw new Error("Use `npm run meta -- login --from-clipboard` after copying the token in Chrome.");
  }
  if (process.platform !== "darwin") {
    throw new Error("Clipboard login is currently configured for macOS.");
  }
  const token = execFileSync("pbpaste", { encoding: "utf8" }).trim();
  if (!token) throw new Error("The clipboard is empty.");
  const profile = await graphRequest("me", { fields: "id,name" }, token);
  setEnvValue(localEnvPath, "META_ACCESS_TOKEN", token);
  setEnvValue(localEnvPath, "META_GRAPH_API_VERSION", DEFAULT_API_VERSION);
  setEnvValue(localEnvPath, "META_AD_ACCOUNT_ID", DEFAULT_ACCOUNT_ID);
  console.log(`Meta connected as ${profile.name}. Token saved only in ignored .env.local.`);
}

async function status() {
  const auth = credentials();
  const [profile, account, permissions] = await Promise.all([
    graphRequest("me", { fields: "id,name" }),
    graphRequest(auth.accountId, {
      fields: "id,name,account_status,currency,timezone_name",
    }),
    graphRequest("me/permissions"),
  ]);
  const granted = (permissions.data ?? [])
    .filter((row) => row.status === "granted")
    .map((row) => row.permission);
  console.log(
    JSON.stringify(
      {
        connected: true,
        user: profile.name,
        account: account.name,
        account_id: account.id,
        account_status: account.account_status,
        currency: account.currency,
        timezone: account.timezone_name,
        api_version: auth.apiVersion,
        ads_read: granted.includes("ads_read"),
      },
      null,
      2,
    ),
  );
}

async function accounts() {
  const rows = await graphPages("me/adaccounts", {
    fields:
      "id,name,account_status,currency,timezone_name,amount_spent,business_name",
    limit: 100,
  });
  console.log(
    JSON.stringify(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        business_name: row.business_name ?? null,
        account_status: row.account_status,
        currency: row.currency,
        timezone: row.timezone_name,
        lifetime_spend: roundMoney(asNumber(row.amount_spent) / 100),
      })),
      null,
      2,
    ),
  );
}

async function pull() {
  const auth = credentials();
  const accountId = option("account", auth.accountId);
  if (!/^act_\d+$/.test(accountId ?? "")) {
    throw new Error("--account must look like act_123456789.");
  }
  const account = await graphRequest(accountId, {
    fields: "id,name,account_status,currency,timezone_name",
  });
  const now = new Date();
  const since = dateOnly(option("since", `${now.getUTCFullYear()}-01-01`), "since");
  const until = dateOnly(option("until", now.toISOString().slice(0, 10)), "until");
  const timeIncrement = option("time-increment", null);
  if (timeIncrement && timeIncrement !== "monthly" && timeIncrement !== "1") {
    throw new Error("--time-increment must be `monthly` or `1`.");
  }
  if (since > until) throw new Error("--since must be on or before --until.");
  const common = {
    time_range: JSON.stringify({ since, until }),
    ...(timeIncrement ? { time_increment: timeIncrement } : {}),
    limit: 500,
  };
  const fields = {
    campaign:
      "account_id,account_name,campaign_id,campaign_name,date_start,date_stop,spend,impressions,reach,actions",
    adset:
      "account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,date_start,date_stop,spend,impressions,reach,actions",
    ad:
      "account_id,account_name,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,date_start,date_stop,spend,impressions,reach,actions",
  };
  const [campaigns, adSets, ads] = await Promise.all(
    Object.entries(fields).map(([level, levelFields]) =>
      graphPages(`${accountId}/insights`, {
        ...common,
        level,
        fields: levelFields,
      }),
    ),
  );
  const capturedAt = new Date().toISOString();
  const output = {
    source: "meta_marketing_api",
    api_version: auth.apiVersion,
    account_id: accountId.replace(/^act_/, ""),
    account_name: account.name,
    currency: account.currency,
    since,
    until,
    time_increment: timeIncrement ?? "all_days",
    captured_at: capturedAt,
    summary: summarizeCampaigns(campaigns),
    rows: { campaigns, ad_sets: adSets, ads },
  };
  const captureDate = capturedAt.slice(0, 10);
  const outputDir = path.join(repoRoot, "data", "marketing", "meta", "api", captureDate);
  mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(
    outputDir,
    `insights-${accountId.replace(/^act_/, "")}-${since}-${until}${timeIncrement ? `-${timeIncrement}` : ""}.json`,
  );
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        saved: path.relative(repoRoot, outputPath),
        account: account.name,
        account_id: account.id,
        currency: account.currency,
        since,
        until,
        time_increment: timeIncrement ?? "all_days",
        campaign_rows: campaigns.length,
        ad_set_rows: adSets.length,
        ad_rows: ads.length,
        summary: output.summary,
      },
      null,
      2,
    ),
  );
}

function help() {
  console.log(`Ottawa Painters Meta reporting CLI

Commands:
  npm run meta -- login --from-clipboard
  npm run meta -- status
  npm run meta -- accounts
  npm run meta -- pull --account act_762696206838329 --since 2026-01-01 --until 2026-08-01
  npm run meta -- pull --account act_762696206838329 --since 2025-01-01 --until 2026-08-01 --time-increment monthly

The access token is stored only in ignored .env.local. Pulls are read-only.`);
}

const command = process.argv[2] ?? "help";
if (command === "login") await login();
else if (command === "status") await status();
else if (command === "accounts") await accounts();
else if (command === "pull") await pull();
else help();
