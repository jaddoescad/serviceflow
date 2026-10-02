"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar, Button, Card, EmptyState, Input, Select } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { initials } from "@/lib/format";
import {
  createDocumentFolder,
  createPageDocument,
  deleteDocument,
  deleteDocumentFolder,
  moveDocument,
  renameDocument,
  renameDocumentFolder,
  saveUploadedDocument,
  type ActionResult,
} from "@/lib/actions/project-documents";
import {
  PROJECT_DOCUMENTS_BUCKET,
  type ProjectDocument,
  type ProjectDocumentFolder,
} from "@/lib/project-document-types";

type SortKey = "name" | "type" | "updated";
type Row =
  | { kind: "folder"; folder: ProjectDocumentFolder; type: string }
  | { kind: "document"; document: ProjectDocument; type: string };
type Dialog =
  | { mode: "new-folder" }
  | { mode: "rename-folder"; folder: ProjectDocumentFolder }
  | { mode: "rename-document"; document: ProjectDocument }
  | { mode: "move"; document: ProjectDocument }
  | { mode: "delete-folder"; folder: ProjectDocumentFolder }
  | { mode: "delete-document"; document: ProjectDocument };

const TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "PDF",
  doc: "DOC",
  docx: "DOC",
  rtf: "DOC",
  txt: "TXT",
  xls: "XLS",
  xlsx: "XLS",
  csv: "CSV",
  ppt: "PPT",
  pptx: "PPT",
  jpg: "IMG",
  jpeg: "IMG",
  png: "IMG",
  heic: "IMG",
  webp: "IMG",
  gif: "IMG",
};

function documentType(name: string): string {
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return TYPE_BY_EXTENSION[extension] ?? (extension ? extension.slice(0, 4).toUpperCase() : "FILE");
}

function fmtUpdated(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function storageName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
}

export function ProjectDocumentsPanel({
  projectId,
  documents,
  folders,
  canManage,
}: {
  projectId: string;
  documents: ProjectDocument[];
  folders: ProjectDocumentFolder[];
  canManage: boolean;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({
    key: "updated",
    ascending: false,
  });
  const [folderId, setFolderId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const openFolder = folders.find((folder) => folder.id === folderId) ?? null;
  const searching = query.trim().length > 0;

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const folderRows: Row[] =
      searching || openFolder
        ? []
        : folders.map((folder) => ({ kind: "folder", folder, type: "FOLDER" }));
    const documentRows: Row[] = documents
      .filter((document) =>
        searching
          ? document.name.toLocaleLowerCase().includes(needle)
          : document.folderId === (openFolder?.id ?? null),
      )
      .map((document) => ({
        kind: "document",
        document,
        type: document.kind === "page" ? "DOC" : documentType(document.name),
      }));
    const value = (row: Row) => {
      const item = row.kind === "folder" ? row.folder : row.document;
      if (sort.key === "name") return item.name.toLocaleLowerCase();
      if (sort.key === "type") return row.type;
      return item.updatedAt;
    };
    const compare = (a: Row, b: Row) => {
      const result = value(a).localeCompare(value(b));
      return sort.ascending ? result : -result;
    };
    return [...folderRows.sort(compare), ...documentRows.sort(compare)];
  }, [documents, folders, openFolder, query, searching, sort]);

  function run(action: () => Promise<ActionResult>, onDone?: () => void) {
    setError("");
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong. Try again.");
        return;
      }
      onDone?.();
      router.refresh();
    });
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    const supabase = createClient();
    const targetFolder = openFolder?.id ?? null;
    const list = Array.from(files);
    setUploading((current) => [...current, ...list.map((file) => file.name)]);
    const failures: string[] = [];
    for (const file of list) {
      const path = `${projectId}/${crypto.randomUUID()}/${storageName(file.name)}`;
      const stored = await supabase.storage
        .from(PROJECT_DOCUMENTS_BUCKET)
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      const result: ActionResult = stored.error
        ? { ok: false, error: stored.error.message }
        : await saveUploadedDocument({
            projectId,
            folderId: targetFolder,
            name: file.name,
            storagePath: path,
            mimeType: file.type || null,
            byteSize: file.size,
          });
      if (!result.ok) failures.push(`${file.name}: ${result.error}`);
      setUploading((current) => {
        const index = current.indexOf(file.name);
        return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)];
      });
    }
    if (failures.length) setError(`Could not upload ${failures.join("; ")}`);
    router.refresh();
  }

  function newDocument() {
    setError("");
    startTransition(async () => {
      const result = await createPageDocument({ projectId, folderId: openFolder?.id ?? null });
      if (!result.ok || !result.documentId) {
        setError(result.error ?? "Could not create the document.");
        return;
      }
      router.push(`/jobs/${encodeURIComponent(projectId)}/documents/${result.documentId}`);
    });
  }

  function closeDialog() {
    setDialog(null);
    setError("");
  }

  function sortBy(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, ascending: !current.ascending }
        : { key, ascending: key !== "updated" },
    );
  }

  function header(key: SortKey, label: string) {
    const active = sort.key === key;
    return (
      <button
        type="button"
        onClick={() => sortBy(key)}
        className="inline-flex items-center gap-1 font-semibold text-[var(--color-heading)]"
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span aria-hidden="true" className={active ? "" : "text-[var(--color-muted)]"}>
          {active ? (sort.ascending ? "↑" : "↓") : "⇅"}
        </span>
      </button>
    );
  }

  const documentUrl = (document: ProjectDocument, download = false) =>
    `/api/jobs/${encodeURIComponent(projectId)}/documents/${document.id}${download ? "?download=1" : ""}`;
  const pageUrl = (document: ProjectDocument, exportPdf = false) =>
    `/jobs/${encodeURIComponent(projectId)}/documents/${document.id}${exportPdf ? "?export=1" : ""}`;

  return (
    <>
      {openFolder ? (
        <nav aria-label="Folder" className="mb-3 flex items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => setFolderId(null)}
            className="font-semibold text-[var(--color-muted)] hover:text-[var(--color-heading)]"
          >
            Documents
          </button>
          <span aria-hidden="true" className="text-[var(--color-muted)]">›</span>
          <span className="font-semibold text-[var(--color-heading)]">{openFolder.name}</span>
        </nav>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-56">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]"
          >
            <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="m13 13 3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a document…"
            aria-label="Find a document"
            className="pl-9"
          />
        </div>
        {canManage ? (
          <div className="flex gap-2">
            {!openFolder ? (
              <Button variant="subtle" onClick={() => setDialog({ mode: "new-folder" })}>
                <span aria-hidden="true">⊕</span> Folder
              </Button>
            ) : null}
            <DocumentMenu
              disabled={pending}
              onNew={newDocument}
              onUpload={() => fileInput.current?.click()}
            />
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                void upload(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
        ) : null}
      </div>

      {error && !dialog ? (
        <p role="alert" className="mb-3 text-sm text-[var(--color-bad)]">
          {error}
        </p>
      ) : null}

      <Card className="overflow-visible">
        {rows.length === 0 && uploading.length === 0 ? (
          <EmptyState>
            {searching
              ? "No documents match your search."
              : openFolder
                ? "This folder is empty."
                : "No documents yet."}
          </EmptyState>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--color-border)]">
              <tr>
                <th className="px-4 py-3">{header("name", "Document Name")}</th>
                <th className="hidden px-4 py-3 sm:table-cell">{header("type", "Type")}</th>
                <th className="hidden px-4 py-3 md:table-cell">{header("updated", "Last Updated")}</th>
                <th className="w-12 px-2 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {uploading.map((name, index) => (
                <tr key={`uploading-${index}`} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3 font-semibold text-[var(--color-muted)]">{name}</td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <TypeBadge type={documentType(name)} />
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-[var(--color-muted)] md:table-cell">Uploading…</td>
                  <td />
                </tr>
              ))}
              {rows.map((row) =>
                row.kind === "folder" ? (
                  <tr key={row.folder.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setFolderId(row.folder.id)}
                        className="inline-flex items-center gap-2 font-semibold text-[var(--color-heading)] hover:underline"
                      >
                        <FolderIcon />
                        {row.folder.name}
                      </button>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <TypeBadge type="FOLDER" />
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <Updated value={row.folder.updatedAt} name={row.folder.updatedByName} />
                    </td>
                    <td className="px-2 py-3 text-right">
                      {canManage ? (
                        <RowMenu
                          label={`Actions for ${row.folder.name}`}
                          items={[
                            { label: "Rename", onSelect: () => setDialog({ mode: "rename-folder", folder: row.folder }) },
                            { label: "Delete", danger: true, onSelect: () => setDialog({ mode: "delete-folder", folder: row.folder }) },
                          ]}
                        />
                      ) : null}
                    </td>
                  </tr>
                ) : (
                  <tr key={row.document.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]">
                    <td className="px-4 py-3">
                      {row.document.kind === "page" ? (
                        <Link
                          href={pageUrl(row.document)}
                          className="font-semibold text-[var(--color-heading)] hover:underline"
                        >
                          {row.document.name}
                        </Link>
                      ) : (
                        <a
                          href={documentUrl(row.document)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-[var(--color-heading)] hover:underline"
                        >
                          {row.document.name}
                        </a>
                      )}
                      {searching && row.document.folderId ? (
                        <span className="ml-2 text-xs text-[var(--color-muted)]">
                          {folders.find((folder) => folder.id === row.document.folderId)?.name}
                        </span>
                      ) : null}
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <TypeBadge type={row.type} />
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <Updated value={row.document.updatedAt} name={row.document.updatedByName} />
                    </td>
                    <td className="px-2 py-3 text-right">
                      <RowMenu
                        label={`Actions for ${row.document.name}`}
                        items={[
                          row.document.kind === "page"
                            ? { label: "Export to PDF", href: pageUrl(row.document, true) }
                            : { label: "Download", href: documentUrl(row.document, true) },
                          ...(canManage
                            ? [
                                { label: "Rename", onSelect: () => setDialog({ mode: "rename-document", document: row.document }) },
                                ...(folders.length
                                  ? [{ label: "Move to Folder", onSelect: () => setDialog({ mode: "move", document: row.document }) }]
                                  : []),
                                { label: "Delete", danger: true, onSelect: () => setDialog({ mode: "delete-document", document: row.document }) },
                              ]
                            : []),
                        ]}
                      />
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </Card>

      {dialog?.mode === "new-folder" ? (
        <NameDialog
          title="New Folder"
          placeholder="Folder name"
          submitLabel="Create Folder"
          pending={pending}
          error={error}
          onClose={closeDialog}
          onSave={(name) => run(() => createDocumentFolder({ projectId, name }), () => setDialog(null))}
        />
      ) : null}
      {dialog?.mode === "rename-folder" ? (
        <NameDialog
          title="Rename Folder"
          initial={dialog.folder.name}
          placeholder="Folder name"
          submitLabel="Save"
          pending={pending}
          error={error}
          onClose={closeDialog}
          onSave={(name) =>
            run(() => renameDocumentFolder({ projectId, folderId: dialog.folder.id, name }), () => setDialog(null))
          }
        />
      ) : null}
      {dialog?.mode === "rename-document" ? (
        <NameDialog
          title="Rename Document"
          initial={dialog.document.name}
          placeholder="Document name"
          submitLabel="Save"
          pending={pending}
          error={error}
          onClose={closeDialog}
          onSave={(name) =>
            run(() => renameDocument({ projectId, documentId: dialog.document.id, name }), () => setDialog(null))
          }
        />
      ) : null}
      {dialog?.mode === "move" ? (
        <MoveDialog
          document={dialog.document}
          folders={folders}
          pending={pending}
          error={error}
          onClose={closeDialog}
          onSave={(target) =>
            run(() => moveDocument({ projectId, documentId: dialog.document.id, folderId: target }), () => setDialog(null))
          }
        />
      ) : null}
      {dialog?.mode === "delete-folder" || dialog?.mode === "delete-document" ? (
        <ConfirmDialog
          title={dialog.mode === "delete-folder" ? "Delete Folder" : "Delete Document"}
          name={dialog.mode === "delete-folder" ? dialog.folder.name : dialog.document.name}
          pending={pending}
          error={error}
          onClose={closeDialog}
          onConfirm={() =>
            run(
              () =>
                dialog.mode === "delete-folder"
                  ? deleteDocumentFolder({ projectId, folderId: dialog.folder.id })
                  : deleteDocument({ projectId, documentId: dialog.document.id }),
              () => setDialog(null),
            )
          }
        />
      ) : null}
    </>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-text)]">
      {type}
    </span>
  );
}

function Updated({ value, name }: { value: string; name: string | null }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-[var(--color-muted)]">
      {name ? <Avatar label={initials(name)} /> : null}
      {fmtUpdated(value)}
    </span>
  );
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-[var(--color-muted)]">
      <path
        d="M2.5 5.5a1 1 0 0 1 1-1h4l1.5 2h7.5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-9Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type MenuItem = { label: string; danger?: boolean } & (
  | { href: string; onSelect?: never }
  | { onSelect: () => void; href?: never }
);

function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const itemClass = (danger?: boolean) =>
    `block w-full rounded px-4 py-2 text-left hover:bg-slate-100 ${danger ? "text-red-600" : ""}`;
  return (
    <>
      <button
        type="button"
        aria-label={label}
        popoverTarget={id}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const height = items.length * 36 + 8;
          setPosition({
            left: Math.max(8, Math.min(bounds.right - 192, window.innerWidth - 200)),
            top:
              bounds.bottom + height < window.innerHeight
                ? bounds.bottom + 4
                : Math.max(8, bounds.top - height - 4),
          });
        }}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-heading)]"
      >
        ···
      </button>
      <div
        id={id}
        ref={menu}
        popover="auto"
        style={position}
        className="fixed m-0 w-48 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-800 shadow-lg"
      >
        {items.map((item) =>
          item.href ? (
            <a
              key={item.label}
              href={item.href}
              onClick={() => menu.current?.hidePopover()}
              className={itemClass(item.danger)}
            >
              {item.label}
            </a>
          ) : (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                menu.current?.hidePopover();
                item.onSelect?.();
              }}
              className={itemClass(item.danger)}
            >
              {item.label}
            </button>
          ),
        )}
      </div>
    </>
  );
}

function DialogFrame({
  title,
  pending,
  error,
  onClose,
  children,
}: {
  title: string;
  pending: boolean;
  error: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => (pending ? null : onClose())}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) onClose();
      }}
    >
      <Card className="w-full max-w-md p-5">
        <div role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
          <h3 className="mb-4 text-lg font-semibold text-[var(--color-heading)]">{title}</h3>
          {children}
          {error ? (
            <p role="alert" className="mt-3 text-sm text-[var(--color-bad)]">
              {error}
            </p>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function NameDialog({
  title,
  initial = "",
  placeholder,
  submitLabel,
  pending,
  error,
  onClose,
  onSave,
}: {
  title: string;
  initial?: string;
  placeholder: string;
  submitLabel: string;
  pending: boolean;
  error: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const valid = name.trim().length > 0 && name.trim() !== initial;
  return (
    <DialogFrame title={title} pending={pending} error={error} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onSave(name.trim());
        }}
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          maxLength={200}
          autoFocus
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!valid || pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </div>
      </form>
    </DialogFrame>
  );
}

function MoveDialog({
  document,
  folders,
  pending,
  error,
  onClose,
  onSave,
}: {
  document: ProjectDocument;
  folders: ProjectDocumentFolder[];
  pending: boolean;
  error: string;
  onClose: () => void;
  onSave: (folderId: string | null) => void;
}) {
  const [target, setTarget] = useState(document.folderId ?? "");
  return (
    <DialogFrame title="Move to Folder" pending={pending} error={error} onClose={onClose}>
      <Select
        value={target}
        onChange={(event) => setTarget(event.target.value)}
        aria-label="Folder"
        className="w-full"
      >
        <option value="">No folder</option>
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.name}
          </option>
        ))}
      </Select>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button
          disabled={pending || target === (document.folderId ?? "")}
          onClick={() => onSave(target || null)}
        >
          {pending ? "Moving…" : "Move"}
        </Button>
      </div>
    </DialogFrame>
  );
}

function ConfirmDialog({
  title,
  name,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  name: string;
  pending: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogFrame title={title} pending={pending} error={error} onClose={onClose}>
      <p className="text-sm text-[var(--color-text)]">
        Delete <span className="font-semibold">{name}</span>? This can’t be undone.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant="danger" disabled={pending} onClick={onConfirm}>
          {pending ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </DialogFrame>
  );
}

function DocumentMenu({
  disabled,
  onNew,
  onUpload,
}: {
  disabled: boolean;
  onNew: () => void;
  onUpload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const item = "flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-slate-100";
  return (
    <div ref={root} className="relative">
      <Button disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">⊕</span> Document
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-30 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-800 shadow-lg">
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              onNew();
            }}
          >
            New Document
          </button>
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              onUpload();
            }}
          >
            Upload From Computer
          </button>
        </div>
      ) : null}
    </div>
  );
}
