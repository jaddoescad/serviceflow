import * as React from "react";

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ borderRadius: "var(--radius)", boxShadow: "var(--shadow)" }}
      className={cn(
        "border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  right,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
      <div>
        <h3 className="font-display text-sm font-semibold text-[var(--color-heading)]">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-[var(--color-muted)]">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

type BadgeTone = "neutral" | "good" | "warn" | "bad" | "brand";
const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-[var(--color-chip-muted)] text-[var(--color-muted)]",
  good: "bg-[var(--color-good-soft)] text-[var(--color-good)]",
  warn: "bg-[var(--color-warn-soft)] text-[var(--color-warn)]",
  bad: "bg-[var(--color-bad-soft)] text-[var(--color-bad)]",
  brand: "bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]",
};

const dotTones: Record<BadgeTone, string> = {
  neutral: "var(--color-muted)",
  good: "var(--color-good)",
  warn: "var(--color-warn)",
  bad: "var(--color-bad)",
  brand: "var(--color-brand-strong)",
};

/** Quiet status indicator: small colored dot + plain text. Preferred over
 * Badge wherever several statuses sit near each other. */
export function StatusText({
  tone = "neutral",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text)]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: dotTones[tone] }}
      />
      {children}
    </span>
  );
}

/** One figure inside a StatGrid band. */
export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneColor = {
    neutral: "text-[var(--color-heading)]",
    good: "text-[var(--color-good)]",
    warn: "text-[var(--color-warn)]",
    bad: "text-[var(--color-bad)]",
  }[tone];
  return (
    <div className="bg-[var(--color-surface)] px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-display text-lg font-semibold tabular-nums",
          toneColor,
        )}
      >
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

/** Hairline-divided band of Stats — one container instead of a card farm. */
export function StatGrid({
  columns = 4,
  children,
  className,
}: {
  columns?: 2 | 3 | 4;
  children: React.ReactNode;
  className?: string;
}) {
  const cols = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-2 xl:grid-cols-4",
  }[columns];
  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden bg-[var(--color-border)]",
        cols,
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "subtle";
  size?: "sm" | "md";
};

const buttonVariants = {
  primary: "bg-[var(--color-brand)] text-[var(--color-brand-ink)] hover:brightness-95",
  subtle: "bg-[var(--color-surface-2)] text-[var(--color-text)] hover:brightness-95 border border-[var(--color-border)]",
  ghost: "text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-2)]",
  danger: "bg-[var(--color-bad-soft)] text-[var(--color-bad)] hover:brightness-95",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-brand)]",
        props.className,
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-brand)]",
        props.className,
      )}
    />
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{label}</span>
      {children}
    </label>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 py-10 text-center text-sm text-[var(--color-muted)]">{children}</div>
  );
}

export function Avatar({ label }: { label: string }) {
  return (
    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-soft)] text-[11px] font-semibold text-[var(--color-brand-strong)]">
      {label}
    </span>
  );
}
