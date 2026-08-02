import { createClient } from "@/lib/supabase/server";

type PlatformPerformanceRow = {
  account_id: string;
  entity_level: "campaign" | "ad_set" | "ad";
  entity_name: string;
  parent_campaign_name: string | null;
  parent_ad_set_name: string | null;
  purpose: "customer_acquisition" | "recruiting" | "other";
  reporting_start: string;
  reporting_end: string;
  currency: "CAD" | "USD";
  results: number | string | null;
  result_indicator: string | null;
  amount_spent: number | string;
  impressions: number | string;
  reach: number | string;
  source_filename: string;
  source_payload: Record<string, unknown> | null;
  captured_at: string;
};

type AttributionRow = {
  customer_invoice_id: string;
  invoice_date: string;
  normalized_channel: string;
  booked_revenue_before_hst: number | string;
  bank_backed_revenue_before_hst: number | string;
};

type BankRow = {
  posted_on: string;
  category: string;
  net_amount: number | string;
  transaction_type: string;
  is_transfer: boolean;
};

export type MarketingMetricCohort = {
  spend: number;
  jobs: number;
  bookedRevenueBeforeHst: number;
  bankBackedRevenueBeforeHst: number;
  customerAcquisitionCost: number | null;
  bookedRoas: number | null;
  cashRoas: number | null;
};

export type MarketingPlatformEntity = {
  accountId: string;
  accountName: string;
  currency: "CAD" | "USD";
  level: "campaign" | "ad_set" | "ad";
  name: string;
  campaignName: string | null;
  adSetName: string | null;
  purpose: "customer_acquisition" | "recruiting" | "other";
  spend: number;
  leads: number;
  impressions: number;
  reach: number;
};

export type MarketingPlatformAccount = {
  accountId: string;
  name: string;
  currency: "CAD" | "USD";
  reportingStart: string;
  reportingEnd: string;
  customerSpend: number;
  recruitingSpend: number;
  totalSpend: number;
  customerLeads: number;
  recruitingLeads: number;
};

export type MarketingMetrics = {
  accounting: {
    spend: number;
    transactionCount: number;
    revenueBeforeHst: number;
    marketingShareOfRevenue: number | null;
    monthlySpend: Array<{ month: string; spend: number; transactions: number }>;
  };
  paidSocial: MarketingMetricCohort;
  platformAccounts: MarketingPlatformAccount[];
  platformEntities: MarketingPlatformEntity[];
  capturedAt: string | null;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0
    ? Math.round((numerator / denominator) * 100) / 100
    : null;
}

function cohort(rows: AttributionRow[], spend: number): MarketingMetricCohort {
  const bookedRevenueBeforeHst = roundMoney(
    rows.reduce(
      (total, row) => total + Number(row.booked_revenue_before_hst ?? 0),
      0,
    ),
  );
  const bankBackedRevenueBeforeHst = roundMoney(
    rows.reduce(
      (total, row) => total + Number(row.bank_backed_revenue_before_hst ?? 0),
      0,
    ),
  );
  return {
    spend,
    jobs: rows.length,
    bookedRevenueBeforeHst,
    bankBackedRevenueBeforeHst,
    customerAcquisitionCost:
      rows.length > 0 ? ratio(spend, rows.length) : null,
    bookedRoas: ratio(bookedRevenueBeforeHst, spend),
    cashRoas: ratio(bankBackedRevenueBeforeHst, spend),
  };
}

function latestPlatformRows(rows: PlatformPerformanceRow[]) {
  const latestByAccount = new Map<string, string>();
  for (const row of rows) {
    const latest = latestByAccount.get(row.account_id);
    if (!latest || row.captured_at > latest) {
      latestByAccount.set(row.account_id, row.captured_at);
    }
  }
  return rows.filter(
    (row) => row.captured_at === latestByAccount.get(row.account_id),
  );
}

function accountName(row: PlatformPerformanceRow) {
  const value = row.source_payload?.account_name;
  return typeof value === "string" && value.trim()
    ? value.trim()
    : `Meta account ${row.account_id}`;
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  return [...groups.entries()];
}

export async function getMarketingYears() {
  const supabase = await createClient();
  const result = await supabase
    .from("financial_transactions")
    .select("posted_on")
    .eq("category", "Advertising & marketing")
    .order("posted_on", { ascending: false });
  if (result.error) throw result.error;
  return [
    ...new Set((result.data ?? []).map((row) => Number(row.posted_on.slice(0, 4)))),
  ].sort((left, right) => right - left);
}

export async function getMarketingMetrics(year: number): Promise<MarketingMetrics> {
  const supabase = await createClient();
  const yearStart = `${year}-01-01`;
  const nextYearStart = `${year + 1}-01-01`;
  const [platformResult, attributionResult, bankResult] = await Promise.all([
    supabase
      .from("marketing_platform_performance")
      .select(
        "account_id,entity_level,entity_name,parent_campaign_name,parent_ad_set_name,purpose,reporting_start,reporting_end,currency,results,result_indicator,amount_spent,impressions,reach,source_filename,source_payload,captured_at",
      )
      .eq("platform", "meta")
      .like("source_filename", "insights-%")
      .gte("reporting_end", yearStart)
      .lt("reporting_start", nextYearStart)
      .order("captured_at", { ascending: false }),
    supabase
      .from("customer_invoice_marketing_attribution")
      .select(
        "customer_invoice_id,invoice_date,normalized_channel,booked_revenue_before_hst,bank_backed_revenue_before_hst",
      )
      .gte("invoice_date", yearStart)
      .lt("invoice_date", nextYearStart),
    supabase
      .from("financial_transactions")
      .select("posted_on,category,net_amount,transaction_type,is_transfer")
      .gte("posted_on", yearStart)
      .lt("posted_on", nextYearStart),
  ]);
  if (platformResult.error) throw platformResult.error;
  if (attributionResult.error) throw attributionResult.error;
  if (bankResult.error) throw bankResult.error;

  const allPlatformRows = (platformResult.data ?? []) as PlatformPerformanceRow[];
  const platformRows = latestPlatformRows(allPlatformRows);
  const platformEntities = platformRows
    .map((row) => ({
      accountId: row.account_id,
      accountName: accountName(row),
      currency: row.currency,
      level: row.entity_level,
      name: row.entity_name,
      campaignName: row.parent_campaign_name,
      adSetName: row.parent_ad_set_name,
      purpose: row.purpose,
      spend: roundMoney(Number(row.amount_spent ?? 0)),
      leads: Number(row.results ?? 0),
      impressions: Number(row.impressions ?? 0),
      reach: Number(row.reach ?? 0),
    }))
    .sort((left, right) => {
      const accountCompare = left.accountName.localeCompare(
        right.accountName,
        "en-CA",
      );
      if (accountCompare) return accountCompare;
      if (left.level !== right.level) {
        return ["campaign", "ad_set", "ad"].indexOf(left.level) -
          ["campaign", "ad_set", "ad"].indexOf(right.level);
      }
      return right.spend - left.spend;
    });

  const platformAccounts = groupBy(
    platformRows.filter((row) => row.entity_level === "campaign"),
    (row) => row.account_id,
  )
    .map(([accountId, rows]) => {
      const customerRows = rows.filter(
        (row) => row.purpose === "customer_acquisition",
      );
      const recruitingRows = rows.filter(
        (row) => row.purpose === "recruiting",
      );
      const customerSpend = roundMoney(
        customerRows.reduce(
          (total, row) => total + Number(row.amount_spent ?? 0),
          0,
        ),
      );
      const recruitingSpend = roundMoney(
        recruitingRows.reduce(
          (total, row) => total + Number(row.amount_spent ?? 0),
          0,
        ),
      );
      return {
        accountId,
        name: accountName(rows[0]),
        currency: rows[0].currency,
        reportingStart: rows.reduce(
          (earliest, row) =>
            row.reporting_start < earliest ? row.reporting_start : earliest,
          rows[0].reporting_start,
        ),
        reportingEnd: rows.reduce(
          (latest, row) =>
            row.reporting_end > latest ? row.reporting_end : latest,
          rows[0].reporting_end,
        ),
        customerSpend,
        recruitingSpend,
        totalSpend: roundMoney(customerSpend + recruitingSpend),
        customerLeads: customerRows.reduce(
          (total, row) => total + Number(row.results ?? 0),
          0,
        ),
        recruitingLeads: recruitingRows.reduce(
          (total, row) => total + Number(row.results ?? 0),
          0,
        ),
      } satisfies MarketingPlatformAccount;
    })
    .sort((left, right) => left.currency.localeCompare(right.currency));

  const bankRows = (bankResult.data ?? []) as BankRow[];
  const marketingRows = bankRows.filter(
    (row) =>
      row.category === "Advertising & marketing" &&
      row.transaction_type !== "income" &&
      !row.is_transfer,
  );
  const spend = roundMoney(
    -marketingRows.reduce(
      (total, row) => total + Number(row.net_amount ?? 0),
      0,
    ),
  );
  const revenueBeforeHst = roundMoney(
    bankRows
      .filter(
        (row) => row.transaction_type === "income" && !row.is_transfer,
      )
      .reduce((total, row) => total + Number(row.net_amount ?? 0), 0),
  );
  const monthlySpend = groupBy(marketingRows, (row) => row.posted_on.slice(0, 7))
    .map(([month, rows]) => ({
      month,
      spend: roundMoney(
        -rows.reduce((total, row) => total + Number(row.net_amount ?? 0), 0),
      ),
      transactions: rows.length,
    }))
    .sort((left, right) => left.month.localeCompare(right.month));
  const paidSocialRows = ((attributionResult.data ?? []) as AttributionRow[]).filter(
    (row) => row.normalized_channel === "paid_social",
  );
  const capturedAt = platformRows
    .map((row) => row.captured_at)
    .sort()
    .at(-1) ?? null;

  return {
    accounting: {
      spend,
      transactionCount: marketingRows.length,
      revenueBeforeHst,
      marketingShareOfRevenue:
        revenueBeforeHst > 0 ? spend / revenueBeforeHst : null,
      monthlySpend,
    },
    paidSocial: cohort(paidSocialRows, spend),
    platformAccounts,
    platformEntities,
    capturedAt,
  };
}
