"use client";

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { ProjectModal } from "@/components/project-profile-panel";
import { Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

const MEDIA_API_URL = (
  process.env.NEXT_PUBLIC_PROJECT_MEDIA_API_URL ||
  "https://project-media-worker.jadslim-fai.workers.dev"
).replace(/\/+$/, "");

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_VIDEO_BYTES = 95 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  qt: "video/quicktime",
};
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime"]);

function inferMimeType(file: File): string | null {
  const declared = file.type.toLowerCase().split(";")[0].trim();
  if (IMAGE_TYPES.has(declared) || VIDEO_TYPES.has(declared)) return declared;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? null;
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function validateFile(file: File): string | null {
  const mimeType = inferMimeType(file);
  if (!mimeType) return `${file.name}: unsupported file type.`;
  const kind = VIDEO_TYPES.has(mimeType) ? "video" : "image";
  const limit = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size <= 0) return `${file.name}: the file is empty.`;
  if (file.size > limit) {
    return `${file.name}: ${kind}s must be under ${Math.floor(limit / (1024 * 1024))} MB.`;
  }
  return null;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error?.trim()) return body.error.trim();
  } catch {
    // Keep a stable message when an upstream error body is not JSON.
  }
  return `Upload failed (HTTP ${response.status}).`;
}

export function ProjectMediaUpload({
  projectId,
  isLead,
}: {
  projectId: string;
  isLead: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function addFiles(nextFiles: File[]) {
    setError(null);
    const invalid = nextFiles.map(validateFile).find(Boolean);
    if (invalid) {
      setError(invalid);
      return;
    }
    setFiles((current) => {
      const known = new Set(current.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
      return [
        ...current,
        ...nextFiles.filter((file) => !known.has(`${file.name}:${file.size}:${file.lastModified}`)),
      ];
    });
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  function close() {
    if (uploading) return;
    setOpen(false);
    setFiles([]);
    setError(null);
    setProgress(null);
  }

  async function upload() {
    if (!files.length || uploading) return;
    setUploading(true);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      if (sessionError || !session?.access_token) {
        throw new Error("Your session expired. Sign in again before uploading.");
      }

      const projectKind = isLead ? "leads" : "jobs";
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const mimeType = inferMimeType(file);
        if (!mimeType) throw new Error(`${file.name}: unsupported file type.`);
        const mediaType = VIDEO_TYPES.has(mimeType) ? "video" : "image";
        setProgress(`Uploading ${index + 1} of ${files.length}: ${file.name}`);

        const response = await fetch(
          `${MEDIA_API_URL}/v1/${projectKind}/${encodeURIComponent(projectId)}/media`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": mimeType,
              "x-media-type": mediaType,
              "x-file-size": String(file.size),
              "x-original-filename": file.name,
              "x-captured-at": new Date(file.lastModified || Date.now()).toISOString(),
            },
            body: file,
          },
        );
        if (!response.ok) throw new Error(await responseError(response));
      }

      setProgress(`${files.length} ${files.length === 1 ? "file" : "files"} uploaded.`);
      router.refresh();
      setFiles([]);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} className="shrink-0">
        <span aria-hidden="true" className="text-base leading-none">＋</span>
        Upload photos
      </Button>

      {open ? (
        <ProjectModal
          title="Add photos and videos"
          subtitle="Upload directly to this project. Originals stay private in Cloudflare."
          onClose={close}
          wide
        >
          <div className="space-y-5 p-6">
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,video/mp4,video/quicktime,.heic,.heif,.mov,.m4v"
              className="sr-only"
              onChange={(event) => {
                addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <div
              onDragEnter={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setDragActive(false);
                }
              }}
              onDrop={drop}
              className={`flex min-h-56 flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                dragActive
                  ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)]"
                  : "border-[var(--color-border)] bg-[var(--color-bg)]"
              }`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-2xl text-[var(--color-brand-strong)]">
                ↑
              </div>
              <h3 className="mt-4 font-display text-base font-semibold text-[var(--color-heading)]">
                Drag and drop photos or videos here
              </h3>
              <p className="mt-1 max-w-md text-sm text-[var(--color-muted)]">
                JPEG, PNG, WebP, HEIC, MP4, or MOV. Images up to 25 MB; videos up to 95 MB.
              </p>
              <Button
                type="button"
                variant="subtle"
                className="mt-5"
                onClick={() => inputRef.current?.click()}
                disabled={uploading}
              >
                Choose files
              </Button>
            </div>

            {files.length ? (
              <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
                <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  Ready to upload · {files.length}
                </div>
                <ul className="max-h-52 divide-y divide-[var(--color-border)] overflow-y-auto">
                  {files.map((file, index) => (
                    <li key={`${file.name}:${file.size}:${file.lastModified}`} className="flex items-center gap-3 px-4 py-3 text-sm">
                      <span aria-hidden="true" className="text-lg">
                        {VIDEO_TYPES.has(inferMimeType(file) ?? "") ? "▶" : "▧"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">{file.name}</span>
                      <span className="shrink-0 text-xs text-[var(--color-muted)]">{sizeLabel(file.size)}</span>
                      <button
                        type="button"
                        className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-heading)]"
                        onClick={() => setFiles((current) => current.filter((_file, itemIndex) => itemIndex !== index))}
                        disabled={uploading}
                        aria-label={`Remove ${file.name}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {progress ? <p className="text-sm text-[var(--color-muted)]">{progress}</p> : null}
            {error ? (
              <p role="alert" className="rounded-lg bg-[var(--color-bad-soft)] px-3 py-2 text-sm text-[var(--color-bad)]">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] pt-5">
              <Button type="button" variant="subtle" onClick={close} disabled={uploading}>
                Cancel
              </Button>
              <Button type="button" onClick={upload} disabled={!files.length || uploading}>
                {uploading
                  ? "Uploading…"
                  : files.length
                    ? `Upload ${files.length} ${files.length === 1 ? "file" : "files"}`
                    : "Upload files"}
              </Button>
            </div>
          </div>
        </ProjectModal>
      ) : null}
    </>
  );
}
