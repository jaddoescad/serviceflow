import type {
  MarketingChannel,
  MarketingJobFact,
  MarketingSalesDataset,
} from "@/lib/marketing-sales";

export const CHANNEL_LABELS: Record<MarketingChannel, string> = {
  paid_social: "Meta ads",
  website: "Website",
  phone: "Phone",
  referral: "Word of mouth",
  organic_search: "Google organic",
  mail: "Mail",
  organic_social: "Organic social",
  other: "Other",
  unknown: "Unknown",
};

export const MARKETING_CHANNELS = Object.keys(
  CHANNEL_LABELS,
) as MarketingChannel[];

export type MarketingChannelFilter = "all" | MarketingChannel;

export type MarketingDateRange = {
  from: string;
  to: string;
};

export type MarketingSalesFilters = MarketingDateRange & {
  channel: MarketingChannelFilter;
};

export type SalesCycleSummary = {
  sampleSize: number;
  medianDays: number | null;
  meanDays: number | null;
  p25Days: number | null;
  p75Days: number | null;
  buckets: Array<{ label: string; jobs: number }>;
};

export type MarketingChannelPerformance = {
  channel: MarketingChannel;
  label: string;
  leads: number;
  customers: number;
  jobs: number;
  bookedRevenueBeforeHst: number;
  cashRevenueBeforeHst: number;
  revenueShare: number | null;
  averageJobSize: number | null;
  medianSalesCycleDays: number | null;
  spendCad: number | null;
  cpl: number | null;
  cac: number | null;
  bookedRoas: number | null;
  cashRoas: number | null;
};

export type MarketingTrendPoint = {
  month: string;
  leads: number;
  customers: number;
  jobs: number;
  bookedRevenueBeforeHst: number;
  cashRevenueBeforeHst: number;
  spendCad: number | null;
};

export type MarketingPlatformAccountSummary = {
  accountId: string;
  accountName: string;
  currency: "CAD" | "USD";
  customerSpend: number;
  customerLeads: number;
  customerCpl: number | null;
  recruitingSpend: number;
  recruitingLeads: number;
  impressions: number;
};

export type MarketingSalesSnapshot = {
  range: MarketingDateRange;
  channel: MarketingChannelFilter;
  leads: number;
  customers: number;
  jobs: number;
  bookedRevenueBeforeHst: number;
  cashRevenueBeforeHst: number;
  averageJobSize: number | null;
  selectedSpendCad: number | null;
  selectedCpl: number | null;
  selectedCac: number | null;
  selectedCacLabel: "Blended CAC" | "Meta CAC" | "CAC unavailable";
  metaSpendCad: number;
  metaLeads: number;
  metaCustomers: number;
  metaJobs: number;
  blendedCustomers: number;
  metaBookedRevenueBeforeHst: number;
  metaCashRevenueBeforeHst: number;
  metaCpl: number | null;
  metaCac: number | null;
  blendedCac: number | null;
  metaBookedRoas: number | null;
  metaCashRoas: number | null;
  salesCycle: SalesCycleSummary;
  channels: MarketingChannelPerformance[];
  trend: MarketingTrendPoint[];
  platformAccounts: MarketingPlatformAccountSummary[];
  evidence: {
    selectedLeadIds: string[];
    selectedProposalIds: string[];
    selectedInvoiceIds: string[];
    selectedSpendTransactionIds: string[];
    jobsWithoutInvoice: number;
    jobsWithoutCashEvidence: number;
    selectedAllocationCount: number;
  };
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? round(numerator / denominator) : null;
}

function inRange(value: string, range: MarketingDateRange) {
  return value >= range.from && value <= range.to;
}

function daysBetween(start: string, end: string) {
  return (
    (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) /
    86_400_000
  );
}

function percentile(values: number[], position: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * position;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return round(
    lower === upper
      ? sorted[lower]
      : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower),
    1,
  );
}

function salesCycleForJobs(
  jobs: MarketingJobFact[],
  leadCreatedById: Map<string, string>,
): SalesCycleSummary {
  const values = jobs
    .flatMap((job) => {
      const leadCreatedOn = leadCreatedById.get(job.leadDealId);
      if (!leadCreatedOn || !job.proposalSignedOn) return [];
      const days = daysBetween(leadCreatedOn, job.proposalSignedOn);
      return days >= 0 && days <= 365 ? [days] : [];
    })
    .sort((left, right) => left - right);
  const definitions = [
    { label: "0–7 days", min: 0, max: 7 },
    { label: "8–14 days", min: 8, max: 14 },
    { label: "15–30 days", min: 15, max: 30 },
    { label: "31–60 days", min: 31, max: 60 },
    { label: "61+ days", min: 61, max: Number.POSITIVE_INFINITY },
  ];
  return {
    sampleSize: values.length,
    medianDays: percentile(values, 0.5),
    meanDays: values.length
      ? round(values.reduce((total, value) => total + value, 0) / values.length, 1)
      : null,
    p25Days: percentile(values, 0.25),
    p75Days: percentile(values, 0.75),
    buckets: definitions.map(({ label, min, max }) => ({
      label,
      jobs: values.filter((value) => value >= min && value <= max).length,
    })),
  };
}

function monthKeys(range: MarketingDateRange) {
  const [fromYear, fromMonth] = range.from.split("-").map(Number);
  const [toYear, toMonth] = range.to.split("-").map(Number);
  const cursor = new Date(Date.UTC(fromYear, fromMonth - 1, 1));
  const end = new Date(Date.UTC(toYear, toMonth - 1, 1));
  const keys: string[] = [];
  while (cursor <= end && keys.length < 120) {
    keys.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return keys;
}

function summarizePlatformAccounts(
  dataset: MarketingSalesDataset,
  range: MarketingDateRange,
) {
  const firstMonth = `${range.from.slice(0, 7)}-01`;
  const lastMonth = `${range.to.slice(0, 7)}-01`;
  const rows = dataset.platformMonthly.filter(
    (row) => row.monthStart >= firstMonth && row.monthStart <= lastMonth,
  );
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.accountId}\u0000${row.currency}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return [...grouped.values()]
    .map((accountRows) => {
      const customer = accountRows.filter(
        (row) => row.purpose === "customer_acquisition",
      );
      const recruiting = accountRows.filter(
        (row) => row.purpose === "recruiting",
      );
      const customerSpend = round(
        customer.reduce((total, row) => total + row.spend, 0),
      );
      const customerLeads = customer.reduce(
        (total, row) => total + row.leads,
        0,
      );
      return {
        accountId: accountRows[0].accountId,
        accountName: accountRows[0].accountName,
        currency: accountRows[0].currency,
        customerSpend,
        customerLeads,
        customerCpl: ratio(customerSpend, customerLeads),
        recruitingSpend: round(
          recruiting.reduce((total, row) => total + row.spend, 0),
        ),
        recruitingLeads: recruiting.reduce(
          (total, row) => total + row.leads,
          0,
        ),
        impressions: accountRows.reduce(
          (total, row) => total + row.impressions,
          0,
        ),
      } satisfies MarketingPlatformAccountSummary;
    })
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

export function getMarketingDatasetBounds(dataset: MarketingSalesDataset) {
  const dates = [
    ...dataset.leads.map((lead) => lead.createdOn),
    ...dataset.spend.map((spend) => spend.postedOn),
  ].sort();
  const minimum = dates[0] ?? new Date().toISOString().slice(0, 10);
  const maximum = dates.at(-1) ?? minimum;
  return { minimum, maximum };
}

export function getDefaultMarketingRange(
  dataset: MarketingSalesDataset,
): MarketingDateRange {
  const { maximum } = getMarketingDatasetBounds(dataset);
  return { from: `${maximum.slice(0, 4)}-01-01`, to: maximum };
}

export function getPreviousPeriod(range: MarketingDateRange): MarketingDateRange {
  const from = new Date(`${range.from}T12:00:00Z`);
  const to = new Date(`${range.to}T12:00:00Z`);
  const duration = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
  const previousTo = new Date(from);
  previousTo.setUTCDate(previousTo.getUTCDate() - 1);
  const previousFrom = new Date(previousTo);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - duration);
  return {
    from: previousFrom.toISOString().slice(0, 10),
    to: previousTo.toISOString().slice(0, 10),
  };
}

export function buildMarketingSalesSnapshot(
  dataset: MarketingSalesDataset,
  filters: MarketingSalesFilters,
): MarketingSalesSnapshot {
  const dateLeads = dataset.leads.filter((lead) =>
    inRange(lead.createdOn, filters),
  );
  const selectedLeads = dateLeads.filter(
    (lead) => filters.channel === "all" || lead.channel === filters.channel,
  );
  const selectedLeadIds = new Set(selectedLeads.map((lead) => lead.dealId));
  const dateLeadIds = new Set(dateLeads.map((lead) => lead.dealId));
  const selectedJobs = dataset.jobs.filter((job) =>
    selectedLeadIds.has(job.leadDealId),
  );
  const dateJobs = dataset.jobs.filter((job) => dateLeadIds.has(job.leadDealId));
  const selectedCustomerIds = new Set(
    selectedJobs.map((job) => job.leadDealId),
  );
  const dateCustomerIds = new Set(dateJobs.map((job) => job.leadDealId));
  const leadById = new Map(dataset.leads.map((lead) => [lead.dealId, lead]));
  const leadCreatedById = new Map(
    dataset.leads.map((lead) => [lead.dealId, lead.createdOn]),
  );
  const spendRows = dataset.spend.filter((row) => inRange(row.postedOn, filters));
  const metaSpendCad = round(
    spendRows.reduce((total, row) => total + row.amountCad, 0),
  );
  const bookedRevenueBeforeHst = round(
    selectedJobs.reduce(
      (total, job) => total + job.bookedRevenueBeforeHst,
      0,
    ),
  );
  const cashRevenueBeforeHst = round(
    selectedJobs.reduce(
      (total, job) => total + job.cashRevenueBeforeHst,
      0,
    ),
  );

  const metaLeads = dateLeads.filter((lead) => lead.channel === "paid_social");
  const metaLeadIds = new Set(metaLeads.map((lead) => lead.dealId));
  const metaJobs = dateJobs.filter((job) => metaLeadIds.has(job.leadDealId));
  const metaCustomerIds = new Set(metaJobs.map((job) => job.leadDealId));
  const metaBookedRevenueBeforeHst = round(
    metaJobs.reduce((total, job) => total + job.bookedRevenueBeforeHst, 0),
  );
  const metaCashRevenueBeforeHst = round(
    metaJobs.reduce((total, job) => total + job.cashRevenueBeforeHst, 0),
  );

  const allChannelRevenue = new Map<MarketingChannel, number>();
  for (const job of dateJobs) {
    const channel = leadById.get(job.leadDealId)?.channel ?? "unknown";
    allChannelRevenue.set(
      channel,
      (allChannelRevenue.get(channel) ?? 0) + job.bookedRevenueBeforeHst,
    );
  }
  const totalDateRevenue = [...allChannelRevenue.values()].reduce(
    (total, value) => total + value,
    0,
  );
  const channels = MARKETING_CHANNELS.flatMap((channel) => {
    if (filters.channel !== "all" && filters.channel !== channel) return [];
    const leads = dateLeads.filter((lead) => lead.channel === channel);
    const leadIds = new Set(leads.map((lead) => lead.dealId));
    const jobs = dateJobs.filter((job) => leadIds.has(job.leadDealId));
    const customers = new Set(jobs.map((job) => job.leadDealId));
    const booked = round(
      jobs.reduce((total, job) => total + job.bookedRevenueBeforeHst, 0),
    );
    const cash = round(
      jobs.reduce((total, job) => total + job.cashRevenueBeforeHst, 0),
    );
    const paid = channel === "paid_social";
    return [{
      channel,
      label: CHANNEL_LABELS[channel],
      leads: leads.length,
      customers: customers.size,
      jobs: jobs.length,
      bookedRevenueBeforeHst: booked,
      cashRevenueBeforeHst: cash,
      revenueShare: ratio(booked, totalDateRevenue),
      averageJobSize: ratio(booked, jobs.length),
      medianSalesCycleDays: salesCycleForJobs(jobs, leadCreatedById).medianDays,
      spendCad: paid ? metaSpendCad : null,
      cpl: paid ? ratio(metaSpendCad, leads.length) : null,
      cac: paid ? ratio(metaSpendCad, customers.size) : null,
      bookedRoas: paid ? ratio(booked, metaSpendCad) : null,
      cashRoas: paid ? ratio(cash, metaSpendCad) : null,
    } satisfies MarketingChannelPerformance];
  }).sort((left, right) =>
    right.bookedRevenueBeforeHst - left.bookedRevenueBeforeHst,
  );

  const trend = monthKeys(filters).map((month) => {
    const leads = selectedLeads.filter(
      (lead) => lead.createdOn.slice(0, 7) === month,
    );
    const leadIds = new Set(leads.map((lead) => lead.dealId));
    const jobs = selectedJobs.filter((job) => leadIds.has(job.leadDealId));
    const customers = new Set(jobs.map((job) => job.leadDealId));
    const includeSpend =
      filters.channel === "all" || filters.channel === "paid_social";
    return {
      month,
      leads: leads.length,
      customers: customers.size,
      jobs: jobs.length,
      bookedRevenueBeforeHst: round(
        jobs.reduce((total, job) => total + job.bookedRevenueBeforeHst, 0),
      ),
      cashRevenueBeforeHst: round(
        jobs.reduce((total, job) => total + job.cashRevenueBeforeHst, 0),
      ),
      spendCad: includeSpend
        ? round(
            spendRows
              .filter((row) => row.postedOn.slice(0, 7) === month)
              .reduce((total, row) => total + row.amountCad, 0),
          )
        : null,
    } satisfies MarketingTrendPoint;
  });

  const selectedSpendCad =
    filters.channel === "all" || filters.channel === "paid_social"
      ? metaSpendCad
      : null;
  const selectedCac =
    filters.channel === "all"
      ? ratio(metaSpendCad, selectedCustomerIds.size)
      : filters.channel === "paid_social"
        ? ratio(metaSpendCad, selectedCustomerIds.size)
        : null;
  const selectedCacLabel =
    filters.channel === "all"
      ? "Blended CAC"
      : filters.channel === "paid_social"
        ? "Meta CAC"
        : "CAC unavailable";

  return {
    range: { from: filters.from, to: filters.to },
    channel: filters.channel,
    leads: selectedLeads.length,
    customers: selectedCustomerIds.size,
    jobs: selectedJobs.length,
    bookedRevenueBeforeHst,
    cashRevenueBeforeHst,
    averageJobSize: ratio(bookedRevenueBeforeHst, selectedJobs.length),
    selectedSpendCad,
    selectedCpl:
      selectedSpendCad == null
        ? null
        : ratio(selectedSpendCad, selectedLeads.length),
    selectedCac,
    selectedCacLabel,
    metaSpendCad,
    metaLeads: metaLeads.length,
    metaCustomers: metaCustomerIds.size,
    metaJobs: metaJobs.length,
    blendedCustomers: dateCustomerIds.size,
    metaBookedRevenueBeforeHst,
    metaCashRevenueBeforeHst,
    metaCpl: ratio(metaSpendCad, metaLeads.length),
    metaCac: ratio(metaSpendCad, metaCustomerIds.size),
    blendedCac: ratio(metaSpendCad, dateCustomerIds.size),
    metaBookedRoas: ratio(metaBookedRevenueBeforeHst, metaSpendCad),
    metaCashRoas: ratio(metaCashRevenueBeforeHst, metaSpendCad),
    salesCycle: salesCycleForJobs(selectedJobs, leadCreatedById),
    channels,
    trend,
    platformAccounts: summarizePlatformAccounts(dataset, filters),
    evidence: {
      selectedLeadIds: selectedLeads.map((lead) => lead.dealId),
      selectedProposalIds: selectedJobs.map((job) => job.proposalId),
      selectedInvoiceIds: [...new Set(selectedJobs.flatMap((job) => job.invoiceIds))],
      selectedSpendTransactionIds: spendRows.map((row) => row.transactionId),
      jobsWithoutInvoice: selectedJobs.filter((job) => job.invoiceIds.length === 0)
        .length,
      jobsWithoutCashEvidence: selectedJobs.filter(
        (job) => job.cashAllocationCount === 0,
      ).length,
      selectedAllocationCount: selectedJobs.reduce(
        (total, job) => total + job.cashAllocationCount,
        0,
      ),
    },
  };
}
