import Link from "next/link";
import { ProjectTabs, type ProjectTabKey } from "@/components/project-tabs";
import { PageHeader } from "@/components/kpi";
import { Badge } from "@/components/ui";

function statusLabel(status: string | null, isLead: boolean): string {
  if (!status) return isLead ? "Lead" : "Job";
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string | null, isLead: boolean): "brand" | "good" | "warn" | "neutral" {
  const value = status?.toLocaleLowerCase("en-CA") ?? "";
  if (["completed", "won", "paid"].includes(value)) return "good";
  if (["scheduled", "in_progress", "active"].includes(value)) return "brand";
  if (["pending", "on_hold"].includes(value)) return "warn";
  return isLead ? "brand" : "neutral";
}

/** "Projects / Name" breadcrumb for a project's top bar. */
export function ProjectCrumb({ name }: { name: string }) {
  return (
    <>
      <Link href="/projects" className="font-medium text-[var(--color-muted)] hover:text-[var(--color-heading)]">
        Projects
      </Link>
      <span className="mx-1.5 font-normal text-[var(--color-faint)]">/</span>
      {name}
    </>
  );
}

/** Shared project chrome. Route-level tabs keep hidden financial queries from running on Photos. */
export function JobShell({
  projectId,
  name,
  address,
  status = null,
  photoCount,
  documentCount,
  isLead,
  activeTab,
  actions,
  children,
}: {
  projectId: string;
  name: string;
  address: string | null;
  status?: string | null;
  photoCount?: number;
  documentCount?: number;
  isLead: boolean;
  activeTab: ProjectTabKey;
  /** Buttons for the active tab, shown in the top bar after the status. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <PageHeader
        title={<ProjectCrumb name={name} />}
        subtitle={address}
        actions={
          <>
            <Badge tone={statusTone(status, isLead)}>{statusLabel(status, isLead)}</Badge>
            {actions}
          </>
        }
      />
      <ProjectTabs
        projectId={projectId}
        projectName={name}
        activeOverride={activeTab}
        isLead={isLead}
        photoCount={photoCount}
        documentCount={documentCount}
      />
      {children}
    </>
  );
}
