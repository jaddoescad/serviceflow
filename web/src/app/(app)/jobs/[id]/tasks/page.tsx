import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getProjectShell } from "@/lib/project-data";
import { JobShell } from "@/components/job-shell";
import { TasksSlot } from "@/components/project-slots";
import { TasksPanelSkeleton } from "@/components/skeletons";

export const dynamic = "force-dynamic";

export default async function JobTasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = decodeURIComponent(id);
  const shell = await getProjectShell(jobId);
  if (!shell) notFound();
  if (shell.canonicalJobId) {
    redirect(`/jobs/${encodeURIComponent(shell.canonicalJobId)}/tasks`);
  }
  return (
    <JobShell
      projectId={jobId}
      name={shell.name}
      address={shell.address}
      status={shell.status}
      photoCount={shell.photoCount}
      isLead={shell.isLead}
      activeTab="tasks"
    >
      <Suspense fallback={<TasksPanelSkeleton />}>
        <TasksSlot projectId={jobId} />
      </Suspense>
    </JobShell>
  );
}
