"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MediaViewerContent } from "./media-viewer-content";
import { PhotoTrashAction } from "./project-photo-trash";
import { loadLinkedPhoto } from "@/lib/actions/linked-photo";
import type { PhotoFeedItem } from "@/lib/photo-feed";
import type { ProjectMediaItem } from "@/lib/project-data";
import { PhotoDetailsEditor } from "./photo-details-editor";

export function FeedMediaViewer({
  items,
  activeId,
  onChange,
  onClose,
  onRemoved,
  onUpdated,
}: {
  items: PhotoFeedItem[];
  activeId: string;
  onChange: (id: string) => void;
  onClose: () => void;
  onRemoved: () => void;
  onUpdated: () => void;
}) {
  const index = items.findIndex((item) => item.id === activeId);
  const active = items[index];
  const [details, setDetails] = useState<ProjectMediaItem | null>(null);
  const [error, setError] = useState("");
  const dirty = useRef(false);
  const changed = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const setDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const mayLeave = () =>
    !dirty.current || window.confirm("Discard unsaved description changes?");
  function close() {
    if (mayLeave()) {
      if (changed.current) onUpdated();
      onClose();
    }
  }
  function navigate(offset: number) {
    const target = items[index + offset];
    if (target && mayLeave()) onChange(target.id);
  }
  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    setError("");
    dirty.current = false;
    if (active)
      void loadLinkedPhoto(active.ownerProjectId, active.id)
        .then((value) => {
          if (cancelled) return;
          if (value) setDetails(value);
          else setError("This media is no longer available.");
        })
        .catch(() => {
          if (!cancelled)
            setError("Could not load media details. Reopen to retry.");
        });
    return () => {
      cancelled = true;
    };
  }, [active?.id, active?.ownerProjectId]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.target as HTMLElement).closest("[data-photo-editor]")) return;
      if (
        event.key !== "Tab" &&
        (event.target as HTMLElement).closest("[data-photo-tag-picker]")
      )
        return;
      if (event.key === "Escape") {
        if (document.fullscreenElement) return;
        event.preventDefault();
        close();
      }
      if (
        event.key !== "Tab" &&
        (event.target as HTMLElement).closest("input,textarea,select,video")
      )
        return;
      if (event.key === "ArrowLeft") navigate(-1);
      if (event.key === "ArrowRight") navigate(1);
      if (event.key === "Tab") {
        const nodes = dialog.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),video[controls]",
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  if (!active) return null;
  const currentDetails = details?.id === active.id ? details : null;
  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-900/70 p-0 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`${active.mediaType === "video" ? "Video" : "Photo"} ${index + 1} of ${items.length}`}
        className="h-full overflow-hidden bg-black outline-none sm:rounded-lg"
      >
        <MediaViewerContent
          projectId={active.ownerProjectId}
          projectName={active.projectName}
          address={active.address}
          mediaId={active.id}
          mediaType={active.mediaType}
          alt={active.description || active.projectName}
          downloadName={currentDetails?.originalFilename || active.id}
          creatorName={active.creatorName}
          capturedAt={active.capturedAt}
          onClose={close}
          beforeNavigate={mayLeave}
          onPrevious={index > 0 ? () => navigate(-1) : undefined}
          onNext={index < items.length - 1 ? () => navigate(1) : undefined}
          actions={
            currentDetails ? (
              <PhotoTrashAction
                compact
                key={currentDetails.id}
                projectId={active.ownerProjectId}
                item={currentDetails}
                beforeAction={mayLeave}
                onSuccess={() => {
                  onClose();
                  onRemoved();
                }}
              />
            ) : null
          }
        >
          {currentDetails ? (
            <PhotoDetailsEditor
              key={currentDetails.id}
              projectId={active.ownerProjectId}
              mediaId={currentDetails.id}
              description={currentDetails.description}
              tags={currentDetails.tags}
              revision={currentDetails.revision}
              onDirtyChange={setDirty}
              onSaved={() => {
                changed.current = true;
              }}
            />
          ) : (
            <p role="status" className="px-5 text-sm text-slate-500">
              {error || "Loading details…"}
            </p>
          )}
        </MediaViewerContent>
      </div>
    </div>
  );
}
