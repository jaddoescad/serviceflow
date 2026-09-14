import Link from "next/link";
import { ProjectTabs, type ProjectTabKey } from "@/components/project-tabs";
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

/** Shared project chrome. Route-level tabs keep hidden financial queries from running on Photos. */
export function JobShell({
  projectId,
  name,
  address,
  status = null,
  photoCount,
  isLead,
  activeTab,
  children,
}: {
  projectId: string;
  name: string;
  address: string | null;
  status?: string | null;
  photoCount?: number;
  isLead: boolean;
  activeTab: ProjectTabKey;
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="mb-4">
        <Link
          href={isLead ? "/deals" : "/jobs"}
          className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-muted)] transition-colors hover:text-[var(--color-heading)]"
        >
          <span aria-hidden="true">‹</span>
          {isLead ? "Deals" : "Projects"}
        </Link>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-display text-2xl font-bold tracking-tight text-[var(--color-heading)] sm:text-3xl">
            {name}
          </h1>
          <Badge tone={statusTone(status, isLead)}>{statusLabel(status, isLead)}</Badge>
        </div>
        {address ? (
          <p className="mt-1 text-sm text-[var(--color-muted)]">{address}</p>
        ) : null}
      </header>

      <ProjectTabs
        projectId={projectId}
        projectName={name}
        activeOverride={activeTab}
        isLead={isLead}
        photoCount={photoCount}
      />

      {children}
    </>
  );
}
