import type { ReactNode } from "react";

/** One settings card: heading and description, content, optional footer bar. */
export function SettingsSection({
  id,
  title,
  description,
  footer,
  children,
}: {
  id: string;
  title: string;
  description: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-6 overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <div className="px-5 pt-4">
        <h2 id={`${id}-title`} className="text-sm font-semibold text-[var(--color-heading)]">
          {title}
        </h2>
        <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">{description}</p>
      </div>
      <div className="px-5 pb-5 pt-4">{children}</div>
      {footer ? (
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] px-5 py-2.5 text-[13px] text-[var(--color-muted)]">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

/** Label/value pair for read-only details. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-[var(--color-muted)]">{label}</div>
      <div className="mt-0.5 text-[13px] text-[var(--color-text)]">{children}</div>
    </div>
  );
}

export function SaveStatus({
  error,
  message,
  hint,
}: {
  error?: string;
  message?: string;
  hint?: string;
}) {
  if (error) {
    return (
      <span role="alert" className="text-[var(--color-bad)]">
        {error}
      </span>
    );
  }
  if (message) {
    return (
      <span role="status" className="text-[var(--color-good)]">
        {message}
      </span>
    );
  }
  return hint ? <span>{hint}</span> : null;
}
