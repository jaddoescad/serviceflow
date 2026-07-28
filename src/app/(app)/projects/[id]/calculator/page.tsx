import { CalculatorPage } from "@/components/calculator/calculator";
import { getProjectById } from "@/lib/queries";
import { notFound } from "next/navigation";

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
