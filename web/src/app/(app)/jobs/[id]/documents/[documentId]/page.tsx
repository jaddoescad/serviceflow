import { notFound, redirect } from "next/navigation";
import { requireMember } from "@/lib/auth";
import { getProjectShell } from "@/lib/project-data";
import { getProjectPageDocument } from "@/lib/project-documents";
import { DocumentEditor } from "@/components/document-editor";

export const dynamic = "force-dynamic";

export default async function JobDocumentPage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>;
}) {
  const { id, documentId } = await params;
  const jobId = decodeURIComponent(id);
  const docId = decodeURIComponent(documentId);
  const [shell, document, profile] = await Promise.all([
    getProjectShell(jobId),
    getProjectPageDocument(jobId, docId),
    requireMember(),
  ]);
  if (!shell) notFound();
  if (shell.canonicalJobId) {
    redirect(`/jobs/${encodeURIComponent(shell.canonicalJobId)}/documents`);
  }
  if (!document) notFound();
  return (
    <DocumentEditor
      key={document.id}
      document={document}
      canEdit={["admin", "manager"].includes(profile.role)}
    />
  );
}
