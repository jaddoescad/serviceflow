"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type ProjectTabKey =
  | "photos"
  | "labour"
  | "tasks"
  | "calculator";
/** Retained for the legacy component while project routes use ProjectTabKey. */
export type LocalTabKey = "photos" | "tasks";

export function ProjectTabs({
  projectId,
  projectName,
  activeOverride,
  isLead: _isLead = false,
  photoCount,
}: {
  projectId: string;
  projectName: string;
  activeOverride?: ProjectTabKey;
  isLead?: boolean;
  photoCount?: number;
}) {
  const pathname = usePathname();
  const active: ProjectTabKey =
    activeOverride ??
    (pathname.endsWith("/tasks")
      ? "tasks"
      : pathname.endsWith("/labour")
        ? "labour"
          : pathname.endsWith("/calculator")
            ? "calculator"
            : "photos");

  const base = `/jobs/${encodeURIComponent(projectId)}`;
  const tabs: {
    key: ProjectTabKey;
    label: string;
    href: string;
    count?: number;
  }[] = [
    { key: "photos", label: "Photos", href: base, count: photoCount },
    { key: "labour", label: "Labour budget", href: `${base}/labour` },
    { key: "tasks", label: "Tasks", href: `${base}/tasks` },
    {
      key: "calculator",
      label: "Quote / Calculator",
      href: `${base}/calculator?name=${encodeURIComponent(projectName)}`,
    },
  ];

  return (
    <nav
      aria-label="Project sections"
      className="mb-6 flex w-full gap-1 overflow-x-auto border-b border-[var(--color-border)]"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        const className = `-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
          isActive
            ? "border-[var(--color-heading)] text-[var(--color-heading)]"
            : "border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]"
        }`;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={className}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="ml-1 font-normal text-[var(--color-muted)]">({tab.count})</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
