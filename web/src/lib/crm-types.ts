import type { InvoiceSummary } from "@/lib/billing-types";
import type { MessageChannel } from "@/lib/messaging-types";

export type TeamOption = { id: string; name: string };

export type DealOverview = {
  id: string;
  kind: "lead" | "job";
  leadId: string | null;
  name: string;
  source: string | null;
  address: string | null;
  createdAt: string;
  valueCents: number | null;
  contact: { id: string | null; name: string | null; email: string | null; phone: string | null };
  stage: { id: string; name: string; pipeline: "sales" | "jobs" } | null;
  stages: { id: string; name: string }[];
  settings: { salespersonId: string | null; projectManagerId: string | null; dripsPaused: boolean };
  notes: { id: string; body: string; createdAt: string; authorName: string | null }[];
  messages: {
    id: string;
    channel: MessageChannel;
    subject: string | null;
    body: string;
    status: string;
    error: string | null;
    at: string;
    isDrip: boolean;
  }[];
  proposals: { id: string; name: string; status: string; amountCents: number; sentAt: string | null }[];
  appointments: { id: string; title: string; startsAt: string; status: string; assigneeName: string | null }[];
  invoices: InvoiceSummary[];
  team: TeamOption[];
};

export type ScheduledJob = {
  id: string;
  name: string;
  address: string | null;
  startOn: string;
  endOn: string;
  status: string;
  valueCents: number;
  stageName: string | null;
  /** Daily hours, "HH:MM"; both or neither. */
  startTime: string | null;
  endTime: string | null;
  crewId: string | null;
  crewName: string | null;
  crewColor: CrewColor | null;
  /** Assigned people, the crew lead first. */
  crew: TeamOption[];
};

/** Crew colours are tag tints. */
export type CrewColor = "blue" | "green" | "orange" | "purple" | "yellow" | "red" | "gray";

export type CrewOption = { id: string; name: string; color: CrewColor };

export type PendingJob = {
  id: string;
  name: string;
  proposalName: string | null;
  valueCents: number;
  acceptedAt: string;
  /** Kept when a job is unscheduled. */
  crewId: string | null;
};

export type JobSchedule = { jobs: ScheduledJob[]; pending: PendingJob[]; crew: TeamOption[]; crews: CrewOption[] };

export type SalesMetrics = {
  salesCents: number;
  jobsWon: number;
  proposalsSent: number;
  leads: number;
  booked: number;
  appointments: number;
  bySource: { source: string; leads: number; booked: number; jobsWon: number; salesCents: number }[];
};

export type ReportKind = "leads" | "closed_deals" | "sales" | "production" | "proposals_sent";

export const REPORT_LABELS: Record<ReportKind, string> = {
  leads: "Leads",
  closed_deals: "Closed Deals",
  sales: "Sales",
  production: "Production",
  proposals_sent: "Total Proposals Sent",
};

/** Column order for each report; the database returns rows as unordered objects. */
export const REPORT_COLUMNS: Record<ReportKind, string[]> = {
  leads: ["Date", "Customer", "Email", "Phone", "Source", "Status", "Stage"],
  closed_deals: ["Date", "Customer", "Proposal", "Amount", "Source"],
  sales: ["Source", "Jobs won", "Sales", "Average job"],
  production: ["Completed", "Job", "Started", "Amount"],
  proposals_sent: ["Sent", "Customer", "Proposal", "Status", "Amount"],
};

export type JobCost = {
  id: string;
  name: string;
  status: string;
  stageName: string | null;
  startedOn: string | null;
  completedOn: string | null;
  revenueCents: number;
  invoicedCents: number;
  paidCents: number;
  hours: number;
  labourCents: number;
  unpricedHours: number;
};
