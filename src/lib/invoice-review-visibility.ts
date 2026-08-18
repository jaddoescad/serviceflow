export const HISTORICAL_ACCOUNTING_CUTOFF = "2026-06-01";

const NON_PAYABLE_DOCUMENT_STATUSES = new Set([
  "not_invoice",
  "supporting_document",
]);

type ReviewJob = {
  status?: string | null;
  started_on?: string | null;
  completed_on?: string | null;
};

type ReviewAllocation = {
  job?: ReviewJob | ReviewJob[] | null;
};

type ReviewInvoice = {
  direction?: string | null;
  category?: string | null;
  source_system?: string | null;
  status?: string | null;
  issued_on?: string | null;
  metadata?: Record<string, unknown> | null;
  allocations?: ReviewAllocation[] | null;
};

const CONTRACTOR_INVOICE_SOURCES = new Set([
  "labour_import",
  "gmail_labour_invoice",
  "gmail_labour_invoice_and_easyweb",
  "gmail_contractor_invoice",
]);

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLocaleLowerCase("en-CA").replace(/[\s-]+/g, "_")
    : "";
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function isBeforeCutoff(value: string | null | undefined, cutoff: string): boolean {
  return Boolean(value && value.slice(0, 10) < cutoff);
}

/** Evidence-only records remain available by direct URL, but never enter the payables queue. */
export function isPayableLabourInvoiceRecord(invoice: ReviewInvoice): boolean {
  const classifications = [
    invoice.status,
    invoice.metadata?.match_status,
    invoice.metadata?.document_type,
  ].map(normalize);

  return !classifications.some((value) =>
    NON_PAYABLE_DOCUMENT_STATUSES.has(value),
  );
}

/**
 * The contractor invoice inbox contains both job labour and legitimate company
 * expenses (commission, admin, pressure washing, and similar contractor bills).
 * Keep those expenses visible in the same review queue without reclassifying
 * them as labour or allowing them to affect job-cost percentages.
 */
export function isContractorInvoiceReviewRecord(invoice: ReviewInvoice): boolean {
  const direction = normalize(invoice.direction);
  const category = normalize(invoice.category);
  const sourceSystem = normalize(invoice.source_system);

  if (direction && direction !== "payable") return false;
  if (category === "labour") return isPayableLabourInvoiceRecord(invoice);
  return (
    category === "other" &&
    CONTRACTOR_INVOICE_SOURCES.has(sourceSystem) &&
    isPayableLabourInvoiceRecord(invoice)
  );
}

/**
 * Historical is a view-only classification. It never mutates an invoice or a job.
 * The invoice date catches unlinked imports; linked job dates enforce the accounting lock.
 */
export function isHistoricalLabourInvoice(
  invoice: ReviewInvoice,
  cutoff = HISTORICAL_ACCOUNTING_CUTOFF,
): boolean {
  if (isBeforeCutoff(invoice.issued_on, cutoff)) return true;

  return (invoice.allocations ?? []).some((allocation) => {
    const job = relatedOne(allocation.job);
    if (!job) return false;

    if (
      isBeforeCutoff(job.started_on, cutoff) ||
      isBeforeCutoff(job.completed_on, cutoff)
    ) {
      return true;
    }

    const status = normalize(job.status);
    return (
      (status === "completed" || status === "archived") &&
      !job.started_on &&
      !job.completed_on
    );
  });
}
