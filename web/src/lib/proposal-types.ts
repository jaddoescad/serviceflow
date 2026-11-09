import type { Discount, LineItem, ProposalPackage } from "@/lib/line-items";

export type ProposalStatus = "draft" | "sent" | "accepted" | "declined" | "superseded";

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  superseded: "Superseded",
};

export const PROPOSAL_STATUS_TONES: Record<ProposalStatus, "neutral" | "brand" | "good" | "bad" | "warn"> = {
  draft: "neutral",
  sent: "brand",
  accepted: "good",
  declined: "bad",
  superseded: "neutral",
};

/** Today's date where the companies work, as YYYY-MM-DD. */
export function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
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

export const CARD_ICONS = ["award", "shield", "star", "heart", "clock", "tools", "thumbsUp", "check"] as const;
export type CardIcon = (typeof CARD_ICONS)[number];

/** What each proposal brings to its page: placed once each, never removed. */
export const PROPOSAL_PARTS = ["message", "packages", "scope", "addOns", "photos", "investment", "terms"] as const;
export type ProposalPart = (typeof PROPOSAL_PARTS)[number];

/** The kinds of section a company adds to its page, as many of each as it likes. */
export const CUSTOM_BLOCKS = ["text", "checklist", "cards", "numbers", "image", "video"] as const;
export type CustomBlockType = (typeof CUSTOM_BLOCKS)[number];

type BlockBase = { id: string; title: string; hidden: boolean };

/** A section the company wrote itself. */
export type CustomBlock =
  | (BlockBase & { type: "text"; body: string })
  | (BlockBase & { type: "checklist"; points: { title: string; body: string }[] })
  | (BlockBase & { type: "cards"; cards: { icon: CardIcon; title: string; body: string }[] })
  | (BlockBase & { type: "numbers"; numbers: { value: string; label: string }[] })
  | (BlockBase & { type: "image"; path: string | null })
  | (BlockBase & { type: "video"; url: string });

/** One section of the customer's proposal page: the company's own, or a part of the proposal. */
export type PageBlock = CustomBlock | PartBlock;

/** A part of the proposal, under the company's own heading for it ("" keeps the usual one). */
export type PartBlock = { id: ProposalPart; type: ProposalPart; title: string };

export function isCustomBlock(block: PageBlock): block is CustomBlock {
  return (CUSTOM_BLOCKS as readonly string[]).includes(block.type);
}

/**
 * A company's customer proposal page, built in Settings: the cover and
 * letterhead details, then its sections in the order it arranged them.
 */
export type ProposalPage = {
  heroPath: string | null;
  license: string;
  /** Every part of the proposal once, with the company's own sections placed among them. */
  blocks: PageBlock[];
  /** Used when a proposal has no terms of its own. */
  terms: string;
  /** The company's website and social pages, linked from the sidebar of customer pages. */
  links: Record<CompanyLink, string>;
};

export const COMPANY_LINKS = ["website", "facebook", "instagram", "linkedin", "x"] as const;
export type CompanyLink = (typeof COMPANY_LINKS)[number];

export const BLOCK_LIMITS = { blocks: 40, points: 20, cards: 6, numbers: 4 };

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

/** The player address for a YouTube or Vimeo link, or null when it is neither. */
export function videoEmbedUrl(url: string): string | null {
  const youtube = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,20})/i);
  if (youtube) return `https://www.youtube-nocookie.com/embed/${youtube[1]}`;
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d{5,12})/i);
  return vimeo ? `https://player.vimeo.com/video/${vimeo[1]}` : null;
}

/** A new, empty section of the given kind. */
export function newCustomBlock(type: CustomBlockType, id: string): CustomBlock {
  const base = { id, title: "", hidden: false };
  switch (type) {
    case "text":
      return { ...base, type, body: "" };
    case "checklist":
      return { ...base, type, points: [] };
    case "cards":
      return { ...base, type, cards: [] };
    case "numbers":
      return { ...base, type, numbers: [] };
    case "image":
      return { ...base, type, path: null };
    case "video":
      return { ...base, type, url: "" };
  }
}

/** A saved section with its text trimmed to its limits; empty points, cards and numbers are dropped. */
function reviveCustomBlock(type: CustomBlockType, saved: Record<string, unknown>, id: string): CustomBlock {
  const base = { id, title: clip(saved.title, 120), hidden: saved.hidden === true };
  switch (type) {
    case "text":
      return { ...base, type, body: clip(saved.body, 6000) };
    case "checklist":
      return {
        ...base,
        type,
        points: list(saved.points)
          .map((entry) => ({ title: clip(record(entry).title, 160), body: clip(record(entry).body, 800) }))
          .filter((point) => point.title || point.body)
          .slice(0, BLOCK_LIMITS.points),
      };
    case "cards":
      return {
        ...base,
        type,
        cards: list(saved.cards)
          .map((entry) => {
            const card = record(entry);
            const icon = CARD_ICONS.find((name) => name === card.icon) ?? "check";
            return { icon, title: clip(card.title, 80), body: clip(card.body, 400) };
          })
          .filter((card) => card.title || card.body)
          .slice(0, BLOCK_LIMITS.cards),
      };
    case "numbers":
      return {
        ...base,
        type,
        numbers: list(saved.numbers)
          .map((entry) => ({ value: clip(record(entry).value, 20), label: clip(record(entry).label, 60) }))
          .filter((item) => item.value)
          .slice(0, BLOCK_LIMITS.numbers),
      };
    case "image":
      return { ...base, type, path: clip(saved.path, 500) || null };
    case "video":
      return { ...base, type, url: clip(saved.url, 300) };
  }
}

/**
 * The page's sections in their saved order: the company's own as written,
 * and every part of the proposal exactly once (one the saved page doesn't
 * place goes last).
 */
function reviveBlocks(value: unknown): PageBlock[] {
  const blocks: PageBlock[] = [];
  const ids = new Set<string>();
  for (const entry of list(value).slice(0, BLOCK_LIMITS.blocks)) {
    const saved = record(entry);
    const part = PROPOSAL_PARTS.find((key) => key === saved.type);
    if (part) {
      if (!ids.has(part)) blocks.push({ id: part, type: part, title: clip(saved.title, 60) });
      ids.add(part);
      continue;
    }
    const type = CUSTOM_BLOCKS.find((key) => key === saved.type);
    if (!type) continue;
    let id = clip(saved.id, 60) || `${type}-${blocks.length}`;
    while (ids.has(id) || (PROPOSAL_PARTS as readonly string[]).includes(id)) id = `${id}-${blocks.length}`;
    ids.add(id);
    blocks.push(reviveCustomBlock(type, saved, id));
  }
  for (const part of PROPOSAL_PARTS) {
    if (!ids.has(part)) blocks.push({ id: part, type: part, title: "" });
  }
  return blocks;
}

/** Whether a section has anything to show a customer. */
export function blockHasContent(block: CustomBlock): boolean {
  switch (block.type) {
    case "text":
      return Boolean(block.title || block.body);
    case "checklist":
      return block.points.length > 0;
    case "cards":
      return block.cards.length > 0;
    case "numbers":
      return block.numbers.length > 0;
    case "image":
      return Boolean(block.path);
    case "video":
      return videoEmbedUrl(block.url) != null;
  }
}

/** Saved or submitted settings, trimmed to their limits. */
export function reviveProposalPage(value: unknown): ProposalPage {
  const page = record(value);
  const links = record(page.links);
  return {
    heroPath: clip(page.heroPath, 500) || null,
    license: clip(page.license, 80),
    blocks: reviveBlocks(page.blocks),
    terms: clip(page.terms, 20000),
    links: Object.fromEntries(COMPANY_LINKS.map((key) => [key, webLink(links[key])])) as ProposalPage["links"],
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
