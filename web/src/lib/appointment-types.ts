export type AppointmentStatus = "scheduled" | "completed" | "cancelled";

export type AppointmentKind = "estimate" | "walkthrough" | "punch_out" | "quality_control" | "other";

export const APPOINTMENT_KINDS: { id: AppointmentKind; name: string }[] = [
  { id: "estimate", name: "Estimate" },
  { id: "walkthrough", name: "Walkthrough" },
  { id: "punch_out", name: "Punch-out" },
  { id: "quality_control", name: "Quality control" },
  { id: "other", name: "Other" },
];

export const isAppointmentKind = (value: string | undefined): value is AppointmentKind =>
  APPOINTMENT_KINDS.some((kind) => kind.id === value);

export const appointmentKindLabel = (kind: AppointmentKind) =>
  APPOINTMENT_KINDS.find((item) => item.id === kind)?.name ?? "Other";

export type Appointment = {
  id: string;
  projectId: string;
  projectName: string | null;
  projectAddress: string | null;
  title: string;
  kind: AppointmentKind;
  startsAt: string;
  endsAt: string;
  assignedTo: string | null;
  assigneeName: string | null;
  location: string | null;
  notes: string | null;
  status: AppointmentStatus;
};

export type TeamMember = { id: string; name: string };
