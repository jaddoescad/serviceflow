import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getProjectShell } from "@/lib/project-data";
import { JobShell } from "@/components/job-shell";
import { OverviewSlot, TasksSlot } from "@/components/project-slots";
import { OverviewPanelSkeleton, TasksPanelSkeleton } from "@/components/skeletons";

export const dynamic = "force-dynamic";

export default async function JobOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = decodeURIComponent(id);
  const shell = await getProjectShell(jobId);
  if (!shell) notFound();
  return (
    <JobShell
      projectId={jobId}
      name={shell.name}
      address={shell.address}
      isLead={false}
      initialTab="overview"
      overview={
        <Suspense fallback={<OverviewPanelSkeleton />}>
          <OverviewSlot projectId={jobId} />
        </Suspense>
      }
      tasks={
        <Suspense fallback={<TasksPanelSkeleton />}>
          <TasksSlot projectId={jobId} />
        </Suspense>
      }
    />
  );
}
