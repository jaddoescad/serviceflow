import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketingSalesSnapshot,
  getPreviousPeriod,
} from "../src/lib/marketing-sales-metrics.ts";

const dataset = {
  leads: [
    { dealId: "meta-1", createdOn: "2026-01-05", channel: "paid_social", rawSource: "Meta", proposalRecorded: true },
    { dealId: "web-1", createdOn: "2026-01-10", channel: "website", rawSource: "/contact", proposalRecorded: false },
    { dealId: "meta-2", createdOn: "2026-02-01", channel: "paid_social", rawSource: "Meta", proposalRecorded: false },
  ],
  jobs: [
    { proposalId: "p1", leadDealId: "meta-1", jobName: "First", status: "ARCHIVED", proposalSignedOn: "2026-01-12", jobStartOn: null, jobCompletionOn: null, invoiceIds: ["i1"], cashAllocationCount: 1, bookedRevenueBeforeHst: 1000, cashRevenueBeforeHst: 500 },
    { proposalId: "p2", leadDealId: "meta-1", jobName: "Second", status: "ARCHIVED", proposalSignedOn: "2026-01-20", jobStartOn: null, jobCompletionOn: null, invoiceIds: ["i2"], cashAllocationCount: 1, bookedRevenueBeforeHst: 500, cashRevenueBeforeHst: 500 },
    { proposalId: "p3", leadDealId: "web-1", jobName: "Website", status: "ARCHIVED", proposalSignedOn: "2026-01-15", jobStartOn: null, jobCompletionOn: null, invoiceIds: [], cashAllocationCount: 0, bookedRevenueBeforeHst: 750, cashRevenueBeforeHst: 0 },
  ],
  spend: [
    { transactionId: "s1", postedOn: "2026-01-06", amountCad: 300, counterparty: "Meta Ads" },
    { transactionId: "s2", postedOn: "2025-12-20", amountCad: 100, counterparty: "Meta Ads" },
  ],
  platformMonthly: [],
  quality: {
    totalLeads: 3,
    totalJobs: 3,
    confirmedJobLinks: 3,
    missingLeadSourceJobs: 0,
    linkedJobsWithInvoice: 2,
    linkedJobsWithoutInvoice: 1,
    linkedJobsWithoutCashEvidence: 1,
    activeCustomerInvoiceAllocations: 2,
    proposalsRecorded: 1,
    leadCapturedAt: null,
    jobCapturedAt: null,
    platformCapturedAt: null,
    spendLastPostedOn: "2026-01-06",
  },
};

test("customers are distinct leads while every job contributes revenue", () => {
  const result = buildMarketingSalesSnapshot(dataset, {
    from: "2026-01-01",
    to: "2026-01-31",
    channel: "all",
  });
  assert.equal(result.leads, 2);
  assert.equal(result.customers, 2);
  assert.equal(result.jobs, 3);
  assert.equal(result.bookedRevenueBeforeHst, 2250);
  assert.equal(result.blendedCac, 150);
  assert.equal(result.evidence.jobsWithoutInvoice, 1);
  assert.equal(result.evidence.jobsWithoutCashEvidence, 1);
  assert.equal(result.evidence.selectedAllocationCount, 2);
});

test("Meta CAC counts one acquired customer even when they bought two jobs", () => {
  const result = buildMarketingSalesSnapshot(dataset, {
    from: "2026-01-01",
    to: "2026-01-31",
    channel: "paid_social",
  });
  assert.equal(result.metaLeads, 1);
  assert.equal(result.metaCustomers, 1);
  assert.equal(result.metaJobs, 2);
  assert.equal(result.metaCpl, 300);
  assert.equal(result.metaCac, 300);
  assert.equal(result.metaBookedRoas, 5);
  assert.equal(result.metaCashRoas, 3.33);
});

test("unpaid channels never receive fake spend, CAC, or ROAS", () => {
  const result = buildMarketingSalesSnapshot(dataset, {
    from: "2026-01-01",
    to: "2026-01-31",
    channel: "website",
  });
  assert.equal(result.selectedSpendCad, null);
  assert.equal(result.selectedCac, null);
  assert.equal(result.channels[0].spendCad, null);
  assert.equal(result.channels[0].bookedRoas, null);
});

test("previous period uses the same inclusive number of days", () => {
  assert.deepEqual(
    getPreviousPeriod({ from: "2026-03-01", to: "2026-03-31" }),
    { from: "2026-01-29", to: "2026-02-28" },
  );
});
