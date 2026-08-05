export type InvoiceJobAllocationIdentity = {
  invoice_id: string;
  invoice_line_id: string | null;
  job_id: string;
  metadata?: Record<string, unknown> | null;
};

type CostingInvoice = {
  category?: string | null;
  source_system?: string | null;
  status?: string | null;
};

type CostingInvoiceJobAllocationIdentity = InvoiceJobAllocationIdentity & {
  invoice?: CostingInvoice | CostingInvoice[] | null;
};

function pairKey(invoiceId: string, jobId: string): string {
  return `${invoiceId}\u0000${jobId}`;
}

/**
 * Invoice-level allocations preserve the original coarse job link while
 * line-level allocations preserve the detailed costing. When both exist for
 * the same invoice and job, only the line allocations are financial rows.
 */
export function selectUsableInvoiceJobAllocations<
  T extends InvoiceJobAllocationIdentity,
>(allocations: readonly T[]): T[] {
  const activeAllocations = allocations.filter(
    (allocation) => !allocation.metadata?.reversed_at,
  );
  const pairsWithLineAllocations = new Set<string>();

  for (const allocation of activeAllocations) {
    if (allocation.invoice_line_id) {
      pairsWithLineAllocations.add(
        pairKey(allocation.invoice_id, allocation.job_id),
      );
    }
  }

  return activeAllocations.filter(
    (allocation) =>
      Boolean(allocation.invoice_line_id) ||
      !pairsWithLineAllocations.has(
        pairKey(allocation.invoice_id, allocation.job_id),
      ),
  );
}

const NON_COSTING_INVOICE_STATUSES = new Set([
  "not_invoice",
  "overhead_unmatched",
  "supporting_document",
]);

/** Evidence-only documents must never contribute to a job's cost. */
export function isCostingInvoice(invoice: { status?: string | null }): boolean {
  return !invoice.status || !NON_COSTING_INVOICE_STATUSES.has(invoice.status);
}

function relatedInvoice(
  allocation: CostingInvoiceJobAllocationIdentity,
): CostingInvoice | null {
  return Array.isArray(allocation.invoice)
    ? allocation.invoice[0] ?? null
    : allocation.invoice ?? null;
}

/**
 * Select job-cost rows after evidence filtering. Migrated direct labour
 * expenses are legacy fallbacks, so an archived labour invoice for the same
 * job supersedes every direct-expense row on that job.
 */
export function selectCostingInvoiceJobAllocations<
  T extends CostingInvoiceJobAllocationIdentity,
>(allocations: readonly T[]): T[] {
  const costing = selectUsableInvoiceJobAllocations(allocations).filter(
    (allocation) => {
      const invoice = relatedInvoice(allocation);
      return invoice && isCostingInvoice(invoice);
    },
  );
  const jobsWithArchivedLabour = new Set(
    costing.flatMap((allocation) => {
      const invoice = relatedInvoice(allocation);
      return invoice?.category === "labour" &&
        invoice.source_system !== "direct_labour_expense"
        ? [allocation.job_id]
        : [];
    }),
  );

  return costing.filter((allocation) => {
    const invoice = relatedInvoice(allocation);
    return !(
      invoice?.category === "labour" &&
      invoice.source_system === "direct_labour_expense" &&
      jobsWithArchivedLabour.has(allocation.job_id)
    );
  });
}
