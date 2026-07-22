import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getProjectShell } from "@/lib/project-data";
import { JobShell } from "@/components/job-shell";
import { OverviewSlot, TasksSlot } from "@/components/project-slots";
import { OverviewPanelSkeleton, TasksPanelSkeleton } from "@/components/skeletons";

export const dynamic = "force-dynamic";

export default async function ProjectTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = decodeURIComponent(id);
  const shell = await getProjectShell(projectId);
  if (!shell) notFound();

  return (
    <JobShell
      projectId={projectId}
      name={shell.name}
      address={shell.address}
      initialTab="tasks"
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
