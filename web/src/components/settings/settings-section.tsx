import type { ReactNode } from "react";

export const TRADES: Array<{ value: string; label: string }> = [
  { value: "painting", label: "Painting" },
  { value: "plumbing", label: "Plumbing" },
  { value: "electrical", label: "Electrical" },
  { value: "hvac", label: "HVAC" },
  { value: "cleaning", label: "Cleaning" },
  { value: "landscaping", label: "Landscaping" },
  { value: "general_contracting", label: "General contracting" },
  { value: "other", label: "Other" },
];

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  crew: "Crew",
};

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
      className="scroll-mt-6 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <div className="px-6 pt-6">
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight text-[var(--color-heading)]">
          {title}
        </h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{description}</p>
      </div>
      <div className="px-6 pb-6 pt-5">{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-6 py-3 text-sm text-[var(--color-muted)]">
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
      <div className="text-xs font-medium text-[var(--color-muted)]">{label}</div>
      <div className="mt-1 text-sm text-[var(--color-text)]">{children}</div>
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
