import { notFound } from "next/navigation";
import { ProposalEditor } from "@/components/proposal-editor";
import { loadCalculator } from "@/lib/actions/calculator";
import { requireStaff } from "@/lib/auth";
import { lineItemsFromCalculator } from "@/lib/calculator/proposal-lines";
import { getCompanyDocuments, getDocumentExtras } from "@/lib/documents";
import { getProjectShell } from "@/lib/project-data";
import { PROPOSAL_VALID_DAYS, isoDaysFromToday, type ProposalBody } from "@/lib/proposal-types";
import {
  getCatalogItems,
  getDealCustomerLanguage,
  getLeadProposals,
  getProjectDeal,
  getProposal,
  getProposalTemplates,
} from "@/lib/proposals";

export const dynamic = "force-dynamic";

/** Lines from the project's active calculator quote, offered as "Import from calculator". */
async function calculatorLines(projectId: string) {
  const calculator = await loadCalculator(projectId);
  const doc = calculator.ok ? calculator.doc : null;
  const quote = doc?.quotes.find((item) => item.id === doc.activeQuoteId) ?? doc?.quotes[0];
  return quote ? lineItemsFromCalculator(quote) : null;
}

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
  const [shell, deal, proposal, templates, catalog, extras] = await Promise.all([
    getProjectShell(projectId),
    getProjectDeal(projectId),
    isNew ? null : getProposal(proposalId),
    getProposalTemplates(),
    getCatalogItems(),
    isNew ? null : getDocumentExtras("proposal", proposalId),
    requireStaff(),
  ]);
  if (!shell || !deal?.leadId) notFound();
  if (!isNew && (!proposal || proposal.leadId !== deal.leadId)) notFound();

  const [imported, count, companyDocuments, customerLanguage] = await Promise.all([
    !proposal || proposal.status === "draft" ? calculatorLines(projectId) : null,
    isNew ? getLeadProposals(deal.leadId).then((list) => list.length) : 0,
    extras ? getCompanyDocuments(extras.orgId) : [],
    getDealCustomerLanguage(deal.leadId),
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
        validUntil: proposal.validUntil,
      }
    : {
        name: template?.name ?? `Proposal ${count + 1}`,
        items: template?.items ?? [],
        taxRatePercent: template?.taxRatePercent ?? imported?.taxRatePercent ?? 13,
        depositPercent: template?.depositPercent ?? null,
        depositCents: template?.depositCents ?? null,
        discountPercent: template?.discountPercent ?? null,
        discountCents: template?.discountCents ?? null,
        packages: template?.packages ?? [],
        selectedPackageId: template?.selectedPackageId ?? null,
        intro: template?.intro ?? "",
        terms: template?.terms ?? "",
        validUntil: isoDaysFromToday(PROPOSAL_VALID_DAYS),
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
      templates={templates}
      catalog={catalog}
      extras={extras}
      companyDocuments={companyDocuments}
      calculatorLines={imported}
      initialTemplateId={template?.id ?? null}
      customerLanguage={customerLanguage}
      projectName={shell.name}
      backHref={`/jobs/${encodeURIComponent(projectId)}/proposals`}
      backLabel={shell.name}
    />
  );
}
