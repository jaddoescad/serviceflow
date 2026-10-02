import { Card } from "@/components/ui";

function Block({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-[var(--color-surface-2)] ${className}`} />;
}

function KpiRowSkeleton() {
  return (
    <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="p-4">
          <Block className="h-3 w-20" />
          <Block className="mt-3 h-7 w-28" />
          <Block className="mt-2 h-3 w-16" />
        </Card>
      ))}
    </div>
  );
}

/** Shape of the jobs list: KPIs + table card with rows. */
export function JobsListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading jobs">
      <div className="mb-6">
        <Block className="h-7 w-48" />
        <Block className="mt-2 h-4 w-80" />
      </div>
      <KpiRowSkeleton />
      <Card>
        <div className="border-b border-[var(--color-border)] p-4">
          <Block className="h-9 w-64" />
        </div>
        <div className="p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-6 py-3">
              <div className="flex-1">
                <Block className="h-4 w-2/5" />
                <Block className="mt-1.5 h-3 w-3/5" />
              </div>
              <Block className="h-4 w-20" />
              <Block className="hidden h-4 w-24 md:block" />
              <Block className="hidden h-2 w-28 lg:block" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

/** Route fallback: header shape only — no fake interactive elements. */
/** Job header and tabs, with the active tab's panel below. */
export function JobPageSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div aria-busy="true" aria-label="Loading job">
      <Block className="mb-3 h-3 w-40" />
      <Block className="h-8 w-72" />
      <Block className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-5 mb-6">
        <Block className="h-11 w-[320px] max-w-full rounded-xl" />
      </div>
      {children}
    </div>
  );
}

/** Overview panel while its data streams in. */
export function OverviewPanelSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading overview">
      <div className="mb-4 flex gap-2">
        <Block className="h-5 w-24 rounded-full" />
        <Block className="h-5 w-20 rounded-full" />
      </div>
      <KpiRowSkeleton />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)]">
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-3">
              <div className="flex items-center gap-3">
                <Block className="h-7 w-7 rounded-full" />
                <div className="flex-1">
                  <Block className="h-4 w-1/2" />
                  <Block className="mt-2 h-1.5 w-full" />
                </div>
              </div>
            </Card>
          ))}
        </div>
        <Card className="p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-6 py-2.5">
              <Block className="h-4 w-1/4" />
              <Block className="h-4 w-1/6" />
              <Block className="h-4 flex-1" />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

/** Photo grid and description rail while project media streams in. */
export function PhotosPanelSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading project photos"
      className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_340px]"
    >
      <div>
        <Block className="mb-4 h-5 w-48" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index}>
              <Block className="aspect-[4/3] w-full rounded-xl" />
              <Block className="mt-2 h-3 w-28" />
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <Card className="p-5">
          <Block className="h-5 w-20" />
          <Block className="mt-6 h-4 w-2/3" />
          <Block className="mt-3 h-3 w-full" />
          <Block className="mt-2 h-3 w-3/4" />
        </Card>
        <Card className="p-5">
          <Block className="h-5 w-24" />
          <Block className="mt-6 h-3 w-full" />
          <Block className="mt-2 h-3 w-4/5" />
          <Block className="mt-2 h-3 w-2/3" />
        </Card>
      </div>
    </div>
  );
}

/** Tasks panel while its data streams in. */
export function TasksPanelSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading tasks">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <div>
          <Block className="h-4 w-28" />
          <Block className="mt-2 h-3 w-56" />
        </div>
        <Block className="h-8 w-24" />
      </div>
      <div className="px-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className={`py-3 ${i > 0 ? "border-t border-[var(--color-border)]" : ""}`}>
            <div className="flex items-center justify-between gap-4">
              <Block className="h-4 w-1/3" />
              <Block className="h-3 w-16" />
            </div>
            <Block className="mt-2 h-1 w-full" />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Shape of the calculator: header, add bar, item cards, summary rail. */
export function CalculatorSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading calculator" className="px-6 py-6">
      <div className="mx-auto max-w-[1040px]">
        <Block className="mb-3 h-3 w-40" />
        <Block className="h-8 w-72" />
        <Block className="mt-2 h-4 w-80" />
        <div className="mt-5 mb-6">
          <Block className="h-11 w-[320px] max-w-full rounded-xl" />
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_290px]">
          <div className="space-y-6">
            <Block className="h-11 w-full rounded-xl" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="p-5">
                <Block className="h-5 w-40" />
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <Block key={j} className="h-9 w-full" />
                  ))}
                </div>
              </Card>
            ))}
          </div>
          <Card className="p-5">
            <Block className="h-3 w-24" />
            <Block className="mt-2 h-8 w-32" />
            <Block className="mt-5 h-3 w-28" />
            <Block className="mt-2 h-8 w-24" />
            <div className="mt-6 space-y-2">
              <Block className="h-9 w-full" />
              <Block className="h-9 w-full" />
              <Block className="h-9 w-full" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
