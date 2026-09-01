import type {
  AppointmentPeriodSegment,
  BusinessPulse,
} from "@/lib/business-pulse-metrics";

type ConceptAppointmentSegment = Omit<AppointmentPeriodSegment, "acceptanceRate"> & {
  acceptanceRate: number | null;
};

export type MetricsConceptPulse = Omit<BusinessPulse, "appointments"> & {
  appointments: {
    withAppointment: ConceptAppointmentSegment;
    withoutAppointment: ConceptAppointmentSegment;
    appointmentLift: number | null;
    acceptedWithoutAppointmentShare: number | null;
    basis: BusinessPulse["appointments"]["basis"];
  };
};

function appointmentSegment(segment: AppointmentPeriodSegment): ConceptAppointmentSegment {
  return {
    ...segment,
    acceptanceRate:
      segment.acceptanceRate == null ? null : segment.acceptanceRate * 100,
  };
}

export function prepareMetricsConceptPulse(pulse: BusinessPulse): MetricsConceptPulse {
  return {
    ...pulse,
    appointments: {
      withAppointment: appointmentSegment(pulse.appointments.withAppointment),
      withoutAppointment: appointmentSegment(pulse.appointments.withoutAppointment),
      appointmentLift:
        pulse.appointments.appointmentLift == null
          ? null
          : pulse.appointments.appointmentLift * 100,
      acceptedWithoutAppointmentShare:
        pulse.appointments.acceptedWithoutAppointmentShare == null
          ? null
          : pulse.appointments.acceptedWithoutAppointmentShare * 100,
      basis: pulse.appointments.basis,
    },
  };
}
