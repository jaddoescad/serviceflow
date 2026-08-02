import { createClient } from "@/lib/supabase/server";

type Currency = "CAD" | "USD";
type MarketingPurpose = "customer_acquisition" | "recruiting" | "other";
type MarketingChannel =
  | "paid_social"
  | "organic_social"
  | "website"
  | "phone"
  | "mail"
  | "referral"
  | "organic_search"
  | "other"
  | "unknown";

type CrmRow = {
  record_type: "sales_deal" | "job";
  canonical_in_snapshot: boolean;
  snapshot_on: string;
  status: string;
  normalized_channel: MarketingChannel;
  deal_stage: string | null;
  deal_amount: number | string;
  raw_deal_age: string | null;
  estimated_lead_created_on: string | null;
  lead_date_method:
    | "attribution_exact"
    | "deal_age_day"
    | "deal_age_month"
    | "sales_cycle_model"
    | "unknown";
  source_payload: Record<string, unknown> | null;
  captured_at: string;
};

type PlatformMonthlyRow = {
  account_id: string;
  account_name: string;
  currency: Currency;
  month_start: string;
  purpose: MarketingPurpose;
  campaign_id: string;
  campaign_name: string;
  spend: number | string;
  leads: number | string;
  impressions: number | string;
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

export type MarketingMonthlyMetric = {
  month: string;
  bankSpendCad: number;
  bankTransactions: number;
  crmRecords: number;
  crmPaidSocialRecords: number;
  wonJobs: number;
  exactLeadDates: number;
  estimatedLeadDates: number;
  metaCustomerLeads: number;
  metaRecruitingLeads: number;
  metaCustomerSpendCad: number;
  metaCustomerSpendUsd: number;
  metaRecruitingSpendCad: number;
  metaRecruitingSpendUsd: number;
};

export type MarketingPlatformAccount = {
  accountId: string;
  name: string;
  currency: Currency;
  customerSpend: number;
  customerLeads: number;
  customerCpl: number | null;
  recruitingSpend: number;
  recruitingLeads: number;
  impressions: number;
  activeMonths: number;
};

export type MarketingCampaign = {
  accountId: string;
  accountName: string;
  currency: Currency;
  campaignId: string;
  name: string;
  purpose: MarketingPurpose;
  spend: number;
  leads: number;
  cpl: number | null;
  impressions: number;
};

export type MarketingSourcePerformance = {
  channel: MarketingChannel;
  label: string;
  records: number;
  active: number;
  won: number;
  lost: number;
  closed: number;
  closedWinRate: number | null;
  wonJobValue: number;
};

export type MarketingMetrics = {
  year: number;
  accounting: {
    spend: number;
    transactionCount: number;
    paintingRevenueCash: number;
    marketingShareOfPaintingRevenueCash: number | null;
  };
  funnel: {
    opportunities: number;
    active: number;
    won: number;
    lost: number;
    closed: number;
    closedWinRate: number | null;
    activePipelineValue: number;
    wonJobValue: number;
  };
  paidSocial: {
    platformCustomerLeads: number;
    crmRecords: number;
    crmWonJobs: number;
    crmActive: number;
    crmLost: number;
    captureRate: number | null;
    captureGap: number;
    blendedBankCpl: number | null;
    crmRecordedCost: number | null;
  };
  paidSocialRevenue: MarketingMetricCohort;
  monthly: MarketingMonthlyMetric[];
  platformAccounts: MarketingPlatformAccount[];
  campaigns: MarketingCampaign[];
  sourcePerformance: MarketingSourcePerformance[];
  pipeline: {
    stages: Array<{ label: string; deals: number; value: number }>;
    ageBuckets: Array<{ label: string; deals: number; value: number }>;
  };
  salesCycle: {
    sampleSize: number;
    medianDays: number | null;
    meanDays: number | null;
    p25Days: number | null;
    p75Days: number | null;
  };
  dataQuality: {
    rawRows: number;
    canonicalRecords: number;
    duplicateRows: number;
    selectedYearRecords: number;
    knownSourceRecords: number;
    knownSourceCoverage: number | null;
    exactLeadDates: number;
    dayPrecisionEstimates: number;
    monthPrecisionEstimates: number;
    modeledLeadDates: number;
    unknownLeadDates: number;
    caveats: string[];
  };
  capturedAt: string | null;
};

const ACTIVE_SALES_STATUSES = new Set(["Open", "Pending", "Scheduled"]);

const CHANNEL_LABELS: Record<MarketingChannel, string> = {
  paid_social: "Meta ads",
  organic_social: "Organic social",
  website: "Website",
  phone: "Phone",
  mail: "Mail",
  referral: "Word of mouth",
  organic_search: "Google organic",
  other: "Other",
  unknown: "Unknown",
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundMetric(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? roundMetric(numerator / denominator) : null;
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  return [...groups.entries()];
}

function isActive(row: CrmRow) {
  return row.record_type === "sales_deal" && ACTIVE_SALES_STATUSES.has(row.status);
}

function isWon(row: CrmRow) {
  return row.record_type === "job" && row.status.toUpperCase() !== "CANCELLED";
}

function isLost(row: CrmRow) {
  return (
    (row.record_type === "sales_deal" && !ACTIVE_SALES_STATUSES.has(row.status)) ||
    (row.record_type === "job" && row.status.toUpperCase() === "CANCELLED")
  );
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
    customerAcquisitionCost: rows.length > 0 ? ratio(spend, rows.length) : null,
    bookedRoas: ratio(bookedRevenueBeforeHst, spend),
    cashRoas: ratio(bankBackedRevenueBeforeHst, spend),
  };
}

function percentile(values: number[], position: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * position;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const value =
    lower === upper
      ? sorted[lower]
      : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  return roundMetric(value, 1);
}

function parseSourceDate(value: unknown) {
  const match = String(value ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function daysBetween(start: string, end: string) {
  return (
    (new Date(`${end}T12:00:00Z`).getTime() -
      new Date(`${start}T12:00:00Z`).getTime()) /
    86400000
  );
}

function approximateAgeDays(value: string | null) {
  const match = String(value ?? "").match(/^(\d+)(h|d|mo)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (match[2] === "h") return 0;
  if (match[2] === "mo") return amount * 30;
  return amount;
}

function latestCapturedAt(rows: Array<{ captured_at: string }>) {
  return rows.map((row) => row.captured_at).sort().at(-1) ?? null;
}

export async function getMarketingYears() {
  const supabase = await createClient();
  const [bankResult, crmResult, platformResult] = await Promise.all([
    supabase
      .from("financial_transactions")
      .select("posted_on")
      .eq("category", "Advertising & marketing")
      .order("posted_on", { ascending: false }),
    supabase
      .from("marketing_crm_records")
      .select("estimated_lead_created_on")
      .eq("canonical_in_snapshot", true),
    supabase
      .from("marketing_platform_monthly_performance")
      .select("month_start")
      .eq("platform", "meta"),
  ]);
  if (bankResult.error) throw bankResult.error;
  if (crmResult.error) throw crmResult.error;
  if (platformResult.error) throw platformResult.error;
  const years = new Set<number>();
  for (const row of bankResult.data ?? []) years.add(Number(row.posted_on.slice(0, 4)));
  for (const row of crmResult.data ?? []) {
    if (row.estimated_lead_created_on) {
      years.add(Number(row.estimated_lead_created_on.slice(0, 4)));
    }
  }
  for (const row of platformResult.data ?? []) years.add(Number(row.month_start.slice(0, 4)));
  return [...years].filter(Number.isFinite).sort((left, right) => right - left);
}

export async function getMarketingMetrics(year: number): Promise<MarketingMetrics> {
  const supabase = await createClient();
  const yearStart = `${year}-01-01`;
  const nextYearStart = `${year + 1}-01-01`;
  const [crmResult, platformResult, attributionResult, bankResult] = await Promise.all([
    supabase
      .from("marketing_crm_records")
      .select(
        "record_type,canonical_in_snapshot,snapshot_on,status,normalized_channel,deal_stage,deal_amount,raw_deal_age,estimated_lead_created_on,lead_date_method,source_payload,captured_at",
      ),
    supabase
      .from("marketing_platform_monthly_performance")
      .select(
        "account_id,account_name,currency,month_start,purpose,campaign_id,campaign_name,spend,leads,impressions,captured_at",
      )
      .eq("platform", "meta")
      .gte("month_start", yearStart)
      .lt("month_start", nextYearStart),
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
  if (crmResult.error) throw crmResult.error;
  if (platformResult.error) throw platformResult.error;
  if (attributionResult.error) throw attributionResult.error;
  if (bankResult.error) throw bankResult.error;

  const rawCrmRows = (crmResult.data ?? []) as CrmRow[];
  const canonicalRows = rawCrmRows.filter((row) => row.canonical_in_snapshot);
  const yearRows = canonicalRows.filter(
    (row) =>
      row.estimated_lead_created_on != null &&
      row.estimated_lead_created_on >= yearStart &&
      row.estimated_lead_created_on < nextYearStart,
  );
  const platformRows = (platformResult.data ?? []) as PlatformMonthlyRow[];
  const bankRows = (bankResult.data ?? []) as BankRow[];
  const marketingBankRows = bankRows.filter(
    (row) =>
      row.category === "Advertising & marketing" &&
      row.transaction_type !== "income" &&
      !row.is_transfer,
  );
  const spend = roundMoney(
    -marketingBankRows.reduce(
      (total, row) => total + Number(row.net_amount ?? 0),
      0,
    ),
  );
  const paintingRevenueCash = roundMoney(
    bankRows
      .filter(
        (row) =>
          row.transaction_type === "income" &&
          !row.is_transfer &&
          row.category === "Painting revenue",
      )
      .reduce((total, row) => total + Number(row.net_amount ?? 0), 0),
  );

  const activeRows = yearRows.filter(isActive);
  const wonRows = yearRows.filter(isWon);
  const lostRows = yearRows.filter(isLost);
  const closed = wonRows.length + lostRows.length;
  const paidSocialRows = yearRows.filter(
    (row) => row.normalized_channel === "paid_social",
  );
  const platformCustomerRows = platformRows.filter(
    (row) => row.purpose === "customer_acquisition",
  );
  const platformCustomerLeads = platformCustomerRows.reduce(
    (total, row) => total + Number(row.leads ?? 0),
    0,
  );

  const months: MarketingMonthlyMetric[] = Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    const crm = yearRows.filter(
      (row) => row.estimated_lead_created_on?.slice(0, 7) === month,
    );
    const meta = platformRows.filter((row) => row.month_start.slice(0, 7) === month);
    const bank = marketingBankRows.filter((row) => row.posted_on.slice(0, 7) === month);
    const metaSpend = (currency: Currency, purpose: MarketingPurpose) =>
      roundMoney(
        meta
          .filter((row) => row.currency === currency && row.purpose === purpose)
          .reduce((total, row) => total + Number(row.spend ?? 0), 0),
      );
    return {
      month,
      bankSpendCad: roundMoney(
        -bank.reduce((total, row) => total + Number(row.net_amount ?? 0), 0),
      ),
      bankTransactions: bank.length,
      crmRecords: crm.length,
      crmPaidSocialRecords: crm.filter(
        (row) => row.normalized_channel === "paid_social",
      ).length,
      wonJobs: crm.filter(isWon).length,
      exactLeadDates: crm.filter(
        (row) => row.lead_date_method === "attribution_exact",
      ).length,
      estimatedLeadDates: crm.filter(
        (row) => row.lead_date_method !== "attribution_exact",
      ).length,
      metaCustomerLeads: meta
        .filter((row) => row.purpose === "customer_acquisition")
        .reduce((total, row) => total + Number(row.leads ?? 0), 0),
      metaRecruitingLeads: meta
        .filter((row) => row.purpose === "recruiting")
        .reduce((total, row) => total + Number(row.leads ?? 0), 0),
      metaCustomerSpendCad: metaSpend("CAD", "customer_acquisition"),
      metaCustomerSpendUsd: metaSpend("USD", "customer_acquisition"),
      metaRecruitingSpendCad: metaSpend("CAD", "recruiting"),
      metaRecruitingSpendUsd: metaSpend("USD", "recruiting"),
    };
  });

  const platformAccounts = groupBy(platformRows, (row) => row.account_id)
    .map(([accountId, rows]) => {
      const customerRows = rows.filter(
        (row) => row.purpose === "customer_acquisition",
      );
      const recruitingRows = rows.filter((row) => row.purpose === "recruiting");
      const customerSpend = roundMoney(
        customerRows.reduce((total, row) => total + Number(row.spend ?? 0), 0),
      );
      const customerLeads = customerRows.reduce(
        (total, row) => total + Number(row.leads ?? 0),
        0,
      );
      return {
        accountId,
        name: rows[0].account_name,
        currency: rows[0].currency,
        customerSpend,
        customerLeads,
        customerCpl: ratio(customerSpend, customerLeads),
        recruitingSpend: roundMoney(
          recruitingRows.reduce(
            (total, row) => total + Number(row.spend ?? 0),
            0,
          ),
        ),
        recruitingLeads: recruitingRows.reduce(
          (total, row) => total + Number(row.leads ?? 0),
          0,
        ),
        impressions: rows.reduce(
          (total, row) => total + Number(row.impressions ?? 0),
          0,
        ),
        activeMonths: new Set(rows.map((row) => row.month_start.slice(0, 7))).size,
      } satisfies MarketingPlatformAccount;
    })
    .sort((left, right) => left.currency.localeCompare(right.currency));

  const campaigns = groupBy(
    platformRows,
    (row) => `${row.account_id}:${row.campaign_id}:${row.purpose}`,
  )
    .map(([, rows]) => {
      const campaignSpend = roundMoney(
        rows.reduce((total, row) => total + Number(row.spend ?? 0), 0),
      );
      const leads = rows.reduce(
        (total, row) => total + Number(row.leads ?? 0),
        0,
      );
      return {
        accountId: rows[0].account_id,
        accountName: rows[0].account_name,
        currency: rows[0].currency,
        campaignId: rows[0].campaign_id,
        name: rows[0].campaign_name,
        purpose: rows[0].purpose,
        spend: campaignSpend,
        leads,
        cpl: ratio(campaignSpend, leads),
        impressions: rows.reduce(
          (total, row) => total + Number(row.impressions ?? 0),
          0,
        ),
      } satisfies MarketingCampaign;
    })
    .sort((left, right) => right.spend - left.spend);

  const sourcePerformance = groupBy(yearRows, (row) => row.normalized_channel)
    .map(([channel, rows]) => {
      const won = rows.filter(isWon);
      const lost = rows.filter(isLost);
      const sourceClosed = won.length + lost.length;
      return {
        channel: channel as MarketingChannel,
        label: CHANNEL_LABELS[channel as MarketingChannel],
        records: rows.length,
        active: rows.filter(isActive).length,
        won: won.length,
        lost: lost.length,
        closed: sourceClosed,
        closedWinRate: ratio(won.length, sourceClosed),
        wonJobValue: roundMoney(
          won.reduce((total, row) => total + Number(row.deal_amount ?? 0), 0),
        ),
      } satisfies MarketingSourcePerformance;
    })
    .sort((left, right) => right.records - left.records);

  const stageRows = groupBy(activeRows, (row) => row.deal_stage || "Stage unknown")
    .map(([label, rows]) => ({
      label,
      deals: rows.length,
      value: roundMoney(
        rows.reduce((total, row) => total + Number(row.deal_amount ?? 0), 0),
      ),
    }))
    .sort((left, right) => right.deals - left.deals);
  const ageDefinitions = [
    { label: "0–7 days", minimum: 0, maximum: 7 },
    { label: "8–14 days", minimum: 8, maximum: 14 },
    { label: "15–30 days", minimum: 15, maximum: 30 },
    { label: "31–60 days", minimum: 31, maximum: 60 },
    { label: "60+ days", minimum: 61, maximum: Number.POSITIVE_INFINITY },
  ];
  const ageBuckets = ageDefinitions.map(({ label, minimum, maximum }) => {
    const rows = activeRows.filter((row) => {
      const age = approximateAgeDays(row.raw_deal_age);
      return age != null && age >= minimum && age <= maximum;
    });
    return {
      label,
      deals: rows.length,
      value: roundMoney(
        rows.reduce((total, row) => total + Number(row.deal_amount ?? 0), 0),
      ),
    };
  });

  const exactCycles = yearRows
    .filter(
      (row) =>
        row.record_type === "job" &&
        row.lead_date_method === "attribution_exact" &&
        row.estimated_lead_created_on,
    )
    .map((row) => {
      const signed = parseSourceDate(row.source_payload?.["Proposal Signed Date"]);
      if (!signed || !row.estimated_lead_created_on) return null;
      const days = daysBetween(row.estimated_lead_created_on, signed);
      return days >= 0 && days <= 365 ? days : null;
    })
    .filter((value): value is number => value != null);

  const knownSourceRecords = yearRows.filter(
    (row) => row.normalized_channel !== "unknown",
  ).length;
  const paidSocialInvoiceRows = (
    (attributionResult.data ?? []) as AttributionRow[]
  ).filter((row) => row.normalized_channel === "paid_social");
  const capturedAt = [latestCapturedAt(rawCrmRows), latestCapturedAt(platformRows)]
    .filter((value): value is string => value != null)
    .sort()
    .at(-1) ?? null;

  return {
    year,
    accounting: {
      spend,
      transactionCount: marketingBankRows.length,
      paintingRevenueCash,
      marketingShareOfPaintingRevenueCash: ratio(spend, paintingRevenueCash),
    },
    funnel: {
      opportunities: yearRows.length,
      active: activeRows.length,
      won: wonRows.length,
      lost: lostRows.length,
      closed,
      closedWinRate: ratio(wonRows.length, closed),
      activePipelineValue: roundMoney(
        activeRows.reduce((total, row) => total + Number(row.deal_amount ?? 0), 0),
      ),
      wonJobValue: roundMoney(
        wonRows.reduce((total, row) => total + Number(row.deal_amount ?? 0), 0),
      ),
    },
    paidSocial: {
      platformCustomerLeads,
      crmRecords: paidSocialRows.length,
      crmWonJobs: paidSocialRows.filter(isWon).length,
      crmActive: paidSocialRows.filter(isActive).length,
      crmLost: paidSocialRows.filter(isLost).length,
      captureRate: ratio(paidSocialRows.length, platformCustomerLeads),
      captureGap: Math.max(0, platformCustomerLeads - paidSocialRows.length),
      blendedBankCpl: ratio(spend, platformCustomerLeads),
      crmRecordedCost: ratio(spend, paidSocialRows.length),
    },
    paidSocialRevenue: cohort(paidSocialInvoiceRows, spend),
    monthly: months,
    platformAccounts,
    campaigns,
    sourcePerformance,
    pipeline: { stages: stageRows, ageBuckets },
    salesCycle: {
      sampleSize: exactCycles.length,
      medianDays: percentile(exactCycles, 0.5),
      meanDays: exactCycles.length
        ? roundMetric(
            exactCycles.reduce((total, value) => total + value, 0) /
              exactCycles.length,
            1,
          )
        : null,
      p25Days: percentile(exactCycles, 0.25),
      p75Days: percentile(exactCycles, 0.75),
    },
    dataQuality: {
      rawRows: rawCrmRows.length,
      canonicalRecords: canonicalRows.length,
      duplicateRows: rawCrmRows.length - canonicalRows.length,
      selectedYearRecords: yearRows.length,
      knownSourceRecords,
      knownSourceCoverage: ratio(knownSourceRecords, yearRows.length),
      exactLeadDates: yearRows.filter(
        (row) => row.lead_date_method === "attribution_exact",
      ).length,
      dayPrecisionEstimates: yearRows.filter(
        (row) => row.lead_date_method === "deal_age_day",
      ).length,
      monthPrecisionEstimates: yearRows.filter(
        (row) => row.lead_date_method === "deal_age_month",
      ).length,
      modeledLeadDates: yearRows.filter(
        (row) => row.lead_date_method === "sales_cycle_model",
      ).length,
      unknownLeadDates: yearRows.filter(
        (row) => row.lead_date_method === "unknown",
      ).length,
      caveats: [
        "Meta customer leads are platform lead events; CRM records are deduplicated DripJobs opportunities, so the gap is a reconciliation signal rather than a one-to-one error count.",
        "Sales-list Deal Age values are exact only to the exported hour or day; one- and two-month values are placed at a coarse calendar-month estimate.",
        "Older won jobs without a captured lead date use the observed 24-day median lead-to-signed cycle, so historical monthly CRM totals are modeled rather than complete lead counts.",
        "Bank spend is authoritative CAD cash cost. Meta account spend remains in native CAD or USD and is never added together without conversion evidence.",
      ],
    },
    capturedAt,
  };
}
