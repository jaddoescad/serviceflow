import { createClient } from "@/lib/supabase/server";

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
  labour_invoice_projects: LabourInvoiceProjectLink[];
};

type StoredLabourInvoiceRecord = Omit<LabourInvoiceRecord, "signed_url">;

export type ProjectLabourInvoiceSummary = {
  invoiceCount: number;
  linkedFileCount: number;
  historicalLinkedFileCount: number;
  totals: Record<"CAD" | "USD", number>;
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
  const signed = await supabase.storage
    .from("labour-invoices")
    .createSignedUrls(
      invoices.map((invoice) => invoice.storage_path),
      60 * 60,
    );

  const urlByPath = new Map(
    (signed.data ?? []).map((item) => [item.path, item.signedUrl]),
  );

  return invoices.map((invoice) => ({
    ...invoice,
    signed_url: urlByPath.get(invoice.storage_path) ?? null,
    labour_invoice_projects: [...invoice.labour_invoice_projects].sort(
      (left, right) =>
        Number(right.is_primary) - Number(left.is_primary) ||
        right.match_score - left.match_score,
    ),
  }));
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

function compareInvoiceVersions(
  left: StoredLabourInvoiceRecord,
  right: StoredLabourInvoiceRecord,
): number {
  const leftDate = left.source_date ?? left.invoice_date ?? "";
  const rightDate = right.source_date ?? right.invoice_date ?? "";
  return (
    leftDate.localeCompare(rightDate) ||
    Number(left.amount_before_tax ?? 0) - Number(right.amount_before_tax ?? 0) ||
    left.original_filename.localeCompare(right.original_filename, "en-CA")
  );
}

export function summarizeProjectLabourInvoices(
  invoices: Array<StoredLabourInvoiceRecord | LabourInvoiceRecord>,
  projectId: string,
  jobStartedOn: string | null = null,
): ProjectLabourInvoiceSummary {
  const allLinkedInvoices = invoices
    .filter(
      (invoice) =>
        invoice.document_type === "invoice" &&
        invoice.amount_before_tax != null &&
        invoice.labour_invoice_projects.some(
          (link) => link.companycam_project_id === projectId,
        ),
    )
    .map((invoice) => ({
      invoice,
      projectLink: invoice.labour_invoice_projects.find(
        (link) => link.companycam_project_id === projectId,
      )!,
    }));
  const linkedInvoices = allLinkedInvoices.filter(({ invoice }) =>
    isInvoiceInCurrentJob(invoice, jobStartedOn),
  );

  const versionGroups = new Map<string, typeof linkedInvoices>();
  for (const linkedInvoice of linkedInvoices) {
    const key =
      linkedInvoice.invoice.duplicate_group_id ?? linkedInvoice.invoice.id;
    const group = versionGroups.get(key) ?? [];
    group.push(linkedInvoice);
    versionGroups.set(key, group);
  }

  const selected = [...versionGroups.values()].map((group) =>
    [...group].sort((left, right) =>
      compareInvoiceVersions(left.invoice, right.invoice),
    ).at(-1)!,
  );

  const totals = emptyTotals();
  let unallocatedSharedInvoiceCount = 0;
  for (const { invoice, projectLink } of selected) {
    const isShared = invoice.labour_invoice_projects.length > 1;
    if (isShared && projectLink.allocated_amount == null) {
      unallocatedSharedInvoiceCount += 1;
      continue;
    }
    totals[invoice.currency] += Number(
      projectLink.allocated_amount ?? invoice.amount_before_tax ?? 0,
    );
  }

  return {
    invoiceCount: selected.length,
    linkedFileCount: linkedInvoices.length,
    historicalLinkedFileCount:
      allLinkedInvoices.length - linkedInvoices.length,
    totals,
    jobStartedOn,
    latestInvoiceDate:
      selected
        .map(({ invoice }) => invoice.invoice_date)
        .filter((date): date is string => Boolean(date))
        .sort()
        .at(-1) ?? null,
    hasDuplicateVersions: linkedInvoices.length > selected.length,
    hasUnallocatedSharedInvoices: unallocatedSharedInvoiceCount > 0,
    unallocatedSharedInvoiceCount,
    needsReview: selected.some(({ projectLink }) => projectLink.needs_review),
  };
}

export async function getProjectLabourInvoiceSummaries(): Promise<
  Map<string, ProjectLabourInvoiceSummary>
> {
  const [invoices, jobStarts] = await Promise.all([
    queryLabourInvoices(),
    queryLabourInvoiceJobStarts(),
  ]);
  const projectIds = new Set(
    invoices.flatMap((invoice) =>
      invoice.labour_invoice_projects.map(
        (link) => link.companycam_project_id,
      ),
    ),
  );

  return new Map(
    [...projectIds].map((projectId) => [
      projectId,
      summarizeProjectLabourInvoices(
        invoices,
        projectId,
        jobStarts.get(projectId) ?? null,
      ),
    ]),
  );
}

export async function getProjectLabourInvoiceSummary(
  projectId: string,
): Promise<ProjectLabourInvoiceSummary> {
  const [invoices, jobStarts] = await Promise.all([
    queryLabourInvoices(),
    queryLabourInvoiceJobStarts(),
  ]);
  return summarizeProjectLabourInvoices(
    invoices,
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
    linkedFileCount: 0,
    historicalLinkedFileCount: 0,
    totals: emptyTotals(),
    jobStartedOn: null,
    latestInvoiceDate: null,
    hasDuplicateVersions: false,
    hasUnallocatedSharedInvoices: false,
    unallocatedSharedInvoiceCount: 0,
    needsReview: false,
  };
}
