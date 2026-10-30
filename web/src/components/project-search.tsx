"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { searchProjects } from "@/lib/actions/project-search";
import { SearchNavIcon } from "./nav-icons";

type Result = Awaited<ReturnType<typeof searchProjects>>[number];

export function ProjectSearch({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    setResults([]);
    setActive(-1);
    setError("");
    setLoading(Boolean(query.trim()));
    if (!query.trim()) return;
    const timer = setTimeout(async () => {
      try {
        const matches = await searchProjects(query);
        if (!cancelled) setResults(matches);
      } catch {
        if (!cancelled) setError("Could not search projects. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    // ⌘K / Ctrl+K focuses whichever copy of the search is on screen.
    function shortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      const element = input.current;
      if (!element?.getClientRects().length) return;
      event.preventDefault();
      element.focus();
      element.select();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", shortcut);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", shortcut);
    };
  }, []);

  function navigate(path: string) {
    setOpen(false);
    setQuery("");
    router.push(path);
    onNavigate?.();
  }
  const expanded = open && Boolean(query.trim());
  return (
    <div ref={root} className="relative mx-3">
      <SearchNavIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-faint)]" />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 font-sans text-[10px] text-[var(--color-faint)]">
        ⌘K
      </kbd>
      <input
        ref={input}
        role="combobox"
        aria-label="Search projects"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={expanded ? id : undefined}
        aria-activedescendant={
          expanded && active >= 0 ? `${id}-${active}` : undefined
        }
        placeholder="Search"
        value={query}
        maxLength={200}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            event.stopPropagation();
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive((current) =>
              Math.max(
                -1,
                Math.min(
                  results.length - 1,
                  current + (event.key === "ArrowDown" ? 1 : -1),
                ),
              ),
            );
          }
          if (event.key === "Enter" && query.trim()) {
            event.preventDefault();
            navigate(
              active >= 0 && results[active]
                ? `/jobs/${results[active].id}`
                : `/projects?q=${encodeURIComponent(query.trim())}`,
            );
          }
        }}
        className="h-8 w-full rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] pl-8 pr-10 text-[13px] text-[var(--color-text)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--color-faint)] focus:border-[var(--color-brand)] focus:shadow-[var(--focus-ring)]"
      />
      {expanded ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-32px)] overflow-hidden rounded-[var(--radius)] bg-[var(--color-surface)] p-1 text-[var(--color-text)] shadow-[var(--shadow-pop)]">
          <div
            id={id}
            role="listbox"
            aria-label="Project suggestions"
            className="max-h-80 overflow-y-auto"
          >
            {results.map((result, index) => (
              <button
                key={result.id}
                id={`${id}-${index}`}
                type="button"
                role="option"
                aria-selected={active === index}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => navigate(`/jobs/${result.id}`)}
                className={`block w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[var(--color-hover)] ${active === index ? "bg-[var(--color-hover)]" : ""}`}
              >
                <span className="block truncate font-medium text-[var(--color-heading)]">
                  {result.name}
                </span>
                {result.address ? (
                  <span className="block truncate text-xs text-[var(--color-muted)]">
                    {result.address}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div aria-live="polite">
            {loading || error || !results.length ? (
              <p className="px-2 py-2 text-[13px] text-[var(--color-muted)]">
                {loading ? "Searching…" : error || "No matching projects"}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() =>
              navigate(`/projects?q=${encodeURIComponent(query.trim())}`)
            }
            className="mt-1 w-full rounded-md border-t border-[var(--color-border)] px-2 py-2 text-left text-[13px] font-medium text-[var(--color-brand-strong)] hover:bg-[var(--color-hover)]"
          >
            View all results
          </button>
        </div>
      ) : null}
    </div>
  );
}
