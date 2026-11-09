import { richTextToPlain, sanitizeRichText } from "./rich-text";

// A line item's description is rich text: paragraphs, small headings, bullet
// and numbered lists, bold, italic, underline and links, stored as HTML that
// holds nothing else. Descriptions written before this (and ones imported as
// plain text) are read for their shape and shown the same way.

export const ITEM_DESCRIPTION_MAX = 20000;

/** The tags a description keeps, by the tag each is stored as. */
const TAGS: Record<string, string> = {
  p: "p",
  div: "p",
  blockquote: "p",
  h1: "h3",
  h2: "h3",
  h3: "h3",
  strong: "strong",
  b: "strong",
  em: "em",
  i: "em",
  u: "u",
  ul: "ul",
  ol: "ol",
  li: "li",
  br: "br",
  a: "a",
};

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Whether a description is stored as rich text (else it is plain text from before). */
export function isRichDescription(text: string): boolean {
  return /^\s*<(p|h3|ul|ol)[\s>]/i.test(text);
}

/**
 * Plain text set as rich text, read for its shape: a short line ending in a
 * colon heads a list and the lines under it are its points; "- " lines are
 * points anywhere; blank lines are only spacing. A line that starts in lower
 * case continues the one before it (imported text is often wrapped
 * mid-sentence).
 */
export function plainDescriptionToRich(text: string): string {
  const lines: string[] = [];
  let afterBlank = true;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      afterBlank = true;
      continue;
    }
    if (!afterBlank && lines.length && /^[a-z(]/.test(line)) lines[lines.length - 1] += ` ${line}`;
    else lines.push(line);
    afterBlank = false;
  }
  let html = "";
  let listed = false;
  let inList = false;
  const closeList = () => {
    if (inList) html += "</ul>";
    inList = false;
  };
  for (const line of lines) {
    if (line.endsWith(":") && line.length <= 60) {
      closeList();
      html += `<h3>${escapeHtml(line.slice(0, -1))}</h3>`;
      listed = true;
      continue;
    }
    const marked = line.match(/^[-•*]\s+(.*)$/);
    if (marked || listed) {
      if (!inList) html += "<ul>";
      inList = true;
      html += `<li>${escapeHtml(marked ? marked[1] : line)}</li>`;
    } else {
      closeList();
      html += `<p>${escapeHtml(line)}</p>`;
    }
  }
  closeList();
  return html;
}

/**
 * Rich text cut down to what a description may hold: its few tags, links
 * that open safely, and no styles or other attributes. Empty when there is
 * no text in it.
 */
export function cleanItemDescription(html: string): string {
  const clean = sanitizeRichText(html)
    .replace(/<(\/?)([a-z][a-z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi, (_, slash: string, name: string, attributes: string) => {
      const tag = TAGS[name.toLowerCase()];
      if (!tag) return "";
      if (slash) return tag === "br" ? "" : `</${tag}>`;
      if (tag !== "a") return `<${tag}>`;
      const href = attributes.match(/\shref="([^"]*)"/i)?.[1];
      return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">` : "<a>";
    })
    // What an emptied editor leaves behind.
    .replace(/<(p|h3|li)>(?:\s|<br>|&nbsp;)*<\/\1>/gi, "")
    .replace(/<(ul|ol)>\s*<\/\1>/gi, "")
    .trim();
  return richTextToPlain(clean) ? clean : "";
}

/** A description as HTML that is safe to show, whichever way it was stored. */
export function itemDescriptionHtml(text: string): string {
  if (!text.trim()) return "";
  return isRichDescription(text) ? cleanItemDescription(text) : plainDescriptionToRich(text);
}

/** A description's words alone, for places that can't show formatting. */
export function itemDescriptionPlain(text: string): string {
  return richTextToPlain(itemDescriptionHtml(text).replace(/<\/(p|h3|li)>/gi, " "));
}

/** Line items as saved: each description cleaned (rich) or left as the plain text it was. */
export function cleanItemDescriptions<T extends { description: string }>(items: T[]): T[] {
  return items.map((item) =>
    isRichDescription(item.description) ? { ...item, description: cleanItemDescription(item.description) } : item,
  );
}
