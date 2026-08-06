import { createClient } from "@/lib/supabase/server";
import {
  isCostingInvoice,
  selectCostingInvoiceJobAllocations,
  selectUsableInvoiceJobAllocations,
} from "@/lib/invoice-allocation-selection";
import type { InvoiceEntryRecord } from "@/lib/invoice-entry-queries";

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
  jobStartedOn: string | null;
  latestInvoiceDate: string | null;
  hasDuplicateVersions: boolean;
  hasUnallocatedSharedInvoices: boolean;
  unallocatedSharedInvoiceCount: number;
  needsReview: boolean;
};

const totals = () => ({ CAD: 0, USD: 0 });

export function emptyProjectLabourInvoiceSummary(): ProjectLabourInvoiceSummary {
  return {
    invoiceCount: 0,
    entryCount: 0,
    linkedFileCount: 0,
    historicalLinkedFileCount: 0,
    totals: totals(),
    confirmedPaidTotals: totals(),
    confirmedUnpaidTotals: totals(),
    partialSettlementTotals: totals(),
    paymentEvidenceCount: 0,
    jobStartedOn: null,
    latestInvoiceDate: null,
    hasDuplicateVersions: false,
    hasUnallocatedSharedInvoices: false,
    unallocatedSharedInvoiceCount: 0,
    needsReview: false,
  };
}

export async function getLabourInvoices(): Promise<LabourInvoiceRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("*,contact:contacts(name),allocations:invoice_job_allocations(invoice_id,invoice_line_id,job_id,total_cents,needs_review,metadata,job:jobs(name,formatted_address,status)),evidence:evidence_links(document:documents(original_filename,storage_path,storage_bucket))")
    .eq("category", "labour")
    .order("issued_on", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((invoice: any) => {
    const evidence = invoice.evidence?.[0]?.document;
    const paid = Number(invoice.paid_cents ?? 0) / 100;
    const total = Number(invoice.total_cents ?? 0) / 100;
    return {
      id: invoice.id,
      supplier_name: invoice.contact?.name ?? invoice.metadata?.supplier_name ?? "Labour",
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.issued_on,
      source_date: invoice.issued_on,
      currency: invoice.currency,
      amount_paid: total,
      amount_before_tax: Number(invoice.subtotal_cents ?? 0) / 100,
      tax_amount: Number(invoice.tax_cents ?? 0) / 100,
      document_type: invoice.source_system,
      match_status: invoice.status,
      original_filename: evidence?.original_filename ?? invoice.invoice_number,
      storage_path: evidence?.storage_path ?? "",
      duplicate_group_id: invoice.metadata?.duplicate_group_id ?? null,
      duplicate_group_size: Number(invoice.metadata?.duplicate_group_size ?? 1),
      signed_url: null,
      paid_amount: paid,
      payment_status: paid > total + 0.01 ? "overpaid" : paid >= total - 0.01 ? "paid" : paid > 0 ? "partially_paid" : "unpaid",
      verification_status: (invoice.allocations ?? []).some((row: any) => row.needs_review) ? "needs_review" : "verified",
      labour_invoice_projects: isCostingInvoice(invoice)
        ? selectUsableInvoiceJobAllocations(invoice.allocations ?? []).map((allocation: any, index: number) => ({
            companycam_project_id: allocation.job_id,
            allocated_amount: Number(allocation.total_cents ?? 0) / 100,
            match_score: 100,
            is_primary: index === 0,
            needs_review: allocation.needs_review,
            companycam_projects: allocation.job ? {
              name: allocation.job.name,
              formatted_address: allocation.job.formatted_address,
              is_lead: false,
              is_archived: allocation.job.status === "archived",
            } : null,
          }))
        : [],
    } as LabourInvoiceRecord;
  });
}

export async function getLabourInvoicesForProject(projectId: string): Promise<LabourInvoiceRecord[]> {
  return (await getLabourInvoices()).filter((invoice) =>
    invoice.labour_invoice_projects.some((link) => link.companycam_project_id === projectId),
  );
}

export function summarizeProjectInvoiceEntries(entries: InvoiceEntryRecord[]): ProjectLabourInvoiceSummary {
  const result = emptyProjectLabourInvoiceSummary();
  const invoiceIds = new Set<string>();
  for (const entry of entries) {
    invoiceIds.add(entry.invoice_id);
    result.entryCount += 1;
    const currency = entry.invoice.currency === "USD" ? "USD" : "CAD";
    const amount = Number(entry.amount_before_tax ?? 0);
    result.totals[currency] += amount;
    result.latestInvoiceDate = !result.latestInvoiceDate || (entry.invoice.invoice_date ?? "") > result.latestInvoiceDate
      ? entry.invoice.invoice_date
      : result.latestInvoiceDate;
    result.needsReview ||= entry.needs_review;
  }
  result.invoiceCount = invoiceIds.size;
  result.linkedFileCount = invoiceIds.size;
  return result;
}

export async function getProjectLabourInvoiceSummaries(): Promise<Map<string, ProjectLabourInvoiceSummary>> {
  const supabase = await createClient();
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("invoice_job_allocations")
      .select("id,invoice_id,job_id,subtotal_cents,needs_review,metadata,invoice:invoices(id,category,status,source_system,currency,issued_on,paid_cents,total_cents),invoice_line_id")
      .eq("invoice.category", "labour")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const map = new Map<string, ProjectLabourInvoiceSummary>();
  const seen = new Map<string, Set<string>>();
  for (const allocation of selectCostingInvoiceJobAllocations(rows)) {
    const invoice: any = Array.isArray(allocation.invoice) ? allocation.invoice[0] : allocation.invoice;
    if (!invoice || invoice.category !== "labour" || !isCostingInvoice(invoice)) continue;
    const summary = map.get(allocation.job_id) ?? emptyProjectLabourInvoiceSummary();
    const currency = invoice.currency === "USD" ? "USD" : "CAD";
    summary.totals[currency] += Number(allocation.subtotal_cents ?? 0) / 100;
    summary.entryCount += allocation.invoice_line_id ? 1 : 0;
    summary.needsReview ||= allocation.needs_review;
    summary.latestInvoiceDate = !summary.latestInvoiceDate || (invoice.issued_on ?? "") > summary.latestInvoiceDate
      ? invoice.issued_on
      : summary.latestInvoiceDate;
    const ids = seen.get(allocation.job_id) ?? new Set<string>();
    ids.add(invoice.id);
    seen.set(allocation.job_id, ids);
    summary.invoiceCount = ids.size;
    summary.linkedFileCount = ids.size;
    const paid = Number(invoice.paid_cents ?? 0);
    const total = Number(invoice.total_cents ?? 0);
    if (paid >= total) summary.confirmedPaidTotals[currency] += Number(allocation.subtotal_cents ?? 0) / 100;
    else if (paid > 0) summary.partialSettlementTotals[currency] += Number(allocation.subtotal_cents ?? 0) / 100;
    else summary.confirmedUnpaidTotals[currency] += Number(allocation.subtotal_cents ?? 0) / 100;
    map.set(allocation.job_id, summary);
  }
  return map;
}

export async function getProjectLabourInvoiceSummary(projectId: string): Promise<ProjectLabourInvoiceSummary> {
  return (await getProjectLabourInvoiceSummaries()).get(projectId) ?? emptyProjectLabourInvoiceSummary();
}

export function isInvoiceInCurrentJob(): boolean {
  return true;
}
