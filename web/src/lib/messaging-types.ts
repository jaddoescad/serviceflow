export type MessageChannel = "email" | "sms";

export const CHANNEL_LABELS: Record<MessageChannel, string> = { email: "Email", sms: "Text (Quo)" };

export type DripStep = {
  id: string;
  delayMinutes: number;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  enabled: boolean;
};

export type DripStage = {
  id: string;
  name: string;
  isClosed: boolean;
  dripsEnabled: boolean;
  /** The record status the stage holds; templates go on a completed jobs stage. */
  recordStatus: string;
  steps: DripStep[];
};

/** Importing the connected Quo number's texts. */
export type QuoSync = {
  status: "running" | "done" | "failed" | null;
  /** Conversations the current (or last) import has gone through. */
  conversations: number;
  /** Texts in the inbox, imported or not. */
  texts: number;
  /** Quo calls in the inbox. */
  calls: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

export type MessagingSettings = {
  quoConnected: boolean;
  quoFromNumber: string | null;
  quoLineName: string | null;
  /** Null until Quo is connected. */
  quoSync: QuoSync | null;
  lastTextReceivedAt: string | null;
  lastEmailReceivedAt: string | null;
  replyToEmail: string | null;
};

/** One of the company's Quo numbers. */
export type QuoLine = { id: string; name: string | null; number: string; formattedNumber: string | null };

/** What each placeholder fills in, for the insert menu. */
export const PLACEHOLDER_LABELS: Record<string, string> = {
  "{{first_name}}": "First name",
  "{{last_name}}": "Last name",
  "{{full_name}}": "Full name",
  "{{name}}": "Full name",
  "{{company}}": "Company name",
  "{{company_phone}}": "Company phone",
  "{{salesperson_name}}": "Salesperson",
  "{{salesperson_phone}}": "Salesperson phone",
  "{{project_address}}": "Project address",
  "{{appointment_date}}": "Next appointment date",
  "{{appointment_time}}": "Next appointment time",
  "{{proposal_link}}": "Proposal link",
  "{{portal_link}}": "Customer portal link",
  "{{review_link}}": "Review link",
  "{{appointment_type}}": "Appointment type",
  "{{date}}": "Date",
  "{{time}}": "Time",
  "{{end_date}}": "End date",
  "{{scheduled_or_rescheduled}}": "Scheduled or rescheduled",
};

/** Placeholders a drip can use, filled from the deal when it goes out. */
export const MESSAGE_PLACEHOLDERS = [
  "{{first_name}}",
  "{{last_name}}",
  "{{full_name}}",
  "{{company}}",
  "{{company_phone}}",
  "{{salesperson_name}}",
  "{{salesperson_phone}}",
  "{{project_address}}",
  "{{appointment_date}}",
  "{{appointment_time}}",
  "{{proposal_link}}",
  "{{portal_link}}",
  "{{review_link}}",
];

/** A deal or job a step can be previewed against. */
export type PreviewRecord = { id: string; name: string };

/** A step rendered for one deal; `empty` lists placeholders it uses that have no value there. */
export type DripPreview = { subject: string | null; body: string; empty: string[] };

export type DripTemplate = "review_request" | "aftercare";

export type ReviewSettings = {
  reviewLink: string | null;
  reviewDelayDays: number;
  aftercareDelayDays: number;
};

/** The deal page's Drips block. */
export type DealDrips = {
  paused: boolean;
  stage: { id: string; name: string; dripsEnabled: boolean } | null;
  upcoming: { id: string; channel: MessageChannel; subject: string | null; body: string; scheduledFor: string }[];
};
