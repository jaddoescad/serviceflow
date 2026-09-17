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
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);

  function navigate(path: string) {
    setOpen(false);
    setQuery("");
    router.push(path);
    onNavigate?.();
  }
  const expanded = open && Boolean(query.trim());
  return (
    <div ref={root} className="relative mx-4">
      <SearchNavIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--sidebar-muted)]" />
      <input
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
        className="h-10 w-full rounded-md border border-[var(--sidebar-border)] bg-[var(--sidebar-surface)] pl-10 pr-3 text-sm text-[var(--sidebar-text)] outline-none placeholder:text-[var(--sidebar-muted)] focus:border-[#6ea8ff] focus:ring-2 focus:ring-[#6ea8ff]/25"
      />
      {expanded ? (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-slate-200 bg-white text-slate-900 shadow-xl">
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
                className={`block w-full px-4 py-3 text-left text-sm hover:bg-slate-100 ${active === index ? "bg-slate-100" : ""}`}
              >
                <span className="block truncate font-medium">
                  {result.name}
                </span>
                {result.address ? (
                  <span className="mt-1 block truncate text-xs text-slate-500">
                    {result.address}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div aria-live="polite">
            {loading || error || !results.length ? (
              <p className="px-4 py-3 text-sm text-slate-500">
                {loading ? "Searching…" : error || "No matching projects"}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() =>
              navigate(`/projects?q=${encodeURIComponent(query.trim())}`)
            }
            className="w-full border-t border-slate-100 px-4 py-3 text-left text-sm font-medium text-blue-600 hover:bg-slate-50"
          >
            View all results
          </button>
        </div>
      ) : null}
    </div>
  );
}
