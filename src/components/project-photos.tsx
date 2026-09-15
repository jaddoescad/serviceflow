"use client";

import { SITE_NAME } from "@/lib/site-brand";

import { useLinkedPhoto } from "@/lib/use-linked-photo";
import { ProjectPhotoBatch } from "@/components/project-photo-batch";
import { ProjectPhotoCanvas } from "@/components/project-photo-canvas";
import { useCallback, useEffect, useRef, useState } from "react";
import { PhotoDetailsEditor } from "@/components/photo-details-editor";
import { PhotoTrashAction } from "@/components/project-photo-trash";
import { useRouter } from "next/navigation";
import { useGalleryPages } from "@/lib/use-gallery-pages";
import type { GalleryPage, GalleryFilters } from "@/lib/gallery-page";
import { ProjectMediaPreview } from "@/components/project-media-preview";
import { ProjectMediaUpload } from "@/components/project-upload-provider";
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
  projectName,
  contact,
  description,
  notes,
  galleryPage,
  isLead,
}: {
  projectId: string;
  projectName: string;
  contact: ProjectContact;
  description: string | null;
  notes: string | null;
  galleryPage: GalleryPage;
  isLead: boolean;
}) {
  const router=useRouter();
  const [selected,setSelected]=useState<Map<string,ProjectMediaItem>>(()=>new Map());
  const [selectionLocked,setSelectionLocked]=useState(false);
  function toggleSelection(item:ProjectMediaItem) {
    setSelected(current=>{const next=new Map(current);if(next.has(item.id))next.delete(item.id);else next.set(item.id,item);return next;});
  }
  const [mediaType,setMediaType]=useState<GalleryFilters['type']>('all');
  const [order,setOrder]=useState<GalleryFilters['order']>('newest');
  const [size,setSize]=useState('small');
  const [showTags,setShowTags]=useState(true);
  const [creator,setCreator]=useState('');
  const [tag,setTag]=useState('');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const gallery=useGalleryPages(projectId,galleryPage,{type:mediaType,order,creator,tag,from,to});
  const visibleMedia=gallery.page.items;
  const galleryItems = visibleMedia;
  const navigationItems=useRef(galleryItems);
  useEffect(()=>{navigationItems.current=galleryItems;},[galleryItems]);
  const dirtyDetails = useRef(false);
  const trackDirty = useCallback((dirty: boolean) => { dirtyDetails.current = dirty; }, []);
  const mayLeave = useCallback(() => {
    if (dirtyDetails.current && !window.confirm("Leave this photo without saving your changes?")) return false;
    return true;
  }, []);
  const linked=useLinkedPhoto(projectId,galleryItems,mayLeave);
  const activeImageId=linked.id;
  const setActiveImageId=linked.select;
  const [activeSnapshot,setActiveSnapshot]=useState<ProjectMediaItem|null>(null);
  const activeImageIndex = galleryItems.findIndex((item) => item.id === activeImageId);
  const currentImage=galleryItems[activeImageIndex]??linked.item;
  useEffect(()=>{if(currentImage)setActiveSnapshot(currentImage);},[currentImage]);
  const closeGallery = useCallback(() => { if (mayLeave()) setActiveImageId(null); }, [mayLeave,setActiveImageId]);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const touchStartX = useRef<number | null>(null);
  const activeImage = currentImage??(activeSnapshot?.id===activeImageId?activeSnapshot:null);
  const galleryOpen = !!activeImage;

  function showPrevious() {
    if (mayLeave()) setActiveImageId(galleryItems[activeImageIndex<0?galleryItems.length-1:(activeImageIndex - 1 + galleryItems.length) % galleryItems.length]?.id ?? null);
  }

  function showNext() {
    if (mayLeave()) setActiveImageId(galleryItems[(activeImageIndex + 1) % galleryItems.length]?.id ?? null);
  }

  useEffect(() => {
    if (!galleryOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if ((event.target as Element)?.closest?.("[data-photo-editor]")) return;
      const images=navigationItems.current;
      if (event.key === "Escape") {
        if(document.fullscreenElement)return;
        closeGallery();
        return;
      }
      if (event.key !== "Tab" && (event.target as HTMLElement).closest("input, textarea, video, [contenteditable=true]")) return;
      if (event.key === "ArrowLeft" && images.length > 1) {
        event.preventDefault();
        if (mayLeave()) setActiveImageId((current) => {const index=images.findIndex(item=>item.id===current);return images[index<0?images.length-1:(index-1+images.length)%images.length]?.id??null;});
        return;
      }
      if (event.key === "ArrowRight" && images.length > 1) {
        event.preventDefault();
        if (mayLeave()) setActiveImageId((current) => images[(images.findIndex((item) => item.id === current) + 1) % images.length]?.id ?? null);
        return;
      }
      if (event.key !== "Tab") return;

      const candidates = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), video[controls], [href], [tabindex]:not([tabindex="-1"])',
      );
      const focusable = candidates ? [...candidates].filter(element=>!document.fullscreenElement||document.fullscreenElement.contains(element)) : [];
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
    <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section aria-label="Project photos" className="min-w-0">
        <h2 className="sr-only">Photos ({gallery.page.total})</h2>
        <div className="mb-7 flex flex-wrap items-center gap-2 text-sm">
          <details className="relative">
            <summary className="cursor-pointer rounded-md border border-slate-300 bg-white px-4 py-2 font-medium">{from||to?'Date Range •':'Date Range'}</summary>
            <div className="absolute left-0 top-full z-20 mt-2 space-y-3 rounded-md border border-slate-200 bg-white p-4 shadow-lg">
              <label className="block text-xs">From<input aria-label="From" type="date" value={from} max={to||undefined} onChange={e=>setFrom(e.target.value)} className="mt-1 block rounded border border-slate-300 p-2"/></label>
              <label className="block text-xs">To<input aria-label="To" type="date" value={to} min={from||undefined} onChange={e=>setTo(e.target.value)} className="mt-1 block rounded border border-slate-300 p-2"/></label>
            </div>
          </details>
          <select aria-label="Uploaded by" value={creator} onChange={e=>setCreator(e.target.value)} className="max-w-48 rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">Users</option>{gallery.page.options?.creators.map(name=><option key={name}>{name}</option>)}</select>
          <select aria-label="Filter by tag" value={tag} onChange={e=>setTag(e.target.value)} className="max-w-40 rounded-md border border-slate-300 bg-white px-3 py-2"><option value="">Tags</option>{gallery.page.options?.tags.map(name=><option key={name}>{name}</option>)}</select>
          {creator||tag||from||to||mediaType!=='all'?<button onClick={()=>{setCreator('');setTag('');setFrom('');setTo('');setMediaType('all');}} className="px-2 text-blue-600">Clear filters</button>:null}
          <div className="ml-auto flex items-center gap-2">
          <details className="relative">
            <summary className="cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2">View</summary>
            <div className="absolute left-0 top-full z-20 mt-2 w-60 space-y-4 rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-xl">
              <label className="flex items-center gap-2"><input type="checkbox" checked={showTags} onChange={e=>setShowTags(e.target.checked)}/>Show tags</label>
              <label className="block">Type<select aria-label="Media type" value={mediaType} onChange={e=>setMediaType(e.target.value as GalleryFilters['type'])} className="mt-1 block w-full rounded border p-2"><option value="all">All photos and videos</option><option value="image">Photos only</option><option value="video">Videos only</option></select></label>
              <label className="block">Photo size<select aria-label="Photo size" value={size} onChange={e=>setSize(e.target.value)} className="mt-1 block w-full rounded border p-2"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
              <label className="block">Order<select aria-label="Photo order" value={order} onChange={e=>setOrder(e.target.value as GalleryFilters['order'])} className="mt-1 block w-full rounded border p-2"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
            </div>
          </details>
            <ProjectMediaUpload key={projectId} projectId={projectId} isLead={isLead} label={projectName}/>
          </div>
        </div>
        {linked.loading?<p role="status" className="mb-3 text-sm text-slate-500">Opening photo…</p>:null}
        {linked.error?<p role="alert" className="mb-3 text-sm text-red-700">{linked.error} <button onClick={linked.retry} className="underline">Retry</button> <button onClick={()=>setActiveImageId(null)} className="underline">Dismiss</button></p>:null}
        {gallery.loading?<p role="status" className="mb-3 text-sm text-slate-500">Loading photos…</p>:null}
        {gallery.error?<p role="alert" className="mb-3 text-sm text-red-700">{gallery.error} <button onClick={gallery.reload} className="underline">Retry</button></p>:null}
        {galleryPage.total === 0 ? (
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
        ) : visibleMedia.length===0 ? (
          <Card className="p-12 text-center text-[var(--color-muted)]">No photos or videos match these filters.</Card>
        ) : (
          <div className="space-y-9">
            {[...groups.values()].map((items) => {
              const firstCapturedAt = items[0].capturedAt ?? items[0].createdAt;
              return (
                <section
                  key={localDateKey(firstCapturedAt)}
                  className="[content-visibility:auto] [contain-intrinsic-size:500px]"
                >
                  <h2 className="mb-5 flex items-center gap-2 text-base font-semibold text-[var(--color-heading)]">
                    <input type="checkbox" aria-label={`Select photos from ${dateHeading(firstCapturedAt)}`} disabled={selectionLocked} checked={items.every(item=>selected.has(item.id))} onChange={event=>{const checked=event.target.checked;setSelected(current=>{const next=new Map(current);for(const item of items){if(checked)next.set(item.id,item);else next.delete(item.id);}return next;});}} className="h-5 w-5 accent-blue-600"/>
                    {dateHeading(firstCapturedAt)}
                  </h2>
                  <div className="grid gap-x-2 gap-y-5" style={{gridTemplateColumns:`repeat(auto-fill, minmax(min(100%, ${size==='small'?140:size==='large'?300:220}px), ${size==='small'?140:size==='large'?300:220}px))`}}>
                    {items.map((item) => {
                      const capturedAt = item.capturedAt ?? item.createdAt;
                      const mediaUrl = `/api/jobs/${encodeURIComponent(projectId)}/media/${encodeURIComponent(item.id)}`;
                      const duration = durationLabel(item.durationMs);
                      return (
                        <figure key={item.id} className="min-w-0">
                          <div className="group relative aspect-square overflow-hidden rounded-md bg-[var(--color-surface-2)]">
                              <label className={`absolute left-2 top-2 z-10 flex rounded bg-white/95 p-1 transition-opacity ${selected.has(item.id)?'opacity-100':'opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100'}`}>
                                <input type="checkbox" aria-label={`Select ${item.originalFilename??mediaAlt(item)}`} checked={selected.has(item.id)} disabled={selectionLocked} onChange={()=>toggleSelection(item)} className="h-4 w-4 accent-teal-700"/>
                              </label>
                              <button
                                type="button"
                                onClick={() => setActiveImageId(item.id)}
                                aria-label={`View ${mediaAlt(item).toLocaleLowerCase("en-CA")} in gallery`}
                                className="block h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-brand)]"
                              >
                                <ProjectMediaPreview
                                  src={mediaUrl}
                                  alt={mediaAlt(item)}
                                  video={item.mediaType === "video"}
                                />
                                <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent px-2 pb-2 pt-7 text-left"><span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[10px] text-slate-600">{(item.creatorName??SITE_NAME).split(' ').map(part=>part[0]).slice(0,2).join('')}</span></span>
                              </button>
                            {duration ? (
                              <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                                {duration}
                              </span>
                            ) : null}
                          </div>
                          <figcaption className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-[var(--color-muted)]">
                            <time dateTime={capturedAt}>{captureTime(capturedAt)}</time>
                            <span aria-hidden="true">•</span>
                            <span className="truncate">{item.creatorName ?? SITE_NAME}</span>
                            {item.mediaType === "video" ? (
                              <span className="ml-auto font-medium text-[var(--color-heading)]">Video</span>
                            ) : null}
                          </figcaption>
                          {showTags&&item.tags.length>0?<div className="mt-2 flex flex-wrap gap-1">{item.tags.map(value=><button key={value} onClick={()=>setTag(value)} className="rounded bg-teal-50 px-2 py-0.5 text-xs text-teal-800">{value}</button>)}</div>:null}
                        </figure>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
        {gallery.page.hasMore?<div className="mt-8 text-center"><button type="button" disabled={gallery.loading} onClick={()=>void gallery.more()} className="rounded-lg border border-[var(--color-border)] px-5 py-2 text-sm disabled:opacity-50">{gallery.loading?'Loading…':`Load more · ${visibleMedia.length} of ${gallery.page.total}`}</button></div>:null}
        <ProjectPhotoBatch availableTags={gallery.page.options?.tags??[]} projectId={projectId} selected={[...selected.values()]} onClear={()=>setSelected(new Map())} onBusy={setSelectionLocked} onSaved={()=>{gallery.reload();router.refresh();}}/>
      </section>

      <ProjectProfilePanel
        projectId={projectId}
        contact={contact}
        description={description}
        notes={notes}
      />

      {activeImage ? (
        <div
          className="fixed inset-0 z-[70] bg-slate-900/70 p-0 text-white sm:p-3"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closeGallery();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={activeImageIndex>=0?`Photo gallery, ${activeImage.mediaType==='video'?'video':'photo'} ${activeImageIndex + 1} of ${galleryItems.length}`:`Photo gallery, linked ${activeImage.mediaType==='video'?'video':'photo'}`}
            className="flex h-full min-h-0 flex-col overflow-hidden bg-black sm:rounded-lg"
          >
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(180px,1fr)_minmax(0,45%)] sm:grid-cols-[minmax(0,1fr)_340px] sm:grid-rows-1">
            <div
              className="relative min-h-0 flex-1 touch-auto select-none"
              onTouchStart={(event) => {
                if((event.target as HTMLElement).closest('video'))return;
                touchStartX.current = event.changedTouches[0]?.clientX ?? null;
              }}
              onTouchEnd={(event) => {
                if (touchStartX.current === null || galleryItems.length < 2) return;
                const distance = (event.changedTouches[0]?.clientX ?? touchStartX.current) - touchStartX.current;
                touchStartX.current = null;
                if (Math.abs(distance) < 50) return;
                if (distance > 0) showPrevious();
                else showNext();
              }}
            >
              {activeImage.mediaType === 'video' ? <video key={activeImage.id} controls playsInline
                src={`/api/jobs/${encodeURIComponent(projectId)}/media/${encodeURIComponent(activeImage.id)}`}
                className="absolute inset-0 h-full w-full object-contain px-2 py-3 sm:px-16" aria-label={mediaAlt(activeImage)} /> : <ProjectPhotoCanvas
                key={activeImage.id}
                projectId={projectId} mediaId={activeImage.id}
                src={`/api/jobs/${encodeURIComponent(projectId)}/media/${encodeURIComponent(activeImage.id)}`}
                alt={mediaAlt(activeImage)}
                downloadName={activeImage.originalFilename??activeImage.id}
                actions={<PhotoTrashAction compact key={activeImage.id} projectId={projectId} item={activeImage} beforeAction={mayLeave} onSuccess={()=>{setActiveImageId(null);router.refresh();}}/>}
              />}

              {galleryItems.length > 1 ? (
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

            <aside className="overflow-y-auto bg-white text-slate-900" aria-label="Photo details">
              <div className="p-5">
                <div className="flex items-start justify-between gap-3"><h2 className="truncate text-sm font-semibold">{projectName}</h2><button ref={closeButtonRef} onClick={closeGallery} aria-label="Close gallery" className="-mt-1 text-2xl leading-none text-slate-500">×</button></div>
                <div className="mt-4 flex items-center gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500">{(activeImage.creatorName??'').split(' ').map(part=>part[0]).slice(0,2).join('')}</span><div><p className="text-xs font-medium">{activeImage.creatorName??'Unknown uploader'}</p><p className="mt-0.5 text-[11px] text-slate-500">{new Intl.DateTimeFormat('en-CA',{dateStyle:'short',timeStyle:'short',timeZone:PROJECT_TIME_ZONE}).format(new Date(activeImage.capturedAt??activeImage.createdAt))}</p></div></div>
              </div>
              <PhotoDetailsEditor key={activeImage.id} projectId={projectId} mediaId={activeImage.id}
                description={activeImage.description} availableTags={gallery.page.options?.tags??[]} tags={activeImage.tags} revision={activeImage.revision}
                onDirtyChange={trackDirty} />
              {activeImage.mediaType==='video'?<div className="flex items-center gap-3 px-5"><a href={`/api/jobs/${projectId}/media/${activeImage.id}`} download={activeImage.originalFilename??activeImage.id} className="text-sm text-blue-600">Download</a><PhotoTrashAction projectId={projectId} item={activeImage} beforeAction={mayLeave} onSuccess={()=>{setActiveImageId(null);router.refresh();}}/></div>:null}
            </aside>
            </div>

          </div>
        </div>
      ) : null}
    </div>
  );
}
