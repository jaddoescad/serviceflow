import type {
  AppointmentPeriodSegment,
  BusinessPulse,
  MetricComparison,
} from "@/lib/business-pulse-metrics";

type CompleteComparison = Omit<MetricComparison, "percentChange"> & {
  percentChange: number;
};

type ConceptAppointmentSegment = Omit<AppointmentPeriodSegment, "acceptanceRate"> & {
  acceptanceRate: number;
};

export type MetricsConceptPulse = Omit<
  BusinessPulse,
  "activity" | "economics" | "appointments"
> & {
  activity: Omit<BusinessPulse["activity"],
    | "metaSpendCents"
    | "leads"
    | "appointments"
    | "proposals"
    | "acceptedJobs"
    | "bookedSalesCents"
    | "salesCents"
    | "setRateContacts"
    | "setRateBookedContacts"
    | "paidSocialLeads"
    | "metaCostPerLeadCents"
  > & {
    metaSpendCents: CompleteComparison;
    leads: CompleteComparison;
    appointments: CompleteComparison;
    proposals: CompleteComparison;
    acceptedJobs: CompleteComparison;
    bookedSalesCents: CompleteComparison;
    salesCents: CompleteComparison;
    setRateContacts: CompleteComparison;
    setRateBookedContacts: CompleteComparison;
    paidSocialLeads: CompleteComparison;
    metaCostPerLeadCents: CompleteComparison;
  };
  economics: Omit<BusinessPulse["economics"], "metaCacCents" | "blendedCacCents" | "bookedRoas"> & {
    metaCacCents: number;
    blendedCacCents: number;
    bookedRoas: number;
  };
  appointments: {
    withAppointment: ConceptAppointmentSegment;
    withoutAppointment: ConceptAppointmentSegment;
    appointmentLift: number;
    acceptedWithoutAppointmentShare: number;
  };
};

function complete(comparison: MetricComparison): CompleteComparison {
  return { ...comparison, percentChange: comparison.percentChange ?? 0 };
}

function appointmentSegment(segment: AppointmentPeriodSegment): ConceptAppointmentSegment {
  return {
    ...segment,
    acceptanceRate: (segment.acceptanceRate ?? 0) * 100,
  };
}

export function prepareMetricsConceptPulse(pulse: BusinessPulse): MetricsConceptPulse {
  const costPerLead = pulse.activity.metaCostPerLeadCents ?? 0;
  const withRate = pulse.appointments.withAppointment.acceptanceRate ?? 0;
  const withoutRate = pulse.appointments.withoutAppointment.acceptanceRate ?? 0;

  return {
    ...pulse,
    activity: {
      ...pulse.activity,
      metaSpendCents: complete(pulse.activity.metaSpendCents),
      leads: complete(pulse.activity.leads),
      appointments: complete(pulse.activity.appointments),
      proposals: complete(pulse.activity.proposals),
      acceptedJobs: complete(pulse.activity.acceptedJobs),
      bookedSalesCents: complete(pulse.activity.bookedSalesCents),
      salesCents: complete(pulse.activity.salesCents),
      setRateContacts: complete(pulse.activity.setRateContacts),
      setRateBookedContacts: complete(pulse.activity.setRateBookedContacts),
      paidSocialLeads: complete(pulse.activity.paidSocialLeads),
      metaCostPerLeadCents: {
        current: costPerLead,
        previous: costPerLead,
        change: 0,
        percentChange: 0,
      },
    },
    economics: {
      ...pulse.economics,
      metaCacCents: pulse.economics.metaCacCents ?? 0,
      blendedCacCents: pulse.economics.blendedCacCents ?? 0,
      bookedRoas: pulse.economics.bookedRoas ?? 0,
    },
    appointments: {
      withAppointment: appointmentSegment(pulse.appointments.withAppointment),
      withoutAppointment: appointmentSegment(pulse.appointments.withoutAppointment),
      appointmentLift: (withRate - withoutRate) * 100,
      acceptedWithoutAppointmentShare: pulse.appointments.acceptedWithoutAppointmentShare ?? 0,
    },
  };
}
