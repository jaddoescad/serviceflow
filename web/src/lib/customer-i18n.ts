// Wording of the customer's document pages (/p, /co, /i) in English and
// Canadian French, with money and date formats to match. What staff write
// (item names, message, terms) is shown as written. The customer portal keeps
// its own wording in portal-i18n.ts.

import type { DocumentKind } from "./proposal-types";

export type CustomerLanguage = "en" | "fr";

/** Remembers the language a customer picked on a document page. */
export const DOCUMENT_LANGUAGE_COOKIE = "sf_document_language";

const TIME_ZONE = "America/Toronto";

/**
 * The page's first language: the customer's own pick on this browser, then
 * the language staff set for them, then the browser's, else English.
 */
export function documentLanguage(input: {
  chosen?: string | null;
  preferred?: string | null;
  acceptLanguage?: string | null;
}): CustomerLanguage {
  if (input.chosen === "en" || input.chosen === "fr") return input.chosen;
  if (input.preferred === "en" || input.preferred === "fr") return input.preferred;
  const first = input.acceptLanguage?.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("fr") ? "fr" : "en";
}

function formats(locale: string) {
  return {
    money(cents: number | null | undefined): string {
      if (cents == null || !Number.isFinite(cents)) return "—";
      return new Intl.NumberFormat(locale, { style: "currency", currency: "CAD" }).format(cents / 100);
    },
    date(value: string | null | undefined): string {
      if (!value) return "—";
      const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
      if (Number.isNaN(date.getTime())) return "—";
      return date.toLocaleDateString(locale, { timeZone: TIME_ZONE, month: "short", day: "numeric", year: "numeric" });
    },
    dateTime(value: string | null | undefined): string {
      if (!value) return "—";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "—";
      return date.toLocaleString(locale, {
        timeZone: TIME_ZONE,
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

/** 13.5 → "13,5 %" (a narrow no-break space before the sign, as in French). */
function frPercent(value: number): string {
  return `${value.toLocaleString("fr-CA")}\u202f%`;
}

const en = {
  ...formats("en-CA"),
  locale: "en-CA",
  languageName: "English",
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
  language: "Language",
  menu: "Menu",
  myDocument: (kind: DocumentKind) => `My ${en.noun[kind]}`,
  documents: "Documents",
  insurance: "Insurance",
  onlyDeposit: (amount: string) => `Only ${amount} deposit`,
  approveAndSign: "Approve & Sign",
  downloadPdf: (kind: DocumentKind) => `Download ${en.kind[kind]} PDF`,
  number: (kind: DocumentKind) => `${en.kind[kind]} #`,
  dateLabel: "Date",
  total: "Total",
  validUntil: "Valid until",
  preparedFor: "Prepared for",
  billTo: "Bill to",
  projectLocation: "Project location",
  company: "Company",
  noteFrom: (company: string) => `Note from ${company}`,
  choosePackage: "Choose Your Package",
  choosePackageHint: "Pick one option. Your total updates as you choose.",
  select: "Select",
  selected: "Selected",
  packageLabel: (name: string) => `${name} package`,
  lineItems: "Line Items",
  addedTo: (kind: DocumentKind) => `Added to ${en.noun[kind]}`,
  notIncluded: "Not included",
  add: "Add",
  remove: "Remove",
  media: "Media",
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
  contact: "Contact",
  jobAddress: "Job address",
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

export type DocumentStrings = typeof en;

const fr: DocumentStrings = {
  ...formats("fr-CA"),
  locale: "fr-CA",
  languageName: "Français",
  kind: { proposal: "Soumission", change_order: "Ordre de changement", invoice: "Facture" },
  noun: { proposal: "soumission", change_order: "ordre de changement", invoice: "facture" },
  status: {
    sent: "En attente",
    accepted: "Acceptée",
    declined: "Refusée",
    expired: "Expirée",
    open: "Ouverte",
    paid: "Payée",
    partial: "Payée en partie",
    late: "En retard",
    void: "Annulée",
    cancelled: "Annulé",
  },
  banner: {
    declined: "Vous avez refusé ce document. Communiquez avec nous si vous changez d’avis.",
    late: "Le paiement de cette facture est en retard.",
    paid: "Payée en totalité. Merci!",
    void: "Ce document a été annulé. Communiquez avec nous pour toute question.",
    cancelled: "Ce document a été annulé. Communiquez avec nous pour toute question.",
  },
  expired: (date) =>
    date
      ? `Cette soumission a expiré le ${date}. Communiquez avec nous pour en obtenir une à jour.`
      : "Cette soumission a expiré. Communiquez avec nous pour en obtenir une à jour.",
  callUs: "Appelez-nous",
  language: "Langue",
  menu: "Menu",
  myDocument: (kind) => ({ proposal: "Ma soumission", change_order: "Mon ordre de changement", invoice: "Ma facture" })[kind],
  documents: "Documents",
  insurance: "Assurances",
  onlyDeposit: (amount) => `Dépôt de seulement ${amount}`,
  approveAndSign: "Approuver et signer",
  downloadPdf: (kind) => `Télécharger ${kind === "change_order" ? "l’ordre de changement" : `la ${fr.noun[kind]}`} (PDF)`,
  number: (kind) => `${fr.kind[kind]} n°`,
  dateLabel: "Date",
  total: "Total",
  validUntil: "Valide jusqu’au",
  preparedFor: "Préparée pour",
  billTo: "Facturer à",
  projectLocation: "Adresse des travaux",
  company: "Entreprise",
  noteFrom: (company) => `Note de ${company}`,
  choosePackage: "Choisissez votre forfait",
  choosePackageHint: "Choisissez une option. Votre total se met à jour selon votre choix.",
  select: "Choisir",
  selected: "Choisi",
  packageLabel: (name) => `Forfait ${name}`,
  lineItems: "Articles",
  addedTo: (kind) => (kind === "change_order" ? "Ajouté à l’ordre de changement" : `Ajouté à la ${fr.noun[kind]}`),
  notIncluded: "Non inclus",
  add: "Ajouter",
  remove: "Retirer",
  media: "Photos",
  viewPhoto: (name) => `Voir ${name}`,
  close: "Fermer",
  previousPhoto: "Photo précédente",
  nextPhoto: "Photo suivante",
  yourInvestment: "Votre investissement",
  amountDue: "Montant dû",
  lineItemsTotal: "Articles",
  optionalUpgrades: "Options ajoutées",
  discount: (percent) => (percent != null ? `Rabais (${frPercent(percent)})` : "Rabais"),
  tax: (rate) => `Taxes (${frPercent(rate)})`,
  depositToStart: (percent) => `Dépôt pour commencer${percent != null ? ` (${frPercent(percent)})` : ""}`,
  projectTotal: "Total du projet",
  balanceAtCompletion: "Solde à la fin des travaux",
  terms: "Conditions générales",
  signature: "Signature",
  signatureOf: (name) => `Signature de ${name ?? "la cliente ou du client"}`,
  notMovingForward: "Vous n’allez pas de l’avant?",
  declineThis: (kind) => (kind === "change_order" ? "Refuser cet ordre de changement" : `Refuser cette ${fr.noun[kind]}`),
  approveTitle: (kind) => (kind === "change_order" ? "Approuver l’ordre de changement" : `Approuver la ${fr.noun[kind]}`),
  declineTitle: (kind) => (kind === "change_order" ? "Refuser l’ordre de changement" : `Refuser la ${fr.noun[kind]}`),
  depositRequired: "Dépôt requis",
  package: "Forfait",
  termsTitle: "Conditions générales",
  acceptTerms: "J’ai lu et j’accepte les conditions générales ci-dessus.",
  yourSignature: "Votre signature",
  drawSignature: "Dessinez votre signature",
  signHere: "Signez ici",
  clear: "Effacer",
  fullName: "Nom complet",
  bySigning: (kind, amount, withTerms) =>
    `En signant, vous approuvez ${kind === "change_order" ? "cet ordre de changement" : `cette ${fr.noun[kind]}`} au montant de ${amount}${withTerms ? " ainsi que ses conditions" : ""}.`,
  cancel: "Annuler",
  approve: "Approuver",
  approving: "Approbation…",
  declineReason: "Souhaitez-vous nous dire pourquoi? (facultatif)",
  declining: "Refus en cours…",
  approveFailed: "Impossible d’approuver. Réessayez.",
  declineFailed: "Impossible de refuser. Réessayez.",
  thankYou: (first, kind) =>
    `${first ? `Merci, ${first}!` : "Merci!"} ${kind === "change_order" ? "Cet ordre de changement est approuvé." : `Cette ${fr.noun[kind]} est approuvée.`}`,
  signedOn: (name, when) => sentence(`${name ? `Signé par ${name}` : "Approuvé"}${when ? ` le ${when}` : ""}`),
  nextStep: (kind, company) =>
    kind === "proposal"
      ? `${company} communiquera avec vous pour planifier les travaux.`
      : "Le changement est ajouté à votre projet.",
  depositDue: (amount) => `Dépôt dû : ${amount}`,
  depositPaid: (amount) => `Dépôt payé : ${amount}`,
  nav: {
    proposals: "Mes soumissions",
    changeOrders: "Mes ordres de changement",
    invoices: "Mes factures",
    appointments: "Rendez-vous",
    request: "Demander un rendez-vous",
    preferences: "Préférences de messages",
  },
  balanceDueBanner: (amount) => `Solde dû : ${amount}`,
  paidRemaining: (paid, remaining) => `${paid} payé • ${remaining} restant`,
  paidInFull: "Payée en totalité",
  downloadInvoice: "Télécharger la facture",
  contact: "Contact",
  jobAddress: "Adresse des travaux",
  dueDate: "Échéance",
  balance: "Solde",
  items: "Articles",
  invoiceAmount: "Montant de la facture",
  payments: "Paiements",
  depositNote: "Dépôt",
  pay: {
    now: (amount) => `Payer ${amount} maintenant`,
    opening: "Ouverture du paiement sécurisé…",
    fee: (percent, amount) => `Comprend des frais de carte de ${percent}\u202f% (${amount}). Paiement sécurisé par Stripe.`,
    secure: "Paiement par carte sécurisé par Stripe.",
    received: "Paiement reçu. Merci! Il peut falloir une minute pour qu’il s’affiche ici.",
    refused: {
      off: "Le paiement en ligne est désactivé. Communiquez avec nous pour payer autrement.",
      void: "Cette facture a été annulée; elle ne peut pas être payée en ligne.",
      paid: "C’est déjà payé. Merci!",
      locked: "Le paiement en ligne n’est pas offert pour cette facture. Communiquez avec nous pour payer.",
      unavailable: "Le paiement en ligne n’est pas offert pour le moment. Communiquez avec nous pour payer.",
      not_found: "Le paiement en ligne n’est pas offert pour le moment. Communiquez avec nous pour payer.",
      failed: "Impossible d’ouvrir le paiement sécurisé. Réessayez dans un moment.",
    },
  },
  method: {
    "e-transfer": "Virement Interac",
    cheque: "Chèque",
    cash: "Comptant",
    card: "Carte de crédit",
    other: "Autre",
  },
};

export function documentStrings(language: CustomerLanguage): DocumentStrings {
  return language === "fr" ? fr : en;
}
