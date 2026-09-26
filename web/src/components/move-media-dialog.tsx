"use client";

import { useEffect, useRef, useState } from "react";
import {
  findMediaDestinations,
  moveSelectedPhoto,
} from "@/lib/actions/media-move";
import { loadFeedSelection } from "@/lib/actions/feed-selection";
import type { BatchMediaItem } from "@/lib/photo-batch";
import { ProjectModal } from "./project-profile-panel";
import { Button } from "./ui";

type Destination = { id: string; name: string; address: string | null };
type MoveEntry = {
  item: BatchMediaItem;
  revision: string;
  done: boolean;
  error?: string;
};

export function MoveMediaDialog({
  selected,
  onClose,
  onSaved,
}: {
  selected: BatchMediaItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Destination[]>([]);
  const [destination, setDestination] = useState<Destination | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [highlighted, setHighlighted] = useState(0);
  const [searching, setSearching] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [, render] = useState(0);
  const batch = useRef<MoveEntry[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    setSearching(true);
    const timeout = setTimeout(() => {
      findMediaDestinations(query)
        .then((rows) => {
          if (!cancelled) {
            setOptions(rows);
            setHighlighted(0);
          }
        })
        .catch(() => {
          if (!cancelled)
            setError("Could not find projects. Try searching again.");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query]);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  function choose(value: Destination) {
    setDestination(value);
    setQuery(value.name);
    input.current?.focus();
    setExpanded(false);
  }
  async function move() {
    if (!destination || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!batch.current) {
        const items = await loadFeedSelection(selected.map((item) => item.id));
        batch.current = items.map((item) => ({
          item,
          revision: crypto.randomUUID(),
          done: item.ownerProjectId === destination.id,
        }));
      }
      for (const entry of batch.current) {
        if (entry.done) continue;
        const result = await moveSelectedPhoto({
          mediaId: entry.item.id,
          sourceId: entry.item.ownerProjectId!,
          destinationId: destination.id,
          expectedRevision: entry.item.moveRevision ?? null,
          revision: entry.revision,
        });
        entry.done = result.ok;
        entry.error = result.ok ? undefined : result.error;
        render((value) => value + 1);
      }
      if (batch.current.every((entry) => entry.done)) onSaved();
      else
        setError(
          "Some files could not be moved. Retry unfinished moves, or close and refresh the gallery.",
        );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not move media.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ProjectModal
      title="Move Photos"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="space-y-6 p-6">
        <p className="text-sm text-slate-600">
          Choose a project for the {selected.length} selected photos and videos.
        </p>
        <div className="relative">
          <input
            ref={input}
            role="combobox"
            aria-label="Destination project"
            aria-expanded={expanded}
            aria-controls="media-destinations"
            aria-autocomplete="list"
            aria-activedescendant={
              expanded && options[highlighted]
                ? `destination-${options[highlighted].id}`
                : undefined
            }
            disabled={busy || !!batch.current}
            value={query}
            placeholder="Find a project…"
            onFocus={() => setExpanded(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setDestination(null);
              setExpanded(true);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setExpanded(true);
                setHighlighted((value) =>
                  Math.min(value + 1, options.length - 1),
                );
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlighted((value) => Math.max(value - 1, 0));
              }
              if (
                event.key === "Enter" &&
                expanded &&
                !searching &&
                options[highlighted]
              ) {
                event.preventDefault();
                choose(options[highlighted]);
              }
              if (event.key === "Escape" && expanded) {
                event.stopPropagation();
                setExpanded(false);
              }
            }}
            className="h-12 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-blue-500 focus:outline-none"
          />
          {expanded && !busy && !batch.current ? (
            <div
              id="media-destinations"
              role="listbox"
              aria-label="Projects"
              className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg"
            >
              {searching ? (
                <p role="status" className="p-3 text-sm text-slate-500">
                  Finding projects…
                </p>
              ) : (
                options.map((option, index) => (
                  <button
                    key={option.id}
                    id={`destination-${option.id}`}
                    role="option"
                    aria-selected={destination?.id === option.id}
                    onClick={() => choose(option)}
                    onMouseEnter={() => setHighlighted(index)}
                    className={`block w-full px-4 py-3 text-left text-sm ${highlighted === index ? "bg-blue-50" : "hover:bg-slate-50"}`}
                  >
                    <span className="block font-medium">{option.name}</span>
                    {option.address ? (
                      <span className="mt-1 block text-xs text-slate-500">
                        {option.address}
                      </span>
                    ) : null}
                  </button>
                ))
              )}
              {!searching && !options.length ? (
                <p className="p-3 text-sm text-slate-500">
                  No matching projects
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {batch.current
          ?.filter((entry) => entry.error)
          .map((entry) => (
            <p key={entry.item.id} className="text-xs text-red-700">
              {entry.item.originalFilename ?? "Media"}: {entry.error}
            </p>
          ))}
        <footer className="flex justify-end gap-3">
          <Button variant="subtle" disabled={busy} onClick={onClose}>
            {batch.current ? "Close" : "Cancel"}
          </Button>
          <Button disabled={!destination || busy} onClick={() => void move()}>
            {busy
              ? `Moving ${batch.current?.filter((entry) => entry.done).length ?? 0}/${selected.length}…`
              : batch.current
                ? "Retry unfinished"
                : "Move Photos"}
          </Button>
        </footer>
      </div>
    </ProjectModal>
  );
}
