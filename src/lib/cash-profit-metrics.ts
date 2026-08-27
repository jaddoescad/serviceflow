import type { MetricsPeriod, MetricsPeriodSelection } from "@/lib/metrics-period";

export type CashTransactionRow = {
  id: string;
  posted_on: string;
  amount_cents: number | string | null;
  category: string | null;
  counterparty: string | null;
  description: string | null;
  transaction_type: string | null;
  is_transfer: boolean | null;
  review_status: string | null;
  updated_at?: string | null;
};

export type CashExpenseBreakdown = {
  labourAndFieldServicesCents: number;
  materialsCents: number;
  marketingCents: number;
  scottCaledonianCents: number;
  otherSalesCompensationCents: number;
  virtualAssistantsCents: number;
  taxRemittancesCents: number;
  customerRefundsCents: number;
  otherOverheadCents: number;
};

export type CashProfitPeriod = {
  period: MetricsPeriod;
  cashReceivedCents: number;
  customerReceiptsCents: number;
  otherCashReceivedCents: number;
  classifiedExpensesCents: number;
  classifiedCashProfitCents: number;
  cashProfitMargin: number | null;
  expenseRate: number | null;
  expenses: CashExpenseBreakdown;
  pendingReview: {
    rows: number;
    inflowCents: number;
    outflowCents: number;
    netImpactCents: number;
    cashChangeIfIncludedCents: number;
    transactions: Array<{
      id: string;
      postedOn: string;
      description: string;
      counterparty: string | null;
      category: string;
      amountCents: number;
    }>;
  };
  categorizedNeedsReview: {
    rows: number;
    inflowCents: number;
    outflowCents: number;
  };
};

export type CashProfit = {
  current: CashProfitPeriod;
  previous: CashProfitPeriod;
  profitPercentChange: number | null;
  lastRefreshedAt: string | null;
};

const LABOUR_AND_FIELD_SERVICES = new Set([
  "Subcontractors",
  "Colour consultation",
  "Pressure washing",
]);
const MATERIALS = new Set(["Paint & materials", "Waste & disposal"]);
const MARKETING = new Set(["Advertising & marketing", "Printing & signage"]);

function cents(value: number | string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function inPeriod(value: string, period: MetricsPeriod): boolean {
  return value >= period.start && value <= period.end;
}

function addExpense(
  breakdown: CashExpenseBreakdown,
  category: string,
  counterparty: string | null,
  amountCents: number,
): void {
  if (LABOUR_AND_FIELD_SERVICES.has(category)) {
    breakdown.labourAndFieldServicesCents += amountCents;
  } else if (MATERIALS.has(category)) {
    breakdown.materialsCents += amountCents;
  } else if (MARKETING.has(category)) {
    breakdown.marketingCents += amountCents;
  } else if (category === "Sales commissions") {
    if (counterparty === "Scott Madden" || counterparty === "Caledonian Painting Ltd") {
      breakdown.scottCaledonianCents += amountCents;
    } else {
      breakdown.otherSalesCompensationCents += amountCents;
    }
  } else if (category === "Virtual assistant salaries") {
    breakdown.virtualAssistantsCents += amountCents;
  } else if (category === "HST remittance") {
    breakdown.taxRemittancesCents += amountCents;
  } else if (category === "Customer refunds") {
    breakdown.customerRefundsCents += amountCents;
  } else {
    breakdown.otherOverheadCents += amountCents;
  }
}

function buildPeriod(rows: CashTransactionRow[], period: MetricsPeriod): CashProfitPeriod {
  const expenses: CashExpenseBreakdown = {
    labourAndFieldServicesCents: 0,
    materialsCents: 0,
    marketingCents: 0,
    scottCaledonianCents: 0,
    otherSalesCompensationCents: 0,
    virtualAssistantsCents: 0,
    taxRemittancesCents: 0,
    customerRefundsCents: 0,
    otherOverheadCents: 0,
  };
  let cashReceivedCents = 0;
  let customerReceiptsCents = 0;
  let classifiedExpensesCents = 0;
  let classifiedCashProfitCents = 0;
  let pendingRows = 0;
  let pendingInflowCents = 0;
  let pendingOutflowCents = 0;
  const pendingTransactions: CashProfitPeriod["pendingReview"]["transactions"] = [];
  let categorizedReviewRows = 0;
  let categorizedReviewInflowCents = 0;
  let categorizedReviewOutflowCents = 0;

  for (const row of rows) {
    if (!inPeriod(row.posted_on, period) || row.is_transfer) continue;
    const amountCents = cents(row.amount_cents);
    if (amountCents === 0) continue;

    const category = row.category ?? "Uncategorized";
    const hasKnownBusinessCategory = row.review_status === "reconciled"
      || category !== "Uncategorized";
    if (!hasKnownBusinessCategory) {
      pendingRows += 1;
      if (amountCents > 0) pendingInflowCents += amountCents;
      else pendingOutflowCents += Math.abs(amountCents);
      pendingTransactions.push({
        id: row.id,
        postedOn: row.posted_on,
        description: row.description ?? "No bank description",
        counterparty: row.counterparty,
        category: row.category ?? "Uncategorized",
        amountCents,
      });
      continue;
    }

    if (row.review_status !== "reconciled") {
      categorizedReviewRows += 1;
      if (amountCents > 0) categorizedReviewInflowCents += amountCents;
      else categorizedReviewOutflowCents += Math.abs(amountCents);
    }

    classifiedCashProfitCents += amountCents;
    if (amountCents > 0) {
      cashReceivedCents += amountCents;
      if (category === "Painting revenue") customerReceiptsCents += amountCents;
      continue;
    }

    const expenseCents = Math.abs(amountCents);
    classifiedExpensesCents += expenseCents;
    addExpense(expenses, category, row.counterparty, expenseCents);
  }

  const pendingNetImpactCents = pendingInflowCents - pendingOutflowCents;
  return {
    period,
    cashReceivedCents,
    customerReceiptsCents,
    otherCashReceivedCents: cashReceivedCents - customerReceiptsCents,
    classifiedExpensesCents,
    classifiedCashProfitCents,
    cashProfitMargin: cashReceivedCents === 0 ? null : classifiedCashProfitCents / cashReceivedCents,
    expenseRate: cashReceivedCents === 0 ? null : classifiedExpensesCents / cashReceivedCents,
    expenses,
    pendingReview: {
      rows: pendingRows,
      inflowCents: pendingInflowCents,
      outflowCents: pendingOutflowCents,
      netImpactCents: pendingNetImpactCents,
      cashChangeIfIncludedCents: classifiedCashProfitCents + pendingNetImpactCents,
      transactions: pendingTransactions.sort((a, b) =>
        a.postedOn.localeCompare(b.postedOn) || a.id.localeCompare(b.id)),
    },
    categorizedNeedsReview: {
      rows: categorizedReviewRows,
      inflowCents: categorizedReviewInflowCents,
      outflowCents: categorizedReviewOutflowCents,
    },
  };
}

export function buildCashProfit(
  selection: MetricsPeriodSelection,
  rows: CashTransactionRow[],
): CashProfit {
  const current = buildPeriod(rows, selection.current);
  const previous = buildPeriod(rows, selection.previous);
  const profitPercentChange = previous.classifiedCashProfitCents === 0
    ? null
    : (current.classifiedCashProfitCents - previous.classifiedCashProfitCents)
      / Math.abs(previous.classifiedCashProfitCents) * 100;
  const lastRefreshedAt = rows
    .map((row) => row.updated_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return { current, previous, profitPercentChange, lastRefreshedAt };
}
