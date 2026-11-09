import { notFound } from "next/navigation";
import { ProposalEditor } from "@/components/proposal-editor";
import { requireStaff } from "@/lib/auth";
import { getCompanyDocuments, getDocumentExtras } from "@/lib/documents";
import { getDealOverview } from "@/lib/pipeline";
import { dealHref } from "@/lib/pipeline-types";
import { getProjectShell } from "@/lib/project-data";
import type { ProposalBody } from "@/lib/proposal-types";
import {
  getLeadProposals,
  getProjectDeal,
  getProposal,
  getProposalTemplates,
} from "@/lib/proposals";

export const dynamic = "force-dynamic";

export default async function ProposalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; proposalId: string }>;
  searchParams: Promise<{ template?: string }>;
}) {
  const [{ id, proposalId }, query] = await Promise.all([params, searchParams]);
  const projectId = decodeURIComponent(id);
  const isNew = proposalId === "new";
  const [shell, deal, proposal, templates, extras, overview] = await Promise.all([
    getProjectShell(projectId),
    getProjectDeal(projectId),
    isNew ? null : getProposal(proposalId),
    getProposalTemplates(),
    isNew ? null : getDocumentExtras("proposal", proposalId),
    getDealOverview(projectId),
    requireStaff(),
  ]);
  if (!shell || !deal?.leadId) notFound();
  if (!isNew && (!proposal || proposal.leadId !== deal.leadId)) notFound();

  const [count, companyDocuments] = await Promise.all([
    isNew ? getLeadProposals(deal.leadId).then((list) => list.length) : 0,
    extras ? getCompanyDocuments(extras.orgId) : [],
  ]);
  const template = templates.find((item) => item.id === query.template);
  const initial: ProposalBody = proposal
    ? {
        name: proposal.name,
        items: proposal.items,
        taxRatePercent: proposal.taxRatePercent,
        depositPercent: proposal.depositPercent,
        depositCents: proposal.depositCents,
        discountPercent: proposal.discountPercent,
        discountCents: proposal.discountCents,
        packages: proposal.packages,
        selectedPackageId: proposal.selectedPackageId,
        intro: proposal.intro,
        terms: proposal.terms,
      }
    : {
        name: template?.name ?? `Proposal ${count + 1}`,
        items: template?.items ?? [],
        taxRatePercent: template?.taxRatePercent ?? 13,
        depositPercent: template?.depositPercent ?? null,
        depositCents: template?.depositCents ?? null,
        discountPercent: template?.discountPercent ?? null,
        discountCents: template?.discountCents ?? null,
        packages: template?.packages ?? [],
        selectedPackageId: template?.selectedPackageId ?? null,
        intro: template?.intro ?? "",
        terms: template?.terms ?? "",
      };

  return (
    <ProposalEditor
      key={proposal?.id ?? "new"}
      mode="proposal"
      id={proposal?.id ?? crypto.randomUUID()}
      leadId={deal.leadId}
      projectId={projectId}
      isNew={isNew}
      initial={initial}
      proposal={proposal}
      deal={overview}
      extras={extras}
      companyDocuments={companyDocuments}
      initialTemplateId={template?.id ?? null}
      projectName={shell.name}
      backHref={dealHref(shell.canonicalJobId ?? projectId, "proposals")}
      backLabel={shell.name}
    />
  );
}
