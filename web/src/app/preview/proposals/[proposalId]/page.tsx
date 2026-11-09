import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicDocumentView } from "@/components/public-document";
import { requireStaff } from "@/lib/auth";
import { getProposal, getProposalPreview } from "@/lib/proposals";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Customer view", robots: { index: false, follow: false } };

/** Staff's Customer view of any proposal, like DripJobs': the customer's page, drafts included. */
export default async function ProposalPreviewPage({ params }: { params: Promise<{ proposalId: string }> }) {
  const [{ proposalId }] = await Promise.all([params, requireStaff()]);
  const proposal = await getProposal(proposalId);
  if (!proposal) notFound();
  const doc = await getProposalPreview(proposal.id);
  if (!doc) notFound();
  // A draft shows as the customer will get it once sent.
  const shown =
    doc.status === "draft" ? { ...doc, status: "sent", sentAt: doc.sentAt ?? new Date().toISOString() } : doc;
  return <PublicDocumentView doc={shown} token="" preview />;
}
