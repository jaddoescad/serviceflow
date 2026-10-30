import type { ReactNode } from "react";
import { initials } from "@/lib/format";
import type { PipelineCardLabel, PipelineStage } from "@/lib/pipeline-types";
import { Spinner, TAG_DOT, Tag, cn, type TagTone } from "./ui";

/** Pipeline-specific pieces shared by the board, the deal page and their
 * dialogs; general controls come from ui.tsx. */

export const linkStyle = "font-medium text-[var(--color-brand-strong)] hover:underline";

export function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-[var(--color-primary)]" : "bg-[var(--color-border-strong)]",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow-[var(--shadow-pop-lite)] transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/** A deal's labels as gray tags with the label's colour as a dot. */
export function LabelTags({ labels, max = labels.length }: { labels: PipelineCardLabel[]; max?: number }) {
  const hidden = labels.length - max;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {labels.slice(0, max).map((label) => (
        <Tag key={label.id} className="min-w-0 max-w-full">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: label.color }} />
          <span className="truncate">{label.name}</span>
        </Tag>
      ))}
      {hidden > 0 ? <Tag>+{hidden}</Tag> : null}
    </span>
  );
}

/** Stage colours, as dots only: open columns cycle the tag tints; closed
 * columns stay gray. */
const STAGE_TONES: TagTone[] = ["gray", "blue", "orange", "purple", "green", "yellow", "red"];

export function stageColors(stages: PipelineStage[]): Map<string, string> {
  let open = 0;
  return new Map(
    stages.map((stage) => [stage.id, TAG_DOT[stage.isClosed ? "gray" : STAGE_TONES[open++ % STAGE_TONES.length]]]),
  );
}

export function Dot({ color, className }: { color: string | undefined; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color ?? TAG_DOT.gray }}
    />
  );
}

/** Initials in a gray circle; 18px unless a size is passed. */
export function Initials({ name, className }: { name: string | null | undefined; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--tag-gray-bg)] text-[9px] font-semibold text-[var(--tag-gray-text)]",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** "› Archived 12": shows or hides a column's (or the list's) archived deals.
 * No count while a filter is on and they haven't loaded to be filtered. */
export function ArchivedToggle({
  count,
  loading,
  open,
  onToggle,
  className,
}: {
  count: number | null;
  loading?: boolean;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        "flex h-8 w-full shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 text-left text-xs font-medium text-[var(--color-muted)] outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)] focus-visible:shadow-[var(--focus-ring)]",
        className,
      )}
    >
      <ChevronIcon className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
      Archived
      {loading ? (
        <Spinner className="h-3 w-3 text-[var(--color-faint)]" />
      ) : count !== null ? (
        <span className="tabular-nums text-[var(--color-faint)]">{count}</span>
      ) : null}
    </button>
  );
}

const OTTAWA_TZ = "America/Toronto";

/** "Wed, Oct 28" for a date or timestamp, in Ottawa time. */
export function fmtDay(value: string): string {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return date.toLocaleDateString("en-US", { timeZone: OTTAWA_TZ, weekday: "short", month: "short", day: "numeric" });
}

// Icons ---------------------------------------------------------------------

function Icon({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className ?? "h-3.5 w-3.5")}
    >
      {children}
    </svg>
  );
}

type IconProps = { className?: string };

export const CalendarIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);

export const DocumentIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Icon>
);

export const NoteIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M5 4h14a1 1 0 0 1 1 1v10l-5 5H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    <path d="M15 20v-5h5M8 9h8M8 13h4" />
  </Icon>
);

export const SourceIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" />
  </Icon>
);

export const CopyIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
  </Icon>
);

export const CheckIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const TagIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z" />
    <circle cx="8" cy="8" r="1.5" />
  </Icon>
);

export const MailIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
  </Icon>
);

export const PhoneIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M5 3.5h3.5l1.8 4.5-2.3 1.5a11 11 0 0 0 6 6l1.5-2.3 4.5 1.8V19a1.5 1.5 0 0 1-1.6 1.5A16.5 16.5 0 0 1 3.5 5.1 1.5 1.5 0 0 1 5 3.5" />
  </Icon>
);

export const DropIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 3.5s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z" />
  </Icon>
);

export const ImageIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m20.5 16-4.5-4.5-8 8" />
  </Icon>
);

export const SearchIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.8-3.8" />
  </Icon>
);

export const FilterIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </Icon>
);

export const ChatIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M20 12a7.5 7.5 0 0 1-11 6.6L4 20l1.4-4.6A7.5 7.5 0 1 1 20 12z" />
  </Icon>
);

export const ChevronIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="m9 5 7 7-7 7" />
  </Icon>
);

export const BackIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="m15 5-7 7 7 7" />
  </Icon>
);

export const PlusIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const ArrowUpIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const ArrowDownIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);

export const MoreIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <circle cx="5.5" cy="12" r="1.2" fill="currentColor" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.2" fill="currentColor" />
  </Icon>
);

export const TrashIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Icon>
);
