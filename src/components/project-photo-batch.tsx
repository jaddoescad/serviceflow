"use client";

import { duplicatePhoto } from "@/lib/actions/media-duplicate";
import { MoveMediaDialog } from "./move-media-dialog";
import { PhotoTagPicker } from "./photo-tag-picker";
import { useEffect, useId, useRef, useState } from "react";
import type { BatchMediaItem } from "@/lib/photo-batch";
import {
  preparePhotoBatch,
  runPhotoBatch,
  type PhotoBatchItem,
  type PhotoBatchOperation,
} from "@/lib/photo-batch";
import { savePhotoDetails, setPhotoTrash } from "@/lib/actions/photo-details";

export function ProjectPhotoBatch({
  projectId,
  selected,
  availableTags = [],
  onClear,
  onBusy,
  onSaved,
  floating = false,
  initialAction,
}: {
  initialAction?: PhotoBatchOperation;
  floating?: boolean;
  availableTags?: string[];
  projectId?: string;
  selected: BatchMediaItem[];
  onClear: () => void;
  onBusy: (busy: boolean) => void;
  onSaved: () => void;
}) {
  const [operation, setOperation] = useState<PhotoBatchOperation>("add-tags");
  const [tags, setTags] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  useEffect(() => {
    if (initialAction) choose(initialAction);
  }, [initialAction]);
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [, render] = useState(0);
  const pending = useRef<PhotoBatchItem[] | null>(null);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  async function apply() {
    if (busy) return;
    if (!pending.current) {
      try {
        pending.current = preparePhotoBatch(selected, operation, tags);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Check your tags.");
        return;
      }
      if (operation === "trash") {
        setConfirming(true);
        onBusy(true);
        return;
      }
    }
    setConfirming(false);
    const batch = pending.current;
    setBusy(true);
    onBusy(true);
    setMessage("");
    try {
      await runPhotoBatch(
        batch,
        (entry) =>
          operation === "duplicate"
            ? duplicatePhoto({
                mediaId: entry.item.id,
                projectId: entry.item.ownerProjectId ?? projectId!,
                copyId: entry.revision,
              })
            : operation === "trash"
              ? setPhotoTrash({
                  projectId: entry.item.ownerProjectId ?? projectId!,
                  mediaId: entry.item.id,
                  trashed: true,
                  expectedRevision: entry.item.trashRevision,
                  revision: entry.revision,
                })
              : savePhotoDetails({
                  projectId: entry.item.ownerProjectId ?? projectId!,
                  mediaId: entry.item.id,
                  expectedRevision: entry.item.revision,
                  revision: entry.revision,
                  description: entry.item.description ?? "",
                  tags: entry.tags,
                }),
        () => render((value) => value + 1),
      );
      const failed = batch.filter((entry) => !entry.done).length;
      if (failed)
        setMessage(
          `${batch.length - failed} saved · ${failed} need attention. Retry safely, or finish and reselect photos with conflicting edits.`,
        );
      else {
        pending.current = null;
        dialog.current?.close();
        onClear();
        setMessage(
          operation === "duplicate"
            ? `${batch.length} ${batch.length === 1 ? "photo" : "photos"} duplicated.`
            : operation === "trash"
              ? `${batch.length} ${batch.length === 1 ? "item" : "items"} moved to trash.`
              : `${batch.length} photos/videos updated.`,
        );
      }
      onSaved();
    } finally {
      setBusy(false);
      onBusy(pending.current !== null);
    }
  }
  const batch = pending.current;
  if (!selected.length && !batch)
    return message ? (
      <p role="status" className="mb-3 text-sm text-teal-700">
        {message}
      </p>
    ) : null;
  function dismiss() {
    if (busy) return;
    pending.current = null;
    setConfirming(false);
    onBusy(false);
    setMessage("");
    dialog.current?.close();
    if (initialAction) onClear();
  }
  function choose(next: PhotoBatchOperation) {
    setOperation(next);
    setTags([]);
    setMessage("");
    setConfirming(next === "trash");
    menu.current?.hidePopover();
    dialog.current?.showModal();
  }
  return (
    <>
      <div
        className={`${floating ? "fixed left-4 right-4 top-4 z-40 lg:left-[246px]" : "sticky bottom-4 z-30 my-4"} flex items-center gap-5 rounded-lg bg-[#1c2d41] px-4 py-3 text-white shadow-lg`}
        style={initialAction ? { display: "none" } : undefined}
        aria-label="Selected photo actions"
      >
        <button
          aria-label="Clear selection"
          disabled={busy || !!batch}
          onClick={() => {
            dismiss();
            onClear();
          }}
          className="rounded p-2 text-xl hover:bg-white/10 disabled:opacity-50"
        >
          ×
        </button>
        <strong className="border-r border-white/30 pr-5 text-sm">
          {batch ? batch.length : selected.length} Selected
        </strong>
        <button
          type="button"
          popoverTarget={menuId}
          disabled={busy || !!batch}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            const height = selected.every((item) => item.mediaType === "image")
              ? 300
              : 264;
            setMenuPosition({
              left: Math.max(8, Math.min(bounds.left, window.innerWidth - 232)),
              top:
                bounds.bottom + height + 8 < window.innerHeight
                  ? bounds.bottom + 4
                  : Math.max(8, bounds.top - height - 4),
            });
          }}
          className="rounded-md px-3 py-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-50"
        >
          Actions <span aria-hidden="true">⌄</span>
        </button>
        <div
          id={menuId}
          ref={menu}
          popover="auto"
          style={menuPosition}
          className="fixed m-0 max-h-[calc(100dvh-16px)] w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white py-2 text-sm text-slate-800 shadow-xl"
        >
          {selected.length === 1 ? (
            <a
              href={`/api/jobs/${selected[0].ownerProjectId ?? projectId}/media/${selected[0].id}?download=1`}
              download
              className="block w-full px-4 py-2 text-left hover:bg-slate-100"
              onClick={() => {
                menu.current?.hidePopover();
              }}
            >
              Download
            </a>
          ) : (
            <form
              action="/api/photos/download"
              method="post"
              target="_blank"
              onSubmit={() => {
                menu.current?.hidePopover();
              }}
            >
              <input
                type="hidden"
                name="ids"
                value={JSON.stringify(selected.map((item) => item.id))}
              />
              <button
                type="submit"
                disabled={busy || !!batch}
                className="block w-full px-4 py-2 text-left hover:bg-slate-100"
              >
                Download
              </button>
            </form>
          )}
          {selected.every((item) => item.mediaType === "image") ? (
            <button
              disabled={busy || !!batch}
              onClick={() => choose("duplicate")}
              className="block w-full px-4 py-2 text-left hover:bg-slate-100"
            >
              Duplicate
            </button>
          ) : null}
          <button
            disabled={busy || !!batch}
            onClick={() => choose("add-tags")}
            className="block w-full px-4 py-2 text-left hover:bg-slate-100"
          >
            Tag
          </button>
          <button
            disabled={busy || !!batch}
            onClick={() => choose("remove-tags")}
            className="block w-full px-4 py-2 text-left hover:bg-slate-100"
          >
            Remove Tags
          </button>
          <hr className="my-2 border-slate-200" />
          <button
            disabled={busy || !!batch}
            onClick={() => {
              menu.current?.hidePopover();
              setMoving(true);
              onBusy(true);
            }}
            className="block w-full px-4 py-2 text-left hover:bg-slate-100"
          >
            Move
          </button>
          <button
            disabled={busy || !!batch}
            onClick={() => choose("trash")}
            className="block w-full px-4 py-2 text-left hover:bg-slate-100"
          >
            Move to Trash
          </button>
        </div>
      </div>
      {moving ? (
        <MoveMediaDialog
          selected={selected}
          onClose={() => {
            setMoving(false);
            onBusy(false);
            onSaved();
          }}
          onSaved={() => {
            setMoving(false);
            onBusy(false);
            onClear();
            onSaved();
          }}
        />
      ) : null}
      <dialog
        ref={dialog}
        aria-label={
          operation === "duplicate"
            ? "Duplicate Photos"
            : operation === "trash"
              ? "Move to Trash"
              : operation === "add-tags"
                ? "Tag Photos"
                : "Remove Tags"
        }
        onCancel={(event) => {
          event.preventDefault();
          dismiss();
        }}
        className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-lg bg-white p-6 text-slate-800 shadow-xl backdrop:bg-black/50"
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">
            {operation === "duplicate"
              ? "Duplicate Photos"
              : operation === "trash"
                ? "Move to Trash"
                : operation === "add-tags"
                  ? "Select Tags"
                  : "Remove Tags"}
          </h2>
          <button
            aria-label="Close photo action"
            disabled={busy}
            onClick={dismiss}
            className="rounded p-1 text-2xl text-slate-500"
          >
            ×
          </button>
        </div>
        {operation === "duplicate" ? (
          <p className="mb-5 text-sm">
            Duplicate{" "}
            {selected.length === 1
              ? "this photo"
              : `${selected.length} selected photos`}
            ?
          </p>
        ) : operation === "trash" ? (
          <p className="mb-5 text-sm">
            {initialAction
              ? `Move this ${selected[0]?.mediaType === "video" ? "video" : "photo"} to trash?`
              : `Move ${selected.length} selected photos/videos to trash?`}
          </p>
        ) : (
          <div className="mb-5">
            <PhotoTagPicker
              key={operation}
              value={tags}
              options={
                operation === "remove-tags"
                  ? selected.flatMap((item) => item.tags)
                  : availableTags
              }
              allowCreate={operation === "add-tags"}
              disabled={busy || !!batch}
              onChange={setTags}
            />
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button
            disabled={busy}
            onClick={dismiss}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm"
          >
            {batch ? "Finish" : "Cancel"}
          </button>
          <button
            disabled={busy}
            onClick={() => {
              if (confirming && !pending.current) {
                pending.current = preparePhotoBatch(selected, "trash", []);
              }
              void apply();
            }}
            className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy
              ? `Saving ${batch?.filter((item) => item.done).length ?? 0}/${batch?.length ?? 0}…`
              : batch
                ? "Retry unfinished"
                : operation === "duplicate"
                  ? "Duplicate"
                  : operation === "trash"
                    ? "Move to Trash"
                    : operation === "add-tags"
                      ? "Tag Photos"
                      : "Remove Tags"}
          </button>
        </div>
        {message ? (
          <p role="status" className="mt-3 text-sm">
            {message}
          </p>
        ) : null}
        {batch?.some((item) => item.error) ? (
          <ul className="mt-2 max-h-32 overflow-auto text-sm text-red-700">
            {batch
              .filter((item) => item.error)
              .map((item) => (
                <li key={item.item.id}>
                  {item.item.originalFilename ?? "Photo"}: {item.error}
                </li>
              ))}
          </ul>
        ) : null}
      </dialog>
    </>
  );
}
