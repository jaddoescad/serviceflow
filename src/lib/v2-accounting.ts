import { createClient } from "@/lib/supabase/server";
import {
  selectCostingInvoiceJobAllocations,
  selectUsableInvoiceJobAllocations,
} from "@/lib/invoice-allocation-selection";
import { deriveInvoiceReadiness } from "@/lib/invoice-readiness";

async function getEvidenceForInvoices(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoiceIds: string[],
) {
  if (!invoiceIds.length) return new Map<string, any[]>();

  const chunks: string[][] = [];
  for (let index = 0; index < invoiceIds.length; index += 200) {
    chunks.push(invoiceIds.slice(index, index + 200));
  }

  const results = await Promise.all(
    chunks.map((ids) =>
      supabase
        .from("evidence_links")
        .select(
          "id,entity_id,evidence_role,metadata,document:documents(id,original_filename,mime_type,storage_bucket,storage_path,source_url)",
        )
        .eq("entity_type", "invoice")
        .in("entity_id", ids),
    ),
  );
  const evidenceByInvoice = new Map<string, any[]>();
  for (const result of results) {
    if (result.error) {
      throw new Error(`invoice evidence: ${result.error.message}`);
    }
    for (const row of result.data ?? []) {
      const rows = evidenceByInvoice.get(row.entity_id) ?? [];
      rows.push(row);
      evidenceByInvoice.set(row.entity_id, rows);
    }
  }
  return evidenceByInvoice;
}

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

export async function getLabourInvoiceReviewInvoices() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "*,contact:contacts(name),lines:invoice_lines(id,line_number,subtotal_cents,tax_cents,total_cents,source_kind,metadata),allocations:invoice_job_allocations(id,invoice_id,invoice_line_id,job_id,subtotal_cents,total_cents,needs_review,metadata,job:jobs(name)),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,invoice_id,amount_cents,needs_review,reversed_at,transaction:transactions(id,posted_on,review_status))",
    )
    .eq("category", "labour")
    .order("issued_on", { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) throw new Error(`labour invoice review: ${error.message}`);

  const invoices = data ?? [];
  const evidenceByInvoice = await getEvidenceForInvoices(
    supabase,
    invoices.map((invoice) => invoice.id),
  );

  return invoices.map((invoice: any) => {
    const reviewableInvoice = {
      ...invoice,
      allocations: selectUsableInvoiceJobAllocations(invoice.allocations ?? []),
      evidence: evidenceByInvoice.get(invoice.id) ?? [],
    };
    return {
      ...reviewableInvoice,
      readiness: deriveInvoiceReadiness(reviewableInvoice),
    };
  });
}

export async function getUnifiedInvoice(invoiceId: string) {
  const supabase = await createClient();
  const [invoiceResult, evidenceResult] = await Promise.all([
    supabase
      .from("invoices")
      .select("*,contact:contacts(name,email,phone),lines:invoice_lines(*),allocations:invoice_job_allocations(*,job:jobs(id,name,status,formatted_address)),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(*,transaction:transactions(id,posted_on,description,counterparty,amount_cents,category,review_status,account:accounts(name,last_four)))")
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
  const evidence = await Promise.all(
    (evidenceResult.data ?? []).map(async (link: any) => {
      const document = Array.isArray(link.document)
        ? link.document[0] ?? null
        : link.document;
      if (!document) return link;

      let signedUrl = document.source_url ?? null;
      if (document.storage_bucket && document.storage_path) {
        const signed = await supabase.storage
          .from(document.storage_bucket)
          .createSignedUrl(document.storage_path, 60 * 60);
        if (signed.data?.signedUrl) signedUrl = signed.data.signedUrl;
      }

      return {
        ...link,
        document: {
          ...document,
          signed_url: signedUrl,
        },
      };
    }),
  );
  if (!data) return data;
  const detailedInvoice = {
    ...data,
    lines: [...(data.lines ?? [])].sort(
      (left: any, right: any) => Number(left.line_number) - Number(right.line_number),
    ),
    allocations: selectUsableInvoiceJobAllocations(data.allocations ?? []),
    evidence,
  };
  return {
    ...detailedInvoice,
    readiness: deriveInvoiceReadiness(detailedInvoice),
  };
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
