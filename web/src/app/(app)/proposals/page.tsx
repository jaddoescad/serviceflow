import { DuplicateProposalButton } from "@/components/duplicate-proposal";
import { PageHeader } from "@/components/kpi";
import {
  DataTable,
  FilterPills,
  RowLink,
  TablePanel,
  TableToolbar,
  Td,
  Th,
  Tr,
  rowActionClassName,
  statusFilterOptions,
} from "@/components/table-ui";
import { Badge, EmptyState } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { fmtCents } from "@/lib/line-items";
import {
  PROPOSAL_STATUS_LABELS,
  PROPOSAL_STATUS_TONES,
  proposalDisplayStatus,
  type ProposalStatus,
} from "@/lib/proposal-types";
import { listProposals } from "@/lib/proposals";
import { ProposalsTabs } from "./tabs";

export const dynamic = "force-dynamic";

const FILTERS: ProposalStatus[] = ["draft", "sent", "accepted", "declined"];

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: requested } = await searchParams;
  const status = FILTERS.find((value) => value === requested) ?? null;
  const [, proposals] = await Promise.all([
    requireStaff(),
    listProposals(status),
  ]);
  return (
    <div className="page-fill">
      <PageHeader title="Proposals" />
      <ProposalsTabs active="proposals" />
      <TableToolbar>
        <FilterPills
          label="Proposal status"
          value={status ?? "all"}
          options={statusFilterOptions(
            "/proposals",
            FILTERS,
            (value) => PROPOSAL_STATUS_LABELS[value],
          )}
        />
      </TableToolbar>
      <TablePanel fill>
        <DataTable minWidth={760}>
          <thead>
            <tr>
              <Th>Customer</Th>
              <Th>Proposal</Th>
              <Th>Status</Th>
              <Th numeric>Amount</Th>
              <Th numeric>Sent</Th>
              <Th numeric>Viewed</Th>
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
                    <RowLink
                      href={`/jobs/${encodeURIComponent(proposal.projectId)}/proposals/${proposal.id}`}
                    >
                      {proposal.customerName}
                    </RowLink>
                  </Td>
                  <Td muted>{proposal.name}</Td>
                  <Td>
                    <Badge tone={PROPOSAL_STATUS_TONES[shown]}>
                      {PROPOSAL_STATUS_LABELS[shown]}
                    </Badge>
                  </Td>
                  <Td numeric>{fmtCents(proposal.amountCents)}</Td>
                  <Td numeric muted>
                    {proposal.sentAt ? fmtDate(proposal.sentAt) : "—"}
                  </Td>
                  <Td numeric muted>
                    {proposal.viewedAt ? fmtDate(proposal.viewedAt) : "—"}
                  </Td>
                  <Td className="w-px text-right">
                    {proposal.source === "proposal" ? (
                      <DuplicateProposalButton
                        proposalId={proposal.id}
                        projectId={proposal.projectId}
                        projectName={proposal.customerName}
                        className={rowActionClassName}
                      />
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </DataTable>
        {proposals.length ? null : (
          <EmptyState>
            {status
              ? `No ${PROPOSAL_STATUS_LABELS[status].toLowerCase()} proposals.`
              : "No proposals yet."}
          </EmptyState>
        )}
      </TablePanel>
    </div>
  );
}
