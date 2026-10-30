"use client";

import { useRouter } from "next/navigation";
import * as React from "react";
import { cn } from "./ui";

function rowLink(target: EventTarget) {
  return (target as HTMLElement).closest("tr")?.querySelector<HTMLAnchorElement>("a[data-row-link]");
}

/** A click anywhere on a row opens that row's RowLink, unless the click was on
 * another control, inside an inline form, or ended a text selection. Modifier keys pass through, so
 * Cmd/Ctrl-click still opens a new tab. */
function openRow(event: React.MouseEvent<HTMLDivElement>) {
  const target = event.target as HTMLElement;
  if (target.closest("a,button,input,select,textarea,label,form")) return;
  if (window.getSelection()?.isCollapsed === false) return;
  rowLink(target)?.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: event.button,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    }),
  );
}

/** Holds a DataTable. `fill` runs it edge to edge to the bottom of a
 * `.page-fill` page, scrolling rows under the sticky header; otherwise it is
 * a bordered panel sized to its rows. `footer` holds the row count,
 * pagination or an export button. */
export function TablePanel({
  fill = false,
  busy,
  footer,
  children,
}: {
  fill?: boolean;
  busy?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  // Row links skip viewport prefetching; a row is prefetched when the pointer
  // or focus reaches it, so a long table does not fire a request per row.
  const prefetch = (event: React.SyntheticEvent) => {
    const href = rowLink(event.target)?.getAttribute("href");
    if (href) router.prefetch(href);
  };
  return (
    <div
      aria-busy={busy || undefined}
      style={{ "--table-edge": fill ? "var(--gutter)" : "0.75rem" } as React.CSSProperties}
      className={cn(
        "flex flex-col bg-[var(--color-surface)]",
        fill
          ? // Keep the line under the last row, above the empty space.
            "min-h-64 flex-1 [&_tbody>tr:last-child]:border-b"
          : "overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]",
      )}
    >
      <div
        className="min-h-0 flex-1 overflow-auto [&_tr:has([data-row-link])]:cursor-pointer"
        onClick={openRow}
        onMouseOver={prefetch}
        onFocus={prefetch}
      >
        {children}
      </div>
      {footer ? (
        <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] px-[var(--table-edge)] py-1.5 text-xs text-[var(--color-muted)]">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
