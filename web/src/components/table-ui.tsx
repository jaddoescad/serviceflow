import Link from "next/link";
import * as React from "react";
import { ReportPending } from "./navigation-pending";
import { cn, segmentedClassName, segmentedItemClassName } from "./ui";

export { TablePanel } from "./table-panel";

/** Spreadsheet-style table: 13px text, 40px rows, hairline row borders. */
export function DataTable({
  minWidth,
  children,
}: {
  /** Pixels below which the panel scrolls sideways instead of squeezing columns. */
  minWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <table className="w-full text-left text-[13px]" style={minWidth ? { minWidth } : undefined}>
      {children}
    </table>
  );
}

// Outer cells line up with the page gutter when the table runs edge to edge.
const edge = "first:pl-[var(--table-edge,0.75rem)] last:pr-[var(--table-edge,0.75rem)]";

/** Header cell. Sticky, so the column names stay put while rows scroll.
 * `sort` marks a sortable column's current order (aria-sort). */
export function Th({
  numeric,
  sort,
  className,
  children,
}: {
  numeric?: boolean;
  sort?: "ascending" | "descending" | "none";
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <th
      scope="col"
      aria-sort={sort}
      className={cn(
        "sticky top-0 z-10 h-9 whitespace-nowrap bg-[var(--color-surface)] px-3 text-xs font-medium text-[var(--color-muted)] shadow-[inset_0_-1px_0_var(--color-border)]",
        edge,
        numeric && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}

/** Header cell of a sortable column: clicking flips or picks this column's
 * order. Client components only (it takes onClick). */
export function SortTh({
  label,
  active,
  desc,
  numeric,
  className,
  onClick,
}: {
  label: string;
  active: boolean;
  desc: boolean;
  numeric?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <Th numeric={numeric} sort={active ? (desc ? "descending" : "ascending") : "none"} className={className}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "-mx-1 inline-flex h-6 items-center gap-1 rounded px-1 outline-none hover:bg-[var(--color-hover)] hover:text-[var(--color-heading)] focus-visible:shadow-[var(--focus-ring)]",
          active && "text-[var(--color-heading)]",
          numeric && "flex-row-reverse",
        )}
      >
        {label}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("h-3 w-3", !active && "invisible")}
        >
          <path d={desc ? "M12 5v14M6 13l6 6 6-6" : "M12 19V5M6 11l6-6 6 6"} />
        </svg>
      </button>
    </Th>
  );
}

/** For a secondary action in a row (Duplicate, Remove): hidden until the row
 * is hovered or the action focused when using a mouse; always shown on touch. */
export const rowActionClassName =
  "pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 focus-visible:opacity-100";

export function Tr({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <tr
      className={cn(
        "group/row border-b border-[var(--color-border)] transition-colors last:border-b-0 hover:bg-[var(--color-row-hover)]",
        className,
      )}
    >
      {children}
    </tr>
  );
}

/** Body cell. The first column reads as the row's name. */
export function Td({
  numeric,
  muted,
  className,
  children,
}: {
  numeric?: boolean;
  muted?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <td
      className={cn(
        "h-10 px-3 py-1.5 align-middle first:font-semibold first:text-[var(--color-heading)]",
        edge,
        numeric && "whitespace-nowrap text-right tabular-nums",
        muted && "text-[var(--color-muted)]",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** The row's primary link. Inside a TablePanel a click anywhere on the row
 * opens it, and the row is prefetched on hover or focus. */
export function RowLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      prefetch={false}
      data-row-link
      className="font-semibold text-[var(--color-heading)] outline-none hover:underline focus-visible:underline"
    >
      {children}
      <ReportPending href={href} />
    </Link>
  );
}

/** Filter/search bar under the page bar, full width with a hairline below. */
export function TableToolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="page-subbar flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] py-1.5">
      {children}
    </div>
  );
}

type FilterOption = { value: string; label: string; href?: string };

/** "All" plus one `?status=` link per status, for a list page at `path`. */
export function statusFilterOptions<Status extends string>(
  path: string,
  statuses: readonly Status[],
  labelOf: (status: Status) => string,
): FilterOption[] {
  return [
    { value: "all", label: "All", href: path },
    ...statuses.map((status) => ({ value: status, label: labelOf(status), href: `${path}?status=${status}` })),
  ];
}

/** Segmented filter. Options with an href are links (URL filters); otherwise
 * `onChange` handles the choice in the browser (client components only). */
export function FilterPills({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: FilterOption[];
  onChange?: (value: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className={segmentedClassName}>
      {options.map((option) => {
        const active = option.value === value;
        return option.href ? (
          <Link
            key={option.value}
            href={option.href}
            aria-current={active ? "true" : undefined}
            className={segmentedItemClassName(active)}
          >
            {option.label}
          </Link>
        ) : (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange?.(option.value)}
            className={segmentedItemClassName(active)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
