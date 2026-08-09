import { resolveLegacyProject } from "@/lib/queries";
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
  const resolution = await resolveLegacyProject(projectId);
  if (!resolution) notFound();
  const query = name ? `?name=${encodeURIComponent(name)}` : "";
  redirect(`/jobs/${encodeURIComponent(resolution.id)}/calculator${query}`);
}
