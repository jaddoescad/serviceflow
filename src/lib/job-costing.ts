import { createClient } from "@/lib/supabase/server";
import {
  budgetStatus,
  LABOUR_ALERT_PERCENT,
  LABOUR_MAX_PERCENT,
  LABOUR_MIN_PERCENT,
  type LabourBucket,
  type ProjectRollup,
} from "@/lib/metrics";
import type { ProjectLabourInvoiceSummary } from "@/lib/invoice-queries";
import type { ProjectMaterialSummary } from "@/lib/materials";

export type JobAccountingSummary = {
  jobProposalId: string;
  canonicalProjectId: string | null;
  jobName: string;
  jobStatus: string;
  proposalSignedOn: string | null;
  jobStartOn: string | null;
  jobCompletionOn: string | null;
  bookedRevenueBeforeHst: number;
  supplierCostBeforeHst: number;
  materialCostBeforeHst: number;
};

export type JobCostingIdentity = {
  accountingByProposal: Map<string, JobAccountingSummary>;
  proposalsByProject: Map<string, string[]>;
  materialLineCountByProposal: Map<string, number>;
};

export type JobCostedProjectRow = ProjectRollup & {
  labourInvoices: ProjectLabourInvoiceSummary;
  materials: ProjectMaterialSummary;
};

type RawAccountingRow = {
  job_proposal_id: string;
  companycam_project_id: string | null;
  job_name: string;
  job_status: string;
  proposal_signed_on: string | null;
  job_start_on: string | null;
  job_completion_on: string | null;
  booked_revenue_before_hst: number;
  supplier_cost_before_hst: number;
  material_cost_before_hst: number;
};

type RawProjectLink = {
  job_proposal_id: string;
  companycam_project_id: string;
};

type RawCostLink = {
  job_proposal_id: string;
  cost_type: "labour" | "material";
};

const emptyIdentity = (): JobCostingIdentity => ({
  accountingByProposal: new Map(),
  proposalsByProject: new Map(),
  materialLineCountByProposal: new Map(),
});

export async function getJobCostingIdentity(
  canReadAccounting: boolean,
): Promise<JobCostingIdentity> {
  if (!canReadAccounting) return emptyIdentity();
  const supabase = await createClient();
  const [accountingResult, projectLinkResult, costLinkResult] = await Promise.all([
    supabase.rpc("read_job_accounting_reconciliation", {
      p_companycam_project_id: null,
    }),
    supabase
      .from("job_project_links")
      .select("job_proposal_id,companycam_project_id")
      .eq("link_status", "confirmed"),
    supabase
      .from("job_cost_allocation_links")
      .select("job_proposal_id,cost_type")
      .eq("cost_type", "material"),
  ]);
  if (accountingResult.error) throw accountingResult.error;
  if (projectLinkResult.error) throw projectLinkResult.error;
  if (costLinkResult.error) throw costLinkResult.error;

  const accountingByProposal = new Map<string, JobAccountingSummary>();
  for (const raw of (accountingResult.data ?? []) as RawAccountingRow[]) {
    accountingByProposal.set(raw.job_proposal_id, {
      jobProposalId: raw.job_proposal_id,
      canonicalProjectId: raw.companycam_project_id,
      jobName: raw.job_name,
      jobStatus: raw.job_status,
      proposalSignedOn: raw.proposal_signed_on,
      jobStartOn: raw.job_start_on,
      jobCompletionOn: raw.job_completion_on,
      bookedRevenueBeforeHst: Number(raw.booked_revenue_before_hst ?? 0),
      supplierCostBeforeHst: Number(raw.supplier_cost_before_hst ?? 0),
      materialCostBeforeHst: Number(raw.material_cost_before_hst ?? 0),
    });
  }

  const proposalsByProject = new Map<string, string[]>();
  for (const link of (projectLinkResult.data ?? []) as RawProjectLink[]) {
    const proposals = proposalsByProject.get(link.companycam_project_id) ?? [];
    if (!proposals.includes(link.job_proposal_id)) {
      proposals.push(link.job_proposal_id);
      proposalsByProject.set(link.companycam_project_id, proposals);
    }
  }

  const materialLineCountByProposal = new Map<string, number>();
  for (const link of (costLinkResult.data ?? []) as RawCostLink[]) {
    if (link.cost_type !== "material") continue;
    materialLineCountByProposal.set(
      link.job_proposal_id,
      (materialLineCountByProposal.get(link.job_proposal_id) ?? 0) + 1,
    );
  }

  return {
    accountingByProposal,
    proposalsByProject,
    materialLineCountByProposal,
  };
}

function timestamp(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latest(values: Array<string | null>): string | null {
  return values.reduce<string | null>((winner, value) =>
    timestamp(value) > timestamp(winner) ? value : winner,
  null);
}

function newestProposal(
  proposals: string[],
  accountingByProposal: ReadonlyMap<string, JobAccountingSummary>,
): string | null {
  return [...proposals]
    .sort((left, right) => {
      const leftJob = accountingByProposal.get(left);
      const rightJob = accountingByProposal.get(right);
      const leftDate = timestamp(
        leftJob?.jobCompletionOn ??
          leftJob?.jobStartOn ??
          leftJob?.proposalSignedOn ??
          null,
      );
      const rightDate = timestamp(
        rightJob?.jobCompletionOn ??
          rightJob?.jobStartOn ??
          rightJob?.proposalSignedOn ??
          null,
      );
      return rightDate - leftDate || right.localeCompare(left, "en-CA", { numeric: true });
    })[0] ?? null;
}

function addTotals(
  rows: JobCostedProjectRow[],
  field: "totals" | "confirmedPaidTotals" | "confirmedUnpaidTotals" | "partialSettlementTotals",
) {
  return rows.reduce(
    (totals, row) => ({
      CAD: totals.CAD + row.labourInvoices[field].CAD,
      USD: totals.USD + row.labourInvoices[field].USD,
    }),
    { CAD: 0, USD: 0 },
  );
}

function combineInvoiceSummaries(
  rows: JobCostedProjectRow[],
): ProjectLabourInvoiceSummary {
  return {
    invoiceCount: rows.reduce((sum, row) => sum + row.labourInvoices.invoiceCount, 0),
    entryCount: rows.reduce((sum, row) => sum + row.labourInvoices.entryCount, 0),
    linkedFileCount: rows.reduce((sum, row) => sum + row.labourInvoices.linkedFileCount, 0),
    historicalLinkedFileCount: rows.reduce(
      (sum, row) => sum + row.labourInvoices.historicalLinkedFileCount,
      0,
    ),
    totals: addTotals(rows, "totals"),
    confirmedPaidTotals: addTotals(rows, "confirmedPaidTotals"),
    confirmedUnpaidTotals: addTotals(rows, "confirmedUnpaidTotals"),
    partialSettlementTotals: addTotals(rows, "partialSettlementTotals"),
    paymentEvidenceCount: rows.reduce(
      (sum, row) => sum + row.labourInvoices.paymentEvidenceCount,
      0,
    ),
    jobStartedOn: rows
      .map((row) => row.labourInvoices.jobStartedOn)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null,
    latestInvoiceDate: latest(
      rows.map((row) => row.labourInvoices.latestInvoiceDate),
    ),
    hasDuplicateVersions: rows.some(
      (row) => row.labourInvoices.hasDuplicateVersions,
    ),
    hasUnallocatedSharedInvoices: rows.some(
      (row) => row.labourInvoices.hasUnallocatedSharedInvoices,
    ),
    unallocatedSharedInvoiceCount: rows.reduce(
      (sum, row) => sum + row.labourInvoices.unallocatedSharedInvoiceCount,
      0,
    ),
    needsReview: rows.some((row) => row.labourInvoices.needsReview),
  };
}

function labourBucket(input: {
  excluded: boolean;
  amount: number | null;
  cost: number;
  closedAt: string | null;
}): LabourBucket {
  if (input.excluded) return "excluded";
  if (input.amount == null || input.amount <= 0) {
    return input.cost > 0 ? "missing_amount" : "idle";
  }
  if (input.cost <= 0) return "not_costed";
  return input.closedAt ? "settled" : "in_flight";
}

function mergeProposalRows(
  proposalId: string,
  rows: JobCostedProjectRow[],
  identity: JobCostingIdentity,
): JobCostedProjectRow {
  const accounting = identity.accountingByProposal.get(proposalId);
  const canonicalProjectId =
    accounting?.canonicalProjectId ?? `dripjobs-${proposalId}`;
  const representative =
    rows.find((row) => row.projectId === canonicalProjectId) ??
    [...rows].sort(
      (left, right) =>
        Number(right.amountBeforeTax != null) - Number(left.amountBeforeTax != null) ||
        timestamp(right.lastActivity) - timestamp(left.lastActivity),
    )[0];
  const amountCandidates = rows
    .map((row) => row.amountBeforeTax)
    .filter((value): value is number => value != null);
  const amountBeforeTax =
    accounting && accounting.bookedRevenueBeforeHst > 0
      ? accounting.bookedRevenueBeforeHst
      : amountCandidates.length > 0
        ? Math.max(...amountCandidates)
        : null;
  const invoiceCost = accounting?.supplierCostBeforeHst ?? 0;
  const clockedWageCost = rows.reduce(
    (sum, row) => sum + row.clockedWageCost,
    0,
  );
  const wageCost = invoiceCost > 0 ? invoiceCost : clockedWageCost;
  const wageSharePercent =
    amountBeforeTax && amountBeforeTax > 0
      ? (wageCost / amountBeforeTax) * 100
      : null;
  const labourAllowanceLow =
    amountBeforeTax == null ? null : amountBeforeTax * (LABOUR_MIN_PERCENT / 100);
  const labourAllowanceHigh =
    amountBeforeTax == null ? null : amountBeforeTax * (LABOUR_MAX_PERCENT / 100);
  const labourClosedAt = latest(rows.map((row) => row.labourClosedAt));
  const loggedHours = rows.reduce((sum, row) => sum + row.loggedHours, 0);
  const budgetedValues = rows
    .map((row) => row.budgetedHours)
    .filter((value): value is number => value != null);
  const budgetedHours =
    budgetedValues.length > 0 ? Math.max(...budgetedValues) : null;
  const labourExcluded = rows.every((row) => row.labourExcluded);

  return {
    ...representative,
    projectId: canonicalProjectId,
    name: accounting?.jobName ?? representative.name,
    address: rows.find((row) => row.address)?.address ?? representative.address,
    labourExcluded,
    loggedHours,
    budgetedHours,
    amountBeforeTax,
    remainingHours:
      budgetedHours == null ? null : budgetedHours - loggedHours,
    percentUsed:
      labourAllowanceHigh && labourAllowanceHigh > 0
        ? (wageCost / labourAllowanceHigh) * 100
        : null,
    status: budgetStatus(wageSharePercent),
    laborCost: wageCost,
    budgetCost: labourAllowanceHigh,
    labourAllowanceLow,
    labourAllowanceHigh,
    clockedWageCost,
    labourCostSource: invoiceCost > 0 ? "invoices" : "clocked_hours",
    wageCost,
    wageSharePercent,
    allowanceUsedLowPercent:
      labourAllowanceLow && labourAllowanceLow > 0
        ? (wageCost / labourAllowanceLow) * 100
        : null,
    allowanceUsedHighPercent:
      labourAllowanceHigh && labourAllowanceHigh > 0
        ? (wageCost / labourAllowanceHigh) * 100
        : null,
    remainingLabourLow:
      labourAllowanceLow == null ? null : labourAllowanceLow - wageCost,
    remainingLabourHigh:
      labourAllowanceHigh == null ? null : labourAllowanceHigh - wageCost,
    unpricedHours: rows.reduce((sum, row) => sum + row.unpricedHours, 0),
    assignedCount: rows.reduce((sum, row) => sum + row.assignedCount, 0),
    lastActivity: latest(rows.map((row) => row.lastActivity)),
    lastClockIn: latest(rows.map((row) => row.lastClockIn)),
    clockedHours: rows.reduce((sum, row) => sum + row.clockedHours, 0),
    invoicedHours: rows.reduce((sum, row) => sum + row.invoicedHours, 0),
    fixedLabourCost: invoiceCost,
    expenseCount: rows.reduce((sum, row) => sum + row.expenseCount, 0),
    labourClosedAt,
    labourBucket: labourBucket({
      excluded: labourExcluded,
      amount: amountBeforeTax,
      cost: wageCost,
      closedAt: labourClosedAt,
    }),
    labourInvoices: combineInvoiceSummaries(rows),
    materials: {
      amountBeforeTax: accounting?.materialCostBeforeHst ?? 0,
      lineCount: identity.materialLineCountByProposal.get(proposalId) ?? 0,
    },
  };
}

export function mergeProjectRowsByJobIdentity(
  rows: JobCostedProjectRow[],
  identity: JobCostingIdentity,
): JobCostedProjectRow[] {
  if (identity.accountingByProposal.size === 0) return rows;
  const grouped = new Map<string, JobCostedProjectRow[]>();
  const unlinked = [];

  for (const row of rows) {
    const proposals = identity.proposalsByProject.get(row.projectId) ?? [];
    const canonicalProposal = proposals.find(
      (proposalId) =>
        identity.accountingByProposal.get(proposalId)?.canonicalProjectId ===
        row.projectId,
    );
    const proposalId =
      canonicalProposal ??
      (proposals.length === 1
        ? proposals[0]
        : newestProposal(proposals, identity.accountingByProposal));
    if (!proposalId) {
      unlinked.push(row);
      continue;
    }
    const proposalRows = grouped.get(proposalId) ?? [];
    proposalRows.push(row);
    grouped.set(proposalId, proposalRows);
  }

  return [
    ...[...grouped.entries()].map(([proposalId, proposalRows]) =>
      mergeProposalRows(proposalId, proposalRows, identity),
    ),
    ...unlinked,
  ];
}
