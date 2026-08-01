import { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type CustomerRevenueVerification = {
  financial_transaction_id: string;
  posted_on: string;
  bank_amount: number;
  currency: string;
  invoice_count: number;
  allocated_amount: number;
  unallocated_amount: number;
  payment_status: "unmatched" | "partially_allocated" | "fully_allocated";
};

export type CustomerInvoiceEvidence = {
  id: string;
  invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;
  customer_name: string;
  customer_email: string | null;
  billing_address: string | null;
  job_name: string | null;
  job_address: string | null;
  companycam_project_id: string;
  project_name: string;
  currency: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  source_paid_amount: number;
  source_balance: number;
  source_status: string;
  source_url: string | null;
  bank_paid_amount: number;
  bank_cash_amount: number;
  processing_fee_amount: number;
  amount_remaining: number;
  bank_payment_status: "unpaid" | "partially_paid" | "paid";
  verification_status: "needs_information" | "needs_review" | "verified";
  signed_url: string | null;
  document: {
    original_filename: string;
    content_sha256: string;
    storage_bucket: string;
    storage_path: string;
  } | null;
  items: Array<{
    id: string;
    line_number: number;
    description: string;
    quantity: number | null;
    unit_price: number | null;
    amount_before_tax: number;
    tax_amount: number;
    total_amount: number;
    source_text: string | null;
  }>;
  bank_payments: Array<{
    allocation_id: string;
    allocated_amount: number;
    invoice_applied_amount: number;
    processing_fee_amount: number;
    evidence_note: string;
    match_method: string[];
    transaction_id: string;
    posted_on: string;
    amount: number;
    description: string;
    counterparty: string | null;
    review_status: string;
    account_name: string;
    account_last_four: string | null;
    source_payment: {
      payment_number: string | null;
      received_on: string;
      method: string | null;
      reference: string | null;
      amount: number;
    } | null;
  }>;
};

export type ProjectCustomerRevenue = {
  invoices: CustomerInvoiceEvidence[];
  invoice_subtotal: number;
  invoice_tax: number;
  invoice_total: number;
  bank_paid_amount: number;
  bank_cash_amount: number;
  processing_fee_amount: number;
  amount_remaining: number;
  bank_payment_count: number;
  needs_review: boolean;
};

type StoredInvoice = {
  id: string;
  invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;
  customer_name: string;
  customer_email: string | null;
  billing_address: string | null;
  job_name: string | null;
  job_address: string | null;
  companycam_project_id: string;
  currency: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  source_paid_amount: number;
  source_balance: number;
  source_status: string;
  source_url: string | null;
  companycam_projects: { name: string } | null;
};

type InvoiceVerification = {
  customer_invoice_id: string;
  bank_paid_amount: number;
  bank_cash_amount: number;
  processing_fee_amount: number;
  amount_remaining: number;
  bank_payment_status: CustomerInvoiceEvidence["bank_payment_status"];
  verification_status: CustomerInvoiceEvidence["verification_status"];
};

async function loadInvoiceEvidence(
  supabase: Supabase,
  invoiceIds: string[],
): Promise<CustomerInvoiceEvidence[]> {
  if (invoiceIds.length === 0) return [];

  const [invoiceResult, verificationResult, itemsResult, documentsResult, allocationsResult] =
    await Promise.all([
      supabase
        .from("customer_invoices")
        .select(
          `
            id,
            invoice_number,
            invoice_date,
            due_date,
            customer_name,
            customer_email,
            billing_address,
            job_name,
            job_address,
            companycam_project_id,
            currency,
            subtotal,
            tax_amount,
            total_amount,
            source_paid_amount,
            source_balance,
            source_status,
            source_url,
            companycam_projects (
              name
            )
          `,
        )
        .in("id", invoiceIds),
      supabase
        .from("customer_invoice_verification")
        .select(
          "customer_invoice_id,bank_paid_amount,bank_cash_amount,processing_fee_amount,amount_remaining,bank_payment_status,verification_status",
        )
        .in("customer_invoice_id", invoiceIds),
      supabase
        .from("customer_invoice_items")
        .select(
          "id,customer_invoice_id,line_number,description,quantity,unit_price,amount_before_tax,tax_amount,total_amount,source_text",
        )
        .in("customer_invoice_id", invoiceIds)
        .order("line_number", { ascending: true }),
      supabase
        .from("customer_invoice_documents")
        .select(
          "customer_invoice_id,original_filename,content_sha256,storage_bucket,storage_path,captured_at",
        )
        .in("customer_invoice_id", invoiceIds)
        .order("captured_at", { ascending: false }),
      supabase
        .from("customer_invoice_bank_allocations")
        .select(
          `
            id,
            customer_invoice_id,
            allocated_amount,
            invoice_applied_amount,
            evidence_note,
            match_method,
            financial_transactions (
              id,
              posted_on,
              amount,
              description,
              counterparty,
              review_status,
              financial_accounts (
                name,
                last_four
              )
            ),
            customer_invoice_payment_events (
              payment_number,
              received_on,
              method,
              reference,
              amount
            )
          `,
        )
        .in("customer_invoice_id", invoiceIds)
        .is("reversed_at", null),
    ]);

  if (invoiceResult.error) throw invoiceResult.error;
  if (verificationResult.error) throw verificationResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (documentsResult.error) throw documentsResult.error;
  if (allocationsResult.error) throw allocationsResult.error;

  const storedInvoices = invoiceResult.data as unknown as StoredInvoice[];
  const verificationByInvoice = new Map(
    ((verificationResult.data ?? []) as unknown as InvoiceVerification[]).map(
      (row) => [row.customer_invoice_id, row],
    ),
  );
  const itemsByInvoice = new Map<
    string,
    CustomerInvoiceEvidence["items"]
  >();
  for (const value of itemsResult.data ?? []) {
    const row = value as unknown as CustomerInvoiceEvidence["items"][number] & {
      customer_invoice_id: string;
    };
    const values = itemsByInvoice.get(row.customer_invoice_id) ?? [];
    values.push({
      id: row.id,
      line_number: Number(row.line_number),
      description: row.description,
      quantity: row.quantity == null ? null : Number(row.quantity),
      unit_price: row.unit_price == null ? null : Number(row.unit_price),
      amount_before_tax: Number(row.amount_before_tax),
      tax_amount: Number(row.tax_amount),
      total_amount: Number(row.total_amount),
      source_text: row.source_text,
    });
    itemsByInvoice.set(row.customer_invoice_id, values);
  }

  type StoredDocument = NonNullable<CustomerInvoiceEvidence["document"]> & {
    customer_invoice_id: string;
  };
  const documentByInvoice = new Map<string, StoredDocument>();
  for (const value of documentsResult.data ?? []) {
    const row = value as unknown as StoredDocument;
    if (!documentByInvoice.has(row.customer_invoice_id)) {
      documentByInvoice.set(row.customer_invoice_id, row);
    }
  }

  const signedUrlByPath = new Map<string, string>();
  const documentsByBucket = new Map<string, StoredDocument[]>();
  for (const document of documentByInvoice.values()) {
    const values = documentsByBucket.get(document.storage_bucket) ?? [];
    values.push(document);
    documentsByBucket.set(document.storage_bucket, values);
  }
  await Promise.all(
    [...documentsByBucket.entries()].map(async ([bucket, documents]) => {
      const result = await supabase.storage
        .from(bucket)
        .createSignedUrls(
          documents.map((document) => document.storage_path),
          60 * 60,
        );
      if (result.error) throw result.error;
      for (const value of result.data ?? []) {
        if (value.path && value.signedUrl) {
          signedUrlByPath.set(value.path, value.signedUrl);
        }
      }
    }),
  );

  const paymentsByInvoice = new Map<
    string,
    CustomerInvoiceEvidence["bank_payments"]
  >();
  for (const value of allocationsResult.data ?? []) {
    const row = value as unknown as {
      id: string;
      customer_invoice_id: string;
      allocated_amount: number;
      invoice_applied_amount: number;
      evidence_note: string;
      match_method: string[];
      financial_transactions: {
        id: string;
        posted_on: string;
        amount: number;
        description: string;
        counterparty: string | null;
        review_status: string;
        financial_accounts: {
          name: string;
          last_four: string | null;
        } | null;
      } | null;
      customer_invoice_payment_events: CustomerInvoiceEvidence["bank_payments"][number]["source_payment"];
    };
    if (!row.financial_transactions) continue;
    const values = paymentsByInvoice.get(row.customer_invoice_id) ?? [];
    values.push({
      allocation_id: row.id,
      allocated_amount: Number(row.allocated_amount),
      invoice_applied_amount: Number(row.invoice_applied_amount),
      processing_fee_amount:
        Number(row.invoice_applied_amount) - Number(row.allocated_amount),
      evidence_note: row.evidence_note,
      match_method: row.match_method,
      transaction_id: row.financial_transactions.id,
      posted_on: row.financial_transactions.posted_on,
      amount: Number(row.financial_transactions.amount),
      description: row.financial_transactions.description,
      counterparty: row.financial_transactions.counterparty,
      review_status: row.financial_transactions.review_status,
      account_name:
        row.financial_transactions.financial_accounts?.name ?? "Bank account",
      account_last_four:
        row.financial_transactions.financial_accounts?.last_four ?? null,
      source_payment: row.customer_invoice_payment_events
        ? {
            ...row.customer_invoice_payment_events,
            amount: Number(row.customer_invoice_payment_events.amount),
          }
        : null,
    });
    paymentsByInvoice.set(row.customer_invoice_id, values);
  }

  return storedInvoices
    .map((invoice) => {
      const verification = verificationByInvoice.get(invoice.id);
      const document = documentByInvoice.get(invoice.id) ?? null;
      return {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date,
        due_date: invoice.due_date,
        customer_name: invoice.customer_name,
        customer_email: invoice.customer_email,
        billing_address: invoice.billing_address,
        job_name: invoice.job_name,
        job_address: invoice.job_address,
        companycam_project_id: invoice.companycam_project_id,
        project_name:
          invoice.companycam_projects?.name ?? invoice.job_name ?? "Job",
        currency: invoice.currency,
        subtotal: Number(invoice.subtotal),
        tax_amount: Number(invoice.tax_amount),
        total_amount: Number(invoice.total_amount),
        source_paid_amount: Number(invoice.source_paid_amount),
        source_balance: Number(invoice.source_balance),
        source_status: invoice.source_status,
        source_url: invoice.source_url,
        bank_paid_amount: Number(verification?.bank_paid_amount ?? 0),
        bank_cash_amount: Number(verification?.bank_cash_amount ?? 0),
        processing_fee_amount: Number(
          verification?.processing_fee_amount ?? 0,
        ),
        amount_remaining: Number(
          verification?.amount_remaining ?? invoice.total_amount,
        ),
        bank_payment_status:
          verification?.bank_payment_status ?? "unpaid",
        verification_status:
          verification?.verification_status ?? "needs_information",
        signed_url: document
          ? signedUrlByPath.get(document.storage_path) ?? null
          : null,
        document: document
          ? {
              original_filename: document.original_filename,
              content_sha256: document.content_sha256,
              storage_bucket: document.storage_bucket,
              storage_path: document.storage_path,
            }
          : null,
        items: itemsByInvoice.get(invoice.id) ?? [],
        bank_payments: (paymentsByInvoice.get(invoice.id) ?? []).sort((a, b) =>
          a.posted_on.localeCompare(b.posted_on),
        ),
      } satisfies CustomerInvoiceEvidence;
    })
    .sort(
      (left, right) =>
        (right.invoice_date ?? "").localeCompare(left.invoice_date ?? "") ||
        right.invoice_number.localeCompare(left.invoice_number, "en-CA"),
    );
}

export async function getProjectCustomerRevenue(
  projectId: string,
): Promise<ProjectCustomerRevenue> {
  const supabase = await createClient();
  const result = await supabase
    .from("customer_invoices")
    .select("id")
    .eq("companycam_project_id", projectId);
  if (result.error) throw result.error;

  const invoices = await loadInvoiceEvidence(
    supabase,
    (result.data ?? []).map((row) => row.id),
  );
  const transactionIds = new Set(
    invoices.flatMap((invoice) =>
      invoice.bank_payments.map((payment) => payment.transaction_id),
    ),
  );
  return {
    invoices,
    invoice_subtotal: invoices.reduce(
      (total, invoice) => total + invoice.subtotal,
      0,
    ),
    invoice_tax: invoices.reduce(
      (total, invoice) => total + invoice.tax_amount,
      0,
    ),
    invoice_total: invoices.reduce(
      (total, invoice) => total + invoice.total_amount,
      0,
    ),
    bank_paid_amount: invoices.reduce(
      (total, invoice) => total + invoice.bank_paid_amount,
      0,
    ),
    bank_cash_amount: invoices.reduce(
      (total, invoice) => total + invoice.bank_cash_amount,
      0,
    ),
    processing_fee_amount: invoices.reduce(
      (total, invoice) => total + invoice.processing_fee_amount,
      0,
    ),
    amount_remaining: invoices.reduce(
      (total, invoice) => total + invoice.amount_remaining,
      0,
    ),
    bank_payment_count: transactionIds.size,
    needs_review: invoices.some(
      (invoice) => invoice.verification_status !== "verified",
    ),
  };
}

export async function getCustomerRevenueTransactionEvidence(
  transactionId: string,
): Promise<{
  verification: CustomerRevenueVerification;
  invoices: CustomerInvoiceEvidence[];
} | null> {
  const supabase = await createClient();
  const [verificationResult, allocationsResult] = await Promise.all([
    supabase
      .from("customer_revenue_verification")
      .select("*")
      .eq("financial_transaction_id", transactionId)
      .maybeSingle(),
    supabase
      .from("customer_invoice_bank_allocations")
      .select("customer_invoice_id")
      .eq("financial_transaction_id", transactionId)
      .is("reversed_at", null),
  ]);
  if (verificationResult.error) throw verificationResult.error;
  if (allocationsResult.error) throw allocationsResult.error;
  if (!verificationResult.data) return null;

  const invoiceIds = [
    ...new Set(
      (allocationsResult.data ?? []).map((row) => row.customer_invoice_id),
    ),
  ];
  const row = verificationResult.data;
  return {
    verification: {
      financial_transaction_id: row.financial_transaction_id,
      posted_on: row.posted_on,
      bank_amount: Number(row.bank_amount),
      currency: row.currency,
      invoice_count: Number(row.invoice_count),
      allocated_amount: Number(row.allocated_amount),
      unallocated_amount: Number(row.unallocated_amount),
      payment_status: row.payment_status,
    },
    invoices: await loadInvoiceEvidence(supabase, invoiceIds),
  };
}
