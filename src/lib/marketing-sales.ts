import { createClient } from "@/lib/supabase/server";

export type MarketingChannel =
  | "paid_social"
  | "organic_social"
  | "website"
  | "phone"
  | "mail"
  | "referral"
  | "organic_search"
  | "other"
  | "unknown";

export type MarketingLeadFact = {
  dealId: string;
  createdOn: string;
  channel: MarketingChannel;
  rawSource: string | null;
  proposalRecorded: boolean;
};

export type MarketingJobFact = {
  proposalId: string;
  leadDealId: string;
  jobName: string;
  status: string;
  proposalSignedOn: string | null;
  jobStartOn: string | null;
  jobCompletionOn: string | null;
  invoiceIds: string[];
  cashAllocationCount: number;
  bookedRevenueBeforeHst: number;
  bookedHst: number;
  bookedRevenueAfterHst: number;
  cashRevenueBeforeHst: number;
  bankCashReceived: number;
  amountReceivable: number;
};

export type MarketingSpendFact = {
  transactionId: string;
  postedOn: string;
  amountCad: number;
  counterparty: string;
};

export type MarketingPlatformMonth = {
  monthStart: string;
  accountId: string;
  accountName: string;
  currency: "CAD" | "USD";
  purpose: "customer_acquisition" | "recruiting" | "other";
  spend: number;
  leads: number;
  impressions: number;
};

export type MarketingSalesQuality = {
  totalLeads: number;
  totalJobs: number;
  confirmedJobLinks: number;
  missingLeadSourceJobs: number;
  linkedJobsWithInvoice: number;
  linkedJobsWithoutInvoice: number;
  linkedJobsWithoutCashEvidence: number;
  activeCustomerInvoiceAllocations: number;
  proposalsRecorded: number;
  leadCapturedAt: string | null;
  jobCapturedAt: string | null;
  platformCapturedAt: string | null;
  spendLastPostedOn: string | null;
};

export type MarketingSalesDataset = {
  leads: MarketingLeadFact[];
  jobs: MarketingJobFact[];
  spend: MarketingSpendFact[];
  platformMonthly: MarketingPlatformMonth[];
  quality: MarketingSalesQuality;
};

type LeadRow = {
  deal_id: string;
  created_on: string;
  normalized_channel: MarketingChannel;
  raw_lead_source: string | null;
  proposal_number: string | null;
  proposal_amount: number | null;
  proposal_on: string | null;
  captured_at: string;
};

type AccountingJobRow = {
  job_proposal_id: string;
  lead_deal_id: string | null;
  job_name: string;
  job_status: string;
  proposal_signed_on: string | null;
  job_start_on: string | null;
  job_completion_on: string | null;
  customer_invoice_count: number;
  booked_revenue_before_hst: number;
  customer_hst_billed: number;
  customer_invoice_total: number;
  bank_backed_revenue_before_hst: number;
  customer_bank_cash_received: number;
  customer_amount_receivable: number;
  customer_bank_payment_count: number;
};

type JobCaptureRow = {
  proposal_id: string;
  captured_at: string;
};

type CustomerReconciliationRow = {
  customer_invoice_id: string;
  job_proposal_id: string | null;
};

type SpendRow = {
  id: string;
  posted_on: string;
  counterparty: string | null;
  description: string;
  category: string;
  net_amount: number;
  transaction_type: string;
  is_transfer: boolean;
};

type PlatformRow = {
  month_start: string;
  account_id: string;
  account_name: string;
  currency: "CAD" | "USD";
  purpose: "customer_acquisition" | "recruiting" | "other";
  spend: number;
  leads: number;
  impressions: number;
  captured_at: string;
};

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function latest(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

async function fetchAllRows<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  columns: string,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function fetchRpcRows<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  functionName: string,
  args?: Record<string, unknown>,
): Promise<T[]> {
  const { data, error } = await supabase.rpc(functionName, args);
  if (error) throw new Error(`${functionName}: ${error.message}`);
  return (data ?? []) as T[];
}

export async function getMarketingSalesDataset(): Promise<MarketingSalesDataset> {
  const supabase = await createClient();
  const [leadRows, jobRows, jobCaptureRows, invoiceRows, spendRows, platformRows] =
    await Promise.all([
      fetchAllRows<LeadRow>(
        supabase,
        "marketing_leads",
        "deal_id,created_on,normalized_channel,raw_lead_source,proposal_number,proposal_amount,proposal_on,captured_at",
      ),
      fetchRpcRows<AccountingJobRow>(
        supabase,
        "read_job_accounting_reconciliation",
        { p_companycam_project_id: null },
      ),
      fetchAllRows<JobCaptureRow>(
        supabase,
        "dripjobs_jobs",
        "proposal_id,captured_at",
      ),
      fetchRpcRows<CustomerReconciliationRow>(
        supabase,
        "read_customer_invoice_reconciliation",
      ),
      fetchAllRows<SpendRow>(
        supabase,
        "financial_transactions",
        "id,posted_on,counterparty,description,category,net_amount,transaction_type,is_transfer",
      ),
      fetchAllRows<PlatformRow>(
        supabase,
        "marketing_platform_monthly_performance",
        "month_start,account_id,account_name,currency,purpose,spend,leads,impressions,captured_at",
      ),
    ]);

  const leads: MarketingLeadFact[] = leadRows.map((lead) => ({
    dealId: lead.deal_id,
    createdOn: lead.created_on,
    channel: lead.normalized_channel,
    rawSource: lead.raw_lead_source,
    proposalRecorded: Boolean(
      lead.proposal_number || lead.proposal_amount != null || lead.proposal_on,
    ),
  }));
  const leadsById = new Map(leads.map((lead) => [lead.dealId, lead]));
  const invoicesByProposal = new Map<string, string[]>();
  for (const invoice of invoiceRows) {
    const proposalId = String(invoice.job_proposal_id ?? "").trim();
    if (!proposalId) continue;
    const rows = invoicesByProposal.get(proposalId) ?? [];
    rows.push(invoice.customer_invoice_id);
    invoicesByProposal.set(proposalId, rows);
  }
  const jobs: MarketingJobFact[] = jobRows.flatMap((job) => {
    const lead = job.lead_deal_id ? leadsById.get(job.lead_deal_id) : null;
    if (!lead || !job) return [];
    const invoices = invoicesByProposal.get(job.job_proposal_id) ?? [];
    return [{
      proposalId: job.job_proposal_id,
      leadDealId: lead.dealId,
      jobName: job.job_name,
      status: job.job_status,
      proposalSignedOn: job.proposal_signed_on,
      jobStartOn: job.job_start_on,
      jobCompletionOn: job.job_completion_on,
      invoiceIds: invoices,
      cashAllocationCount: Number(job.customer_bank_payment_count ?? 0),
      bookedRevenueBeforeHst: Number(job.booked_revenue_before_hst ?? 0),
      bookedHst: Number(job.customer_hst_billed ?? 0),
      bookedRevenueAfterHst: Number(job.customer_invoice_total ?? 0),
      cashRevenueBeforeHst: Number(job.bank_backed_revenue_before_hst ?? 0),
      bankCashReceived: Number(job.customer_bank_cash_received ?? 0),
      amountReceivable: Number(job.customer_amount_receivable ?? 0),
    }];
  });

  const spend: MarketingSpendFact[] = spendRows
    .filter(
      (row) =>
        row.category === "Advertising & marketing" &&
        row.transaction_type !== "income" &&
        !row.is_transfer &&
        Number(row.net_amount) < 0,
    )
    .map((row) => ({
      transactionId: row.id,
      postedOn: row.posted_on,
      amountCad: roundMoney(Math.abs(Number(row.net_amount))),
      counterparty:
        row.counterparty?.trim() || row.description.trim() || "Meta Ads",
    }));

  const platformMonthly: MarketingPlatformMonth[] = platformRows.map((row) => ({
    monthStart: row.month_start,
    accountId: row.account_id,
    accountName: row.account_name,
    currency: row.currency,
    purpose: row.purpose,
    spend: Number(row.spend ?? 0),
    leads: Number(row.leads ?? 0),
    impressions: Number(row.impressions ?? 0),
  }));

  return {
    leads,
    jobs,
    spend,
    platformMonthly,
    quality: {
      totalLeads: leads.length,
      totalJobs: jobRows.length,
      confirmedJobLinks: jobs.length,
      missingLeadSourceJobs: jobRows.filter((job) => !job.lead_deal_id).length,
      linkedJobsWithInvoice: jobs.filter((job) => job.invoiceIds.length > 0).length,
      linkedJobsWithoutInvoice: jobs.filter((job) => job.invoiceIds.length === 0).length,
      linkedJobsWithoutCashEvidence: jobs.filter(
        (job) => job.cashAllocationCount === 0,
      ).length,
      activeCustomerInvoiceAllocations: jobRows.reduce(
        (total, job) => total + Number(job.customer_bank_payment_count ?? 0),
        0,
      ),
      proposalsRecorded: leads.filter((lead) => lead.proposalRecorded).length,
      leadCapturedAt: latest(leadRows.map((lead) => lead.captured_at)),
      jobCapturedAt: latest(jobCaptureRows.map((job) => job.captured_at)),
      platformCapturedAt: latest(platformRows.map((row) => row.captured_at)),
      spendLastPostedOn: latest(spend.map((row) => row.postedOn)),
    },
  };
}
