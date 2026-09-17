"use client";

import { useEffect, useRef, useState } from "react";
import { loadFeedSelection } from "@/lib/actions/feed-selection";
import type { BatchMediaItem, PhotoBatchOperation } from "@/lib/photo-batch";
import { ProjectPhotoBatch } from "./project-photo-batch";

function ActionLoading({
  error,
  onCancel,
}: {
  error: string;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label="Loading photo action"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="fixed inset-0 m-auto w-80 rounded-lg bg-white p-6 text-slate-800 shadow-xl backdrop:bg-black/50"
    >
      <p role="status" className="text-sm">
        {error || "Loading photo…"}
      </p>
      <button
        type="button"
        onClick={onCancel}
        className="mt-4 text-sm font-semibold text-blue-600"
      >
        Cancel
      </button>
    </dialog>
  );
}

export function FeedPhotoActions({
  ids,
  initialAction,
  onClear,
  onBusy,
  onSaved,
}: {
  ids: string[];
  initialAction?: PhotoBatchOperation;
  onClear: () => void;
  onBusy: (busy: boolean) => void;
  onSaved: () => void;
}) {
  const key = ids.join(",");
  const [loaded, setLoaded] = useState<{
    key: string;
    items: BatchMediaItem[];
  } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setError("");
    const timer = setTimeout(() => {
      loadFeedSelection(ids)
        .then((items) => {
          if (!cancelled) setLoaded({ key, items });
        })
        .catch((cause) => {
          if (!cancelled)
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not load selection.",
            );
        });
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key]);
  if (loaded?.key !== key && initialAction)
    return <ActionLoading error={error} onCancel={onClear} />;
  if (loaded?.key !== key)
    return (
      <div className="fixed left-4 right-4 top-4 z-40 flex items-center gap-5 rounded-lg bg-[#1c2d41] px-4 py-3 text-white shadow-lg lg:left-[246px]">
        <button
          aria-label="Clear selection"
          onClick={onClear}
          className="p-2 text-xl"
        >
          ×
        </button>
        {initialAction ? null : (
          <strong className="text-sm">{ids.length} Selected</strong>
        )}
        <span role="status" className="text-sm">
          {error || "Loading actions…"}
        </span>
      </div>
    );
  return (
    <ProjectPhotoBatch
      selected={loaded.items}
      availableTags={[...new Set(loaded.items.flatMap((item) => item.tags))]}
      onClear={onClear}
      onBusy={onBusy}
      onSaved={onSaved}
      floating
      initialAction={initialAction}
    />
  );
}
