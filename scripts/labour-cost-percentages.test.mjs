import assert from "node:assert/strict";
import test from "node:test";

import {
  labourCostPercent,
  labourCostTone,
} from "../src/lib/labour-cost-percentages.ts";
import { isDripJobsJobAmountBudget } from "../src/lib/job-budget-selection.ts";

test("calculates the current invoice share from before-HST job revenue", () => {
  assert.equal(labourCostPercent(10_000, 100_000), 10);
});

test("rounds the displayed percentage to one decimal place", () => {
  assert.equal(labourCostPercent(12_345, 100_000), 12.3);
});

test("does not invent a percentage without verified job revenue", () => {
  assert.equal(labourCostPercent(10_000, 0), null);
  assert.equal(labourCostPercent(10_000, null), null);
});

test("uses green below 40, neutral at 40, and red above 40", () => {
  assert.equal(labourCostTone(39.9), "good");
  assert.equal(labourCostTone(40), "neutral");
  assert.equal(labourCostTone(40.1), "bad");
});

test("uses only job amounts imported from a validated DripJobs list CSV", () => {
  assert.equal(
    isDripJobsJobAmountBudget({
      job_id: "job",
      source: "manual",
      status: "active",
      version: 3,
      updated_at: "2026-08-16T00:00:00Z",
      amount_including_tax_cents: 543_900,
      metadata: {
        job_amount_authority: {
          source_type: "dripjobs_jobs_list_all_views_csv",
          source_sha256: "jobs-list-source-hash",
        },
      },
    }),
    true,
  );
  assert.equal(
    isDripJobsJobAmountBudget({
      job_id: "job",
      source: "manual",
      status: "active",
      version: 2,
      updated_at: "2026-08-15T00:00:00Z",
      amount_including_tax_cents: 543_900,
      metadata: {
        job_amount_authority: {
          source_type: "dripjobs_invoice_list_csv",
          source_sha256: "source-hash",
        },
      },
    }),
    true,
  );
  assert.equal(
    isDripJobsJobAmountBudget({
      job_id: "job",
      source: "manual",
      status: "active",
      version: 1,
      updated_at: "2026-08-14T00:00:00Z",
      amount_including_tax_cents: 543_900,
      metadata: {},
    }),
    false,
  );
  assert.equal(
    isDripJobsJobAmountBudget({
      job_id: "job",
      source: "manual",
      status: "active",
      version: 2,
      updated_at: "2026-08-15T00:00:00Z",
      amount_including_tax_cents: 0,
      metadata: {
        job_amount_authority: {
          source_type: "dripjobs_invoice_list_csv",
          source_sha256: "source-hash",
        },
      },
    }),
    false,
  );
});
