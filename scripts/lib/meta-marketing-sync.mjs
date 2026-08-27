import crypto from "node:crypto";

export const META_TIMEZONE = "America/Toronto";
export const META_ACCOUNT_ID = "act_762696206838329";
export const META_API_VERSION = "v25.0";

export function dateInZone(date = new Date(), timeZone = META_TIMEZONE) {
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly ?? "")) throw new Error("Date must use YYYY-MM-DD.");
  const date = new Date(`${dateOnly}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function chunkDateRange(since, until, maximumDays = 90) {
  if (!Number.isInteger(maximumDays) || maximumDays < 1) throw new Error("maximumDays must be a positive integer.");
  if (since > until) throw new Error("since must be on or before until.");
  const ranges = [];
  for (let start = since; start <= until; start = addDays(ranges.at(-1).until, 1)) {
    const end = addDays(start, maximumDays - 1);
    ranges.push({ since: start, until: end < until ? end : until });
  }
  return ranges;
}

export function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function actionValue(actions, actionType) {
  return number((actions ?? []).find((action) => action.action_type === actionType)?.value);
}

export function leadCount(actions) {
  for (const actionType of [
    "lead",
    "onsite_conversion.lead_grouped",
    "offsite_conversion.fb_pixel_lead",
  ]) {
    const action = (actions ?? []).find((candidate) => candidate.action_type === actionType);
    if (action) return number(action.value);
  }
  return 0;
}

export function classifyPurpose(campaignName) {
  return /hiring|painter recruitment|recruit|employ|emloy/i.test(campaignName ?? "")
    ? "recruiting"
    : "customer_acquisition";
}

export function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(String(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function insightToPerformanceRow(insight, context) {
  const accountId = String(insight.account_id || context.accountId).replace(/^act_/, "");
  const campaignId = String(insight.campaign_id ?? "").trim();
  const reportDate = String(insight.date_start ?? "").trim();
  if (!campaignId) throw new Error("Meta insight row is missing campaign_id.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || insight.date_stop !== reportDate) {
    throw new Error(`Meta insight row is not daily for campaign ${campaignId}.`);
  }
  const campaignName = String(insight.campaign_name || "Unnamed campaign");
  const sourceSha256 = crypto.createHash("sha256").update(JSON.stringify(insight)).digest("hex");
  const key = ["meta", accountId, "daily", reportDate, "campaign", campaignId].join(":");
  const inlineLinkClicks = Math.round(number(insight.inline_link_clicks));
  return {
    id: stableUuid(`marketing-performance:${key}`),
    platform: "meta",
    account_id: accountId,
    grain: "daily",
    period_start: reportDate,
    period_end: reportDate,
    entity_level: "campaign",
    entity_id: campaignId,
    entity_name: campaignName,
    parent_campaign_name: campaignName,
    parent_ad_set_name: null,
    purpose: classifyPurpose(campaignName),
    currency: context.currency,
    spend_cents: Math.round(number(insight.spend) * 100),
    results: leadCount(insight.actions),
    result_indicator: "lead",
    impressions: Math.round(number(insight.impressions)),
    reach: Math.round(number(insight.reach)),
    clicks: Math.round(number(insight.clicks)),
    link_clicks: inlineLinkClicks || Math.round(actionValue(insight.actions, "link_click")),
    landing_page_views: Math.round(actionValue(insight.actions, "landing_page_view")),
    metadata: {
      source_system: "meta_marketing_api",
      api_version: context.apiVersion,
      account_name: context.accountName,
      account_timezone: context.accountTimezone,
      action_report_time: "conversion",
      attribution_window: "account_default",
      sync_since: context.since,
      sync_until: context.until,
      source_sha256: sourceSha256,
      source_payload: insight,
    },
    captured_at: context.capturedAt,
  };
}

export function summarizePerformanceRows(rows) {
  const customer = rows.filter((row) => row.purpose === "customer_acquisition");
  const recruiting = rows.filter((row) => row.purpose === "recruiting");
  const summarize = (items) => ({
    rows: items.length,
    spend_cents: items.reduce((total, row) => total + row.spend_cents, 0),
    leads: items.reduce((total, row) => total + number(row.results), 0),
    impressions: items.reduce((total, row) => total + row.impressions, 0),
    clicks: items.reduce((total, row) => total + row.clicks, 0),
  });
  return {
    customer_acquisition: summarize(customer),
    recruiting: summarize(recruiting),
  };
}
