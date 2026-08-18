import { Card } from "@/components/ui";

function LoadingBlock({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-[var(--color-surface-2)] ${className}`}
    />
  );
}

export function RouteLoadingIndicator({ label = "Loading page" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-5 flex items-center gap-3 text-sm font-semibold text-[var(--color-muted)]"
    >
      <span
        aria-hidden="true"
        className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-brand)]"
      />
      <span>{label}</span>
    </div>
  );
}

/** Generic fallback for dashboard routes that do not have a page-shaped skeleton. */
export function RoutePageLoader({ label = "Loading page" }: { label?: string }) {
  return (
    <div aria-busy="true">
      <RouteLoadingIndicator label={label} />
      <div className="mb-6">
        <LoadingBlock className="h-8 w-56 max-w-full" />
        <LoadingBlock className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="p-4">
            <LoadingBlock className="h-3 w-20" />
            <LoadingBlock className="mt-3 h-7 w-28 max-w-full" />
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <LoadingBlock className="h-5 w-40" />
        <div className="mt-5 space-y-4">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="flex items-center gap-5">
              <LoadingBlock className="h-4 flex-1" />
              <LoadingBlock className="h-4 w-24" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
