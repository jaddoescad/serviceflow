"use client";

import { toggleMediaSelection } from "@/lib/media-selection";
import { MediaItemMenu } from "./media-item-menu";

import { FeedPhotoActions } from "./feed-photo-actions";
import { PhotoToolbar, type MediaView } from "./photo-toolbar";
import { SITE_INITIALS } from "@/lib/site-brand";

import { ProjectMediaPreview } from "./project-media-preview";
import dynamic from "next/dynamic";
const FeedMediaViewer = dynamic(
  () => import("./feed-media-viewer").then((module) => module.FeedMediaViewer),
  { ssr: false },
);
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui";
import type { PhotoFeedItem, PhotoBatch, PhotoSummary } from "@/lib/photo-feed";

import {
  localDateKey,
  dateHeading,
  captureTime,
  durationLabel,
} from "@/lib/media-format";
function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  return letters || SITE_INITIALS;
}

function mediaUrl(photo: PhotoFeedItem): string {
  return `/api/jobs/${encodeURIComponent(photo.ownerProjectId)}/media/${encodeURIComponent(photo.id)}`;
}

function photoAlt(photo: PhotoFeedItem): string {
  return `${photo.projectName} ${photo.mediaType} captured ${dateHeading(photo.capturedAt)} at ${captureTime(photo.capturedAt)} by ${photo.creatorName}`;
}

export function PhotoFeed({
  initialBatch,
  summary,
  uploaderId,
  header,
}: {
  initialBatch: PhotoBatch;
  summary: PhotoSummary;
  uploaderId?: string;
  header?: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectionLocked, setSelectionLocked] = useState(false);
  const selectionAnchor = useRef<string | null>(null);
  function toggleSelection(id: string, extend = false) {
    if (selectionLocked) return;
    const anchor = selectionAnchor.current;
    setSelected((current) =>
      toggleMediaSelection(
        current,
        photos.map((photo) => photo.id),
        id,
        anchor,
        extend,
      ),
    );
    selectionAnchor.current = id;
  }
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [creators, setCreators] = useState<string[]>([]);
  const [view, setView] = useState<MediaView>({
    type: "all",
    size: "compact",
    oldestFirst: false,
  });
  const [batch, setBatch] = useState(initialBatch);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const photos = batch.items;
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);

  const [filterOptions, setFilterOptions] = useState(summary);
  const projectOptions = filterOptions.projects;
  const creatorOptions = filterOptions.creators;
  const filterParams = useMemo(() => {
    const params = new URLSearchParams();
    if (uploaderId) params.set("uploader", uploaderId);
    projectIds.forEach((id) => params.append("project", id));
    creators.forEach((name) => params.append("creator", name));
    tags.forEach((tag) => params.append("tag", tag));
    if (view.type !== "all") params.set("media", view.type);
    if (view.oldestFirst) params.set("order", "oldest");
    if (from) params.set("since", from);
    if (from) params.set("until", to || from);
    return params.toString();
  }, [
    projectIds,
    creators,
    tags,
    view.type,
    view.oldestFirst,
    from,
    to,
    uploaderId,
  ]);
  const lastFilters = useRef(filterParams);
  const loadedFilters = useRef(filterParams);
  async function load(append: boolean, refreshOptions = false) {
    append = append && loadedFilters.current === filterParams;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams(filterParams);
    if (refreshOptions) params.set("options", "1");
    if (append && batch.nextCursor)
      params.set("cursor", JSON.stringify(batch.nextCursor));
    try {
      const response = await fetch(`/api/photos?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Photos could not load. Try again.");
      const data = (await response.json()) as {
        batch: PhotoBatch;
        summary?: PhotoSummary;
      };
      if (controller.signal.aborted || requestRef.current !== controller)
        return;
      if (data.summary) setFilterOptions(data.summary);
      loadedFilters.current = filterParams;
      setBatch((previous) =>
        append
          ? {
              ...data.batch,
              items: [
                ...new Map(
                  [...previous.items, ...data.batch.items].map((item) => [
                    item.id,
                    item,
                  ]),
                ).values(),
              ],
            }
          : data.batch,
      );
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "Photos could not load.",
        );
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }
  useEffect(() => {
    if (lastFilters.current === filterParams) return;
    lastFilters.current = filterParams;
    setActivePhotoId(null);
    if (!selectionLocked) setSelected(new Set());
    void load(false);
  }, [filterParams]);
  useEffect(() => () => requestRef.current?.abort(), []);

  const visiblePhotos = photos;
  const hasFilters = Boolean(
    from ||
    to ||
    projectIds.length ||
    creators.length ||
    tags.length ||
    view.type !== "all",
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

  return (
    <div
      data-app-content="full-bleed"
      className="min-h-full bg-white text-[#263143]"
    >
      <div className="mx-auto w-full px-4 pb-14 pt-7 sm:px-7 lg:px-12 lg:pt-12">
        {header ?? (
          <div>
            <div>
              <h1 className="font-display text-[36px] font-extrabold leading-none tracking-[-0.035em] text-[#172235]">
                Photos
              </h1>
            </div>
          </div>
        )}

        <fieldset disabled={selectionLocked} className="mt-7">
          <PhotoToolbar
            projects={projectOptions}
            users={creatorOptions.map(([name]) => [name, name])}
            hideUsers={Boolean(uploaderId)}
            selectedProjects={projectIds}
            selectedUsers={creators}
            tags={{
              options: filterOptions.tags ?? [],
              selected: tags,
              onChange: setTags,
            }}
            onProjects={setProjectIds}
            onUsers={setCreators}
            from={from}
            to={to}
            onDates={(start, end) => {
              setFrom(start);
              setTo(end);
            }}
            view={view}
            onView={setView}
          />
        </fieldset>

        {selected.size ? (
          <FeedPhotoActions
            ids={[...selected]}
            onClear={() => setSelected(new Set())}
            onBusy={setSelectionLocked}
            onSaved={() => void load(false, true)}
          />
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 text-sm text-red-700">
            {error}{" "}
            <button
              type="button"
              onClick={() => void load(false)}
              className="underline"
            >
              Retry
            </button>
          </div>
        ) : null}
        {groups.length ? (
          <div
            className={`mt-8 space-y-7 ${loading ? "pointer-events-none opacity-50" : ""}`}
          >
            {groups.map((items) => (
              <section
                key={localDateKey(items[0].capturedAt)}
                className="[content-visibility:auto] [contain-intrinsic-size:360px]"
              >
                <div className="mb-3 flex items-center gap-3">
                  <input
                    type="checkbox"
                    aria-label={`Select photos from ${dateHeading(items[0].capturedAt)}`}
                    disabled={selectionLocked}
                    checked={items.every((photo) => selected.has(photo.id))}
                    ref={(node) => {
                      if (node)
                        node.indeterminate =
                          items.some((photo) => selected.has(photo.id)) &&
                          !items.every((photo) => selected.has(photo.id));
                    }}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelected((current) => {
                        const next = new Set(current);
                        items.forEach((photo) => {
                          if (checked && next.size < 500) next.add(photo.id);
                          else if (!checked) next.delete(photo.id);
                        });
                        return next;
                      });
                    }}
                    className="h-5 w-5 accent-blue-600"
                  />
                  <h2 className="font-display text-[17px] font-semibold text-[#273244]">
                    {dateHeading(items[0].capturedAt)}
                  </h2>
                </div>

                <div
                  className={cn(
                    "grid gap-x-2 gap-y-6",
                    view.size === "compact"
                      ? "grid-cols-[repeat(auto-fill,minmax(140px,1fr))]"
                      : view.size === "medium"
                        ? "grid-cols-[repeat(auto-fill,minmax(200px,1fr))]"
                        : "grid-cols-[repeat(auto-fill,minmax(280px,1fr))]",
                  )}
                >
                  {items.map((photo) => {
                    const url = mediaUrl(photo);
                    const duration = durationLabel(photo.durationMs);
                    return (
                      <figure key={photo.id} className="min-w-0">
                        <div className="group relative aspect-square overflow-hidden rounded-[8px] bg-[#edf0f4]">
                          <button
                            type="button"
                            onClick={(event) =>
                              selected.size
                                ? toggleSelection(photo.id, event.shiftKey)
                                : setActivePhotoId(photo.id)
                            }
                            aria-label={`View ${photo.mediaType === "video" ? "video" : "photo"} from ${photo.projectName}`}
                            className="relative block h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                          >
                            <ProjectMediaPreview
                              src={url}
                              video={photo.mediaType === "video"}
                              alt={photoAlt(photo)}
                            />
                            {photo.mediaType === "video" ? (
                              <span className="absolute inset-0 flex items-center justify-center text-3xl text-white drop-shadow">
                                ▶
                              </span>
                            ) : null}
                          </button>

                          {selected.has(photo.id) ? (
                            <span className="pointer-events-none absolute inset-0 bg-black/30 ring-2 ring-inset ring-blue-500" />
                          ) : null}
                          <input
                            type="checkbox"
                            aria-label={`Select ${photo.mediaType} from ${photo.projectName} at ${captureTime(photo.capturedAt)}`}
                            disabled={selectionLocked}
                            checked={selected.has(photo.id)}
                            onChange={(event) =>
                              toggleSelection(
                                photo.id,
                                Boolean(
                                  (event.nativeEvent as MouseEvent).shiftKey,
                                ),
                              )
                            }
                            className={`absolute left-2 top-2 h-5 w-5 cursor-pointer accent-blue-600 focus:opacity-100 ${selected.size ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100"}`}
                          />
                          <MediaItemMenu
                            mediaId={photo.id}
                            mediaType={photo.mediaType}
                            projectId={photo.ownerProjectId}
                            label={`Actions for ${photo.mediaType} from ${photo.projectName}`}
                            disabled={selectionLocked}
                            onBusy={setSelectionLocked}
                            onSaved={() => void load(false, true)}
                          />
                          <span className="pointer-events-none absolute bottom-2 left-2 inline-flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-white bg-[#f7f8fa] px-1 text-[10px] font-bold text-[#536073] shadow-sm">
                            {initials(photo.creatorName)}
                          </span>
                          {duration ? (
                            <span className="pointer-events-none absolute top-2 right-2 rounded group-hover:hidden group-focus-within:hidden [@media(hover:none)]:top-auto [@media(hover:none)]:bottom-2 bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {duration}
                            </span>
                          ) : null}
                        </div>

                        <figcaption className="mt-2 min-w-0 leading-tight">
                          <Link
                            href={`/jobs/${encodeURIComponent(photo.ownerProjectId)}`}
                            className="block truncate text-[12px] font-normal text-[#344056] hover:text-[#246fcb] hover:underline"
                            title={
                              photo.address
                                ? `${photo.projectName} · ${photo.address}`
                                : photo.projectName
                            }
                          >
                            {photo.projectName}
                          </Link>
                          <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-[#8a95a5]">
                            <time
                              dateTime={photo.capturedAt}
                              className="shrink-0 whitespace-nowrap"
                            >
                              {captureTime(photo.capturedAt)}
                            </time>
                            <span aria-hidden="true">•</span>
                            <span className="truncate">
                              {photo.creatorName}
                            </span>
                          </div>
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              </section>
            ))}
            {batch.nextCursor ? (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void load(true)}
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
                {hasFilters
                  ? "No photos or videos match these filters"
                  : "No photos or videos yet"}
              </div>
              <p className="mt-1 text-sm text-[#7d8899]">
                {hasFilters
                  ? "Change your filters to see more media."
                  : "Photos and videos added to projects will appear here."}
              </p>
            </div>
          </div>
        )}
      </div>

      {activePhotoId ? (
        <FeedMediaViewer
          items={photos}
          activeId={activePhotoId}
          onChange={setActivePhotoId}
          onClose={() => setActivePhotoId(null)}
          onRemoved={() => void load(false, true)}
          onUpdated={() => void load(false, true)}
        />
      ) : null}
    </div>
  );
}
