// What view_customer_portal returns for a customer's private portal link.

export type PortalLanguage = "en" | "fr";

export type VisitWindow = "morning" | "afternoon" | "evening" | "anytime";

export const VISIT_WINDOWS: readonly VisitWindow[] = ["morning", "afternoon", "evening", "anytime"];

/** A day (YYYY-MM-DD in the company's time zone) and part of the day. */
export type PreferredTime = { date: string; window: VisitWindow };

/** Per channel: everything, everything but drips, everything but reminders, or nothing. */
export type ChannelMode = "all" | "no_drips" | "no_reminders" | "none";

export const CHANNEL_MODES: readonly ChannelMode[] = ["all", "no_drips", "no_reminders", "none"];

export type CustomerPortal = {
  company: {
    name: string;
    phone: string | null;
    address: string | null;
    logoPath: string | null;
    brandColor: string | null;
    timezone: string | null;
  };
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    language: PortalLanguage | null;
  };
  proposals: {
    name: string;
    status: "sent" | "accepted" | "declined" | "expired";
    totalCents: number;
    sentAt: string | null;
    token: string;
    address: string | null;
  }[];
  changeOrders: {
    number: number;
    name: string;
    status: "sent" | "accepted" | "declined" | "cancelled";
    totalCents: number;
    sentAt: string | null;
    token: string;
  }[];
  invoices: {
    number: number;
    name: string;
    status: "open" | "partial" | "paid" | "late" | "void";
    totalCents: number;
    balanceCents: number;
    dueOn: string | null;
    sentAt: string | null;
    token: string;
  }[];
  appointments: {
    kind: "estimate" | "walkthrough" | "punch_out" | "quality_control" | "other";
    startsAt: string;
    endsAt: string;
    location: string | null;
  }[];
  /** Scheduled work on the customer's jobs. */
  projects: { startOn: string; endOn: string | null; address: string | null }[];
  /** Appointment requests from the last 60 days, newest first. */
  requests: { createdAt: string; preferredTimes: PreferredTime[]; note: string | null }[];
  preferences: { email: ChannelMode; sms: ChannelMode };
};
