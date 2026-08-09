"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/kpi";
import { ProjectTabs, type LocalTabKey } from "@/components/project-tabs";
import { Badge } from "@/components/ui";

/**
 * Job page chrome that paints immediately: breadcrumb, title, and live tabs.
 * The panels stream in as Suspense children; switching tabs is instant and
 * works even while a panel is still loading (its skeleton shows instead).
 */
export function JobShell({
  projectId,
  name,
  address,
  isLead,
  initialTab,
  overview,
  tasks,
}: {
  projectId: string;
  name: string;
  address: string | null;
  isLead: boolean;
  initialTab: LocalTabKey;
  overview: React.ReactNode;
  tasks: React.ReactNode;
}) {
  const [tab, setTab] = useState<LocalTabKey>(initialTab);
  const pathname = usePathname();

  // Follow browser back/forward.
  useEffect(() => {
    setTab(pathname.endsWith("/tasks") ? "tasks" : "overview");
  }, [pathname]);

  function switchTab(next: LocalTabKey) {
    setTab(next);
    const base = `/jobs/${encodeURIComponent(projectId)}`;
    const href = next === "tasks" ? `${base}/tasks` : base;
    if (typeof window !== "undefined" && window.location.pathname !== href) {
      window.history.pushState(null, "", href);
    }
  }

  return (
    <>
      <div className="mb-2 text-xs text-[var(--color-muted)]">
        <Link href={isLead ? "/leads" : "/jobs"} className="hover:text-[var(--color-text)]">
          {isLead ? "Leads & Estimates" : "Jobs & Budgets"}
        </Link>
        <span className="mx-1.5">/</span>
        <span>{name}</span>
      </div>

      <PageHeader
        title={name}
        subtitle={address ?? undefined}
        actions={isLead ? <Badge tone="brand">Lead</Badge> : null}
      />

      <ProjectTabs
        projectId={projectId}
        projectName={name}
        activeOverride={tab}
        onLocalSwitch={switchTab}
      />

      <div className={tab === "tasks" ? "hidden" : undefined}>{overview}</div>
      <div className={tab === "tasks" ? undefined : "hidden"}>{tasks}</div>
    </>
  );
}
