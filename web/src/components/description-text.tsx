import type { ReactNode } from "react";
import { descriptionLines, type DescriptionRun } from "@/lib/description-markdown";

/** A job description as the crew apps format it: bold, italic, links and list lines. */
export function DescriptionText({ text }: { text: string }) {
  return (
    <div className="space-y-0.5">
      {descriptionLines(text).map((line, index) =>
        line.kind === "text" ? (
          line.runs.length ? (
            <p key={index} className="whitespace-pre-wrap break-words">
              {line.runs.map(renderRun)}
            </p>
          ) : (
            <div key={index} className="h-2" />
          )
        ) : (
          <div key={index} className="flex gap-1.5">
            <span className="shrink-0 tabular-nums">{line.kind === "bullet" ? "•" : `${line.number}.`}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words">{line.runs.map(renderRun)}</span>
          </div>
        ),
      )}
    </div>
  );
}

function renderRun(run: DescriptionRun, index: number) {
  let content: ReactNode = run.text;
  if (run.italic) content = <em>{content}</em>;
  if (run.bold) content = <strong className="font-semibold">{content}</strong>;
  if (run.link) {
    content = (
      <a
        href={run.link}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--color-brand-strong)] underline underline-offset-2"
      >
        {content}
      </a>
    );
  }
  return <span key={index}>{content}</span>;
}
