// Customer portal wording, plus the date formats it uses. Customer document pages (/p, /co, /i) keep their own.

import type { ChannelMode, CustomerPortal, VisitWindow } from "./portal-types";

type ProposalStatus = CustomerPortal["proposals"][number]["status"];
type ChangeOrderStatus = CustomerPortal["changeOrders"][number]["status"];
type InvoiceStatus = CustomerPortal["invoices"][number]["status"];
type AppointmentKind = CustomerPortal["appointments"][number]["kind"];

const en = {
  pageTitle: "Customer portal",
  greeting: (first: string) => (first ? `Hi ${first}` : "Hi"),
  call: "Call",
  menu: "Menu",
  website: "Visit website",
  reviews: "Reviews",
  followUs: "Follow us",
  nav: {
    proposals: "My Proposals",
    changeOrders: "My Change Orders",
    invoices: "My Invoices",
    appointments: "Appointments",
    request: "Request Appointment",
    preferences: "Message Settings",
  },
  empty: {
    proposals: "No proposals yet.",
    changeOrders: "No change orders yet.",
    invoices: "No invoices yet.",
    appointments: "No upcoming appointments.",
  },
  proposal: "Proposal",
  changeOrder: (number: number) => `Change order #${number}`,
  invoice: (number: number) => `Invoice #${number}`,
  sent: (date: string) => `Sent ${date}`,
  due: (date: string) => `Due ${date}`,
  total: "Total",
  balance: "Balance due",
  view: "View",
  proposalStatus: {
    sent: "Awaiting approval",
    accepted: "Approved",
    declined: "Declined",
  } satisfies Record<ProposalStatus, string>,
  changeOrderStatus: {
    sent: "Awaiting approval",
    accepted: "Approved",
    declined: "Declined",
    cancelled: "Cancelled",
  } satisfies Record<ChangeOrderStatus, string>,
  invoiceStatus: {
    open: "Due",
    partial: "Partially paid",
    paid: "Paid",
    late: "Past due",
    void: "Void",
  } satisfies Record<InvoiceStatus, string>,
  appointmentKind: {
    estimate: "Estimate visit",
    walkthrough: "Walkthrough",
    punch_out: "Final walkthrough",
    quality_control: "Quality check",
    other: "Appointment",
  } satisfies Record<AppointmentKind, string>,
  projectVisit: "Your project",
  requestAnother: "Request an appointment",
  request: {
    title: "Request an appointment",
    intro: "Pick up to 3 times that work for you. We'll confirm with you.",
    date: "Date",
    time: "Time",
    addTime: "Add another time",
    removeTime: "Remove time",
    note: "Anything we should know? (optional)",
    send: "Send request",
    sending: "Sending…",
    sent: "Request sent. We'll be in touch to confirm.",
    needTime: "Choose a time or add a note.",
    recent: "Your recent requests",
    sentOn: (date: string) => `Sent ${date}`,
  },
  windows: {
    morning: "Morning (8–12)",
    afternoon: "Afternoon (12–4)",
    evening: "Evening (4–7)",
    anytime: "Any time",
  } satisfies Record<VisitWindow, string>,
  preferences: {
    title: "Message Settings",
    intro: (company: string) => `Choose which messages ${company} sends you.`,
    email: "Email",
    sms: "Text messages",
    save: "Save",
    saving: "Saving…",
    saved: "Saved.",
    noChannels: "We don't have an email or phone number for you.",
  },
  modes: {
    all: { label: "All messages", hint: "Project updates, reminders and follow-ups" },
    no_drips: { label: "No marketing messages", hint: "Skip follow-ups and promotions" },
    no_reminders: { label: "No reminders", hint: "Skip appointment reminders" },
    none: { label: "No messages", hint: "Unsubscribe from everything" },
  } satisfies Record<ChannelMode, { label: string; hint: string }>,
  genericError: "Something went wrong. Try again.",
};

export type PortalStrings = typeof en;

export function portalStrings(): PortalStrings {
  return en;
}

export function portalError(message: string | undefined): string {
  return message || en.genericError;
}

const LOCALE = "en-CA";

/** "Thu, Oct 30" for a YYYY-MM-DD day. */
export function fmtPortalDay(day: string): string {
  const [year, month, date] = day.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

/** "Oct 30, 2026" for a timestamp, in the company's time zone. */
export function fmtPortalDate(at: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: timeZone ?? "America/Toronto",
  }).format(new Date(at));
}

/** "Thu, Oct 30 · 9:00 a.m. – 10:00 a.m." in the company's time zone. */
export function fmtPortalVisit(startsAt: string, endsAt: string, timeZone: string | null): string {
  const zone = timeZone ?? "America/Toronto";
  const day = new Intl.DateTimeFormat(LOCALE, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: zone,
  }).format(new Date(startsAt));
  const time = new Intl.DateTimeFormat(LOCALE, { hour: "numeric", minute: "2-digit", timeZone: zone });
  return `${day} · ${time.format(new Date(startsAt))} – ${time.format(new Date(endsAt))}`;
}

/** "$1,130.00". */
export function fmtPortalMoney(cents: number): string {
  return new Intl.NumberFormat(LOCALE, { style: "currency", currency: "CAD" }).format(cents / 100);
}

/** Today's YYYY-MM-DD in the company's time zone, the earliest day a customer can pick. */
export function portalToday(timeZone: string | null): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timeZone ?? "America/Toronto",
  }).format(new Date());
}
