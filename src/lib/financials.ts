import { createClient } from "@/lib/supabase/server";

export type FinancialAccount = {
  id: string;
  slug: string;
  institution: string;
  name: string;
  account_type: "chequing" | "savings" | "credit_card" | "cash" | "other";
  last_four: string | null;
  currency: string;
  is_active: boolean;
  current_balance: number | null;
  available_balance: number | null;
  credit_limit: number | null;
  balance_as_of: string | null;
};

export type FinancialImport = {
  id: string;
  original_filename: string;
  source_kind: string;
  period_start: string | null;
  period_end: string | null;
  row_count: number;
  imported_at: string;
};

export type FinancialEvidence = {
  kind: "bank_record" | "no_document_required" | "labour_invoice";
  label: string;
  detail: string;
  status: "confirmed" | "source";
  amount: number | null;
  href: string | null;
  filename: string | null;
};

export type FinancialSourceDetails = {
  provider: string;
  bank_category: string | null;
  authorized_on: string | null;
  pending: boolean;
  reference: string | null;
};

export type PaymentVerificationSummary = {
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

export type FinancialTransaction = {
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
  review_status: "unreviewed" | "needs_review" | "reconciled";
  running_balance: number | null;
  notes: string | null;
  source_details: FinancialSourceDetails;
  evidence: FinancialEvidence[];
  payment_verification: PaymentVerificationSummary | null;
  financial_accounts: Pick<
    FinancialAccount,
    "id" | "slug" | "name" | "account_type" | "last_four"
  >;
  financial_imports: Pick<FinancialImport, "original_filename" | "source_kind">;
};

export type FinancialLedger = {
  accounts: FinancialAccount[];
  imports: FinancialImport[];
  transactions: FinancialTransaction[];
};

type FinancialSourceData = {
  source?: unknown;
  pending?: unknown;
  bank_category?: unknown;
  authorized_date?: unknown;
  bank_sync_transaction_id?: unknown;
};

type StoredFinancialTransaction = Omit<
  FinancialTransaction,
  "source_details" | "evidence" | "payment_verification"
> & {
  source_data: FinancialSourceData | null;
};

type EvidenceLabourInvoice = {
  id: string;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string | null;
  amount_paid: number | null;
  original_filename: string;
  storage_path: string;
};

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeSourceDetails(
  sourceData: FinancialSourceData | null,
): FinancialSourceDetails {
  const reference = stringValue(sourceData?.bank_sync_transaction_id);
  return {
    provider: stringValue(sourceData?.source) ?? "Imported financial source",
    bank_category: stringValue(sourceData?.bank_category),
    authorized_on: stringValue(sourceData?.authorized_date),
    pending: sourceData?.pending === true,
    reference: reference ? reference.slice(-12) : null,
  };
}

function buildEvidence(
  transaction: StoredFinancialTransaction,
  invoiceAllocations: Array<{
    invoice: EvidenceLabourInvoice & { signed_url: string | null };
    amount: number;
  }>,
): FinancialEvidence[] {
  const evidence: FinancialEvidence[] = [];

  for (const { invoice, amount } of invoiceAllocations) {
    evidence.push({
      kind: "labour_invoice",
      label: `${invoice.supplier_name} · Invoice #${invoice.invoice_number}`,
      detail: invoice.invoice_date
        ? `Invoice dated ${invoice.invoice_date}`
        : "Linked labour invoice",
      status: "confirmed",
      amount,
      href: `/invoices/${encodeURIComponent(invoice.id)}`,
      filename: invoice.original_filename,
    });
  }

  if (transaction.category === "Bank fees") {
    evidence.push({
      kind: "no_document_required",
      label: "No receipt required",
      detail:
        "This is a fee charged directly by the bank. The posted bank record is the supporting evidence.",
      status: "confirmed",
      amount: Math.abs(Number(transaction.amount)),
      href: null,
      filename: null,
    });
  }

  evidence.push({
    kind: "bank_record",
    label: "Posted bank record",
    detail: `${transaction.financial_accounts.name} · ${transaction.financial_imports.original_filename}`,
    status: "source",
    amount: Math.abs(Number(transaction.amount)),
    href: null,
    filename: transaction.financial_imports.original_filename,
  });

  return evidence;
}

export async function getFinancialLedger(): Promise<FinancialLedger> {
  const supabase = await createClient();
  const fetchTransactions = async () => {
    const transactions: unknown[] = [];
    const pageSize = 1000;

    for (let page = 0; page < 20; page += 1) {
      const from = page * pageSize;
      const result = await supabase
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
            financial_accounts!inner (
              id,
              slug,
              name,
              account_type,
              last_four
            ),
            financial_imports!inner (
              original_filename,
              source_kind
            )
          `,
        )
        .order("posted_on", { ascending: false })
        .order("transaction_on", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + pageSize - 1);

      if (result.error) throw result.error;
      transactions.push(...(result.data ?? []));
      if ((result.data?.length ?? 0) < pageSize) return transactions;
    }

    throw new Error("Financial ledger exceeded the 20,000-row read limit.");
  };

  const [accountsResult, importsResult, transactions] = await Promise.all([
    supabase
      .from("financial_accounts")
      .select(
        "id,slug,institution,name,account_type,last_four,currency,is_active,current_balance,available_balance,credit_limit,balance_as_of",
      )
      .order("account_type", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("financial_imports")
      .select(
        "id,original_filename,source_kind,period_start,period_end,row_count,imported_at",
      )
      .order("period_start", { ascending: true, nullsFirst: false })
      .order("original_filename", { ascending: true }),
    fetchTransactions(),
  ]);

  if (accountsResult.error) throw accountsResult.error;
  if (importsResult.error) throw importsResult.error;

  const storedTransactions =
    transactions as unknown as StoredFinancialTransaction[];
  const [verificationResult, allocationResult] = await Promise.all([
    supabase.from("labour_payment_verification").select("*"),
    supabase
      .from("labour_payment_allocations")
      .select("financial_transaction_id,invoice_id,allocated_amount")
      .is("reversed_at", null),
  ]);
  if (verificationResult.error) throw verificationResult.error;
  if (allocationResult.error) throw allocationResult.error;

  const allocations = (allocationResult.data ?? []) as Array<{
    financial_transaction_id: string;
    invoice_id: string;
    allocated_amount: number;
  }>;
  const labourInvoiceIds = [
    ...new Set(allocations.map((allocation) => allocation.invoice_id)),
  ];
  const invoiceById = new Map<
    string,
    EvidenceLabourInvoice & { signed_url: string | null }
  >();

  if (labourInvoiceIds.length) {
    const invoiceResult = await supabase
      .from("labour_invoices")
      .select(
        "id,supplier_name,invoice_number,invoice_date,amount_paid,original_filename,storage_path",
      )
      .in("id", labourInvoiceIds);
    if (invoiceResult.error) throw invoiceResult.error;

    const invoices = (invoiceResult.data ?? []) as EvidenceLabourInvoice[];
    const signedResult = await supabase.storage
      .from("labour-invoices")
      .createSignedUrls(
        invoices.map((invoice) => invoice.storage_path),
        60 * 60,
      );
    const signedUrlByPath = new Map(
      (signedResult.data ?? []).map((item) => [item.path, item.signedUrl]),
    );
    for (const invoice of invoices) {
      invoiceById.set(invoice.id, {
        ...invoice,
        signed_url: signedUrlByPath.get(invoice.storage_path) ?? null,
      });
    }
  }

  const verificationByTransaction = new Map(
    (verificationResult.data ?? []).map((row) => [
      row.financial_transaction_id,
      {
        contractor_id: row.contractor_id,
        recipient_status: row.recipient_status,
        payment_amount: Number(row.payment_amount),
        invoice_allocated_amount: Number(row.invoice_allocated_amount),
        bonus_allocated_amount: Number(row.bonus_allocated_amount),
        other_allocated_amount: Number(row.other_allocated_amount),
        total_allocated_amount: Number(row.total_allocated_amount),
        unallocated_amount: Number(row.unallocated_amount),
        invoice_count: Number(row.invoice_count),
        bonus_count: Number(row.bonus_count),
        other_count: Number(row.other_count),
        payment_status: row.payment_status,
      } as PaymentVerificationSummary,
    ]),
  );
  const allocationsByTransaction = new Map<
    string,
    Array<{
      invoice: EvidenceLabourInvoice & { signed_url: string | null };
      amount: number;
    }>
  >();
  for (const allocation of allocations) {
    const invoice = invoiceById.get(allocation.invoice_id);
    if (!invoice) continue;
    const values =
      allocationsByTransaction.get(allocation.financial_transaction_id) ?? [];
    values.push({
      invoice,
      amount: Number(allocation.allocated_amount),
    });
    allocationsByTransaction.set(allocation.financial_transaction_id, values);
  }

  return {
    accounts: (accountsResult.data ?? []) as FinancialAccount[],
    imports: (importsResult.data ?? []) as FinancialImport[],
    transactions: storedTransactions.map(
      ({ source_data: sourceData, ...transaction }) => ({
        ...transaction,
        source_details: normalizeSourceDetails(sourceData),
        evidence: buildEvidence(
          { ...transaction, source_data: sourceData },
          allocationsByTransaction.get(transaction.id) ?? [],
        ),
        payment_verification:
          verificationByTransaction.get(transaction.id) ?? null,
      }),
    ),
  };
}
