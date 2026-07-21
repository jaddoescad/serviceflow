"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui";
import { EXTERIOR_CATALOG } from "@/lib/calculator/engine";

/** Room names that keep coming up in quotes — instant autocomplete. */
const ROOM_SUGGESTIONS = [
  "Living room",
  "Dining room",
  "Kitchen",
  "Master bedroom",
  "Bedroom",
  "Bathroom",
  "Ensuite",
  "Powder room",
  "Office",
  "Foyer",
  "Hallway",
  "Staircase",
  "Upper landing",
  "Laundry",
  "Family room",
  "Recreation room",
  "Basement",
  "Closet",
  "Den",
  "Mudroom",
  "Sunroom",
  "Nursery",
  "Eating area",
];

type Suggestion =
  | { kind: "room"; label: string }
  | { kind: "exterior"; label: string; itemId: string }
  | { kind: "customRoom"; label: string };

/** State-level extras that live outside the catalog. */
const EXTRA_EXTERIOR: Array<{ label: string; itemId: string }> = [
  { label: "Pressure washing", itemId: "washing" },
];

export function AddBar({
  onAddRoom,
  onAddExterior,
}: {
  onAddRoom: (name: string) => void;
  onAddExterior: (itemId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo<Suggestion[]>(() => {
    const q = query.trim().toLowerCase();
    // Exact match beats prefix beats substring, so "bedroom" picks Bedroom,
    // not Master bedroom.
    const rank = (label: string) => {
      const l = label.toLowerCase();
      return l === q ? 0 : l.startsWith(q) ? 1 : 2;
    };
    const rooms = ROOM_SUGGESTIONS.filter((name) => !q || name.toLowerCase().includes(q)).sort(
      (a, b) => (q ? rank(a) - rank(b) : 0),
    );
    const exterior = [
      ...EXTERIOR_CATALOG.map((item) => ({ label: item.label, itemId: item.id })),
      ...EXTRA_EXTERIOR,
    ]
      .filter((item) => !q || item.label.toLowerCase().includes(q))
      .sort((a, b) => (q ? rank(a.label) - rank(b.label) : 0));
    const list: Suggestion[] = [
      ...rooms.slice(0, q ? 6 : 8).map((label) => ({ kind: "room" as const, label })),
      ...exterior.slice(0, q ? 6 : 5).map((item) => ({
        kind: "exterior" as const,
        label: item.label,
        itemId: item.itemId,
      })),
    ];
    const exactMatch = rooms.some((name) => name.toLowerCase() === q);
    if (q && !exactMatch) {
      list.push({ kind: "customRoom", label: query.trim() });
    }
    return list;
  }, [query]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function pick(suggestion: Suggestion | undefined) {
    if (!suggestion) return;
    if (suggestion.kind === "exterior") onAddExterior(suggestion.itemId);
    else onAddRoom(suggestion.label);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  }

  const roomItems = suggestions.filter((s) => s.kind !== "exterior");
  const exteriorItems = suggestions.filter((s) => s.kind === "exterior");

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-[var(--shadow)] focus-within:border-[var(--color-brand)]">
        <span className="text-lg leading-none text-[var(--color-muted)]" aria-hidden>
          +
        </span>
        <input
          ref={inputRef}
          name="add-item"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(suggestions[highlight]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder="Add a room or exterior item — try “living room” or “soffits”…"
          className="w-full bg-transparent text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]"
          role="combobox"
          aria-expanded={open}
          aria-controls="add-bar-listbox"
          aria-label="Add a room or exterior item"
        />
      </div>

      {open && suggestions.length > 0 ? (
        <div
          id="add-bar-listbox"
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-2 shadow-lg"
        >
          <div className="grid gap-0 sm:grid-cols-2">
            <div>
              <div className="px-4 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Interior rooms
              </div>
              {roomItems.map((s) => (
                <SuggestionRow
                  key={`room:${s.label}`}
                  active={suggestions.indexOf(s) === highlight}
                  onHover={() => setHighlight(suggestions.indexOf(s))}
                  onPick={() => pick(s)}
                >
                  {s.kind === "customRoom" ? (
                    <>
                      Add “<span className="font-medium text-[var(--color-heading)]">{s.label}</span>” as a room
                    </>
                  ) : (
                    s.label
                  )}
                </SuggestionRow>
              ))}
              {roomItems.length === 0 ? <EmptyHint>No matching rooms</EmptyHint> : null}
            </div>
            <div className="border-t border-[var(--color-border)] pt-2 sm:border-l sm:border-t-0 sm:pt-0">
              <div className="px-4 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Exterior items
              </div>
              {exteriorItems.map((s) => (
                <SuggestionRow
                  key={`ext:${s.kind === "exterior" ? s.itemId : s.label}`}
                  active={suggestions.indexOf(s) === highlight}
                  onHover={() => setHighlight(suggestions.indexOf(s))}
                  onPick={() => pick(s)}
                >
                  {s.label}
                </SuggestionRow>
              ))}
              {exteriorItems.length === 0 ? <EmptyHint>No matching items</EmptyHint> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SuggestionRow({
  active,
  onPick,
  onHover,
  children,
}: {
  active: boolean;
  onPick: () => void;
  onHover: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        e.preventDefault();
        onPick();
      }}
      className={cn(
        "block w-full px-4 py-1.5 text-left text-sm transition-colors",
        active ? "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]" : "text-[var(--color-text)]",
      )}
    >
      {children}
    </button>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-1.5 text-sm text-[var(--color-muted)]">{children}</div>;
}
