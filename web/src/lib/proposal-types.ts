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
  /** The company's website and social pages, linked from the sidebar of customer pages. */
  links: Record<CompanyLink, string>;
  /** The order of the page's sections between the header and the terms, and which of the company's own are off. */
  layout: { section: PageSection; hidden: boolean }[];
};

/** The parts of a customer's proposal page a company arranges, in their usual order. */
export const PAGE_SECTIONS = [
  "highlights",
  "about",
  "note",
  "packages",
  "scope",
  "addOns",
  "photos",
  "investment",
  "stats",
] as const;
export type PageSection = (typeof PAGE_SECTIONS)[number];

/** The company's own sections can be switched off; the rest show whenever the proposal has them. */
export const HIDEABLE_SECTIONS: readonly PageSection[] = ["highlights", "about", "stats"];

export const COMPANY_LINKS = ["website", "facebook", "instagram", "linkedin", "x"] as const;
export type CompanyLink = (typeof COMPANY_LINKS)[number];

export const MAX_HIGHLIGHTS = 3;
export const MAX_ABOUT_POINTS = 12;

const clip = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const list = (value: unknown) => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/** A web address as typed ("example.com" gains https://); anything that is not one is dropped. */
function webLink(value: unknown): string {
  const text = clip(value, 300);
  if (!text || /\s/.test(text)) return "";
  const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  return /^https?:\/\/[^/]+\.[^/]+/i.test(url) ? url : "";
}

/** Every section once, in the saved order; ones the saved layout doesn't know go last. */
function reviveLayout(value: unknown): ProposalPage["layout"] {
  const layout: ProposalPage["layout"] = [];
  for (const entry of list(value)) {
    const saved = record(entry);
    const section = PAGE_SECTIONS.find((key) => key === saved.section);
    if (!section || layout.some((placed) => placed.section === section)) continue;
    layout.push({ section, hidden: saved.hidden === true && HIDEABLE_SECTIONS.includes(section) });
  }
  for (const section of PAGE_SECTIONS) {
    if (!layout.some((placed) => placed.section === section)) layout.push({ section, hidden: false });
  }
  return layout;
}

/** Saved or submitted settings, trimmed to their limits; empty points and cards are dropped. */
export function reviveProposalPage(value: unknown): ProposalPage {
  const page = record(value);
  const stats = record(page.stats);
  const links = record(page.links);
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
    links: Object.fromEntries(COMPANY_LINKS.map((key) => [key, webLink(links[key])])) as ProposalPage["links"],
    layout: reviveLayout(page.layout),
  };
}

export type SocialLink = Exclude<CompanyLink, "website">;

/** What a customer page's sidebar links to: only the ones the company has set. */
export type CompanyLinks = {
  website: string | null;
  reviews: string | null;
  social: { key: SocialLink; href: string }[];
};

export function companyLinks(company: { page?: unknown; reviewLink?: unknown }): CompanyLinks {
  const { website, ...social } = reviveProposalPage(company.page).links;
  return {
    website: website || null,
    reviews: webLink(company.reviewLink) || null,
    social: (Object.keys(social) as SocialLink[]).filter((key) => social[key]).map((key) => ({ key, href: social[key] })),
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
    /** Where customers leave a review (Settings › Reviews & aftercare). */
    reviewLink: string | null;
    timezone: string | null;
  };
  assets: DocumentAsset[];
  companyDocuments: CompanyDocument[];
};
