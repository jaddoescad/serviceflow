// Customer portal wording in English and Canadian French, plus the date
// formats it uses. Customer document pages (/p, /co, /i) keep their own.

import type { ChannelMode, CustomerPortal, PortalLanguage, VisitWindow } from "./portal-types";

type ProposalStatus = CustomerPortal["proposals"][number]["status"];
type ChangeOrderStatus = CustomerPortal["changeOrders"][number]["status"];
type InvoiceStatus = CustomerPortal["invoices"][number]["status"];
type AppointmentKind = CustomerPortal["appointments"][number]["kind"];

const en = {
  pageTitle: "Customer portal",
  greeting: (first: string) => (first ? `Hi ${first}` : "Hi"),
  language: "Language",
  call: "Call",
  menu: "Menu",
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
    expired: "Expired",
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

const fr: PortalStrings = {
  pageTitle: "Portail client",
  greeting: (first) => (first ? `Bonjour ${first}` : "Bonjour"),
  language: "Langue",
  call: "Appeler",
  menu: "Menu",
  nav: {
    proposals: "Mes soumissions",
    changeOrders: "Mes ordres de changement",
    invoices: "Mes factures",
    appointments: "Rendez-vous",
    request: "Demander un rendez-vous",
    preferences: "Préférences de messages",
  },
  empty: {
    proposals: "Aucune soumission pour le moment.",
    changeOrders: "Aucun ordre de changement pour le moment.",
    invoices: "Aucune facture pour le moment.",
    appointments: "Aucun rendez-vous à venir.",
  },
  proposal: "Soumission",
  changeOrder: (number) => `Ordre de changement n° ${number}`,
  invoice: (number) => `Facture n° ${number}`,
  sent: (date) => `Envoyée le ${date}`,
  due: (date) => `Échéance le ${date}`,
  total: "Total",
  balance: "Solde dû",
  view: "Voir",
  proposalStatus: {
    sent: "En attente d'approbation",
    accepted: "Approuvée",
    declined: "Refusée",
    expired: "Expirée",
  },
  changeOrderStatus: {
    sent: "En attente d'approbation",
    accepted: "Approuvé",
    declined: "Refusé",
    cancelled: "Annulé",
  },
  invoiceStatus: {
    open: "À payer",
    partial: "Partiellement payée",
    paid: "Payée",
    late: "En retard",
    void: "Annulée",
  },
  appointmentKind: {
    estimate: "Visite pour la soumission",
    walkthrough: "Visite des lieux",
    punch_out: "Visite finale",
    quality_control: "Contrôle de la qualité",
    other: "Rendez-vous",
  },
  projectVisit: "Vos travaux",
  requestAnother: "Demander un rendez-vous",
  request: {
    title: "Demander un rendez-vous",
    intro: "Choisissez jusqu'à 3 moments qui vous conviennent. Nous vous confirmerons le rendez-vous.",
    date: "Date",
    time: "Moment",
    addTime: "Ajouter un autre moment",
    removeTime: "Retirer ce moment",
    note: "Quelque chose à nous signaler? (facultatif)",
    send: "Envoyer la demande",
    sending: "Envoi…",
    sent: "Demande envoyée. Nous vous contacterons pour confirmer.",
    needTime: "Choisissez un moment ou ajoutez une précision.",
    recent: "Vos demandes récentes",
    sentOn: (date) => `Envoyée le ${date}`,
  },
  windows: {
    morning: "Matin (8 h–12 h)",
    afternoon: "Après-midi (12 h–16 h)",
    evening: "Soir (16 h–19 h)",
    anytime: "N'importe quand",
  },
  preferences: {
    title: "Préférences de messages",
    intro: (company) => `Choisissez les messages que ${company} vous envoie.`,
    email: "Courriel",
    sms: "Textos",
    save: "Enregistrer",
    saving: "Enregistrement…",
    saved: "Enregistré.",
    noChannels: "Nous n'avons pas de courriel ni de numéro de téléphone pour vous.",
  },
  modes: {
    all: { label: "Tous les messages", hint: "Suivis de projet, rappels et relances" },
    no_drips: { label: "Aucun message promotionnel", hint: "Sans relances ni promotions" },
    no_reminders: { label: "Aucun rappel", hint: "Sans rappels de rendez-vous" },
    none: { label: "Aucun message", hint: "Me désabonner de tout" },
  },
  genericError: "Une erreur s'est produite. Réessayez.",
};

/** Server messages the portal can show, in French. */
const SERVER_ERRORS_FR: Record<string, string> = {
  "Choose up to 3 times.": "Choisissez jusqu'à 3 moments.",
  "Choose dates from today on.": "Choisissez des dates à partir d'aujourd'hui.",
  "Choose a time or add a note.": fr.request.needTime,
  "Shorten your note to 1000 characters.": "Raccourcissez votre message à 1000 caractères.",
  "You already sent a few requests today. We will be in touch.":
    "Vous avez déjà envoyé quelques demandes aujourd'hui. Nous vous contacterons.",
  "This link is not available.": "Ce lien n'est plus disponible.",
};

export function portalStrings(lang: PortalLanguage): PortalStrings {
  return lang === "fr" ? fr : en;
}

export function portalError(lang: PortalLanguage, message: string | undefined): string {
  if (!message) return portalStrings(lang).genericError;
  return lang === "fr" ? (SERVER_ERRORS_FR[message] ?? fr.genericError) : message;
}

/** The language a portal opens in: the customer's saved choice, else their browser's. */
export function portalLanguage(saved: string | null | undefined, acceptLanguage: string | null): PortalLanguage {
  if (saved === "en" || saved === "fr") return saved;
  return acceptLanguage?.trim().toLowerCase().startsWith("fr") ? "fr" : "en";
}

function locale(lang: PortalLanguage) {
  return lang === "fr" ? "fr-CA" : "en-CA";
}

/** "Thu, Oct 30" for a YYYY-MM-DD day. */
export function fmtPortalDay(lang: PortalLanguage, day: string): string {
  const [year, month, date] = day.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat(locale(lang), {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

/** "Oct 30, 2026" for a timestamp, in the company's time zone. */
export function fmtPortalDate(lang: PortalLanguage, at: string, timeZone: string | null): string {
  return new Intl.DateTimeFormat(locale(lang), {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: timeZone ?? "America/Toronto",
  }).format(new Date(at));
}

/** "Thu, Oct 30 · 9:00 a.m. – 10:00 a.m." in the company's time zone. */
export function fmtPortalVisit(lang: PortalLanguage, startsAt: string, endsAt: string, timeZone: string | null): string {
  const zone = timeZone ?? "America/Toronto";
  const day = new Intl.DateTimeFormat(locale(lang), {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: zone,
  }).format(new Date(startsAt));
  const time = new Intl.DateTimeFormat(locale(lang), { hour: "numeric", minute: "2-digit", timeZone: zone });
  return `${day} · ${time.format(new Date(startsAt))} – ${time.format(new Date(endsAt))}`;
}

/** Money in the customer's language: "$1,130.00" / "1 130,00 $". */
export function fmtPortalMoney(lang: PortalLanguage, cents: number): string {
  return new Intl.NumberFormat(locale(lang), { style: "currency", currency: "CAD" }).format(cents / 100);
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
