export type InvoiceJobAllocationIdentity = {
  invoice_id: string;
  invoice_line_id: string | null;
  job_id: string;
  metadata?: Record<string, unknown> | null;
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

export function isCostingInvoice(invoice: { status?: string | null }): boolean {
  return invoice.status !== "supporting_document";
}
