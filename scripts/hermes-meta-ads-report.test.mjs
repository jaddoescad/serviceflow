import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  classifyPurpose,
  formatSlackReport,
  leadCount,
  summarizeRows,
} from "../hermes/skills/ottawa-meta-ads-reporting/scripts/meta-ads-report.mjs";

test("adds calendar days safely", () => {
  assert.equal(addDays("2026-08-10", -6), "2026-08-04");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("uses Meta's aggregate lead action without double counting lead-like actions", () => {
  assert.equal(
    leadCount([
      { action_type: "lead", value: "3" },
      { action_type: "offsite_conversion.fb_pixel_lead", value: "2" },
      { action_type: "onsite_conversion.lead", value: "1" },
    ]),
    3,
  );
});

test("separates recruiting campaigns from customer acquisition", () => {
  assert.equal(classifyPurpose("Ottawa Painter Recruitment"), "recruiting");
  assert.equal(classifyPurpose("Interior Painting Leads"), "customer_acquisition");
});

test("summarizes spend, leads, CPL, and campaign purpose", () => {
  const summary = summarizeRows([
    {
      campaign_id: "1",
      campaign_name: "Interior Leads",
      spend: "120.50",
      impressions: "1000",
      reach: "800",
      clicks: "40",
      actions: [{ action_type: "lead", value: "4" }],
    },
    {
      campaign_id: "2",
      campaign_name: "Painter Hiring",
      spend: "30",
      impressions: "400",
      reach: "300",
      clicks: "10",
      actions: [{ action_type: "lead", value: "2" }],
    },
  ]);

  assert.deepEqual(summary.customer_acquisition, {
    spend: 120.5,
    leads: 4,
    cost_per_lead: 30.13,
    impressions: 1000,
    reach: 800,
    clicks: 40,
    ctr: 4,
  });
  assert.equal(summary.recruiting.leads, 2);
  assert.equal(summary.all.spend, 150.5);
});

test("formats a concise Slack-ready report", () => {
  const daily = summarizeRows([
    {
      campaign_id: "1",
      campaign_name: "Interior Leads",
      spend: "50",
      impressions: "500",
      reach: "400",
      clicks: "20",
      actions: [{ action_type: "lead", value: "2" }],
    },
  ]);
  const report = {
    period: { date: "2026-08-09" },
    timezone: "America/Toronto",
    daily,
    seven_day: daily,
    thirty_day: daily,
    feedback: ["Customer CPL was within 20% of the seven-day average."],
  };
  const text = formatSlackReport(report);
  assert.match(text, /Customer leads: 2 \| Spend: \$50\.00 \| CPL: \$25\.00/);
  assert.match(text, /30-day customer: 2 leads/);
  assert.match(text, /Interior Leads: 2 leads/);
  assert.match(text, /Meta-attributed results/);
});
