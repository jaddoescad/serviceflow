import assert from "node:assert/strict";
import test from "node:test";

import {
  amountAuthorityEquivalent,
  jobAccountingLockReason,
  operationalAuthorityEquivalent,
  productionMonthDecision,
} from "./lib/dripjobs-job-authority.mjs";

test("production month is assigned once and never changed by later imports", () => {
  assert.deepEqual(productionMonthDecision(null, "2026-07-01"), {
    apply: true,
    effectiveMonth: "2026-07-01",
    reason: "production_month_missing",
  });
  assert.deepEqual(productionMonthDecision("2026-07-01", "2026-08-01"), {
    apply: false,
    effectiveMonth: "2026-07-01",
    reason: "production_month_already_set",
  });
  assert.deepEqual(productionMonthDecision("2026-08-01", "2026-07-01"), {
    apply: false,
    effectiveMonth: "2026-08-01",
    reason: "production_month_already_set",
  });
  assert.deepEqual(productionMonthDecision("2026-07-01", "2026-07-01"), {
    apply: false,
    effectiveMonth: "2026-07-01",
    reason: "production_month_already_set",
  });
  assert.equal(productionMonthDecision("2026-08-01", null).effectiveMonth, "2026-08-01");
});

test("Barry regression: an August workflow transition cannot replace a confirmed July production month", () => {
  assert.deepEqual(productionMonthDecision("2026-07-01", "2026-08-01"), {
    apply: false,
    effectiveMonth: "2026-07-01",
    reason: "production_month_already_set",
  });
});

test("Jobs List operational authority tracks schedules, actual dates, and invoice balance", () => {
  const row = {
    proposalId: "3000001",
    status: "SCHEDULED",
    dealStage: "Project Scheduled",
    invoiceStatus: "Partially Paid",
    paidCents: 25000,
    balanceCents: 88000,
    proposalSignedDateIso: "2026-08-01",
    jobScheduledDateRaw: "Mon. Aug 24 - Fri. Aug 28",
    scheduledStartDateIso: "2026-08-24",
    scheduledEndDateIso: "2026-08-28",
    jobStartDateIso: null,
    jobCompletionDateIso: null,
    salesperson: "Scott Madden",
    projectManager: "Scott Madden",
    crew: "Crew 1",
  };
  const authority = {
    source_type: "dripjobs_jobs_list_all_views_csv",
    proposal_id: "3000001",
    job_status: "SCHEDULED",
    deal_stage: "Project Scheduled",
    invoice_status: "Partially Paid",
    paid_cents: 25000,
    balance_cents: 88000,
    proposal_signed_on: "2026-08-01",
    job_schedule_raw: "Mon. Aug 24 - Fri. Aug 28",
    scheduled_on: "2026-08-24",
    scheduled_end_on: "2026-08-28",
    started_on: null,
    completed_on: null,
    salesperson: "Scott Madden",
    project_manager: "Scott Madden",
    crew: "Crew 1",
  };
  assert.equal(operationalAuthorityEquivalent(authority, row), true);
  assert.equal(operationalAuthorityEquivalent({ ...authority, balance_cents: 87000 }, row), false);
});

test("historical jobs remain locked", () => {
  assert.match(jobAccountingLockReason({ started_on: "2026-05-31" }), /before 2026-06-01/);
  assert.equal(jobAccountingLockReason({ started_on: "2026-06-01" }), null);
  assert.match(jobAccountingLockReason({ status: "completed", started_on: null, completed_on: null }), /no verified/);
});

test("Jobs List authority equivalence ignores daily file hashes but requires exact row identity", () => {
  const row = { proposalId: "3000001", invoiceId: "500001", grossCents: 113000, beforeHstCents: 100000 };
  assert.equal(amountAuthorityEquivalent({
    source_type: "dripjobs_jobs_list_all_views_csv",
    proposal_id: "3000001",
    invoice_id: "500001",
    gross_amount_cents: 113000,
    before_hst_cents: 100000,
    source_sha256: "old-run-is-fine",
  }, row), true);
  assert.equal(amountAuthorityEquivalent({ source_type: "dripjobs_invoice_list_csv", proposal_id: "3000001", invoice_id: "500001", gross_amount_cents: 113000, before_hst_cents: 100000 }, row), false);
});
