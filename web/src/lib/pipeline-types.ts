import type { InvoiceSummary } from "@/lib/billing-types";

export type PipelineKey = "sales" | "jobs";

export const PIPELINE_TITLES: Record<PipelineKey, string> = {
  sales: "Sales Pipeline",
  jobs: "Jobs Pipeline",
};

/** What a column means for the deal or job in it: the status it is given. */
export const RECORD_STATUS_OPTIONS: Record<PipelineKey, [string, string][]> = {
  sales: [
    ["new", "New lead"],
    ["contacted", "Contacted"],
    ["estimate_scheduled", "Estimate scheduled"],
    ["estimated", "Proposal in draft"],
    ["proposal_sent", "Proposal sent"],
    ["lost", "Lost"],
  ],
  jobs: [
    ["scheduled", "Not started"],
    ["active", "In progress"],
    ["completed", "Finished"],
  ],
};

export type PipelineStage = {
  id: string;
  name: string;
  position: number;
  isClosed: boolean;
  recordStatus: string;
  dripsEnabled: boolean;
};

export type PipelineCardLabel = { id: string; name: string; color: string };

export type PipelineCard = {
  id: string;
  stageId: string;
  name: string;
  source: string | null;
  address: string | null;
  /** Estimate appointment for deals, scheduled start for jobs. */
  dateOn: string | null;
  valueCents: number | null;
  quoteId: string | null;
  quoteStatus: string | null;
  updatedAt: string;
  createdAt: string;
  /** When the card moved into its column, or was created there. */
  stageEnteredAt: string;
  /** Last sent message or note on the record (or a job's deal). */
  lastTouchAt: string | null;
  quoteSentAt: string | null;
  quoteViewedAt: string | null;
  salespersonId: string | null;
  salespersonName: string | null;
  projectManagerId: string | null;
  contactId: string | null;
  dripsPaused: boolean;
  /** Archived deals (DripJobs' cancelled) and jobs stay listed last in their column. */
  archived: boolean;
  labels: PipelineCardLabel[];
};

export type PipelineBoard = {
  pipeline: PipelineKey;
  /** archivedCount: the column's archived cards, which the board loads only
   * when an "Archived" is opened. */
  stages: (PipelineStage & { archivedCount: number })[];
  /** Open cards only. */
  cards: PipelineCard[];
};

/** What the deal page loads beside the deal overview: the job the deal
 * became (or the job itself), its invoices, and the project's documents. */
export type DealExtras = {
  job: { id: string; name: string; status: string; valueCents: number | null } | null;
  invoices: InvoiceSummary[];
  documents: { id: string; projectId: string; name: string; kind: "file" | "page"; createdAt: string }[];
};

/** The deal page's center tabs, in order; the key is the ?tab= value. */
export const DEAL_TABS = [
  ["communications", "Communications"],
  ["notes", "Notes"],
  ["proposals", "Proposals / Jobs"],
  ["invoices", "Invoices / Payments"],
  ["appointments", "Appointments"],
  ["attachments", "Attachments"],
] as const;

export type DealTab = (typeof DEAL_TABS)[number][0];

export function isDealTab(value: string | undefined): value is DealTab {
  return DEAL_TABS.some(([key]) => key === value);
}

export function isPipelineKey(value: string): value is PipelineKey {
  return value === "sales" || value === "jobs";
}
