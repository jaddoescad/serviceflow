import * as React from "react";
import { twMerge } from "tailwind-merge";

/** Joins class names; when two Tailwind classes set the same property, the
 * later one wins, so a className passed to a primitive overrides its default. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return twMerge(parts.filter(Boolean).join(" "));
}

/** Flat white panel with a hairline border. Never nest one inside another. */
export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface)]",
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
    <div className="flex min-h-11 items-center justify-between gap-4 border-b border-[var(--color-border)] px-4 py-2.5">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-[var(--color-heading)]">{title}</h3>
        {subtitle ? <p className="mt-0.5 text-xs text-[var(--color-muted)]">{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

/** Status tint names; each maps to --tag-<tone>-bg / --tag-<tone>-text. */
export type TagTone = "gray" | "blue" | "green" | "yellow" | "orange" | "red" | "purple";

const tagTones: Record<TagTone, string> = {
  gray: "bg-[var(--tag-gray-bg)] text-[var(--tag-gray-text)]",
  blue: "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-text)]",
  green: "bg-[var(--tag-green-bg)] text-[var(--tag-green-text)]",
  yellow: "bg-[var(--tag-yellow-bg)] text-[var(--tag-yellow-text)]",
  orange: "bg-[var(--tag-orange-bg)] text-[var(--tag-orange-text)]",
  red: "bg-[var(--tag-red-bg)] text-[var(--tag-red-text)]",
  purple: "bg-[var(--tag-purple-bg)] text-[var(--tag-purple-text)]",
};

/** Text colour of each tint, for status dots and stage dots. */
export const TAG_DOT: Record<TagTone, string> = {
  gray: "var(--tag-gray-text)",
  blue: "var(--tag-blue-text)",
  green: "var(--tag-green-text)",
  yellow: "var(--tag-yellow-text)",
  orange: "var(--tag-orange-text)",
  red: "var(--tag-red-text)",
  purple: "var(--tag-purple-text)",
};

/** Small tinted label for statuses, labels and counts. */
export function Tag({
  tone = "gray",
  className,
  children,
}: {
  tone?: TagTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 text-xs font-medium",
        tagTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type BadgeTone = "neutral" | "good" | "warn" | "bad" | "brand";
const badgeTagTones: Record<BadgeTone, TagTone> = {
  neutral: "gray",
  good: "green",
  warn: "yellow",
  bad: "red",
  brand: "blue",
};

/** A small spinning ring for work in progress; takes the text colour. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

/** Status dot (8px) plus plain text. Preferred over a Tag wherever several
 * statuses sit near each other. */
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
        "inline-flex items-center gap-1.5 text-[13px] text-[var(--color-text)]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: TAG_DOT[badgeTagTones[tone]] }}
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
      <div className="text-xs font-medium text-[var(--color-muted)]">{label}</div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums", toneColor)}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-[var(--color-faint)]">{hint}</div> : null}
    </div>
  );
}

/** Hairline-divided band of Stats. `flush` drops the outer frame so the band
 * can run edge to edge under a page bar. */
export function StatGrid({
  columns = 4,
  flush = false,
  children,
  className,
}: {
  columns?: 2 | 3 | 4 | 5;
  flush?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const cols = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-2 xl:grid-cols-4",
    5: "sm:grid-cols-2 xl:grid-cols-5",
  }[columns];
  return (
    <div
      className={cn(
        "grid gap-px overflow-hidden bg-[var(--color-border)]",
        flush
          ? "border-b border-[var(--color-border)]"
          : "rounded-[var(--radius)] border border-[var(--color-border)]",
        cols,
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Status label; a Tag in the matching tint. Takes the older semantic tones
 * (neutral/good/warn/bad/brand) or a TagTone. */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone | TagTone;
  children: React.ReactNode;
}) {
  return <Tag tone={tone in badgeTagTones ? badgeTagTones[tone as BadgeTone] : (tone as TagTone)}>{children}</Tag>;
}

type ButtonVariant = "primary" | "secondary" | "subtle" | "ghost" | "danger";

type ButtonProps = React.ComponentProps<"button"> & {
  /** `subtle` is the older name for `secondary`. */
  variant?: ButtonVariant;
  size?: "sm" | "md";
};

const secondary =
  "border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-heading)] hover:bg-[var(--color-hover)]";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-[var(--color-primary)] text-[var(--color-primary-ink)] hover:bg-[var(--color-primary-hover)]",
  secondary,
  subtle: secondary,
  ghost: "text-[var(--color-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)]",
  danger:
    "border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--tag-red-text)] hover:border-[var(--tag-red-border)] hover:bg-[var(--tag-red-bg)]",
};

/** Button styling for elements that are not a <button>, such as a Link. */
export function buttonClassName({
  variant = "primary",
  size = "md",
  className,
}: Pick<ButtonProps, "variant" | "size" | "className"> = {}): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-control)] font-medium outline-none transition-colors focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]",
    buttonVariants[variant],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return <button className={buttonClassName({ variant, size, className })} {...props} />;
}

const control =
  "rounded-[var(--radius-control)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[13px] text-[var(--color-text)] outline-none transition-[border-color,box-shadow] placeholder:text-[var(--color-faint)] focus:border-[var(--color-brand)] focus:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:bg-[var(--color-surface-2)] disabled:text-[var(--color-muted)]";

export function Input(props: React.ComponentProps<"input">) {
  return <input {...props} className={cn(control, "h-8 w-full px-2.5", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(control, "h-8 pl-2 pr-7", props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(control, "block min-h-20 w-full px-2.5 py-1.5 leading-5", props.className)} />;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--color-muted)]">{label}</span>
      {children}
    </label>
  );
}

/** Classes for a segmented control, shared by Segmented and link-based
 * filters (FilterPills). */
export const segmentedClassName =
  "inline-flex flex-wrap items-center gap-0.5 rounded-[var(--radius-control)] bg-[var(--color-surface-2)] p-0.5";

export function segmentedItemClassName(active: boolean): string {
  return cn(
    "inline-flex h-7 items-center whitespace-nowrap rounded-[5px] px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:shadow-[var(--focus-ring)]",
    active
      ? "bg-[var(--color-surface)] text-[var(--color-heading)] shadow-[var(--shadow-pop-lite)]"
      : "text-[var(--color-muted)] hover:text-[var(--color-heading)]",
  );
}

/** Two to four mutually exclusive views, e.g. Board / List. Client components only. */
export function Segmented<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<{ value: Value; label: React.ReactNode }>;
  onChange: (value: Value) => void;
}) {
  return (
    <div role="group" aria-label={label} className={segmentedClassName}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={segmentedItemClassName(option.value === value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-10 text-center text-[13px] text-[var(--color-muted)]">{children}</div>
  );
}

export function Avatar({ label }: { label: string }) {
  return (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--tag-gray-bg)] text-[10px] font-semibold text-[var(--tag-gray-text)]">
      {label}
    </span>
  );
}
