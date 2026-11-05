// A job description's formatting, as the crew apps save it (ServiceFlowCore's
// RichText): `**bold**`, `_italic_`, `[text](https://…)`, `- item` and
// `1. item` lines. Plain descriptions read as they always did.

export type DescriptionRun = { text: string; bold: boolean; italic: boolean; link: string | null };
export type DescriptionLine = { kind: "text" | "bullet" | "numbered"; number: number; runs: DescriptionRun[] };

const ESCAPABLE = new Set(["\\", "*", "_", "[", "]"]);

export function descriptionLines(markdown: string): DescriptionLine[] {
  return markdown.replace(/\r\n/g, "\n").split("\n").map(readLine);
}

function readLine(raw: string): DescriptionLine {
  // A leading backslash keeps a line that only looks like a list item plain.
  if (raw.startsWith("\\") && listItem(raw.slice(1))) return { kind: "text", number: 0, runs: inline(raw.slice(1)) };
  const item = listItem(raw);
  return item ? { ...item, runs: inline(item.rest) } : { kind: "text", number: 0, runs: inline(raw) };
}

function listItem(raw: string): { kind: "bullet" | "numbered"; number: number; rest: string } | null {
  const trimmed = raw.replace(/^ +/, "");
  const bullet = /^[-•*] /.exec(trimmed);
  if (bullet) return { kind: "bullet", number: 0, rest: trimmed.slice(2) };
  const numbered = /^(\d{1,3})[.)] /.exec(trimmed);
  if (numbered) return { kind: "numbered", number: Number(numbered[1]), rest: trimmed.slice(numbered[0].length) };
  return null;
}

type Token = { char: string; escaped: boolean };
const isMarker = (token: Token | undefined, value: string) => !!token && !token.escaped && token.char === value;
const isSpace = (token: Token | undefined) => !!token && /\s/.test(token.char);

function inline(text: string): DescriptionRun[] {
  const chars = Array.from(text);
  const tokens: Token[] = [];
  for (let index = 0; index < chars.length; index++) {
    if (chars[index] === "\\" && ESCAPABLE.has(chars[index + 1] ?? "")) {
      tokens.push({ char: chars[index + 1], escaped: true });
      index++;
    } else {
      tokens.push({ char: chars[index], escaped: false });
    }
  }
  return merged(parse(tokens, 0, tokens.length, false, false));
}

function parse(tokens: Token[], start: number, end: number, bold: boolean, italic: boolean): DescriptionRun[] {
  const runs: DescriptionRun[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) runs.push({ text: buffer, bold, italic, link: null });
    buffer = "";
  };
  let index = start;
  while (index < end) {
    const pair = isMarker(tokens[index], "*") && index + 1 < end && isMarker(tokens[index + 1], "*") ? closing(tokens, index + 2, end, 2) : null;
    const single = pair === null && isMarker(tokens[index], "_") ? closing(tokens, index + 1, end, 1) : null;
    const link = pair === null && single === null && isMarker(tokens[index], "[") ? linkBounds(tokens, index, end) : null;
    if (pair !== null) {
      flush();
      runs.push(...parse(tokens, index + 2, pair, true, italic));
      index = pair + 2;
    } else if (single !== null) {
      flush();
      runs.push(...parse(tokens, index + 1, single, bold, true));
      index = single + 1;
    } else if (link) {
      flush();
      const label = tokens.slice(index + 1, link.labelEnd).map((token) => token.char).join("");
      runs.push({ text: label, bold, italic, link: link.address });
      index = link.urlEnd + 1;
    } else {
      buffer += tokens[index].char;
      index++;
    }
  }
  flush();
  return runs;
}

/** The closing `**` (width 2) or `_` (width 1) after `from`, around text that doesn't start or end with a space. */
function closing(tokens: Token[], from: number, end: number, width: 1 | 2): number | null {
  if (from >= end || isSpace(tokens[from])) return null;
  const marker = width === 2 ? "*" : "_";
  for (let index = from + 1; index + width <= end; index++) {
    if (isMarker(tokens[index], marker) && (width === 1 || isMarker(tokens[index + 1], "*")) && !isSpace(tokens[index - 1])) return index;
  }
  return null;
}

function linkBounds(tokens: Token[], from: number, end: number) {
  let labelEnd = -1;
  for (let index = from + 1; index < end; index++) {
    if (isMarker(tokens[index], "]")) {
      labelEnd = index;
      break;
    }
  }
  if (labelEnd <= from + 1 || labelEnd + 1 >= end || tokens[labelEnd + 1].char !== "(") return null;
  let urlEnd = -1;
  for (let index = labelEnd + 2; index < end; index++) {
    if (tokens[index].char === ")") {
      urlEnd = index;
      break;
    }
  }
  if (urlEnd < 0) return null;
  const address = tokens.slice(labelEnd + 2, urlEnd).map((token) => token.char).join("");
  return isLinkAddress(address) ? { labelEnd, urlEnd, address } : null;
}

export function isLinkAddress(address: string): boolean {
  const lower = address.toLowerCase();
  return ["http://", "https://", "mailto:", "tel:"].some((scheme) => lower.startsWith(scheme) && lower.length > scheme.length) && !/\s/.test(address);
}

function merged(runs: DescriptionRun[]): DescriptionRun[] {
  const output: DescriptionRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = output[output.length - 1];
    if (last && last.bold === run.bold && last.italic === run.italic && last.link === run.link) last.text += run.text;
    else output.push({ ...run });
  }
  return output;
}
