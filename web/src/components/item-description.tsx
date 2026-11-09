import { cn } from "./ui";

type Block = { kind: "label" | "bullet" | "text"; text: string };

/**
 * A line item's description, read for its shape: a short line ending in a
 * colon heads a list, the lines under it are its points, and blank lines are
 * only spacing. A line that starts in lower case continues the one before it
 * (imported text is often wrapped mid-sentence).
 */
export function descriptionBlocks(text: string): Block[] {
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
  let listed = false;
  return lines.map((line) => {
    if (line.endsWith(":") && line.length <= 60) {
      listed = true;
      return { kind: "label", text: line.slice(0, -1) };
    }
    const marked = line.match(/^[-•*]\s+(.*)$/);
    if (marked) return { kind: "bullet", text: marked[1] };
    return { kind: listed ? "bullet" : "text", text: line };
  });
}

/** A line item's description set as small headings and tidy lists. */
export function ItemDescription({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("text-[13px] leading-5 text-[var(--color-muted)]", className)}>
      {descriptionBlocks(text).map((block, index) =>
        block.kind === "label" ? (
          <div
            key={index}
            className={cn("text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--color-text)]", index > 0 && "mt-2")}
          >
            {block.text}
          </div>
        ) : block.kind === "bullet" ? (
          <div key={index} className="flex gap-2">
            <span aria-hidden="true" className="shrink-0 text-[var(--color-faint)]">
              •
            </span>
            <span className="min-w-0 [overflow-wrap:anywhere]">{block.text}</span>
          </div>
        ) : (
          <p key={index} className={cn("[overflow-wrap:anywhere]", index > 0 && "mt-1")}>
            {block.text}
          </p>
        ),
      )}
    </div>
  );
}
