"use client";

import { usePathname } from "next/navigation";
import { PageTabs } from "./page-tabs";

export type ProjectTabKey =
  | "photos"
  | "documents"
  | "proposals"
  | "change-orders"
  | "invoices"
  | "labour"
  | "tasks"
  | "calculator";
export function ProjectTabs({
  projectId,
  projectName,
  activeOverride,
  isLead = false,
  photoCount,
  documentCount,
}: {
  projectId: string;
  projectName: string;
  activeOverride?: ProjectTabKey;
  isLead?: boolean;
  photoCount?: number;
  documentCount?: number;
}) {
  const pathname = usePathname();
  const active: ProjectTabKey =
    activeOverride ??
    (pathname.endsWith("/documents")
      ? "documents"
      : pathname.includes("/proposals")
      ? "proposals"
      : pathname.includes("/change-orders")
      ? "change-orders"
      : pathname.includes("/invoices")
      ? "invoices"
      : pathname.endsWith("/tasks")
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
    { key: "documents", label: "Documents", href: `${base}/documents`, count: documentCount },
    { key: "proposals", label: "Proposals", href: `${base}/proposals` },
    ...(isLead
      ? []
      : [
          { key: "change-orders" as const, label: "Change orders", href: `${base}/change-orders` },
          { key: "invoices" as const, label: "Invoices", href: `${base}/invoices` },
        ]),
    { key: "labour", label: "Labour budget", href: `${base}/labour` },
    { key: "tasks", label: "Tasks", href: `${base}/tasks` },
    {
      key: "calculator",
      label: "Quote / Calculator",
      href: `${base}/calculator?name=${encodeURIComponent(projectName)}`,
    },
  ];

  return (
    <PageTabs
      label="Project sections"
      tabs={tabs.map((tab) => ({
        href: tab.href,
        label: tab.label,
        active: tab.key === active,
        count: tab.count,
      }))}
    />
  );
}
