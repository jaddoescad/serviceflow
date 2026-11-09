"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { saveProposalPage } from "@/lib/actions/settings";
import { documentAssetUrl, removeDocumentAssets, uploadDocumentAsset, webImage } from "@/lib/document-assets";
import {
  BLOCK_LIMITS,
  CARD_ICONS,
  COMPANY_LINKS,
  CUSTOM_BLOCKS,
  isCustomBlock,
  newCustomBlock,
  reviveProposalPage,
  videoEmbedUrl,
  type CardIcon,
  type CompanyLink,
  type CustomBlock,
  type CustomBlockType,
  type PageBlock,
  type ProposalPage,
  type ProposalPart,
} from "@/lib/proposal-types";
import { settingsHref } from "@/lib/settings-pages";
import { accentStyle } from "@/components/customer-shell";
import { CardGlyph, LABEL, PAD } from "@/components/public-document";
import { Button, Input, buttonClassName, cn } from "@/components/ui";
import { SaveStatus, SettingsSection } from "./settings-section";

// The company builds its customer proposal page on the page itself: click a
// section to select it, type straight into it, and use the "+" between
// sections to add one. Every control is a labelled button or field, so a
// person or an agent driving the browser works it the same way.

const KINDS: Record<CustomBlockType, { label: string; sketch: string }> = {
  text: { label: "Text", sketch: "M6 9h22M6 18h36M6 25h36M6 32h24" },
  checklist: {
    label: "Checklist",
    sketch: "M6 11l2.5 2.5 4.5-5M19 11h23M6 21l2.5 2.5 4.5-5M19 21h23M6 31l2.5 2.5 4.5-5M19 31h17",
  },
  cards: { label: "Cards", sketch: "M5 8h10v24H5zM19 8h10v24H19zM33 8h10v24H33z" },
  numbers: { label: "Numbers", sketch: "M16 8l-4 24M28 8l-4 24M8 15h28M6 25h28" },
  image: { label: "Image", sketch: "M6 7h36v26H6zM6 27l10-10 9 8 6-5 11 9M33 14h.01" },
  video: { label: "Video", sketch: "M6 7h36v26H6zM20 14v12l10-6z" },
};

const PART_LABELS: Record<ProposalPart, string> = {
  message: "Message to the customer",
  packages: "Packages",
  scope: "Scope of work",
  addOns: "Optional add-ons",
  photos: "Photos",
  investment: "Your investment",
  terms: "Terms and conditions",
};

const ICON_LABELS: Record<CardIcon, string> = {
  award: "Award",
  shield: "Shield",
  star: "Star",
  heart: "Heart",
  clock: "Clock",
  tools: "Tools",
  thumbsUp: "Thumbs up",
  check: "Check",
};

const LINK_LABELS: Record<CompanyLink, string> = {
  website: "Website",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
};

const GLYPHS = {
  up: "m6 15 6-6 6 6",
  down: "m6 9 6 6 6-6",
  hide: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  show: "M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4M6.6 6.6C3.7 8.5 2 12 2 12s3.6 7 10 7a10.7 10.7 0 0 0 4.1-.8M9.9 9.9a3 3 0 0 0 4.2 4.2",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  plus: "M12 5v14M5 12h14",
  close: "M18 6 6 18M6 6l12 12",
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z",
  open: "M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
};

function Glyph({ name, className }: { name: keyof typeof GLYPHS; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("h-[15px] w-[15px] shrink-0", className)}
    >
      <path d={GLYPHS[name]} />
    </svg>
  );
}

/** The images a page keeps in storage: its cover and its image sections. */
function pagePaths(page: ProposalPage): string[] {
  return [page.heroPath, ...page.blocks.map((block) => (block.type === "image" ? block.path : null))].filter(
    (path): path is string => Boolean(path),
  );
}

/**
 * Page text you type into: it looks like the text around it and grows with
 * what is written (the hidden copy behind it sets the height).
 */
function Field({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  disabled,
  multiline,
  autoFocus,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  maxLength: number;
  disabled: boolean;
  multiline?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const shape = cn("min-w-0 rounded-md px-1.5 py-0.5 [grid-area:1/1]", className);
  return (
    <div className="-mx-1.5 grid">
      <span aria-hidden="true" className={cn(shape, "invisible whitespace-pre-wrap [overflow-wrap:anywhere]")}>
        {(value || placeholder) + "​"}
      </span>
      <textarea
        aria-label={label}
        rows={1}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(event) => onChange(multiline ? event.target.value : event.target.value.replace(/\n/g, " "))}
        onKeyDown={multiline ? undefined : (event) => event.key === "Enter" && event.preventDefault()}
        className={cn(
          shape,
          "resize-none overflow-hidden border-0 bg-transparent text-inherit outline-none placeholder:text-[var(--color-faint)] enabled:hover:bg-[var(--color-hover)] enabled:focus:bg-[var(--color-brand-soft)]",
        )}
      />
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-[var(--color-surface-2)] px-2 text-[11px] font-medium text-[var(--color-muted)]">
      {children}
    </span>
  );
}

const FROM_PROPOSAL = (
  <Tag>
    <Glyph name="lock" className="h-[11px] w-[11px]" />
    From each proposal
  </Tag>
);

const TOOL =
  "flex h-[30px] w-[30px] items-center justify-center rounded-[7px] text-white outline-none hover:bg-[#2a2a30] focus-visible:bg-[#2a2a30] disabled:pointer-events-none disabled:opacity-30";
const ADD_LINK =
  "mt-4 text-[13px] font-medium text-[var(--color-brand-strong)] outline-none hover:underline focus-visible:underline";
const REMOVE =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--color-faint)] outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-bad)] focus-visible:bg-[var(--color-hover)]";

/** A list inside a section (points, cards, numbers): each entry removable while the section is selected, then "Add". */
function Entries<T>({
  entries,
  max,
  noun,
  blank,
  editing,
  onChange,
  className,
  children,
}: {
  entries: T[];
  max: number;
  noun: string;
  blank: T;
  editing: boolean;
  onChange: (entries: T[]) => void;
  className: string;
  children: (entry: T, set: (next: Partial<T>) => void, index: number) => React.ReactNode;
}) {
  return (
    <>
      {entries.length ? (
        <ul className={className}>
          {entries.map((entry, index) => (
            <li key={index} className="relative min-w-0">
              {children(
                entry,
                (next) => onChange(entries.map((other, at) => (at === index ? { ...other, ...next } : other))),
                index,
              )}
              {editing ? (
                <button
                  type="button"
                  aria-label={`Remove ${noun} ${index + 1}`}
                  title="Remove"
                  onClick={() => onChange(entries.filter((_, at) => at !== index))}
                  className={cn(REMOVE, "absolute -right-1 -top-1 bg-white")}
                >
                  <Glyph name="close" className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {editing && entries.length < max ? (
        <button type="button" onClick={() => onChange([...entries, blank])} className={cn(ADD_LINK, !entries.length && "mt-3")}>
          + Add a {noun}
        </button>
      ) : null}
    </>
  );
}

/** One of the company's own sections, written in place. */
function CustomBody({
  block,
  editing,
  fresh,
  disabled,
  onChange,
  onUpload,
}: {
  block: CustomBlock;
  editing: boolean;
  /** Just added: the heading takes the cursor. */
  fresh: boolean;
  disabled: boolean;
  onChange: (next: Partial<CustomBlock>) => void;
  onUpload: (file: File | undefined) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const embed = block.type === "video" ? videoEmbedUrl(block.url) : null;
  return (
    <div className="[&>*:first-child]:mt-0">
      {/* An empty heading only shows while the section is selected, as on the customer's page. */}
      {editing || block.title ? (
        <Field
          label="Section heading"
          value={block.title}
          onChange={(title) => onChange({ title })}
          placeholder="Type a heading"
          maxLength={120}
          disabled={disabled}
          autoFocus={fresh}
          className="text-[20px] font-bold leading-tight tracking-tight text-[var(--color-heading)]"
        />
      ) : null}

      {block.type === "text" ? (
        <div className="mt-2.5">
          <Field
            label="Section text"
            value={block.body}
            onChange={(body) => onChange({ body })}
            placeholder="Write a paragraph or two"
            maxLength={6000}
            disabled={disabled}
            multiline
            className="text-[14px] leading-6 text-[var(--color-text)]"
          />
        </div>
      ) : null}

      {block.type === "checklist" ? (
        <Entries
          entries={block.points}
          max={BLOCK_LIMITS.points}
          noun="point"
          blank={{ title: "", body: "" }}
          editing={editing}
          onChange={(points) => onChange({ points })}
          className="mt-5 grid gap-x-8 gap-y-5 @xl:grid-cols-2"
        >
          {(point, set, index) => (
            <div className="flex gap-3">
              <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-accent)] text-[var(--brand-ink)]">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <Field
                  label={`Point ${index + 1}`}
                  value={point.title}
                  onChange={(title) => set({ title })}
                  placeholder="Point"
                  maxLength={160}
                  disabled={disabled}
                  className="text-[14px] font-semibold leading-5 text-[var(--color-heading)]"
                />
                <Field
                  label={`Point ${index + 1} details`}
                  value={point.body}
                  onChange={(body) => set({ body })}
                  placeholder="Details (optional)"
                  maxLength={800}
                  disabled={disabled}
                  multiline
                  className="text-[13px] leading-5 text-[var(--color-muted)]"
                />
              </div>
            </div>
          )}
        </Entries>
      ) : null}

      {block.type === "cards" ? (
        <Entries
          entries={block.cards}
          max={BLOCK_LIMITS.cards}
          noun="card"
          blank={{ icon: "check" as CardIcon, title: "", body: "" }}
          editing={editing}
          onChange={(cards) => onChange({ cards })}
          className={cn("mt-5 grid gap-x-8 gap-y-7", block.cards.length % 2 || block.cards.length > 4 ? "@xl:grid-cols-3" : "@xl:grid-cols-2")}
        >
          {(card, set, index) => (
            <>
              <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-tint)] text-[var(--brand-text)] focus-within:shadow-[var(--focus-ring)]">
                <CardGlyph icon={card.icon} />
                <select
                  aria-label={`Card ${index + 1} icon`}
                  title="Change icon"
                  value={card.icon}
                  disabled={disabled}
                  onChange={(event) => set({ icon: event.target.value as CardIcon })}
                  className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
                >
                  {CARD_ICONS.map((icon) => (
                    <option key={icon} value={icon}>
                      {ICON_LABELS[icon]}
                    </option>
                  ))}
                </select>
              </span>
              <div className="mt-2.5">
                <Field
                  label={`Card ${index + 1} title`}
                  value={card.title}
                  onChange={(title) => set({ title })}
                  placeholder="Title"
                  maxLength={80}
                  disabled={disabled}
                  className="text-[15px] font-semibold leading-5 text-[var(--color-heading)]"
                />
                <Field
                  label={`Card ${index + 1} text`}
                  value={card.body}
                  onChange={(body) => set({ body })}
                  placeholder="A sentence or two"
                  maxLength={400}
                  disabled={disabled}
                  multiline
                  className="text-[13px] leading-5 text-[var(--color-muted)]"
                />
              </div>
            </>
          )}
        </Entries>
      ) : null}

      {block.type === "numbers" ? (
        <Entries
          entries={block.numbers}
          max={BLOCK_LIMITS.numbers}
          noun="number"
          blank={{ value: "", label: "" }}
          editing={editing}
          onChange={(numbers) => onChange({ numbers })}
          className={cn(
            "mt-5 grid gap-5 text-center",
            { 2: "@xl:grid-cols-2", 3: "@xl:grid-cols-3", 4: "@xl:grid-cols-4" }[block.numbers.length],
          )}
        >
          {(item, set, index) => (
            <div className="px-2">
              <Field
                label={`Number ${index + 1}`}
                value={item.value}
                onChange={(value) => set({ value })}
                placeholder="500+"
                maxLength={20}
                disabled={disabled}
                className="text-center text-[24px] font-bold leading-8 tracking-tight text-[var(--color-heading)]"
              />
              <Field
                label={`Number ${index + 1} label`}
                value={item.label}
                onChange={(label) => set({ label })}
                placeholder="What it counts"
                maxLength={60}
                disabled={disabled}
                className="text-center text-xs text-[var(--color-muted)]"
              />
            </div>
          )}
        </Entries>
      ) : null}

      {block.type === "image" ? (
        <div className="mt-4">
          {block.path ? (
            <img src={documentAssetUrl(block.path)} alt={block.title} className="w-full rounded-xl bg-[var(--color-surface-2)]" />
          ) : null}
          {disabled ? null : (
            <div className={cn("flex flex-wrap items-center gap-2", block.path && "mt-3")}>
              <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
                {block.path ? "Replace image" : "Upload image"}
              </Button>
              {block.path ? (
                <Button variant="ghost" size="sm" onClick={() => onChange({ path: null })}>
                  Remove image
                </Button>
              ) : null}
              <input
                ref={fileInput}
                type="file"
                aria-label="Section image file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(event) => {
                  onUpload(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </div>
          )}
        </div>
      ) : null}

      {block.type === "video" ? (
        <div className="mt-3">
          <Field
            label="YouTube or Vimeo link"
            value={block.url}
            onChange={(url) => onChange({ url: url.trim() })}
            placeholder="Paste a YouTube or Vimeo link"
            maxLength={300}
            disabled={disabled}
            className="text-[14px] leading-6 text-[var(--color-text)]"
          />
          {embed ? (
            <div className="mt-3 aspect-video overflow-hidden rounded-xl bg-black">
              <iframe src={embed} title={block.title || "Video"} loading="lazy" className="pointer-events-none h-full w-full" />
            </div>
          ) : block.url ? (
            <p role="alert" className="mt-1 text-xs text-[var(--color-bad)]">
              That is not a YouTube or Vimeo address.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The "+" on the line between two sections, and the kinds it offers. */
function Inserter({
  place,
  open,
  onToggle,
  onPick,
}: {
  /** Where the new section lands, for the button's name: "at the top" or "after Scope of work". */
  place: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  onPick: (type: CustomBlockType) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node)) {
        onToggle(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open, onToggle]);

  return (
    <div ref={root} className={cn("absolute inset-x-0 bottom-0 h-0", open ? "z-40" : "z-20")} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        aria-label={`Add a section ${place}`}
        aria-expanded={open}
        title="Add a section here"
        onClick={() => onToggle(!open)}
        className="absolute left-1/2 top-0 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#c9d6f5] bg-white text-[var(--color-brand-strong)] shadow-[0_2px_6px_rgba(17,17,19,0.1)] outline-none hover:bg-[var(--color-brand-soft)] focus-visible:shadow-[var(--focus-ring)]"
      >
        <Glyph name="plus" className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={`Add a section ${place}`}
          className="absolute left-1/2 top-5 w-[min(580px,calc(100%-24px))] -translate-x-1/2 rounded-2xl bg-[#111113] p-4 shadow-[0_18px_44px_rgba(17,17,19,0.35)]"
        >
          <p className="mb-3 ml-0.5 text-[13px] font-semibold text-white">Add a section</p>
          <div className="grid grid-cols-2 gap-2 @xl:grid-cols-3">
            {CUSTOM_BLOCKS.map((type) => (
              <button
                key={type}
                type="button"
                role="menuitem"
                onClick={() => onPick(type)}
                className="flex flex-col items-start gap-2.5 rounded-xl border border-[#2c2c33] bg-[#1a1a1e] p-3 text-left text-[13px] font-medium text-[#f4f4f5] outline-none hover:border-[#4d82ff] hover:bg-[#1d2231] focus-visible:border-[#4d82ff]"
              >
                <svg aria-hidden="true" width="48" height="40" viewBox="0 0 48 40" fill="none" stroke="#86a8ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={KINDS[type].sketch} />
                </svg>
                {KINDS[type].label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ProposalPageBuilder({
  orgId,
  companyName,
  brandColor,
  page,
  canManage,
  previewId,
}: {
  orgId: string;
  companyName: string;
  brandColor: string | null;
  page: ProposalPage;
  canManage: boolean;
  /** The company's latest proposal, to open as the customer sees it. */
  previewId: string | null;
}) {
  const coverInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(page);
  const [saved, setSaved] = useState(page);
  const [selected, setSelected] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  /** The open "+": the index a new section would take. */
  const [adding, setAdding] = useState<number | null>(null);
  const [phone, setPhone] = useState(false);
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const disabled = !canManage || pending;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const full = draft.blocks.length >= BLOCK_LIMITS.blocks;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function patch(next: Partial<ProposalPage>) {
    setDraft((current) => ({ ...current, ...next }));
    setStatus({});
  }

  /** Saves the page, then deletes the images it no longer uses. */
  async function save(next: ProposalPage, message: string) {
    const result = await saveProposalPage(next);
    if (!result.ok) {
      setStatus({ error: result.error ?? "Could not save." });
      return false;
    }
    // As saved: trimmed, and with https:// on a link typed without it.
    const clean = reviveProposalPage(next);
    const kept = new Set(pagePaths(clean));
    await removeDocumentAssets(pagePaths(saved).filter((path) => !kept.has(path)));
    setDraft(clean);
    setSaved(clean);
    setStatus({ message });
    return true;
  }

  /** Uploads an image and saves the page with it placed, so storage and the page never disagree. */
  function upload(file: File | undefined, place: (page: ProposalPage, path: string) => ProposalPage) {
    if (!file) return;
    startTransition(async () => {
      setStatus({});
      const image = await webImage(file);
      if (!image) {
        setStatus({ error: "Choose a JPG, PNG or WebP image." });
        return;
      }
      let path: string;
      try {
        path = await uploadDocumentAsset(orgId, image, file.name);
      } catch {
        setStatus({ error: "Could not upload the image. Try again." });
        return;
      }
      if (!(await save(place(draft, path), "Image saved."))) await removeDocumentAssets([path]);
    });
  }

  function setBlock(id: string, next: Partial<CustomBlock>) {
    patch({ blocks: draft.blocks.map((block) => (block.id === id ? ({ ...block, ...next } as PageBlock) : block)) });
  }

  /** Swaps a section with the one above (-1) or below (1) it. */
  function moveBlock(index: number, by: -1 | 1) {
    const blocks = [...draft.blocks];
    [blocks[index], blocks[index + by]] = [blocks[index + by], blocks[index]];
    patch({ blocks });
  }

  /** Puts a new, empty section at the given place and selects it for writing. */
  function addBlock(type: CustomBlockType, index: number) {
    const block = newCustomBlock(type, crypto.randomUUID());
    patch({ blocks: [...draft.blocks.slice(0, index), block, ...draft.blocks.slice(index)] });
    setAdding(null);
    setSelected(block.id);
    setFresh(block.id);
  }

  const inserter = (index: number, place: string) =>
    disabled || full ? null : (
      <Inserter
        place={place}
        open={adding === index}
        onToggle={(open) => setAdding(open ? index : null)}
        onPick={(type) => addBlock(type, index)}
      />
    );

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-30 -mx-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 bg-[var(--color-bg)] px-1 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--color-heading)]">Customer proposal page</h2>
          <div className="text-[13px] text-[var(--color-muted)]">
            {canManage ? (
              <SaveStatus error={status.error} message={status.message} hint={dirty ? "Unsaved changes" : undefined} />
            ) : (
              "Only managers can change the proposal page."
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Preview size"
            className="inline-flex rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-0.5"
          >
            {[false, true].map((small) => (
              <button
                key={String(small)}
                type="button"
                aria-pressed={phone === small}
                onClick={() => setPhone(small)}
                className={cn(
                  "h-7 rounded-[var(--radius-control)] px-3 text-xs font-medium outline-none focus-visible:shadow-[var(--focus-ring)]",
                  phone === small
                    ? "bg-[var(--color-surface)] text-[var(--color-heading)] shadow-[var(--shadow-pop-lite)]"
                    : "text-[var(--color-muted)] hover:text-[var(--color-heading)]",
                )}
              >
                {small ? "Phone" : "Desktop"}
              </button>
            ))}
          </div>
          {previewId ? (
            <a
              href={`/preview/proposals/${previewId}`}
              target="_blank"
              rel="noreferrer"
              title={dirty ? "Save to see your changes" : undefined}
              className={buttonClassName({ variant: "ghost" })}
            >
              Customer view
              <Glyph name="open" className="h-[13px] w-[13px]" />
            </a>
          ) : null}
          {canManage ? (
            <Button disabled={pending || !dirty} onClick={() => startTransition(async () => void (await save(draft, "Saved.")))}>
              {pending ? "Saving…" : "Save"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="rounded-[var(--radius-lg)] bg-[var(--color-surface-2)] px-3 pb-28 pt-6 sm:px-6">
        <article
          aria-label="Customer proposal page"
          style={accentStyle(brandColor)}
          className={cn(
            "light-page @container mx-auto divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] bg-white text-[var(--color-text)] shadow-[0_12px_32px_rgba(16,24,40,0.12)]",
            phone ? "max-w-[390px]" : "max-w-[780px]",
          )}
        >
          <header className="relative">
            <div className="relative">
              {draft.heroPath ? (
                <img
                  src={documentAssetUrl(draft.heroPath)}
                  alt="Cover photo"
                  className="aspect-[3/1] w-full rounded-t-2xl bg-[var(--color-surface-2)] object-cover"
                />
              ) : null}
              {disabled ? null : (
                <div className={cn("flex gap-2", draft.heroPath ? "absolute bottom-3 right-3" : "px-5 pt-5 @xl:px-8")}>
                  <button
                    type="button"
                    onClick={() => coverInput.current?.click()}
                    className={
                      draft.heroPath
                        ? "h-8 rounded-lg bg-[rgba(17,17,19,0.78)] px-3 text-xs font-medium text-white outline-none hover:bg-[#111113] focus-visible:shadow-[var(--focus-ring)]"
                        : buttonClassName({ variant: "secondary", size: "sm" })
                    }
                  >
                    {draft.heroPath ? "Change cover photo" : "Add a cover photo"}
                  </button>
                  {draft.heroPath ? (
                    <button
                      type="button"
                      onClick={() => patch({ heroPath: null })}
                      className="h-8 rounded-lg bg-[rgba(17,17,19,0.78)] px-3 text-xs font-medium text-white outline-none hover:bg-[#111113] focus-visible:shadow-[var(--focus-ring)]"
                    >
                      Remove cover photo
                    </button>
                  ) : null}
                  <input
                    ref={coverInput}
                    type="file"
                    aria-label="Cover photo file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    onChange={(event) => {
                      upload(event.target.files?.[0], (current, heroPath) => ({ ...current, heroPath }));
                      event.target.value = "";
                    }}
                  />
                </div>
              )}
            </div>
            <div className="flex items-start justify-between gap-3 px-5 py-6 @xl:px-8">
              <div className="min-w-0">
                <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--brand-text)]">Proposal</div>
                <div className="mt-1.5 text-[26px] font-bold leading-[1.15] tracking-tight text-[var(--color-faint)]">
                  Proposal name
                </div>
              </div>
              {FROM_PROPOSAL}
            </div>
            <div className="grid gap-5 rounded-none border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-5 text-[13px] leading-5 @xl:grid-cols-3 @xl:px-8">
              <div>
                <div className={cn(LABEL, "mb-1")}>Prepared for</div>
                <div className="text-[var(--color-faint)]">The customer</div>
              </div>
              <div>
                <div className={cn(LABEL, "mb-1")}>Project location</div>
                <div className="text-[var(--color-faint)]">Their address</div>
              </div>
              <div className="min-w-0">
                <div className={cn(LABEL, "mb-1")}>From</div>
                <div className="font-semibold text-[var(--color-heading)]">{companyName}</div>
                <Field
                  label="Licence or registration number"
                  value={draft.license}
                  onChange={(license) => patch({ license })}
                  placeholder="Licence or registration number"
                  maxLength={80}
                  disabled={disabled}
                  className="text-[13px] leading-5 text-[var(--color-muted)]"
                />
              </div>
            </div>
            {inserter(0, "at the top")}
          </header>

          {draft.blocks.map((block, index) => {
            const custom = isCustomBlock(block) ? block : null;
            const name = custom ? KINDS[custom.type].label : PART_LABELS[block.type as ProposalPart];
            const active = selected === block.id && !disabled;
            const select = () => setSelected(block.id);
            return (
              <section
                key={block.id}
                aria-label={custom?.title ? `${name}: ${custom.title}` : name}
                onClick={select}
                onFocusCapture={select}
                className={cn("relative", custom ? PAD.replace(/sm:/g, "@xl:") : "px-5 py-5 @xl:px-8")}
              >
                {active ? (
                  <>
                    <div className="pointer-events-none absolute inset-1.5 rounded-xl border-2 border-[#2f6bff]" />
                    <div
                      role="toolbar"
                      aria-label={`${name} section`}
                      className="absolute -top-3.5 right-5 z-30 flex items-center gap-0.5 rounded-[10px] bg-[#111113] p-1 shadow-[0_8px_22px_rgba(17,17,19,0.28)]"
                    >
                      <span className="pl-1.5 pr-2 text-xs font-semibold text-white">{name}</span>
                      <button
                        type="button"
                        aria-label="Move section up"
                        title="Move up"
                        disabled={index === 0}
                        onClick={() => moveBlock(index, -1)}
                        className={TOOL}
                      >
                        <Glyph name="up" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move section down"
                        title="Move down"
                        disabled={index === draft.blocks.length - 1}
                        onClick={() => moveBlock(index, 1)}
                        className={TOOL}
                      >
                        <Glyph name="down" />
                      </button>
                      {custom ? (
                        <>
                          <button
                            type="button"
                            aria-label={custom.hidden ? "Show section to customers" : "Hide section from customers"}
                            title={custom.hidden ? "Show to customers" : "Hide from customers"}
                            onClick={() => setBlock(custom.id, { hidden: !custom.hidden })}
                            className={TOOL}
                          >
                            <Glyph name={custom.hidden ? "show" : "hide"} />
                          </button>
                          <button
                            type="button"
                            aria-label="Delete section"
                            title="Delete"
                            onClick={(event) => {
                              event.stopPropagation();
                              patch({ blocks: draft.blocks.filter((other) => other.id !== custom.id) });
                              setSelected(null);
                            }}
                            className={TOOL}
                          >
                            <Glyph name="trash" />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {custom ? (
                  <div className={cn(custom.hidden && "opacity-45")}>
                    {custom.hidden ? (
                      <div className="mb-2">
                        <Tag>Hidden from customers</Tag>
                      </div>
                    ) : null}
                    <CustomBody
                      block={custom}
                      editing={active}
                      fresh={fresh === custom.id}
                      disabled={disabled}
                      onChange={(next) => setBlock(custom.id, next)}
                      onUpload={(file) =>
                        upload(file, (current, path) => ({
                          ...current,
                          blocks: current.blocks.map((other) =>
                            other.id === custom.id && other.type === "image" ? { ...other, path } : other,
                          ),
                        }))
                      }
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <h3 className={LABEL}>{name}</h3>
                      {block.type === "terms" ? <Tag>Used unless a proposal has its own</Tag> : FROM_PROPOSAL}
                    </div>
                    {block.type === "terms" ? (
                      <div className="mt-3">
                        <Field
                          label="Default terms and conditions"
                          value={draft.terms}
                          onChange={(terms) => patch({ terms })}
                          placeholder="Type your default terms"
                          maxLength={20000}
                          disabled={disabled}
                          multiline
                          className="text-[13px] leading-6 text-[var(--color-muted)]"
                        />
                      </div>
                    ) : null}
                  </>
                )}
                {inserter(index + 1, `after ${custom?.title || name}`)}
              </section>
            );
          })}
        </article>
      </div>

      <SettingsSection
        id="proposal-links"
        title="Links"
        description="Your website and social pages, in the sidebar of every customer page."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {COMPANY_LINKS.map((key) => (
            <label key={key} className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{LINK_LABELS[key]}</span>
              <Input
                type="url"
                inputMode="url"
                placeholder="https://"
                value={draft.links[key]}
                maxLength={300}
                disabled={disabled}
                onChange={(event) => patch({ links: { ...draft.links, [key]: event.target.value } })}
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          The Reviews link is set under{" "}
          <a href={settingsHref("reviews")} className="underline underline-offset-2">
            Reviews &amp; aftercare
          </a>
          .
        </p>
      </SettingsSection>
    </div>
  );
}
