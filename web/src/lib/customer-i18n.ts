// Wording of the customer's document pages (/p, /co, /i), with their money
// and date formats. What staff write (item names, message, terms) is shown as
// written. The customer portal keeps its own wording in portal-i18n.ts.

import type { DocumentKind } from "./proposal-types";

/** Used when a company has no time zone on file. */
const DEFAULT_TIME_ZONE = "America/Toronto";

/** Money and dates as the page shows them; dates in the company's time zone. */
function formats(locale: string, timeZone: string) {
  return {
    money(cents: number | null | undefined): string {
      if (cents == null || !Number.isFinite(cents)) return "—";
      return new Intl.NumberFormat(locale, { style: "currency", currency: "CAD" }).format(cents / 100);
    },
    date(value: string | null | undefined): string {
      if (!value) return "—";
      const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
      if (Number.isNaN(date.getTime())) return "—";
      return date.toLocaleDateString(locale, { timeZone, month: "short", day: "numeric", year: "numeric" });
    },
    dateTime(value: string | null | undefined): string {
      if (!value) return "—";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "—";
      return date.toLocaleString(locale, {
        timeZone,
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    },
  };
}

/** Ends `text` with one full stop ("10:09 p.m." already has one). */
function sentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

const en = {
  locale: "en-CA",
  kind: { proposal: "Proposal", change_order: "Change Order", invoice: "Invoice" } satisfies Record<DocumentKind, string>,
  /** "proposal" inside a sentence. */
  noun: { proposal: "proposal", change_order: "change order", invoice: "invoice" } satisfies Record<DocumentKind, string>,
  status: {
    sent: "Pending",
    accepted: "Accepted",
    declined: "Declined",
    expired: "Expired",
    open: "Open",
    paid: "Paid",
    partial: "Partially paid",
    late: "Past due",
    void: "Void",
    cancelled: "Cancelled",
  } as Record<string, string>,
  banner: {
    declined: "You declined this. Contact us if you change your mind.",
    late: "This invoice is past due.",
    paid: "Paid in full. Thank you!",
    void: "This was voided. Contact us with any questions.",
    cancelled: "This was cancelled. Contact us with any questions.",
  } as Record<string, string>,
  expired: (date: string | null) =>
    date ? `This proposal expired on ${date}. Contact us for an updated one.` : "This proposal expired. Contact us for an updated one.",
  callUs: "Call us",
  questions: "Questions? Call us",
  website: "Visit website",
  reviews: "Reviews",
  followUs: "Follow us",
  menu: "Menu",
  myDocument: (kind: DocumentKind) => `My ${en.noun[kind]}`,
  documents: "Documents",
  insurance: "Insurance",
  onlyDeposit: (amount: string) => `Only ${amount} deposit`,
  approveAndSign: "Approve & Sign",
  downloadPdf: (kind: DocumentKind) => `Download ${en.kind[kind]} PDF`,
  dateLabel: "Date",
  total: "Total",
  validUntil: "Valid until",
  preparedFor: "Prepared for",
  billTo: "Bill to",
  projectLocation: "Project location",
  from: "From",
  noteFrom: (company: string) => `Note from ${company}`,
  license: (value: string) => `Licence # ${value}`,
  choosePackage: "Choose Your Package",
  choosePackageHint: "Pick one option. Your total updates as you choose.",
  select: "Select",
  selected: "Selected",
  packageLabel: (name: string) => `${name} package`,
  scope: "Scope of work",
  addOns: "Optional add-ons",
  addOnsHint: "Add what you'd like. Your total updates as you choose.",
  notIncluded: "Not included",
  add: "Add",
  added: "Added",
  photos: "Photos",
  viewPhoto: (name: string) => `View ${name}`,
  close: "Close",
  previousPhoto: "Previous photo",
  nextPhoto: "Next photo",
  yourInvestment: "Your Investment",
  amountDue: "Amount Due",
  lineItemsTotal: "Line items",
  optionalUpgrades: "Optional upgrades",
  discount: (percent: number | null) => (percent != null ? `Discount (${percent}%)` : "Discount"),
  tax: (rate: number) => `Tax (${rate}%)`,
  depositToStart: (percent: number | null) => `Deposit to start${percent != null ? ` (${percent}%)` : ""}`,
  projectTotal: "Project total",
  balanceAtCompletion: "Balance at completion",
  terms: "Terms and Conditions",
  signature: "Signature",
  signatureOf: (name: string | null) => `Signature of ${name ?? "the customer"}`,
  notMovingForward: "Not moving forward?",
  declineThis: (kind: DocumentKind) => `Decline this ${en.noun[kind]}`,
  approveTitle: (kind: DocumentKind) => `Approve ${en.noun[kind]}`,
  declineTitle: (kind: DocumentKind) => `Decline ${en.noun[kind]}`,
  depositRequired: "Deposit required",
  package: "Package",
  termsTitle: "Terms and conditions",
  acceptTerms: "I have read and accept the terms and conditions above.",
  yourSignature: "Your signature",
  drawSignature: "Draw your signature",
  signHere: "Sign here",
  clear: "Clear",
  fullName: "Full name",
  bySigning: (kind: DocumentKind, amount: string, withTerms: boolean) =>
    `By signing, you approve this ${en.noun[kind]} for ${amount}${withTerms ? " and its terms" : ""}.`,
  cancel: "Cancel",
  approve: "Approve",
  approving: "Approving…",
  declineReason: "Anything we should know? (optional)",
  declining: "Declining…",
  approveFailed: "Could not approve. Try again.",
  declineFailed: "Could not decline. Try again.",
  thankYou: (first: string | null | undefined, kind: DocumentKind) =>
    `${first ? `Thank you, ${first}!` : "Thank you!"} This ${en.noun[kind]} is approved.`,
  signedOn: (name: string | null | undefined, when: string | null) =>
    sentence(`${name ? `Signed by ${name}` : "Approved"}${when ? ` on ${when}` : ""}`),
  nextStep: (kind: DocumentKind, company: string) =>
    kind === "proposal" ? `${company} will be in touch to schedule the work.` : "The change is added to your project.",
  depositDue: (amount: string) => `Deposit due: ${amount}`,
  depositPaid: (amount: string) => `Deposit paid: ${amount}`,
  nav: {
    proposals: "My Proposals",
    changeOrders: "My Change Orders",
    invoices: "My Invoices",
    appointments: "Appointments",
    request: "Request Appointment",
    preferences: "Message Settings",
  },
  balanceDueBanner: (amount: string) => `Balance Due: ${amount}`,
  paidRemaining: (paid: string, remaining: string) => `${paid} paid • ${remaining} remaining`,
  paidInFull: "Paid in full",
  downloadInvoice: "Download Invoice",
  dueDate: "Due date",
  balance: "Balance",
  items: "Items",
  invoiceAmount: "Invoice Amount",
  payments: "Payments",
  depositNote: "Deposit",
  /** Card checkout (pay-button.tsx). */
  pay: {
    now: (amount: string) => `Pay ${amount} now`,
    opening: "Opening secure checkout…",
    fee: (percent: string, amount: string) => `Includes a ${percent}% card fee (${amount}). Secure checkout by Stripe.`,
    secure: "Secure card checkout by Stripe.",
    received: "Payment received. Thank you! It can take a minute to show here.",
    refused: {
      off: "Online payment is turned off. Contact us to pay another way.",
      void: "This invoice was voided, so it can't be paid online.",
      paid: "This is already paid. Thank you!",
      locked: "Online payment isn't available for this invoice. Contact us to pay.",
      unavailable: "Online payment isn't available right now. Contact us to pay.",
      not_found: "Online payment isn't available right now. Contact us to pay.",
      failed: "We couldn't open the secure checkout. Please try again in a moment.",
    } as Record<string, string>,
  },
  method: {
    "e-transfer": "E-transfer",
    cheque: "Cheque",
    cash: "Cash",
    card: "Credit card",
    other: "Other",
  } as Record<string, string>,
};

export type DocumentStrings = typeof en & ReturnType<typeof formats>;

export function documentStrings(timeZone?: string | null): DocumentStrings {
  return { ...en, ...formats(en.locale, timeZone || DEFAULT_TIME_ZONE) };
}
