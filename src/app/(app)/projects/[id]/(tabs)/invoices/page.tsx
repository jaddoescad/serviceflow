import { notFound, redirect } from "next/navigation";
import { resolveLegacyProject } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function LegacyProjectInvoicesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = decodeURIComponent(id);
  const resolution = await resolveLegacyProject(projectId);
  if (!resolution) notFound();
  redirect(`/jobs/${encodeURIComponent(resolution.id)}/invoices`);
}
