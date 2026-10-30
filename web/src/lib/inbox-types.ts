import type { MessageChannel } from "./messaging-types";

export type InboxFilter = "all" | "unread" | "sms" | "email" | "calls";

export const INBOX_FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "sms", label: "Texts" },
  { value: "calls", label: "Calls" },
  { value: "email", label: "Email" },
];

/** Conversations the inbox lists at a time, and the most "Show more" reaches. */
export const INBOX_PAGE = 300;
export const INBOX_MAX = 3000;

/** Messages a thread loads at a time; older ones load on request. */
export const THREAD_PAGE = 300;

export const isInboxFilter = (value: string | undefined): value is InboxFilter =>
  INBOX_FILTERS.some((filter) => filter.value === value);

export type MessageDirection = "inbound" | "outbound";

export type InboxConversation = {
  id: string;
  contactId: string | null;
  name: string | null;
  /** The customer's number or address; an unknown sender's only name. */
  handle: string | null;
  preview: string | null;
  channel: MessageChannel | "call" | null;
  direction: MessageDirection | null;
  at: string;
  isUnread: boolean;
};

export type Inbox = { unreadCount: number; conversations: InboxConversation[] };

/** drip, reminder, document and manual come from the outbound queue; quo is a
 * text staff sent from the Quo app. */
export type MessageKind = "drip" | "reminder" | "document" | "manual" | "quo";

export const MESSAGE_KIND_LABELS: Record<MessageKind, string> = {
  drip: "Drip",
  reminder: "Reminder",
  document: "Document",
  manual: "Message",
  quo: "Sent from Quo",
};

export type ThreadAttachment = {
  name: string | null;
  contentType: string | null;
  size: number | null;
  /** Ready to open: a provider link, or a short-lived signed link for a stored file. */
  url: string | null;
};

/** A Quo call in a thread. `id` is Quo's, for fetching its audio. */
export type CallDetails = {
  id: string;
  status?: string;
  /** Seconds. */
  duration?: number;
  answered?: boolean;
  recorded?: boolean;
  voicemail?: { duration: number | null; transcript?: string | null };
};

/** A photo staff attach to a message: a public link to their upload. */
export type OutboundAttachment = { url: string; name: string | null; contentType: string | null };

export type ThreadMessage = {
  id: string;
  direction: MessageDirection;
  channel: MessageChannel | "call";
  subject: string | null;
  body: string;
  attachments: ThreadAttachment[];
  at: string;
  /** received for inbound; the queue status (queued, sending, sent, failed, skipped) for outbound. */
  status: string;
  kind: MessageKind | null;
  error: string | null;
  deliveredAt: string | null;
  authorName: string | null;
  from: string | null;
  to: string | null;
  call: CallDetails | null;
};

export type OptOutCategory = "all" | "drips" | "reminders";

export type Thread = {
  /** Null for a customer nobody has written to directly yet. */
  id: string | null;
  /** The company, whose folder photos staff attach upload to. */
  orgId: string;
  isUnread: boolean;
  handle: string | null;
  /** Quo's name for a number that isn't a customer yet. */
  name: string | null;
  contact: { id: string; name: string | null; email: string | null; phone: string | null } | null;
  record: { id: string; kind: "lead" | "job"; name: string | null } | null;
  optOuts: { channel: MessageChannel; category: OptOutCategory }[];
  quoConnected: boolean;
  messages: ThreadMessage[];
};

type Tone = "gray" | "blue" | "green" | "yellow" | "red";

export const OUTBOUND_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "blue" },
  sending: { label: "Sending", tone: "blue" },
  sent: { label: "Sent", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  skipped: { label: "Skipped", tone: "yellow" },
  cancelled: { label: "Cancelled", tone: "gray" },
};

export type OutboundFilter = "all" | "queued" | "sent" | "failed" | "skipped";

export const OUTBOUND_FILTERS: { value: OutboundFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "queued", label: "Queued" },
  { value: "sent", label: "Sent" },
  { value: "failed", label: "Failed" },
  { value: "skipped", label: "Skipped" },
];

export const isOutboundFilter = (value: string | undefined): value is OutboundFilter =>
  OUTBOUND_FILTERS.some((filter) => filter.value === value);

export type OutboundActivity = {
  id: string;
  channel: MessageChannel;
  kind: Exclude<MessageKind, "quo">;
  status: string;
  error: string | null;
  subject: string | null;
  preview: string;
  scheduledFor: string;
  sentAt: string | null;
  deliveredAt: string | null;
  customerName: string | null;
  contactId: string | null;
  recordId: string | null;
  conversationId: string | null;
  to: string | null;
  /** Sent to someone other than the customer (a test send). */
  isTest: boolean;
};

/** What a customer stopped on one channel: nothing, drips, reminders or everything. */
export type PreferenceChoice = "none" | OptOutCategory;

export type MessagePreferences = {
  company: string;
  channel: MessageChannel;
  /** Null when the customer has no address on that channel. */
  email: PreferenceChoice | null;
  sms: PreferenceChoice | null;
};
