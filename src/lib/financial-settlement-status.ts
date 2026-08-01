export type SettlementBucket = "fully_matched" | "needs_review" | "custom";

export type ManualSettlementKind =
  | "no_invoice"
  | "sales_commission"
  | "customer_refund"
  | "owner_transfer"
  | "bank_or_processing_fee"
  | "other_documented";

export const manualSettlementOptions: ReadonlyArray<{
  value: ManualSettlementKind;
  label: string;
}> = [
  { value: "no_invoice", label: "No invoice" },
  { value: "sales_commission", label: "Sales commission" },
  { value: "customer_refund", label: "Customer refund" },
  { value: "owner_transfer", label: "Owner / employee transfer" },
  { value: "bank_or_processing_fee", label: "Bank / processing fee" },
  { value: "other_documented", label: "Other documented reason" },
];

export type ManualSettlementResolution = {
  status: "confirmed";
  kind: ManualSettlementKind;
  label: string;
  note: string;
  amount: number;
  confirmed_by: string;
  confirmed_at: string;
};

export function parseManualSettlementResolution(
  value: unknown,
): ManualSettlementResolution | null {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    candidate.status !== "confirmed" ||
    typeof candidate.kind !== "string" ||
    !manualSettlementOptions.some((option) => option.value === candidate.kind) ||
    typeof candidate.label !== "string" ||
    typeof candidate.note !== "string" ||
    typeof candidate.amount !== "number" ||
    typeof candidate.confirmed_by !== "string" ||
    typeof candidate.confirmed_at !== "string"
  ) {
    return null;
  }
  return candidate as ManualSettlementResolution;
}

export type SettlementFacts = {
  manualResolution?: ManualSettlementResolution | null;
  transferCancelled?: boolean;
  customerExceptionKind?: string | null;
  customerExceptionNeedsReview?: boolean;
  customerRevenueStatus?:
    | "unmatched"
    | "partially_allocated"
    | "fully_allocated"
    | null;
  overpaymentConfirmed?: boolean;
  invoiceEvidenceStatus?:
    | "no_invoice_provided"
    | "invoice_not_found"
    | "partial_no_invoice_residual"
    | null;
  expenseEvidenceConfirmed?: boolean;
  expenseEvidenceLabel?: string | null;
  noDocumentRequired?: boolean;
  paymentStatus?:
    | "unidentified"
    | "unmatched"
    | "partially_allocated"
    | "fully_allocated"
    | "needs_review"
    | null;
  invoiceAllocatedAmount?: number;
  bonusAllocatedAmount?: number;
  otherAllocatedAmount?: number;
};

export type SettlementDisplay = {
  bucket: SettlementBucket;
  label: string;
  tone: "good" | "warn" | "bad" | "neutral";
};

function customerExceptionLabel(kind: string) {
  if (kind === "refunded_deposit") return "Deposit refunded";
  if (kind === "paired_refund") return "Matched after refund";
  if (kind === "overpayment" || kind === "rounding_overpayment") {
    return "Customer overpayment";
  }
  if (kind === "processor_invoice_composition_missing") {
    return "Processor batch needs invoices";
  }
  if (kind === "invoice_missing" || kind === "legacy_invoice_not_imported") {
    return "Customer identified · invoice missing";
  }
  return "Documented exception";
}

/**
 * Reduce every transaction to one of three honest settlement buckets.
 * `review_status` is deliberately absent: reviewing a category is not proof
 * that the money has been matched or that an exception was documented.
 */
export function resolveSettlementStatus(
  facts: SettlementFacts,
): SettlementDisplay {
  if (facts.manualResolution?.status === "confirmed") {
    return {
      bucket: "custom",
      label: facts.manualResolution.label,
      tone: "neutral",
    };
  }

  if (facts.transferCancelled) {
    return { bucket: "custom", label: "Cancelled", tone: "neutral" };
  }

  if (facts.customerExceptionKind) {
    const label = customerExceptionLabel(facts.customerExceptionKind);
    return facts.customerExceptionNeedsReview
      ? { bucket: "needs_review", label, tone: "warn" }
      : { bucket: "custom", label, tone: "neutral" };
  }

  if (facts.overpaymentConfirmed) {
    return { bucket: "custom", label: "Overpayment", tone: "neutral" };
  }

  if (facts.invoiceEvidenceStatus === "no_invoice_provided") {
    return { bucket: "custom", label: "No invoice", tone: "neutral" };
  }
  if (facts.invoiceEvidenceStatus === "partial_no_invoice_residual") {
    return {
      bucket: "custom",
      label: "Partial match · balance has no invoice",
      tone: "neutral",
    };
  }
  if (facts.invoiceEvidenceStatus === "invoice_not_found") {
    return {
      bucket: "needs_review",
      label: "Invoice not found",
      tone: "bad",
    };
  }

  if (facts.expenseEvidenceConfirmed) {
    return {
      bucket: "custom",
      label: facts.expenseEvidenceLabel ?? "Documented expense",
      tone: "neutral",
    };
  }

  if (facts.noDocumentRequired) {
    return { bucket: "custom", label: "No document required", tone: "neutral" };
  }

  if (facts.customerRevenueStatus === "fully_allocated") {
    return { bucket: "fully_matched", label: "Fully matched", tone: "good" };
  }
  if (facts.customerRevenueStatus === "partially_allocated") {
    return { bucket: "needs_review", label: "Partially matched", tone: "warn" };
  }
  if (facts.customerRevenueStatus === "unmatched") {
    return {
      bucket: "needs_review",
      label: "Customer invoice missing",
      tone: "bad",
    };
  }

  if (facts.paymentStatus === "fully_allocated") {
    const invoiceAmount = Number(facts.invoiceAllocatedAmount ?? 0);
    const bonusAmount = Number(facts.bonusAllocatedAmount ?? 0);
    const otherAmount = Number(facts.otherAllocatedAmount ?? 0);
    if (invoiceAmount <= 0.005 && bonusAmount <= 0.005 && otherAmount > 0.005) {
      return {
        bucket: "custom",
        label: "Settled without invoice",
        tone: "neutral",
      };
    }
    return { bucket: "fully_matched", label: "Fully matched", tone: "good" };
  }
  if (facts.paymentStatus === "partially_allocated") {
    return { bucket: "needs_review", label: "Partially matched", tone: "warn" };
  }
  if (facts.paymentStatus === "unidentified") {
    return {
      bucket: "needs_review",
      label: "Recipient not verified",
      tone: "bad",
    };
  }
  if (facts.paymentStatus === "unmatched") {
    return { bucket: "needs_review", label: "Payment unmatched", tone: "bad" };
  }
  if (facts.paymentStatus === "needs_review") {
    return { bucket: "needs_review", label: "Allocation error", tone: "bad" };
  }

  return { bucket: "needs_review", label: "Needs review", tone: "warn" };
}

export type TransactionSettlementInput = {
  transaction_type: "income" | "expense" | "transfer" | "credit";
  source_details: {
    transfer_status: "cancelled" | null;
    overpayment_status: "confirmed" | null;
    invoice_evidence_status:
      | "no_invoice_provided"
      | "invoice_not_found"
      | "partial_no_invoice_residual"
      | null;
    expense_evidence_status: "bank_supported_no_itc" | null;
    customer_revenue_exception_kind: string | null;
    customer_revenue_exception_needs_review: boolean;
    manual_settlement_resolution: ManualSettlementResolution | null;
  };
  evidence: Array<{ kind: string }>;
  payment_verification: {
    payment_status:
      | "unidentified"
      | "unmatched"
      | "partially_allocated"
      | "fully_allocated"
      | "needs_review";
    invoice_allocated_amount: number;
    bonus_allocated_amount: number;
    other_allocated_amount: number;
  } | null;
  customer_revenue_verification: {
    payment_status: "unmatched" | "partially_allocated" | "fully_allocated";
  } | null;
};

export function getTransactionSettlementStatus(
  transaction: TransactionSettlementInput,
): SettlementDisplay {
  return resolveSettlementStatus({
    manualResolution:
      transaction.source_details.manual_settlement_resolution,
    transferCancelled:
      transaction.source_details.transfer_status === "cancelled",
    customerExceptionKind:
      transaction.source_details.customer_revenue_exception_kind,
    customerExceptionNeedsReview:
      transaction.source_details.customer_revenue_exception_needs_review,
    customerRevenueStatus:
      transaction.customer_revenue_verification?.payment_status ?? null,
    overpaymentConfirmed:
      transaction.source_details.overpayment_status === "confirmed",
    invoiceEvidenceStatus:
      transaction.source_details.invoice_evidence_status,
    expenseEvidenceConfirmed:
      transaction.source_details.expense_evidence_status ===
      "bank_supported_no_itc",
    expenseEvidenceLabel:
      transaction.source_details.expense_evidence_status ===
      "bank_supported_no_itc"
        ? transaction.transaction_type === "credit"
          ? "Subscription credit"
          : "Software expense"
        : null,
    noDocumentRequired: transaction.evidence.some(
      (item) => item.kind === "no_document_required",
    ),
    paymentStatus: transaction.payment_verification?.payment_status ?? null,
    invoiceAllocatedAmount:
      transaction.payment_verification?.invoice_allocated_amount,
    bonusAllocatedAmount:
      transaction.payment_verification?.bonus_allocated_amount,
    otherAllocatedAmount:
      transaction.payment_verification?.other_allocated_amount,
  });
}
