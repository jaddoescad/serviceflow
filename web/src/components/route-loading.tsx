import { SkeletonBlock, SkeletonPageBar, SkeletonRows } from "@/components/page-skeleton";

/** Generic fallback for dashboard routes without a page-shaped skeleton: the
 * top bar, then a filter row and a panel of rows. */
export function RoutePageLoader({ label = "Loading page" }: { label?: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      <SkeletonPageBar>
        <SkeletonBlock className="h-8 w-28" />
      </SkeletonPageBar>
      <SkeletonBlock className="mb-3 h-8 w-64" />
      <div className="rounded-[var(--radius)] border border-[var(--color-border)] px-3">
        <SkeletonRows count={8} />
      </div>
    </div>
  );
}
