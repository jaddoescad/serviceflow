import assert from "node:assert/strict";
import test from "node:test";
import { buildCashProfit } from "../src/lib/cash-profit-metrics.ts";

const selection = {
  preset: "month",
  current: { start: "2026-08-01", end: "2026-08-20" },
  previous: { start: "2026-07-01", end: "2026-07-20" },
};

function row(id, posted_on, amount_cents, category, review_status = "reconciled", is_transfer = false, counterparty = null) {
  return { id, posted_on, amount_cents, category, counterparty, description: `Transaction ${id}`, review_status, is_transfer, transaction_type: null, updated_at: `${posted_on}T12:00:00Z` };
}

test("cash profit includes reconciled cash, excludes transfers, and keeps pending impact visible", () => {
  const result = buildCashProfit(selection, [
    row("1", "2026-08-03", 1_000_000, "Painting revenue"),
    row("2", "2026-08-04", -200_000, "Subcontractors"),
    row("3", "2026-08-05", -50_000, "Colour consultation"),
    row("4", "2026-08-06", -100_000, "Paint & materials"),
    row("5", "2026-08-07", -80_000, "Advertising & marketing"),
    row("6", "2026-08-08", -90_000, "Sales commissions", "reconciled", false, "Scott Madden"),
    row("7", "2026-08-09", -60_000, "Virtual assistant salaries"),
    row("8", "2026-08-10", -10_000, "Software & subscriptions"),
    row("9", "2026-08-11", -40_000, "Uncategorized", "needs_review"),
    row("10", "2026-08-12", 25_000, "Painting revenue", "needs_review"),
    row("11", "2026-08-13", -500_000, "Credit card payment", "reconciled", true),
    row("12", "2026-07-02", 500_000, "Painting revenue"),
    row("13", "2026-07-03", -250_000, "Subcontractors"),
  ]);

  assert.equal(result.current.cashReceivedCents, 1_025_000);
  assert.equal(result.current.classifiedExpensesCents, 590_000);
  assert.equal(result.current.classifiedCashProfitCents, 435_000);
  assert.equal(result.current.cashProfitMargin, 435_000 / 1_025_000);
  assert.equal(result.current.expenseRate, 590_000 / 1_025_000);
  assert.equal(result.current.expenses.labourAndFieldServicesCents, 250_000);
  assert.equal(result.current.expenses.scottCaledonianCents, 90_000);
  assert.equal(result.current.expenses.otherSalesCompensationCents, 0);
  assert.deepEqual(result.current.pendingReview, {
    rows: 1,
    inflowCents: 0,
    outflowCents: 40_000,
    netImpactCents: -40_000,
    cashChangeIfIncludedCents: 395_000,
    transactions: [
      { id: "9", postedOn: "2026-08-11", description: "Transaction 9", counterparty: null, category: "Uncategorized", amountCents: -40_000 },
    ],
  });
  assert.deepEqual(result.current.categorizedNeedsReview, {
    rows: 1,
    inflowCents: 25_000,
    outflowCents: 0,
  });
  assert.equal(result.previous.classifiedCashProfitCents, 250_000);
  assert.equal(result.profitPercentChange, 74);
});
