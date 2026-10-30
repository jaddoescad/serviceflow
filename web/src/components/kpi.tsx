import * as React from "react";

/** The page's 56px top bar: title, an optional count or key figure beside it,
 * and actions (view toggles, filters, buttons) on the right. It spans the full
 * width above the page content; see .page-bar in globals.css. The title may be
 * a breadcrumb, e.g. <><Link href="/contacts">Customers</Link> / Jane</>. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="page-bar flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--color-border)] py-2.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="truncate text-base font-semibold text-[var(--color-heading)]">{title}</h1>
        {subtitle ? <span className="truncate text-[13px] text-[var(--color-muted)]">{subtitle}</span> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
