const OTTAWA_TIME_ZONE = "America/Toronto";
const DAY_MS = 86_400_000;

export type BusinessPulseLeadRow = {
  source_document_id: string;
  source_row_number: number;
  lead_id: string | null;
  created_on: string;
  appointment_on: string | null;
  normalized_channel: string;
  marketing_eligible: boolean;
  captured_at: string;
};

export type BusinessPulseProposalRow = {
  source_document_id: string;
  source_row_number: number;
  proposal_key: string;
  lead_id: string | null;
  first_sent_on: string;
  is_accepted: boolean;
  captured_at: string;
};

export type BusinessPulseSpendRow = {
  id: string;
  platform: string;
  grain: string;
  period_start: string;
  entity_level: string;
  purpose: string;
  currency: string;
  spend_cents: number | string | null;
  captured_at: string;
};

export type BusinessPulseJobRow = {
  id: string;
  lead_id: string | null;
  accepted_quote_id: string | null;
  status: string;
  contract_amount_cents: number | string | null;
  updated_at: string;
};

export type BusinessPulseTransactionRow = {
  id: string;
  posted_on: string;
  description: string | null;
  counterparty: string | null;
  amount_cents: number | string | null;
  category: string | null;
  is_transfer: boolean | null;
  review_status: string | null;
  updated_at: string;
};

export type BusinessPulseSalesReportRow = {
  period_start: string;
  period_end: string;
  sales_count: number | string;
  gross_sales_cents: number | string;
  captured_at: string;
};

export type BusinessPulseSalesMetricsRow = {
  period_start: string;
  period_end: string;
  sales_count: number | string;
  gross_sales_cents: number | string;
  pre_hst_sales_cents: number | string;
  paid_social_sales_count: number | string;
  paid_social_gross_sales_cents: number | string;
  paid_social_pre_hst_sales_cents: number | string;
  captured_at: string;
};

export type BusinessPulseSetRateReportRow = {
  period_start: string;
  period_end: string;
  contacts_created_count: number | string;
  booked_contacts_count: number | string;
  captured_at: string;
};

export type BusinessPulseClosingReportRow = {
  period_start: string;
  period_end: string;
  qualified_proposals_count: number | string;
  accepted_proposals_count: number | string;
  jobs_won_count: number | string;
  captured_at: string;
};

export type BusinessPulseClosingRowMetricsRow = {
  period_start: string;
  period_end: string;
  qualified_proposals_count: number | string;
  accepted_proposals_count: number | string;
  appointment_linked_proposals_count: number | string;
  appointment_linked_accepted_count: number | string;
  paid_social_proposals_count: number | string;
  paid_social_accepted_count: number | string;
  appointment_history_matched_proposals_count: number | string | null;
  appointment_history_matched_accepted_count: number | string | null;
  appointment_history_proposals_count: number | string | null;
  appointment_history_accepted_count: number | string | null;
  captured_at: string;
};

export type BusinessPulseQuoteRow = {
  id: string;
  lead_id: string;
  accepted_at: string | null;
};

export type BusinessPulseInput = {
  asOf: string;
  period?: {
    current: { start: string; end: string };
    previous: { start: string; end: string };
  };
  leads: BusinessPulseLeadRow[];
  proposals: BusinessPulseProposalRow[];
  spend: BusinessPulseSpendRow[];
  jobs: BusinessPulseJobRow[];
  quotes: BusinessPulseQuoteRow[];
  transactions?: BusinessPulseTransactionRow[];
  salesReports?: BusinessPulseSalesReportRow[];
  salesMetrics?: BusinessPulseSalesMetricsRow[];
  setRateReports?: BusinessPulseSetRateReportRow[];
  closingReports?: BusinessPulseClosingReportRow[];
  closingRowMetrics?: BusinessPulseClosingRowMetricsRow[];
};

export type MetricComparison = {
  current: number;
  previous: number;
  change: number;
  percentChange: number | null;
};

export type RateComparison = {
  current: number | null;
  previous: number | null;
};

export type BusinessPulseActivity = {
  metaSpendCents: MetricComparison;
  leads: MetricComparison;
  appointments: MetricComparison;
  proposals: MetricComparison;
  acceptedProposals: MetricComparison;
  jobsWon: MetricComparison;
  acceptedJobs: MetricComparison;
  bookedSalesCents: MetricComparison;
  salesCents: MetricComparison;
  salesBasis: "dripjobs_gross_sales" | "accepted_contracts_pre_hst";
  paidSocialLeads: MetricComparison;
  metaCostPerLeadCents: number | null;
  appointmentSetRate: RateComparison;
  setRateContacts: MetricComparison;
  setRateBookedContacts: MetricComparison;
  setRateBasis: "dripjobs_contact_cohort" | "lead_report_contact_cohort";
  proposalRate: RateComparison;
  acceptedProposalRate: RateComparison;
  closingBasis: "dripjobs_qualified_proposal_cohort" | "imported_first_send_cohort";
};

export type AppointmentPeriodSegment = {
  proposals: number;
  acceptedProposals: number;
  acceptanceRate: number | null;
};

export type BusinessPulseMonthlyPoint = {
  month: string;
  start: string;
  end: string;
  isPartial: boolean;
  leads: number;
  appointments: number;
  proposals: number | null;
  acceptedProposals: number | null;
  jobsWon: number | null;
  acceptedJobs: number | null;
  paidSocialLeads: number;
  metaAcceptedJobs: number | null;
  metaCohortLeads: number;
  metaCohortAppointments: number;
  metaCohortProposals: number;
  metaCohortAcceptedJobs: number;
  metaCohortBookedRevenueCents: number;
  isMetaCohortMature: boolean;
  bookedSalesCents: number | null;
  cashCollectedCents: number;
  metaBookedRevenueCents: number | null;
  metaSpendCents: number;
  metaSpendSource: "bank" | "bank_and_meta_api" | "meta_api";
  metaCostPerLeadCents: number | null;
  metaCacCents: number | null;
  blendedCacCents: number | null;
  bookedRoas: number | null;
  setRate: number | null;
  setRateContacts: number | null;
  setRateBookedContacts: number | null;
  setRateBasis: "dripjobs_contact_cohort" | null;
  proposalRate: number | null;
  acceptedRate: number | null;
  closingBasis: "dripjobs_qualified_proposal_cohort" | null;
};

export type BusinessPulse = {
  asOf: string;
  currentPeriod: { start: string; end: string };
  previousPeriod: { start: string; end: string };
  monthly: BusinessPulseMonthlyPoint[];
  activity: BusinessPulseActivity;
  economics: {
    metaSpendCents: number;
    metaSpendSource: "bank" | "bank_and_meta_api" | "meta_api";
    acceptedJobs: number;
    metaAcceptedJobs: number;
    metaBookedRevenueCents: number;
    metaCacCents: number | null;
    blendedCacCents: number | null;
    bookedRoas: number | null;
  };
  appointments: {
    withAppointment: AppointmentPeriodSegment;
    withoutAppointment: AppointmentPeriodSegment;
    appointmentLift: number | null;
    acceptedWithoutAppointmentShare: number | null;
    basis: "dripjobs_qualified_proposal_customer_appointment_history" | null;
  };
  freshness: {
    leads: string | null;
    proposals: string | null;
    meta: string | null;
    accounting: string | null;
    sales: string | null;
    setRate: string | null;
    closing: string | null;
  };
};

type AcceptedJob = {
  id: string;
  leadId: string | null;
  acceptedOn: string;
  revenueCents: number;
};

function dateFromIso(value: string): Date {
  return new Date(`${value}T12:00:00Z`);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  return isoDate(new Date(dateFromIso(value).getTime() + days * DAY_MS));
}

function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function previousMonthStart(value: string): string {
  const current = dateFromIso(monthStart(value));
  current.setUTCMonth(current.getUTCMonth() - 1);
  return isoDate(current);
}

function lastDayOfMonth(value: string): string {
  const start = dateFromIso(monthStart(value));
  start.setUTCMonth(start.getUTCMonth() + 1);
  return isoDate(new Date(start.getTime() - DAY_MS));
}

function daysBetween(start: string, end: string): number {
  return Math.round((dateFromIso(end).getTime() - dateFromIso(start).getTime()) / DAY_MS);
}

function eventDay(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString("en-CA", { timeZone: OTTAWA_TIME_ZONE });
}

function within(value: string | null, start: string, end: string): boolean {
  return Boolean(value && value >= start && value <= end);
}

function cents(value: number | string | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount) : 0;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function comparison(current: number, previous: number): MetricComparison {
  return {
    current,
    previous,
    change: current - previous,
    percentChange:
      previous === 0 ? (current === 0 ? 0 : null) : ((current - previous) / previous) * 100,
  };
}

function latest(values: Array<string | null | undefined>): string | null {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

function leadIdentity(row: BusinessPulseLeadRow): string {
  return row.lead_id ?? `${row.source_document_id}:${row.source_row_number}`;
}

function uniqueLeadFacts(
  rows: BusinessPulseLeadRow[],
  start: string,
  end: string,
): BusinessPulseLeadRow[] {
  const selected = new Map<string, BusinessPulseLeadRow>();
  for (const row of rows) {
    if (!row.marketing_eligible || !within(row.created_on, start, end)) continue;
    const identity = leadIdentity(row);
    const existing = selected.get(identity);
    if (!existing || row.created_on < existing.created_on) selected.set(identity, row);
  }
  return [...selected.values()];
}

function cohortBookedCount(
  rows: BusinessPulseLeadRow[],
  start: string,
  end: string,
): number {
  const bookedIdentities = new Set(
    rows
      .filter((row) => row.marketing_eligible && row.appointment_on != null)
      .map(leadIdentity),
  );
  return uniqueLeadFacts(rows, start, end)
    .filter((row) => bookedIdentities.has(leadIdentity(row)))
    .length;
}

function appointmentCount(
  rows: BusinessPulseLeadRow[],
  start: string,
  end: string,
): number {
  const identities = new Set<string>();
  for (const row of rows) {
    if (!row.marketing_eligible || !within(row.appointment_on, start, end)) continue;
    identities.add(row.lead_id ?? `${row.source_document_id}:${row.source_row_number}`);
  }
  return identities.size;
}

function proposalCount(
  rows: BusinessPulseProposalRow[],
  start: string,
  end: string,
): number {
  return new Set(
    rows
      .filter((row) => within(row.first_sent_on, start, end))
      .map((row) => row.proposal_key),
  ).size;
}

function acceptedProposalCount(
  rows: BusinessPulseProposalRow[],
  start: string,
  end: string,
): number {
  return new Set(
    rows
      .filter((row) => row.is_accepted && within(row.first_sent_on, start, end))
      .map((row) => row.proposal_key),
  ).size;
}

function isMetaApiSpend(row: BusinessPulseSpendRow): boolean {
  return row.platform.toLowerCase() === "meta" &&
    row.grain === "daily" &&
    row.entity_level === "campaign" &&
    row.purpose === "customer_acquisition" &&
    row.currency.toUpperCase() === "CAD";
}

function metaApiSpend(
  rows: BusinessPulseSpendRow[],
  start: string,
  end: string,
): number {
  return rows.reduce((total, row) => {
    const eligible = isMetaApiSpend(row) && within(row.period_start, start, end);
    return total + (eligible ? cents(row.spend_cents) : 0);
  }, 0);
}

function isMetaBankCharge(row: BusinessPulseTransactionRow): boolean {
  const vendor = `${row.counterparty ?? ""} ${row.description ?? ""}`;
  return !row.is_transfer &&
    row.category === "Advertising & marketing" &&
    cents(row.amount_cents) < 0 &&
    /meta|facebook|facebk/i.test(vendor);
}

function metaBankSpend(
  rows: BusinessPulseTransactionRow[],
  start: string,
  end: string,
): number {
  return rows.reduce((total, row) => {
    if (!isMetaBankCharge(row) || !within(row.posted_on, start, end)) return total;
    return total + Math.abs(cents(row.amount_cents));
  }, 0);
}

function firstMetaApiDay(rows: BusinessPulseSpendRow[]): string | null {
  return rows
    .filter(isMetaApiSpend)
    .map((row) => row.period_start)
    .sort()[0] ?? null;
}

function resolvedMetaSpend(
  input: BusinessPulseInput,
  start: string,
  end: string,
): { cents: number; source: BusinessPulseMonthlyPoint["metaSpendSource"] } {
  const transactions = input.transactions ?? [];
  const apiStart = firstMetaApiDay(input.spend);
  if (!apiStart || end < apiStart) {
    return { cents: metaBankSpend(transactions, start, end), source: "bank" };
  }
  if (start >= apiStart) {
    return { cents: metaApiSpend(input.spend, start, end), source: "meta_api" };
  }
  return {
    cents:
      metaBankSpend(transactions, start, addDays(apiStart, -1)) +
      metaApiSpend(input.spend, apiStart, end),
    source: "bank_and_meta_api",
  };
}

function customerCashCollected(
  rows: BusinessPulseTransactionRow[],
  start: string,
  end: string,
): number {
  return rows.reduce((total, row) => {
    const amount = cents(row.amount_cents);
    const eligible =
      !row.is_transfer &&
      row.category === "Painting revenue" &&
      amount > 0 &&
      within(row.posted_on, start, end);
    return total + (eligible ? amount : 0);
  }, 0);
}

function acceptedJobs(input: BusinessPulseInput): AcceptedJob[] {
  const quotes = new Map(input.quotes.map((quote) => [quote.id, quote]));
  return input.jobs.flatMap((job) => {
    if (job.status.toLowerCase() === "cancelled" || !job.accepted_quote_id) return [];
    const quote = quotes.get(job.accepted_quote_id);
    const acceptedOn = eventDay(quote?.accepted_at ?? null);
    if (!quote || !acceptedOn || acceptedOn > input.asOf) return [];
    return [{
      id: job.id,
      leadId: job.lead_id ?? quote.lead_id,
      acceptedOn,
      revenueCents: cents(job.contract_amount_cents),
    }];
  });
}

function acceptedPeriod(
  jobs: AcceptedJob[],
  start: string,
  end: string,
): { count: number; revenueCents: number } {
  const selected = jobs.filter((job) => within(job.acceptedOn, start, end));
  return {
    count: selected.length,
    revenueCents: selected.reduce((sum, job) => sum + job.revenueCents, 0),
  };
}

function exactSalesReport(
  rows: BusinessPulseSalesReportRow[],
  start: string,
  end: string,
): BusinessPulseSalesReportRow | null {
  return rows
    .filter((row) => row.period_start === start && row.period_end === end)
    .sort((left, right) => left.captured_at.localeCompare(right.captured_at))
    .at(-1) ?? null;
}

function exactSalesMetrics(
  rows: BusinessPulseSalesMetricsRow[],
  start: string,
  end: string,
): BusinessPulseSalesMetricsRow | null {
  return rows
    .filter((row) => row.period_start === start && row.period_end === end)
    .sort((left, right) => left.captured_at.localeCompare(right.captured_at))
    .at(-1) ?? null;
}

function exactSetRateReport(
  rows: BusinessPulseSetRateReportRow[],
  start: string,
  end: string,
): BusinessPulseSetRateReportRow | null {
  return rows
    .filter((row) => row.period_start === start && row.period_end === end)
    .sort((left, right) => left.captured_at.localeCompare(right.captured_at))
    .at(-1) ?? null;
}

function exactClosingReport(
  rows: BusinessPulseClosingReportRow[],
  start: string,
  end: string,
): BusinessPulseClosingReportRow | null {
  return rows
    .filter((row) => row.period_start === start && row.period_end === end)
    .sort((left, right) => left.captured_at.localeCompare(right.captured_at))
    .at(-1) ?? null;
}

function exactClosingRowMetrics(
  rows: BusinessPulseClosingRowMetricsRow[],
  start: string,
  end: string,
): BusinessPulseClosingRowMetricsRow | null {
  return rows
    .filter((row) => row.period_start === start && row.period_end === end)
    .sort((left, right) => left.captured_at.localeCompare(right.captured_at))
    .at(-1) ?? null;
}

// The yearly series intentionally ignores the selected page period. It relies on
// BusinessPulseInput containing the complete fact history through `asOf`.
function monthlySeries(
  input: BusinessPulseInput,
  jobs: AcceptedJob[],
): BusinessPulseMonthlyPoint[] {
  const year = input.asOf.slice(0, 4);
  const asOfMonth = Number(input.asOf.slice(5, 7));
  const points: BusinessPulseMonthlyPoint[] = [];

  for (let month = 1; month <= asOfMonth; month += 1) {
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const monthEnd = lastDayOfMonth(start);
    const end = [monthEnd, input.asOf].sort()[0]!;
    const monthLeads = uniqueLeadFacts(input.leads, start, end);
    const appointments = appointmentCount(input.leads, start, end);
    const setRateReport = exactSetRateReport(input.setRateReports ?? [], start, end);
    const setRateContacts = setRateReport
      ? cents(setRateReport.contacts_created_count)
      : null;
    const setRateBookedContacts = setRateReport
      ? cents(setRateReport.booked_contacts_count)
      : null;
    const closingRowMetric = exactClosingRowMetrics(
      input.closingRowMetrics ?? [],
      start,
      end,
    );
    const closingReport = exactClosingReport(input.closingReports ?? [], start, end);
    const exactClosing = closingRowMetric ?? closingReport;
    const proposals = exactClosing
      ? cents(exactClosing.qualified_proposals_count)
      : null;
    const acceptedProposals = exactClosing
      ? cents(exactClosing.accepted_proposals_count)
      : null;
    const salesMetric = exactSalesMetrics(input.salesMetrics ?? [], start, end);
    const salesCount = salesMetric ? cents(salesMetric.sales_count) : null;
    const bookedSalesCents = salesMetric
      ? cents(salesMetric.pre_hst_sales_cents)
      : null;
    const metaAcceptedJobs = salesMetric
      ? cents(salesMetric.paid_social_sales_count)
      : null;
    const metaBookedRevenueCents = salesMetric
      ? cents(salesMetric.paid_social_pre_hst_sales_cents)
      : null;
    const spend = resolvedMetaSpend(input, start, end);
    const spendCents = spend.cents;
    const cashCollectedCents = customerCashCollected(input.transactions ?? [], start, end);
    const paidSocialLeads = monthLeads.filter(
      (lead) => lead.normalized_channel === "paid_social",
    );
    const metaCohortLeadIds = new Set(
      paidSocialLeads.flatMap((lead) => (lead.lead_id ? [lead.lead_id] : [])),
    );
    const metaCohortAppointments = paidSocialLeads.filter((lead) => {
      if (lead.lead_id) {
        return input.leads.some(
          (candidate) =>
            candidate.lead_id === lead.lead_id &&
            candidate.appointment_on != null &&
            candidate.appointment_on <= input.asOf,
        );
      }
      return Boolean(lead.appointment_on && lead.appointment_on <= input.asOf);
    }).length;
    const metaCohortProposals = new Set(
      input.proposals
        .filter(
          (proposal) =>
            proposal.lead_id != null &&
            metaCohortLeadIds.has(proposal.lead_id) &&
            proposal.first_sent_on <= input.asOf,
        )
        .map((proposal) => proposal.proposal_key),
    ).size;
    const metaCohortJobs = jobs.filter(
      (job) => Boolean(job.leadId && metaCohortLeadIds.has(job.leadId)),
    );

    points.push({
      month: start.slice(0, 7),
      start,
      end,
      isPartial: end < monthEnd,
      leads: monthLeads.length,
      appointments,
      proposals,
      acceptedProposals,
      jobsWon: salesCount,
      acceptedJobs: salesCount,
      paidSocialLeads: paidSocialLeads.length,
      metaAcceptedJobs,
      metaCohortLeads: paidSocialLeads.length,
      metaCohortAppointments,
      metaCohortProposals,
      metaCohortAcceptedJobs: metaCohortJobs.length,
      metaCohortBookedRevenueCents: metaCohortJobs.reduce(
        (sum, job) => sum + job.revenueCents,
        0,
      ),
      isMetaCohortMature: end <= addDays(input.asOf, -30),
      bookedSalesCents,
      cashCollectedCents,
      metaBookedRevenueCents,
      metaSpendCents: spendCents,
      metaSpendSource: spend.source,
      metaCostPerLeadCents:
        paidSocialLeads.length > 0 ? Math.round(spendCents / paidSocialLeads.length) : null,
      metaCacCents:
        metaAcceptedJobs != null && metaAcceptedJobs > 0
          ? Math.round(spendCents / metaAcceptedJobs)
          : null,
      blendedCacCents:
        salesCount != null && salesCount > 0
          ? Math.round(spendCents / salesCount)
          : null,
      bookedRoas:
        metaBookedRevenueCents == null
          ? null
          : ratio(metaBookedRevenueCents, spendCents),
      setRate:
        setRateBookedContacts == null || setRateContacts == null
          ? null
          : ratio(setRateBookedContacts, setRateContacts),
      setRateContacts,
      setRateBookedContacts,
      setRateBasis: setRateReport
        ? "dripjobs_contact_cohort"
        : null,
      proposalRate:
        proposals == null || setRateContacts == null
          ? null
          : ratio(proposals, setRateContacts),
      acceptedRate:
        acceptedProposals == null || proposals == null
          ? null
          : ratio(acceptedProposals, proposals),
      closingBasis: exactClosing
        ? "dripjobs_qualified_proposal_cohort"
        : null,
    });
  }

  return points;
}

function appointmentPeriodSegments(
  metric: BusinessPulseClosingRowMetricsRow | null,
): {
  withAppointment: AppointmentPeriodSegment;
  withoutAppointment: AppointmentPeriodSegment;
} | null {
  if (!metric) return null;

  const totalProposals = metric ? cents(metric.qualified_proposals_count) : 0;
  const totalAccepted = metric ? cents(metric.accepted_proposals_count) : 0;
  const matchedProposals = cents(metric.appointment_history_matched_proposals_count);
  const matchedAccepted = cents(metric.appointment_history_matched_accepted_count);
  if (matchedProposals !== totalProposals || matchedAccepted !== totalAccepted) {
    return null;
  }

  const linkedProposals = cents(metric.appointment_history_proposals_count);
  const linkedAccepted = cents(metric.appointment_history_accepted_count);
  const withAppointment = {
    proposals: linkedProposals,
    acceptedProposals: linkedAccepted,
  };
  const withoutAppointment = {
    proposals: Math.max(totalProposals - linkedProposals, 0),
    acceptedProposals: Math.max(totalAccepted - linkedAccepted, 0),
  };

  return {
    withAppointment: {
      ...withAppointment,
      acceptanceRate: ratio(
        withAppointment.acceptedProposals,
        withAppointment.proposals,
      ),
    },
    withoutAppointment: {
      ...withoutAppointment,
      acceptanceRate: ratio(
        withoutAppointment.acceptedProposals,
        withoutAppointment.proposals,
      ),
    },
  };
}

export function buildBusinessPulse(input: BusinessPulseInput): BusinessPulse {
  const defaultCurrentStart = monthStart(input.asOf);
  const elapsedDays = daysBetween(defaultCurrentStart, input.asOf);
  const defaultPreviousStart = previousMonthStart(input.asOf);
  const defaultPreviousEnd = [
    addDays(defaultPreviousStart, elapsedDays),
    lastDayOfMonth(defaultPreviousStart),
  ].sort()[0]!;
  const currentStart = input.period?.current.start ?? defaultCurrentStart;
  const currentEnd = input.period?.current.end ?? input.asOf;
  const previousStart = input.period?.previous.start ?? defaultPreviousStart;
  const previousEnd = input.period?.previous.end ?? defaultPreviousEnd;
  const jobs = acceptedJobs(input);

  const currentLeads = uniqueLeadFacts(input.leads, currentStart, currentEnd);
  const previousLeads = uniqueLeadFacts(input.leads, previousStart, previousEnd);
  const currentAccepted = acceptedPeriod(jobs, currentStart, currentEnd);
  const previousAccepted = acceptedPeriod(jobs, previousStart, previousEnd);
  const currentSalesReport = exactSalesReport(
    input.salesReports ?? [],
    currentStart,
    currentEnd,
  );
  const previousSalesReport = exactSalesReport(
    input.salesReports ?? [],
    previousStart,
    previousEnd,
  );
  const currentSalesMetric = exactSalesMetrics(
    input.salesMetrics ?? [],
    currentStart,
    currentEnd,
  );
  const previousSalesMetric = exactSalesMetrics(
    input.salesMetrics ?? [],
    previousStart,
    previousEnd,
  );
  const useDripJobsSalesMetrics = Boolean(currentSalesMetric && previousSalesMetric);
  const useDripJobsSales = useDripJobsSalesMetrics || Boolean(
    currentSalesReport && previousSalesReport,
  );
  const currentSetRateReport = exactSetRateReport(
    input.setRateReports ?? [],
    currentStart,
    currentEnd,
  );
  const previousSetRateReport = exactSetRateReport(
    input.setRateReports ?? [],
    previousStart,
    previousEnd,
  );
  const useDripJobsSetRate = Boolean(currentSetRateReport && previousSetRateReport);
  const currentClosingReport = exactClosingReport(
    input.closingReports ?? [],
    currentStart,
    currentEnd,
  );
  const previousClosingReport = exactClosingReport(
    input.closingReports ?? [],
    previousStart,
    previousEnd,
  );
  const useDripJobsClosing = Boolean(currentClosingReport && previousClosingReport);
  const currentClosingRowMetric = exactClosingRowMetrics(
    input.closingRowMetrics ?? [],
    currentStart,
    currentEnd,
  );
  const currentAppointmentCount = appointmentCount(input.leads, currentStart, currentEnd);
  const previousAppointmentCount = appointmentCount(input.leads, previousStart, previousEnd);
  const currentSetRateContacts = useDripJobsSetRate
    ? cents(currentSetRateReport?.contacts_created_count)
    : currentLeads.length;
  const previousSetRateContacts = useDripJobsSetRate
    ? cents(previousSetRateReport?.contacts_created_count)
    : previousLeads.length;
  const currentSetRateBookedContacts = useDripJobsSetRate
    ? cents(currentSetRateReport?.booked_contacts_count)
    : cohortBookedCount(input.leads, currentStart, currentEnd);
  const previousSetRateBookedContacts = useDripJobsSetRate
    ? cents(previousSetRateReport?.booked_contacts_count)
    : cohortBookedCount(input.leads, previousStart, previousEnd);
  const currentProposalCount = useDripJobsClosing
    ? cents(currentClosingReport?.qualified_proposals_count)
    : proposalCount(input.proposals, currentStart, currentEnd);
  const previousProposalCount = useDripJobsClosing
    ? cents(previousClosingReport?.qualified_proposals_count)
    : proposalCount(input.proposals, previousStart, previousEnd);
  const currentAcceptedProposalCount = useDripJobsClosing
    ? cents(currentClosingReport?.accepted_proposals_count)
    : acceptedProposalCount(input.proposals, currentStart, currentEnd);
  const previousAcceptedProposalCount = useDripJobsClosing
    ? cents(previousClosingReport?.accepted_proposals_count)
    : acceptedProposalCount(input.proposals, previousStart, previousEnd);
  const currentJobsWonCount = useDripJobsClosing
    ? cents(currentClosingReport?.jobs_won_count)
    : currentAccepted.count;
  const previousJobsWonCount = useDripJobsClosing
    ? cents(previousClosingReport?.jobs_won_count)
    : previousAccepted.count;
  const currentSpend = resolvedMetaSpend(input, currentStart, currentEnd);
  const previousSpend = resolvedMetaSpend(input, previousStart, previousEnd);
  const currentPaidSocialLeads = currentLeads.filter(
    (lead) => lead.normalized_channel === "paid_social",
  ).length;
  const previousPaidSocialLeads = previousLeads.filter(
    (lead) => lead.normalized_channel === "paid_social",
  ).length;
  const paidSocialLeadIds = new Set(
    input.leads.flatMap((lead) =>
      lead.marketing_eligible &&
      lead.normalized_channel === "paid_social" &&
      lead.lead_id
        ? [lead.lead_id]
        : [],
    ),
  );
  const currentMetaAcceptedJobs = jobs.filter(
    (job) =>
      within(job.acceptedOn, currentStart, currentEnd) &&
      Boolean(job.leadId && paidSocialLeadIds.has(job.leadId)),
  );
  const currentMetaBookedRevenueCents = currentMetaAcceptedJobs.reduce(
    (total, job) => total + job.revenueCents,
    0,
  );
  const exactCurrentSalesCount = currentSalesMetric
    ? cents(currentSalesMetric.sales_count)
    : currentAccepted.count;
  const exactCurrentMetaSalesCount = currentSalesMetric
    ? cents(currentSalesMetric.paid_social_sales_count)
    : currentMetaAcceptedJobs.length;
  const exactCurrentMetaSalesCents = currentSalesMetric
    ? cents(currentSalesMetric.paid_social_pre_hst_sales_cents)
    : currentMetaBookedRevenueCents;

  const appointmentSegments = appointmentPeriodSegments(currentClosingRowMetric);
  const emptyAppointmentSegment: AppointmentPeriodSegment = {
    proposals: 0,
    acceptedProposals: 0,
    acceptanceRate: null,
  };
  const withAppointment =
    appointmentSegments?.withAppointment ?? emptyAppointmentSegment;
  const withoutAppointment =
    appointmentSegments?.withoutAppointment ?? emptyAppointmentSegment;
  const totalAcceptedProposals =
    withAppointment.acceptedProposals + withoutAppointment.acceptedProposals;

  const appointmentLift =
    withAppointment.acceptanceRate != null && withoutAppointment.acceptanceRate != null
      ? withAppointment.acceptanceRate - withoutAppointment.acceptanceRate
      : null;

  return {
    asOf: input.asOf,
    currentPeriod: { start: currentStart, end: currentEnd },
    previousPeriod: { start: previousStart, end: previousEnd },
    monthly: monthlySeries(input, jobs),
    activity: {
      metaSpendCents: comparison(currentSpend.cents, previousSpend.cents),
      leads: comparison(currentSetRateContacts, previousSetRateContacts),
      appointments: comparison(currentAppointmentCount, previousAppointmentCount),
      proposals: comparison(currentProposalCount, previousProposalCount),
      acceptedProposals: comparison(
        currentAcceptedProposalCount,
        previousAcceptedProposalCount,
      ),
      jobsWon: comparison(currentJobsWonCount, previousJobsWonCount),
      acceptedJobs: comparison(currentAccepted.count, previousAccepted.count),
      bookedSalesCents: comparison(
        useDripJobsSalesMetrics
          ? cents(currentSalesMetric?.pre_hst_sales_cents)
          : currentAccepted.revenueCents,
        useDripJobsSalesMetrics
          ? cents(previousSalesMetric?.pre_hst_sales_cents)
          : previousAccepted.revenueCents,
      ),
      salesCents: useDripJobsSales
        ? comparison(
            useDripJobsSalesMetrics
              ? cents(currentSalesMetric?.gross_sales_cents)
              : cents(currentSalesReport?.gross_sales_cents),
            useDripJobsSalesMetrics
              ? cents(previousSalesMetric?.gross_sales_cents)
              : cents(previousSalesReport?.gross_sales_cents),
          )
        : comparison(currentAccepted.revenueCents, previousAccepted.revenueCents),
      salesBasis: useDripJobsSales
        ? "dripjobs_gross_sales"
        : "accepted_contracts_pre_hst",
      paidSocialLeads: comparison(currentPaidSocialLeads, previousPaidSocialLeads),
      metaCostPerLeadCents:
        currentPaidSocialLeads > 0
          ? Math.round(currentSpend.cents / currentPaidSocialLeads)
          : null,
      appointmentSetRate: {
        current: ratio(currentSetRateBookedContacts, currentSetRateContacts),
        previous: ratio(previousSetRateBookedContacts, previousSetRateContacts),
      },
      setRateContacts: comparison(currentSetRateContacts, previousSetRateContacts),
      setRateBookedContacts: comparison(
        currentSetRateBookedContacts,
        previousSetRateBookedContacts,
      ),
      setRateBasis: useDripJobsSetRate
        ? "dripjobs_contact_cohort"
        : "lead_report_contact_cohort",
      proposalRate: {
        current: ratio(currentProposalCount, currentSetRateContacts),
        previous: ratio(previousProposalCount, previousSetRateContacts),
      },
      acceptedProposalRate: {
        current: ratio(currentAcceptedProposalCount, currentProposalCount),
        previous: ratio(previousAcceptedProposalCount, previousProposalCount),
      },
      closingBasis: useDripJobsClosing
        ? "dripjobs_qualified_proposal_cohort"
        : "imported_first_send_cohort",
    },
    economics: {
      metaSpendCents: currentSpend.cents,
      metaSpendSource: currentSpend.source,
      acceptedJobs: exactCurrentSalesCount,
      metaAcceptedJobs: exactCurrentMetaSalesCount,
      metaBookedRevenueCents: exactCurrentMetaSalesCents,
      metaCacCents:
        exactCurrentMetaSalesCount > 0
          ? Math.round(currentSpend.cents / exactCurrentMetaSalesCount)
          : null,
      blendedCacCents:
        exactCurrentSalesCount > 0
          ? Math.round(currentSpend.cents / exactCurrentSalesCount)
          : null,
      bookedRoas: ratio(exactCurrentMetaSalesCents, currentSpend.cents),
    },
    appointments: {
      withAppointment,
      withoutAppointment,
      appointmentLift,
      acceptedWithoutAppointmentShare: ratio(
        withoutAppointment.acceptedProposals,
        totalAcceptedProposals,
      ),
      basis: appointmentSegments
        ? "dripjobs_qualified_proposal_customer_appointment_history"
        : null,
    },
    freshness: {
      leads: latest(input.leads.map((row) => row.captured_at)),
      proposals: latest(input.proposals.map((row) => row.captured_at)),
      meta: latest(input.spend.map((row) => row.captured_at)),
      accounting: latest([
        ...input.jobs.map((row) => row.updated_at),
        ...(input.transactions ?? []).map((row) => row.updated_at),
      ]),
      sales: latest([
        ...(input.salesReports ?? []).map((row) => row.captured_at),
        ...(input.salesMetrics ?? []).map((row) => row.captured_at),
      ]),
      setRate: latest((input.setRateReports ?? []).map((row) => row.captured_at)),
      closing: latest([
        ...(input.closingReports ?? []).map((row) => row.captured_at),
        ...(input.closingRowMetrics ?? []).map((row) => row.captured_at),
      ]),
    },
  };
}
