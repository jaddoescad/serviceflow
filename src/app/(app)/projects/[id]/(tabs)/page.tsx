import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getProjectShell } from "@/lib/project-data";
import { resolveProjectId } from "@/lib/queries";
import { JobShell } from "@/components/job-shell";
import { OverviewSlot, TasksSlot } from "@/components/project-slots";
import { OverviewPanelSkeleton, TasksPanelSkeleton } from "@/components/skeletons";

export const dynamic = "force-dynamic";

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = decodeURIComponent(id);
  const canonicalProjectId = await resolveProjectId(projectId);
  if (canonicalProjectId !== projectId) {
    redirect(`/jobs/${encodeURIComponent(canonicalProjectId)}`);
  }
  const shell = await getProjectShell(projectId);
  if (!shell) notFound();

  return (
    <JobShell
      projectId={projectId}
      name={shell.name}
      address={shell.address}
      isLead={shell.isLead}
      initialTab="overview"
      overview={
        <Suspense fallback={<OverviewPanelSkeleton />}>
          <OverviewSlot projectId={projectId} />
        </Suspense>
      }
      tasks={
        <Suspense fallback={<TasksPanelSkeleton />}>
          <TasksSlot projectId={projectId} />
        </Suspense>
      }
    />
  );
}
