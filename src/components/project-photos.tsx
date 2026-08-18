"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ProjectMediaUpload } from "@/components/project-media-upload";
import { ProjectProfilePanel } from "@/components/project-profile-panel";
import { Card } from "@/components/ui";
import type { ProjectContact, ProjectMediaItem } from "@/lib/project-data";

const PROJECT_TIME_ZONE = "America/Toronto";

function localDateKey(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PROJECT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function ordinal(day: number): string {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) return `${day}th`;
  if (day % 10 === 1) return `${day}st`;
  if (day % 10 === 2) return `${day}nd`;
  if (day % 10 === 3) return `${day}rd`;
  return `${day}th`;
}

function dateHeading(iso: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PROJECT_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.weekday}, ${value.month} ${ordinal(Number(value.day))}, ${value.year}`;
}

function captureTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PROJECT_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function durationLabel(durationMs: number | null): string | null {
  if (!durationMs || durationMs < 1) return null;
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function mediaAlt(item: ProjectMediaItem): string {
  const capturedAt = item.capturedAt ?? item.createdAt;
  const creator = item.creatorName ? ` by ${item.creatorName}` : "";
  return `Project ${item.mediaType} captured ${dateHeading(capturedAt)} at ${captureTime(capturedAt)}${creator}`;
}

export function ProjectPhotosPanel({
  projectId,
  contact,
  description,
  notes,
  media,
  isLead,
}: {
  projectId: string;
  contact: ProjectContact;
  description: string | null;
  notes: string | null;
  media: ProjectMediaItem[];
  isLead: boolean;
}) {
  const imageItems = media.filter((item) => item.mediaType === "image");
  const imageIndexById = new Map(imageItems.map((item, index) => [item.id, index]));
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);
  const galleryOpen = activeImageIndex !== null;
  const activeImage = activeImageIndex === null ? null : imageItems[activeImageIndex];

  function showPrevious() {
    setActiveImageIndex((current) =>
      current === null ? null : (current - 1 + imageItems.length) % imageItems.length,
    );
  }

  function showNext() {
    setActiveImageIndex((current) =>
      current === null ? null : (current + 1) % imageItems.length,
    );
  }

  useEffect(() => {
    if (!galleryOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveImageIndex(null);
        return;
      }
      if (event.key === "ArrowLeft" && imageItems.length > 1) {
        event.preventDefault();
        setActiveImageIndex((current) =>
          current === null ? null : (current - 1 + imageItems.length) % imageItems.length,
        );
        return;
      }
      if (event.key === "ArrowRight" && imageItems.length > 1) {
        event.preventDefault();
        setActiveImageIndex((current) =>
          current === null ? null : (current + 1) % imageItems.length,
        );
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
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
  }, [galleryOpen, imageItems.length]);

  const groups = new Map<string, ProjectMediaItem[]>();
  for (const item of media) {
    const capturedAt = item.capturedAt ?? item.createdAt;
    const key = localDateKey(capturedAt);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }

  return (
    <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section aria-label="Project photos" className="min-w-0">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-[var(--color-heading)]">
              Photos <span className="text-[var(--color-muted)]">({media.length})</span>
            </h2>
            <p className="mt-0.5 text-sm text-[var(--color-muted)]">
              Site photos and videos, grouped by the day they were captured.
            </p>
          </div>
          <ProjectMediaUpload projectId={projectId} isLead={isLead} />
        </div>
        {media.length === 0 ? (
          <Card className="flex min-h-72 items-center justify-center p-8 text-center">
            <div>
              <div className="font-display text-lg font-semibold text-[var(--color-heading)]">
                No photos yet
              </div>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Upload from this page or take photos in the mobile app. They will appear here by date.
              </p>
            </div>
          </Card>
        ) : (
          <div className="space-y-9">
            {[...groups.values()].map((items) => {
              const firstCapturedAt = items[0].capturedAt ?? items[0].createdAt;
              return (
                <section
                  key={localDateKey(firstCapturedAt)}
                  className="[content-visibility:auto] [contain-intrinsic-size:500px]"
                >
                  <h2 className="mb-4 font-display text-base font-semibold text-[var(--color-heading)]">
                    {dateHeading(firstCapturedAt)}
                  </h2>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-6 lg:grid-cols-3 2xl:grid-cols-4">
                    {items.map((item) => {
                      const capturedAt = item.capturedAt ?? item.createdAt;
                      const mediaUrl = `/api/jobs/${encodeURIComponent(projectId)}/media/${encodeURIComponent(item.id)}`;
                      const duration = durationLabel(item.durationMs);
                      return (
                        <figure key={item.id} className="min-w-0">
                          <div className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] shadow-sm">
                            {item.mediaType === "video" ? (
                              <video
                                controls
                                playsInline
                                preload="metadata"
                                aria-label={mediaAlt(item)}
                                className="h-full w-full object-cover"
                              >
                                <source src={mediaUrl} type={item.mimeType} />
                              </video>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setActiveImageIndex(imageIndexById.get(item.id) ?? 0)}
                                aria-label={`View ${mediaAlt(item).toLocaleLowerCase("en-CA")} in gallery`}
                                className="block h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)]"
                              >
                                <Image
                                  src={mediaUrl}
                                  alt={mediaAlt(item)}
                                  fill
                                  unoptimized
                                  sizes="(max-width: 640px) 50vw, (max-width: 1279px) 33vw, 22vw"
                                  className="object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                                />
                                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-3 pb-2.5 pt-8 text-left text-xs font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                                  View gallery
                                </span>
                              </button>
                            )}
                            {duration ? (
                              <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                                {duration}
                              </span>
                            ) : null}
                          </div>
                          <figcaption className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-muted)]">
                            <time dateTime={capturedAt}>{captureTime(capturedAt)}</time>
                            <span aria-hidden="true">•</span>
                            <span className="truncate">{item.creatorName ?? "Ottawa Painters"}</span>
                            {item.mediaType === "video" ? (
                              <span className="ml-auto font-medium text-[var(--color-heading)]">Video</span>
                            ) : null}
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
      </section>

      <ProjectProfilePanel
        projectId={projectId}
        contact={contact}
        description={description}
        notes={notes}
      />

      {activeImage && activeImageIndex !== null ? (
        <div
          className="fixed inset-0 z-[70] bg-black/95 text-white"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setActiveImageIndex(null);
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Photo gallery, image ${activeImageIndex + 1} of ${imageItems.length}`}
            className="flex h-full min-h-0 flex-col"
          >
            <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/15 px-4 py-3 sm:px-6">
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  Photo {activeImageIndex + 1} of {imageItems.length}
                </div>
                <div className="mt-0.5 truncate text-xs text-white/60">
                  {dateHeading(activeImage.capturedAt ?? activeImage.createdAt)} · {captureTime(activeImage.capturedAt ?? activeImage.createdAt)}
                  {activeImage.creatorName ? ` · ${activeImage.creatorName}` : ""}
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setActiveImageIndex(null)}
                aria-label="Close gallery"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-2xl leading-none transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                ×
              </button>
            </header>

            <div
              className="relative min-h-0 flex-1 touch-pan-y select-none"
              onTouchStart={(event) => {
                touchStartX.current = event.changedTouches[0]?.clientX ?? null;
              }}
              onTouchEnd={(event) => {
                if (touchStartX.current === null || imageItems.length < 2) return;
                const distance = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
                touchStartX.current = null;
                if (Math.abs(distance) < 50) return;
                if (distance > 0) showPrevious();
                else showNext();
              }}
            >
              <Image
                key={activeImage.id}
                src={`/api/jobs/${encodeURIComponent(projectId)}/media/${encodeURIComponent(activeImage.id)}`}
                alt={mediaAlt(activeImage)}
                fill
                unoptimized
                sizes="100vw"
                className="object-contain px-2 py-3 sm:px-20 sm:py-6"
              />

              {imageItems.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={showPrevious}
                    aria-label="Previous photo"
                    className="absolute left-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-3xl shadow-lg transition-colors hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:flex"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={showNext}
                    aria-label="Next photo"
                    className="absolute right-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-3xl shadow-lg transition-colors hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:flex"
                  >
                    ›
                  </button>
                </>
              ) : null}
            </div>

            {activeImage.description ? (
              <p className="shrink-0 border-t border-white/10 px-4 py-2 text-center text-sm text-white/80 sm:px-6">
                {activeImage.description}
              </p>
            ) : null}

            {imageItems.length > 1 ? (
              <div className="shrink-0 border-t border-white/15 bg-black/60 px-3 py-3 sm:px-6">
                <div className="mx-auto flex max-w-5xl gap-2 overflow-x-auto pb-1" aria-label="Gallery thumbnails">
                  {imageItems.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveImageIndex(index)}
                      aria-label={`View photo ${index + 1}`}
                      aria-current={index === activeImageIndex ? "true" : undefined}
                      className={`relative h-14 w-[72px] shrink-0 overflow-hidden rounded-md border-2 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:h-16 sm:w-20 ${
                        index === activeImageIndex
                          ? "border-white opacity-100"
                          : "border-transparent opacity-55 hover:opacity-100"
                      }`}
                    >
                      <Image
                        src={`/api/jobs/${encodeURIComponent(projectId)}/media/${encodeURIComponent(item.id)}`}
                        alt=""
                        fill
                        unoptimized
                        sizes="80px"
                        className="object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
