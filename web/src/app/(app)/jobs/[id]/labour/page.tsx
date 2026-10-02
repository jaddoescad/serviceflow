import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { JobShell } from "@/components/job-shell";
import { OverviewSlot } from "@/components/project-slots";
import { OverviewPanelSkeleton } from "@/components/skeletons";
import { requireStaff } from "@/lib/auth";
import { getProjectData, getProjectShell } from "@/lib/project-data";

export const dynamic = "force-dynamic";

export default async function JobLabourPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = decodeURIComponent(id);
  // Start the tab's data now so it loads alongside the header, not after it.
  void getProjectData(jobId).catch(() => undefined);
  const [shell] = await Promise.all([getProjectShell(jobId), requireStaff()]);
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
