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
  };
  assets: DocumentAsset[];
  companyDocuments: CompanyDocument[];
};
