import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type JobAccountingRecord = {
  job_proposal_id: string;
  companycam_project_id: string | null;
  job_name: string;
  job_status: string;
  proposal_signed_on: string | null;
  job_start_on: string | null;
  job_completion_on: string | null;
  salesperson: string | null;
  lead_deal_id: string | null;
  lead_created_on: string | null;
  lead_channel: string | null;
  raw_lead_source: string | null;
  customer_invoice_count: number;
  booked_revenue_before_hst: number;
  customer_hst_billed: number;
  customer_invoice_total: number;
  bank_backed_revenue_before_hst: number;
  customer_hst_credited: number;
  customer_invoice_credited: number;
  customer_bank_cash_received: number;
  customer_processing_fees: number;
  customer_amount_receivable: number;
  customer_bank_payment_count: number;
  supplier_invoice_count: number;
  supplier_cost_before_hst: number;
  supplier_hst_documented: number;
  supplier_cost_after_hst: number;
  settled_supplier_cost_before_hst: number;
  settled_supplier_hst: number;
  unsettled_supplier_invoice_count: number;
  supplier_tax_review_count: number;
  supplier_hst_needing_registration_evidence: number;
  material_invoice_count: number;
  material_cost_before_hst: number;
  material_hst_documented: number;
  material_cost_after_hst: number;
  settled_material_cost_before_hst: number;
  settled_material_hst: number;
  unsettled_material_invoice_count: number;
  direct_cost_before_hst: number;
  direct_cost_hst_documented: number;
  gross_profit_before_hst: number;
  gross_margin: number | null;
  review_reasons: string[];
  open_items: string[];
};

export type CustomerInvoiceReconciliation = {
  customer_invoice_id: string;
  job_proposal_id: string | null;
  lead_deal_id: string | null;
  lead_created_on: string | null;
  lead_channel: string | null;
  companycam_project_id: string | null;
  job_name: string | null;
  invoice_number: string;
  invoice_date: string | null;
  customer_name: string;
  currency: string;
  billed_before_hst: number;
  billed_hst: number;
  billed_after_hst: number;
  invoice_credited_after_hst: number;
  invoice_credited_before_hst: number;
  invoice_credited_hst: number;
  bank_cash_received: number;
  processing_fee_amount: number;
  amount_receivable: number;
  bank_payment_count: number;
  payment_status: string;
  verification_status: string;
  connection_status: string;
};

export type AccountingReconciliationException = {
  exception_key: string;
  exception_scope: string;
  job_proposal_id: string | null;
  companycam_project_id: string | null;
  source_type: string;
  source_id: string;
  amount: number | null;
  reason: string;
  resolution_status: string;
};

function numberValue(value: unknown) {
  return Number(value ?? 0);
}

function normalizeJob(row: Record<string, unknown>): JobAccountingRecord {
  const numericFields = [
    "customer_invoice_count",
    "booked_revenue_before_hst",
    "customer_hst_billed",
    "customer_invoice_total",
    "bank_backed_revenue_before_hst",
    "customer_hst_credited",
    "customer_invoice_credited",
    "customer_bank_cash_received",
    "customer_processing_fees",
    "customer_amount_receivable",
    "customer_bank_payment_count",
    "supplier_invoice_count",
    "supplier_cost_before_hst",
    "supplier_hst_documented",
    "supplier_cost_after_hst",
    "settled_supplier_cost_before_hst",
    "settled_supplier_hst",
    "unsettled_supplier_invoice_count",
    "supplier_tax_review_count",
    "supplier_hst_needing_registration_evidence",
    "material_invoice_count",
    "material_cost_before_hst",
    "material_hst_documented",
    "material_cost_after_hst",
    "settled_material_cost_before_hst",
    "settled_material_hst",
    "unsettled_material_invoice_count",
    "direct_cost_before_hst",
    "direct_cost_hst_documented",
    "gross_profit_before_hst",
  ] as const;
  const normalized = { ...row } as Record<string, unknown>;
  for (const field of numericFields) normalized[field] = numberValue(row[field]);
  normalized.gross_margin = row.gross_margin == null ? null : Number(row.gross_margin);
  normalized.review_reasons = Array.isArray(row.review_reasons)
    ? row.review_reasons
    : [];
  normalized.open_items = Array.isArray(row.open_items) ? row.open_items : [];
  return normalized as unknown as JobAccountingRecord;
}

function normalizeCustomerInvoice(
  row: Record<string, unknown>,
): CustomerInvoiceReconciliation {
  const numericFields = [
    "billed_before_hst",
    "billed_hst",
    "billed_after_hst",
    "invoice_credited_after_hst",
    "invoice_credited_before_hst",
    "invoice_credited_hst",
    "bank_cash_received",
    "processing_fee_amount",
    "amount_receivable",
    "bank_payment_count",
  ] as const;
  const normalized = { ...row } as Record<string, unknown>;
  for (const field of numericFields) normalized[field] = numberValue(row[field]);
  return normalized as unknown as CustomerInvoiceReconciliation;
}

export const getJobAccountingLedger = cache(
  async (): Promise<JobAccountingRecord[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "read_job_accounting_reconciliation",
    { p_companycam_project_id: null },
  );
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => normalizeJob(row))
    .sort(
      (left, right) =>
        String(right.proposal_signed_on ?? "").localeCompare(
          String(left.proposal_signed_on ?? ""),
        ) || left.job_name.localeCompare(right.job_name, "en-CA"),
    );
  },
);

export const getCustomerInvoiceReconciliation = cache(
  async (): Promise<CustomerInvoiceReconciliation[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "read_customer_invoice_reconciliation",
  );
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[])
    .map((row) => normalizeCustomerInvoice(row))
    .sort((left, right) =>
      String(right.invoice_date ?? "").localeCompare(
        String(left.invoice_date ?? ""),
      ),
    );
  },
);

export const getAccountingReconciliationExceptions = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("accounting_reconciliation_exceptions")
    .select("*")
    .order("exception_scope", { ascending: true })
    .order("exception_key", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    ...row,
    amount: row.amount == null ? null : Number(row.amount),
  })) as AccountingReconciliationException[];
});

export async function getProjectJobAccounting(
  projectId: string,
): Promise<JobAccountingRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "read_job_accounting_reconciliation",
    { p_companycam_project_id: projectId },
  );
  if (error) throw error;
  return data?.length === 1 ? normalizeJob(data[0]) : null;
}
