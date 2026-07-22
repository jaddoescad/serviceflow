"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type ProjectTabKey = "overview" | "tasks" | "calculator";
export type LocalTabKey = Exclude<ProjectTabKey, "calculator">;

export function ProjectTabs({
  projectId,
  projectName,
  activeOverride,
  onLocalSwitch,
}: {
  projectId: string;
  projectName: string;
  /** Controlled active tab (used by the job view's instant switching). */
  activeOverride?: ProjectTabKey;
  /** When set, Overview/Tasks switch in place instead of navigating. */
  onLocalSwitch?: (tab: LocalTabKey) => void;
}) {
  const pathname = usePathname();
  const active: ProjectTabKey =
    activeOverride ??
    (pathname.endsWith("/tasks") ? "tasks" : pathname.endsWith("/calculator") ? "calculator" : "overview");

  const base = `/projects/${encodeURIComponent(projectId)}`;
  const tabs: { key: ProjectTabKey; label: string; href: string }[] = [
    { key: "overview", label: "Overview", href: base },
    { key: "tasks", label: "Tasks", href: `${base}/tasks` },
    { key: "calculator", label: "Calculator", href: `${base}/calculator?name=${encodeURIComponent(projectName)}` },
  ];

  return (
    <div
      role="tablist"
      aria-label="Job sections"
      className="mb-6 inline-flex rounded-xl bg-[var(--color-surface-2)] p-1"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        const className = `rounded-lg px-5 py-2 text-sm font-medium transition-colors ${
          isActive
            ? "bg-[var(--color-brand)] text-[var(--color-brand-ink)] shadow-sm"
            : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
        }`;
        if (onLocalSwitch && tab.key !== "calculator") {
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`cursor-pointer ${className}`}
              onClick={() => onLocalSwitch(tab.key as LocalTabKey)}
            >
              {tab.label}
            </button>
          );
        }
        return (
          <Link key={tab.key} href={tab.href} role="tab" aria-selected={isActive} className={className}>
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
