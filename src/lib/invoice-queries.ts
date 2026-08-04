import { createClient } from "@/lib/supabase/server";
import {
  getInvoiceEntries,
  getInvoiceEntriesForProject,
  type InvoiceEntryRecord,
} from "@/lib/invoice-entry-queries";

export type LabourInvoiceProjectLink = {
  companycam_project_id: string;
  allocated_amount: number | null;
  match_score: number;
  is_primary: boolean;
  needs_review: boolean;
  companycam_projects: {
    name: string;
    formatted_address: string | null;
    is_lead: boolean;
    is_archived: boolean;
  } | null;
};

export type LabourInvoiceRecord = {
  id: string;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string | null;
  source_date: string | null;
  currency: "CAD" | "USD";
  amount_paid: number | null;
  amount_before_tax: number | null;
  tax_amount: number | null;
  document_type: string;
  match_status: string;
  original_filename: string;
  storage_path: string;
  duplicate_group_id: string | null;
  duplicate_group_size: number;
  signed_url: string | null;
  paid_amount: number;
  payment_status: "paid" | "partially_paid" | "unpaid" | "overpaid";
  verification_status: "needs_information" | "needs_review" | "verified";
  labour_invoice_projects: LabourInvoiceProjectLink[];
};

type StoredLabourInvoiceRecord = Omit<
  LabourInvoiceRecord,
  "signed_url" | "paid_amount" | "payment_status" | "verification_status"
>;

export type ProjectLabourInvoiceSummary = {
  invoiceCount: number;
  entryCount: number;
  linkedFileCount: number;
  historicalLinkedFileCount: number;
  totals: Record<"CAD" | "USD", number>;
  confirmedPaidTotals: Record<"CAD" | "USD", number>;
  confirmedUnpaidTotals: Record<"CAD" | "USD", number>;
  partialSettlementTotals: Record<"CAD" | "USD", number>;
  paymentEvidenceCount: number;
  /** First invoice date included in the current job cycle, when configured. */
  jobStartedOn: string | null;
  /** Latest date printed on a selected invoice, not its email/source date. */
  latestInvoiceDate: string | null;
  hasDuplicateVersions: boolean;
  hasUnallocatedSharedInvoices: boolean;
  unallocatedSharedInvoiceCount: number;
  needsReview: boolean;
};

const emptyTotals = (): Record<"CAD" | "USD", number> => ({
  CAD: 0,
  USD: 0,
});

async function queryLabourInvoices(): Promise<StoredLabourInvoiceRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("labour_invoices")
    .select(
      `
        id,
        supplier_name,
        invoice_number,
        invoice_date,
        source_date,
        currency,
        amount_paid,
        amount_before_tax,
        tax_amount,
        document_type,
        match_status,
        original_filename,
        storage_path,
        duplicate_group_id,
        duplicate_group_size,
        labour_invoice_projects (
          companycam_project_id,
          allocated_amount,
          match_score,
          is_primary,
          needs_review,
          companycam_projects (
            name,
            formatted_address,
            is_lead,
            is_archived
          )
        )
      `,
    )
    .order("invoice_date", { ascending: false, nullsFirst: false })
    .order("original_filename", { ascending: true })
    .limit(1000);

  if (error) throw error;
  return (data ?? []) as unknown as StoredLabourInvoiceRecord[];
}

async function queryLabourInvoiceJobStarts(): Promise<Map<string, string>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_budgets")
    .select("companycam_project_id,labour_invoice_job_started_on")
    .not("labour_invoice_job_started_on", "is", null);

  if (error) throw error;
  return new Map(
    (data ?? []).flatMap((row) =>
      row.labour_invoice_job_started_on
        ? [[row.companycam_project_id, row.labour_invoice_job_started_on] as const]
        : [],
    ),
  );
}

async function addSignedUrls(
  invoices: StoredLabourInvoiceRecord[],
): Promise<LabourInvoiceRecord[]> {
  if (!invoices.length) return [];

  const supabase = await createClient();
  const [signed, verificationByInvoice] = await Promise.all([
    supabase.storage
      .from("labour-invoices")
      .createSignedUrls(
        invoices.map((invoice) => invoice.storage_path),
        60 * 60,
      ),
    queryLabourInvoiceVerifications(),
  ]);

  const urlByPath = new Map(
    (signed.data ?? []).map((item) => [item.path, item.signedUrl]),
  );

  return invoices.map((invoice) => ({
    ...invoice,
    signed_url: urlByPath.get(invoice.storage_path) ?? null,
    paid_amount: verificationByInvoice.get(invoice.id)?.paid_amount ?? 0,
    payment_status:
      verificationByInvoice.get(invoice.id)?.payment_status ?? "unpaid",
    verification_status:
      verificationByInvoice.get(invoice.id)?.verification_status ??
      "needs_information",
    labour_invoice_projects: [...invoice.labour_invoice_projects].sort(
      (left, right) =>
        Number(right.is_primary) - Number(left.is_primary) ||
        right.match_score - left.match_score,
    ),
  }));
}

async function queryLabourInvoiceVerifications() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("labour_invoice_verification")
    .select("invoice_id,paid_amount,payment_status,verification_status");
  if (error) throw error;

  return new Map(
    (data ?? []).map((row) => [
      row.invoice_id,
      {
        paid_amount: Number(row.paid_amount),
        payment_status:
          row.payment_status as LabourInvoiceRecord["payment_status"],
        verification_status:
          row.verification_status as LabourInvoiceRecord["verification_status"],
      },
    ]),
  );
}

export async function getLabourInvoices(): Promise<LabourInvoiceRecord[]> {
  return addSignedUrls(await queryLabourInvoices());
}

export async function getLabourInvoicesForProject(
  projectId: string,
): Promise<LabourInvoiceRecord[]> {
  const invoices = (await queryLabourInvoices()).filter(
    (invoice) =>
      invoice.document_type === "invoice" &&
      invoice.labour_invoice_projects.some(
        (link) => link.companycam_project_id === projectId,
      ),
  );
  return addSignedUrls(invoices);
}

export function summarizeProjectInvoiceEntries(
  entries: InvoiceEntryRecord[],
  projectId: string,
  jobStartedOn: string | null = null,
): ProjectLabourInvoiceSummary {
  const allLinkedEntries = entries.filter((entry) =>
    entry.jobs.some((job) => job.companycam_project_id === projectId),
  );
  const linkedEntries = allLinkedEntries.filter((entry) =>
    isInvoiceInCurrentJob(entry.invoice, jobStartedOn),
  );
  const totals = emptyTotals();
  const confirmedPaidTotals = emptyTotals();
  const confirmedUnpaidTotals = emptyTotals();
  const partialSettlementTotals = emptyTotals();
  const paymentIds = new Set<string>();

  for (const entry of linkedEntries) {
    const projectAllocation = entry.jobs.find(
      (job) => job.companycam_project_id === projectId,
    );
    if (!projectAllocation) continue;

    const amount = Number(projectAllocation.allocated_amount);
    const currency = entry.invoice.currency;
    totals[currency] += amount;
    if (
      entry.invoice.payment_status === "paid" ||
      entry.invoice.payment_status === "overpaid"
    ) {
      confirmedPaidTotals[currency] += amount;
    } else if (entry.invoice.payment_status === "unpaid") {
      confirmedUnpaidTotals[currency] += amount;
    } else {
      partialSettlementTotals[currency] += amount;
    }
    for (const payment of entry.invoice.payments) {
      paymentIds.add(payment.financial_transaction_id);
    }
  }

  const currentInvoiceIds = new Set(
    linkedEntries.map((entry) => entry.invoice_id),
  );
  const currentInvoices = new Map(
    linkedEntries.map((entry) => [entry.invoice_id, entry.invoice]),
  );
  const historicalInvoiceIds = new Set(
    allLinkedEntries
      .filter((entry) => !isInvoiceInCurrentJob(entry.invoice, jobStartedOn))
      .map((entry) => entry.invoice_id),
  );

  return {
    invoiceCount: currentInvoiceIds.size,
    entryCount: linkedEntries.length,
    linkedFileCount: [...currentInvoices.values()].reduce(
      (total, invoice) =>
        total + Math.max(1, Number(invoice.duplicate_group_size)),
      0,
    ),
    historicalLinkedFileCount: historicalInvoiceIds.size,
    totals,
    confirmedPaidTotals,
    confirmedUnpaidTotals,
    partialSettlementTotals,
    paymentEvidenceCount: paymentIds.size,
    jobStartedOn,
    latestInvoiceDate:
      linkedEntries
        .map((entry) => entry.invoice.invoice_date)
        .filter((date): date is string => Boolean(date))
        .sort()
        .at(-1) ?? null,
    hasDuplicateVersions: linkedEntries.some(
      (entry) => entry.invoice.duplicate_group_size > 1,
    ),
    hasUnallocatedSharedInvoices: false,
    unallocatedSharedInvoiceCount: 0,
    needsReview: linkedEntries.some((entry) => {
      const projectAllocation = entry.jobs.find(
        (job) => job.companycam_project_id === projectId,
      );
      return (
        entry.needs_review ||
        projectAllocation?.needs_review ||
        entry.invoice.verification_status !== "verified"
      );
    }),
  };
}

export async function getProjectLabourInvoiceSummaries(): Promise<
  Map<string, ProjectLabourInvoiceSummary>
> {
  const [entries, jobStarts] = await Promise.all([
    getInvoiceEntries(),
    queryLabourInvoiceJobStarts(),
  ]);
  const projectIds = new Set(
    entries.flatMap((entry) =>
      entry.jobs.map((job) => job.companycam_project_id),
    ),
  );

  return new Map(
    [...projectIds].map((projectId) => [
      projectId,
      summarizeProjectInvoiceEntries(
        entries,
        projectId,
        jobStarts.get(projectId) ?? null,
      ),
    ]),
  );
}

export async function getProjectLabourInvoiceSummary(
  projectId: string,
): Promise<ProjectLabourInvoiceSummary> {
  const [entries, jobStarts] = await Promise.all([
    getInvoiceEntriesForProject(projectId),
    queryLabourInvoiceJobStarts(),
  ]);
  return summarizeProjectInvoiceEntries(
    entries,
    projectId,
    jobStarts.get(projectId) ?? null,
  );
}

export function isInvoiceInCurrentJob(
  invoice: Pick<LabourInvoiceRecord, "invoice_date" | "source_date">,
  jobStartedOn: string | null,
): boolean {
  if (!jobStartedOn) return true;
  const invoiceDate = invoice.invoice_date ?? invoice.source_date;
  return invoiceDate == null || invoiceDate >= jobStartedOn;
}

export function emptyProjectLabourInvoiceSummary(): ProjectLabourInvoiceSummary {
  return {
    invoiceCount: 0,
    entryCount: 0,
    linkedFileCount: 0,
    historicalLinkedFileCount: 0,
    totals: emptyTotals(),
    confirmedPaidTotals: emptyTotals(),
    confirmedUnpaidTotals: emptyTotals(),
    partialSettlementTotals: emptyTotals(),
    paymentEvidenceCount: 0,
    jobStartedOn: null,
    latestInvoiceDate: null,
    hasDuplicateVersions: false,
    hasUnallocatedSharedInvoices: false,
    unallocatedSharedInvoiceCount: 0,
    needsReview: false,
  };
}
