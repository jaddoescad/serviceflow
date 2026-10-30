"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PipelineCard } from "@/lib/pipeline-types";

export type CardMenuState = { card: PipelineCard; anchor: DOMRect };

const itemClass =
  "flex h-8 w-full items-center rounded-[var(--radius-control)] px-2 text-left text-[13px] text-[var(--color-text)] outline-none hover:bg-[var(--color-hover)] focus-visible:bg-[var(--color-hover)]";

function Item({ href, onClick, children }: { href?: string; onClick?: () => void; children: ReactNode }) {
  return href ? (
    <Link role="menuitem" href={href} className={itemClass}>
      {children}
    </Link>
  ) : (
    <button role="menuitem" type="button" onClick={onClick} className={itemClass}>
      {children}
    </button>
  );
}

/** A card's ⋯ menu, DripJobs' card actions. One menu for the whole board,
 * fixed to the viewport so a column's scroll can't clip it. Clicks on a ⋯
 * button ([data-card-menu]) are left to the button, which toggles it. */
export function PipelineCardMenu({
  menu,
  isSales,
  onClose,
  onMove,
  onEditLabels,
  onDripsPaused,
  onArchived,
  onMessage,
}: {
  menu: CardMenuState;
  isSales: boolean;
  onClose: () => void;
  onMessage: (card: PipelineCard) => void;
  onMove: (card: PipelineCard) => void;
  onEditLabels: (card: PipelineCard) => void;
  onDripsPaused: (card: PipelineCard, paused: boolean) => void;
  onArchived: (card: PipelineCard, archived: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const { card, anchor } = menu;
  const id = encodeURIComponent(card.id);

  // Right-aligned under the button, or above it when there's no room below.
  useLayoutEffect(() => {
    const { offsetWidth: width = 0, offsetHeight: height = 0 } = panel.current ?? {};
    const below = anchor.bottom + 4;
    setPlace({
      top: below + height > window.innerHeight - 8 ? Math.max(8, anchor.top - height - 4) : below,
      left: Math.min(Math.max(8, anchor.right - width), window.innerWidth - width - 8),
    });
  }, [anchor]);

  useEffect(() => {
    const inside = (target: EventTarget | null) =>
      target instanceof Node && (panel.current?.contains(target) || (target instanceof Element && target.closest("[data-card-menu]")));
    const outside = (event: PointerEvent) => !inside(event.target) && onClose();
    const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const scrolled = (event: Event) => !inside(event.target) && onClose();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={panel}
      role="menu"
      aria-label={`Actions for ${card.name}`}
      onClick={(event) => (event.target as Element).closest("a") && onClose()}
      style={{ top: place?.top ?? 0, left: place?.left ?? 0, visibility: place ? "visible" : "hidden" }}
      className="fixed z-50 w-48 rounded-[var(--radius)] bg-[var(--color-surface)] p-1 shadow-[var(--shadow-pop)]"
    >
      {card.contactId ? (
        <>
          <Item href={`/contacts/${encodeURIComponent(card.contactId)}`}>View customer</Item>
          <Item onClick={() => onMessage(card)}>Send a text</Item>
          <div role="separator" className="my-1 h-px bg-[var(--color-border)]" />
        </>
      ) : null}
      {card.archived ? null : (
        <>
          <Item onClick={() => onMove(card)}>Move to…</Item>
          {isSales ? <Item href={`/jobs/${id}/proposals/new`}>New proposal</Item> : null}
        </>
      )}
      <Item href={`/deals/${id}?tab=notes`}>Add note</Item>
      {card.archived ? null : (
        <>
          <Item onClick={() => onEditLabels(card)}>{card.labels.length ? "Edit labels" : "Add label"}</Item>
          <Item onClick={() => onDripsPaused(card, !card.dripsPaused)}>{card.dripsPaused ? "Resume drips" : "Pause drips"}</Item>
        </>
      )}
      {isSales ? (
        <>
          <div role="separator" className="my-1 h-px bg-[var(--color-border)]" />
          <Item onClick={() => onArchived(card, !card.archived)}>{card.archived ? "Restore deal" : "Archive deal"}</Item>
        </>
      ) : null}
    </div>,
    document.body,
  );
}
