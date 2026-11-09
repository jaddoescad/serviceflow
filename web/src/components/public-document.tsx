"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptPublicChangeOrder, declinePublicChangeOrder } from "@/lib/actions/billing";
import { acceptPublicProposal, declinePublicProposal } from "@/lib/actions/proposals";
import type { ActionResult } from "@/lib/actions/rpc";
import { documentStrings, type DocumentStrings } from "@/lib/customer-i18n";
import { documentAssetUrl, fmtFileSize } from "@/lib/document-assets";
import {
  NO_DISCOUNT,
  chosenPackageId,
  depositCents,
  documentTotals,
  isAddOn,
  isIncluded,
  lineTotalCents,
  packageCents,
  type LineItem,
  type ProposalPackage,
} from "@/lib/line-items";
import {
  blockHasContent,
  companyLinks,
  isCustomBlock,
  videoEmbedUrl,
  type CardIcon,
  type CompanyDocument,
  type CustomBlock,
  type DocumentAsset,
  type DocumentKind,
  type ProposalPart,
  type PublicDocument,
} from "@/lib/proposal-types";
import { CompanyLogo, CustomerShell, SIDEBAR_GROUP_LABEL, type ShellNavItem } from "./customer-shell";
import { PayButton } from "./pay-button";
import { ProjectModal } from "./project-profile-panel";
import { Button, Input, Textarea, cn } from "./ui";

// A customer's document page, inside the customer frame (customer-shell.tsx).
// The document is one white sheet read top to bottom, its sections divided by
// hairlines, with every accent in the company's colour. Proposals and change
// orders keep the price and Approve & Sign in view (a card beside the sheet on
// wide screens, a bar above it otherwise); the company's own sections
// (Settings › Customer proposal page) frame the scope, and optional items are
// added and removed in place. Invoices: a balance banner with the pay button,
// then the same sheet.

/** Documents the customer signs; invoices are read-only. */
const RESPONDERS: Partial<
  Record<
    DocumentKind,
    {
      accept: (input: {
        token: string;
        signer: string;
        signature: string;
        selected: string[];
        package?: string | null;
      }) => Promise<ActionResult>;
      decline: (input: { token: string; reason: string }) => Promise<ActionResult>;
    }
  >
> = {
  proposal: { accept: acceptPublicProposal, decline: declinePublicProposal },
  change_order: { accept: acceptPublicChangeOrder, decline: declinePublicChangeOrder },
};

/** Print rules in globals.css hide these and lay the page out for letter paper. */
const NO_PRINT = "public-document-noprint";

/** The page's main action, in the company's colour. */
const APPROVE_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--brand-accent)] font-semibold text-[var(--brand-ink)] shadow-sm outline-none transition-opacity hover:opacity-90 focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50";
const OUTLINE_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--color-border-strong)] bg-white font-medium text-[var(--color-heading)] outline-none transition-colors hover:bg-[var(--color-hover)] focus-visible:shadow-[var(--focus-ring)]";
export const LABEL = "text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]";
const CARD = "rounded-2xl border border-[var(--color-border)] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.05)]";
/** A sheet section's padding. */
export const PAD = "px-5 py-6 sm:px-8 sm:py-7";

const ICONS = {
  check: "M20 6 9 17l-5-5",
  checkCircle: "M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3",
  plus: "M12 5v14M5 12h14",
  tag: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8ZM7 7h.01",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h5",
  layers: "M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
  phone:
    "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  dollar: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  award: "M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM8.2 13.9 7 22l5-3 5 3-1.2-8.1",
  star: "m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2L5.8 21 7 14.2 2 9.3l6.9-1Z",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8Z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2",
  tools:
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z",
  thumbsUp:
    "M7 10v12M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z",
} as const;

/** The icons a company can pick for its cards (Settings › Customer proposal page). */
const CARD_ICON: Record<CardIcon, IconName> = {
  award: "award",
  shield: "shield",
  star: "star",
  heart: "heart",
  clock: "clock",
  tools: "tools",
  thumbsUp: "thumbsUp",
  check: "checkCircle",
};

type IconName = keyof typeof ICONS;

/** A card's icon, as the customer sees it; the page builder in Settings draws the same one. */
export function CardGlyph({ icon, className }: { icon: CardIcon; className?: string }) {
  return <Icon name={CARD_ICON[icon]} className={className} />;
}

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-4 w-4 shrink-0", className)}
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

const STATUS_PILL_CLASSES: Record<string, string> = {
  sent: "bg-[#fef3c7] text-[#92400e]",
  open: "bg-[#dbeafe] text-[#1e40af]",
  accepted: "bg-[#dcfce7] text-[#166534]",
  declined: "bg-[#fee2e2] text-[#991b1b]",
  expired: "bg-[#ffedd5] text-[#9a3412]",
  paid: "bg-[#dcfce7] text-[#166534]",
  partial: "bg-[#fef3c7] text-[#92400e]",
  late: "bg-[#fee2e2] text-[#991b1b]",
};

function StatusPill({ status, t }: { status: string; t: DocumentStrings }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
        STATUS_PILL_CLASSES[status] ?? "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {t.status[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

/** The white sheet a document is set on; hairlines divide its sections. */
function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <article
      className={cn(
        CARD,
        "divide-y divide-[var(--color-border)] overflow-hidden print:rounded-none print:border-0 print:shadow-none",
      )}
    >
      {children}
    </article>
  );
}

/** One part of the sheet under a small heading. */
function Section({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(PAD, className)}>
      <h2 className={LABEL}>{title}</h2>
      {hint ? <p className="mt-1 text-[13px] leading-5 text-[var(--color-muted)]">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Party({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 text-[13px] leading-5 text-[var(--color-muted)] [overflow-wrap:anywhere]">
      <div className={cn(LABEL, "mb-1")}>{label}</div>
      {children}
    </div>
  );
}

/** Who the document is for, where the work is, and who it is from. */
function Parties({ doc, t, customerLabel }: { doc: PublicDocument; t: DocumentStrings; customerLabel: string }) {
  const name = "font-semibold text-[var(--color-heading)]";
  return (
    <div className="grid gap-5 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-5 sm:grid-cols-3 sm:px-8">
      <Party label={customerLabel}>
        <div className={name}>{doc.customer.name ?? "—"}</div>
        {doc.customer.email ? <div>{doc.customer.email}</div> : null}
        {doc.customer.phone ? <div>{doc.customer.phone}</div> : null}
      </Party>
      <Party label={t.projectLocation}>
        <div className={name}>{doc.customer.address ?? "—"}</div>
      </Party>
      <Party label={t.from}>
        <div className={name}>{doc.company.name}</div>
        {doc.company.page.license ? <div>{t.license(doc.company.page.license)}</div> : null}
        {doc.company.address ? <div>{doc.company.address}</div> : null}
        {doc.company.phone ? <div>{doc.company.phone}</div> : null}
      </Party>
    </div>
  );
}

const FACT_COLUMNS: Record<number, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" };

/**
 * The top of every document: the company's cover photo (when it has one), the
 * kind and number, the title and status, its key facts, then who it is between.
 */
function DocumentHeader({
  doc,
  t,
  status,
  eyebrow,
  title,
  action,
  facts,
  cover,
  customerLabel,
}: {
  doc: PublicDocument;
  t: DocumentStrings;
  status: string;
  eyebrow: string;
  title: string;
  /** Under the status, e.g. the invoice's download button. */
  action?: React.ReactNode;
  facts: Array<[string, string]>;
  cover?: string | null;
  customerLabel: string;
}) {
  return (
    <header>
      {cover ? (
        <img src={documentAssetUrl(cover)} alt="" className="aspect-[3/1] w-full bg-[var(--color-surface-2)] object-cover" />
      ) : null}
      <div className={PAD}>
        {/* The letterhead: phones and paper have no sidebar to carry the logo. */}
        <div className="mb-6 hidden items-center gap-3 max-lg:flex print:flex">
          {doc.company.logoPath ? (
            <CompanyLogo company={doc.company} className="h-11 w-auto max-w-[180px]" />
          ) : (
            <CompanyLogo company={doc.company} className="h-11 w-11 rounded-xl bg-[var(--brand-tint)] text-[15px]" />
          )}
          {doc.company.logoPath ? null : (
            <div className="min-w-0 truncate text-[15px] font-semibold text-[var(--color-heading)]">{doc.company.name}</div>
          )}
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--brand-text)]">{eyebrow}</div>
            <h1 className="mt-1.5 text-[28px] font-bold leading-[1.15] tracking-tight text-[var(--color-heading)] [overflow-wrap:anywhere] sm:text-[32px]">
              {title}
            </h1>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2.5">
            <StatusPill status={status} t={t} />
            {action}
          </div>
        </div>
        <dl className={cn("mt-6 grid grid-cols-2 gap-x-6 gap-y-4", FACT_COLUMNS[facts.length])}>
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className={LABEL}>{label}</dt>
              <dd className="mt-1 text-[15px] font-semibold leading-5 tabular-nums text-[var(--color-heading)] [overflow-wrap:anywhere]">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <Parties doc={doc} t={t} customerLabel={customerLabel} />
    </header>
  );
}

/** What a line says about itself: name, quantity when it isn't one, description. */
function LineText({ item, t }: { item: LineItem; t: DocumentStrings }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[15px] font-semibold leading-6 text-[var(--color-heading)]">{item.name}</div>
      {item.quantity !== 1 ? (
        <div className="text-[13px] tabular-nums text-[var(--color-muted)]">
          {item.quantity} × {t.money(item.unitPriceCents)}
        </div>
      ) : null}
      {item.description ? (
        <p className="mt-1 whitespace-pre-line text-[13px] leading-5 text-[var(--color-muted)]">{item.description}</p>
      ) : null}
    </div>
  );
}

/** The document's lines as rows divided by hairlines, each with its total on the right. */
function LineRows({
  items,
  t,
  tag,
}: {
  items: LineItem[];
  t: DocumentStrings;
  /** A small label above a line's name (its package). */
  tag?: (item: LineItem) => React.ReactNode;
}) {
  return (
    <ul className="-my-4 divide-y divide-[var(--color-border)]">
      {items.map((item) => (
        <li key={item.id} className="public-document-line py-4">
          {tag?.(item)}
          <div className="flex items-start justify-between gap-6">
            <LineText item={item} t={t} />
            <div className="shrink-0 text-[15px] font-semibold leading-6 tabular-nums text-[var(--color-heading)]">
              {t.money(lineTotalCents(item))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function FileLinks({ files }: { files: Array<DocumentAsset | CompanyDocument> }) {
  return (
    <ul>
      {files.map((file) => (
        <li key={file.id} className="public-document-file">
          <a
            href={downloadUrl(file)}
            className="flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-[13px] text-[var(--color-text)] outline-none hover:bg-[var(--color-hover)] focus-visible:shadow-[var(--focus-ring)]"
          >
            <Icon name="file" className="text-[var(--color-muted)]" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <span className="shrink-0 text-xs text-[var(--color-faint)]">{fmtFileSize(file.byteSize)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A group of files in the sidebar: the document's own, or the company's insurance. */
function SidebarFiles({ label, files }: { label: string; files: Array<DocumentAsset | CompanyDocument> }) {
  return (
    <div>
      <div className={cn(SIDEBAR_GROUP_LABEL, "mb-1.5")}>{label}</div>
      <FileLinks files={files} />
    </div>
  );
}

const CURRENT_NAV: Record<DocumentKind, keyof DocumentStrings["nav"]> = {
  proposal: "proposals",
  change_order: "changeOrders",
  invoice: "invoices",
};

/**
 * The portal's sections, linking back into it; the one for this document's
 * kind is highlighted. A staff preview lists them before the customer's portal
 * link exists, so the sidebar reads as the customer will see it.
 */
function documentNav(doc: PublicDocument, t: DocumentStrings, preview: boolean): ShellNavItem[] {
  const current = CURRENT_NAV[doc.kind];
  // Without a customer contact there is no portal: only this document.
  if (!doc.portalToken && !preview) {
    return [{ key: "document", label: t.myDocument(doc.kind), icon: "file", active: true }];
  }
  const base = doc.portalToken ? `/portal/${encodeURIComponent(doc.portalToken)}` : null;
  const sections: Array<[keyof DocumentStrings["nav"], ShellNavItem["icon"]]> = [
    ["proposals", "file"],
    ...(doc.kind === "change_order" ? [["changeOrders", "swap"] as [keyof DocumentStrings["nav"], ShellNavItem["icon"]]] : []),
    ["invoices", "receipt"],
    ["appointments", "calendar"],
    ["request", "calendarPlus"],
    ["preferences", "mail"],
  ];
  return sections.map(([key, icon]) => ({
    key,
    label: t.nav[key],
    icon,
    active: key === current,
    href: base ? `${base}?view=${key}` : undefined,
  }));
}

function ErrorText({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="text-[13px] text-[var(--color-bad)]">
      {message}
    </p>
  ) : null;
}

/** Loads every photo before opening the print dialog, so "Save as PDF" includes them. */
async function printDocument() {
  const images = Array.from(document.querySelectorAll<HTMLImageElement>(".public-document img"));
  for (const image of images) image.loading = "eager";
  await Promise.race([
    Promise.all(images.map((image) => (image.complete ? null : image.decode().catch(() => null)))),
    new Promise((resolve) => window.setTimeout(resolve, 10_000)),
  ]);
  window.print();
}

function downloadUrl(file: { path: string; name: string }) {
  return `${documentAssetUrl(file.path)}?download=${encodeURIComponent(file.name)}`;
}

/** A photo filling the screen; arrows step through the others. */
function PhotoViewer({
  photos,
  index,
  t,
  onIndex,
  onClose,
}: {
  photos: DocumentAsset[];
  index: number;
  t: DocumentStrings;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const photo = photos[index];
  const step = (by: number) => onIndex((index + by + photos.length) % photos.length);
  const keys = useRef<(event: KeyboardEvent) => void>(null);
  keys.current = (event) => {
    if (event.key === "Escape") onClose();
    if (event.key === "ArrowLeft") step(-1);
    if (event.key === "ArrowRight") step(1);
  };
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event: KeyboardEvent) => keys.current?.(event);
    window.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", keydown);
    };
  }, []);
  const control =
    "absolute flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-xl text-white outline-none hover:bg-black/70 focus-visible:shadow-[var(--focus-ring)]";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={photo.name}
      onClick={onClose}
      className={cn("fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 sm:p-10", NO_PRINT)}
    >
      <img
        src={documentAssetUrl(photo.path)}
        alt={photo.name}
        onClick={(event) => event.stopPropagation()}
        className="max-h-full max-w-full rounded-[var(--radius)] object-contain"
      />
      <button type="button" aria-label={t.close} onClick={onClose} className={cn(control, "right-3 top-3")}>
        ×
      </button>
      {photos.length > 1 ? (
        <>
          <button
            type="button"
            aria-label={t.previousPhoto}
            onClick={(event) => {
              event.stopPropagation();
              step(-1);
            }}
            className={cn(control, "left-3 top-1/2 -translate-y-1/2")}
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={t.nextPhoto}
            onClick={(event) => {
              event.stopPropagation();
              step(1);
            }}
            className={cn(control, "right-3 top-1/2 -translate-y-1/2")}
          >
            ›
          </button>
        </>
      ) : null}
    </div>
  );
}

const SIGNATURE_INK = "#1d2330";

/** A box the customer signs in with a finger, pen or mouse. Reports the drawing as a PNG data URL. */
function SignaturePad({ t, onChange }: { t: DocumentStrings; onChange: (image: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.scale(ratio, ratio);
    context.lineWidth = 2.2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = SIGNATURE_INK;
  }, []);

  function at(event: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const box = event.currentTarget.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  }

  function finish() {
    if (!drawing.current) return;
    drawing.current = false;
    setEmpty(false);
    onChange(canvasRef.current?.toDataURL("image/png") ?? null);
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange(null);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex h-7 items-center justify-between gap-2">
        <div className="text-sm font-semibold text-[var(--color-heading)]">{t.yourSignature}</div>
        <Button type="button" variant="ghost" size="sm" disabled={empty} onClick={clear}>
          {t.clear}
        </Button>
      </div>
      <div className="relative rounded-[var(--radius)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
        <canvas
          ref={canvasRef}
          aria-label={t.drawSignature}
          className="block h-32 w-full cursor-crosshair touch-none"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const context = event.currentTarget.getContext("2d");
            const [x, y] = at(event);
            drawing.current = true;
            context?.beginPath();
            context?.moveTo(x, y);
            context?.lineTo(x + 0.1, y + 0.1);
            context?.stroke();
          }}
          onPointerMove={(event) => {
            if (!drawing.current) return;
            const context = event.currentTarget.getContext("2d");
            const [x, y] = at(event);
            context?.lineTo(x, y);
            context?.stroke();
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
        <div className="pointer-events-none absolute inset-x-4 bottom-8 border-b border-[var(--color-border-strong)]" />
        {empty ? (
          <span className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[13px] text-[var(--color-faint)]">
            {t.signHere}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** In a staff preview the dialogs open so staff can see them, with their action off. */
function PreviewNote() {
  return <p className="text-xs text-[var(--color-muted)]">Preview: your customer approves or declines from their own link.</p>;
}

function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] bg-white px-5 py-3">
      {children}
    </div>
  );
}

/** Review the amount, accept the terms, sign and approve. */
function ApproveDialog({
  doc,
  t,
  terms,
  totalCents,
  depositDue,
  packageName,
  pending,
  locked,
  error,
  onCancel,
  onApprove,
}: {
  doc: PublicDocument;
  t: DocumentStrings;
  /** The proposal's own terms, or the company's. */
  terms: string;
  totalCents: number;
  depositDue: number;
  packageName: string | null;
  pending: boolean;
  /** A staff preview: the dialog shows, approving is off. */
  locked: boolean;
  error: string;
  onCancel: () => void;
  onApprove: (input: { signer: string; signature: string }) => void;
}) {
  const [signer, setSigner] = useState(doc.customer.name ?? "");
  const [signature, setSignature] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(!terms);
  const ready = !!signer.trim() && !!signature && agreed;
  return (
    <ProjectModal title={t.approveTitle(doc.kind)} onClose={() => !pending && onCancel()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && signature && !locked) onApprove({ signer: signer.trim(), signature });
        }}
      >
        <div className="space-y-4 p-5">
          <dl className="divide-y divide-[var(--color-border)] rounded-xl bg-[var(--color-surface-2)] px-4">
            {packageName ? (
              <div className="flex items-center justify-between gap-3 py-3">
                <dt className="text-sm text-[var(--color-muted)]">{t.package}</dt>
                <dd className="text-sm font-semibold text-[var(--color-heading)]">{packageName}</dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between py-3">
              <dt className="text-sm text-[var(--color-muted)]">{doc.kind === "proposal" ? t.projectTotal : t.total}</dt>
              <dd className="text-lg font-bold tabular-nums text-[var(--color-heading)]">{t.money(totalCents)}</dd>
            </div>
            {depositDue ? (
              <div className="flex items-center justify-between py-3">
                <dt className="text-sm font-semibold text-[var(--color-heading)]">{t.depositRequired}</dt>
                <dd className="text-lg font-bold tabular-nums text-[var(--brand-text)]">{t.money(depositDue)}</dd>
              </div>
            ) : null}
          </dl>

          {terms ? (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-[var(--color-heading)]">{t.termsTitle}</div>
              <p className="max-h-28 overflow-y-auto whitespace-pre-line rounded-xl bg-[var(--color-surface-2)] px-3 py-2.5 text-[13px] leading-5 text-[var(--color-muted)]">
                {terms}
              </p>
              <label className="flex items-start gap-2.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[13px] text-[var(--color-text)]">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(event) => setAgreed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand-accent)]"
                />
                {t.acceptTerms}
              </label>
            </div>
          ) : null}

          <SignaturePad t={t} onChange={setSignature} />

          <div className="space-y-1.5">
            <label className="block text-sm font-semibold text-[var(--color-heading)]" htmlFor="signer">
              {t.fullName}
            </label>
            <Input
              id="signer"
              required
              maxLength={200}
              autoComplete="name"
              value={signer}
              onChange={(event) => setSigner(event.target.value)}
              className="h-10 w-full px-3"
            />
          </div>

          <p className="text-xs leading-5 text-[var(--color-muted)]">
            {t.bySigning(doc.kind, t.money(totalCents), !!terms)}
          </p>
          {locked ? <PreviewNote /> : null}
          <ErrorText message={error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={pending} onClick={onCancel} className="h-9 px-4">
            {t.cancel}
          </Button>
          <button type="submit" disabled={pending || !ready || locked} className={cn(APPROVE_BUTTON, "h-9 px-4 text-[13px]")}>
            <Icon name="checkCircle" />
            {pending ? t.approving : t.approve}
          </button>
        </DialogFooter>
      </form>
    </ProjectModal>
  );
}

function DeclineDialog({
  kind,
  t,
  pending,
  locked,
  error,
  onCancel,
  onDecline,
}: {
  kind: DocumentKind;
  t: DocumentStrings;
  pending: boolean;
  locked: boolean;
  error: string;
  onCancel: () => void;
  onDecline: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <ProjectModal title={t.declineTitle(kind)} onClose={() => !pending && onCancel()}>
      <div className="space-y-2 p-5">
        <label className="block text-xs font-medium text-[var(--color-muted)]" htmlFor="decline-reason">
          {t.declineReason}
        </label>
        <Textarea
          id="decline-reason"
          rows={3}
          maxLength={2000}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="w-full px-3 py-2"
        />
        {locked ? <PreviewNote /> : null}
        <ErrorText message={error} />
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="button" variant="danger" disabled={pending || locked} onClick={() => onDecline(reason)}>
          {pending ? t.declining : t.declineTitle(kind)}
        </Button>
      </DialogFooter>
    </ProjectModal>
  );
}

/** Shown at the top once the customer has approved; a proposal's deposit can be paid from here. */
function ApprovedPanel({
  doc,
  token,
  t,
  depositDue,
}: {
  doc: PublicDocument;
  token: string;
  t: DocumentStrings;
  depositDue: number;
}) {
  const first = doc.signedName?.split(/\s+/)[0];
  return (
    <section className="flex gap-3 rounded-2xl border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-4">
      <Icon name="checkCircle" className="mt-0.5 h-5 w-5 text-[#16a34a]" />
      <div className="min-w-0 flex-1 text-[13px] leading-5 text-[#166534]">
        <p className="text-sm font-semibold">{t.thankYou(first, doc.kind)}</p>
        <p>
          {t.signedOn(doc.signedName, doc.signedAt ? t.dateTime(doc.signedAt) : null)} {t.nextStep(doc.kind, doc.company.name)}
        </p>
        {depositDue ? (
          doc.depositPaid ? (
            <p className="mt-1 flex items-center gap-1.5 font-semibold">
              <Icon name="check" className="h-3.5 w-3.5" />
              {t.depositPaid(t.money(depositDue))}
            </p>
          ) : (
            <>
              <p className="mt-1 font-semibold">{t.depositDue(t.money(depositDue))}</p>
              {/* The deposit invoice behind this proposal, paid by card (payments agent). */}
              {doc.kind === "proposal" ? <PayButton token={token} t={t} className="mt-2" /> : null}
            </>
          )
        ) : null}
      </div>
    </section>
  );
}

/** Good / Better / Best side by side; the customer picks one while the proposal is open. */
function PackageCards({
  packages,
  items,
  activeId,
  open,
  t,
  onSelect,
}: {
  packages: ProposalPackage[];
  items: LineItem[];
  activeId: string | null;
  open: boolean;
  t: DocumentStrings;
  onSelect: (id: string) => void;
}) {
  // Each card spans the same rows (name, price, description, lines, button),
  // so prices and buttons line up across the cards whatever the text length.
  return (
    <ul className={cn("grid gap-3", packages.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      {packages.map((pack) => {
        const active = pack.id === activeId;
        const lines = items.filter((item) => item.packageId === pack.id);
        return (
          <li
            key={pack.id}
            onClick={open && !active ? () => onSelect(pack.id) : undefined}
            className={cn(
              "grid grid-rows-subgrid gap-y-0 rounded-xl border-2 bg-white p-4 transition-colors",
              open ? "row-span-5" : "row-span-4",
              active ? "border-[var(--brand-accent)] shadow-sm" : "border-[var(--color-border)]",
              open && !active && "cursor-pointer hover:border-[var(--color-border-strong)]",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="min-w-0 text-[15px] font-semibold leading-6 text-[var(--color-heading)]">{pack.name}</h3>
              {active && !open ? (
                <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-[var(--brand-accent)] px-2 text-[11px] font-bold uppercase tracking-wide text-white">
                  <Icon name="check" className="h-3 w-3" />
                  {t.selected}
                </span>
              ) : null}
            </div>
            <div className="mt-1 text-[24px] font-bold leading-8 tabular-nums text-[var(--color-heading)]">
              {t.money(packageCents(items, pack.id))}
            </div>
            <p className="mt-1 whitespace-pre-line text-[13px] leading-5 text-[var(--color-muted)]">{pack.description}</p>
            <ul className="mt-3 space-y-1.5 border-t border-[var(--color-border)] pt-3">
              {lines.map((line) => (
                <li key={line.id} className="flex gap-2 text-[13px] leading-5 text-[var(--color-text)]">
                  <Icon name="check" className="mt-0.5 h-3.5 w-3.5 text-[var(--brand-accent)]" />
                  <span className="min-w-0">{line.name}</span>
                </li>
              ))}
            </ul>
            {open ? (
              <button
                type="button"
                aria-pressed={active}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(pack.id);
                }}
                className={cn(
                  "mt-4 inline-flex h-10 items-center justify-center gap-1.5 self-end rounded-lg text-[13px] font-semibold outline-none transition-colors focus-visible:shadow-[var(--focus-ring)]",
                  NO_PRINT,
                  active
                    ? "bg-[var(--brand-accent)] text-white"
                    : "border border-[var(--color-border-strong)] bg-white text-[var(--color-heading)] hover:bg-[var(--color-hover)]",
                )}
              >
                {active ? <Icon name="check" /> : null}
                {active ? t.selected : t.select}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function TotalLine({
  label,
  value,
  className,
}: {
  label: React.ReactNode;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <dt>{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** A proposal or change order: read it, choose, then approve and sign or decline. */
function SignableBody({
  doc,
  token,
  t,
  preview,
}: {
  doc: PublicDocument;
  token: string;
  t: DocumentStrings;
  /** Staff's Customer view: everything opens and the choices work, but nothing is sent. */
  preview: boolean;
}) {
  const router = useRouter();
  const respond = RESPONDERS[doc.kind];
  const open = doc.status === "sent" && !doc.expired && !!respond;
  const packages = doc.packages ?? [];
  const [packageId, setPackageId] = useState(() => chosenPackageId(packages, doc.selectedPackageId));
  const [selected, setSelected] = useState(
    () => new Set(doc.items.filter((item) => isAddOn(item) && item.selected).map((item) => item.id)),
  );
  const [dialog, setDialog] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const photos = doc.assets.filter((asset) => asset.kind === "photo");
  const files = doc.assets.filter((asset) => asset.kind === "file");
  const kind = doc.kind;

  // While open the customer's choices drive the lines; after that, what was approved.
  const items = open
    ? doc.items.map((item) =>
        item.packageId
          ? { ...item, selected: item.packageId === packageId }
          : item.optional
            ? { ...item, selected: selected.has(item.id) }
            : item,
      )
    : doc.items;
  const activePackageId = open ? packageId : (doc.selectedPackageId ?? null);
  const activePackage = packages.find((pack) => pack.id === activePackageId) ?? null;
  const totals = open
    ? documentTotals(items, doc.taxRatePercent, doc.discount ?? NO_DISCOUNT)
    : {
        subtotalCents: doc.subtotalCents,
        discountCents: doc.discountCents ?? 0,
        taxCents: doc.taxCents,
        totalCents: doc.totalCents,
      };
  const baseCents = items.filter((item) => !item.optional).reduce((sum, item) => sum + lineTotalCents(item), 0);
  const upgradesCents = items
    .filter((item) => isAddOn(item) && isIncluded(item))
    .reduce((sum, item) => sum + lineTotalCents(item), 0);
  const deposit =
    kind === "proposal"
      ? depositCents(totals.totalCents, {
          percent: doc.depositPercent ?? null,
          cents: doc.depositPercent == null && doc.depositCents ? doc.depositCents : null,
        })
      : 0;
  const depositLabel = t.depositToStart(doc.depositPercent != null ? Number(doc.depositPercent) : null);
  // The company's page (Settings › Customer proposal page) arranges every
  // document; its own sections, cover and terms show on proposals only.
  const page = doc.company.page;
  const proposal = kind === "proposal";
  const terms = doc.terms || (proposal ? page.terms : "");
  const banner = doc.expired ? null : t.banner[doc.status];
  const shownItems = items.filter((item) => !item.packageId || item.packageId === activePackageId);
  const scope = shownItems.filter((item) => !isAddOn(item));
  const addOns = shownItems.filter(isAddOn);
  const totalLabel = kind === "proposal" ? t.projectTotal : t.total;
  const facts: Array<[string, string]> = [
    [t.dateLabel, doc.sentAt ? t.date(doc.sentAt) : "—"],
    ...(doc.validUntil ? [[t.validUntil, t.date(doc.validUntil)] as [string, string]] : []),
    [t.total, t.money(totals.totalCents)],
  ];

  function submit(action: () => Promise<ActionResult>, fallback: string) {
    startTransition(async () => {
      setError("");
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? fallback);
        return;
      }
      setDialog(null);
      router.refresh();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  function ask(next: "approve" | "decline") {
    setError("");
    setDialog(next);
  }

  /** A part's heading: the company's own wording when it gave one (Settings › Customer proposal page). */
  const heading = (part: ProposalPart, usual: string) =>
    page.blocks.find((block) => block.type === part)?.title || usual;

  /** What each part of the proposal shows; the company's page (Settings) decides where each goes. */
  const parts: Record<ProposalPart, React.ReactNode> = {
    message: <IntroNote doc={doc} title={heading("message", t.noteFrom(doc.company.name))} />,
    packages: packages.length ? (
      <Section
        title={heading("packages", t.choosePackage)}
        hint={open ? t.choosePackageHint : undefined}
        className="public-document-keep"
      >
        <PackageCards
          packages={packages}
          items={items}
          activeId={activePackageId}
          open={open}
          t={t}
          onSelect={setPackageId}
        />
      </Section>
    ) : null,
    scope: scope.length ? (
      <Section title={heading("scope", t.scope)}>
        <LineRows
          items={scope}
          t={t}
          tag={(item) => {
            const pack = item.packageId ? packages.find((candidate) => candidate.id === item.packageId) : null;
            return pack ? (
              <div className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-text)]">
                <Icon name="layers" className="h-3.5 w-3.5" />
                {t.packageLabel(pack.name)}
              </div>
            ) : null;
          }}
        />
      </Section>
    ) : null,
    addOns: addOns.length ? (
      <Section title={heading("addOns", t.addOns)} hint={open ? t.addOnsHint : undefined}>
        <ul className="space-y-2.5">
          {addOns.map((item) => {
            const added = isIncluded(item);
            return (
              <li
                key={item.id}
                className={cn(
                  "public-document-line flex items-center gap-4 rounded-xl border px-4 py-3.5 transition-colors",
                  added
                    ? "border-[var(--brand-accent)] bg-[var(--brand-tint)]"
                    : "border-[var(--color-border-strong)]",
                )}
              >
                <LineText item={item} t={t} />
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <div
                    className={cn(
                      "text-[15px] font-semibold leading-6 tabular-nums",
                      added ? "text-[var(--color-heading)]" : "text-[var(--color-muted)]",
                    )}
                  >
                    {added ? "" : "+ "}
                    {t.money(lineTotalCents(item))}
                  </div>
                  {open ? (
                    <button
                      type="button"
                      aria-pressed={added}
                      onClick={() => toggle(item.id)}
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold outline-none transition-colors focus-visible:shadow-[var(--focus-ring)]",
                        NO_PRINT,
                        added
                          ? "bg-[var(--brand-accent)] text-[var(--brand-ink)]"
                          : "border border-[var(--color-border-strong)] bg-white text-[var(--color-heading)] hover:bg-[var(--color-hover)]",
                      )}
                    >
                      <Icon name={added ? "check" : "plus"} className="h-3.5 w-3.5" />
                      {added ? t.added : t.add}
                    </button>
                  ) : (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 text-xs font-semibold",
                        added ? "text-[var(--brand-text)]" : "text-[var(--color-muted)]",
                      )}
                    >
                      {added ? <Icon name="check" className="h-3 w-3" /> : null}
                      {added ? t.added : t.notIncluded}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>
    ) : null,
    photos: <Photos photos={photos} title={heading("photos", t.photos)} t={t} onView={setViewing} />,
    investment: (
      <Section title={heading("investment", t.yourInvestment)} className="public-document-keep">
        <dl className="public-document-totals space-y-2.5 text-[14px] text-[var(--color-text)]">
          {baseCents || !activePackage ? <TotalLine label={t.lineItemsTotal} value={t.money(baseCents)} /> : null}
          {activePackage ? (
            <TotalLine
              label={t.packageLabel(activePackage.name)}
              value={t.money(packageCents(items, activePackage.id))}
            />
          ) : null}
          {upgradesCents ? <TotalLine label={t.optionalUpgrades} value={t.money(upgradesCents)} /> : null}
          {totals.discountCents ? (
            <TotalLine
              label={t.discount(doc.discount?.percent ?? null)}
              value={`−${t.money(totals.discountCents)}`}
              className="text-[#15803d]"
            />
          ) : null}
          <TotalLine label={t.tax(doc.taxRatePercent)} value={t.money(totals.taxCents)} />
        </dl>
        <div className="mt-4 flex items-end justify-between gap-4 border-t border-[var(--color-border)] pt-4">
          <div className="text-[15px] font-semibold text-[var(--color-heading)]">{totalLabel}</div>
          <div className="text-[30px] font-bold leading-none tracking-tight tabular-nums text-[var(--color-heading)]">
            {t.money(totals.totalCents)}
          </div>
        </div>
        {deposit ? (
          <dl className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-[var(--brand-tint)] px-4 py-3.5">
              <dt className={cn(LABEL, "text-[var(--brand-text)]")}>{depositLabel}</dt>
              <dd className="mt-1 text-[20px] font-bold tabular-nums text-[var(--color-heading)]">
                {t.money(deposit)}
              </dd>
            </div>
            <div className="rounded-xl bg-[var(--color-surface-2)] px-4 py-3.5">
              <dt className={LABEL}>{t.balanceAtCompletion}</dt>
              <dd className="mt-1 text-[20px] font-bold tabular-nums text-[var(--color-heading)]">
                {t.money(totals.totalCents - deposit)}
              </dd>
            </div>
          </dl>
        ) : null}
      </Section>
    ),
    terms: terms ? (
      <Section title={heading("terms", t.terms)}>
        <p className="whitespace-pre-line text-[13px] leading-6 text-[var(--color-muted)]">{terms}</p>
      </Section>
    ) : null,
  };

  const approveButton = (className: string) => (
    <button type="button" className={cn(APPROVE_BUTTON, className)} onClick={() => ask("approve")}>
      <Icon name="checkCircle" />
      {t.approveAndSign}
    </button>
  );

  return (
    <>
      <div className="xl:flex xl:items-start xl:gap-8 xl:pt-6">
        <div className="min-w-0 flex-1 space-y-4">
          {/* Below the widest screens the price and Approve & Sign ride along in this bar; there, in the card beside the sheet. */}
          <div
            className={cn(
              "sticky top-16 z-20 -mx-4 bg-[var(--page-bg)] px-4 pb-1 pt-4 sm:-mx-6 sm:px-6 xl:hidden",
              NO_PRINT,
            )}
          >
            <div className={cn(CARD, "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5 pl-4 pr-2.5")}>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-medium leading-4 text-[var(--color-muted)]">{totalLabel}</div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[19px] font-bold leading-7 tabular-nums text-[var(--color-heading)]">
                    {t.money(totals.totalCents)}
                  </span>
                  {open && deposit ? (
                    <span className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md bg-[var(--brand-tint)] px-1.5 text-xs font-semibold text-[var(--brand-text)]">
                      <Icon name="tag" className="h-3 w-3" />
                      {t.onlyDeposit(t.money(deposit))}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className={cn("flex items-center gap-2", open && "w-full sm:w-auto")}>
                {open ? approveButton("h-10 flex-1 px-4 text-[14px] sm:flex-none") : null}
                <button
                  type="button"
                  aria-label={t.downloadPdf(kind)}
                  title={t.downloadPdf(kind)}
                  onClick={() => void printDocument()}
                  className={cn(OUTLINE_BUTTON, "h-10 px-3 text-[13px]")}
                >
                  <Icon name="download" />
                  <span className="hidden sm:inline">{t.downloadPdf(kind)}</span>
                </button>
              </div>
            </div>
          </div>

          {doc.status === "accepted" ? <ApprovedPanel doc={doc} token={token} t={t} depositDue={deposit} /> : null}
          {doc.expired ? (
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-[13px] font-medium text-[#9a3412]">
              <p>{t.expired(doc.validUntil ? t.date(doc.validUntil) : null)}</p>
              {doc.company.phone ? (
                <a href={`tel:${doc.company.phone}`} className={cn(OUTLINE_BUTTON, "h-8 px-3 text-[13px]", NO_PRINT)}>
                  <Icon name="phone" className="h-3.5 w-3.5" />
                  {t.callUs}
                </a>
              ) : null}
            </section>
          ) : null}
          {banner ? (
            <p
              className={cn(
                "rounded-2xl border px-4 py-3 text-[13px] font-medium",
                doc.status === "declined"
                  ? "border-[#fecaca] bg-[#fef2f2] text-[#991b1b]"
                  : "border-[var(--color-border)] bg-white text-[var(--color-text)]",
              )}
            >
              {banner}
            </p>
          ) : null}

          <Sheet>
            <DocumentHeader
              doc={doc}
              t={t}
              status={doc.expired ? "expired" : doc.status}
              eyebrow={doc.number ? `${t.kind[kind]} #${doc.number}` : t.kind[kind]}
              title={doc.name}
              facts={facts}
              cover={proposal ? page.heroPath : null}
              customerLabel={t.preparedFor}
            />

            {page.blocks.map((block) =>
              isCustomBlock(block) ? (
                proposal && !block.hidden && blockHasContent(block) ? <CustomSection key={block.id} block={block} /> : null
              ) : (
                <Fragment key={block.id}>{parts[block.type]}</Fragment>
              ),
            )}

            {doc.status === "accepted" && (doc.signatureImage || doc.signedName) ? (
              <Section title={t.signature} className="public-document-signature">
                <div className="inline-block min-w-64 border-b border-[var(--color-border-strong)] pb-1">
                  {doc.signatureImage ? (
                    <img src={doc.signatureImage} alt={t.signatureOf(doc.signedName ?? null)} className="h-16 w-auto" />
                  ) : null}
                </div>
                <div className="mt-1 text-[13px] text-[var(--color-muted)]">
                  {doc.signedName}
                  {doc.signedAt ? ` · ${t.dateTime(doc.signedAt)}` : ""}
                </div>
              </Section>
            ) : null}

            <Files doc={doc} t={t} files={files} />
          </Sheet>

          {open ? (
            <p className={cn("pt-1 text-center text-[13px] text-[var(--color-muted)]", NO_PRINT)}>
              {t.notMovingForward}{" "}
              <button
                type="button"
                className="font-medium text-[var(--color-heading)] underline underline-offset-2"
                onClick={() => ask("decline")}
              >
                {t.declineThis(kind)}
              </button>
            </p>
          ) : null}
        </div>

        <aside className={cn("sticky top-[88px] hidden w-[296px] shrink-0 space-y-3 xl:block", NO_PRINT)}>
          <div className={cn(CARD, "p-5")}>
            <div className={LABEL}>{totalLabel}</div>
            <div className="mt-1.5 text-[32px] font-bold leading-none tracking-tight tabular-nums text-[var(--color-heading)]">
              {t.money(totals.totalCents)}
            </div>
            {deposit ? (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-[var(--brand-tint)] px-3 py-2 text-[13px]">
                <span className="text-[var(--brand-text)]">{depositLabel}</span>
                <span className="font-semibold tabular-nums text-[var(--color-heading)]">{t.money(deposit)}</span>
              </div>
            ) : null}
            {open ? approveButton("mt-4 h-11 w-full text-[15px]") : null}
            <button
              type="button"
              onClick={() => void printDocument()}
              className={cn(OUTLINE_BUTTON, "h-10 w-full text-[13px]", open ? "mt-2" : "mt-4")}
            >
              <Icon name="download" />
              {t.downloadPdf(kind)}
            </button>
            {open && doc.validUntil ? (
              <p className="mt-3 text-center text-xs text-[var(--color-muted)]">
                {t.validUntil} {t.date(doc.validUntil)}
              </p>
            ) : null}
          </div>
          {doc.company.phone ? (
            <a
              href={`tel:${doc.company.phone}`}
              className={cn(
                CARD,
                "flex items-center gap-3 px-5 py-4 outline-none transition-colors hover:border-[var(--color-border-strong)] focus-visible:shadow-[var(--focus-ring)]",
              )}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[var(--brand-text)]">
                <Icon name="phone" />
              </span>
              <span className="min-w-0 text-[13px] leading-5">
                <span className="block text-[var(--color-muted)]">{t.questions}</span>
                <span className="block font-semibold text-[var(--color-heading)]">{doc.company.phone}</span>
              </span>
            </a>
          ) : null}
        </aside>
      </div>

      {dialog === "approve" && respond ? (
        <ApproveDialog
          doc={doc}
          t={t}
          terms={terms}
          totalCents={totals.totalCents}
          depositDue={deposit}
          packageName={open ? (activePackage?.name ?? null) : null}
          pending={pending}
          locked={preview}
          error={error}
          onCancel={() => setDialog(null)}
          onApprove={({ signer, signature }) =>
            submit(
              () => respond.accept({ token, signer, signature, selected: [...selected], package: packageId }),
              t.approveFailed,
            )
          }
        />
      ) : null}
      {dialog === "decline" && respond ? (
        <DeclineDialog
          kind={kind}
          t={t}
          pending={pending}
          locked={preview}
          error={error}
          onCancel={() => setDialog(null)}
          onDecline={(reason) => submit(() => respond.decline({ token, reason }), t.declineFailed)}
        />
      ) : null}
      {viewing != null && photos[viewing] ? (
        <PhotoViewer photos={photos} index={viewing} t={t} onIndex={setViewing} onClose={() => setViewing(null)} />
      ) : null}
    </>
  );
}

/** How many columns a row of the given number of cards or numbers takes. */
const CARD_COLUMNS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2",
  5: "sm:grid-cols-3",
  6: "sm:grid-cols-3",
};
const NUMBER_COLUMNS: Record<number, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" };

/** A section the company wrote for its page (Settings › Customer proposal page). */
function CustomSection({ block }: { block: CustomBlock }) {
  const title = block.title ? (
    <h2 className="text-[20px] font-bold leading-tight tracking-tight text-[var(--color-heading)]">{block.title}</h2>
  ) : null;
  switch (block.type) {
    case "text":
      return (
        <section className={cn(PAD, "public-document-keep")}>
          {title}
          {block.body ? (
            <p className={cn("whitespace-pre-line text-[14px] leading-6 text-[var(--color-text)]", title && "mt-3")}>
              {block.body}
            </p>
          ) : null}
        </section>
      );
    case "checklist":
      return (
        <section className={PAD}>
          {title}
          <ul className={cn("grid gap-x-8 gap-y-5 sm:grid-cols-2", title && "mt-5")}>
            {block.points.map((point, index) => (
              <li key={index} className="public-document-keep flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-accent)] text-[var(--brand-ink)]">
                  <Icon name="check" className="h-3 w-3" />
                </span>
                <div className="min-w-0">
                  {point.title ? (
                    <div className="text-[14px] font-semibold leading-5 text-[var(--color-heading)]">{point.title}</div>
                  ) : null}
                  {point.body ? (
                    <p className="mt-0.5 whitespace-pre-line text-[13px] leading-5 text-[var(--color-muted)]">{point.body}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      );
    case "cards":
      return (
        <section className={cn(PAD, "public-document-keep")}>
          {title}
          <ul className={cn("grid gap-x-8 gap-y-7", CARD_COLUMNS[block.cards.length], title && "mt-5")}>
            {block.cards.map((card, index) => (
              <li key={index}>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[var(--brand-text)]">
                  <CardGlyph icon={card.icon} />
                </span>
                {card.title ? (
                  <h3 className="mt-3 text-[15px] font-semibold leading-5 text-[var(--color-heading)]">{card.title}</h3>
                ) : null}
                {card.body ? <p className="mt-1.5 text-[13px] leading-5 text-[var(--color-muted)]">{card.body}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      );
    case "numbers":
      return (
        <section className={cn(PAD, "public-document-keep")}>
          {title}
          <dl
            className={cn(
              "grid gap-5 text-center sm:gap-0 sm:divide-x sm:divide-[var(--color-border)]",
              NUMBER_COLUMNS[block.numbers.length],
              title && "mt-5",
            )}
          >
            {block.numbers.map((item, index) => (
              <div key={index} className="flex flex-col-reverse sm:px-4">
                <dt className="mt-0.5 text-xs text-[var(--color-muted)]">{item.label}</dt>
                <dd className="text-[24px] font-bold leading-8 tracking-tight tabular-nums text-[var(--color-heading)]">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      );
    case "image":
      return block.path ? (
        <section className={cn(PAD, "public-document-keep")}>
          {title}
          <img
            src={documentAssetUrl(block.path)}
            alt={block.title}
            loading="lazy"
            className={cn("w-full rounded-xl bg-[var(--color-surface-2)]", title && "mt-4")}
          />
        </section>
      ) : null;
    case "video": {
      const embed = videoEmbedUrl(block.url);
      return embed ? (
        <section className={cn(PAD, NO_PRINT)}>
          {title}
          <div className={cn("aspect-video overflow-hidden rounded-xl bg-black", title && "mt-4")}>
            <iframe
              src={embed}
              title={block.title || "Video"}
              loading="lazy"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="h-full w-full"
            />
          </div>
        </section>
      ) : null;
    }
  }
}

/** The company's own words to this customer. */
function IntroNote({ doc, title }: { doc: PublicDocument; title: string }) {
  return doc.intro ? (
    <section className={cn(PAD, "public-document-keep")}>
      <div className="rounded-xl bg-[var(--brand-tint)] px-5 py-4">
        <h2 className="text-[13px] font-semibold text-[var(--brand-text)]">{title}</h2>
        <p className="mt-1.5 whitespace-pre-line text-[14px] leading-6 text-[var(--color-text)]">{doc.intro}</p>
      </div>
    </section>
  ) : null;
}

function Photos({
  photos,
  title,
  t,
  onView,
}: {
  photos: DocumentAsset[];
  title: string;
  t: DocumentStrings;
  onView: (index: number) => void;
}) {
  if (!photos.length) return null;
  return (
    <Section title={title}>
      <ul className="public-document-photos grid grid-cols-2 gap-3 sm:grid-cols-4">
        {photos.map((photo, index) => (
          <li key={photo.id} className="public-document-photo">
            <button
              type="button"
              aria-label={t.viewPhoto(photo.name)}
              onClick={() => onView(index)}
              className="block aspect-[4/3] w-full overflow-hidden rounded-xl bg-[var(--color-surface-2)] outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              <img src={documentAssetUrl(photo.path)} alt={photo.name} loading="lazy" className="h-full w-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** On phones and paper, the files the sidebar holds on wide screens. */
function Files({ doc, t, files }: { doc: PublicDocument; t: DocumentStrings; files: DocumentAsset[] }) {
  if (!files.length && !doc.companyDocuments.length) return null;
  return (
    <Section title={t.documents} className="lg:hidden print:block">
      <div className="-mx-3 space-y-3">
        {files.length ? <FileLinks files={files} /> : null}
        {doc.companyDocuments.length ? (
          <div>
            <div className={cn(LABEL, "mb-1 px-3")}>{t.insurance}</div>
            <FileLinks files={doc.companyDocuments} />
          </div>
        ) : null}
      </div>
    </Section>
  );
}

/** An invoice: the balance and the pay button first, then the invoice itself. */
function InvoiceBody({ doc, token, t }: { doc: PublicDocument; token: string; t: DocumentStrings }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const photos = doc.assets.filter((asset) => asset.kind === "photo");
  const files = doc.assets.filter((asset) => asset.kind === "file");
  const paid = doc.paidCents ?? 0;
  const balance = Math.max(doc.balanceCents ?? doc.totalCents - paid, 0);
  const settled = doc.status === "paid" || balance <= 0;
  const payments = doc.payments ?? [];
  const issued = doc.issuedOn ?? doc.sentAt;
  const facts: Array<[string, string]> = [
    [t.dateLabel, issued ? t.date(issued) : "—"],
    [t.dueDate, doc.dueOn ? t.date(doc.dueOn) : "—"],
    [t.balance, t.money(balance)],
  ];
  const banner = doc.status === "void" ? t.banner.void : null;

  return (
    <>
      {doc.status !== "void" ? (
        <section
          className={cn(
            "flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-4 shadow-sm",
            settled ? "bg-[#15803d] text-white" : "bg-[var(--brand-accent)] text-[var(--brand-ink)]",
            NO_PRINT,
          )}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20">
              <Icon name={settled ? "checkCircle" : "dollar"} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="text-[19px] font-bold leading-7 tabular-nums">
                {settled ? t.paidInFull : t.balanceDueBanner(t.money(balance))}
              </div>
              <div className="text-[13px] tabular-nums opacity-85">{t.paidRemaining(t.money(paid), t.money(balance))}</div>
            </div>
          </div>
          {settled ? null : (
            // The card checkout, restyled for the banner: a white button on the company's colour.
            <PayButton
              token={token}
              t={t}
              className="w-full sm:w-auto [&_button]:bg-white [&_button]:text-[#111113] [&_button:hover]:bg-white/90 [&_p]:text-current [&_p]:opacity-85"
            />
          )}
        </section>
      ) : null}
      {banner ? (
        <p className="rounded-2xl border border-[var(--color-border)] bg-white px-4 py-3 text-[13px] font-medium text-[var(--color-text)]">
          {banner}
        </p>
      ) : null}

      <Sheet>
        <DocumentHeader
          doc={doc}
          t={t}
          status={doc.status}
          eyebrow={doc.number ? `${t.kind.invoice} #${doc.number}` : t.kind.invoice}
          title={doc.name}
          facts={facts}
          customerLabel={t.billTo}
          action={
            <button
              type="button"
              onClick={() => void printDocument()}
              className={cn(OUTLINE_BUTTON, "h-9 px-3 text-[13px]", NO_PRINT)}
            >
              <Icon name="download" className="h-3.5 w-3.5" />
              {t.downloadInvoice}
            </button>
          }
        />

        <IntroNote doc={doc} title={t.noteFrom(doc.company.name)} />

        <Section title={t.items}>
          <LineRows items={doc.items.filter(isIncluded)} t={t} />
          <dl className="public-document-totals ml-auto mt-8 w-full max-w-xs space-y-2 border-t border-[var(--color-border)] pt-4 text-[14px] text-[var(--color-text)]">
            <TotalLine label={t.invoiceAmount} value={t.money(doc.subtotalCents)} />
            <TotalLine label={t.tax(doc.taxRatePercent)} value={t.money(doc.taxCents)} />
            <TotalLine
              label={t.total}
              value={t.money(doc.totalCents)}
              className="text-[15px] font-bold text-[var(--color-heading)]"
            />
          </dl>
        </Section>

        {payments.length ? (
          <Section title={t.payments}>
            <ul className="-my-3 divide-y divide-[var(--color-border)]">
              {payments.map((payment) => (
                <li key={payment.id} className="public-document-line flex items-center justify-between gap-3 py-3 text-[13px]">
                  <span className="flex min-w-0 items-center gap-2.5 text-[var(--color-text)]">
                    <Icon name="checkCircle" className="text-[#16a34a]" />
                    <span className="min-w-0">
                      {[
                        t.date(payment.paidOn),
                        t.method[payment.method] ?? payment.method,
                        payment.reference,
                        doc.invoiceKind === "deposit" ? t.depositNote : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-[#15803d]">{t.money(payment.amountCents)}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <section className={cn(PAD, "public-document-totals flex items-end justify-between gap-4")}>
          <span className="text-[15px] font-semibold text-[var(--color-heading)]">{t.amountDue}</span>
          <span className="text-[30px] font-bold leading-none tracking-tight tabular-nums text-[var(--color-heading)]">
            {t.money(balance)}
          </span>
        </section>

        <Photos photos={photos} title={t.photos} t={t} onView={setViewing} />
        <Files doc={doc} t={t} files={files} />
      </Sheet>
      {viewing != null && photos[viewing] ? (
        <PhotoViewer photos={photos} index={viewing} t={t} onIndex={setViewing} onClose={() => setViewing(null)} />
      ) : null}
    </>
  );
}

/** The document a customer opens from a private link (/p, /co, /i). */
export function PublicDocumentView({
  doc,
  token,
  preview = false,
}: {
  doc: PublicDocument;
  token: string;
  /** Staff's Customer view of a proposal: nothing is approved, declined or marked viewed. */
  preview?: boolean;
}) {
  const t = documentStrings(doc.company.timezone);
  const files = doc.assets.filter((asset) => asset.kind === "file");

  return (
    <div>
      <CustomerShell
        company={doc.company}
        callLabel={t.callUs}
        menuLabel={t.menu}
        nav={documentNav(doc, t, preview)}
        links={companyLinks(doc.company)}
        linkLabels={{ website: t.website, reviews: t.reviews, followUs: t.followUs }}
        sidebarExtra={
          files.length || doc.companyDocuments.length ? (
            <>
              {files.length ? <SidebarFiles label={t.documents} files={files} /> : null}
              {doc.companyDocuments.length ? <SidebarFiles label={t.insurance} files={doc.companyDocuments} /> : null}
            </>
          ) : null
        }
        wide={doc.kind !== "invoice"}
        className="public-document"
        mainClassName={cn("public-document-main", doc.kind === "invoice" && "pt-20")}
      >
        {doc.kind === "invoice" ? (
          <InvoiceBody doc={doc} token={token} t={t} />
        ) : (
          <SignableBody doc={doc} token={token} t={t} preview={preview} />
        )}
      </CustomerShell>
      {preview ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 print:hidden">
          <p className="rounded-full bg-[#111113] px-4 py-2 text-center text-[13px] text-white shadow-lg">
            Preview of what your customer sees. Nothing you do here is sent or saved.
          </p>
        </div>
      ) : null}
    </div>
  );
}
