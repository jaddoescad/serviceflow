"use client";

import { useEffect, useState } from "react";
import { Select, cn } from "@/components/ui";
import { ProjectCalculator, QUOTE_STATUS_LABELS, QuoteStatus } from "@/lib/calculator/engine";
import { IconButton } from "./bits";

const statusDot: Record<QuoteStatus, string> = {
  draft: "bg-[var(--color-muted)]",
  sent: "bg-[var(--color-warn)]",
  won: "bg-[var(--color-good)]",
  lost: "bg-[var(--color-bad)]",
};

export function QuoteBar({
  doc,
  defaultQuoteId,
  onSwitch,
  onAdd,
  onDuplicate,
  onDelete,
  onRename,
  onStatus,
}: {
  doc: ProjectCalculator;
  defaultQuoteId: string | null;
  onSwitch: (quoteId: string) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
  onStatus: (status: QuoteStatus) => void;
}) {
  const active = doc.quotes.find((q) => q.id === doc.activeQuoteId) ?? doc.quotes[0];
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!confirmDelete) return;
    const t = window.setTimeout(() => setConfirmDelete(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmDelete]);

  useEffect(() => {
    setConfirmDelete(false);
  }, [doc.activeQuoteId]);

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {doc.quotes.map((q) =>
        q.id === active.id ? (
          <span
            key={q.id}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand-soft)] py-1 pl-3 pr-2 text-xs font-medium text-[var(--color-brand-strong)]"
          >
            <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDot[q.status])} />
            {q.id === defaultQuoteId ? (
              <span className="rounded-full bg-[var(--color-good-soft)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--color-good)]">
                Default
              </span>
            ) : null}
            <input
              value={q.name}
              onChange={(e) => onRename(e.target.value)}
              name="quote-name"
              aria-label="Quote name"
              title="Click to rename"
              size={Math.max(q.name.length, 6)}
              className="bg-transparent font-medium text-[var(--color-brand-strong)] outline-none"
            />
            <span aria-hidden className="text-[10px] opacity-60">
              ✎
            </span>
          </span>
        ) : (
          <button
            key={q.id}
            type="button"
            onClick={() => onSwitch(q.id)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1 text-xs font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
          >
            <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDot[q.status])} />
            {q.name}
            {q.id === defaultQuoteId ? (
              <span className="rounded-full bg-[var(--color-good-soft)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--color-good)]">
                Default
              </span>
            ) : null}
          </button>
        ),
      )}

      <IconButton label="New quote" onClick={onAdd}>
        +
      </IconButton>

      <div className="ml-auto flex items-center gap-1.5">
        <Select
          value={active.status}
          onChange={(e) => onStatus(e.target.value as QuoteStatus)}
          name="quote-status"
          aria-label="Quote status"
          className="!py-1 text-xs"
        >
          {(Object.keys(QUOTE_STATUS_LABELS) as QuoteStatus[]).map((status) => (
            <option key={status} value={status}>
              {QUOTE_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
        <IconButton label="Duplicate quote" onClick={onDuplicate}>
          ⧉
        </IconButton>
        {confirmDelete ? (
          <button
            type="button"
            onClick={() => {
              onDelete();
              setConfirmDelete(false);
            }}
            className="rounded-lg bg-[var(--color-bad-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-bad)]"
          >
            Delete quote?
          </button>
        ) : (
          <IconButton label="Delete quote" onClick={() => setConfirmDelete(true)} danger>
            ✕
          </IconButton>
        )}
      </div>
    </div>
  );
}
