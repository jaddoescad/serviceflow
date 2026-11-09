import { redirect } from "next/navigation";
import { proposalHref } from "@/lib/pipeline-types";

/** Proposals open under their deal; this old address forwards there. */
export default async function Page({ params }: { params: Promise<{ id: string; proposalId: string }> }) {
  const { id, proposalId } = await params;
  redirect(proposalHref(decodeURIComponent(id), proposalId));
}
