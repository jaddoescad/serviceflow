import { CalculatorPage } from "@/components/calculator/calculator";

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
  return <CalculatorPage projectId={id} projectName={name ?? null} />;
}
