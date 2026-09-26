"use client";

import { useRef, type ReactNode, type Ref } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { PhotoToolIcon } from "./photo-tool-icon";

const ProjectPhotoCanvas = dynamic(
  () =>
    import("./project-photo-canvas").then(
      (module) => module.ProjectPhotoCanvas,
    ),
  { ssr: false },
);

/** Shared presentation for project galleries and the global photo feed. */
export function MediaViewerContent({
  projectId,
  projectName,
  address,
  mediaId,
  mediaType,
  alt,
  downloadName,
  creatorName,
  capturedAt,
  actions,
  children,
  onClose,
  onPrevious,
  onNext,
  beforeNavigate,
  closeButtonRef,
}: {
  projectId: string;
  projectName: string;
  address?: string | null;
  mediaId: string;
  mediaType: "image" | "video";
  alt: string;
  downloadName: string;
  creatorName: string;
  capturedAt: string;
  actions: ReactNode;
  children: ReactNode;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  beforeNavigate: () => boolean;
  closeButtonRef?: Ref<HTMLButtonElement>;
}) {
  const touchStart = useRef<number | null>(null);
  const src = `/api/jobs/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}`;
  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(180px,1fr)_minmax(0,45%)] sm:grid-cols-[minmax(0,1fr)_min(40%,400px)] sm:grid-rows-1">
      <div
        className="relative min-h-0 min-w-0 bg-black"
        onTouchStart={(event) => {
          if ((event.target as HTMLElement).closest("video,button,a")) return;
          touchStart.current = event.changedTouches[0]?.clientX ?? null;
        }}
        onTouchEnd={(event) => {
          if (touchStart.current === null) return;
          const distance =
            (event.changedTouches[0]?.clientX ?? touchStart.current) -
            touchStart.current;
          touchStart.current = null;
          if (distance > 50) onPrevious?.();
          if (distance < -50) onNext?.();
        }}
      >
        {mediaType === "video" ? (
          <>
            <video
              key={mediaId}
              src={src}
              controls
              playsInline
              aria-label={alt}
              className="h-full w-full object-contain"
            />
            <div className="absolute left-4 top-4 z-10 flex items-center gap-1 rounded-lg bg-white p-2 text-slate-800 shadow-sm">
              <a
                aria-label="Download original"
                title="Download original"
                href={`${src}?download=1`}
                download={downloadName}
                className="p-2"
              >
                <PhotoToolIcon name="download" />
              </a>
              {actions}
            </div>
          </>
        ) : (
          <ProjectPhotoCanvas
            key={mediaId}
            projectId={projectId}
            mediaId={mediaId}
            src={src}
            alt={alt}
            downloadName={downloadName}
            actions={actions}
          />
        )}
        {onPrevious ? (
          <button
            type="button"
            onClick={onPrevious}
            aria-label="Previous media"
            className="absolute left-4 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-700 shadow hover:bg-white"
          >
            ‹
          </button>
        ) : null}
        {onNext ? (
          <button
            type="button"
            onClick={onNext}
            aria-label="Next media"
            className="absolute right-4 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-700 shadow hover:bg-white"
          >
            ›
          </button>
        ) : null}
      </div>
      <aside
        className="min-w-0 overflow-y-auto bg-white text-slate-900"
        aria-label="Media details"
      >
        <header className="p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={`/jobs/${projectId}`}
                onClick={(event) => {
                  if (!beforeNavigate()) event.preventDefault();
                }}
                className="block truncate text-lg font-bold hover:text-blue-600"
              >
                {projectName}
              </Link>
              {address ? (
                <p className="mt-1 text-xs text-slate-600">{address}</p>
              ) : null}
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close gallery"
              className="-mr-2 -mt-2 flex h-8 w-8 shrink-0 items-center justify-center text-3xl font-light text-slate-600"
            >
              ×
            </button>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-600">
              {creatorName
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")}
            </span>
            <div>
              <p className="text-sm">{creatorName}</p>
              <time
                dateTime={capturedAt}
                className="mt-0.5 block text-xs text-slate-500"
              >
                {new Intl.DateTimeFormat("en-CA", {
                  dateStyle: "short",
                  timeStyle: "short",
                  timeZone: "America/Toronto",
                }).format(new Date(capturedAt))}
              </time>
            </div>
          </div>
        </header>
        {children}
      </aside>
    </div>
  );
}
