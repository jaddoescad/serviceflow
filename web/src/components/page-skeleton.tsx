import { cn } from "./ui";

/** A pulsing placeholder shape. */
export function SkeletonBlock({ className }: { className: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded bg-[var(--color-surface-2)]", className)} />;
}

/** Placeholder for the 56px top bar (PageHeader). */
export function SkeletonPageBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="page-bar flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)]">
      <SkeletonBlock className="h-4 w-48" />
      {children}
    </div>
  );
}

/** Rows of a table-shaped placeholder. */
export function SkeletonRows({ count = 12 }: { count?: number }) {
  return Array.from({ length: count }, (_, index) => (
    <div key={index} className="flex h-10 items-center gap-6 border-b border-[var(--color-border)] last:border-b-0">
      <SkeletonBlock className="h-3 w-1/4" />
      <SkeletonBlock className="h-3 w-1/6" />
      <SkeletonBlock className="ml-auto h-3 w-16" />
    </div>
  ));
}

/** Loading shape of a list page: the top bar, the filter bar and table rows,
 * laid out exactly like PageHeader + TableToolbar + a filled TablePanel. */
export function ListPageSkeleton({ label = "Loading page" }: { label?: string }) {
  return (
    <div className="page-fill" role="status" aria-busy="true" aria-label={label}>
      <SkeletonPageBar />
      <div className="page-subbar flex min-h-11 shrink-0 items-center gap-2 border-b border-[var(--color-border)]">
        <SkeletonBlock className="h-7 w-64" />
        <SkeletonBlock className="h-7 w-40" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-[var(--gutter)]">
        <SkeletonRows />
      </div>
    </div>
  );
}
