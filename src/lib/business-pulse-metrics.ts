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
  acceptedJobs: MetricComparison;
  bookedSalesCents: MetricComparison;
  paidSocialLeads: MetricComparison;
  metaCostPerLeadCents: number | null;
  appointmentSetRate: RateComparison;
  proposalRate: RateComparison;
  acceptedProposalRate: RateComparison;
};

export type AppointmentPeriodSegment = {
  leads: number;
  proposals: number;
  acceptedJobs: number;
  acceptanceRate: number | null;
  bookedRevenueCents: number;
};

export type BusinessPulseMonthlyPoint = {
  month: string;
  start: string;
  end: string;
  isPartial: boolean;
  leads: number;
  appointments: number;
  proposals: number;
  acceptedJobs: number;
  paidSocialLeads: number;
  metaAcceptedJobs: number;
  metaCohortLeads: number;
  metaCohortAppointments: number;
  metaCohortProposals: number;
  metaCohortAcceptedJobs: number;
  metaCohortBookedRevenueCents: number;
  isMetaCohortMature: boolean;
  bookedSalesCents: number;
  cashCollectedCents: number;
  metaBookedRevenueCents: number;
  metaSpendCents: number;
  metaSpendSource: "bank" | "bank_and_meta_api" | "meta_api";
  metaCostPerLeadCents: number | null;
  metaCacCents: number | null;
  blendedCacCents: number | null;
  bookedRoas: number | null;
  setRate: number | null;
  proposalRate: number | null;
  acceptedRate: number | null;
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
  };
  freshness: {
    leads: string | null;
    proposals: string | null;
    meta: string | null;
    accounting: string | null;
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

function uniqueLeadFacts(
  rows: BusinessPulseLeadRow[],
  start: string,
  end: string,
): BusinessPulseLeadRow[] {
  const selected = new Map<string, BusinessPulseLeadRow>();
  for (const row of rows) {
    if (!row.marketing_eligible || !within(row.created_on, start, end)) continue;
    const identity = row.lead_id ?? `${row.source_document_id}:${row.source_row_number}`;
    const existing = selected.get(identity);
    if (!existing || row.created_on < existing.created_on) selected.set(identity, row);
  }
  return [...selected.values()];
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

// The yearly series intentionally ignores the selected page period. It relies on
// BusinessPulseInput containing the complete fact history through `asOf`.
function monthlySeries(
  input: BusinessPulseInput,
  jobs: AcceptedJob[],
  paidSocialLeadIds: Set<string>,
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
    const proposals = proposalCount(input.proposals, start, end);
    const accepted = acceptedPeriod(jobs, start, end);
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
    const metaJobs = jobs.filter(
      (job) =>
        within(job.acceptedOn, start, end) &&
        Boolean(job.leadId && paidSocialLeadIds.has(job.leadId)),
    );
    const metaBookedRevenueCents = metaJobs.reduce(
      (sum, job) => sum + job.revenueCents,
      0,
    );

    points.push({
      month: start.slice(0, 7),
      start,
      end,
      isPartial: end < monthEnd,
      leads: monthLeads.length,
      appointments,
      proposals,
      acceptedJobs: accepted.count,
      paidSocialLeads: paidSocialLeads.length,
      metaAcceptedJobs: metaJobs.length,
      metaCohortLeads: paidSocialLeads.length,
      metaCohortAppointments,
      metaCohortProposals,
      metaCohortAcceptedJobs: metaCohortJobs.length,
      metaCohortBookedRevenueCents: metaCohortJobs.reduce(
        (sum, job) => sum + job.revenueCents,
        0,
      ),
      isMetaCohortMature: end <= addDays(input.asOf, -30),
      bookedSalesCents: accepted.revenueCents,
      cashCollectedCents,
      metaBookedRevenueCents,
      metaSpendCents: spendCents,
      metaSpendSource: spend.source,
      metaCostPerLeadCents:
        paidSocialLeads.length > 0 ? Math.round(spendCents / paidSocialLeads.length) : null,
      metaCacCents:
        metaJobs.length > 0 ? Math.round(spendCents / metaJobs.length) : null,
      blendedCacCents:
        accepted.count > 0 ? Math.round(spendCents / accepted.count) : null,
      bookedRoas: ratio(metaBookedRevenueCents, spendCents),
      setRate: ratio(appointments, monthLeads.length),
      proposalRate: ratio(proposals, monthLeads.length),
      acceptedRate: ratio(accepted.count, proposals),
    });
  }

  return points;
}

function appointmentDatesByLead(rows: BusinessPulseLeadRow[]): Map<string, string[]> {
  const dates = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.marketing_eligible || !row.lead_id || !row.appointment_on) continue;
    const existing = dates.get(row.lead_id) ?? [];
    existing.push(row.appointment_on);
    dates.set(row.lead_id, existing);
  }
  return dates;
}

function hasAppointmentBefore(
  datesByLead: Map<string, string[]>,
  leadId: string | null,
  cutoff: string,
): boolean {
  return Boolean(leadId && (datesByLead.get(leadId) ?? []).some((date) => date <= cutoff));
}

function appointmentPeriodSegments(
  leads: BusinessPulseLeadRow[],
  proposals: BusinessPulseProposalRow[],
  jobs: AcceptedJob[],
  allLeadRows: BusinessPulseLeadRow[],
  start: string,
  end: string,
): { withAppointment: AppointmentPeriodSegment; withoutAppointment: AppointmentPeriodSegment } {
  const datesByLead = appointmentDatesByLead(allLeadRows);
  const withAppointment = { leads: 0, proposals: 0, acceptedJobs: 0, bookedRevenueCents: 0 };
  const withoutAppointment = { leads: 0, proposals: 0, acceptedJobs: 0, bookedRevenueCents: 0 };

  for (const lead of leads) {
    const hasAppointment = lead.lead_id
      ? hasAppointmentBefore(datesByLead, lead.lead_id, end)
      : Boolean(lead.appointment_on && lead.appointment_on <= end);
    (hasAppointment ? withAppointment : withoutAppointment).leads += 1;
  }

  const proposalsByKey = new Map<string, BusinessPulseProposalRow>();
  for (const proposal of proposals) {
    if (!within(proposal.first_sent_on, start, end)) continue;
    const existing = proposalsByKey.get(proposal.proposal_key);
    if (!existing || proposal.first_sent_on < existing.first_sent_on) {
      proposalsByKey.set(proposal.proposal_key, proposal);
    }
  }
  for (const proposal of proposalsByKey.values()) {
    const hasAppointment = hasAppointmentBefore(
      datesByLead,
      proposal.lead_id,
      proposal.first_sent_on,
    );
    (hasAppointment ? withAppointment : withoutAppointment).proposals += 1;
  }

  for (const job of jobs) {
    if (!within(job.acceptedOn, start, end)) continue;
    const hasAppointment = hasAppointmentBefore(datesByLead, job.leadId, job.acceptedOn);
    const segment = hasAppointment ? withAppointment : withoutAppointment;
    segment.acceptedJobs += 1;
    segment.bookedRevenueCents += job.revenueCents;
  }

  return {
    withAppointment: {
      ...withAppointment,
      acceptanceRate: ratio(withAppointment.acceptedJobs, withAppointment.proposals),
    },
    withoutAppointment: {
      ...withoutAppointment,
      acceptanceRate: ratio(withoutAppointment.acceptedJobs, withoutAppointment.proposals),
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
  const currentAppointmentCount = appointmentCount(input.leads, currentStart, currentEnd);
  const previousAppointmentCount = appointmentCount(input.leads, previousStart, previousEnd);
  const currentProposalCount = proposalCount(input.proposals, currentStart, currentEnd);
  const previousProposalCount = proposalCount(input.proposals, previousStart, previousEnd);
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

  const { withAppointment, withoutAppointment } = appointmentPeriodSegments(
    currentLeads,
    input.proposals,
    jobs,
    input.leads,
    currentStart,
    currentEnd,
  );
  const totalAcceptedJobs = withAppointment.acceptedJobs + withoutAppointment.acceptedJobs;

  const appointmentLift =
    withAppointment.acceptanceRate != null && withoutAppointment.acceptanceRate != null
      ? ratio(withAppointment.acceptanceRate, withoutAppointment.acceptanceRate)
      : null;

  return {
    asOf: input.asOf,
    currentPeriod: { start: currentStart, end: currentEnd },
    previousPeriod: { start: previousStart, end: previousEnd },
    monthly: monthlySeries(input, jobs, paidSocialLeadIds),
    activity: {
      metaSpendCents: comparison(currentSpend.cents, previousSpend.cents),
      leads: comparison(currentLeads.length, previousLeads.length),
      appointments: comparison(currentAppointmentCount, previousAppointmentCount),
      proposals: comparison(currentProposalCount, previousProposalCount),
      acceptedJobs: comparison(currentAccepted.count, previousAccepted.count),
      bookedSalesCents: comparison(
        currentAccepted.revenueCents,
        previousAccepted.revenueCents,
      ),
      paidSocialLeads: comparison(currentPaidSocialLeads, previousPaidSocialLeads),
      metaCostPerLeadCents:
        currentPaidSocialLeads > 0
          ? Math.round(currentSpend.cents / currentPaidSocialLeads)
          : null,
      appointmentSetRate: {
        current: ratio(currentAppointmentCount, currentLeads.length),
        previous: ratio(previousAppointmentCount, previousLeads.length),
      },
      proposalRate: {
        current: ratio(currentProposalCount, currentLeads.length),
        previous: ratio(previousProposalCount, previousLeads.length),
      },
      acceptedProposalRate: {
        current: ratio(currentAccepted.count, currentProposalCount),
        previous: ratio(previousAccepted.count, previousProposalCount),
      },
    },
    economics: {
      metaSpendCents: currentSpend.cents,
      metaSpendSource: currentSpend.source,
      acceptedJobs: currentAccepted.count,
      metaAcceptedJobs: currentMetaAcceptedJobs.length,
      metaBookedRevenueCents: currentMetaBookedRevenueCents,
      metaCacCents:
        currentMetaAcceptedJobs.length > 0
          ? Math.round(currentSpend.cents / currentMetaAcceptedJobs.length)
          : null,
      blendedCacCents:
        currentAccepted.count > 0
          ? Math.round(currentSpend.cents / currentAccepted.count)
          : null,
      bookedRoas: ratio(currentMetaBookedRevenueCents, currentSpend.cents),
    },
    appointments: {
      withAppointment,
      withoutAppointment,
      appointmentLift,
      acceptedWithoutAppointmentShare: ratio(
        withoutAppointment.acceptedJobs,
        totalAcceptedJobs,
      ),
    },
    freshness: {
      leads: latest(input.leads.map((row) => row.captured_at)),
      proposals: latest(input.proposals.map((row) => row.captured_at)),
      meta: latest(input.spend.map((row) => row.captured_at)),
      accounting: latest([
        ...input.jobs.map((row) => row.updated_at),
        ...(input.transactions ?? []).map((row) => row.updated_at),
      ]),
    },
  };
}
