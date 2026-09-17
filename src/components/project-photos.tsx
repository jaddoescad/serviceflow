"use client";

import { toggleMediaSelection } from "@/lib/media-selection";

import { MediaItemMenu } from "./media-item-menu";

import { PhotoToolbar, type MediaView } from "./photo-toolbar";
import { SITE_NAME } from "@/lib/site-brand";

import { useLinkedPhoto } from "@/lib/use-linked-photo";
import { ProjectPhotoBatch } from "@/components/project-photo-batch";
import { MediaViewerContent } from "./media-viewer-content";
import { useCallback, useEffect, useRef, useState } from "react";
import { PhotoDetailsEditor } from "@/components/photo-details-editor";
import { PhotoTrashAction } from "@/components/project-photo-trash";
import { useRouter } from "next/navigation";
import { useGalleryPages } from "@/lib/use-gallery-pages";
import type { GalleryPage } from "@/lib/gallery-page";
import { ProjectMediaPreview } from "@/components/project-media-preview";
import { ProjectMediaUpload } from "@/components/project-upload-provider";
import { ProjectProfilePanel } from "@/components/project-profile-panel";
import { Card } from "@/components/ui";
import type { ProjectContact, ProjectMediaItem } from "@/lib/project-data";

import {
  localDateKey,
  dateHeading,
  captureTime,
  durationLabel,
} from "@/lib/media-format";

function mediaAlt(item: ProjectMediaItem): string {
  const capturedAt = item.capturedAt ?? item.createdAt;
  const creator = item.creatorName ? ` by ${item.creatorName}` : "";
  return `Project ${item.mediaType} captured ${dateHeading(capturedAt)} at ${captureTime(capturedAt)}${creator}`;
}

export function ProjectPhotosPanel({
  projectId,
  projectName,
  contact,
  description,
  galleryPage,
  isLead,
  showProfile = true,
}: {
  projectId: string;
  projectName: string;
  contact: ProjectContact;
  description: string | null;
  galleryPage: GalleryPage;
  isLead: boolean;
  showProfile?: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Map<string, ProjectMediaItem>>(
    () => new Map(),
  );
  const [selectionLocked, setSelectionLocked] = useState(false);
  const selectionAnchor = useRef<string | null>(null);
  function toggleSelection(item: ProjectMediaItem, extend = false) {
    if (selectionLocked) return;
    const anchor = selectionAnchor.current;
    setSelected((current) => {
      const ids = toggleMediaSelection(
        new Set(current.keys()),
        visibleMedia.map((media) => media.id),
        item.id,
        anchor,
        extend,
      );
      const available = new Map([
        ...current,
        ...visibleMedia.map((media) => [media.id, media] as const),
      ]);
      return new Map([...ids].map((id) => [id, available.get(id)!]));
    });
    selectionAnchor.current = item.id;
  }
  const [view, setView] = useState<MediaView>({
    type: "all",
    size: "compact",
    oldestFirst: false,
  });
  const [creators, setCreators] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const gallery = useGalleryPages(projectId, galleryPage, {
    type: view.type,
    order: view.oldestFirst ? "oldest" : "newest",
    creators,
    tags,
    from,
    to: to || from,
  });
  const visibleMedia = gallery.page.items;
  const galleryItems = visibleMedia;
  const navigationItems = useRef(galleryItems);
  useEffect(() => {
    navigationItems.current = galleryItems;
  }, [galleryItems]);
  const dirtyDetails = useRef(false);
  const trackDirty = useCallback((dirty: boolean) => {
    dirtyDetails.current = dirty;
  }, []);
  const mayLeave = useCallback(() => {
    if (
      dirtyDetails.current &&
      !window.confirm("Leave this photo without saving your changes?")
    )
      return false;
    return true;
  }, []);
  const linked = useLinkedPhoto(projectId, galleryItems, mayLeave);
  const activeImageId = linked.id;
  const setActiveImageId = linked.select;
  const [activeSnapshot, setActiveSnapshot] = useState<ProjectMediaItem | null>(
    null,
  );
  const activeImageIndex = galleryItems.findIndex(
    (item) => item.id === activeImageId,
  );
  const currentImage = galleryItems[activeImageIndex] ?? linked.item;
  useEffect(() => {
    if (currentImage) setActiveSnapshot(currentImage);
  }, [currentImage]);
  const closeGallery = useCallback(() => {
    if (mayLeave()) setActiveImageId(null);
  }, [mayLeave, setActiveImageId]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const activeImage =
    currentImage ??
    (activeSnapshot?.id === activeImageId ? activeSnapshot : null);
  const galleryOpen = !!activeImage;

  function showPrevious() {
    const previous = galleryItems[activeImageIndex - 1];
    if (previous && mayLeave()) setActiveImageId(previous.id);
  }

  function showNext() {
    const next = galleryItems[activeImageIndex + 1];
    if (next && mayLeave()) setActiveImageId(next.id);
  }

  useEffect(() => {
    if (!galleryOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if ((event.target as Element)?.closest?.("[data-photo-editor]")) return;
      if (
        event.key !== "Tab" &&
        (event.target as Element)?.closest?.("[data-photo-tag-picker]")
      )
        return;
      const images = navigationItems.current;
      if (event.key === "Escape") {
        if (document.fullscreenElement) return;
        closeGallery();
        return;
      }
      if (
        event.key !== "Tab" &&
        (event.target as HTMLElement).closest(
          "input, textarea, video, [contenteditable=true]",
        )
      )
        return;
      if (event.key === "ArrowLeft" && images.length > 1) {
        event.preventDefault();
        if (mayLeave())
          setActiveImageId((current) => {
            const index = images.findIndex((item) => item.id === current);
            return images[index - 1]?.id ?? current;
          });
        return;
      }
      if (event.key === "ArrowRight" && images.length > 1) {
        event.preventDefault();
        if (mayLeave())
          setActiveImageId(
            (current) =>
              images[images.findIndex((item) => item.id === current) + 1]?.id ??
              current,
          );
        return;
      }
      if (event.key !== "Tab") return;

      const candidates = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), video[controls], [href], [tabindex]:not([tabindex="-1"])',
      );
      const focusable = candidates
        ? [...candidates].filter(
            (element) =>
              !document.fullscreenElement ||
              document.fullscreenElement.contains(element),
          )
        : [];
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [galleryOpen, closeGallery, mayLeave, setActiveImageId]);

  const groups = new Map<string, ProjectMediaItem[]>();
  for (const item of visibleMedia) {
    const capturedAt = item.capturedAt ?? item.createdAt;
    const key = localDateKey(capturedAt);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  return (
    <div
      className={
        showProfile
          ? "grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]"
          : "min-w-0"
      }
    >
      <section aria-label="Project photos" className="min-w-0">
        <h2 className="sr-only">Photos ({gallery.page.total})</h2>
        <fieldset disabled={selectionLocked} className="mb-7">
          <PhotoToolbar
            users={(gallery.page.options?.creators ?? []).map((name) => [
              name,
              name,
            ])}
            selectedUsers={creators}
            onUsers={setCreators}
            tags={{
              options: gallery.page.options?.tags ?? [],
              selected: tags,
              onChange: setTags,
            }}
            from={from}
            to={to}
            onDates={(start, end) => {
              setFrom(start);
              setTo(end);
            }}
            view={view}
            onView={setView}
            trailing={
              <ProjectMediaUpload
                key={projectId}
                projectId={projectId}
                isLead={isLead}
                label={projectName}
              />
            }
          />
        </fieldset>
        {linked.loading ? (
          <p role="status" className="mb-3 text-sm text-slate-500">
            Opening photo…
          </p>
        ) : null}
        {linked.error ? (
          <p role="alert" className="mb-3 text-sm text-red-700">
            {linked.error}{" "}
            <button onClick={linked.retry} className="underline">
              Retry
            </button>{" "}
            <button
              onClick={() => setActiveImageId(null)}
              className="underline"
            >
              Dismiss
            </button>
          </p>
        ) : null}
        {gallery.loading ? (
          <p role="status" className="mb-3 text-sm text-slate-500">
            Loading photos…
          </p>
        ) : null}
        {gallery.error ? (
          <p role="alert" className="mb-3 text-sm text-red-700">
            {gallery.error}{" "}
            <button onClick={gallery.reload} className="underline">
              Retry
            </button>
          </p>
        ) : null}
        {galleryPage.total === 0 ? (
          <Card className="flex min-h-72 items-center justify-center p-8 text-center">
            <div>
              <div className="font-display text-lg font-semibold text-[var(--color-heading)]">
                No photos yet
              </div>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Upload from this page or take photos in the mobile app. They
                will appear here by date.
              </p>
            </div>
          </Card>
        ) : visibleMedia.length === 0 ? (
          <Card className="p-12 text-center text-[var(--color-muted)]">
            No photos or videos match these filters.
          </Card>
        ) : (
          <div className="space-y-7">
            {[...groups.values()].map((items) => {
              const firstCapturedAt = items[0].capturedAt ?? items[0].createdAt;
              return (
                <section
                  key={localDateKey(firstCapturedAt)}
                  className="[content-visibility:auto] [contain-intrinsic-size:500px]"
                >
                  <h2 className="mb-3 flex items-center gap-3 text-[17px] font-semibold text-[var(--color-heading)]">
                    <input
                      type="checkbox"
                      aria-label={`Select photos from ${dateHeading(firstCapturedAt)}`}
                      disabled={selectionLocked}
                      checked={items.every((item) => selected.has(item.id))}
                      ref={(input) => {
                        if (input)
                          input.indeterminate =
                            items.some((item) => selected.has(item.id)) &&
                            !items.every((item) => selected.has(item.id));
                      }}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelected((current) => {
                          const next = new Map(current);
                          for (const item of items) {
                            if (checked) {
                              if (next.size < 500) next.set(item.id, item);
                            } else next.delete(item.id);
                          }
                          return next;
                        });
                      }}
                      className="h-5 w-5 accent-blue-600"
                    />
                    {dateHeading(firstCapturedAt)}
                  </h2>
                  <div
                    className="grid gap-x-2 gap-y-5"
                    style={{
                      gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${view.size === "compact" ? 140 : view.size === "comfortable" ? 280 : 200}px), ${view.size === "compact" ? 140 : view.size === "comfortable" ? 280 : 200}px))`,
                    }}
                  >
                    {items.map((item) => {
                      const capturedAt = item.capturedAt ?? item.createdAt;
                      const mediaUrl = `/api/jobs/${encodeURIComponent(projectId)}/media/${encodeURIComponent(item.id)}`;
                      const duration = durationLabel(item.durationMs);
                      return (
                        <figure key={item.id} className="min-w-0">
                          <div className="group relative aspect-square overflow-hidden rounded-lg bg-[var(--color-surface-2)]">
                            <label
                              className={`absolute left-2 top-2 z-10 flex rounded bg-white/95 p-1 transition-opacity ${selected.size ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"}`}
                            >
                              <input
                                type="checkbox"
                                aria-label={`Select ${item.originalFilename ?? mediaAlt(item)}`}
                                checked={selected.has(item.id)}
                                disabled={selectionLocked}
                                onChange={(event) =>
                                  toggleSelection(
                                    item,
                                    Boolean(
                                      (event.nativeEvent as MouseEvent)
                                        .shiftKey,
                                    ),
                                  )
                                }
                                className="h-4 w-4 accent-blue-600"
                              />
                            </label>
                            <button
                              type="button"
                              onClick={(event) =>
                                selected.size
                                  ? toggleSelection(item, event.shiftKey)
                                  : setActiveImageId(item.id)
                              }
                              aria-label={`View ${mediaAlt(item).toLocaleLowerCase("en-CA")} in gallery`}
                              className="block h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)]"
                            >
                              <ProjectMediaPreview
                                src={mediaUrl}
                                alt={mediaAlt(item)}
                                video={item.mediaType === "video"}
                              />
                              <span
                                aria-hidden="true"
                                className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent px-2 pb-2 pt-7 text-left"
                              >
                                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] text-slate-600">
                                  {(item.creatorName ?? SITE_NAME)
                                    .split(" ")
                                    .map((part) => part[0])
                                    .slice(0, 2)
                                    .join("")}
                                </span>
                              </span>
                            </button>
                            {item.mediaType === "video" ? (
                              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-3xl text-white drop-shadow">
                                ▶
                              </span>
                            ) : null}
                            {selected.has(item.id) ? (
                              <span className="pointer-events-none absolute inset-0 bg-black/30 ring-2 ring-inset ring-blue-500" />
                            ) : null}
                            <MediaItemMenu
                              mediaId={item.id}
                              mediaType={item.mediaType}
                              projectId={projectId}
                              label={`Actions for ${item.originalFilename ?? "photo"}`}
                              disabled={selectionLocked}
                              onBusy={setSelectionLocked}
                              onSaved={() => {
                                gallery.reload();
                                router.refresh();
                              }}
                            />
                            {duration ? (
                              <span className="pointer-events-none absolute top-2 right-2 rounded-md group-hover:hidden group-focus-within:hidden [@media(hover:none)]:top-auto [@media(hover:none)]:bottom-2 bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                                {duration}
                              </span>
                            ) : null}
                          </div>
                          <figcaption className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-muted)]">
                            <time dateTime={capturedAt} className="shrink-0 whitespace-nowrap">
                              {captureTime(capturedAt)}
                            </time>
                            <span aria-hidden="true">•</span>
                            <span className="truncate">
                              {item.creatorName ?? SITE_NAME}
                            </span>
                          </figcaption>
                        </figure>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
        {gallery.page.hasMore ? (
          <div className="mt-8 text-center">
            <button
              type="button"
              disabled={gallery.loading}
              onClick={() => void gallery.more()}
              className="rounded-lg border border-[var(--color-border)] px-5 py-2 text-sm disabled:opacity-50"
            >
              {gallery.loading
                ? "Loading…"
                : `Load more · ${visibleMedia.length} of ${gallery.page.total}`}
            </button>
          </div>
        ) : null}
        <ProjectPhotoBatch
          floating
          availableTags={gallery.page.options?.tags ?? []}
          projectId={projectId}
          selected={[...selected.values()]}
          onClear={() => setSelected(new Map())}
          onBusy={setSelectionLocked}
          onSaved={() => {
            gallery.reload();
            router.refresh();
          }}
        />
      </section>

      {showProfile ? (
        <ProjectProfilePanel
          projectId={projectId}
          contact={contact}
          description={description}
        />
      ) : null}

      {activeImage ? (
        <div
          className="fixed inset-0 z-[70] bg-slate-900/70 p-0 text-white sm:p-4"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeGallery();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={
              activeImageIndex >= 0
                ? `Photo gallery, ${activeImage.mediaType === "video" ? "video" : "photo"} ${activeImageIndex + 1} of ${galleryItems.length}`
                : `Photo gallery, linked ${activeImage.mediaType === "video" ? "video" : "photo"}`
            }
            className="flex h-full min-h-0 flex-col overflow-hidden bg-black sm:rounded-lg"
          >
            <MediaViewerContent
              projectId={projectId}
              projectName={projectName}
              address={contact.address}
              mediaId={activeImage.id}
              mediaType={activeImage.mediaType}
              alt={mediaAlt(activeImage)}
              downloadName={activeImage.originalFilename ?? activeImage.id}
              creatorName={activeImage.creatorName ?? "Unknown uploader"}
              capturedAt={activeImage.capturedAt ?? activeImage.createdAt}
              closeButtonRef={closeButtonRef}
              onClose={closeGallery}
              beforeNavigate={mayLeave}
              onPrevious={activeImageIndex > 0 ? showPrevious : undefined}
              onNext={
                activeImageIndex < galleryItems.length - 1
                  ? showNext
                  : undefined
              }
              actions={
                <PhotoTrashAction
                  compact
                  key={activeImage.id}
                  projectId={projectId}
                  item={activeImage}
                  beforeAction={mayLeave}
                  onSuccess={() => {
                    setActiveImageId(null);
                    gallery.reload();
                    router.refresh();
                  }}
                />
              }
            >
              <PhotoDetailsEditor
                key={activeImage.id}
                projectId={projectId}
                mediaId={activeImage.id}
                description={activeImage.description}
                availableTags={gallery.page.options?.tags ?? []}
                tags={activeImage.tags}
                revision={activeImage.revision}
                onDirtyChange={trackDirty}
              />
            </MediaViewerContent>
          </div>
        </div>
      ) : null}
    </div>
  );
}
