import { CalculatorPage } from "@/components/calculator/calculator";
import { getProjectById, resolveProjectId } from "@/lib/queries";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProjectCalculatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const { id } = await params;
  const { name } = await searchParams;
  const projectId = decodeURIComponent(id);
  const canonicalProjectId = await resolveProjectId(projectId);
  if (canonicalProjectId !== projectId) {
    const query = name ? `?name=${encodeURIComponent(name)}` : "";
    redirect(
      `/jobs/${encodeURIComponent(canonicalProjectId)}/calculator${query}`,
    );
  }
  const project = await getProjectById(projectId);

  if (!project) notFound();

  return (
    <CalculatorPage
      projectId={projectId}
      projectName={project.name || name || null}
      isLead={project.is_lead}
    />
  );
}
