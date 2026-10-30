import { SkeletonBlock as Block, SkeletonPageBar, SkeletonRows } from "@/components/page-skeleton";

const panel = "rounded-[var(--radius)] border border-[var(--color-border)]";

/** JobShell while a tab loads: top bar, project tabs, then the tab's panel. */
export function JobPageSkeleton({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading job">
      <SkeletonPageBar>
        <Block className="h-5 w-16" />
      </SkeletonPageBar>
      <div className="page-subbar flex h-10 items-center gap-5 shadow-[inset_0_-1px_0_var(--color-border)]">
        {["w-12", "w-20", "w-16", "w-24", "w-16", "w-20"].map((width, index) => (
          <Block key={index} className={`h-3 ${width}`} />
        ))}
      </div>
      {children}
    </div>
  );
}

/** Labour tab (ProjectOverviewPanel) while its data streams in. */
export function OverviewPanelSkeleton() {
  return (
    <div aria-hidden="true" className="max-w-3xl space-y-4">
      <div className={`${panel} p-4`}>
        <Block className="h-3 w-24" />
        <Block className="mt-2 h-6 w-40" />
        <Block className="mt-4 h-2 w-full" />
        <Block className="mt-2 h-2 w-3/4" />
      </div>
      <div className={`${panel} px-4`}>
        <SkeletonRows count={4} />
      </div>
    </div>
  );
}

/** The project photo grid while media streams in. */
export function PhotosPanelSkeleton() {
  return (
    <div aria-hidden="true">
      <Block className="mb-4 h-8 w-72" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
        {Array.from({ length: 12 }, (_, index) => (
          <Block key={index} className="aspect-square w-full rounded-[var(--radius)]" />
        ))}
      </div>
    </div>
  );
}

/** Tasks and documents tabs while their lists stream in. */
export function TasksPanelSkeleton() {
  return (
    <div aria-hidden="true" className={panel}>
      <div className="flex h-11 items-center justify-between gap-3 border-b border-[var(--color-border)] px-4">
        <Block className="h-4 w-28" />
        <Block className="h-7 w-24" />
      </div>
      <div className="px-4">
        <SkeletonRows count={5} />
      </div>
    </div>
  );
}

/** The calculator route: full-bleed pane with top bar, tabs, item panels and
 * the summary rail, matching the loaded calculator. */
export function CalculatorSkeleton() {
  return (
    <div
      data-app-content="full-bleed"
      role="status"
      aria-busy="true"
      aria-label="Loading calculator"
      className="px-[var(--gutter)] pb-6 pt-[var(--page-pad-y)]"
    >
      <SkeletonPageBar />
      <div className="page-subbar flex h-10 items-center gap-5 shadow-[inset_0_-1px_0_var(--color-border)]">
        {["w-12", "w-20", "w-16", "w-24", "w-16", "w-20"].map((width, index) => (
          <Block key={index} className={`h-3 ${width}`} />
        ))}
      </div>
      <div className="mx-auto max-w-[1040px]">
        <Block className="mb-4 h-8 w-full" />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_290px]">
          <div className="space-y-4">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className={`${panel} p-4`}>
                <Block className="h-4 w-40" />
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {Array.from({ length: 4 }, (_, cell) => (
                    <Block key={cell} className="h-8 w-full" />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className={`${panel} p-4`}>
            <Block className="h-3 w-24" />
            <Block className="mt-2 h-6 w-32" />
            <Block className="mt-5 h-3 w-28" />
            <Block className="mt-2 h-6 w-24" />
          </div>
        </div>
      </div>
    </div>
  );
}
