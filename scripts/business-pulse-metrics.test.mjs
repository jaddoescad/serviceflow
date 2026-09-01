import assert from "node:assert/strict";
import test from "node:test";
import { buildBusinessPulse } from "../src/lib/business-pulse-metrics.ts";

const capturedAt = "2026-08-20T14:00:00Z";

function lead({
  row,
  id,
  created,
  appointment = null,
  channel = "website",
  eligible = true,
}) {
  return {
    source_document_id: "00000000-0000-0000-0000-000000000001",
    source_row_number: row,
    lead_id: id,
    created_on: created,
    appointment_on: appointment,
    normalized_channel: channel,
    marketing_eligible: eligible,
    captured_at: capturedAt,
  };
}

function proposal(row, key, sent, leadId = null, isAccepted = false) {
  return {
    source_document_id: "00000000-0000-0000-0000-000000000002",
    source_row_number: row,
    proposal_key: key,
    lead_id: leadId,
    first_sent_on: sent,
    is_accepted: isAccepted,
    captured_at: capturedAt,
  };
}

function spend(id, date, spendCents, overrides = {}) {
  return {
    id,
    platform: "meta",
    grain: "daily",
    period_start: date,
    entity_level: "campaign",
    purpose: "customer_acquisition",
    currency: "CAD",
    spend_cents: spendCents,
    captured_at: capturedAt,
    ...overrides,
  };
}

function transaction(id, date, amountCents, category, overrides = {}) {
  return {
    id,
    posted_on: date,
    description: "Bank transaction",
    counterparty: null,
    amount_cents: amountCents,
    category,
    is_transfer: false,
    review_status: "reconciled",
    updated_at: capturedAt,
    ...overrides,
  };
}

function acceptedJob(id, leadId, quoteId, amountCents, status = "active") {
  return {
    job: {
      id,
      lead_id: leadId,
      accepted_quote_id: quoteId,
      status,
      contract_amount_cents: amountCents,
      updated_at: capturedAt,
    },
    quote: { id: quoteId, lead_id: leadId, accepted_at: null },
  };
}

test("buildBusinessPulse uses same-period spend and accepted jobs for monthly CAC", () => {
  const current = acceptedJob("job-current", "current-paid", "quote-current", 1_130_000);
  current.quote.accepted_at = "2026-08-05T16:00:00Z";
  const prior = acceptedJob("job-prior", "prior-paid", "quote-prior", 500_000);
  prior.quote.accepted_at = "2026-07-05T16:00:00Z";
  const cohortMetaWithAppointment = acceptedJob("job-c1", "cohort-1", "quote-c1", 2_000_000);
  cohortMetaWithAppointment.quote.accepted_at = "2026-07-10T16:00:00Z";
  const cohortMetaWithoutAppointment = acceptedJob("job-c2", "cohort-2", "quote-c2", 1_000_000);
  cohortMetaWithoutAppointment.quote.accepted_at = "2026-08-01T16:00:00Z";
  const cohortWebsiteWithAppointment = acceptedJob("job-c3", "cohort-3", "quote-c3", 1_500_000);
  cohortWebsiteWithAppointment.quote.accepted_at = "2026-07-01T16:00:00Z";
  const secondJobForSameMetaCustomer = acceptedJob("job-c1-second", "cohort-1", "quote-c1-second", 500_000);
  secondJobForSameMetaCustomer.quote.accepted_at = "2026-08-10T16:00:00Z";
  const cancelled = acceptedJob("job-cancelled", "cohort-4", "quote-cancelled", 9_999_999, "cancelled");
  cancelled.quote.accepted_at = "2026-07-02T16:00:00Z";

  const accepted = [
    current,
    prior,
    cohortMetaWithAppointment,
    cohortMetaWithoutAppointment,
    cohortWebsiteWithAppointment,
    secondJobForSameMetaCustomer,
    cancelled,
  ];

  const pulse = buildBusinessPulse({
    asOf: "2026-08-20",
    leads: [
      lead({ row: 2, id: "current-paid", created: "2026-08-03", appointment: "2026-08-04", channel: "paid_social" }),
      lead({ row: 3, id: "current-web", created: "2026-08-08" }),
      lead({ row: 4, id: "test", created: "2026-08-09", eligible: false }),
      lead({ row: 5, id: "prior-paid", created: "2026-07-03", appointment: "2026-07-04", channel: "paid_social" }),
      lead({ row: 6, id: "prior-web", created: "2026-07-12" }),
      lead({ row: 7, id: "cohort-1", created: "2026-03-24", appointment: "2026-04-02", channel: "paid_social" }),
      lead({ row: 8, id: "cohort-2", created: "2026-04-15", channel: "paid_social" }),
      lead({ row: 9, id: "cohort-3", created: "2026-05-20", appointment: "2026-06-01" }),
      lead({ row: 10, id: "cohort-4", created: "2026-06-21", channel: "organic_social" }),
    ],
    proposals: [
      proposal(2, "current-1", "2026-08-06", "current-paid", true),
      proposal(3, "current-2", "2026-08-12", "current-web"),
      proposal(4, "prior-1", "2026-07-10", "prior-paid", true),
    ],
    spend: [
      spend("spend-current", "2026-08-04", 10_000),
      spend("spend-prior", "2026-07-04", 8_000),
      spend("spend-cohort", "2026-04-04", 30_000),
      spend("spend-recruiting", "2026-08-04", 99_999, { purpose: "recruiting" }),
      spend("spend-usd", "2026-08-04", 99_999, { currency: "USD" }),
    ],
    jobs: accepted.map((item) => item.job),
    quotes: accepted.map((item) => item.quote),
  });

  assert.deepEqual(pulse.currentPeriod, { start: "2026-08-01", end: "2026-08-20" });
  assert.deepEqual(pulse.previousPeriod, { start: "2026-07-01", end: "2026-07-20" });
  assert.equal(pulse.activity.metaSpendCents.current, 10_000);
  assert.equal(pulse.activity.metaSpendCents.previous, 8_000);
  assert.equal(pulse.activity.leads.current, 2);
  assert.equal(pulse.activity.leads.previous, 2);
  assert.equal(pulse.activity.appointments.current, 1);
  assert.equal(pulse.activity.proposals.current, 2);
  assert.equal(pulse.activity.proposals.previous, 1);
  assert.deepEqual(pulse.activity.acceptedProposals, {
    current: 1,
    previous: 1,
    change: 0,
    percentChange: 0,
  });
  assert.deepEqual(pulse.activity.jobsWon, pulse.activity.acceptedJobs);
  assert.equal(pulse.activity.closingBasis, "imported_first_send_cohort");
  assert.equal(pulse.activity.acceptedJobs.current, 3);
  assert.equal(pulse.activity.acceptedJobs.previous, 3);
  assert.equal(pulse.activity.bookedSalesCents.current, 2_630_000);
  assert.equal(pulse.activity.bookedSalesCents.previous, 4_000_000);
  assert.equal(pulse.activity.metaCostPerLeadCents, 10_000);
  assert.deepEqual(pulse.activity.appointmentSetRate, { current: 0.5, previous: 0.5 });
  assert.equal(pulse.activity.setRateBasis, "lead_report_contact_cohort");
  assert.deepEqual(pulse.activity.setRateBookedContacts, pulse.activity.appointments);
  assert.deepEqual(pulse.activity.setRateContacts, pulse.activity.leads);
  assert.deepEqual(pulse.activity.proposalRate, { current: 1, previous: 0.5 });
  assert.deepEqual(pulse.activity.acceptedProposalRate, { current: 0.5, previous: 1 });

  assert.equal(pulse.economics.metaSpendCents, 10_000);
  assert.equal(pulse.economics.acceptedJobs, 3);
  assert.equal(pulse.economics.metaAcceptedJobs, 3);
  assert.equal(pulse.economics.metaBookedRevenueCents, 2_630_000);
  assert.equal(pulse.economics.metaCacCents, 3_333);
  assert.equal(pulse.economics.blendedCacCents, 3_333);
  assert.equal(pulse.economics.bookedRoas, 2_630_000 / 10_000);

  assert.deepEqual(pulse.appointments.withAppointment, {
    leads: 1,
    proposals: 1,
    acceptedJobs: 2,
    acceptanceRate: 2,
    bookedRevenueCents: 1_630_000,
  });
  assert.deepEqual(pulse.appointments.withoutAppointment, {
    leads: 1,
    proposals: 1,
    acceptedJobs: 1,
    acceptanceRate: 1,
    bookedRevenueCents: 1_000_000,
  });
  assert.equal(pulse.appointments.appointmentLift, 2);
  assert.equal(pulse.appointments.acceptedWithoutAppointmentShare, 1 / 3);

});

test("month-to-date comparison clamps safely when the prior month is shorter", () => {
  const pulse = buildBusinessPulse({
    asOf: "2026-03-31",
    leads: [],
    proposals: [],
    spend: [],
    jobs: [],
    quotes: [],
  });

  assert.deepEqual(pulse.previousPeriod, { start: "2026-02-01", end: "2026-02-28" });
});

test("exact DripJobs Sales snapshots replace the headline revenue comparison", () => {
  const pulse = buildBusinessPulse({
    asOf: "2026-09-01",
    period: {
      current: { start: "2026-08-01", end: "2026-08-31" },
      previous: { start: "2026-07-01", end: "2026-07-31" },
    },
    leads: [],
    proposals: [],
    spend: [],
    jobs: [],
    quotes: [],
    salesReports: [
      { period_start: "2026-07-01", period_end: "2026-07-31", sales_count: 15, gross_sales_cents: 4_162_632, captured_at: capturedAt },
      { period_start: "2026-08-01", period_end: "2026-08-31", sales_count: 18, gross_sales_cents: 6_351_084, captured_at: capturedAt },
    ],
  });

  assert.equal(pulse.activity.salesBasis, "dripjobs_gross_sales");
  assert.deepEqual(pulse.activity.salesCents, {
    current: 6_351_084,
    previous: 4_162_632,
    change: 2_188_452,
    percentChange: (2_188_452 / 4_162_632) * 100,
  });
  assert.deepEqual(pulse.activity.bookedSalesCents, {
    current: 0,
    previous: 0,
    change: 0,
    percentChange: 0,
  });
});

test("headline revenue falls back consistently when either DripJobs period is missing", () => {
  const pulse = buildBusinessPulse({
    asOf: "2026-09-01",
    period: {
      current: { start: "2026-08-01", end: "2026-08-31" },
      previous: { start: "2026-07-01", end: "2026-07-31" },
    },
    leads: [],
    proposals: [],
    spend: [],
    jobs: [],
    quotes: [],
    salesReports: [
      { period_start: "2026-08-01", period_end: "2026-08-31", sales_count: 18, gross_sales_cents: 6_351_084, captured_at: capturedAt },
    ],
  });

  assert.equal(pulse.activity.salesBasis, "accepted_contracts_pre_hst");
  assert.deepEqual(pulse.activity.salesCents, pulse.activity.bookedSalesCents);
});

test("exact DripJobs set-rate snapshots replace mixed-date appointment activity", () => {
  const pulse = buildBusinessPulse({
    asOf: "2026-09-01",
    period: {
      current: { start: "2026-08-01", end: "2026-08-31" },
      previous: { start: "2026-07-01", end: "2026-07-31" },
    },
    leads: [
      lead({ row: 40, id: "old-contact", created: "2026-07-15", appointment: "2026-08-10" }),
    ],
    proposals: [],
    spend: [],
    jobs: [],
    quotes: [],
    setRateReports: [
      { period_start: "2026-07-01", period_end: "2026-07-31", contacts_created_count: 104, booked_contacts_count: 30, captured_at: capturedAt },
      { period_start: "2026-08-01", period_end: "2026-08-31", contacts_created_count: 132, booked_contacts_count: 33, captured_at: capturedAt },
    ],
  });

  assert.equal(pulse.activity.setRateBasis, "dripjobs_contact_cohort");
  assert.deepEqual(pulse.activity.setRateContacts, {
    current: 132,
    previous: 104,
    change: 28,
    percentChange: (28 / 104) * 100,
  });
  assert.deepEqual(pulse.activity.setRateBookedContacts, {
    current: 33,
    previous: 30,
    change: 3,
    percentChange: 10,
  });
  assert.deepEqual(pulse.activity.appointmentSetRate, {
    current: 0.25,
    previous: 30 / 104,
  });
  assert.equal(pulse.activity.appointments.current, 1);
  assert.equal(pulse.monthly.find((point) => point.month === "2026-08").setRate, 0.25);
  assert.equal(
    pulse.monthly.find((point) => point.month === "2026-08").setRateBasis,
    "dripjobs_contact_cohort",
  );
});

test("exact DripJobs closing snapshots keep qualified, accepted, and Jobs Won cohorts separate", () => {
  const julyAccepted = acceptedJob("local-july", "july-lead", "local-july-quote", 500_000);
  julyAccepted.quote.accepted_at = "2026-07-15T16:00:00Z";
  const augustAccepted = acceptedJob("local-august", "august-lead", "local-august-quote", 700_000);
  augustAccepted.quote.accepted_at = "2026-08-15T16:00:00Z";

  const pulse = buildBusinessPulse({
    asOf: "2026-09-01",
    period: {
      current: { start: "2026-08-01", end: "2026-08-31" },
      previous: { start: "2026-07-01", end: "2026-07-31" },
    },
    leads: [],
    proposals: [],
    spend: [],
    jobs: [julyAccepted.job, augustAccepted.job],
    quotes: [julyAccepted.quote, augustAccepted.quote],
    setRateReports: [
      { period_start: "2026-07-01", period_end: "2026-07-31", contacts_created_count: 104, booked_contacts_count: 30, captured_at: capturedAt },
      { period_start: "2026-08-01", period_end: "2026-08-31", contacts_created_count: 132, booked_contacts_count: 33, captured_at: capturedAt },
    ],
    closingReports: [
      { period_start: "2026-07-01", period_end: "2026-07-31", qualified_proposals_count: 54, accepted_proposals_count: 12, jobs_won_count: 15, captured_at: capturedAt },
      { period_start: "2026-08-01", period_end: "2026-08-31", qualified_proposals_count: 75, accepted_proposals_count: 13, jobs_won_count: 18, captured_at: capturedAt },
    ],
  });

  assert.equal(pulse.activity.closingBasis, "dripjobs_qualified_proposal_cohort");
  assert.deepEqual(pulse.activity.proposals, {
    current: 75,
    previous: 54,
    change: 21,
    percentChange: (21 / 54) * 100,
  });
  assert.deepEqual(pulse.activity.acceptedProposals, {
    current: 13,
    previous: 12,
    change: 1,
    percentChange: (1 / 12) * 100,
  });
  assert.deepEqual(pulse.activity.jobsWon, {
    current: 18,
    previous: 15,
    change: 3,
    percentChange: 20,
  });
  assert.deepEqual(pulse.activity.acceptedJobs, {
    current: 1,
    previous: 1,
    change: 0,
    percentChange: 0,
  });
  assert.deepEqual(pulse.activity.proposalRate, {
    current: 75 / 132,
    previous: 54 / 104,
  });
  assert.deepEqual(pulse.activity.acceptedProposalRate, {
    current: 13 / 75,
    previous: 12 / 54,
  });
  assert.equal(pulse.monthly.find((point) => point.month === "2026-08").acceptedProposals, 13);
  assert.equal(pulse.monthly.find((point) => point.month === "2026-08").jobsWon, 18);
  assert.equal(
    pulse.monthly.find((point) => point.month === "2026-08").closingBasis,
    "dripjobs_qualified_proposal_cohort",
  );
  assert.equal(pulse.freshness.closing, capturedAt);
});

test("set rate falls back consistently when either DripJobs cohort is missing", () => {
  const pulse = buildBusinessPulse({
    asOf: "2026-09-01",
    period: {
      current: { start: "2026-08-01", end: "2026-08-31" },
      previous: { start: "2026-07-01", end: "2026-07-31" },
    },
    leads: [
      lead({ row: 41, id: "august-booked-later", created: "2026-08-05", appointment: "2026-09-06" }),
      lead({ row: 42, id: "august-not-booked", created: "2026-08-07" }),
      lead({ row: 43, id: "july-booked-in-august", created: "2026-07-05", appointment: "2026-08-08" }),
    ],
    proposals: [],
    spend: [],
    jobs: [],
    quotes: [],
    setRateReports: [
      { period_start: "2026-08-01", period_end: "2026-08-31", contacts_created_count: 132, booked_contacts_count: 33, captured_at: capturedAt },
    ],
  });

  assert.equal(pulse.activity.setRateBasis, "lead_report_contact_cohort");
  assert.deepEqual(pulse.activity.setRateContacts, pulse.activity.leads);
  assert.deepEqual(pulse.activity.setRateBookedContacts, {
    current: 1,
    previous: 1,
    change: 0,
    percentChange: 0,
  });
  assert.deepEqual(pulse.activity.appointmentSetRate, { current: 0.5, previous: 1 });
  assert.equal(pulse.activity.appointments.current, 1);
});

test("an explicit selected period drives every current and comparison metric", () => {
  const pulse = buildBusinessPulse({
    asOf: "2026-08-20",
    period: {
      current: { start: "2026-07-01", end: "2026-07-31" },
      previous: { start: "2026-06-01", end: "2026-06-30" },
    },
    leads: [
      lead({ row: 20, id: "july", created: "2026-07-12", appointment: "2026-07-13" }),
      lead({ row: 21, id: "june", created: "2026-06-12" }),
    ],
    proposals: [
      proposal(20, "july-proposal", "2026-07-14", "july"),
      proposal(21, "june-proposal", "2026-06-14", "june"),
    ],
    spend: [spend("july-spend", "2026-07-10", 20_000), spend("june-spend", "2026-06-10", 10_000)],
    jobs: [],
    quotes: [],
  });

  assert.deepEqual(pulse.currentPeriod, { start: "2026-07-01", end: "2026-07-31" });
  assert.deepEqual(pulse.previousPeriod, { start: "2026-06-01", end: "2026-06-30" });
  assert.equal(pulse.activity.leads.current, 1);
  assert.equal(pulse.activity.leads.previous, 1);
  assert.equal(pulse.activity.proposals.current, 1);
  assert.equal(pulse.activity.metaSpendCents.current, 20_000);
  assert.equal(pulse.activity.metaSpendCents.previous, 10_000);
  assert.equal(pulse.monthly.length, 8);
  assert.equal(pulse.monthly[0].month, "2026-01");
  assert.deepEqual(
    pulse.monthly.find((point) => point.month === "2026-07"),
    {
      month: "2026-07",
      start: "2026-07-01",
      end: "2026-07-31",
      isPartial: false,
      leads: 1,
      appointments: 1,
      proposals: 1,
      acceptedProposals: 0,
      jobsWon: 0,
      acceptedJobs: 0,
      paidSocialLeads: 0,
      metaAcceptedJobs: 0,
      metaCohortLeads: 0,
      metaCohortAppointments: 0,
      metaCohortProposals: 0,
      metaCohortAcceptedJobs: 0,
      metaCohortBookedRevenueCents: 0,
      isMetaCohortMature: false,
      bookedSalesCents: 0,
      cashCollectedCents: 0,
      metaBookedRevenueCents: 0,
      metaSpendCents: 20_000,
      metaSpendSource: "meta_api",
      metaCostPerLeadCents: null,
      metaCacCents: null,
      blendedCacCents: null,
      bookedRoas: 0,
      setRate: 1,
      setRateContacts: 1,
      setRateBookedContacts: 1,
      setRateBasis: "lead_report_contact_cohort",
      proposalRate: 1,
      acceptedRate: 0,
      closingBasis: "imported_first_send_cohort",
    },
  );
  assert.deepEqual(pulse.monthly.at(-1), {
    month: "2026-08",
    start: "2026-08-01",
    end: "2026-08-20",
    isPartial: true,
    leads: 0,
    appointments: 0,
    proposals: 0,
    acceptedProposals: 0,
    jobsWon: 0,
    acceptedJobs: 0,
    paidSocialLeads: 0,
    metaAcceptedJobs: 0,
    metaCohortLeads: 0,
    metaCohortAppointments: 0,
    metaCohortProposals: 0,
    metaCohortAcceptedJobs: 0,
    metaCohortBookedRevenueCents: 0,
    isMetaCohortMature: false,
    bookedSalesCents: 0,
    cashCollectedCents: 0,
    metaBookedRevenueCents: 0,
    metaSpendCents: 0,
    metaSpendSource: "meta_api",
    metaCostPerLeadCents: null,
    metaCacCents: null,
    blendedCacCents: null,
    bookedRoas: null,
    setRate: null,
    setRateContacts: 0,
    setRateBookedContacts: 0,
    setRateBasis: "lead_report_contact_cohort",
    proposalRate: null,
    acceptedRate: null,
    closingBasis: "imported_first_send_cohort",
  });
});

test("bank rows fill Meta history before API coverage and supply customer cash", () => {
  const pulse = buildBusinessPulse({
    asOf: "2026-08-20",
    period: {
      current: { start: "2026-01-01", end: "2026-01-31" },
      previous: { start: "2025-12-01", end: "2025-12-31" },
    },
    leads: [],
    proposals: [],
    spend: [spend("api-start", "2026-05-18", 20_000)],
    jobs: [],
    quotes: [],
    transactions: [
      transaction("jan-meta", "2026-01-15", -10_000, "Advertising & marketing", {
        description: "FACEBK *TEST",
        counterparty: "Meta Ads",
      }),
      transaction("jan-cash", "2026-01-20", 113_000, "Painting revenue"),
      transaction("may-meta", "2026-05-10", -5_000, "Advertising & marketing", {
        description: "FACEBK *OLD",
        counterparty: "Meta Ads",
      }),
      transaction("ignored-transfer", "2026-01-21", -99_999, "Advertising & marketing", {
        description: "FACEBK *TRANSFER",
        counterparty: "Meta Ads",
        is_transfer: true,
      }),
      transaction("ignored-vendor", "2026-01-22", -99_999, "Advertising & marketing", {
        description: "Search ads",
        counterparty: "Another platform",
      }),
    ],
  });

  assert.equal(pulse.activity.metaSpendCents.current, 10_000);
  assert.equal(pulse.economics.metaSpendSource, "bank");
  const january = pulse.monthly.find((point) => point.month === "2026-01");
  assert.equal(january.metaSpendCents, 10_000);
  assert.equal(january.metaSpendSource, "bank");
  assert.equal(january.cashCollectedCents, 113_000);
  const may = pulse.monthly.find((point) => point.month === "2026-05");
  assert.equal(may.metaSpendCents, 25_000);
  assert.equal(may.metaSpendSource, "bank_and_meta_api");
  assert.equal(pulse.monthly.some((point) => point.month === "2026-09"), false);
});

test("Meta cohort outcomes credit later appointments and wins to lead creation month", () => {
  const won = acceptedJob("cohort-job", "meta-march", "cohort-quote", 900_000);
  won.quote.accepted_at = "2026-05-12T16:00:00Z";
  const pulse = buildBusinessPulse({
    asOf: "2026-08-20",
    leads: [
      lead({
        row: 30,
        id: "meta-march",
        created: "2026-03-10",
        appointment: "2026-04-02",
        channel: "paid_social",
      }),
    ],
    proposals: [proposal(30, "meta-proposal", "2026-04-04", "meta-march")],
    spend: [spend("march-spend", "2026-03-10", 50_000)],
    jobs: [won.job],
    quotes: [won.quote],
  });

  const march = pulse.monthly.find((point) => point.month === "2026-03");
  assert.equal(march.metaCohortLeads, 1);
  assert.equal(march.metaCohortAppointments, 1);
  assert.equal(march.metaCohortProposals, 1);
  assert.equal(march.metaCohortAcceptedJobs, 1);
  assert.equal(march.metaCohortBookedRevenueCents, 900_000);
  assert.equal(march.isMetaCohortMature, true);
  assert.equal(pulse.monthly.find((point) => point.month === "2026-08").isMetaCohortMature, false);
});
