"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDocumentAssets, removeDocumentAsset } from "@/lib/actions/documents";
import { loadGalleryPage } from "@/lib/actions/gallery-page";
import { setProposalCompanyDocuments } from "@/lib/actions/proposals";
import {
  DOCUMENT_ASSET_MAX_BYTES,
  documentAssetUrl,
  fmtFileSize,
  removeDocumentAssets,
  uploadDocumentAsset,
  webImage,
} from "@/lib/document-assets";
import { DEFAULT_GALLERY_FILTERS, type GalleryCursor } from "@/lib/gallery-page";
import type { ProjectMediaItem } from "@/lib/project-data";
import type { CompanyDocument, DocumentAsset, DocumentKind } from "@/lib/proposal-types";
import { DialogFooter } from "./document-dialogs";
import { Switch, linkStyle } from "./pipeline-ui";
import { ProjectMediaPreview } from "./project-media-preview";
import { ProjectModal } from "./project-profile-panel";
import { Button, Card, EmptyState, cn } from "./ui";

type NewAsset = { kind: "photo" | "file"; name: string; path: string; mimeType: string; byteSize: number };
type Prepared = { kind: "photo" | "file"; name: string; blob: Blob };

const PICK_LIMIT = 30;

function mediaUrl(projectId: string, mediaId: string) {
  return `/api/jobs/${encodeURIComponent(projectId)}/media/${encodeURIComponent(mediaId)}`;
}

/** Re-encoded images get the matching extension. */
function renamed(name: string, blob: Blob) {
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[blob.type];
  return extension ? `${name.replace(/\.[^./]+$/, "")}.${extension}` : name;
}

/** A copy of a project photo customers can open: the original resized, else the preview. */
async function prepareProjectPhoto(projectId: string, item: ProjectMediaItem, index: number): Promise<Prepared> {
  const url = mediaUrl(projectId, item.id);
  const name = item.originalFilename || `Photo ${index + 1}.jpg`;
  const original = await fetch(url);
  const image = original.ok ? await webImage(await original.blob()) : null;
  if (image) return { kind: "photo", name: renamed(name, image), blob: image };
  const preview = await fetch(`${url}?preview=1`);
  if (!preview.ok) throw new Error(`Couldn't load ${name}.`);
  const blob = await preview.blob();
  return { kind: "photo", name: renamed(name, blob), blob };
}

/** Images become photos (resized when large); anything else, or an image this browser can't read, is a file. */
async function prepareUpload(file: File): Promise<Prepared> {
  const image = file.type.startsWith("image/") ? await webImage(file) : null;
  return image ? { kind: "photo", name: renamed(file.name, image), blob: image } : { kind: "file", name: file.name, blob: file };
}

function ProjectPhotoPicker({
  projectId,
  onAdd,
  onClose,
}: {
  projectId: string;
  onAdd: (items: ProjectMediaItem[]) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<ProjectMediaItem[]>([]);
  const [cursor, setCursor] = useState<GalleryCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  async function load(after: GalleryCursor | null) {
    setLoading(true);
    setError("");
    try {
      const page = await loadGalleryPage(projectId, { ...DEFAULT_GALLERY_FILTERS, type: "image" }, after);
      setItems((current) => (after ? [...current, ...page.items] : page.items));
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch {
      setError("Couldn't load the project's photos. Try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((other) => other !== id)
        : current.length < PICK_LIMIT
          ? [...current, id]
          : current,
    );
  }

  return (
    <ProjectModal title="Add project photos" wide onClose={onClose}>
      <div className="p-5">
        {items.length ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
            {items.map((item) => {
              const checked = selected.includes(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={checked}
                    aria-label={item.originalFilename ?? "Photo"}
                    onClick={() => toggle(item.id)}
                    className="relative block aspect-square w-full overflow-hidden rounded-[var(--radius-control)] bg-[var(--color-surface-2)] outline-none focus-visible:shadow-[var(--focus-ring)]"
                  >
                    <ProjectMediaPreview src={mediaUrl(projectId, item.id)} alt={item.originalFilename ?? "Photo"} />
                    <span
                      aria-hidden="true"
                      className={
                        checked
                          ? "absolute inset-0 ring-2 ring-inset ring-[var(--color-brand)]"
                          : "absolute inset-0 hover:bg-black/10"
                      }
                    />
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute left-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px] leading-none",
                        checked
                          ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-ink)]"
                          : "border-[var(--color-border-strong)] bg-[var(--color-surface)]",
                      )}
                    >
                      {checked ? "✓" : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState>{loading ? "Loading…" : error || "No photos on this project yet."}</EmptyState>
        )}
        {items.length && error ? <p className="mt-3 text-[13px] text-[var(--color-bad)]">{error}</p> : null}
        {hasMore ? (
          <div className="mt-3 flex justify-center">
            <Button type="button" variant="ghost" disabled={loading} onClick={() => void load(cursor)}>
              {loading ? "Loading…" : "Load more"}
            </Button>
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="subtle" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!selected.length}
          onClick={() => onAdd(selected.map((id) => items.find((item) => item.id === id)!))}
        >
          {selected.length ? `Add ${selected.length} photo${selected.length === 1 ? "" : "s"}` : "Add photos"}
        </Button>
      </DialogFooter>
    </ProjectModal>
  );
}

function RemoveButton({
  name,
  disabled,
  onClick,
  className,
}: {
  name: string;
  disabled: boolean;
  onClick: () => void;
  className: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Remove ${name}`}
      title="Remove"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-[var(--radius-control)] text-base text-[var(--color-muted)] outline-none hover:text-[var(--color-bad)] focus-visible:opacity-100 focus-visible:shadow-[var(--focus-ring)] disabled:opacity-50 lg:opacity-0 lg:group-hover:opacity-100",
        className,
      )}
    >
      ×
    </button>
  );
}

/** Proposals: whether the customer's link offers the company's insurance and other documents. */
function CompanyDocumentsRow({
  proposalId,
  include: initialInclude,
  documents,
  readOnly,
}: {
  proposalId: string;
  include: boolean;
  documents: CompanyDocument[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [include, setInclude] = useState(initialInclude);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  if (!documents.length) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-2 text-[13px]">
        <span className="text-[var(--color-muted)]">No company documents</span>
        <Link href="/settings#documents" className={linkStyle}>
          Add in Settings
        </Link>
      </div>
    );
  }
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-2">
      <div className="min-w-0">
        <div className="text-[13px] text-[var(--color-heading)]">Include company documents</div>
        <div className={error ? "text-xs text-[var(--color-bad)]" : "truncate text-xs text-[var(--color-muted)]"}>
          {error || documents.map((file) => file.name).join(", ")}
        </div>
      </div>
      <Switch
        label="Include company documents"
        checked={include}
        disabled={readOnly || pending}
        onChange={(next) => {
          setError("");
          setInclude(next);
          startTransition(async () => {
            const result = await setProposalCompanyDocuments(proposalId, next);
            if (!result.ok) {
              setInclude(!next);
              setError(result.error ?? "Could not update.");
              return;
            }
            router.refresh();
          });
        }}
      />
    </div>
  );
}

/** Photos and files the customer sees with the document. */
export function DocumentAttachments({
  kind,
  documentId,
  orgId,
  projectId,
  assets,
  readOnly,
  companyDocuments,
}: {
  kind: DocumentKind;
  documentId: string;
  orgId: string;
  /** Where "Project photos" come from. */
  projectId: string;
  assets: DocumentAsset[];
  readOnly: boolean;
  /** Proposals only. */
  companyDocuments?: { include: boolean; documents: CompanyDocument[] };
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [progress, setProgress] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();
  const busy = !!progress || !!removing;
  const photos = assets.filter((asset) => asset.kind === "photo");
  const files = assets.filter((asset) => asset.kind === "file");
  if (readOnly && !assets.length && !companyDocuments) return null;

  /** Uploads one at a time, then records whatever made it up. */
  async function attach(sources: Array<() => Promise<Prepared>>) {
    setError("");
    const added: NewAsset[] = [];
    try {
      for (const [index, prepare] of sources.entries()) {
        setProgress(sources.length > 1 ? `Adding ${index + 1} of ${sources.length}…` : "Adding…");
        const { kind: assetKind, name, blob } = await prepare();
        if (blob.size > DOCUMENT_ASSET_MAX_BYTES) throw new Error(`${name} is larger than 25 MB.`);
        const path = await uploadDocumentAsset(orgId, blob, name);
        added.push({ kind: assetKind, name, path, mimeType: blob.type, byteSize: blob.size });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't upload. Try again.");
    }
    if (added.length) {
      const result = await addDocumentAssets({ kind, documentId, assets: added });
      if (!result.ok) {
        await removeDocumentAssets(added.map((asset) => asset.path));
        setError(result.error ?? "Couldn't add the files.");
      }
    }
    setProgress("");
    startTransition(() => router.refresh());
  }

  function remove(asset: DocumentAsset) {
    setRemoving(asset.id);
    setError("");
    startTransition(async () => {
      const result = await removeDocumentAsset(kind, asset.id);
      if (!result.ok) setError(result.error ?? "Couldn't remove it.");
      router.refresh();
      setRemoving(null);
    });
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-1.5">
        <h2 className="text-[13px] font-semibold text-[var(--color-heading)]">Photos & files</h2>
        {readOnly ? null : (
          <div className="flex items-center gap-1">
            {progress ? <span className="mr-1 text-xs text-[var(--color-muted)]">{progress}</span> : null}
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setPicking(true)}>
              + Project photos
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
              + Upload
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              aria-label="Upload photos or files"
              className="sr-only"
              onChange={(event) => {
                const chosen = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (chosen.length) void attach(chosen.map((file) => () => prepareUpload(file)));
              }}
            />
          </div>
        )}
      </div>
      {error ? (
        <p role="alert" className="px-4 pb-2 text-[13px] text-[var(--color-bad)]">
          {error}
        </p>
      ) : null}
      {photos.length ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2 border-t border-[var(--color-border)] p-4">
          {photos.map((photo) => (
            <li
              key={photo.id}
              className="group relative aspect-square overflow-hidden rounded-[var(--radius-control)] bg-[var(--color-surface-2)]"
            >
              <a href={documentAssetUrl(photo.path)} target="_blank" rel="noreferrer" className="block h-full w-full">
                <img
                  src={documentAssetUrl(photo.path)}
                  alt={photo.name}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </a>
              {readOnly ? null : (
                <RemoveButton
                  name={photo.name}
                  disabled={busy}
                  onClick={() => remove(photo)}
                  className="absolute right-1 top-1 bg-[var(--color-surface)] shadow-[var(--shadow-pop-lite)]"
                />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {files.length ? (
        <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
          {files.map((file) => (
            <li key={file.id} className="group flex min-h-10 items-center justify-between gap-3 px-4">
              <a
                href={documentAssetUrl(file.path)}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate text-[13px] font-medium text-[var(--color-heading)] hover:underline"
              >
                {file.name}
              </a>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-xs tabular-nums text-[var(--color-muted)]">{fmtFileSize(file.byteSize)}</span>
                {readOnly ? null : (
                  <RemoveButton name={file.name} disabled={busy} onClick={() => remove(file)} className="hover:bg-[var(--color-hover)]" />
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {companyDocuments ? (
        <CompanyDocumentsRow
          proposalId={documentId}
          include={companyDocuments.include}
          documents={companyDocuments.documents}
          readOnly={readOnly}
        />
      ) : null}
      {picking ? (
        <ProjectPhotoPicker
          projectId={projectId}
          onClose={() => setPicking(false)}
          onAdd={(items) => {
            setPicking(false);
            void attach(items.map((item, index) => () => prepareProjectPhoto(projectId, item, index)));
          }}
        />
      ) : null}
    </Card>
  );
}
