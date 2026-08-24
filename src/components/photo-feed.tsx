"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/components/ui";
import type { PhotoFeedItem } from "@/lib/photo-feed";

const OTTAWA_TIME_ZONE = "America/Toronto";
const DAY = 24 * 60 * 60 * 1000;

type DateRange = "all" | "7" | "30" | "90";
type MediaFilter = "all" | "image" | "video";
type ViewDensity = "comfortable" | "compact";

function localDateKey(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OTTAWA_TIME_ZONE,
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
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OTTAWA_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).formatToParts(new Date(iso));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.weekday}, ${value.month} ${ordinal(Number(value.day))}, ${value.year}`;
}

function captureTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: OTTAWA_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function durationLabel(durationMs: number | null): string | null {
  if (!durationMs || durationMs < 1) return null;
  const totalSeconds = Math.round(durationMs / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return letters || "OP";
}

function mediaUrl(photo: PhotoFeedItem): string {
  return `/api/jobs/${encodeURIComponent(photo.ownerProjectId)}/media/${encodeURIComponent(photo.id)}`;
}

function photoAlt(photo: PhotoFeedItem): string {
  return `${photo.projectName} ${photo.mediaType} captured ${dateHeading(photo.capturedAt)} at ${captureTime(photo.capturedAt)} by ${photo.creatorName}`;
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("relative inline-flex shrink-0", className)}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full cursor-pointer appearance-none truncate rounded-lg border border-[#d8dde5] bg-white pl-4 pr-9 text-[13px] font-semibold text-[#4a5568] outline-none transition-colors hover:border-[#b8c2d0] focus:border-[#5794ea] focus:ring-2 focus:ring-[#5794ea]/20"
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#647184]"
      >
        <path d="m6.5 8 3.5 3.5L13.5 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}

export function PhotoFeed({ photos }: { photos: PhotoFeedItem[] }) {
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [projectId, setProjectId] = useState("all");
  const [creatorName, setCreatorName] = useState("all");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [viewDensity, setViewDensity] = useState<ViewDensity>("compact");
  const [visibleLimit, setVisibleLimit] = useState(120);
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const projectOptions = useMemo(() => {
    const projects = new Map<string, string>();
    photos.forEach((photo) => projects.set(photo.ownerProjectId, photo.projectName));
    return [...projects].sort((left, right) => left[1].localeCompare(right[1], "en-CA"));
  }, [photos]);

  const creatorOptions = useMemo(() => {
    const counts = new Map<string, number>();
    photos.forEach((photo) => counts.set(photo.creatorName, (counts.get(photo.creatorName) ?? 0) + 1));
    return [...counts].sort((left, right) => left[0].localeCompare(right[0], "en-CA"));
  }, [photos]);

  const filteredPhotos = useMemo(() => {
    const cutoff = dateRange === "all" ? null : Date.now() - Number(dateRange) * DAY;
    return photos.filter((photo) => {
      if (cutoff !== null && new Date(photo.capturedAt).getTime() < cutoff) return false;
      if (projectId !== "all" && photo.ownerProjectId !== projectId) return false;
      if (creatorName !== "all" && photo.creatorName !== creatorName) return false;
      if (mediaFilter !== "all" && photo.mediaType !== mediaFilter) return false;
      return true;
    });
  }, [creatorName, dateRange, mediaFilter, photos, projectId]);

  useEffect(() => {
    setVisibleLimit(120);
  }, [creatorName, dateRange, mediaFilter, projectId]);

  const visiblePhotos = useMemo(
    () => filteredPhotos.slice(0, visibleLimit),
    [filteredPhotos, visibleLimit],
  );

  const groups = useMemo(() => {
    const byDate = new Map<string, PhotoFeedItem[]>();
    visiblePhotos.forEach((photo) => {
      const key = localDateKey(photo.capturedAt);
      const group = byDate.get(key);
      if (group) group.push(photo);
      else byDate.set(key, [photo]);
    });
    return [...byDate.values()];
  }, [visiblePhotos]);

  const galleryPhotos = filteredPhotos.filter((photo) => photo.mediaType === "image");
  const priorityPhotoId = visiblePhotos.find((photo) => photo.mediaType === "image")?.id;
  const activeIndex = activePhotoId
    ? galleryPhotos.findIndex((photo) => photo.id === activePhotoId)
    : -1;
  const activePhoto = activeIndex >= 0 ? galleryPhotos[activeIndex] : null;

  function showPrevious() {
    if (activeIndex < 0 || galleryPhotos.length < 2) return;
    setActivePhotoId(galleryPhotos[(activeIndex - 1 + galleryPhotos.length) % galleryPhotos.length].id);
  }

  function showNext() {
    if (activeIndex < 0 || galleryPhotos.length < 2) return;
    setActivePhotoId(galleryPhotos[(activeIndex + 1) % galleryPhotos.length].id);
  }

  useEffect(() => {
    if (!activePhoto) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setActivePhotoId(null);
      if (event.key === "ArrowLeft") showPrevious();
      if (event.key === "ArrowRight") showNext();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [activeIndex, activePhoto, galleryPhotos.length]);

  const hasFilters = dateRange !== "all" || projectId !== "all" || creatorName !== "all" || mediaFilter !== "all";

  return (
    <div data-app-content="full-bleed" className="min-h-full bg-white text-[#263143]">
      <div className="mx-auto w-full max-w-[1720px] px-4 pb-14 pt-7 sm:px-7 lg:px-10 lg:pt-9">
        <div>
          <div>
            <h1 className="font-display text-[30px] font-bold leading-none tracking-[-0.035em] text-[#172235]">
              Photos
            </h1>
            <p className="mt-2 text-sm text-[#7b8798]">
              {filteredPhotos.length.toLocaleString("en-CA")} {filteredPhotos.length === 1 ? "photo or video" : "photos and videos"}
            </p>
          </div>
        </div>

        <div className="mt-7 flex items-center gap-2 overflow-x-auto pb-2">
          <FilterSelect
            label="Date range"
            value={dateRange}
            onChange={(value) => setDateRange(value as DateRange)}
            className="w-[134px]"
          >
            <option value="all">Date Range</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </FilterSelect>
          <FilterSelect label="Project" value={projectId} onChange={setProjectId} className="w-[140px]">
            <option value="all">Projects</option>
            {projectOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </FilterSelect>
          <FilterSelect label="Posted by" value={creatorName} onChange={setCreatorName} className="w-[160px]">
            <option value="all">Posted by</option>
            {creatorOptions.map(([name, count]) => (
              <option key={name} value={name}>{name} ({count})</option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Media type"
            value={mediaFilter}
            onChange={(value) => setMediaFilter(value as MediaFilter)}
            className="w-[120px]"
          >
            <option value="all">Media</option>
            <option value="image">Photos only</option>
            <option value="video">Videos only</option>
          </FilterSelect>
          {hasFilters ? (
            <button
              type="button"
              onClick={() => {
                setDateRange("all");
                setProjectId("all");
                setCreatorName("all");
                setMediaFilter("all");
              }}
              className="h-10 shrink-0 rounded-lg px-3 text-[13px] font-semibold text-[#617086] hover:bg-[#f3f5f8] hover:text-[#243147]"
            >
              Clear filters
            </button>
          ) : null}
          <FilterSelect
            label="View density"
            value={viewDensity}
            onChange={(value) => setViewDensity(value as ViewDensity)}
            className="ml-auto w-[112px]"
          >
            <option value="compact">View</option>
            <option value="comfortable">Large tiles</option>
          </FilterSelect>
        </div>

        {groups.length ? (
          <div className="mt-6 space-y-10">
            {groups.map((items) => (
              <section key={localDateKey(items[0].capturedAt)} className="[content-visibility:auto] [contain-intrinsic-size:360px]">
                <div className="mb-4 flex items-center gap-3">
                  <span aria-hidden="true" className="h-5 w-5 rounded-[4px] border-2 border-[#cbd2dc] bg-white" />
                  <h2 className="font-display text-[17px] font-semibold text-[#273244]">
                    {dateHeading(items[0].capturedAt)}
                  </h2>
                </div>

                <div
                  className={cn(
                    "grid gap-x-2.5 gap-y-5 sm:gap-x-3",
                    viewDensity === "compact"
                      ? "grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8"
                      : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6",
                  )}
                >
                  {items.map((photo) => {
                    const url = mediaUrl(photo);
                    const duration = durationLabel(photo.durationMs);
                    return (
                      <figure key={photo.id} className="min-w-0">
                        <div className="group relative aspect-square overflow-hidden rounded-[8px] bg-[#edf0f4]">
                          {photo.mediaType === "video" ? (
                            <video
                              controls
                              playsInline
                              preload="metadata"
                              aria-label={photoAlt(photo)}
                              className="h-full w-full object-cover"
                            >
                              <source src={url} type={photo.mimeType} />
                            </video>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setActivePhotoId(photo.id)}
                              aria-label={`View ${photoAlt(photo).toLocaleLowerCase("en-CA")}`}
                              className="relative block h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4f91ed]"
                            >
                              <Image
                                src={url}
                                alt={photoAlt(photo)}
                                fill
                                unoptimized
                                priority={photo.id === priorityPhotoId}
                                sizes={viewDensity === "compact" ? "(max-width: 640px) 33vw, 14vw" : "(max-width: 640px) 50vw, 18vw"}
                                className="object-cover transition-transform duration-200 group-hover:scale-[1.025]"
                              />
                            </button>
                          )}

                          <span className="pointer-events-none absolute bottom-2 left-2 inline-flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-white bg-[#f7f8fa] px-1 text-[10px] font-bold text-[#536073] shadow-sm">
                            {initials(photo.creatorName)}
                          </span>
                          {duration ? (
                            <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {duration}
                            </span>
                          ) : null}
                        </div>

                        <figcaption className="mt-2 min-w-0 leading-tight">
                          <Link
                            href={`/jobs/${encodeURIComponent(photo.ownerProjectId)}`}
                            className="block truncate text-[12px] font-semibold text-[#344056] hover:text-[#246fcb] hover:underline"
                            title={photo.address ? `${photo.projectName} · ${photo.address}` : photo.projectName}
                          >
                            {photo.projectName}
                          </Link>
                          <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-[#8a95a5]">
                            <time dateTime={photo.capturedAt} className="shrink-0 whitespace-nowrap">{captureTime(photo.capturedAt)}</time>
                            <span aria-hidden="true">•</span>
                            <span className="truncate">{photo.creatorName}</span>
                          </div>
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              </section>
            ))}
            {visiblePhotos.length < filteredPhotos.length ? (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => setVisibleLimit((current) => current + 120)}
                  className="h-10 rounded-lg border border-[#d8dde5] bg-white px-5 text-[13px] font-semibold text-[#4a5568] shadow-sm hover:border-[#b8c2d0] hover:bg-[#f8f9fb] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5794ea]/30"
                >
                  Load more photos
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-16 flex min-h-72 items-center justify-center rounded-xl border border-dashed border-[#d6dce5] bg-[#fafbfc] p-8 text-center">
            <div>
              <div className="font-display text-lg font-semibold text-[#283448]">
                {photos.length ? "No photos match these filters" : "No photos yet"}
              </div>
              <p className="mt-1 text-sm text-[#7d8899]">
                {photos.length
                  ? "Clear one or more filters to see the full company feed."
                  : "Photos uploaded to a lead or job will appear here automatically."}
              </p>
            </div>
          </div>
        )}
      </div>

      {activePhoto ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Photo ${activeIndex + 1} of ${galleryPhotos.length}`}
          className="fixed inset-0 z-[80] flex flex-col bg-black/95 text-white"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setActivePhotoId(null);
          }}
        >
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-white/15 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{activePhoto.projectName}</div>
              <div className="mt-0.5 truncate text-xs text-white/60">
                {dateHeading(activePhoto.capturedAt)} · {captureTime(activePhoto.capturedAt)} · {activePhoto.creatorName}
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => setActivePhotoId(null)}
              aria-label="Close gallery"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-2xl hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              ×
            </button>
          </header>

          <div className="relative min-h-0 flex-1">
            <Image
              key={activePhoto.id}
              src={mediaUrl(activePhoto)}
              alt={photoAlt(activePhoto)}
              fill
              unoptimized
              sizes="100vw"
              className="object-contain px-2 py-3 sm:px-20 sm:py-6"
            />

            {galleryPhotos.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={showPrevious}
                  aria-label="Previous photo"
                  className="absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-3xl hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={showNext}
                  aria-label="Next photo"
                  className="absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-3xl hover:bg-black/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  ›
                </button>
              </>
            ) : null}
          </div>

          {activePhoto.description ? (
            <p className="shrink-0 border-t border-white/10 px-4 py-2 text-center text-sm text-white/80">
              {activePhoto.description}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
