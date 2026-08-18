import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { JobShell } from "@/components/job-shell";
import { OverviewSlot } from "@/components/project-slots";
import { OverviewPanelSkeleton } from "@/components/skeletons";
import { getProjectShell } from "@/lib/project-data";

export const dynamic = "force-dynamic";

export default async function JobLabourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = decodeURIComponent(id);
  const shell = await getProjectShell(jobId);
  if (!shell) notFound();
  if (shell.canonicalJobId) {
    redirect(`/jobs/${encodeURIComponent(shell.canonicalJobId)}/labour`);
  }

  return (
    <JobShell
      projectId={jobId}
      name={shell.name}
      address={shell.address}
      status={shell.status}
      photoCount={shell.photoCount}
      isLead={shell.isLead}
      activeTab="labour"
    >
      <Suspense fallback={<OverviewPanelSkeleton />}>
        <OverviewSlot projectId={jobId} />
      </Suspense>
    </JobShell>
  );
}
