import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DuplicateProposalButton } from "@/components/duplicate-proposal";
import { JobShell } from "@/components/job-shell";
import {
  DataTable,
  RowLink,
  TablePanel,
  Td,
  Th,
  Tr,
} from "@/components/table-ui";
import { Badge, EmptyState, buttonClassName } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { fmtCents } from "@/lib/line-items";
import { getProjectShell } from "@/lib/project-data";
import {
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_STATUS_TONES,
  proposalDisplayStatus,
} from "@/lib/proposal-types";
import { getLeadProposals, getProjectDeal } from "@/lib/proposals";

export const dynamic = "force-dynamic";

export default async function ProjectProposalsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const projectId = decodeURIComponent(id);
  const [shell, deal] = await Promise.all([
    getProjectShell(projectId),
    getProjectDeal(projectId),
    requireStaff(),
  ]);
  if (!shell || !deal) notFound();
  if (shell.canonicalJobId)
    redirect(`/jobs/${encodeURIComponent(shell.canonicalJobId)}/proposals`);
  const proposals = deal.leadId ? await getLeadProposals(deal.leadId) : [];
  const base = `/jobs/${encodeURIComponent(projectId)}/proposals`;
  return (
    <JobShell
      projectId={projectId}
      name={shell.name}
      address={shell.address}
      status={shell.status}
      photoCount={shell.photoCount}
      isLead={shell.isLead}
      activeTab="proposals"
      actions={
        deal.leadId ? (
          <Link href={`${base}/new`} className={buttonClassName()}>
            + New Proposal
          </Link>
        ) : null
      }
    >
      {deal.leadId ? (
        <TablePanel>
          <DataTable minWidth={560}>
            <thead>
              <tr>
                <Th>Proposal</Th>
                <Th>Status</Th>
                <Th numeric>Sent / updated</Th>
                <Th numeric>Amount</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((proposal) => {
                const shown = proposalDisplayStatus(
                  proposal.status,
                  proposal.validUntil,
                );
                return (
                  <Tr key={proposal.id}>
                    <Td>
                      <RowLink href={`${base}/${proposal.id}`}>
                        {proposal.name}
                      </RowLink>
                    </Td>
                    <Td>
                      <Badge tone={PROPOSAL_STATUS_TONES[shown]}>
                        {PROPOSAL_STATUS_LABELS[shown]}
                      </Badge>
                    </Td>
                    <Td numeric muted>
                      {proposal.sentAt
                        ? `Sent ${fmtDate(proposal.sentAt)}`
                        : `Updated ${fmtDate(proposal.updatedAt)}`}
                    </Td>
                    <Td numeric>{fmtCents(proposal.amountCents)}</Td>
                    <Td className="w-px text-right">
                      {proposal.source === "proposal" ? (
                        <DuplicateProposalButton
                          proposalId={proposal.id}
                          projectId={projectId}
                          projectName={shell.name}
                        />
                      ) : null}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </DataTable>
          {proposals.length ? null : <EmptyState>No proposals yet.</EmptyState>}
        </TablePanel>
      ) : (
        <EmptyState>
          Proposals start from a deal. This project was created without one.
        </EmptyState>
      )}
    </JobShell>
  );
}
