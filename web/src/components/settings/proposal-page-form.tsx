"use client";

import { useRef, useState, useTransition } from "react";
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
import { Button, Input, Select, Textarea, buttonClassName, cn } from "@/components/ui";
import { SaveStatus, SettingsSection } from "./settings-section";

// The company builds its customer proposal page here: a cover and licence,
// then the page's sections top to bottom. Its own sections (text, checklists,
// cards, numbers, images, videos) are added, written, ordered and removed
// freely; the parts every proposal brings (scope, add-ons, totals…) are placed
// among them.

const BLOCK_LABELS: Record<CustomBlockType, string> = {
  text: "Text",
  checklist: "Checklist",
  cards: "Cards",
  numbers: "Numbers",
  image: "Image",
  video: "Video",
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

const label = "mb-1 block text-xs font-medium text-[var(--color-muted)]";
const groupTitle = "text-[13px] font-semibold text-[var(--color-heading)]";
const iconButton =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-muted)] outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)] focus-visible:shadow-[var(--focus-ring)] disabled:pointer-events-none disabled:opacity-30";

function Glyph({ d }: { d: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0"
    >
      <path d={d} />
    </svg>
  );
}

/** The images a page keeps in storage: its cover and its image sections. */
function pagePaths(page: ProposalPage): string[] {
  return [page.heroPath, ...page.blocks.map((block) => (block.type === "image" ? block.path : null))].filter(
    (path): path is string => Boolean(path),
  );
}

/** What a section's row says when it is closed: its heading, else a taste of what's in it. */
function summary(block: CustomBlock): string {
  if (block.title) return block.title;
  switch (block.type) {
    case "text":
      return block.body.slice(0, 80) || "Empty";
    case "checklist":
      return block.points.length ? block.points.map((point) => point.title || point.body).join(", ") : "Empty";
    case "cards":
      return block.cards.length ? block.cards.map((card) => card.title || card.body).join(", ") : "Empty";
    case "numbers":
      return block.numbers.length ? block.numbers.map((item) => item.value).join(" · ") : "Empty";
    case "image":
      return block.path ? "Image" : "No image yet";
    case "video":
      return block.url || "No link yet";
  }
}

/** A list inside a section (points, cards, numbers): each entry with a remove button, then "Add". */
function Entries<T>({
  entries,
  max,
  addLabel,
  blank,
  disabled,
  onChange,
  children,
}: {
  entries: T[];
  max: number;
  addLabel: string;
  blank: T;
  disabled: boolean;
  onChange: (entries: T[]) => void;
  children: (entry: T, set: (next: Partial<T>) => void, index: number) => React.ReactNode;
}) {
  return (
    <div>
      <ol className="space-y-2">
        {entries.map((entry, index) => (
          <li key={index} className="flex gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              {children(
                entry,
                (next) => onChange(entries.map((other, at) => (at === index ? { ...other, ...next } : other))),
                index,
              )}
            </div>
            <button
              type="button"
              aria-label={`Remove ${index + 1}`}
              title="Remove"
              disabled={disabled}
              onClick={() => onChange(entries.filter((_, at) => at !== index))}
              className={iconButton}
            >
              <Glyph d="M18 6 6 18M6 6l12 12" />
            </button>
          </li>
        ))}
      </ol>
      {entries.length < max ? (
        <Button
          variant="ghost"
          size="sm"
          className={entries.length ? "mt-1" : undefined}
          disabled={disabled}
          onClick={() => onChange([...entries, blank])}
        >
          + {addLabel}
        </Button>
      ) : null}
    </div>
  );
}

/** The fields of one of the company's own sections. */
function BlockEditor({
  block,
  disabled,
  onChange,
  onUpload,
}: {
  block: CustomBlock;
  disabled: boolean;
  onChange: (next: Partial<CustomBlock>) => void;
  onUpload: (file: File | undefined) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-3">
      <label className="block">
        <span className={label}>Heading</span>
        <Input
          value={block.title}
          maxLength={120}
          disabled={disabled}
          onChange={(event) => onChange({ title: event.target.value })}
        />
      </label>

      {block.type === "text" ? (
        <label className="block">
          <span className={label}>Text</span>
          <Textarea
            rows={5}
            value={block.body}
            maxLength={6000}
            disabled={disabled}
            onChange={(event) => onChange({ body: event.target.value })}
          />
        </label>
      ) : null}

      {block.type === "checklist" ? (
        <Entries
          entries={block.points}
          max={BLOCK_LIMITS.points}
          addLabel="Add point"
          blank={{ title: "", body: "" }}
          disabled={disabled}
          onChange={(points) => onChange({ points })}
        >
          {(point, set, index) => (
            <>
              <Input
                aria-label={`Point ${index + 1}`}
                placeholder="Point"
                value={point.title}
                maxLength={160}
                disabled={disabled}
                onChange={(event) => set({ title: event.target.value })}
              />
              <Textarea
                aria-label={`Point ${index + 1} details`}
                placeholder="Details (optional)"
                rows={2}
                value={point.body}
                maxLength={800}
                disabled={disabled}
                onChange={(event) => set({ body: event.target.value })}
              />
            </>
          )}
        </Entries>
      ) : null}

      {block.type === "cards" ? (
        <Entries
          entries={block.cards}
          max={BLOCK_LIMITS.cards}
          addLabel="Add card"
          blank={{ icon: "check" as CardIcon, title: "", body: "" }}
          disabled={disabled}
          onChange={(cards) => onChange({ cards })}
        >
          {(card, set, index) => (
            <>
              <div className="flex gap-2">
                <Select
                  aria-label={`Card ${index + 1} icon`}
                  className="w-32 shrink-0"
                  value={card.icon}
                  disabled={disabled}
                  onChange={(event) => set({ icon: event.target.value as CardIcon })}
                >
                  {CARD_ICONS.map((icon) => (
                    <option key={icon} value={icon}>
                      {ICON_LABELS[icon]}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={`Card ${index + 1} title`}
                  placeholder="Title"
                  className="min-w-0 flex-1"
                  value={card.title}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(event) => set({ title: event.target.value })}
                />
              </div>
              <Textarea
                aria-label={`Card ${index + 1} text`}
                placeholder="A sentence or two"
                rows={2}
                value={card.body}
                maxLength={400}
                disabled={disabled}
                onChange={(event) => set({ body: event.target.value })}
              />
            </>
          )}
        </Entries>
      ) : null}

      {block.type === "numbers" ? (
        <Entries
          entries={block.numbers}
          max={BLOCK_LIMITS.numbers}
          addLabel="Add number"
          blank={{ value: "", label: "" }}
          disabled={disabled}
          onChange={(numbers) => onChange({ numbers })}
        >
          {(item, set, index) => (
            <div className="flex gap-2">
              <Input
                aria-label={`Number ${index + 1}`}
                placeholder="500+"
                className="w-28 shrink-0"
                value={item.value}
                maxLength={20}
                disabled={disabled}
                onChange={(event) => set({ value: event.target.value })}
              />
              <Input
                aria-label={`Number ${index + 1} label`}
                placeholder="What it counts"
                className="min-w-0 flex-1"
                value={item.label}
                maxLength={60}
                disabled={disabled}
                onChange={(event) => set({ label: event.target.value })}
              />
            </div>
          )}
        </Entries>
      ) : null}

      {block.type === "image" ? (
        <div>
          {block.path ? (
            <img
              src={documentAssetUrl(block.path)}
              alt=""
              className="mb-2 max-h-56 rounded-[var(--radius)] border border-[var(--color-border)] object-contain"
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => fileInput.current?.click()}>
              {block.path ? "Replace" : "Upload image"}
            </Button>
            {block.path ? (
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange({ path: null })}>
                Remove
              </Button>
            ) : null}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => {
                onUpload(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        </div>
      ) : null}

      {block.type === "video" ? (
        <label className="block">
          <span className={label}>YouTube or Vimeo link</span>
          <Input
            type="url"
            inputMode="url"
            placeholder="https://"
            value={block.url}
            maxLength={300}
            disabled={disabled}
            aria-invalid={Boolean(block.url) && !videoEmbedUrl(block.url)}
            onChange={(event) => onChange({ url: event.target.value })}
          />
          {block.url && !videoEmbedUrl(block.url) ? (
            <span className="mt-1 block text-xs text-[var(--color-bad)]">Paste the video&rsquo;s YouTube or Vimeo address.</span>
          ) : null}
        </label>
      ) : null}
    </div>
  );
}

export function ProposalPageForm({
  orgId,
  page,
  canManage,
  previewId,
}: {
  orgId: string;
  page: ProposalPage;
  canManage: boolean;
  /** The company's latest proposal, to open as the customer sees it. */
  previewId: string | null;
}) {
  const coverInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(page);
  const [saved, setSaved] = useState(page);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const disabled = !canManage || pending;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

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

  /** A new section goes above the terms when they close the page, else at the end, and opens for writing. */
  function addBlock(type: CustomBlockType) {
    const block = newCustomBlock(type, crypto.randomUUID());
    const blocks = [...draft.blocks];
    blocks.splice(blocks.at(-1)?.type === "terms" ? blocks.length - 1 : blocks.length, 0, block);
    patch({ blocks });
    setOpened((current) => new Set(current).add(block.id));
  }

  function toggleOpened(id: string) {
    setOpened((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <SettingsSection
      id="proposal-page"
      title="Customer proposal page"
      description="Build the page your customers open: your own sections around each proposal's scope and price, in any order."
      footer={
        canManage ? (
          <>
            <SaveStatus error={status.error} message={status.message} />
            <div className="ml-auto flex items-center gap-2">
              {previewId ? (
                <a
                  href={`/preview/proposals/${previewId}`}
                  target="_blank"
                  rel="noreferrer"
                  title={dirty ? "Save to see your changes" : undefined}
                  className={buttonClassName({ variant: "ghost" })}
                >
                  Customer view <span aria-hidden="true">↗</span>
                </a>
              ) : null}
              <Button
                disabled={pending || !dirty}
                onClick={() => startTransition(async () => void (await save(draft, "Saved.")))}
              >
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </>
        ) : (
          <span>Only managers can change the proposal page.</span>
        )
      }
    >
      <div className="space-y-6">
        <div>
          <span className={label}>Cover photo</span>
          {draft.heroPath ? (
            <img
              src={documentAssetUrl(draft.heroPath)}
              alt="Proposal cover"
              className="mb-2 aspect-[3/1] w-full rounded-[var(--radius)] border border-[var(--color-border)] object-cover"
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => coverInput.current?.click()}>
              {draft.heroPath ? "Replace" : "Upload photo"}
            </Button>
            {draft.heroPath ? (
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => patch({ heroPath: null })}>
                Remove
              </Button>
            ) : (
              <span className="text-xs text-[var(--color-muted)]">A wide photo works best, about 1200 × 400.</span>
            )}
            <input
              ref={coverInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => {
                upload(event.target.files?.[0], (current, heroPath) => ({ ...current, heroPath }));
                event.target.value = "";
              }}
            />
          </div>
        </div>

        <label className="block max-w-sm">
          <span className={label}>Licence or registration number</span>
          <Input
            value={draft.license}
            maxLength={80}
            disabled={disabled}
            onChange={(event) => patch({ license: event.target.value })}
          />
        </label>

        <div>
          <h3 className={groupTitle}>Sections</h3>
          <ol className="mt-2 space-y-2">
            <li className="flex min-h-11 items-center rounded-[var(--radius)] border border-dashed border-[var(--color-border)] px-3 text-[13px] text-[var(--color-muted)]">
              Cover photo, title and who it&rsquo;s for
            </li>
            {draft.blocks.map((block, index) => {
              const custom = isCustomBlock(block) ? block : null;
              const name = custom ? BLOCK_LABELS[custom.type] : PART_LABELS[block.type as ProposalPart];
              const expands = custom != null || block.type === "terms";
              const open = expands && opened.has(block.id);
              const heading = (
                <>
                  {expands ? (
                    <span className={cn("text-[var(--color-faint)] transition-transform", open && "rotate-90")}>
                      <Glyph d="m9 6 6 6-6 6" />
                    </span>
                  ) : null}
                  {custom ? (
                    <>
                      <span className="shrink-0 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--color-muted)]">
                        {name}
                      </span>
                      <span
                        className={cn(
                          "min-w-0 truncate font-medium text-[var(--color-heading)]",
                          custom.hidden && "text-[var(--color-faint)] line-through",
                        )}
                      >
                        {summary(custom)}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="shrink-0 text-[var(--color-heading)]">{name}</span>
                      <span className="min-w-0 truncate text-xs text-[var(--color-faint)]">
                        {block.type === "terms" ? "Your default, unless a proposal has its own" : "From each proposal"}
                      </span>
                    </>
                  )}
                </>
              );
              return (
                <li key={block.id} className="rounded-[var(--radius)] border border-[var(--color-border)]">
                  <div className="flex min-h-11 items-center gap-1 pl-3 pr-2 text-[13px]">
                    {expands ? (
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleOpened(block.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left outline-none"
                      >
                        {heading}
                      </button>
                    ) : (
                      <div className="flex min-w-0 flex-1 items-center gap-2">{heading}</div>
                    )}
                    {custom ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={!custom.hidden}
                        disabled={disabled}
                        onClick={() => setBlock(custom.id, { hidden: !custom.hidden })}
                      >
                        {custom.hidden ? "Show" : "Hide"}
                      </Button>
                    ) : null}
                    {([-1, 1] as const).map((by) => (
                      <button
                        key={by}
                        type="button"
                        aria-label={`Move ${name} ${by < 0 ? "up" : "down"}`}
                        title={by < 0 ? "Move up" : "Move down"}
                        disabled={disabled || (by < 0 ? index === 0 : index === draft.blocks.length - 1)}
                        onClick={() => moveBlock(index, by)}
                        className={iconButton}
                      >
                        <Glyph d={by < 0 ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
                      </button>
                    ))}
                    {custom ? (
                      <button
                        type="button"
                        aria-label={`Delete ${name}`}
                        title="Delete"
                        disabled={disabled}
                        onClick={() => patch({ blocks: draft.blocks.filter((other) => other.id !== custom.id) })}
                        className={cn(iconButton, "hover:text-[var(--color-bad)]")}
                      >
                        <Glyph d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                      </button>
                    ) : (
                      <span className="w-7 shrink-0" />
                    )}
                  </div>
                  {open ? (
                    <div className="border-t border-[var(--color-border)] p-3">
                      {custom ? (
                        <BlockEditor
                          block={custom}
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
                      ) : (
                        <Textarea
                          aria-label="Terms and conditions"
                          rows={8}
                          value={draft.terms}
                          maxLength={20000}
                          disabled={disabled}
                          onChange={(event) => patch({ terms: event.target.value })}
                        />
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {draft.blocks.length < BLOCK_LIMITS.blocks ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-[var(--color-muted)]">Add a section</span>
              {CUSTOM_BLOCKS.map((type) => (
                <Button key={type} variant="secondary" size="sm" disabled={disabled} onClick={() => addBlock(type)}>
                  + {BLOCK_LABELS[type]}
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        <div>
          <h3 className={groupTitle}>Links</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {COMPANY_LINKS.map((key) => (
              <label key={key} className="block">
                <span className={label}>{LINK_LABELS[key]}</span>
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
        </div>
      </div>
    </SettingsSection>
  );
}
