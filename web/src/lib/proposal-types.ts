import type { Discount, LineItem, ProposalPackage } from "@/lib/line-items";

export type ProposalStatus = "draft" | "sent" | "accepted" | "declined" | "expired" | "superseded";

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  superseded: "Superseded",
};

export const PROPOSAL_STATUS_TONES: Record<ProposalStatus, "neutral" | "brand" | "good" | "bad" | "warn"> = {
  draft: "neutral",
  sent: "brand",
  accepted: "good",
  declined: "bad",
  expired: "warn",
  superseded: "neutral",
};

/** Today's date where the companies work, as YYYY-MM-DD. */
export function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
}

/** `days` after today, as YYYY-MM-DD: the default valid-until date. */
export function isoDaysFromToday(days: number): string {
  const date = new Date(`${todayIso()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** New proposals stay open this long unless staff choose another date. */
export const PROPOSAL_VALID_DAYS = 30;

/** A sent proposal whose valid-until date has passed reads as expired; the customer can no longer approve it. */
export function proposalDisplayStatus(status: ProposalStatus, validUntil: string | null): ProposalStatus {
  return status === "sent" && validUntil != null && validUntil < todayIso() ? "expired" : status;
}

/** The editable body shared by proposals and templates. */
export type ProposalBody = {
  name: string;
  items: LineItem[];
  taxRatePercent: number;
  depositPercent: number | null;
  depositCents: number | null;
  /** A discount taken before tax: a percent or a fixed amount, not both. */
  discountPercent: number | null;
  discountCents: number | null;
  /** Good / Better / Best: the customer picks exactly one. */
  packages: ProposalPackage[];
  /** The package shown first (and counted in the amount) until the customer picks. */
  selectedPackageId: string | null;
  intro: string;
  terms: string;
  /** Proposals only: the last day the customer can approve. */
  validUntil: string | null;
};

export type Proposal = ProposalBody & {
  id: string;
  leadId: string;
  status: ProposalStatus;
  source: string;
  amountCents: number;
  publicToken: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  signedName: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  updatedAt: string;
  includeCompanyDocuments: boolean;
};

export type ProposalSummary = {
  id: string;
  name: string;
  status: ProposalStatus;
  source: string;
  amountCents: number;
  sentAt: string | null;
  viewedAt: string | null;
  updatedAt: string;
  validUntil: string | null;
  customerName: string;
  /** The project page: the accepted job, else the deal. */
  projectId: string;
  leadId: string;
};

export type ProposalTemplate = ProposalBody & { id: string; updatedAt: string };

export type DocumentKind = "proposal" | "change_order" | "invoice";

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  proposal: "Proposal",
  change_order: "Change order",
  invoice: "Invoice",
};

/** A photo or file attached to a document: a copy in the public document-assets bucket. */
export type DocumentAsset = {
  id: string;
  kind: "photo" | "file";
  name: string;
  path: string;
  mimeType: string | null;
  byteSize: number;
};

/** Insurance, WSIB and other company files offered with proposals (managed in Settings). */
export type CompanyDocument = Omit<DocumentAsset, "kind">;

export const HIGHLIGHT_ICONS = ["award", "shield", "star", "heart", "clock", "tools", "thumbsUp", "check"] as const;
export type HighlightIcon = (typeof HIGHLIGHT_ICONS)[number];

/** The company's own parts of every customer proposal page, set once in Settings. */
export type ProposalPage = {
  heroPath: string | null;
  license: string;
  /** Up to three cards under the header. */
  highlights: { icon: HighlightIcon; title: string; body: string }[];
  /** "Why choose us": a heading and its points. */
  aboutHeading: string;
  aboutPoints: { title: string; body: string }[];
  /** Shown together after the totals, each only when filled in. */
  stats: { projects: string; years: string; rating: string };
  /** Used when a proposal has no terms of its own. */
  terms: string;
};

export const MAX_HIGHLIGHTS = 3;
export const MAX_ABOUT_POINTS = 12;

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const list = (value: unknown) => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/** Saved or submitted settings, trimmed to their limits; empty points and cards are dropped. */
export function reviveProposalPage(value: unknown): ProposalPage {
  const page = record(value);
  const stats = record(page.stats);
  return {
    heroPath: clip(page.heroPath, 500) || null,
    license: clip(page.license, 80),
    highlights: list(page.highlights)
      .map((entry) => {
        const card = record(entry);
        const icon = HIGHLIGHT_ICONS.find((name) => name === card.icon) ?? "check";
        return { icon, title: clip(card.title, 80), body: clip(card.body, 400) };
      })
      .filter((card) => card.title || card.body)
      .slice(0, MAX_HIGHLIGHTS),
    aboutHeading: clip(page.aboutHeading, 120),
    aboutPoints: list(page.aboutPoints)
      .map((entry) => {
        const point = record(entry);
        return { title: clip(point.title, 120), body: clip(point.body, 600) };
      })
      .filter((point) => point.title || point.body)
      .slice(0, MAX_ABOUT_POINTS),
    stats: { projects: clip(stats.projects, 20), years: clip(stats.years, 20), rating: clip(stats.rating, 20) },
    terms: clip(page.terms, 20000),
  };
}

/** The latest email or text that carried a document's link. */
export type DocumentDelivery = {
  channel: "email" | "sms";
  status: "queued" | "sending" | "sent" | "failed" | "skipped" | "cancelled";
  error: string | null;
  sentAt: string | null;
  createdAt: string;
};

/** What the customer sees at a private link (/p, /co, /i). */
export type PublicDocument = {
  kind: DocumentKind;
  name: string;
  status: string;
  items: LineItem[];
  taxRatePercent: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  /** Proposals: the discount as entered, to recalculate as the customer chooses. */
  discount?: Discount;
  discountCents?: number;
  packages?: ProposalPackage[];
  selectedPackageId?: string | null;
  /** Proposals: the last day to approve, and whether it has passed. */
  validUntil?: string | null;
  expired?: boolean;
  /** The customer's preferred language, when staff or the customer set one. */
  language?: "en" | "fr" | null;
  /** The customer's portal link token; null when the document has no customer contact. */
  portalToken?: string | null;
  /** Proposals: whether the deposit invoice is paid. */
  depositPaid?: boolean;
  /** Invoices: deposit, progress or final; when issued; payments received. */
  invoiceKind?: string | null;
  issuedOn?: string | null;
  payments?: { id: string; amountCents: number; paidOn: string; method: string; reference: string | null }[];
  depositPercent?: number | null;
  depositCents?: number | null;
  paidCents?: number;
  balanceCents?: number;
  dueOn?: string | null;
  number?: string | null;
  intro: string | null;
  terms: string | null;
  sentAt: string | null;
  signedName?: string | null;
  signedAt?: string | null;
  signatureImage?: string | null;
  declinedAt?: string | null;
  customer: { name: string | null; email: string | null; phone: string | null; address: string | null };
  company: {
    name: string;
    phone: string | null;
    address: string | null;
    logoPath: string | null;
    brandColor: string | null;
    page: ProposalPage;
  };
  assets: DocumentAsset[];
  companyDocuments: CompanyDocument[];
};
