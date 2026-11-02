import { notFound } from "next/navigation";
import { getDocumentTemplate } from "@/lib/actions/document-templates";
import { DocumentEditor } from "@/components/document-editor";

export const dynamic = "force-dynamic";

export default async function DocumentTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const template = await getDocumentTemplate(decodeURIComponent(id));
  if (!template) notFound();
  return <DocumentEditor key={template.id} document={template} canEdit />;
}
