"use client";

import { PhotoToolIcon } from "./photo-tool-icon";
import { useRef, useState } from "react";
import { setPhotoTrash } from "@/lib/actions/photo-details";
import type { ProjectMediaItem } from "@/lib/project-data";

export function PhotoTrashAction({
  projectId,
  item,
  onSuccess,
  beforeAction,
  compact = false,
}: {
  compact?: boolean;
  projectId: string;
  item: ProjectMediaItem;
  onSuccess: () => void;
  beforeAction?: () => boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  async function act() {
    if (beforeAction && !beforeAction()) return;
    setBusy(true);
    setError(null);
    requestId.current ??= crypto.randomUUID();
    try {
      const result = await setPhotoTrash({
        projectId,
        mediaId: item.id,
        trashed: true,
        expectedRevision: item.trashRevision,
        revision: requestId.current,
      });
      if (result.ok) {
        setConfirming(false);
        onSuccess();
      } else setError(result.error ?? "Could not update photo.");
    } catch {
      setError("Could not confirm the change. Retry to check safely.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="relative">
      <button
        type="button"
        disabled={busy}
        onClick={() => setConfirming(true)}
        aria-label="Move to trash"
        title="Move to trash"
        className={
          compact
            ? "p-2 text-slate-800 disabled:opacity-50"
            : "rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-50"
        }
      >
        {compact ? (
          <PhotoToolIcon name="trash" />
        ) : busy ? (
          "Saving…"
        ) : (
          "Move to trash"
        )}
      </button>
      {confirming ? (
        <div
          role="group"
          aria-label="Confirm photo trash"
          className={`${compact ? "absolute top-12 left-0 w-64 bg-white text-slate-900 shadow-lg" : "mt-3"} space-y-3 rounded-lg border border-slate-300 p-3`}
        >
          <p className="text-sm">Move this photo to trash?</p>
          <div className="flex gap-3">
            <button
              disabled={busy}
              onClick={() => void act()}
              className="rounded-lg bg-red-700 px-3 py-2 text-sm text-white"
            >
              {busy ? "Moving…" : "Confirm move to trash"}
            </button>
            <button
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="text-sm underline"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
