import type { TagTone } from "@/components/ui";

// Appointment workflows: the board of things that could become a booked
// estimate, and the AI's suggestion for each (see the migration
// appointment_workflows and lib/actions/workflows.ts).

export type WorkflowStage = "new" | "waiting" | "needs_you" | "booked" | "closed";
export type WorkflowKind = "lead" | "missed_call" | "voicemail" | "call" | "text";
export type SuggestionAction = "text" | "book" | "needs_you" | "close";

export const WORKFLOW_STAGES: { id: WorkflowStage; name: string; tone: TagTone }[] = [
  { id: "new", name: "New", tone: "blue" },
  { id: "waiting", name: "Waiting on them", tone: "gray" },
  { id: "needs_you", name: "Needs you", tone: "yellow" },
  { id: "booked", name: "Booked", tone: "green" },
  { id: "closed", name: "Closed", tone: "gray" },
];

export const WORKFLOW_KINDS: Record<WorkflowKind, string> = {
  lead: "Lead",
  missed_call: "Missed call",
  voicemail: "Voicemail",
  call: "Call",
  text: "Text",
};

/** An open time someone with a connected calendar could do. */
export type WorkflowTime = {
  id: string;
  personId: string;
  person: string;
  startsAt: string;
  label: string;
  near: string | null;
};

export type WorkflowLeadFields = {
  name: string | null;
  address: string | null;
  email: string | null;
  request: string | null;
};

export type WorkflowSuggestion = {
  action: SuggestionAction;
  summary: string;
  reason: string;
  message: string;
  /** The times the message offers. */
  times: WorkflowTime[];
  /** The time to book, for "book". */
  book: WorkflowTime | null;
  lead: WorkflowLeadFields;
  /** Every open time it looked at, to book another instead. */
  options: WorkflowTime[];
  /** Why there were no times to offer. */
  noTimes: string | null;
};

export type WorkflowCardSummary = {
  id: string;
  stage: WorkflowStage;
  kind: WorkflowKind;
  leadId: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  source: string | null;
  reason: string | null;
  activityAt: string;
  suggestion: { action: SuggestionAction; summary: string } | null;
  latest: string | null;
  appointment: { startsAt: string; with: string | null } | null;
};

export type WorkflowPerson = {
  id: string;
  name: string;
  calendar: string | null;
  connected: boolean;
  calendarError: boolean | null;
};

export type WorkflowSkill = { title: string; prompt: string };

export type WorkflowSettings = {
  prompt: string;
  skills: WorkflowSkill[];
  minutes: number;
  people: WorkflowPerson[];
};

export type WorkflowMessage = {
  direction: "inbound" | "outbound";
  channel: string;
  text: string | null;
  at: string;
};

export type WorkflowCardDetail = {
  id: string;
  stage: WorkflowStage;
  kind: WorkflowKind;
  reason: string | null;
  leadId: string | null;
  conversationId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  source: string | null;
  leadStatus: string | null;
  optedOut: boolean;
  timezone: string;
  now: string;
  notes: string[];
  messages: WorkflowMessage[];
  appointments: { startsAt: string; with: string | null }[];
  settings: { prompt: string; skills: WorkflowSkill[]; minutes: number };
  people: WorkflowPerson[];
  suggestion: WorkflowSuggestion | null;
  suggestedAt: string | null;
};
