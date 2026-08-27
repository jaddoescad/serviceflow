import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPurpose,
  chunkDateRange,
  insightToPerformanceRow,
  leadCount,
  summarizePerformanceRows,
} from "./lib/meta-marketing-sync.mjs";
import { parseArgs } from "./meta-marketing-daily-sync.mjs";

const context = {
  accountId: "act_762696206838329",
  accountName: "Ottawa Painters",
  accountTimezone: "America/Toronto",
  apiVersion: "v25.0",
  currency: "CAD",
  since: "2026-08-07",
  until: "2026-08-20",
  capturedAt: "2026-08-20T20:00:00.000Z",
};

test("rolling sync defaults to a 14-day Toronto window including today", () => {
  const options = parseArgs([], new Date("2026-08-20T20:00:00.000Z"));
  assert.equal(options.since, "2026-08-07");
  assert.equal(options.until, "2026-08-20");
  assert.equal(options.apply, false);
});

test("backfill begins at the retained monthly-history boundary", () => {
  const options = parseArgs(["--backfill", "--apply"], new Date("2026-08-20T20:00:00.000Z"));
  assert.equal(options.since, "2025-08-01");
  assert.equal(options.until, "2026-08-20");
  assert.equal(options.apply, true);
});

test("long backfills are split into bounded Insights requests", () => {
  assert.deepEqual(chunkDateRange("2026-01-01", "2026-08-20", 90), [
    { since: "2026-01-01", until: "2026-03-31" },
    { since: "2026-04-01", until: "2026-06-29" },
    { since: "2026-06-30", until: "2026-08-20" },
  ]);
});

test("lead count uses Meta's aggregate lead action without double counting variants", () => {
  assert.equal(leadCount([
    { action_type: "lead", value: "4" },
    { action_type: "onsite_conversion.lead_grouped", value: "3" },
  ]), 4);
  assert.equal(leadCount([{ action_type: "offsite_conversion.fb_pixel_lead", value: "2" }]), 2);
});

test("campaign purpose separates recruiting from painting inquiries", () => {
  assert.equal(classifyPurpose("Hiring - Painters | Ottawa"), "recruiting");
  assert.equal(classifyPurpose("Exterior Painting | Ottawa"), "customer_acquisition");
});

test("daily insight becomes a stable dashboard row with raw provenance", () => {
  const source = {
    account_id: "762696206838329",
    campaign_id: "1200001",
    campaign_name: "Exterior Painting | Ottawa",
    date_start: "2026-08-20",
    date_stop: "2026-08-20",
    spend: "123.45",
    impressions: "10000",
    reach: "7000",
    clicks: "321",
    inline_link_clicks: "111",
    actions: [
      { action_type: "lead", value: "5" },
      { action_type: "landing_page_view", value: "90" },
    ],
  };
  const row = insightToPerformanceRow(source, context);
  const repeated = insightToPerformanceRow(source, { ...context, capturedAt: "2026-08-20T21:00:00.000Z" });
  assert.equal(row.id, repeated.id);
  assert.equal(row.spend_cents, 12345);
  assert.equal(row.results, 5);
  assert.equal(row.clicks, 321);
  assert.equal(row.link_clicks, 111);
  assert.equal(row.landing_page_views, 90);
  assert.equal(row.metadata.source_payload.campaign_id, "1200001");
  assert.match(row.metadata.source_sha256, /^[0-9a-f]{64}$/);
});

test("summary keeps customer acquisition separate from recruiting", () => {
  const customer = insightToPerformanceRow({
    campaign_id: "1",
    campaign_name: "Interior Painting",
    date_start: "2026-08-20",
    date_stop: "2026-08-20",
    spend: "10",
    impressions: "100",
    clicks: "5",
    actions: [{ action_type: "lead", value: "2" }],
  }, context);
  const recruiting = insightToPerformanceRow({
    campaign_id: "2",
    campaign_name: "Painter Recruitment",
    date_start: "2026-08-20",
    date_stop: "2026-08-20",
    spend: "20",
    impressions: "200",
    clicks: "10",
    actions: [{ action_type: "lead", value: "4" }],
  }, context);
  assert.deepEqual(summarizePerformanceRows([customer, recruiting]), {
    customer_acquisition: { rows: 1, spend_cents: 1000, leads: 2, impressions: 100, clicks: 5 },
    recruiting: { rows: 1, spend_cents: 2000, leads: 4, impressions: 200, clicks: 10 },
  });
});
