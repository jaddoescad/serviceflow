import assert from "node:assert/strict";
import test from "node:test";

import { summarizeCompletedLabourPeriod } from "../src/lib/labour-period.ts";

test("calculates a revenue-weighted share for costed jobs completed in the period", () => {
  const summary = summarizeCompletedLabourPeriod(
    [
      { completedOn: "2026-08-05", amountBeforeTax: 1_000, labourCost: 300, labourExcluded: false },
      { completedOn: "2026-08-31", amountBeforeTax: 3_000, labourCost: 1_500, labourExcluded: false },
    ],
    "2026-08-02",
    "2026-09-01",
  );

  assert.deepEqual(summary, {
    count: 2,
    jobValue: 4_000,
    labourCost: 1_800,
    sharePercent: 45,
  });
});

test("excludes out-of-window, uncosted, amountless, and labour-excluded jobs", () => {
  const summary = summarizeCompletedLabourPeriod(
    [
      { completedOn: "2026-08-01", amountBeforeTax: 1_000, labourCost: 300, labourExcluded: false },
      { completedOn: "2026-09-02", amountBeforeTax: 1_000, labourCost: 300, labourExcluded: false },
      { completedOn: "2026-08-15", amountBeforeTax: 1_000, labourCost: 0, labourExcluded: false },
      { completedOn: "2026-08-15", amountBeforeTax: null, labourCost: 300, labourExcluded: false },
      { completedOn: "2026-08-15", amountBeforeTax: 1_000, labourCost: 300, labourExcluded: true },
    ],
    "2026-08-02",
    "2026-09-01",
  );

  assert.deepEqual(summary, {
    count: 0,
    jobValue: 0,
    labourCost: 0,
    sharePercent: null,
  });
});

test("includes both date boundaries", () => {
  const summary = summarizeCompletedLabourPeriod(
    [
      { completedOn: "2026-08-02", amountBeforeTax: 1_000, labourCost: 400, labourExcluded: false },
      { completedOn: "2026-09-01", amountBeforeTax: 1_000, labourCost: 400, labourExcluded: false },
    ],
    "2026-08-02",
    "2026-09-01",
  );

  assert.equal(summary.count, 2);
  assert.equal(summary.sharePercent, 40);
});
