/**
 * Allowlist sanitizer for project document pages. Runs on the server before
 * saving and in the browser before rendering, so stored HTML can only contain
 * the formatting the editor toolbar produces.
 */

const ALLOWED_TAGS = new Set([
  "p", "h1", "h2", "h3", "strong", "b", "em", "i", "u", "s", "span", "a",
  "ul", "ol", "li", "br", "hr", "img", "table", "thead", "tbody", "tr", "th",
  "td", "div", "blockquote",
]);
const VOID_TAGS = new Set(["br", "hr", "img"]);
/** Dropped together with everything inside them. */
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "object", "embed", "template", "svg", "math",
  "noscript", "textarea", "select", "title", "head", "frame", "frameset",
  "noembed", "xmp", "plaintext", "button", "form",
]);

const PAGE_IMAGE_SRC =
  /^\/api\/jobs\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}\/images\/[0-9a-f-]{36}$/i;
const COLOR_VALUE = /^(#[0-9a-f]{3,8}|rgba?\(\s*[\d.]+%?\s*(,\s*[\d.]+%?\s*){2,3}\))$/i;
const ALIGN_VALUE = /^(left|center|right|justify)$/i;
/** Inline styles the browser writes for toolbar commands (styleWithCSS). */
const STYLE_VALUES: Record<string, RegExp> = {
  color: COLOR_VALUE,
  "text-align": ALIGN_VALUE,
  "font-weight": /^(bold|bolder|normal|[1-9]00)$/i,
  "font-style": /^(italic|normal)$/i,
  "text-decoration": /^(none|underline|line-through)( (underline|line-through))?$/i,
  "text-decoration-line": /^(none|underline|line-through)( (underline|line-through))?$/i,
};

const TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>?|<\?[^>]*>?|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|</g;
const ATTRIBUTE =
  /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|colon|tab|newline);?/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16) || 0);
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10) || 0);
    return (
      { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", colon: ":", tab: "\t", newline: "\n" } as Record<string, string>
    )[lower] ?? "";
  });
}

function safeHref(raw: string): string | null {
  const value = decodeEntities(raw).replace(/[\u0000- \u007f-\u009f]/g, "");
  return /^(https?:\/\/|mailto:)/i.test(value) ? value : null;
}

function safeStyle(raw: string): string | null {
  const kept: string[] = [];
  for (const declaration of decodeEntities(raw).split(";")) {
    const index = declaration.indexOf(":");
    if (index < 0) continue;
    const property = declaration.slice(0, index).trim().toLowerCase();
    const value = declaration.slice(index + 1).trim();
    const allowed = STYLE_VALUES[property];
    if (allowed?.test(value)) kept.push(`${property}: ${property === "color" ? value : value.toLowerCase()}`);
  }
  return kept.length ? kept.join("; ") : null;
}

function sanitizeAttributes(tag: string, raw: string): string {
  const out: string[] = [];
  for (const match of raw.matchAll(ATTRIBUTE)) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (name === "style") {
      const style = safeStyle(value);
      if (style) out.push(`style="${escapeAttribute(style)}"`);
    } else if (tag === "a" && name === "href") {
      const href = safeHref(value);
      if (href) out.push(`href="${escapeAttribute(href)}"`, 'target="_blank"', 'rel="noopener noreferrer"');
    } else if (tag === "img" && name === "src") {
      const src = decodeEntities(value);
      if (PAGE_IMAGE_SRC.test(src)) out.push(`src="${escapeAttribute(src)}"`);
    } else if (tag === "img" && name === "alt") {
      out.push(`alt="${escapeAttribute(decodeEntities(value).slice(0, 200))}"`);
    } else if ((tag === "td" || tag === "th") && (name === "colspan" || name === "rowspan")) {
      const span = Math.min(20, Math.max(1, parseInt(value, 10) || 1));
      out.push(`${name}="${span}"`);
    } else if (tag === "ul" && name === "data-checklist") {
      out.push('data-checklist="true"');
    } else if (tag === "li" && name === "data-checked") {
      out.push(`data-checked="${value === "true" ? "true" : "false"}"`);
    } else if (tag === "hr" && name === "data-page-break") {
      out.push('data-page-break="true"');
    }
  }
  if (tag === "img" && !out.some((attribute) => attribute.startsWith("src="))) return "\u0000";
  return out.length ? ` ${out.join(" ")}` : "";
}

export function sanitizeRichText(html: string): string {
  let result = "";
  let last = 0;
  let dropping: string | null = null;
  let dropDepth = 0;
  for (const match of html.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (!dropping) result += html.slice(last, index).replace(/>/g, "&gt;");
    last = index + match[0].length;
    const tagName = match[2]?.toLowerCase();
    if (!tagName) {
      // A bare "<" that does not start a tag; comments and doctypes are dropped.
      if (!dropping && match[0] === "<") result += "&lt;";
      continue;
    }
    const closing = match[1] === "/";
    if (dropping) {
      if (tagName === dropping) dropDepth += closing ? -1 : 1;
      if (dropDepth === 0) dropping = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(tagName)) {
      if (!closing && !/\/\s*$/.test(match[3] ?? "")) {
        dropping = tagName;
        dropDepth = 1;
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(tagName)) continue;
    if (closing) {
      if (!VOID_TAGS.has(tagName)) result += `</${tagName}>`;
      continue;
    }
    const attributes = sanitizeAttributes(tagName, match[3] ?? "");
    if (attributes === "\u0000") continue;
    result += `<${tagName}${attributes}>`;
  }
  if (!dropping) result += html.slice(last).replace(/>/g, "&gt;");
  return result;
}

/** Plain text of a page, for search and emptiness checks. */
export function richTextToPlain(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
