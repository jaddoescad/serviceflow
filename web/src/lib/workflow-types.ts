import type { TagTone } from "@/components/ui";
import type { DrawnDay } from "@/lib/booking-types";

// Appointment workflows: the board of things that could become a booked
// estimate, and the AI's suggestion for each (see the migration
// appointment_workflows and lib/actions/workflows.ts).

export type WorkflowStage = "communication" | "new" | "waiting" | "needs_you" | "booked" | "closed";
export type WorkflowKind = "lead" | "missed_call" | "voicemail" | "call" | "text" | "email";
export type SuggestionAction = "text" | "book" | "wait" | "needs_you" | "close";

export const WORKFLOW_STAGES: { id: WorkflowStage; name: string; tone: TagTone }[] = [
  // Everything that comes in; the AI moves what can be booked to New.
  { id: "communication", name: "Communication", tone: "purple" },
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
  email: "Email",
};

/** An open time someone with a connected calendar could do. */
export type WorkflowTime = {
  id: string;
  personId: string;
  person: string;
  startsAt: string;
  label: string;
  near: string | null;
  /** When we texted them this exact time, if we did. */
  offeredAt?: string | null;
};

/** A time an approved text offered them. */
export type WorkflowOfferedTime = { personId: string; person: string | null; startsAt: string; sentAt: string };

/** Everything this person has done with us, across all their deals. */
export type WorkflowHistory = {
  deals: { id: string; status: string; createdAt: string; address: string | null; thisCard: boolean }[];
  proposals: {
    dealId: string;
    name: string | null;
    status: string;
    amountCents: number | null;
    sentAt: string | null;
    acceptedAt: string | null;
    declinedAt: string | null;
  }[];
  jobs: {
    id: string;
    name: string | null;
    status: string;
    amountCents: number | null;
    scheduledOn: string | null;
    completedOn: string | null;
    address: string | null;
  }[];
  pastVisits: { startsAt: string; status: string }[];
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
  /** The text to send; each offered time is a {{t1}}-style placeholder for one of `times`. */
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
  /** The days those times are in, drawn like the appointment dialog: visits, drives, open blocks. */
  days: DrawnDay[];
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
  subject: string | null;
  /** Who sent it, for ours. */
  by: string | null;
  /** Written by the AI and approved by `by`. */
  ai: boolean;
  at: string;
  /** Quo's id for a call. */
  callId: string | null;
  /** A call: whether it was answered, and what Quo wrote about it once fetched (`notes` says it was looked for). */
  call: {
    answered: boolean;
    seconds?: number;
    notes?: "completed" | "absent" | "failed";
    summary?: string[];
    nextSteps?: string[];
    transcript?: string;
  } | null;
};

/** What the AI suggested and what a manager did on the card. */
export type WorkflowEvent = {
  kind: "suggested" | "needs_you" | "sent" | "booked" | "taken" | "closed" | "reopened";
  summary: string | null;
  by: string | null;
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
  events: WorkflowEvent[];
  createdAt: string;
  /** Scheduled visits on any of their deals. */
  appointments: { startsAt: string; with: string | null }[];
  history: WorkflowHistory;
  offered: WorkflowOfferedTime[];
  settings: { prompt: string; skills: WorkflowSkill[]; minutes: number };
  people: WorkflowPerson[];
  suggestion: WorkflowSuggestion | null;
  suggestedAt: string | null;
};

/** "Tuesday, Nov 17 at 10:30 AM" in the company's time zone: how a time reads in a text and on the card. */
export function workflowTimeLabel(iso: string, timeZone: string): string {
  const at = new Date(iso);
  const day = at.toLocaleDateString("en-US", { timeZone, weekday: "long", month: "short", day: "numeric" });
  const time = at.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}
