import assert from "node:assert/strict";
import test from "node:test";

import {
  amountAuthorityEquivalent,
  jobAccountingLockReason,
  productionMonthDecision,
} from "./lib/dripjobs-job-authority.mjs";

test("production month advances on later qualifying transitions but never moves backward", () => {
  assert.deepEqual(productionMonthDecision(null, "2026-07-01"), {
    apply: true,
    effectiveMonth: "2026-07-01",
    reason: "production_month_missing",
  });
  assert.equal(productionMonthDecision("2026-07-01", "2026-08-01").apply, true);
  assert.deepEqual(productionMonthDecision("2026-08-01", "2026-07-01"), {
    apply: false,
    effectiveMonth: "2026-08-01",
    reason: "never_move_backward",
  });
  assert.equal(productionMonthDecision("2026-08-01", null).effectiveMonth, "2026-08-01");
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
