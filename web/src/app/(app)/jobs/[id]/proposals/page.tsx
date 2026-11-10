import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { dealHref } from "@/lib/pipeline-types";
import { getProjectShell } from "@/lib/project-data";

export const dynamic = "force-dynamic";

/** Proposals are listed on the deal page; this address forwards there. */
export default async function ProjectProposalsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const projectId = decodeURIComponent(id);
  const [shell] = await Promise.all([getProjectShell(projectId), requireStaff()]);
  if (!shell) notFound();
  redirect(dealHref(shell.canonicalJobId ?? projectId));
}
