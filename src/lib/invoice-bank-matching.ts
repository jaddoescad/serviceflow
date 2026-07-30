import { createClient } from "@/lib/supabase/server";
import {
  buildInvoiceBankMatchReport,
  type InvoiceBankMatchReport,
  type MatchableInvoice,
  type MatchablePayment,
} from "@/lib/invoice-bank-matcher";

type InvoiceRow = {
  id: string;
  contractor_id: string;
  supplier_name: string;
  invoice_number: string;
  invoice_date: string | null;
  source_date: string | null;
  currency: string;
  amount_paid: number | null;
  amount_before_tax: number | null;
  tax_amount: number | null;
  original_filename: string;
  duplicate_group_id: string | null;
};

type PaymentRow = {
  id: string;
  posted_on: string;
  amount: number;
  currency: string;
  description: string;
  counterparty: string | null;
  category: string;
  source_data: unknown;
  financial_accounts: {
    name: string;
    last_four: string | null;
  } | null;
  financial_imports: {
    original_filename: string;
  } | null;
};

type PaymentRecordRow = {
  financial_transaction_id: string;
  contractor_id: string | null;
  recipient_status: string;
  confirmation_method: string | null;
  confirmation_note: string | null;
  confirmed_at: string | null;
  labour_contractors: {
    supplier_name: string;
  } | null;
};

type AllocationRow = {
  financial_transaction_id: string;
  allocated_amount: number;
};

type InvoiceAllocationRow = AllocationRow & {
  invoice_id: string;
};

type EasyWebEvidence = {
  recipient_name: string | null;
  recipient_email: string | null;
  confirmation_suffix: string | null;
};

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getEasyWebEvidence(sourceData: unknown): EasyWebEvidence {
  if (!sourceData || typeof sourceData !== "object" || Array.isArray(sourceData)) {
    return {
      recipient_name: null,
      recipient_email: null,
      confirmation_suffix: null,
    };
  }
  const evidence = Reflect.get(sourceData, "easyweb_e_transfer_evidence");
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return {
      recipient_name: null,
      recipient_email: null,
      confirmation_suffix: null,
    };
  }
  const text = (key: string) => {
    const value = Reflect.get(evidence, key);
    return typeof value === "string" && value.trim() ? value : null;
  };
  return {
    recipient_name: text("recipient_name"),
    recipient_email: text("recipient_email"),
    confirmation_suffix: text("confirmation_suffix"),
  };
}

function addAmount(
  totals: Map<string, number>,
  key: string,
  amount: unknown,
) {
  totals.set(key, money((totals.get(key) ?? 0) + numberValue(amount)));
}

function compareInvoiceVersions(left: InvoiceRow, right: InvoiceRow): number {
  const leftDate = left.source_date ?? left.invoice_date ?? "";
  const rightDate = right.source_date ?? right.invoice_date ?? "";
  return (
    leftDate.localeCompare(rightDate) ||
    numberValue(left.amount_paid).valueOf() -
      numberValue(right.amount_paid).valueOf() ||
    left.original_filename.localeCompare(right.original_filename, "en-CA")
  );
}

async function fetchEligiblePaymentRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<PaymentRow[]> {
  const rows: PaymentRow[] = [];
  const pageSize = 1000;

  for (let page = 0; page < 20; page += 1) {
    const from = page * pageSize;
    const result = await supabase
      .from("financial_transactions")
      .select(
        `
          id,
          posted_on,
          amount,
          currency,
          description,
          counterparty,
          category,
          source_data,
          financial_accounts (
            name,
            last_four
          ),
          financial_imports (
            original_filename
          )
        `,
      )
      .eq("transaction_type", "expense")
      .eq("is_transfer", false)
      .lt("amount", 0)
      .order("posted_on", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (result.error) throw result.error;
    rows.push(...((result.data ?? []) as unknown as PaymentRow[]));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }

  throw new Error("Payment matching exceeded the 20,000-row read limit.");
}

export async function getInvoiceBankMatchReport(): Promise<InvoiceBankMatchReport> {
  const supabase = await createClient();
  const [
    invoiceResult,
    paymentRows,
    paymentRecordsResult,
    invoiceAllocationsResult,
    bonusAllocationsResult,
    otherAllocationsResult,
  ] = await Promise.all([
    supabase
      .from("labour_invoices")
      .select(
        "id,contractor_id,supplier_name,invoice_number,invoice_date,source_date,currency,amount_paid,amount_before_tax,tax_amount,original_filename,duplicate_group_id",
      )
      .eq("document_type", "invoice")
      .order("invoice_date", { ascending: true, nullsFirst: true })
      .limit(1000),
    fetchEligiblePaymentRows(supabase),
    supabase
      .from("labour_payment_records")
      .select(
        "financial_transaction_id,contractor_id,recipient_status,confirmation_method,confirmation_note,confirmed_at,labour_contractors(supplier_name)",
      ),
    supabase
      .from("labour_payment_allocations")
      .select("financial_transaction_id,invoice_id,allocated_amount")
      .is("reversed_at", null),
    supabase
      .from("labour_bonus_payment_allocations")
      .select("financial_transaction_id,allocated_amount")
      .is("reversed_at", null),
    supabase
      .from("labour_payment_other_allocations")
      .select("financial_transaction_id,allocated_amount")
      .is("reversed_at", null),
  ]);

  if (invoiceResult.error) throw invoiceResult.error;
  if (paymentRecordsResult.error) throw paymentRecordsResult.error;
  if (invoiceAllocationsResult.error) throw invoiceAllocationsResult.error;
  if (bonusAllocationsResult.error) throw bonusAllocationsResult.error;
  if (otherAllocationsResult.error) throw otherAllocationsResult.error;

  const invoiceRows = (invoiceResult.data ?? []) as unknown as InvoiceRow[];
  const paymentRecords =
    (paymentRecordsResult.data ?? []) as unknown as PaymentRecordRow[];
  const invoiceAllocations =
    (invoiceAllocationsResult.data ?? []) as InvoiceAllocationRow[];
  const bonusAllocations =
    (bonusAllocationsResult.data ?? []) as AllocationRow[];
  const otherAllocations =
    (otherAllocationsResult.data ?? []) as AllocationRow[];

  const invoiceGroupById = new Map<string, string>();
  const invoiceGroups = new Map<string, InvoiceRow[]>();
  for (const invoice of invoiceRows) {
    const groupId = invoice.duplicate_group_id ?? invoice.id;
    invoiceGroupById.set(invoice.id, groupId);
    invoiceGroups.set(groupId, [
      ...(invoiceGroups.get(groupId) ?? []),
      invoice,
    ]);
  }

  const allocatedByInvoiceGroup = new Map<string, number>();
  const allocatedByPayment = new Map<string, number>();
  for (const allocation of invoiceAllocations) {
    const groupId = invoiceGroupById.get(allocation.invoice_id);
    if (groupId) {
      addAmount(
        allocatedByInvoiceGroup,
        groupId,
        allocation.allocated_amount,
      );
    }
    addAmount(
      allocatedByPayment,
      allocation.financial_transaction_id,
      allocation.allocated_amount,
    );
  }
  for (const allocation of [...bonusAllocations, ...otherAllocations]) {
    addAmount(
      allocatedByPayment,
      allocation.financial_transaction_id,
      allocation.allocated_amount,
    );
  }

  const invoices: MatchableInvoice[] = [...invoiceGroups.entries()].map(
    ([groupId, versions]) => {
      const selected = [...versions].sort(compareInvoiceVersions).at(-1)!;
      const grossAmount = money(
        selected.amount_paid ??
          numberValue(selected.amount_before_tax) +
            numberValue(selected.tax_amount),
      );
      const allocatedAmount = money(allocatedByInvoiceGroup.get(groupId) ?? 0);
      return {
        id: selected.id,
        contractorId: selected.contractor_id,
        supplierName: selected.supplier_name,
        invoiceNumber: selected.invoice_number,
        invoiceDate:
          selected.invoice_date ?? selected.source_date ?? "1900-01-01",
        sourceDate: selected.source_date,
        currency: selected.currency || "CAD",
        grossAmount,
        allocatedAmount,
        remainingAmount: money(Math.max(0, grossAmount - allocatedAmount)),
        originalFilename: selected.original_filename,
        duplicateVersionCount: versions.length,
      };
    },
  );

  const recordByPayment = new Map(
    paymentRecords.map((record) => [
      record.financial_transaction_id,
      record,
    ]),
  );
  const eligiblePaymentRows = paymentRows.filter(
    (payment) =>
      payment.category === "Subcontractors" || recordByPayment.has(payment.id),
  );
  const payments: MatchablePayment[] = eligiblePaymentRows.map((payment) => {
    const record = recordByPayment.get(payment.id);
    const sourceEvidence = getEasyWebEvidence(payment.source_data);
    const paymentAmount = money(Math.abs(numberValue(payment.amount)));
    const allocatedAmount = money(allocatedByPayment.get(payment.id) ?? 0);
    return {
      id: payment.id,
      contractorId: record?.contractor_id ?? null,
      supplierName:
        record?.labour_contractors?.supplier_name ??
        sourceEvidence.recipient_name ??
        payment.counterparty,
      recipientStatus:
        record?.recipient_status === "confirmed" ? "confirmed" : "unknown",
      confirmationMethod: record?.confirmation_method ?? null,
      confirmationNote: record?.confirmation_note ?? null,
      confirmedAt: record?.confirmed_at ?? null,
      postedOn: payment.posted_on,
      currency: payment.currency || "CAD",
      paymentAmount,
      allocatedAmount,
      availableAmount: money(Math.max(0, paymentAmount - allocatedAmount)),
      description: payment.description,
      counterparty: payment.counterparty,
      category: payment.category,
      accountName: payment.financial_accounts?.name ?? "Unknown account",
      accountLastFour: payment.financial_accounts?.last_four ?? null,
      sourceFilename:
        payment.financial_imports?.original_filename ?? "Unknown bank import",
      recipientName: sourceEvidence.recipient_name,
      recipientEmail: sourceEvidence.recipient_email,
      confirmationSuffix: sourceEvidence.confirmation_suffix,
    };
  });

  return buildInvoiceBankMatchReport({
    invoices,
    payments,
    metadata: {
      sourceInvoiceFiles: invoiceRows.length,
      duplicateVersionsExcluded: invoiceRows.length - invoices.length,
      invoicesAlreadyAllocated: invoices.filter(
        (invoice) => invoice.allocatedAmount > 0.005,
      ).length,
      paymentsAlreadyAllocated: payments.filter(
        (payment) => payment.allocatedAmount > 0.005,
      ).length,
    },
  });
}

export async function getInvoiceBankMatchProposal(id: string) {
  const report = await getInvoiceBankMatchReport();
  return report.proposals.find((proposal) => proposal.id === id) ?? null;
}
