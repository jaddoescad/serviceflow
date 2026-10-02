"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Input } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { deleteDocument, loadPageDocument, renameDocument, savePageDocument } from "@/lib/actions/project-documents";
import {
  PROJECT_DOCUMENTS_BUCKET,
  pageImagePath,
  pageImageUrl,
  type ProjectPageDocument,
} from "@/lib/project-document-types";
import { richTextToPlain, sanitizeRichText } from "@/lib/rich-text";
import { toggleList, type ListKind } from "@/lib/editor-lists";

type Block = "h1" | "h2" | "h3" | "p";
type Menu = "block" | "color" | "align" | "insert" | "more" | null;
type SaveState =
  | { status: "saved"; at: string }
  | { status: "saving" }
  | { status: "error"; message: string }
  | { status: "conflict"; message: string };

const BLOCKS: { value: Block; label: string; className: string }[] = [
  { value: "h1", label: "Heading 1", className: "text-2xl font-bold" },
  { value: "h2", label: "Heading 2", className: "text-xl font-semibold" },
  { value: "h3", label: "Heading 3", className: "text-base font-semibold" },
  { value: "p", label: "Paragraph", className: "text-sm" },
];
const COLORS = [
  { label: "Default", value: "#101725" },
  { label: "Gray", value: "#6b7688" },
  { label: "Red", value: "#d3453e" },
  { label: "Orange", value: "#d9730d" },
  { label: "Yellow", value: "#b7770f" },
  { label: "Green", value: "#17935a" },
  { label: "Blue", value: "#2f6bff" },
  { label: "Purple", value: "#7c3aed" },
];
const EMPTY_BODY = "<p><br></p>";
const AUTOSAVE_MS = 1000;

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

function hasContent(html: string): boolean {
  return richTextToPlain(html).length > 0 || /<(img|table|hr)\b/i.test(html);
}

export function DocumentEditor({
  document: page,
  canEdit,
}: {
  document: ProjectPageDocument;
  canEdit: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const listHref = `/jobs/${encodeURIComponent(page.projectId)}/documents`;

  const editor = useRef<HTMLDivElement>(null);
  const printRoot = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const expectedUpdatedAt = useRef(page.updatedAt);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  const [title, setTitle] = useState(page.name);
  const [savedTitle, setSavedTitle] = useState(page.name);
  const [editingTitle, setEditingTitle] = useState(false);
  const [save, setSave] = useState<SaveState>({ status: "saved", at: page.updatedAt });
  const [menu, setMenu] = useState<Menu>(null);
  const [block, setBlock] = useState<Block>("p");
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [headings, setHeadings] = useState<{ id: number; text: string }[]>([]);
  const [tocOpen, setTocOpen] = useState(true);
  const [linkDialog, setLinkDialog] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState("");
  const [mounted, setMounted] = useState(false);

  // ---- saving -------------------------------------------------------------

  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(task, task);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  const saveBody = useCallback((): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current || stopped.current || !editor.current) return queue.current.then(() => true);
    return enqueue(async () => {
      if (!dirty.current || stopped.current || !editor.current) return true;
      dirty.current = false;
      setSave({ status: "saving" });
      const html = editor.current.innerHTML;
      try {
        const result = await savePageDocument({
          projectId: page.projectId,
          documentId: page.id,
          bodyHtml: hasContent(html) ? html : "",
          expectedUpdatedAt: expectedUpdatedAt.current,
        });
        if (result.ok && result.updatedAt) {
          expectedUpdatedAt.current = result.updatedAt;
          setSave({ status: "saved", at: result.updatedAt });
          return true;
        }
        if (result.conflict) {
          stopped.current = true;
          setSave({ status: "conflict", message: result.error ?? "This document changed elsewhere." });
          return false;
        }
        throw new Error(result.error ?? "Could not save.");
      } catch (error) {
        dirty.current = true;
        setSave({ status: "error", message: error instanceof Error ? error.message : "Could not save." });
        timer.current = setTimeout(() => void saveBody(), 4000);
        return false;
      }
    });
  }, [enqueue, page.id, page.projectId]);

  const changed = useCallback(() => {
    if (!editor.current) return;
    dirty.current = true;
    const html = editor.current.innerHTML;
    editor.current.dataset.empty = hasContent(html) ? "false" : "true";
    const nodes = Array.from(editor.current.querySelectorAll("h1"));
    setHeadings(nodes.map((node, index) => ({ id: index, text: node.textContent?.trim() || "Untitled heading" })));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveBody(), AUTOSAVE_MS);
  }, [saveBody]);

  // ---- setup --------------------------------------------------------------

  const initialized = useRef(false);
  useEffect(() => {
    setMounted(true);
    const node = editor.current;
    // Load the saved body once; later server re-renders must not overwrite typing.
    if (!node || initialized.current) return;
    initialized.current = true;
    const show = (html: string) => {
      node.innerHTML = html || EMPTY_BODY;
      node.dataset.empty = hasContent(html) ? "false" : "true";
      setHeadings(
        Array.from(node.querySelectorAll("h1")).map((heading, index) => ({
          id: index,
          text: heading.textContent?.trim() || "Untitled heading",
        })),
      );
    };
    show(page.bodyHtml);
    // Reopening a page can render Next's cached copy from before the last
    // edits; fetch the saved version unless the person has started typing.
    void loadPageDocument(page.projectId, page.id).then((latest) => {
      if (!latest || dirty.current || latest.updatedAt === expectedUpdatedAt.current) return;
      expectedUpdatedAt.current = latest.updatedAt;
      show(latest.bodyHtml);
      setSave({ status: "saved", at: latest.updatedAt });
    }, () => undefined);
    if (canEdit) {
      try {
        document.execCommand("defaultParagraphSeparator", false, "p");
        document.execCommand("styleWithCSS", false, "true");
      } catch {
        /* older browsers keep their defaults */
      }
    }
  }, [canEdit, page.bodyHtml, page.id, page.projectId]);

  useEffect(() => {
    function onSelectionChange() {
      const node = editor.current;
      const selection = window.getSelection();
      if (!node || !selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      if (!node.contains(range.commonAncestorContainer)) return;
      savedRange.current = range.cloneRange();
      let element: Node | null = range.startContainer;
      let found: Block = "p";
      while (element && element !== node) {
        const name = element.nodeName.toLowerCase();
        if (name === "h1" || name === "h2" || name === "h3") {
          found = name;
          break;
        }
        element = element.parentNode;
      }
      setBlock(found);
      const state = (command: string) => {
        try {
          return document.queryCommandState(command);
        } catch {
          return false;
        }
      };
      const listElement = closest(range.startContainer, "ul,ol");
      setActive({
        bold: state("bold"),
        italic: state("italic"),
        underline: state("underline"),
        checklist: !!listElement?.matches("ul[data-checklist]"),
        bullets: !!listElement?.matches("ul:not([data-checklist])"),
        numbers: listElement?.tagName === "OL",
      });
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (dirty.current || save.status === "saving") {
        void saveBody();
        event.preventDefault();
      }
    }
    function onBeforePrint() {
      if (printRoot.current && editor.current) {
        printRoot.current.innerHTML = sanitizeRichText(editor.current.innerHTML);
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("beforeprint", onBeforePrint);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("beforeprint", onBeforePrint);
    };
  }, [save.status, saveBody]);

  useEffect(() => {
    if (!menu) return;
    function onPointerDown(event: MouseEvent) {
      if (!(event.target as HTMLElement).closest("[data-editor-menu]")) setMenu(null);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menu]);

  const exportPdf = useCallback(() => {
    setMenu(null);
    if (printRoot.current && editor.current) {
      printRoot.current.innerHTML = sanitizeRichText(editor.current.innerHTML);
    }
    window.print();
  }, []);

  // "Export to PDF" from the documents list opens the page with ?export=1.
  const exportRequested = useRef(false);
  useEffect(() => {
    if (exportRequested.current || searchParams.get("export") !== "1") return;
    exportRequested.current = true;
    setTimeout(() => {
      exportPdf();
      router.replace(`${listHref}/${encodeURIComponent(page.id)}`);
    }, 300);
  }, [exportPdf, listHref, page.id, router, searchParams]);

  // ---- commands -----------------------------------------------------------

  function restoreSelection() {
    const node = editor.current;
    if (!node) return;
    node.focus();
    const selection = window.getSelection();
    if (savedRange.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
  }

  function exec(command: string, value?: string) {
    restoreSelection();
    document.execCommand(command, false, value);
    setMenu(null);
    changed();
  }

  function list(kind: ListKind) {
    restoreSelection();
    setMenu(null);
    if (editor.current && toggleList(editor.current, kind)) changed();
  }

  function insertTable() {
    const cells = (tag: "th" | "td") => `<tr>${`<${tag}><br></${tag}>`.repeat(3)}</tr>`;
    exec(
      "insertHTML",
      `<table data-new="true"><thead>${cells("th")}</thead><tbody>${cells("td")}${cells("td")}</tbody></table><p><br></p>`,
    );
    // Put the caret in the first header cell so typing fills the table.
    const table = editor.current?.querySelector("table[data-new]");
    const first = table?.querySelector("th");
    table?.removeAttribute("data-new");
    if (first) {
      const range = document.createRange();
      range.selectNodeContents(first);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }

  async function insertImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Choose an image file.");
      return;
    }
    setNotice("Uploading image…");
    const imageId = crypto.randomUUID();
    const { error } = await createClient()
      .storage.from(PROJECT_DOCUMENTS_BUCKET)
      .upload(pageImagePath(page.projectId, page.id, imageId), file, {
        contentType: file.type,
        upsert: false,
      });
    if (error) {
      setNotice(`Could not upload the image: ${error.message}`);
      return;
    }
    setNotice("");
    const alt = file.name.replace(/[<>"&]/g, "");
    exec("insertHTML", `<img src="${pageImageUrl(page.projectId, page.id, imageId)}" alt="${alt}"><p><br></p>`);
  }

  function addLink(url: string) {
    setLinkDialog(false);
    const href = /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}`;
    restoreSelection();
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      const text = href.replace(/[<>"&]/g, "");
      document.execCommand("insertHTML", false, `<a href="${text}">${text}</a>`);
    } else {
      document.execCommand("createLink", false, href);
    }
    changed();
  }

  function onEditorClick(event: React.MouseEvent<HTMLDivElement>) {
    const item = (event.target as HTMLElement).closest("li");
    if (!canEdit || !item || !item.parentElement?.matches("ul[data-checklist]")) return;
    const box = item.getBoundingClientRect();
    if (event.clientX - box.left > 24) return;
    item.setAttribute("data-checked", item.getAttribute("data-checked") === "true" ? "false" : "true");
    changed();
  }

  function onEditorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      const selection = window.getSelection();
      const cell = selection?.rangeCount
        ? (closest(selection.getRangeAt(0).startContainer, "td,th") as HTMLTableCellElement | null)
        : null;
      const table = cell?.closest("table");
      if (cell && table && editor.current?.contains(table)) {
        event.preventDefault();
        const cells = Array.from(table.querySelectorAll<HTMLTableCellElement>("td,th"));
        let target = cells[cells.indexOf(cell) + (event.shiftKey ? -1 : 1)];
        if (!target && !event.shiftKey) {
          const row = document.createElement("tr");
          const width = cell.parentElement?.children.length ?? 1;
          for (let index = 0; index < width; index += 1) {
            const td = document.createElement("td");
            td.appendChild(document.createElement("br"));
            row.appendChild(td);
          }
          (table.tBodies[0] ?? table).appendChild(row);
          target = row.cells[0];
          changed();
        }
        if (target) {
          const range = document.createRange();
          range.selectNodeContents(target);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      setTimeout(() => {
        const selection = window.getSelection();
        const item = selection?.rangeCount
          ? (closest(selection.getRangeAt(0).startContainer, "li") as HTMLLIElement | null)
          : null;
        if (item?.parentElement?.matches("ul[data-checklist]")) {
          item.setAttribute("data-checked", "false");
          changed();
        }
      });
    }
  }

  function onPaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const content = html
      ? sanitizeRichText(html.replace(/^[\s\S]*<body[^>]*>|<\/body>[\s\S]*$/gi, ""))
      : text
          .split(/\r?\n/)
          .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
          .join("<br>");
    document.execCommand("insertHTML", false, content);
    changed();
  }

  async function saveTitle() {
    setEditingTitle(false);
    const next = title.trim();
    if (!next || next === savedTitle) {
      setTitle(savedTitle);
      return;
    }
    await saveBody();
    const result = await enqueue(() =>
      renameDocument({ projectId: page.projectId, documentId: page.id, name: next }),
    );
    if (result.ok) {
      setSavedTitle(next);
      if (result.updatedAt) {
        expectedUpdatedAt.current = result.updatedAt;
        setSave({ status: "saved", at: result.updatedAt });
      }
    } else {
      setTitle(savedTitle);
      setNotice(result.error ?? "Could not rename.");
    }
  }

  async function goBack(event: React.MouseEvent) {
    if (!dirty.current && save.status !== "saving") return;
    event.preventDefault();
    await saveBody();
    router.push(listHref);
  }

  async function removeDocument() {
    setDeleting(true);
    stopped.current = true;
    const result = await deleteDocument({ projectId: page.projectId, documentId: page.id });
    if (!result.ok) {
      stopped.current = false;
      setDeleting(false);
      setConfirmDelete(false);
      setNotice(result.error ?? "Could not delete.");
      return;
    }
    dirty.current = false;
    router.push(listHref);
  }

  function scrollToHeading(index: number) {
    editor.current?.querySelectorAll("h1")[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- render -------------------------------------------------------------

  const tool = (label: string, icon: IconName, onClick: () => void, isActive = false) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={isActive}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
        isActive
          ? "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
          : "text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
      }`}
    >
      <Icon name={icon} />
    </button>
  );

  const menuButton = (name: Exclude<Menu, null>, label: string, icon: IconName) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-expanded={menu === name}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => setMenu(menu === name ? null : name)}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
    >
      <Icon name={icon} />
    </button>
  );

  const panel = "absolute left-0 top-full z-30 mt-1 rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-800 shadow-lg";
  const item = "flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-slate-100";

  return (
    <div className="-mx-4 -my-5 flex min-h-svh lg:-mx-6 lg:-my-6">
      <style>{EDITOR_CSS}</style>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
          <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 lg:px-8">
            <Link
              href={listHref}
              onClick={goBack}
              className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-text)] hover:text-[var(--color-heading)]"
            >
              <span aria-hidden="true">‹</span> Back
            </Link>
            <span aria-hidden="true" className="h-5 w-px bg-[var(--color-border)]" />
            {canEdit && editingTitle ? (
              <input
                autoFocus
                value={title}
                maxLength={200}
                placeholder="Untitled"
                aria-label="Document name"
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    setTitle(savedTitle);
                    setEditingTitle(false);
                  }
                }}
                className="min-w-0 rounded border border-[var(--color-brand)] bg-transparent px-1.5 py-0.5 text-base font-semibold text-[var(--color-heading)] outline-none"
              />
            ) : (
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => setEditingTitle(true)}
                className="inline-flex min-w-0 items-center gap-1.5 text-base font-semibold text-[var(--color-heading)] disabled:cursor-default"
                aria-label={canEdit ? `Rename ${savedTitle}` : undefined}
              >
                <span className="truncate">{savedTitle}</span>
                {canEdit ? <Icon name="pencil" className="h-3.5 w-3.5 text-[var(--color-muted)]" /> : null}
              </button>
            )}
            <div className="ml-auto flex items-center gap-4">
              <SaveStatus state={save} />
              <button
                type="button"
                onClick={exportPdf}
                className="text-sm font-semibold text-[var(--color-heading)] hover:text-[var(--color-brand)]"
              >
                Export PDF
              </button>
              {canEdit ? (
                <div className="relative" data-editor-menu>
                  <button
                    type="button"
                    aria-label="More actions"
                    aria-expanded={menu === "more"}
                    onClick={() => setMenu(menu === "more" ? null : "more")}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-heading)] hover:brightness-95"
                  >
                    ···
                  </button>
                  {menu === "more" ? (
                    <div className={`${panel} left-auto right-0 w-44`}>
                      <button
                        type="button"
                        className={`${item} text-red-600`}
                        onClick={() => {
                          setMenu(null);
                          setConfirmDelete(true);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {canEdit ? (
            <div
              role="toolbar"
              aria-label="Formatting"
              className="flex flex-wrap items-center gap-0.5 border-t border-[var(--color-border)] px-4 py-1.5 lg:px-8"
            >
              <div className="relative" data-editor-menu>
                <button
                  type="button"
                  aria-expanded={menu === "block"}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setMenu(menu === "block" ? null : "block")}
                  className="inline-flex h-8 w-32 items-center justify-between rounded-md px-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                >
                  {BLOCKS.find((option) => option.value === block)?.label}
                  <Icon name="chevron" className="h-3.5 w-3.5" />
                </button>
                {menu === "block" ? (
                  <div className={`${panel} w-44`}>
                    {BLOCKS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => exec("formatBlock", `<${option.value}>`)}
                        className={`${item} ${option.className} ${block === option.value ? "text-[var(--color-brand-strong)]" : ""}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <Divider />
              {tool("Bold", "bold", () => exec("bold"), active.bold)}
              {tool("Italic", "italic", () => exec("italic"), active.italic)}
              {tool("Underline", "underline", () => exec("underline"), active.underline)}
              <div className="relative" data-editor-menu>
                {menuButton("color", "Text Color", "color")}
                {menu === "color" ? (
                  <div className={`${panel} grid w-44 grid-cols-4 gap-1 p-2`}>
                    {COLORS.map((color) => (
                      <button
                        key={color.value}
                        type="button"
                        title={color.label}
                        aria-label={color.label}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => exec("foreColor", color.value)}
                        className="h-8 w-8 rounded-md border border-slate-200 hover:scale-105"
                        style={{ background: color.value }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
              {tool("Checkbox", "checkbox", () => list("checklist"), active.checklist)}
              {tool("Bulleted List", "bullets", () => list("bullets"), active.bullets)}
              {tool("Numbered List", "numbers", () => list("numbers"), active.numbers)}
              <div className="relative" data-editor-menu>
                {menuButton("align", "Text Alignment", "align")}
                {menu === "align" ? (
                  <div className={`${panel} w-36`}>
                    {[
                      ["Left", "justifyLeft"],
                      ["Center", "justifyCenter"],
                      ["Right", "justifyRight"],
                    ].map(([label, command]) => (
                      <button
                        key={command}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => exec(command)}
                        className={item}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <Divider />
              {tool("Link", "link", () => setLinkDialog(true))}
              {tool("Add Image", "image", () => imageInput.current?.click())}
              {tool("Add Table", "table", insertTable)}
              <div className="relative" data-editor-menu>
                {menuButton("insert", "Insert", "plus")}
                {menu === "insert" ? (
                  <div className={`${panel} w-44`}>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => exec("insertHorizontalRule")}
                      className={item}
                    >
                      Divider
                    </button>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => exec("insertHTML", '<hr data-page-break="true"><p><br></p>')}
                      className={item}
                    >
                      Page Break
                    </button>
                  </div>
                ) : null}
              </div>
              <Divider />
              {tool("Undo", "undo", () => exec("undo"))}
              {tool("Redo", "redo", () => exec("redo"))}
              <input
                ref={imageInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  void insertImage(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </div>
          ) : null}
        </header>

        {save.status === "conflict" || notice ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-warn-soft)] px-4 py-2 text-sm text-[var(--color-text)] lg:px-8"
          >
            <span>{save.status === "conflict" ? save.message : notice}</span>
            {save.status === "conflict" ? (
              <Button size="sm" variant="subtle" onClick={() => window.location.reload()}>
                Reload
              </Button>
            ) : (
              <button type="button" onClick={() => setNotice("")} className="text-xs font-semibold">
                Dismiss
              </button>
            )}
          </div>
        ) : null}

        <div className="flex-1 bg-[var(--color-bg)] px-3 py-8 sm:px-6">
          <div className="mx-auto max-w-[816px] rounded-sm bg-white px-6 py-12 shadow-[0_1px_3px_rgba(16,23,37,0.12)] sm:px-[12%] sm:py-16">
            <div
              ref={editor}
              className="doc-body min-h-[60svh] outline-none"
              contentEditable={canEdit && save.status !== "conflict"}
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label={savedTitle}
              data-placeholder="Start writing…"
              onInput={changed}
              onClick={onEditorClick}
              onKeyDown={onEditorKeyDown}
              onPaste={onPaste}
              onDrop={(event) => {
                if (event.dataTransfer.files.length) event.preventDefault();
              }}
              onBlur={() => void saveBody()}
            />
          </div>
        </div>
      </div>

      <aside
        className={`relative hidden shrink-0 border-l border-[var(--color-border)] bg-[var(--color-bg)] lg:block ${
          tocOpen ? "w-[320px]" : "w-0"
        }`}
      >
        <button
          type="button"
          onClick={() => setTocOpen(!tocOpen)}
          aria-label={tocOpen ? "Hide table of contents" : "Show table of contents"}
          className="absolute -left-7 top-[124px] z-10 inline-flex h-8 w-7 items-center justify-center rounded-l-md border border-r-0 border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-heading)]"
        >
          {tocOpen ? "»" : "«"}
        </button>
        {tocOpen ? (
          <div className="sticky top-0 p-4">
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold text-[var(--color-heading)]">Table of Contents</h2>
              {headings.length ? (
                <ol className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] px-4">
                  {headings.map((heading) => (
                    <li key={heading.id}>
                      <button
                        type="button"
                        onClick={() => scrollToHeading(heading.id)}
                        className="w-full truncate py-4 text-left text-sm text-[var(--color-text)] hover:text-[var(--color-brand)]"
                      >
                        {heading.text}
                      </button>
                    </li>
                  ))}
                </ol>
              ) : null}
              <p className="mt-3 text-center text-xs text-[var(--color-muted)]">
                Auto-generated from H1 headings in your document.
              </p>
            </Card>
          </div>
        ) : null}
      </aside>

      {linkDialog ? <LinkDialog onClose={() => setLinkDialog(false)} onSave={addLink} /> : null}
      {confirmDelete ? (
        <Overlay title="Delete Document" onClose={() => (deleting ? null : setConfirmDelete(false))}>
          <p className="text-sm text-[var(--color-text)]">
            Delete <span className="font-semibold">{savedTitle}</span>? This can’t be undone.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={deleting} onClick={() => void removeDocument()}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </Overlay>
      ) : null}
      {mounted ? createPortal(<div ref={printRoot} className="doc-print-root doc-body" />, document.body) : null}
    </div>
  );
}

function closest(node: Node, selector: string): Element | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest(selector) ?? null;
}

function SaveStatus({ state }: { state: SaveState }) {
  if (state.status === "saving") {
    return <span className="text-xs text-[var(--color-muted)]">Saving…</span>;
  }
  if (state.status === "error") {
    return <span className="text-xs text-[var(--color-bad)]">Not saved · retrying</span>;
  }
  if (state.status === "conflict") {
    return <span className="text-xs text-[var(--color-bad)]">Not saved</span>;
  }
  return (
    <span className="hidden items-center gap-1.5 text-xs text-[var(--color-muted)] sm:inline-flex">
      Last updated {fmtUpdated(state.at)}
      <Icon name="cloud" className="h-4 w-4 text-[var(--color-good)]" />
    </span>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-[var(--color-border)]" />;
}

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <Card className="w-full max-w-md p-5">
        <div role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
          <h3 className="mb-4 text-lg font-semibold text-[var(--color-heading)]">{title}</h3>
          {children}
        </div>
      </Card>
    </div>
  );
}

function LinkDialog({ onClose, onSave }: { onClose: () => void; onSave: (url: string) => void }) {
  const [url, setUrl] = useState("");
  return (
    <Overlay title="Add Link" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (url.trim()) onSave(url.trim());
        }}
      >
        <Input
          autoFocus
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://"
          aria-label="Link address"
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!url.trim()}>
            Add Link
          </Button>
        </div>
      </form>
    </Overlay>
  );
}

type IconName =
  | "bold" | "italic" | "underline" | "color" | "checkbox" | "bullets" | "numbers" | "align"
  | "link" | "image" | "table" | "plus" | "undo" | "redo" | "chevron" | "pencil" | "cloud";

const ICONS: Record<IconName, React.ReactNode> = {
  bold: <path d="M6 4h5a3 3 0 0 1 0 6H6zM6 10h6a3 3 0 0 1 0 6H6z" />,
  italic: <path d="M12 4H8.5M11.5 16H8M11 4 9 16" />,
  underline: <path d="M6 4v5a4 4 0 0 0 8 0V4M5 17h10" />,
  color: (
    <>
      <path d="M10 3a7 7 0 1 0 0 14c1 0 1.5-.7 1.5-1.5 0-1.2-1-1.5-1-2.5 0-.8.7-1.5 1.5-1.5H14a3 3 0 0 0 3-3C17 5.5 13.9 3 10 3Z" />
      <circle cx="6.5" cy="9" r=".8" />
      <circle cx="9" cy="6.3" r=".8" />
      <circle cx="12.5" cy="6.8" r=".8" />
    </>
  ),
  checkbox: (
    <>
      <circle cx="10" cy="10" r="7" />
      <path d="m7 10 2 2 4-4" />
    </>
  ),
  bullets: <path d="M8 5.5h8M8 10h8M8 14.5h8M4 5.5h.01M4 10h.01M4 14.5h.01" />,
  numbers: <path d="M8.5 5.5H16M8.5 10H16M8.5 14.5H16M3.5 4.5l1-.5v3.5M3.5 12.5a1 1 0 0 1 2 0c0 1-2 1.5-2 2.5h2" />,
  align: <path d="M4 5h12M4 8.5h8M4 12h12M4 15.5h8" />,
  link: <path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0L5 10.8a3 3 0 0 0 4.2 4.2l.8-.8" />,
  image: (
    <>
      <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" />
      <path d="m3.5 13 3.5-3.5 3 3 2-2 4.5 4.5" />
      <circle cx="12.5" cy="8" r="1" />
    </>
  ),
  table: (
    <>
      <rect x="3.5" y="4.5" width="13" height="11" rx="1.5" />
      <path d="M3.5 8.5h13M3.5 12h13M8 8.5v7M12.5 8.5v7" />
    </>
  ),
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  undo: <path d="M7.5 6 4.5 9l3 3M5 9h7a3.5 3.5 0 0 1 0 7H9" />,
  redo: <path d="M12.5 6l3 3-3 3M15 9H8a3.5 3.5 0 0 0 0 7h3" />,
  chevron: <path d="m6 8 4 4 4-4" />,
  pencil: <path d="M12.5 4.5 15.5 7.5 7.5 15.5H4.5v-3zM11 6l3 3" />,
  cloud: (
    <>
      <path d="M6 15.5a3.5 3.5 0 0 1-.4-7A4.5 4.5 0 0 1 14.3 7a3.8 3.8 0 0 1-.3 8.5Z" />
      <path d="m8 11.3 1.5 1.5 3-3" />
    </>
  ),
};

function Icon({ name, className = "h-4 w-4" }: { name: IconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {ICONS[name]}
    </svg>
  );
}

const EDITOR_CSS = `
.doc-body { position: relative; color: #101725; font-size: 15px; line-height: 1.6; word-wrap: break-word; }
.doc-body[data-empty="true"]::before { content: attr(data-placeholder); color: #9aa3b2; position: absolute; pointer-events: none; }
.doc-body h1 { font-size: 26px; line-height: 1.25; font-weight: 700; margin: 20px 0 8px; }
.doc-body h2 { font-size: 21px; line-height: 1.3; font-weight: 700; margin: 16px 0 6px; }
.doc-body h3 { font-size: 17px; line-height: 1.35; font-weight: 600; margin: 14px 0 4px; }
.doc-body p, .doc-body div { margin: 4px 0; }
.doc-body ul { list-style: disc; padding-left: 24px; margin: 6px 0; }
.doc-body ol { list-style: decimal; padding-left: 24px; margin: 6px 0; }
.doc-body li { margin: 4px 0; }
.doc-body ul[data-checklist] { list-style: none; padding-left: 2px; }
.doc-body ul[data-checklist] > li { position: relative; padding-left: 28px; }
.doc-body ul[data-checklist] > li::before { content: ""; position: absolute; left: 0; top: 4px; width: 17px; height: 17px; border: 1.5px solid #9aa3b2; border-radius: 4px; background: #fff; cursor: pointer; }
.doc-body ul[data-checklist] > li[data-checked="true"]::before { border-color: #2f6bff; background: #2f6bff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='white' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m5 10.5 3.2 3L15 6.5'/%3E%3C/svg%3E") center / 13px no-repeat; }
.doc-body a { color: #2456d8; text-decoration: underline; }
.doc-body strong, .doc-body b { font-weight: 700; }
.doc-body em, .doc-body i { font-style: italic; }
.doc-body u { text-decoration: underline; }
.doc-body hr { border: 0; border-top: 1px solid #e3e8f0; margin: 12px 0; }
.doc-body hr[data-page-break] { border-top: 2px dashed #c4cbd8; margin: 28px 0; }
.doc-body table { border-collapse: collapse; width: 100%; margin: 10px 0; table-layout: fixed; }
.doc-body th, .doc-body td { border: 1px solid #cfd6e2; padding: 6px 8px; vertical-align: top; }
.doc-body th { background: #f4f6fa; font-weight: 600; text-align: left; }
.doc-body img { max-width: 100%; height: auto; border-radius: 4px; margin: 8px 0; }
.doc-body blockquote { border-left: 3px solid #e3e8f0; padding-left: 12px; color: #4a5568; }
.doc-print-root { display: none; }
@media print {
  @page { margin: 18mm 16mm; }
  body > *:not(.doc-print-root) { display: none !important; }
  .doc-print-root { display: block !important; }
  .doc-print-root hr[data-page-break] { break-after: page; border: 0; margin: 0; }
  .doc-print-root ul[data-checklist] > li::before { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;
