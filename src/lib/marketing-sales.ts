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
  cashRevenueBeforeHst: number;
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

type JobRow = {
  proposal_id: string;
  job_name: string;
  status: string;
  proposal_signed_on: string | null;
  job_start_on: string | null;
  job_completion_on: string | null;
  lead_resolution_status: "confirmed" | "needs_review" | "missing_source";
  captured_at: string;
};

type LinkRow = {
  lead_deal_id: string;
  job_proposal_id: string;
  relationship_type: string;
  link_status: string;
};

type CustomerInvoiceRow = {
  id: string;
  external_proposal_id: string | null;
  subtotal: number;
  total_amount: number;
};

type CustomerAllocationRow = {
  customer_invoice_id: string;
  invoice_applied_amount: number;
  reversed_at: string | null;
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

export async function getMarketingSalesDataset(): Promise<MarketingSalesDataset> {
  const supabase = await createClient();
  const [leadRows, jobRows, linkRows, invoiceRows, allocationRows, spendRows, platformRows] =
    await Promise.all([
      fetchAllRows<LeadRow>(
        supabase,
        "marketing_leads",
        "deal_id,created_on,normalized_channel,raw_lead_source,proposal_number,proposal_amount,proposal_on,captured_at",
      ),
      fetchAllRows<JobRow>(
        supabase,
        "dripjobs_jobs",
        "proposal_id,job_name,status,proposal_signed_on,job_start_on,job_completion_on,lead_resolution_status,captured_at",
      ),
      fetchAllRows<LinkRow>(
        supabase,
        "marketing_lead_job_links",
        "lead_deal_id,job_proposal_id,relationship_type,link_status",
      ),
      fetchAllRows<CustomerInvoiceRow>(
        supabase,
        "customer_invoices",
        "id,external_proposal_id,subtotal,total_amount",
      ),
      fetchAllRows<CustomerAllocationRow>(
        supabase,
        "customer_invoice_bank_allocations",
        "customer_invoice_id,invoice_applied_amount,reversed_at",
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
  const jobsByProposal = new Map(
    jobRows.map((job) => [job.proposal_id, job]),
  );
  const invoicesByProposal = new Map<string, CustomerInvoiceRow[]>();
  for (const invoice of invoiceRows) {
    const proposalId = String(invoice.external_proposal_id ?? "").trim();
    if (!proposalId) continue;
    const rows = invoicesByProposal.get(proposalId) ?? [];
    rows.push(invoice);
    invoicesByProposal.set(proposalId, rows);
  }
  const appliedByInvoice = new Map<string, number>();
  const allocationCountByInvoice = new Map<string, number>();
  for (const allocation of allocationRows) {
    if (allocation.reversed_at) continue;
    appliedByInvoice.set(
      allocation.customer_invoice_id,
      (appliedByInvoice.get(allocation.customer_invoice_id) ?? 0) +
        Number(allocation.invoice_applied_amount ?? 0),
    );
    allocationCountByInvoice.set(
      allocation.customer_invoice_id,
      (allocationCountByInvoice.get(allocation.customer_invoice_id) ?? 0) + 1,
    );
  }

  const confirmedLinks = linkRows.filter(
    (link) =>
      link.relationship_type === "originated" && link.link_status === "confirmed",
  );
  const jobs: MarketingJobFact[] = confirmedLinks.flatMap((link) => {
    const lead = leadsById.get(link.lead_deal_id);
    const job = jobsByProposal.get(link.job_proposal_id);
    if (!lead || !job) return [];
    const invoices = invoicesByProposal.get(job.proposal_id) ?? [];
    const bookedRevenueBeforeHst = invoices.reduce(
      (total, invoice) => total + Number(invoice.subtotal ?? 0),
      0,
    );
    const cashRevenueBeforeHst = invoices.reduce((total, invoice) => {
      const invoiceApplied = appliedByInvoice.get(invoice.id) ?? 0;
      const totalAmount = Number(invoice.total_amount ?? 0);
      return total +
        (totalAmount > 0
          ? (invoiceApplied * Number(invoice.subtotal ?? 0)) / totalAmount
          : 0);
    }, 0);
    return [{
      proposalId: job.proposal_id,
      leadDealId: lead.dealId,
      jobName: job.job_name,
      status: job.status,
      proposalSignedOn: job.proposal_signed_on,
      jobStartOn: job.job_start_on,
      jobCompletionOn: job.job_completion_on,
      invoiceIds: invoices.map((invoice) => invoice.id),
      cashAllocationCount: invoices.reduce(
        (total, invoice) => total + (allocationCountByInvoice.get(invoice.id) ?? 0),
        0,
      ),
      bookedRevenueBeforeHst: roundMoney(bookedRevenueBeforeHst),
      cashRevenueBeforeHst: roundMoney(cashRevenueBeforeHst),
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
      missingLeadSourceJobs: jobRows.filter(
        (job) => job.lead_resolution_status === "missing_source",
      ).length,
      linkedJobsWithInvoice: jobs.filter((job) => job.invoiceIds.length > 0).length,
      linkedJobsWithoutInvoice: jobs.filter((job) => job.invoiceIds.length === 0).length,
      linkedJobsWithoutCashEvidence: jobs.filter(
        (job) => job.cashAllocationCount === 0,
      ).length,
      activeCustomerInvoiceAllocations: allocationRows.filter(
        (allocation) => !allocation.reversed_at,
      ).length,
      proposalsRecorded: leads.filter((lead) => lead.proposalRecorded).length,
      leadCapturedAt: latest(leadRows.map((lead) => lead.captured_at)),
      jobCapturedAt: latest(jobRows.map((job) => job.captured_at)),
      platformCapturedAt: latest(platformRows.map((row) => row.captured_at)),
      spendLastPostedOn: latest(spend.map((row) => row.postedOn)),
    },
  };
}
