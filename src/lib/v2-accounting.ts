import { createClient } from "@/lib/supabase/server";
import {
  selectCostingInvoiceJobAllocations,
  selectUsableInvoiceJobAllocations,
} from "@/lib/invoice-allocation-selection";

export async function getUnifiedInvoices(category?: "customer" | "labour" | "material" | "other") {
  const supabase = await createClient();
  let query = supabase
    .from("invoices")
    .select("*,contact:contacts(name),allocations:invoice_job_allocations(id,invoice_id,invoice_line_id,job_id,total_cents,needs_review,metadata,job:jobs(name))")
    .order("issued_on", { ascending: false, nullsFirst: false })
    .limit(2000);
  if (category) query = query.eq("category", category);
  const { data, error } = await query;
  if (error) throw new Error(`invoices: ${error.message}`);
  return (data ?? []).map((invoice: any) => ({
    ...invoice,
    allocations: selectUsableInvoiceJobAllocations(invoice.allocations ?? []),
  }));
}

export async function getUnifiedInvoice(invoiceId: string) {
  const supabase = await createClient();
  const [invoiceResult, evidenceResult] = await Promise.all([
    supabase
      .from("invoices")
      .select("*,contact:contacts(name,email,phone),lines:invoice_lines(*),allocations:invoice_job_allocations(*,job:jobs(id,name)),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(*,transaction:transactions(id,posted_on,description,amount_cents))")
      .eq("id", invoiceId)
      .maybeSingle(),
    supabase
      .from("evidence_links")
      .select("*,document:documents(*)")
      .eq("entity_type", "invoice")
      .eq("entity_id", invoiceId),
  ]);
  const { data, error } = invoiceResult;
  if (error) throw new Error(`invoice: ${error.message}`);
  if (evidenceResult.error) {
    throw new Error(`invoice evidence: ${evidenceResult.error.message}`);
  }
  return data ? {
    ...data,
    allocations: selectUsableInvoiceJobAllocations(data.allocations ?? []),
    evidence: evidenceResult.data ?? [],
  } : data;
}

export async function getJobInvoices(jobId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoice_job_allocations")
    .select("*,invoice:invoices(*,contact:contacts(name))")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`job invoices: ${error.message}`);
  return selectCostingInvoiceJobAllocations(data ?? []);
}

export async function getLedger() {
  const supabase = await createClient();
  const [{ data: accounts, error: accountError }, { data: transactions, error: transactionError }] =
    await Promise.all([
      supabase.from("accounts").select("*").order("name"),
      supabase.from("transactions").select("*,account:accounts(name,last_four)").order("posted_on", { ascending: false }).limit(5000),
    ]);
  if (accountError) throw new Error(`accounts: ${accountError.message}`);
  if (transactionError) throw new Error(`transactions: ${transactionError.message}`);
  return { accounts: accounts ?? [], transactions: transactions ?? [] };
}

export async function getLedgerTransaction(transactionId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transactions")
    .select("*,account:accounts(*),allocations:transaction_allocations(*,invoice:invoices!transaction_allocations_invoice_id_fkey(id,invoice_number,category),job:jobs(id,name),contact:contacts(name))")
    .eq("id", transactionId)
    .maybeSingle();
  if (error) throw new Error(`transaction: ${error.message}`);
  return data;
}

export async function getMarketingPerformance() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("marketing_summary")
    .select("*")
    .order("period_start", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`marketing: ${error.message}`);
  return data ?? [];
}
