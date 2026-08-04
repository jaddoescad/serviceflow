import { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type InvoiceVerification = {
  invoice_id: string;
  contractor_id: string | null;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string | null;
  currency: string;
  content_sha256: string;
  original_filename: string;
  storage_bucket: string;
  storage_path: string;
  invoice_amount: number;
  line_count: number;
  line_amount: number;
  invoice_line_difference: number;
  job_count: number;
  job_amount: number;
  job_difference: number;
  invoiced_hours: number;
  backend_hours: number;
  hours_difference: number;
  payment_count: number;
  paid_amount: number;
  amount_remaining: number;
  payment_status: "unpaid" | "partially_paid" | "paid" | "overpaid";
  verification_status: "needs_information" | "needs_review" | "verified";
};

export type InvoiceLineEvidence = {
  id: string;
  line_number: number;
  entry_type:
    | "labour"
    | "material"
    | "bonus"
    | "commission"
    | "expense"
    | "other"
    | "unclassified";
  description: string;
  service_started_on: string | null;
  service_ended_on: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  quantity_hours: number | null;
  hourly_rate: number | null;
  amount_before_tax: number;
  tax_amount: number;
  source_kind:
    "extracted" | "manual" | "legacy_project_link" | "legacy_invoice_total";
  source_reference: string | null;
  source_text: string | null;
  needs_review: boolean;
  jobs: Array<{
    companycam_project_id: string;
    allocated_amount: number;
    allocated_hours: number | null;
    needs_review: boolean;
    name: string;
    address: string | null;
  }>;
  timeEntries: Array<{
    time_entry_id: string;
    allocated_hours: number;
    needs_review: boolean;
    worker_name: string;
    project_name: string;
    started_at: string;
    ended_at: string | null;
    status: string;
  }>;
};

export type InvoicePaymentEvidence = {
  allocation_id: string;
  financial_transaction_id: string;
  allocated_amount: number;
  inserted_at: string;
  account_name: string;
  account_last_four: string | null;
  posted_on: string;
  description: string;
  counterparty: string | null;
  bank_amount: number;
  source_filename: string;
};

export type LabourInvoiceEvidence = {
  verification: InvoiceVerification;
  contractor: {
    id: string;
    supplier_name: string;
    worker_name: string | null;
  } | null;
  signedUrl: string | null;
  lines: InvoiceLineEvidence[];
  payments: InvoicePaymentEvidence[];
};

export type PaymentVerification = {
  financial_transaction_id: string;
  contractor_id: string | null;
  recipient_status: "unknown" | "confirmed";
  payment_amount: number;
  invoice_allocated_amount: number;
  bonus_allocated_amount: number;
  other_allocated_amount: number;
  total_allocated_amount: number;
  unallocated_amount: number;
  invoice_count: number;
  bonus_count: number;
  other_count: number;
  payment_status:
    | "unidentified"
    | "unmatched"
    | "partially_allocated"
    | "fully_allocated"
    | "needs_review";
};

export type LabourPaymentEvidence = {
  transaction: {
    id: string;
    posted_on: string;
    transaction_on: string;
    description: string;
    counterparty: string | null;
    amount: number;
    tax_amount: number;
    net_amount: number;
    currency: string;
    transaction_type: "income" | "expense" | "transfer" | "credit";
    category: string;
    is_transfer: boolean;
    review_status: string;
    running_balance: number | null;
    notes: string | null;
    is_overpayment: boolean;
    transfer_cancelled: boolean;
    has_no_invoice: boolean;
    invoice_not_found: boolean;
    partial_no_invoice_residual: boolean;
    expense_evidence_status: "bank_supported_no_itc" | null;
    expense_evidence_vendor: string | null;
    expense_evidence_label: string | null;
    expense_evidence_detail: string | null;
    document_exception_label: string | null;
    document_exception_detail: string | null;
    customer_revenue_exception_kind: string | null;
    customer_revenue_exception_detail: string | null;
    customer_revenue_exception_needs_review: boolean;
    account_name: string;
    account_last_four: string | null;
    source_filename: string;
    source_kind: string;
    source_sha256: string;
  };
  verification: PaymentVerification | null;
  contractor: {
    id: string;
    supplier_name: string;
    worker_name: string | null;
    confirmation_method: string | null;
    confirmation_note: string | null;
    confirmed_at: string | null;
  } | null;
  invoices: LabourInvoiceEvidence[];
  bonuses: Array<{
    allocation_id: string;
    bonus_id: string;
    allocated_amount: number;
    bonus_amount: number;
    project_id: string;
    project_name: string;
    formula_version: string;
    approved_at: string;
    calculation_note: string | null;
  }>;
  otherAllocations: Array<{
    id: string;
    allocation_type: string;
    allocated_amount: number;
    explanation: string;
    project_id: string | null;
    project_name: string | null;
  }>;
};

type StoredInvoice = {
  id: string;
  contractor_id: string | null;
  storage_bucket: string;
  storage_path: string;
  labour_contractors: {
    id: string;
    supplier_name: string;
    employee_profiles: { full_name: string } | null;
  } | null;
};

type StoredLine = Omit<InvoiceLineEvidence, "jobs" | "timeEntries">;

async function getInvoiceEvidenceWithClient(
  supabase: Supabase,
  invoiceId: string,
): Promise<LabourInvoiceEvidence | null> {
  const [invoiceResult, verificationResult, linesResult, paymentsResult] =
    await Promise.all([
      supabase
        .from("labour_invoices")
        .select(
          `
            id,
            contractor_id,
            storage_bucket,
            storage_path,
            labour_contractors (
              id,
              supplier_name,
              employee_profiles (
                full_name
              )
            )
          `,
        )
        .eq("id", invoiceId)
        .maybeSingle(),
      supabase
        .from("labour_invoice_verification")
        .select("*")
        .eq("invoice_id", invoiceId)
        .maybeSingle(),
      supabase
        .from("labour_invoice_lines")
        .select(
          "id,line_number,entry_type,description,service_started_on,service_ended_on,quantity,unit,unit_price,quantity_hours,hourly_rate,amount_before_tax,tax_amount,source_kind,source_reference,source_text,needs_review",
        )
        .eq("invoice_id", invoiceId)
        .order("line_number", { ascending: true }),
      supabase
        .from("labour_payment_allocations")
        .select(
          `
            id,
            financial_transaction_id,
            allocated_amount,
            inserted_at,
            financial_transactions (
              posted_on,
              description,
              counterparty,
              amount,
              financial_accounts (
                name,
                last_four
              ),
              financial_imports (
                original_filename
              )
            )
          `,
        )
        .eq("invoice_id", invoiceId)
        .is("reversed_at", null)
        .order("inserted_at", { ascending: true }),
    ]);

  if (invoiceResult.error) throw invoiceResult.error;
  if (verificationResult.error) throw verificationResult.error;
  if (linesResult.error) throw linesResult.error;
  if (paymentsResult.error) throw paymentsResult.error;
  if (!invoiceResult.data || !verificationResult.data) return null;

  const invoice = invoiceResult.data as unknown as StoredInvoice;
  const verification =
    verificationResult.data as unknown as InvoiceVerification;
  const storedLines = (linesResult.data ?? []) as StoredLine[];
  const lineIds = storedLines.map((line) => line.id);

  const [jobsResult, timesResult, signedResult] = await Promise.all([
    lineIds.length
      ? supabase
          .from("labour_invoice_line_allocations")
          .select(
            `
              invoice_line_id,
              companycam_project_id,
              allocated_amount,
              allocated_hours,
              needs_review,
              companycam_projects (
                name,
                formatted_address
              )
            `,
          )
          .in("invoice_line_id", lineIds)
      : Promise.resolve({ data: [], error: null }),
    lineIds.length
      ? supabase
          .from("labour_invoice_line_time_entries")
          .select(
            `
              invoice_line_id,
              time_entry_id,
              allocated_hours,
              needs_review,
              time_entries (
                user_name,
                project_name,
                started_at,
                ended_at,
                status
              )
            `,
          )
          .in("invoice_line_id", lineIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.storage
      .from(invoice.storage_bucket)
      .createSignedUrl(invoice.storage_path, 60 * 60),
  ]);

  if (jobsResult.error) throw jobsResult.error;
  if (timesResult.error) throw timesResult.error;

  const jobsByLine = new Map<string, InvoiceLineEvidence["jobs"]>();
  for (const value of jobsResult.data ?? []) {
    const row = value as unknown as {
      invoice_line_id: string;
      companycam_project_id: string;
      allocated_amount: number;
      allocated_hours: number | null;
      needs_review: boolean;
      companycam_projects: {
        name: string;
        formatted_address: string | null;
      } | null;
    };
    const jobs = jobsByLine.get(row.invoice_line_id) ?? [];
    jobs.push({
      companycam_project_id: row.companycam_project_id,
      allocated_amount: Number(row.allocated_amount),
      allocated_hours:
        row.allocated_hours == null ? null : Number(row.allocated_hours),
      needs_review: row.needs_review,
      name: row.companycam_projects?.name ?? row.companycam_project_id,
      address: row.companycam_projects?.formatted_address ?? null,
    });
    jobsByLine.set(row.invoice_line_id, jobs);
  }

  const timesByLine = new Map<string, InvoiceLineEvidence["timeEntries"]>();
  for (const value of timesResult.data ?? []) {
    const row = value as unknown as {
      invoice_line_id: string;
      time_entry_id: string;
      allocated_hours: number;
      needs_review: boolean;
      time_entries: {
        user_name: string | null;
        project_name: string;
        started_at: string;
        ended_at: string | null;
        status: string;
      } | null;
    };
    const entries = timesByLine.get(row.invoice_line_id) ?? [];
    entries.push({
      time_entry_id: row.time_entry_id,
      allocated_hours: Number(row.allocated_hours),
      needs_review: row.needs_review,
      worker_name: row.time_entries?.user_name ?? "Unknown worker",
      project_name: row.time_entries?.project_name ?? "Unknown job",
      started_at: row.time_entries?.started_at ?? "",
      ended_at: row.time_entries?.ended_at ?? null,
      status: row.time_entries?.status ?? "unknown",
    });
    timesByLine.set(row.invoice_line_id, entries);
  }

  const payments = (paymentsResult.data ?? []).map((value) => {
    const row = value as unknown as {
      id: string;
      financial_transaction_id: string;
      allocated_amount: number;
      inserted_at: string;
      financial_transactions: {
        posted_on: string;
        description: string;
        counterparty: string | null;
        amount: number;
        financial_accounts: {
          name: string;
          last_four: string | null;
        } | null;
        financial_imports: { original_filename: string } | null;
      } | null;
    };
    return {
      allocation_id: row.id,
      financial_transaction_id: row.financial_transaction_id,
      allocated_amount: Number(row.allocated_amount),
      inserted_at: row.inserted_at,
      account_name:
        row.financial_transactions?.financial_accounts?.name ?? "Bank account",
      account_last_four:
        row.financial_transactions?.financial_accounts?.last_four ?? null,
      posted_on: row.financial_transactions?.posted_on ?? "",
      description: row.financial_transactions?.description ?? "",
      counterparty: row.financial_transactions?.counterparty ?? null,
      bank_amount: Number(row.financial_transactions?.amount ?? 0),
      source_filename:
        row.financial_transactions?.financial_imports?.original_filename ??
        "Unknown import",
    };
  });

  return {
    verification,
    contractor: invoice.labour_contractors
      ? {
          id: invoice.labour_contractors.id,
          supplier_name: invoice.labour_contractors.supplier_name,
          worker_name:
            invoice.labour_contractors.employee_profiles?.full_name ?? null,
        }
      : null,
    signedUrl: signedResult.data?.signedUrl ?? null,
    lines: storedLines.map((line) => ({
      ...line,
      quantity: line.quantity == null ? null : Number(line.quantity),
      unit_price: line.unit_price == null ? null : Number(line.unit_price),
      quantity_hours:
        line.quantity_hours == null ? null : Number(line.quantity_hours),
      hourly_rate: line.hourly_rate == null ? null : Number(line.hourly_rate),
      amount_before_tax: Number(line.amount_before_tax),
      tax_amount: Number(line.tax_amount),
      jobs: jobsByLine.get(line.id) ?? [],
      timeEntries: timesByLine.get(line.id) ?? [],
    })),
    payments,
  };
}

export async function getLabourInvoiceEvidence(
  invoiceId: string,
): Promise<LabourInvoiceEvidence | null> {
  const supabase = await createClient();
  return getInvoiceEvidenceWithClient(supabase, invoiceId);
}

export async function getInvoiceEntryEvidence(entryId: string): Promise<{
  entry: InvoiceLineEvidence;
  invoice: LabourInvoiceEvidence;
} | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("labour_invoice_lines")
    .select("invoice_id")
    .eq("id", entryId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const invoice = await getInvoiceEvidenceWithClient(supabase, data.invoice_id);
  if (!invoice) return null;

  const entry = invoice.lines.find((line) => line.id === entryId);
  return entry ? { entry, invoice } : null;
}

export async function getLabourPaymentEvidence(
  transactionId: string,
): Promise<LabourPaymentEvidence | null> {
  const supabase = await createClient();
  const [
    transactionResult,
    verificationResult,
    recordResult,
    invoiceAllocationsResult,
    bonusAllocationsResult,
    otherAllocationsResult,
  ] = await Promise.all([
    supabase
      .from("financial_transactions")
      .select(
        `
          id,
          posted_on,
          transaction_on,
          description,
          counterparty,
          amount,
          tax_amount,
          net_amount,
          currency,
          transaction_type,
          category,
          is_transfer,
          review_status,
          running_balance,
          notes,
          source_data,
          financial_accounts (
            name,
            last_four
          ),
          financial_imports (
            original_filename,
            source_kind,
            content_sha256
          )
        `,
      )
      .eq("id", transactionId)
      .maybeSingle(),
    supabase
      .from("labour_payment_verification")
      .select("*")
      .eq("financial_transaction_id", transactionId)
      .maybeSingle(),
    supabase
      .from("labour_payment_records")
      .select(
        `
          contractor_id,
          recipient_status,
          confirmation_method,
          confirmation_note,
          confirmed_at,
          labour_contractors (
            id,
            supplier_name,
            employee_profiles (
              full_name
            )
          )
        `,
      )
      .eq("financial_transaction_id", transactionId)
      .maybeSingle(),
    supabase
      .from("labour_payment_allocations")
      .select("invoice_id")
      .eq("financial_transaction_id", transactionId)
      .is("reversed_at", null),
    supabase
      .from("labour_bonus_payment_allocations")
      .select(
        `
          id,
          bonus_payable_id,
          allocated_amount,
          labour_bonus_payables (
            amount,
            companycam_project_id,
            formula_version,
            approved_at,
            calculation_note,
            companycam_projects (
              name
            )
          )
        `,
      )
      .eq("financial_transaction_id", transactionId)
      .is("reversed_at", null),
    supabase
      .from("labour_payment_other_allocations")
      .select(
        `
          id,
          allocation_type,
          allocated_amount,
          explanation,
          companycam_project_id,
          companycam_projects (
            name
          )
        `,
      )
      .eq("financial_transaction_id", transactionId)
      .is("reversed_at", null),
  ]);

  if (transactionResult.error) throw transactionResult.error;
  if (verificationResult.error) throw verificationResult.error;
  if (recordResult.error) throw recordResult.error;
  if (invoiceAllocationsResult.error) throw invoiceAllocationsResult.error;
  if (bonusAllocationsResult.error) throw bonusAllocationsResult.error;
  if (otherAllocationsResult.error) throw otherAllocationsResult.error;
  if (!transactionResult.data) return null;

  const invoiceIds = [
    ...new Set(
      (invoiceAllocationsResult.data ?? []).map((row) => row.invoice_id),
    ),
  ];
  const invoices = (
    await Promise.all(
      invoiceIds.map((invoiceId) =>
        getInvoiceEvidenceWithClient(supabase, invoiceId),
      ),
    )
  ).filter((invoice): invoice is LabourInvoiceEvidence => invoice != null);

  const transaction = transactionResult.data as unknown as {
    id: string;
    posted_on: string;
    transaction_on: string;
    description: string;
    counterparty: string | null;
    amount: number;
    tax_amount: number;
    net_amount: number;
    currency: string;
    transaction_type: "income" | "expense" | "transfer" | "credit";
    category: string;
    is_transfer: boolean;
    review_status: string;
    running_balance: number | null;
    notes: string | null;
    source_data: {
      confirmed_overpayment?: {
        status?: string;
      };
      cancelled_e_transfer?: {
        status?: string;
      };
      reconciliation_research?: {
        status?: string;
      };
      expense_evidence?: {
        status?: string;
        vendor?: string;
        label?: string;
        detail?: string;
      };
      document_exception?: {
        status?: string;
        label?: string;
        detail?: string;
      };
      customer_revenue_exception?: {
        status?: string;
        kind?: string;
        resolution?: string;
        review?: boolean;
      };
    } | null;
    financial_accounts: { name: string; last_four: string | null } | null;
    financial_imports: {
      original_filename: string;
      source_kind: string;
      content_sha256: string;
    } | null;
  };
  const record = recordResult.data as unknown as {
    contractor_id: string | null;
    recipient_status: string;
    confirmation_method: string | null;
    confirmation_note: string | null;
    confirmed_at: string | null;
    labour_contractors: {
      id: string;
      supplier_name: string;
      employee_profiles: { full_name: string } | null;
    } | null;
  } | null;

  return {
    transaction: {
      id: transaction.id,
      posted_on: transaction.posted_on,
      transaction_on: transaction.transaction_on,
      description: transaction.description,
      counterparty: transaction.counterparty,
      amount: Number(transaction.amount),
      tax_amount: Number(transaction.tax_amount),
      net_amount: Number(transaction.net_amount),
      currency: transaction.currency,
      transaction_type: transaction.transaction_type,
      category: transaction.category,
      is_transfer: transaction.is_transfer,
      review_status: transaction.review_status,
      running_balance:
        transaction.running_balance == null
          ? null
          : Number(transaction.running_balance),
      notes: transaction.notes,
      is_overpayment:
        transaction.source_data?.confirmed_overpayment?.status === "confirmed",
      transfer_cancelled:
        transaction.source_data?.cancelled_e_transfer?.status === "cancelled",
      has_no_invoice:
        transaction.source_data?.reconciliation_research?.status ===
        "no_invoice_provided",
      invoice_not_found:
        transaction.source_data?.reconciliation_research?.status ===
        "invoice_not_found",
      partial_no_invoice_residual:
        transaction.source_data?.reconciliation_research?.status ===
        "partial_invoice_allocation_with_no_invoice_residual",
      expense_evidence_status:
        transaction.source_data?.expense_evidence?.status ===
        "bank_supported_no_itc"
          ? "bank_supported_no_itc"
          : null,
      expense_evidence_vendor:
        typeof transaction.source_data?.expense_evidence?.vendor === "string"
          ? transaction.source_data.expense_evidence.vendor
          : null,
      expense_evidence_label:
        typeof transaction.source_data?.expense_evidence?.label === "string"
          ? transaction.source_data.expense_evidence.label
          : null,
      expense_evidence_detail:
        typeof transaction.source_data?.expense_evidence?.detail === "string"
          ? transaction.source_data.expense_evidence.detail
          : null,
      document_exception_label:
        transaction.source_data?.document_exception?.status === "confirmed" &&
        typeof transaction.source_data.document_exception.label === "string"
          ? transaction.source_data.document_exception.label
          : null,
      document_exception_detail:
        transaction.source_data?.document_exception?.status === "confirmed" &&
        typeof transaction.source_data.document_exception.detail === "string"
          ? transaction.source_data.document_exception.detail
          : null,
      customer_revenue_exception_kind:
        transaction.source_data?.customer_revenue_exception?.status ===
          "confirmed" &&
        typeof transaction.source_data.customer_revenue_exception.kind ===
          "string"
          ? transaction.source_data.customer_revenue_exception.kind
          : null,
      customer_revenue_exception_detail:
        transaction.source_data?.customer_revenue_exception?.status ===
          "confirmed" &&
        typeof transaction.source_data.customer_revenue_exception.resolution ===
          "string"
          ? transaction.source_data.customer_revenue_exception.resolution
          : null,
      customer_revenue_exception_needs_review:
        transaction.source_data?.customer_revenue_exception?.status ===
          "confirmed" &&
        transaction.source_data.customer_revenue_exception.review === true,
      account_name: transaction.financial_accounts?.name ?? "Bank account",
      account_last_four: transaction.financial_accounts?.last_four ?? null,
      source_filename:
        transaction.financial_imports?.original_filename ?? "Unknown import",
      source_kind: transaction.financial_imports?.source_kind ?? "unknown",
      source_sha256: transaction.financial_imports?.content_sha256 ?? "",
    },
    verification: verificationResult.data
      ? (verificationResult.data as unknown as PaymentVerification)
      : null,
    contractor: record?.labour_contractors
      ? {
          id: record.labour_contractors.id,
          supplier_name: record.labour_contractors.supplier_name,
          worker_name:
            record.labour_contractors.employee_profiles?.full_name ?? null,
          confirmation_method: record.confirmation_method,
          confirmation_note: record.confirmation_note,
          confirmed_at: record.confirmed_at,
        }
      : null,
    invoices,
    bonuses: (bonusAllocationsResult.data ?? []).map((value) => {
      const row = value as unknown as {
        id: string;
        bonus_payable_id: string;
        allocated_amount: number;
        labour_bonus_payables: {
          amount: number;
          companycam_project_id: string;
          formula_version: string;
          approved_at: string;
          calculation_note: string | null;
          companycam_projects: { name: string } | null;
        } | null;
      };
      return {
        allocation_id: row.id,
        bonus_id: row.bonus_payable_id,
        allocated_amount: Number(row.allocated_amount),
        bonus_amount: Number(row.labour_bonus_payables?.amount ?? 0),
        project_id: row.labour_bonus_payables?.companycam_project_id ?? "",
        project_name:
          row.labour_bonus_payables?.companycam_projects?.name ??
          "Unknown project",
        formula_version: row.labour_bonus_payables?.formula_version ?? "—",
        approved_at: row.labour_bonus_payables?.approved_at ?? "",
        calculation_note: row.labour_bonus_payables?.calculation_note ?? null,
      };
    }),
    otherAllocations: (otherAllocationsResult.data ?? []).map((value) => {
      const row = value as unknown as {
        id: string;
        allocation_type: string;
        allocated_amount: number;
        explanation: string;
        companycam_project_id: string | null;
        companycam_projects: { name: string } | null;
      };
      return {
        id: row.id,
        allocation_type: row.allocation_type,
        allocated_amount: Number(row.allocated_amount),
        explanation: row.explanation,
        project_id: row.companycam_project_id,
        project_name: row.companycam_projects?.name ?? null,
      };
    }),
  };
}
