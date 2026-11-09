"use client";

import { useRef, useState, useTransition } from "react";
import { saveProposalPage } from "@/lib/actions/settings";
import { documentAssetUrl, removeDocumentAssets, uploadDocumentAsset, webImage } from "@/lib/document-assets";
import {
  HIGHLIGHT_ICONS,
  MAX_ABOUT_POINTS,
  MAX_HIGHLIGHTS,
  type HighlightIcon,
  type ProposalPage,
} from "@/lib/proposal-types";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { SaveStatus, SettingsSection } from "./settings-section";

const ICON_LABELS: Record<HighlightIcon, string> = {
  award: "Award",
  shield: "Shield",
  star: "Star",
  heart: "Heart",
  clock: "Clock",
  tools: "Tools",
  thumbsUp: "Thumbs up",
  check: "Check",
};

const EMPTY_HIGHLIGHT = { icon: "check" as HighlightIcon, title: "", body: "" };

/** Always three highlight slots to fill in; empty ones are dropped on save. */
function withSlots(page: ProposalPage): ProposalPage {
  const highlights = [...page.highlights];
  while (highlights.length < MAX_HIGHLIGHTS) highlights.push({ ...EMPTY_HIGHLIGHT });
  return { ...page, highlights, aboutPoints: page.aboutPoints.length ? page.aboutPoints : [{ title: "", body: "" }] };
}

const label = "mb-1 block text-xs font-medium text-[var(--color-muted)]";
const groupTitle = "text-[13px] font-semibold text-[var(--color-heading)]";

export function ProposalPageForm({
  orgId,
  companyName,
  page,
  canManage,
}: {
  orgId: string;
  companyName: string;
  page: ProposalPage;
  canManage: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => withSlots(page));
  const [saved, setSaved] = useState(() => JSON.stringify(withSlots(page)));
  const [status, setStatus] = useState<{ error?: string; message?: string }>({});
  const [pending, startTransition] = useTransition();
  const disabled = !canManage || pending;
  const dirty = JSON.stringify(draft) !== saved;

  function patch(next: Partial<ProposalPage>) {
    setDraft((current) => ({ ...current, ...next }));
    setStatus({});
  }

  async function save(next: ProposalPage, message: string) {
    const result = await saveProposalPage(next);
    if (!result.ok) {
      setStatus({ error: result.error ?? "Could not save." });
      return false;
    }
    setDraft(next);
    setSaved(JSON.stringify(next));
    setStatus({ message });
    return true;
  }

  function uploadCover(file: File | undefined) {
    if (!file) return;
    startTransition(async () => {
      setStatus({});
      const image = await webImage(file);
      if (!image) {
        setStatus({ error: "Choose a JPG, PNG or WebP photo." });
        return;
      }
      let path: string;
      try {
        path = await uploadDocumentAsset(orgId, image, file.name);
      } catch {
        setStatus({ error: "Could not upload the photo. Try again." });
        return;
      }
      const previous = draft.heroPath;
      if (await save({ ...draft, heroPath: path }, "Cover photo saved.")) {
        if (previous) await removeDocumentAssets([previous]);
      } else {
        await removeDocumentAssets([path]);
      }
    });
  }

  function removeCover() {
    const previous = draft.heroPath;
    if (!previous) return;
    startTransition(async () => {
      setStatus({});
      if (await save({ ...draft, heroPath: null }, "Cover photo removed.")) await removeDocumentAssets([previous]);
    });
  }

  function setHighlight(index: number, next: Partial<ProposalPage["highlights"][number]>) {
    patch({ highlights: draft.highlights.map((card, at) => (at === index ? { ...card, ...next } : card)) });
  }

  function setPoint(index: number, next: Partial<ProposalPage["aboutPoints"][number]>) {
    patch({ aboutPoints: draft.aboutPoints.map((point, at) => (at === index ? { ...point, ...next } : point)) });
  }

  return (
    <SettingsSection
      id="proposal-page"
      title="Customer proposal page"
      description="What every customer sees around your prices when they open a proposal."
      footer={
        canManage ? (
          <>
            <SaveStatus error={status.error} message={status.message} />
            <Button
              className="ml-auto"
              disabled={pending || !dirty}
              onClick={() => startTransition(async () => void (await save(draft, "Saved.")))}
            >
              {pending ? "Saving…" : "Save"}
            </Button>
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
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => fileInput.current?.click()}>
              {draft.heroPath ? "Replace" : "Upload photo"}
            </Button>
            {draft.heroPath ? (
              <Button variant="ghost" size="sm" disabled={disabled} onClick={removeCover}>
                Remove
              </Button>
            ) : (
              <span className="text-xs text-[var(--color-muted)]">A wide photo works best, about 1200 × 400.</span>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(event) => {
                uploadCover(event.target.files?.[0]);
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
          <h3 className={groupTitle}>Highlights</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {draft.highlights.map((card, index) => (
              <div key={index} className="space-y-2 rounded-[var(--radius)] border border-[var(--color-border)] p-3">
                <Select
                  aria-label={`Highlight ${index + 1} icon`}
                  value={card.icon}
                  disabled={disabled}
                  onChange={(event) => setHighlight(index, { icon: event.target.value as HighlightIcon })}
                >
                  {HIGHLIGHT_ICONS.map((icon) => (
                    <option key={icon} value={icon}>
                      {ICON_LABELS[icon]}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={`Highlight ${index + 1} title`}
                  placeholder="Title"
                  value={card.title}
                  maxLength={80}
                  disabled={disabled}
                  onChange={(event) => setHighlight(index, { title: event.target.value })}
                />
                <Textarea
                  aria-label={`Highlight ${index + 1} description`}
                  placeholder="A sentence or two"
                  rows={3}
                  value={card.body}
                  maxLength={400}
                  disabled={disabled}
                  onChange={(event) => setHighlight(index, { body: event.target.value })}
                />
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className={groupTitle}>Why choose us</h3>
          <Input
            aria-label="Why choose us heading"
            className="mt-2"
            placeholder={`Why choose ${companyName}`}
            value={draft.aboutHeading}
            maxLength={120}
            disabled={disabled}
            onChange={(event) => patch({ aboutHeading: event.target.value })}
          />
          <ol className="mt-2 space-y-2">
            {draft.aboutPoints.map((point, index) => (
              <li key={index} className="flex gap-2 rounded-[var(--radius)] border border-[var(--color-border)] p-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <Input
                    aria-label={`Point ${index + 1} title`}
                    placeholder="Point"
                    value={point.title}
                    maxLength={120}
                    disabled={disabled}
                    onChange={(event) => setPoint(index, { title: event.target.value })}
                  />
                  <Textarea
                    aria-label={`Point ${index + 1} description`}
                    placeholder="Details"
                    rows={2}
                    value={point.body}
                    maxLength={600}
                    disabled={disabled}
                    onChange={(event) => setPoint(index, { body: event.target.value })}
                  />
                </div>
                {draft.aboutPoints.length > 1 ? (
                  <button
                    type="button"
                    aria-label={`Remove point ${index + 1}`}
                    disabled={disabled}
                    onClick={() => patch({ aboutPoints: draft.aboutPoints.filter((_, at) => at !== index) })}
                    className="h-8 w-8 shrink-0 rounded-[var(--radius-control)] text-base text-[var(--color-faint)] hover:bg-[var(--color-hover)] hover:text-[var(--color-bad)]"
                  >
                    ×
                  </button>
                ) : null}
              </li>
            ))}
          </ol>
          {draft.aboutPoints.length < MAX_ABOUT_POINTS ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1"
              disabled={disabled}
              onClick={() => patch({ aboutPoints: [...draft.aboutPoints, { title: "", body: "" }] })}
            >
              + Add point
            </Button>
          ) : null}
        </div>

        <div>
          <h3 className={groupTitle}>Numbers</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            {(
              [
                ["projects", "Projects completed", "500+"],
                ["years", "Years in business", "20+"],
                ["rating", "Google rating", "4.9"],
              ] as const
            ).map(([key, name, example]) => (
              <label key={key} className="block">
                <span className={label}>{name}</span>
                <Input
                  placeholder={example}
                  value={draft.stats[key]}
                  maxLength={20}
                  disabled={disabled}
                  onChange={(event) => patch({ stats: { ...draft.stats, [key]: event.target.value } })}
                />
              </label>
            ))}
          </div>
        </div>

        <label className="block">
          <span className={groupTitle}>Terms and conditions</span>
          <Textarea
            className="mt-2"
            rows={8}
            value={draft.terms}
            maxLength={20000}
            disabled={disabled}
            onChange={(event) => patch({ terms: event.target.value })}
          />
        </label>
      </div>
    </SettingsSection>
  );
}
