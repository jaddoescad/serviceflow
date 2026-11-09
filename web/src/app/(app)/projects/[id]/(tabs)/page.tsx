import { notFound, redirect } from "next/navigation";
import { resolveLegacyProject } from "@/lib/queries";
import { dealHref } from "@/lib/pipeline-types";

export const dynamic = "force-dynamic";

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectId = decodeURIComponent(id);
  const resolution = await resolveLegacyProject(projectId);
  if (!resolution) notFound();
  redirect(dealHref(resolution.id));
}
