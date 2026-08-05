import { CalculatorPage } from "@/components/calculator/calculator";
import { getProjectById } from "@/lib/queries";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function JobCalculatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const { id } = await params;
  const { name } = await searchParams;
  const jobId = decodeURIComponent(id);
  const job = await getProjectById(jobId);
  if (!job) notFound();
  return (
    <CalculatorPage
      projectId={jobId}
      projectName={job.name || name || null}
      isLead={false}
    />
  );
}
