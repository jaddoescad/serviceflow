import type { LineItem } from "@/lib/line-items";

type Tone = "neutral" | "brand" | "good" | "bad" | "warn";

export type ChangeOrderStatus = "draft" | "sent" | "accepted" | "declined" | "cancelled";

export const CHANGE_ORDER_STATUS: Record<ChangeOrderStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "brand" },
  accepted: { label: "Accepted", tone: "good" },
  declined: { label: "Declined", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** Stored draft/sent/void plus the payment state derived from payments and the due date. */
export type InvoiceStatus = "draft" | "open" | "partial" | "paid" | "late" | "void";

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  open: { label: "Open", tone: "brand" },
  partial: { label: "Partially paid", tone: "warn" },
  paid: { label: "Paid", tone: "good" },
  late: { label: "Late", tone: "bad" },
  void: { label: "Void", tone: "neutral" },
};

export type InvoiceKind = "deposit" | "progress" | "final" | "standard";

export const INVOICE_KIND_LABELS: Record<InvoiceKind, string> = {
  deposit: "Deposit",
  progress: "Progress",
  final: "Final",
  standard: "Invoice",
};

export const PAYMENT_METHOD_LABELS = {
  "e-transfer": "E-transfer",
  cheque: "Cheque",
  cash: "Cash",
  card: "Card",
  other: "Other",
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHOD_LABELS;

/** The editable body shared by change orders and invoices. */
export type BillingBody = {
  name: string;
  items: LineItem[];
  taxRatePercent: number;
  /** Change order message, or invoice notes. */
  message: string;
  invoiceKind: InvoiceKind;
  issuedOn: string;
  dueOn: string;
};

export type ChangeOrder = {
  id: string;
  jobId: string;
  number: number;
  name: string;
  status: ChangeOrderStatus;
  items: LineItem[];
  taxRatePercent: number;
  amountCents: number;
  intro: string;
  publicToken: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  signedName: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  updatedAt: string;
  customerName?: string;
};

export type InvoiceSummary = {
  id: string;
  jobId: string;
  number: number;
  name: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  issuedOn: string;
  dueOn: string | null;
  sentAt: string | null;
  customerName: string | null;
  jobName: string;
};

export type InvoicePayment = {
  id: string;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  /** Recorded by hand, or by Stripe's webhook after an online card payment. */
  source: "manual" | "stripe";
  /** Card fee the customer paid on top; not part of the invoice. */
  feeCents: number;
};

/** The company's Stripe connection as staff see it; the keys themselves never leave the server. */
export type PaymentSettings = {
  orgId: string;
  canEdit: boolean;
  keyConnected: boolean;
  keyEnding: string | null;
  testMode: boolean;
  webhookConnected: boolean;
  webhookEnding: string | null;
  acceptCards: boolean;
  cardFeePercent: number;
  /** Where Stripe sends this company's payment events. */
  webhookUrl: string;
  /** False until the server has SUPABASE_SERVICE_ROLE_KEY. */
  serverReady: boolean;
};

/** Why a link can't be paid online right now. */
export type PaymentRefusal = "off" | "void" | "paid" | "locked";

/** What the customer's Pay button offers for an invoice or accepted proposal link. */
export type PublicPaymentOptions = {
  payable: boolean;
  reason: PaymentRefusal | null;
  invoiceNumber: number;
  invoiceKind: InvoiceKind;
  balanceCents: number;
  feePercent: number;
  feeCents: number;
  /** Balance plus the card fee: what the card is charged. */
  chargeCents: number;
};

export type Invoice = InvoiceSummary & {
  items: LineItem[];
  taxRatePercent: number;
  notes: string;
  publicToken: string | null;
  viewedAt: string | null;
  payments: InvoicePayment[];
  /** Set when the company takes cards online. */
  online: { feePercent: number; locked: boolean } | null;
};

/** A line of agreed scope, from the accepted proposal or an accepted change order. */
export type ScopeItem = LineItem & { changeOrder: number | null };

export type WorkOrder = {
  name: string;
  address: string | null;
  scheduledOn: string | null;
  scheduledEndOn: string | null;
  contact: { name: string | null; email: string | null; phone: string | null } | null;
  proposalName: string | null;
  scope: ScopeItem[];
  crew: string[];
  notes: { id: string; body: string }[];
};
