"use client";

import { useEffect, useRef, useState } from "react";
import { ITEM_DESCRIPTION_MAX, cleanItemDescription, itemDescriptionHtml } from "@/lib/item-description";
import { cn } from "./ui";

/** A line item's description as written: headings, lists, bold, italic, underline and links. */
export function ItemDescription({ text, className }: { text: string; className?: string }) {
  return <div className={cn("item-description", className)} dangerouslySetInnerHTML={{ __html: itemDescriptionHtml(text) }} />;
}

type Format = "bold" | "italic" | "underline" | "heading" | "bullets" | "numbers";

const FORMATS: { key: Format; label: string; face: React.ReactNode }[] = [
  { key: "bold", label: "Bold", face: <span className="font-bold">B</span> },
  { key: "italic", label: "Italic", face: <span className="font-serif italic">I</span> },
  { key: "underline", label: "Underline", face: <span className="underline">U</span> },
  { key: "heading", label: "Heading", face: <span className="text-[11px] font-semibold">H</span> },
  {
    key: "bullets",
    label: "Bullet list",
    face: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-3.5 w-3.5">
        <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
      </svg>
    ),
  },
  {
    key: "numbers",
    label: "Numbered list",
    face: (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
        <path d="M10 6h10M10 12h10M10 18h10M4 4.5 5.5 4v4.5M4 15.5c0-1.3 2.5-1.3 2.5 0 0 1-2.5 1.7-2.5 3h2.5" />
      </svg>
    ),
  },
];

/** Which formats apply where the cursor is. */
function activeFormats(): Set<Format> {
  const active = new Set<Format>();
  const state = (command: string) => {
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  };
  if (state("bold")) active.add("bold");
  if (state("italic")) active.add("italic");
  if (state("underline")) active.add("underline");
  if (state("insertUnorderedList")) active.add("bullets");
  if (state("insertOrderedList")) active.add("numbers");
  if (/^h3$/i.test(String(document.queryCommandValue("formatBlock")))) active.add("heading");
  return active;
}

/**
 * A description you format as you write it. What you see is what the
 * customer gets; a small toolbar shows while the cursor is in it.
 */
export function ItemDescriptionEditor({
  value,
  onChange,
  label = "Description",
  placeholder = "Add a description",
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  className?: string;
}) {
  const field = useRef<HTMLDivElement>(null);
  /** What the field last reported, so a parent echoing it back doesn't reset the cursor. */
  const reported = useRef(value);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState<Set<Format>>(() => new Set());
  const [empty, setEmpty] = useState(!itemDescriptionHtml(value));
  const [tooLong, setTooLong] = useState(false);

  // Shows the saved description, and any change that came from outside (undo, a template).
  useEffect(() => {
    const node = field.current;
    if (!node || (value === reported.current && node.dataset.ready)) return;
    node.dataset.ready = "true";
    reported.current = value;
    node.innerHTML = itemDescriptionHtml(value);
    setEmpty(!node.textContent?.trim());
  }, [value]);

  // The toolbar's pressed buttons follow the cursor.
  useEffect(() => {
    if (!focused) return;
    const follow = () => setActive(activeFormats());
    document.addEventListener("selectionchange", follow);
    return () => document.removeEventListener("selectionchange", follow);
  }, [focused]);

  function report() {
    const node = field.current;
    if (!node) return;
    const html = cleanItemDescription(node.innerHTML);
    setEmpty(!html);
    setTooLong(html.length > ITEM_DESCRIPTION_MAX);
    reported.current = html;
    onChange(html);
  }

  function apply(format: Format) {
    field.current?.focus();
    if (format === "heading") {
      document.execCommand("formatBlock", false, active.has("heading") ? "p" : "h3");
    } else {
      document.execCommand(
        format === "bullets" ? "insertUnorderedList" : format === "numbers" ? "insertOrderedList" : format,
      );
    }
    setActive(activeFormats());
    report();
  }

  return (
    <div
      className="relative"
      onFocus={() => {
        // Paragraphs, not divs, and <b>/<i>/<u>, not styled spans.
        document.execCommand("defaultParagraphSeparator", false, "p");
        document.execCommand("styleWithCSS", false, "false");
        setFocused(true);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div
        ref={field}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        contentEditable
        suppressContentEditableWarning
        data-empty={empty}
        data-placeholder={placeholder}
        onInput={report}
        onPaste={(event) => {
          event.preventDefault();
          const html = event.clipboardData.getData("text/html");
          const text = event.clipboardData.getData("text/plain");
          document.execCommand(
            "insertHTML",
            false,
            html
              ? cleanItemDescription(html.replace(/^[\s\S]*<body[^>]*>|<\/body>[\s\S]*$/gi, ""))
              : text
                  .split(/\r?\n/)
                  .map((line) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
                  .join("<br>"),
          );
          report();
        }}
        className={cn(
          "item-description item-description-field min-h-7 max-h-56 overflow-y-auto overscroll-containdata-[empty=true]:focus:min-h-20 rounded-[var(--radius-control)] border border-transparent px-2 py-1 outline-none hover:border-[var(--color-border-strong)] focus:border-[var(--color-brand)] focus:bg-[var(--color-surface)] focus:shadow-[var(--focus-ring)]",
          className,
        )}
      />
      {focused ? (
        <div
          role="toolbar"
          aria-label="Formatting"
          className="mt-1 inline-flex items-center gap-0.5 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)] p-0.5"
        >
          {FORMATS.map((format) => (
            <button
              key={format.key}
              type="button"
              aria-label={format.label}
              aria-pressed={active.has(format.key)}
              title={format.label}
              // Keeps the cursor (and the selection) in the description.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apply(format.key)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[13px] outline-none hover:bg-[var(--color-hover)] focus-visible:shadow-[var(--focus-ring)]",
                active.has(format.key)
                  ? "bg-[var(--color-selected)] text-[var(--color-heading)]"
                  : "text-[var(--color-muted)]",
              )}
            >
              {format.face}
            </button>
          ))}
        </div>
      ) : null}
      {tooLong ? (
        <p role="alert" className="mt-1 px-2 text-xs text-[var(--color-bad)]">
          This description is too long to save. Shorten it a little.
        </p>
      ) : null}
    </div>
  );
}
