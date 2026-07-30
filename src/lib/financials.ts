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
  kind:
    | "bank_record"
    | "no_document_required"
    | "labour_invoice"
    | "interac_email";
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
  interac_gmail_message_id?: unknown;
  settlements?: unknown;
};

type StoredSettlement = {
  kind?: unknown;
  labour_invoice_id?: unknown;
  allocated_amount?: unknown;
  payment_confirmation_message_id?: unknown;
};

type StoredFinancialTransaction = Omit<
  FinancialTransaction,
  "source_details" | "evidence"
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

function recordValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function storedSettlements(sourceData: FinancialSourceData | null) {
  return Array.isArray(sourceData?.settlements)
    ? (sourceData.settlements.filter(recordValue) as StoredSettlement[])
    : [];
}

function gmailMessageUrl(messageId: string) {
  return `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(messageId)}`;
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
  invoiceById: Map<string, EvidenceLabourInvoice & { signed_url: string | null }>,
): FinancialEvidence[] {
  const sourceData = transaction.source_data;
  const evidence: FinancialEvidence[] = [];

  for (const settlement of storedSettlements(sourceData)) {
    if (settlement.kind !== "labour_invoice") continue;
    const invoiceId = stringValue(settlement.labour_invoice_id);
    const invoice = invoiceId ? invoiceById.get(invoiceId) : null;
    if (!invoice) continue;
    const allocatedAmount = Number(settlement.allocated_amount);
    evidence.push({
      kind: "labour_invoice",
      label: `${invoice.supplier_name} · Invoice #${invoice.invoice_number}`,
      detail: invoice.invoice_date
        ? `Invoice dated ${invoice.invoice_date}`
        : "Linked labour invoice",
      status: "confirmed",
      amount: Number.isFinite(allocatedAmount)
        ? Math.abs(allocatedAmount)
        : invoice.amount_paid,
      href: invoice.signed_url,
      filename: invoice.original_filename,
    });

    const confirmationId = stringValue(
      settlement.payment_confirmation_message_id,
    );
    if (confirmationId) {
      evidence.push({
        kind: "interac_email",
        label: "Interac payment confirmation",
        detail: "Confirmation email linked to this bank payment",
        status: "confirmed",
        amount: null,
        href: gmailMessageUrl(confirmationId),
        filename: null,
      });
    }
  }

  const sourceConfirmationId = stringValue(
    sourceData?.interac_gmail_message_id,
  );
  if (
    sourceConfirmationId &&
    !evidence.some(
      (item) =>
        item.kind === "interac_email" &&
        item.href === gmailMessageUrl(sourceConfirmationId),
    )
  ) {
    evidence.push({
      kind: "interac_email",
      label: "Interac payment confirmation",
      detail: "Gmail confirmation used to reconcile this transaction",
      status: "confirmed",
      amount: null,
      href: gmailMessageUrl(sourceConfirmationId),
      filename: null,
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
  const labourInvoiceIds = [
    ...new Set(
      storedTransactions.flatMap((transaction) =>
        storedSettlements(transaction.source_data)
          .filter((settlement) => settlement.kind === "labour_invoice")
          .map((settlement) => stringValue(settlement.labour_invoice_id))
          .filter((id): id is string => Boolean(id)),
      ),
    ),
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

  return {
    accounts: (accountsResult.data ?? []) as FinancialAccount[],
    imports: (importsResult.data ?? []) as FinancialImport[],
    transactions: storedTransactions.map(
      ({ source_data: sourceData, ...transaction }) => ({
        ...transaction,
        source_details: normalizeSourceDetails(sourceData),
        evidence: buildEvidence(
          { ...transaction, source_data: sourceData },
          invoiceById,
        ),
      }),
    ),
  };
}
