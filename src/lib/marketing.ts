import { createClient } from "@/lib/supabase/server";

type CampaignPerformanceRow = {
  purpose: "customer_acquisition" | "recruiting" | "other";
  reporting_start: string;
  reporting_end: string;
  results: number | string | null;
  amount_spent: number | string;
  captured_at: string;
};

type AttributionRow = {
  customer_invoice_id: string;
  normalized_channel: string;
  lead_created_at: string | null;
  booked_revenue_before_hst: number | string;
  bank_backed_revenue_before_hst: number | string;
};

type MetaBankRow = {
  posted_on: string;
  description: string;
  counterparty: string | null;
  net_amount: number | string;
  transaction_type: string;
  is_transfer: boolean;
  source_data: Record<string, unknown> | null;
};

export type MarketingMetricCohort = {
  spend: number;
  leads: number | null;
  jobs: number;
  bookedRevenueBeforeHst: number;
  bankBackedRevenueBeforeHst: number;
  costPerLead: number | null;
  closeRate: number | null;
  customerAcquisitionCost: number | null;
  bookedRoas: number | null;
  cashRoas: number | null;
};

export type MarketingMetrics = {
  currentCampaign: MarketingMetricCohort & {
    startsOn: string | null;
    endsOn: string | null;
    recruitingSpend: number;
    totalPlatformSpend: number;
    bankSpendDuringCampaign: number;
    bankPlatformDifference: number;
  };
  yearToDate: MarketingMetricCohort & {
    bankMetaSpend: number;
    knownRecruitingSpend: number;
  };
  capturedAt: string | null;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 100) / 100 : null;
}

function cohort(rows: AttributionRow[], spend: number, leads: number | null) {
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
    leads,
    jobs: rows.length,
    bookedRevenueBeforeHst,
    bankBackedRevenueBeforeHst,
    costPerLead: leads && leads > 0 ? ratio(spend, leads) : null,
    closeRate: leads && leads > 0 ? rows.length / leads : null,
    customerAcquisitionCost:
      rows.length > 0 ? ratio(spend, rows.length) : null,
    bookedRoas: ratio(bookedRevenueBeforeHst, spend),
    cashRoas: ratio(bankBackedRevenueBeforeHst, spend),
  } satisfies MarketingMetricCohort;
}

function isMetaCharge(transaction: MetaBankRow) {
  const text = [
    transaction.description,
    transaction.counterparty,
    transaction.source_data?.merchant_name,
    transaction.source_data?.original_description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("en-CA");
  return /facebk|facebook|meta ads/.test(text);
}

function sumSpend(rows: CampaignPerformanceRow[]) {
  return roundMoney(
    rows.reduce((total, row) => total + Number(row.amount_spent ?? 0), 0),
  );
}

export async function getMarketingMetrics(year: number): Promise<MarketingMetrics> {
  const supabase = await createClient();
  const yearStart = `${year}-01-01`;
  const nextYearStart = `${year + 1}-01-01`;
  const [campaignResult, attributionResult, bankResult] = await Promise.all([
    supabase
      .from("marketing_platform_performance")
      .select(
        "purpose,reporting_start,reporting_end,results,amount_spent,captured_at",
      )
      .eq("platform", "meta")
      .eq("entity_level", "campaign")
      .gte("reporting_end", yearStart)
      .lt("reporting_start", nextYearStart)
      .order("captured_at", { ascending: false }),
    supabase
      .from("customer_invoice_marketing_attribution")
      .select(
        "customer_invoice_id,normalized_channel,lead_created_at,booked_revenue_before_hst,bank_backed_revenue_before_hst",
      )
      .gte("lead_created_at", yearStart)
      .lt("lead_created_at", nextYearStart),
    supabase
      .from("financial_transactions")
      .select(
        "posted_on,description,counterparty,net_amount,transaction_type,is_transfer,source_data",
      )
      .gte("posted_on", yearStart)
      .lt("posted_on", nextYearStart),
  ]);
  if (campaignResult.error) throw campaignResult.error;
  if (attributionResult.error) throw attributionResult.error;
  if (bankResult.error) throw bankResult.error;

  const allCampaigns = (campaignResult.data ?? []) as CampaignPerformanceRow[];
  const latestCapture = allCampaigns[0]?.captured_at ?? null;
  const campaigns = latestCapture
    ? allCampaigns.filter((row) => row.captured_at === latestCapture)
    : [];
  const customerCampaigns = campaigns.filter(
    (row) => row.purpose === "customer_acquisition",
  );
  const recruitingCampaigns = campaigns.filter(
    (row) => row.purpose === "recruiting",
  );
  const startsOn = customerCampaigns.length
    ? customerCampaigns.reduce(
        (earliest, row) =>
          row.reporting_start < earliest ? row.reporting_start : earliest,
        customerCampaigns[0].reporting_start,
      )
    : null;
  const endsOn = customerCampaigns.length
    ? customerCampaigns.reduce(
        (latest, row) => (row.reporting_end > latest ? row.reporting_end : latest),
        customerCampaigns[0].reporting_end,
      )
    : null;
  const customerSpend = sumSpend(customerCampaigns);
  const recruitingSpend = sumSpend(recruitingCampaigns);
  const platformLeads = customerCampaigns.reduce(
    (total, row) => total + Number(row.results ?? 0),
    0,
  );

  const attributions = (attributionResult.data ?? []) as AttributionRow[];
  const paidSocialYtd = attributions.filter(
    (row) => row.normalized_channel === "paid_social",
  );
  const paidSocialCurrent = paidSocialYtd.filter(
    (row) =>
      row.lead_created_at &&
      startsOn &&
      endsOn &&
      row.lead_created_at.slice(0, 10) >= startsOn &&
      row.lead_created_at.slice(0, 10) <= endsOn,
  );
  const metaBankRows = ((bankResult.data ?? []) as MetaBankRow[]).filter(
    (row) =>
      row.transaction_type !== "income" &&
      !row.is_transfer &&
      isMetaCharge(row),
  );
  const bankMetaSpend = roundMoney(
    -metaBankRows.reduce((total, row) => total + Number(row.net_amount ?? 0), 0),
  );
  const bankSpendDuringCampaign = roundMoney(
    -metaBankRows
      .filter(
        (row) =>
          startsOn &&
          endsOn &&
          row.posted_on >= startsOn &&
          row.posted_on <= endsOn,
      )
      .reduce((total, row) => total + Number(row.net_amount ?? 0), 0),
  );
  const totalPlatformSpend = roundMoney(customerSpend + recruitingSpend);
  const estimatedCustomerSpendYtd = Math.max(
    0,
    roundMoney(bankMetaSpend - recruitingSpend),
  );

  return {
    currentCampaign: {
      ...cohort(paidSocialCurrent, customerSpend, platformLeads || null),
      startsOn,
      endsOn,
      recruitingSpend,
      totalPlatformSpend,
      bankSpendDuringCampaign,
      bankPlatformDifference: roundMoney(
        bankSpendDuringCampaign - totalPlatformSpend,
      ),
    },
    yearToDate: {
      ...cohort(paidSocialYtd, estimatedCustomerSpendYtd, null),
      bankMetaSpend,
      knownRecruitingSpend: recruitingSpend,
    },
    capturedAt: latestCapture,
  };
}
