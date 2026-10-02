import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getProjectShell } from "@/lib/project-data";
import { requireStaff } from "@/lib/auth";
import { getProjectDocumentCount, getProjectDocuments } from "@/lib/project-documents";
import { JobShell } from "@/components/job-shell";
import { DocumentsSlot } from "@/components/project-slots";
import { TasksPanelSkeleton } from "@/components/skeletons";

export const dynamic = "force-dynamic";

export default async function JobDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const jobId = decodeURIComponent(id);
  // Start the list now so it loads alongside the header, not after it.
  void getProjectDocuments(jobId).catch(() => undefined);
  const [shell, documentCount] = await Promise.all([
    getProjectShell(jobId),
    getProjectDocumentCount(jobId),
    requireStaff(),
  ]);
  if (!shell) notFound();
  if (shell.canonicalJobId) {
    redirect(`/jobs/${encodeURIComponent(shell.canonicalJobId)}/documents`);
  }
  return (
    <JobShell
      projectId={jobId}
      name={shell.name}
      address={shell.address}
      status={shell.status}
      photoCount={shell.photoCount}
      documentCount={documentCount}
      isLead={shell.isLead}
      activeTab="documents"
    >
      <Suspense fallback={<TasksPanelSkeleton />}>
        <DocumentsSlot projectId={jobId} />
      </Suspense>
    </JobShell>
  );
}
