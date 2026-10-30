"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptPublicChangeOrder, declinePublicChangeOrder } from "@/lib/actions/billing";
import { acceptPublicProposal, declinePublicProposal } from "@/lib/actions/proposals";
import type { ActionResult } from "@/lib/actions/rpc";
import {
  DOCUMENT_LANGUAGE_COOKIE,
  documentStrings,
  type CustomerLanguage,
  type DocumentStrings,
} from "@/lib/customer-i18n";
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
import type { CompanyDocument, DocumentAsset, DocumentKind, PublicDocument } from "@/lib/proposal-types";
import { CompanyLogo, CustomerShell, type ShellNavItem } from "./customer-shell";
import { PayButton } from "./pay-button";
import { ProjectModal } from "./project-profile-panel";
import { Button, Input, Textarea, cn } from "./ui";

// The customer's page follows the DripJobs customer portal the company used
// before, inside the portal's frame (customer-shell.tsx). Proposals and change
// orders: a sticky bar at the top with the live total and Approve & Sign, a
// dark header card, packages and optional items the customer chooses, and a
// "Your Investment" summary. Invoices: a balance banner with the pay button,
// a dark header card, items, totals and payments.

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

const APPROVE_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[#16a34a] font-semibold text-white shadow-sm outline-none transition-colors hover:bg-[#15803d] focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50";
const OUTLINE_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border-strong)] bg-white font-medium text-[var(--color-heading)] outline-none transition-colors hover:bg-[var(--color-hover)] focus-visible:shadow-[var(--focus-ring)]";
const FACT_LABEL = "text-[11px] font-semibold uppercase tracking-wider";

const ICONS = {
  check: "M20 6 9 17l-5-5",
  checkCircle: "M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3",
  minusCircle: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM8 12h8",
  plus: "M12 5v14M5 12h14",
  x: "M18 6 6 18M6 6l12 12",
  tag: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8ZM7 7h.01",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h5",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  layers: "M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5",
  image:
    "M21 15V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2ZM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM21 15l-5-5L5 21",
  calculator:
    "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM8 6h8M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h4",
  note: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2ZM8 9h8M8 13h5",
  user: "M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z",
  pin: "M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12ZM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z",
  building:
    "M4 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M16 9h2a2 2 0 0 1 2 2v11M2 22h20M8 6h4M8 10h4M8 14h4M8 18h4",
  folder:
    "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z",
  phone:
    "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  pen: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  card: "M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2ZM2 10h20M6 15h4",
  dollar: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
} as const;

type IconName = keyof typeof ICONS;

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
        STATUS_PILL_CLASSES[status] ?? "bg-white/15 text-white",
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {t.status[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

const TILES = {
  dark: "bg-[#111113]",
  green: "bg-[#16a34a]",
};

/** A white card with the dark icon tile and title DripJobs uses for every section. */
function Section({
  icon,
  title,
  tile = "dark",
  children,
  className,
}: {
  icon: IconName;
  title: string;
  tile?: keyof typeof TILES;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border border-[var(--color-border)] bg-white p-4 sm:p-6", className)}>
      <h2 className="mb-4 flex items-center gap-3 text-[16px] font-semibold text-[var(--color-heading)]">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white", TILES[tile])}>
          <Icon name={icon} />
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function InfoBlock({ icon, label, children }: { icon: IconName; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] bg-white text-[var(--color-muted)]">
        <Icon name={icon} />
      </span>
      <div className="min-w-0 text-[13px] leading-5 [overflow-wrap:anywhere]">
        <div className={cn(FACT_LABEL, "mb-0.5 text-[var(--color-muted)]")}>{label}</div>
        {children}
      </div>
    </div>
  );
}

const FACT_COLUMNS: Record<number, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" };

/**
 * The dark card at the top of every document: the company's letterhead and
 * the status, the document's title, its key facts, then a light strip.
 */
function HeaderCard({
  doc,
  t,
  status,
  eyebrow,
  title,
  subtitle,
  action,
  facts,
  children,
}: {
  doc: PublicDocument;
  t: DocumentStrings;
  status: string;
  eyebrow?: string;
  title: string;
  subtitle?: string | null;
  /** Beside the title, e.g. the invoice's download button. */
  action?: React.ReactNode;
  facts: Array<[string, string]>;
  /** The light strip under the dark part. */
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white shadow-sm">
      <div className="bg-[#0f1115] px-5 py-5 text-white sm:px-6 sm:py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1.5">
              <CompanyLogo company={doc.company} className="h-full w-full text-[15px]" />
            </span>
            <div className="min-w-0 text-[13px] leading-5">
              <div className="truncate text-[15px] font-semibold">{doc.company.name}</div>
              {doc.company.address ? <div className="truncate text-white/60">{doc.company.address}</div> : null}
              {doc.company.phone ? <div className="truncate text-white/60">{doc.company.phone}</div> : null}
            </div>
          </div>
          <StatusPill status={status} t={t} />
        </div>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            {eyebrow ? <div className={cn(FACT_LABEL, "mb-1 text-white/50")}>{eyebrow}</div> : null}
            <h1 className="text-[26px] font-bold leading-tight tracking-tight [overflow-wrap:anywhere]">{title}</h1>
            {subtitle ? <div className="mt-1 text-[14px] text-white/60">{subtitle}</div> : null}
          </div>
          {action}
        </div>
        <dl className={cn("mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/15 pt-4", FACT_COLUMNS[facts.length])}>
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className={cn(FACT_LABEL, "mb-0.5 text-white/50")}>{label}</dt>
              <dd className="text-[15px] font-semibold leading-5 tabular-nums [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {children}
    </section>
  );
}

/** One line on the document: name, quantity and description, its total on the right. */
function LineCard({
  item,
  t,
  strip,
  tag,
  counted = true,
  className,
}: {
  item: LineItem;
  t: DocumentStrings;
  /** A coloured bar across the top (optional items). */
  strip?: React.ReactNode;
  /** A small label above the name (the item's package). */
  tag?: React.ReactNode;
  counted?: boolean;
  className?: string;
}) {
  return (
    <li className={cn("public-document-line overflow-hidden rounded-xl border bg-white", className)}>
      {strip}
      <div className="px-4 py-3.5">
        {tag}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 text-[15px] font-semibold leading-6 text-[var(--color-heading)]">{item.name}</div>
          <div
            className={cn(
              "shrink-0 text-[15px] font-semibold leading-6 tabular-nums",
              counted ? "text-[var(--color-heading)]" : "text-[var(--color-faint)]",
            )}
          >
            {t.money(lineTotalCents(item))}
          </div>
        </div>
        {item.quantity !== 1 ? (
          <div className="text-[13px] tabular-nums text-[var(--color-muted)]">
            {item.quantity} × {t.money(item.unitPriceCents)}
          </div>
        ) : null}
        {item.description ? (
          <p className="mt-1 whitespace-pre-line text-[13px] leading-5 text-[var(--color-muted)]">{item.description}</p>
        ) : null}
      </div>
    </li>
  );
}

function FileLinks({ files }: { files: Array<DocumentAsset | CompanyDocument> }) {
  return (
    <ul className="space-y-1">
      {files.map((file) => (
        <li key={file.id} className="public-document-file">
          <a
            href={downloadUrl(file)}
            className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-[13px] text-[var(--color-text)] hover:bg-[var(--color-hover)]"
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

/** Documents and insurance in the sidebar, each group opening and closing like DripJobs'. */
function SidebarFiles({
  icon,
  label,
  files,
}: {
  icon: IconName;
  label: string;
  files: Array<DocumentAsset | CompanyDocument>;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-[14px] font-medium text-[var(--color-text)] hover:bg-[var(--color-hover)]"
      >
        <Icon name={icon} className="text-[var(--color-muted)]" />
        <span className="flex-1 text-left">{label}</span>
        <span className="text-xs text-[var(--color-muted)]">{files.length}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={cn("h-3.5 w-3.5 text-[var(--color-muted)] transition-transform", !open && "-rotate-90")}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div className="pl-2">
          <FileLinks files={files} />
        </div>
      ) : null}
    </div>
  );
}

const CURRENT_NAV: Record<DocumentKind, keyof DocumentStrings["nav"]> = {
  proposal: "proposals",
  change_order: "changeOrders",
  invoice: "invoices",
};

/** The portal's sections, linking back into it; the one for this document's kind is highlighted. */
function documentNav(doc: PublicDocument, t: DocumentStrings): ShellNavItem[] {
  const current = CURRENT_NAV[doc.kind];
  // Without a customer contact there is no portal: only this document.
  if (!doc.portalToken) return [{ key: "document", label: t.myDocument(doc.kind), icon: "file", active: true }];
  const base = `/portal/${encodeURIComponent(doc.portalToken)}`;
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
    href: `${base}?view=${key}`,
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
  totalCents,
  depositDue,
  packageName,
  pending,
  error,
  onCancel,
  onApprove,
}: {
  doc: PublicDocument;
  t: DocumentStrings;
  totalCents: number;
  depositDue: number;
  packageName: string | null;
  pending: boolean;
  error: string;
  onCancel: () => void;
  onApprove: (input: { signer: string; signature: string }) => void;
}) {
  const [signer, setSigner] = useState(doc.customer.name ?? "");
  const [signature, setSignature] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(!doc.terms);
  const ready = !!signer.trim() && !!signature && agreed;
  return (
    <ProjectModal title={t.approveTitle(doc.kind)} onClose={() => !pending && onCancel()}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && signature) onApprove({ signer: signer.trim(), signature });
        }}
      >
        <div className="space-y-4 p-5">
          <dl className="divide-y divide-[var(--color-border)] rounded-xl bg-[#f8fafc] px-4">
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
                <dd className="text-lg font-bold tabular-nums text-[#16a34a]">{t.money(depositDue)}</dd>
              </div>
            ) : null}
          </dl>

          {doc.terms ? (
            <div className="space-y-2">
              <div className="text-sm font-semibold text-[var(--color-heading)]">{t.termsTitle}</div>
              <p className="max-h-28 overflow-y-auto whitespace-pre-line rounded-xl bg-[#f8fafc] px-3 py-2.5 text-[13px] leading-5 text-[var(--color-muted)]">
                {doc.terms}
              </p>
              <label className="flex items-start gap-2.5 rounded-lg border border-[#bfdbfe] bg-[#eff6ff] px-3 py-2.5 text-[13px] text-[#1e3a8a]">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(event) => setAgreed(event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#2563eb]"
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
            {t.bySigning(doc.kind, t.money(totalCents), !!doc.terms)}
          </p>
          <ErrorText message={error} />
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={pending} onClick={onCancel} className="h-9 px-4">
            {t.cancel}
          </Button>
          <button type="submit" disabled={pending || !ready} className={cn(APPROVE_BUTTON, "h-9 px-4 text-[13px]")}>
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
  error,
  onCancel,
  onDecline,
}: {
  kind: DocumentKind;
  t: DocumentStrings;
  pending: boolean;
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
        <ErrorText message={error} />
      </div>
      <DialogFooter>
        <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="button" variant="danger" disabled={pending} onClick={() => onDecline(reason)}>
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
    <div className={cn("flex items-center justify-between gap-3 px-3 py-2", className)}>
      <dt>{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

/** A proposal or change order: read it, choose, then approve and sign or decline. */
function SignableBody({
  doc,
  token,
  t,
}: {
  doc: PublicDocument;
  token: string;
  t: DocumentStrings;
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
  const banner = doc.expired ? null : t.banner[doc.status];
  const shownItems = items.filter((item) => !item.packageId || item.packageId === activePackageId);
  const hasSidebarFiles = files.length > 0 || doc.companyDocuments.length > 0;
  const facts: Array<[string, string]> = [
    ...(doc.number ? [[t.number(kind), doc.number] as [string, string]] : []),
    [t.dateLabel, doc.sentAt ? t.date(doc.sentAt) : "—"],
    [t.total, t.money(totals.totalCents)],
    ...(doc.validUntil ? [[t.validUntil, t.date(doc.validUntil)] as [string, string]] : []),
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

  return (
    <>
      <div className={cn("sticky top-16 z-20 -mx-4 bg-[#f3f4f6] px-4 pb-1 pt-4 sm:-mx-6 sm:px-6", NO_PRINT)}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-[var(--color-border)] bg-white py-2.5 pl-4 pr-2.5 shadow-sm">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium leading-4 text-[var(--color-muted)]">
              {kind === "proposal" ? t.projectTotal : t.total}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-[19px] font-bold leading-7 tabular-nums text-[var(--color-heading)]">
                {t.money(totals.totalCents)}
              </span>
              {open && deposit ? (
                <span className="inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-md border border-[#bbf7d0] bg-[#f0fdf4] px-1.5 text-xs font-semibold text-[#15803d]">
                  <Icon name="tag" className="h-3 w-3" />
                  {t.onlyDeposit(t.money(deposit))}
                </span>
              ) : null}
            </div>
          </div>
          <div className={cn("flex items-center gap-2", open && "w-full sm:w-auto")}>
            {open ? (
              <button
                type="button"
                className={cn(APPROVE_BUTTON, "h-10 flex-1 px-4 text-[14px] sm:flex-none")}
                onClick={() => {
                  setError("");
                  setDialog("approve");
                }}
              >
                <Icon name="checkCircle" />
                {t.approveAndSign}
              </button>
            ) : null}
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

      <HeaderCard
        doc={doc}
        t={t}
        status={doc.expired ? "expired" : doc.status}
        eyebrow={t.kind[kind]}
        title={doc.name}
        facts={facts}
      >
        <div className="grid gap-4 bg-[#f8fafc] px-5 py-4 sm:grid-cols-[1.25fr_1fr_1fr] sm:px-6">
          <InfoBlock icon="user" label={t.preparedFor}>
            <div className="font-semibold text-[var(--color-heading)]">{doc.customer.name ?? "—"}</div>
            {doc.customer.email ? <div className="text-[var(--color-muted)]">{doc.customer.email}</div> : null}
            {doc.customer.phone ? <div className="text-[var(--color-muted)]">{doc.customer.phone}</div> : null}
          </InfoBlock>
          <InfoBlock icon="pin" label={t.projectLocation}>
            <div className="font-semibold text-[var(--color-heading)]">{doc.customer.address ?? "—"}</div>
          </InfoBlock>
          <InfoBlock icon="building" label={t.company}>
            <div className="font-semibold text-[var(--color-heading)]">{doc.company.name}</div>
            {doc.company.address ? <div className="text-[var(--color-muted)]">{doc.company.address}</div> : null}
            {doc.company.phone ? <div className="text-[var(--color-muted)]">{doc.company.phone}</div> : null}
          </InfoBlock>
        </div>
      </HeaderCard>

      <IntroNote doc={doc} t={t} />

      {packages.length ? (
        <Section icon="layers" title={t.choosePackage} className="public-document-keep">
          {open ? <p className={cn("-mt-2 mb-3 text-[13px] text-[var(--color-muted)]", NO_PRINT)}>{t.choosePackageHint}</p> : null}
          <PackageCards
            packages={packages}
            items={items}
            activeId={activePackageId}
            open={open}
            t={t}
            onSelect={setPackageId}
          />
        </Section>
      ) : null}

      <Section icon="list" title={t.lineItems}>
        <ul className="space-y-3">
          {shownItems.map((item) => {
            const counted = isIncluded(item);
            const addOn = isAddOn(item);
            const pack = item.packageId ? packages.find((candidate) => candidate.id === item.packageId) : null;
            return (
              <LineCard
                key={item.id}
                item={item}
                t={t}
                counted={counted}
                className={cn(
                  !addOn && "border-[var(--color-border)]",
                  addOn && counted && "border-[#86efac]",
                  addOn && !counted && "border-dashed border-[#fdba74]",
                )}
                tag={
                  pack ? (
                    <div className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-accent)]">
                      <Icon name="layers" className="h-3.5 w-3.5" />
                      {t.packageLabel(pack.name)}
                    </div>
                  ) : null
                }
                strip={
                  addOn ? (
                    <div
                      className={cn(
                        "flex min-h-10 items-center justify-between gap-2 px-4 text-xs font-semibold",
                        counted ? "bg-[#f0fdf4] text-[#15803d]" : "bg-[#fff7ed] text-[#c2410c]",
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <Icon name={counted ? "checkCircle" : "minusCircle"} className="h-3.5 w-3.5" />
                        {counted ? t.addedTo(kind) : t.notIncluded}
                      </span>
                      {open ? (
                        <button
                          type="button"
                          onClick={() => toggle(item.id)}
                          className={cn(
                            "inline-flex h-7 items-center gap-1 rounded-md px-2.5 outline-none transition-colors focus-visible:shadow-[var(--focus-ring)]",
                            counted
                              ? "border border-[#86efac] bg-white text-[#15803d] hover:bg-[#f0fdf4]"
                              : "bg-[#f97316] text-white hover:bg-[#ea580c]",
                            NO_PRINT,
                          )}
                        >
                          <Icon name={counted ? "x" : "plus"} className="h-3 w-3" />
                          {counted ? t.remove : t.add}
                        </button>
                      ) : null}
                    </div>
                  ) : null
                }
              />
            );
          })}
        </ul>
      </Section>

      <MediaAndFiles doc={doc} t={t} photos={photos} files={files} show={hasSidebarFiles} onView={setViewing} />

      <Section icon="calculator" title={t.yourInvestment} className="public-document-keep">
        <dl className="public-document-totals space-y-1 text-sm text-[var(--color-heading)]">
          {baseCents || !activePackage ? <TotalLine label={t.lineItemsTotal} value={t.money(baseCents)} /> : null}
          {activePackage ? (
            <TotalLine
              label={t.packageLabel(activePackage.name)}
              value={t.money(packageCents(items, activePackage.id))}
            />
          ) : null}
          {upgradesCents ? (
            <TotalLine
              label={
                <span className="flex items-center gap-1.5">
                  <Icon name="checkCircle" className="h-3.5 w-3.5" />
                  {t.optionalUpgrades}
                </span>
              }
              value={t.money(upgradesCents)}
              className="rounded-lg border border-[#bbf7d0] bg-[#f0fdf4] font-semibold text-[#15803d]"
            />
          ) : null}
          {totals.discountCents ? (
            <TotalLine
              label={t.discount(doc.discount?.percent ?? null)}
              value={`−${t.money(totals.discountCents)}`}
              className="text-[#15803d]"
            />
          ) : null}
          <TotalLine label={t.tax(doc.taxRatePercent)} value={t.money(totals.taxCents)} />
          {deposit ? (
            <TotalLine
              label={t.depositToStart(doc.depositPercent != null ? Number(doc.depositPercent) : null)}
              value={t.money(deposit)}
              className="rounded-lg bg-[#eff6ff] font-semibold text-[#1d4ed8]"
            />
          ) : null}
        </dl>
        <div className="mt-3 flex items-end justify-between gap-4 rounded-xl bg-black px-4 py-3.5 text-white">
          <div>
            <div className="text-xs text-white/60">{kind === "proposal" ? t.projectTotal : t.total}</div>
            <div className="text-2xl font-bold tabular-nums">{t.money(totals.totalCents)}</div>
          </div>
          {deposit ? (
            <div className="text-right">
              <div className="text-xs text-white/60">{t.balanceAtCompletion}</div>
              <div className="text-lg font-bold tabular-nums">{t.money(totals.totalCents - deposit)}</div>
            </div>
          ) : null}
        </div>
      </Section>

      {doc.terms ? (
        <Section icon="file" title={t.terms}>
          <p className="whitespace-pre-line rounded-xl bg-[#f8fafc] px-4 py-3 text-[13px] leading-5 text-[var(--color-text)]">
            {doc.terms}
          </p>
        </Section>
      ) : null}

      {doc.status === "accepted" && (doc.signatureImage || doc.signedName) ? (
        <Section icon="pen" title={t.signature} className="public-document-signature">
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

      {open ? (
        <p className={cn("pt-2 text-center text-[13px] text-[var(--color-muted)]", NO_PRINT)}>
          {t.notMovingForward}{" "}
          <button
            type="button"
            className="font-medium text-[var(--color-heading)] underline underline-offset-2"
            onClick={() => {
              setError("");
              setDialog("decline");
            }}
          >
            {t.declineThis(kind)}
          </button>
        </p>
      ) : null}

      {dialog === "approve" && respond ? (
        <ApproveDialog
          doc={doc}
          t={t}
          totalCents={totals.totalCents}
          depositDue={deposit}
          packageName={open ? (activePackage?.name ?? null) : null}
          pending={pending}
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

function IntroNote({ doc, t }: { doc: PublicDocument; t: DocumentStrings }) {
  return doc.intro ? (
    <section className="flex gap-3 rounded-2xl border border-[#fcd34d] bg-[#fffbeb] p-4 sm:p-5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#fbbf24] text-white">
        <Icon name="note" />
      </span>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-[#92400e]">{t.noteFrom(doc.company.name)}</h2>
        <p className="mt-1 whitespace-pre-line text-[13px] leading-5 text-[#78350f]">{doc.intro}</p>
      </div>
    </section>
  ) : null;
}

/** Photos, and on phones (and paper) the files the sidebar holds on wide screens. */
function MediaAndFiles({
  doc,
  t,
  photos,
  files,
  show,
  onView,
}: {
  doc: PublicDocument;
  t: DocumentStrings;
  photos: DocumentAsset[];
  files: DocumentAsset[];
  show: boolean;
  onView: (index: number) => void;
}) {
  return (
    <>
      {photos.length ? (
        <Section icon="image" title={t.media}>
          <ul className="public-document-photos grid grid-cols-2 gap-3 sm:grid-cols-4">
            {photos.map((photo, index) => (
              <li key={photo.id} className="public-document-photo rounded-xl border border-[var(--color-border)] bg-white p-1.5">
                <button
                  type="button"
                  aria-label={t.viewPhoto(photo.name)}
                  onClick={() => onView(index)}
                  className="block aspect-[3/4] w-full overflow-hidden rounded-lg bg-[var(--color-surface-2)] outline-none focus-visible:shadow-[var(--focus-ring)]"
                >
                  <img src={documentAssetUrl(photo.path)} alt={photo.name} loading="lazy" className="h-full w-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {show ? (
        <Section icon="folder" title={t.documents} className="lg:hidden print:block">
          <div className="space-y-3">
            {files.length ? <FileLinks files={files} /> : null}
            {doc.companyDocuments.length ? (
              <div>
                <div className={cn(FACT_LABEL, "mb-1 px-2 text-[var(--color-muted)]")}>{t.insurance}</div>
                <FileLinks files={doc.companyDocuments} />
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}
    </>
  );
}

/** An invoice, laid out like DripJobs' "Pay Invoice" page: balance and pay buttons first. */
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
    [t.contact, doc.customer.name ?? "—"],
    [t.jobAddress, doc.customer.address ?? "—"],
    [t.dateLabel, issued ? t.date(issued) : "—"],
    [t.dueDate, doc.dueOn ? t.date(doc.dueOn) : "—"],
  ];
  const banner = doc.status === "void" ? t.banner.void : null;
  const stripLabel = cn(FACT_LABEL, "mb-0.5 text-[var(--color-muted)]");

  return (
    <>
      {doc.status !== "void" ? (
        <section
          className={cn(
            "flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-gradient-to-r px-5 py-4 text-white shadow-sm",
            settled ? "from-[#15803d] to-[#22c55e]" : "from-[#2563eb] to-[#06b6d4]",
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
              <div className="text-[13px] tabular-nums text-white/85">{t.paidRemaining(t.money(paid), t.money(balance))}</div>
            </div>
          </div>
          {settled ? null : (
            // The card checkout, restyled for the banner: white with blue text.
            <PayButton
              token={token}
              t={t}
              className="w-full sm:w-auto [&_button]:bg-white [&_button]:text-[#1d4ed8] [&_button:hover]:bg-white/90 [&_p]:text-white/85"
            />
          )}
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

      <HeaderCard
        doc={doc}
        t={t}
        status={doc.status}
        title={doc.number ? `${t.kind.invoice} #${doc.number}` : doc.name}
        subtitle={doc.number ? doc.name : null}
        facts={facts}
        action={
          <button
            type="button"
            onClick={() => void printDocument()}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-3 text-[13px] font-medium text-white outline-none transition-colors hover:bg-white/20 focus-visible:shadow-[var(--focus-ring)]",
              NO_PRINT,
            )}
          >
            <Icon name="download" className="h-3.5 w-3.5" />
            {t.downloadInvoice}
          </button>
        }
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-5 py-4 text-[13px] leading-5 sm:grid-cols-[1.4fr_1fr_1fr_1fr] sm:px-6">
          <div className="col-span-2 min-w-0 [overflow-wrap:anywhere] sm:col-span-1">
            <dt className={stripLabel}>{t.billTo}</dt>
            <dd className="font-semibold text-[var(--color-heading)]">{doc.customer.name ?? "—"}</dd>
            {doc.customer.address ? <dd className="text-[var(--color-muted)]">{doc.customer.address}</dd> : null}
            {doc.customer.email ? <dd className="text-[var(--color-muted)]">{doc.customer.email}</dd> : null}
            {doc.customer.phone ? <dd className="text-[var(--color-muted)]">{doc.customer.phone}</dd> : null}
          </div>
          {/* Phones skip it: the bill-to address and the header already show it. */}
          <div className="hidden min-w-0 sm:block">
            <dt className={stripLabel}>{t.jobAddress}</dt>
            <dd className="font-semibold text-[var(--color-heading)]">{doc.customer.address ?? "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className={stripLabel}>{t.balance}</dt>
            <dd className="text-[20px] font-bold leading-7 tabular-nums text-[var(--color-heading)]">{t.money(balance)}</dd>
          </div>
          <div className="min-w-0">
            <dt className={stripLabel}>{t.dueDate}</dt>
            <dd className="font-semibold text-[var(--color-heading)]">{doc.dueOn ? t.date(doc.dueOn) : "—"}</dd>
          </div>
        </dl>
      </HeaderCard>

      <IntroNote doc={doc} t={t} />

      <Section icon="list" title={t.items}>
        <ul className="space-y-3">
          {doc.items.filter(isIncluded).map((item) => (
            <LineCard key={item.id} item={item} t={t} className="border-[var(--color-border)]" />
          ))}
        </ul>
        <dl className="public-document-totals ml-auto mt-4 w-full max-w-xs space-y-1.5 px-4 text-[13px] text-[var(--color-heading)]">
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-muted)]">{t.invoiceAmount}</dt>
            <dd className="tabular-nums">{t.money(doc.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-[var(--color-muted)]">{t.tax(doc.taxRatePercent)}</dt>
            <dd className="tabular-nums">{t.money(doc.taxCents)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-[var(--color-border)] pt-2 text-[15px] font-bold">
            <dt>{t.total}</dt>
            <dd className="tabular-nums">{t.money(doc.totalCents)}</dd>
          </div>
        </dl>
      </Section>

      {payments.length ? (
        <Section icon="card" title={t.payments} tile="green">
          <ul className="space-y-2">
            {payments.map((payment) => (
              <li
                key={payment.id}
                className="public-document-line flex items-center justify-between gap-3 rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-3 text-[13px]"
              >
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

      <section className="public-document-totals flex items-center justify-between gap-4 rounded-2xl border border-[var(--color-border)] bg-white px-5 py-4 sm:px-6">
        <span className="text-[16px] font-bold text-[var(--color-heading)]">{t.amountDue}</span>
        <span className="text-[26px] font-bold tabular-nums text-[var(--color-heading)]">{t.money(balance)}</span>
      </section>

      <MediaAndFiles
        doc={doc}
        t={t}
        photos={photos}
        files={files}
        show={files.length > 0 || doc.companyDocuments.length > 0}
        onView={setViewing}
      />
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
  language: initialLanguage,
}: {
  doc: PublicDocument;
  token: string;
  /** From the customer's earlier pick, their contact, or their browser. */
  language: CustomerLanguage;
}) {
  const [language, setLanguage] = useState(initialLanguage);
  const t = documentStrings(language);
  const files = doc.assets.filter((asset) => asset.kind === "file");

  function changeLanguage(next: CustomerLanguage) {
    setLanguage(next);
    // Remembered on this browser for the customer's other documents.
    document.cookie = `${DOCUMENT_LANGUAGE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <div lang={language}>
      <CustomerShell
        company={doc.company}
        language={language}
        languageLabel={t.language}
        onLanguage={changeLanguage}
        callLabel={t.callUs}
        menuLabel={t.menu}
        nav={documentNav(doc, t)}
        sidebarExtra={
          files.length || doc.companyDocuments.length ? (
            <div className="space-y-1">
              {files.length ? <SidebarFiles icon="folder" label={t.documents} files={files} /> : null}
              {doc.companyDocuments.length ? (
                <SidebarFiles icon="shield" label={t.insurance} files={doc.companyDocuments} />
              ) : null}
            </div>
          ) : null
        }
        className="public-document"
        mainClassName={cn("public-document-main", doc.kind === "invoice" && "pt-20")}
      >
        {doc.kind === "invoice" ? (
          <InvoiceBody doc={doc} token={token} t={t} />
        ) : (
          <SignableBody doc={doc} token={token} t={t} />
        )}
      </CustomerShell>
    </div>
  );
}
