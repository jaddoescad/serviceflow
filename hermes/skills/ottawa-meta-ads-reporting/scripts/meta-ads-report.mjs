#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TIMEZONE = "America/Toronto";
const DEFAULT_API_VERSION = "v25.0";
const DEFAULT_ACCOUNT_ID = "act_762696206838329";
const DEFAULT_ENV_FILE = "/opt/data/hermes-meta-ads.env";

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

function option(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

export function dateInZone(date = new Date(), timeZone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(dateOnly, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly ?? "")) {
    throw new Error("Date must use YYYY-MM-DD.");
  }
  const date = new Date(`${dateOnly}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function credentials() {
  const envFile = process.env.HERMES_META_ADS_ENV_FILE || DEFAULT_ENV_FILE;
  const localFallback = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
    ".env.local",
  );
  const env = {
    ...parseEnvFile(localFallback),
    ...parseEnvFile(envFile),
    ...process.env,
  };
  const token = (env.HERMES_META_ADS_TOKEN || env.META_ACCESS_TOKEN || "").trim();
  if (!token) throw new Error("Meta Ads reporting is not connected.");
  const accountId = (
    env.HERMES_META_AD_ACCOUNT_ID ||
    env.META_AD_ACCOUNT_ID ||
    DEFAULT_ACCOUNT_ID
  ).trim();
  if (!/^act_\d+$/.test(accountId)) {
    throw new Error("Configured Meta ad account ID is invalid.");
  }
  return {
    token,
    accountId,
    apiVersion:
      env.HERMES_META_GRAPH_API_VERSION ||
      env.META_GRAPH_API_VERSION ||
      DEFAULT_API_VERSION,
  };
}

async function graphRequest(auth, pathname, params = {}) {
  const url = new URL(
    `https://graph.facebook.com/${auth.apiVersion}/${pathname.replace(/^\//, "")}`,
  );
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${auth.token}`,
    },
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

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function leadCount(actions) {
  return number((actions ?? []).find((action) => action.action_type === "lead")?.value);
}

export function classifyPurpose(name) {
  return /hiring|painter recruitment|recruit|employ|emloy/i.test(name ?? "")
    ? "recruiting"
    : "customer_acquisition";
}

function emptyMetrics() {
  return {
    spend: 0,
    leads: 0,
    cost_per_lead: null,
    impressions: 0,
    reach: 0,
    clicks: 0,
    ctr: null,
  };
}

function finalizeMetrics(metrics) {
  return {
    spend: round(metrics.spend),
    leads: round(metrics.leads, 0),
    cost_per_lead: metrics.leads > 0 ? round(metrics.spend / metrics.leads) : null,
    impressions: Math.round(metrics.impressions),
    reach: Math.round(metrics.reach),
    clicks: Math.round(metrics.clicks),
    ctr: metrics.impressions > 0 ? round((metrics.clicks / metrics.impressions) * 100) : null,
  };
}

export function summarizeRows(rows) {
  const buckets = {
    all: emptyMetrics(),
    customer_acquisition: emptyMetrics(),
    recruiting: emptyMetrics(),
  };
  const campaigns = [];
  for (const row of rows ?? []) {
    const purpose = classifyPurpose(row.campaign_name);
    const spend = number(row.spend);
    const leads = leadCount(row.actions);
    const impressions = number(row.impressions);
    const reach = number(row.reach);
    const clicks = number(row.clicks);
    for (const key of ["all", purpose]) {
      buckets[key].spend += spend;
      buckets[key].leads += leads;
      buckets[key].impressions += impressions;
      buckets[key].reach += reach;
      buckets[key].clicks += clicks;
    }
    campaigns.push({
      campaign_id: row.campaign_id ?? null,
      campaign_name: row.campaign_name ?? "Unnamed campaign",
      purpose,
      spend: round(spend),
      leads: round(leads, 0),
      cost_per_lead: leads > 0 ? round(spend / leads) : null,
      impressions: Math.round(impressions),
      reach: Math.round(reach),
      clicks: Math.round(clicks),
    });
  }
  campaigns.sort((left, right) => right.spend - left.spend);
  return {
    all: finalizeMetrics(buckets.all),
    customer_acquisition: finalizeMetrics(buckets.customer_acquisition),
    recruiting: finalizeMetrics(buckets.recruiting),
    campaigns,
  };
}

function feedbackFor(daily, sevenDay) {
  const feedback = [];
  const customer = daily.customer_acquisition;
  const baseline = sevenDay.customer_acquisition;
  if (customer.spend === 0) {
    feedback.push("No customer-acquisition spend was delivered on this date.");
  } else if (customer.leads === 0) {
    feedback.push("Customer-acquisition ads spent money without a Meta-attributed lead.");
  } else if (baseline.cost_per_lead != null && customer.cost_per_lead != null) {
    const difference = (customer.cost_per_lead - baseline.cost_per_lead) / baseline.cost_per_lead;
    if (difference >= 0.2) {
      feedback.push(`Customer CPL was ${Math.round(difference * 100)}% above the seven-day average.`);
    } else if (difference <= -0.2) {
      feedback.push(`Customer CPL was ${Math.round(Math.abs(difference) * 100)}% below the seven-day average.`);
    } else {
      feedback.push("Customer CPL was within 20% of the seven-day average.");
    }
  }
  const zeroLeadSpend = daily.campaigns
    .filter((campaign) => campaign.purpose === "customer_acquisition" && campaign.spend > 0 && campaign.leads === 0)
    .slice(0, 3);
  if (zeroLeadSpend.length > 0) {
    feedback.push(
      `Spend with zero attributed customer leads: ${zeroLeadSpend
        .map((campaign) => `${campaign.campaign_name} ($${campaign.spend.toFixed(2)})`)
        .join(", ")}.`,
    );
  }
  return feedback;
}

function money(value) {
  return value == null ? "—" : `$${number(value).toFixed(2)}`;
}

export function formatSlackReport(report) {
  const customer = report.daily.customer_acquisition;
  const recruiting = report.daily.recruiting;
  const baseline = report.seven_day.customer_acquisition;
  const lines = [
    `Meta Ads — ${report.period.date} (${report.timezone})`,
    `Customer leads: ${customer.leads} | Spend: ${money(customer.spend)} | CPL: ${money(customer.cost_per_lead)}`,
    `7-day customer: ${baseline.leads} leads | ${money(baseline.spend)} spend | ${money(baseline.cost_per_lead)} CPL`,
  ];
  if (recruiting.spend > 0 || recruiting.leads > 0) {
    lines.push(
      `Recruiting: ${recruiting.leads} leads | ${money(recruiting.spend)} spend | ${money(recruiting.cost_per_lead)} CPL`,
    );
  }
  const activeCustomerCampaigns = report.daily.campaigns
    .filter((campaign) => campaign.purpose === "customer_acquisition" && campaign.spend > 0)
    .slice(0, 5);
  if (activeCustomerCampaigns.length > 0) {
    lines.push(
      "Campaigns:",
      ...activeCustomerCampaigns.map(
        (campaign) =>
          `• ${campaign.campaign_name}: ${campaign.leads} leads, ${money(campaign.spend)} spend, ${money(campaign.cost_per_lead)} CPL`,
      ),
    );
  }
  if (report.feedback.length > 0) {
    lines.push("Feedback:", ...report.feedback.map((item) => `• ${item}`));
  }
  lines.push("Meta-attributed results; CRM confirmation is reported separately.");
  return lines.join("\n");
}

async function insightRows(auth, since, until) {
  return graphPages(auth, `${auth.accountId}/insights`, {
    time_range: JSON.stringify({ since, until }),
    level: "campaign",
    fields:
      "campaign_id,campaign_name,date_start,date_stop,spend,impressions,reach,clicks,actions,cost_per_action_type",
    action_report_time: "conversion",
    limit: 500,
  });
}

export async function buildReport({ date = null } = {}) {
  const auth = credentials();
  const reportDate = date || addDays(dateInZone(), -1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    throw new Error("--date must use YYYY-MM-DD.");
  }
  const sevenDayStart = addDays(reportDate, -6);
  const [account, dailyRows, sevenDayRows] = await Promise.all([
    graphRequest(auth, auth.accountId, {
      fields: "id,name,account_status,currency,timezone_name",
    }),
    insightRows(auth, reportDate, reportDate),
    insightRows(auth, sevenDayStart, reportDate),
  ]);
  const daily = summarizeRows(dailyRows);
  const sevenDay = summarizeRows(sevenDayRows);
  const report = {
    schema_version: 1,
    status: "ok",
    source: "meta_marketing_api",
    generated_at: new Date().toISOString(),
    timezone: TIMEZONE,
    period: { date: reportDate, seven_day_start: sevenDayStart, seven_day_end: reportDate },
    account: {
      id: account.id,
      name: account.name,
      status: account.account_status,
      currency: account.currency,
      timezone: account.timezone_name,
    },
    daily,
    seven_day: sevenDay,
    feedback: feedbackFor(daily, sevenDay),
    warnings: ["Meta attribution can update after the reporting date."],
  };
  report.slack_text = formatSlackReport(report);
  return report;
}

function help() {
  return `Ottawa Painters Meta Ads report\n\nUsage:\n  meta-ads-report.mjs [--date YYYY-MM-DD] [--json]\n\nDefaults to yesterday in America/Toronto. Read-only.`;
}

async function main() {
  if (process.argv.includes("--help")) {
    process.stdout.write(`${help()}\n`);
    return;
  }
  const report = await buildReport({ date: option("date") });
  process.stdout.write(
    process.argv.includes("--json")
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${report.slack_text}\n`,
  );
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`Meta Ads report failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
