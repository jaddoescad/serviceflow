import Link from "next/link";
import { Tag, cn } from "./ui";

/** Underlined section tabs in a full-width bar directly under the PageHeader. */
export function PageTabs({
  label,
  tabs,
}: {
  label: string;
  tabs: Array<{ href: string; label: string; active: boolean; count?: number }>;
}) {
  return (
    <nav
      aria-label={label}
      // The hairline is an inset shadow so the active underline can cover it
      // while the bar still scrolls sideways on phones.
      className="no-scrollbar page-subbar flex h-10 shrink-0 items-stretch gap-5 overflow-x-auto shadow-[inset_0_-1px_0_var(--color-border)]"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={cn(
            "flex items-center gap-1.5 whitespace-nowrap border-b-2 text-[13px] font-medium transition-colors",
            tab.active
              ? "border-[var(--color-heading)] text-[var(--color-heading)]"
              : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-heading)]",
          )}
        >
          {tab.label}
          {tab.count !== undefined ? <Tag>{tab.count}</Tag> : null}
        </Link>
      ))}
    </nav>
  );
}
