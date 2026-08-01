export type SettlementBucket = "fully_matched" | "needs_review" | "custom";

export type SettlementFacts = {
  transferCancelled?: boolean;
  customerExceptionKind?: string | null;
  customerExceptionNeedsReview?: boolean;
  customerRevenueStatus?:
    | "unmatched"
    | "partially_allocated"
    | "fully_allocated"
    | null;
  materialPaymentStatus?:
    | "unmatched"
    | "partially_allocated"
    | "fully_allocated"
    | "needs_review"
    | null;
  overpaymentConfirmed?: boolean;
  invoiceEvidenceStatus?:
    | "no_invoice_provided"
    | "invoice_not_found"
    | "partial_no_invoice_residual"
    | null;
  expenseEvidenceConfirmed?: boolean;
  expenseEvidenceLabel?: string | null;
  documentExceptionLabel?: string | null;
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
  if (facts.transferCancelled) {
    return { bucket: "custom", label: "Cancelled", tone: "neutral" };
  }

  if (facts.customerExceptionKind) {
    const label = customerExceptionLabel(facts.customerExceptionKind);
    return facts.customerExceptionNeedsReview
      ? { bucket: "needs_review", label: "Needs review", tone: "warn" }
      : { bucket: "custom", label, tone: "neutral" };
  }

  if (facts.overpaymentConfirmed) {
    return { bucket: "custom", label: "Overpayment", tone: "neutral" };
  }

  if (facts.invoiceEvidenceStatus === "no_invoice_provided") {
    return { bucket: "custom", label: "No invoice", tone: "bad" };
  }
  if (facts.invoiceEvidenceStatus === "partial_no_invoice_residual") {
    return {
      bucket: "custom",
      label: "Partial match · balance has no invoice",
      tone: "bad",
    };
  }
  if (facts.invoiceEvidenceStatus === "invoice_not_found") {
    return {
      bucket: "needs_review",
      label: "Needs review",
      tone: "warn",
    };
  }

  if (facts.expenseEvidenceConfirmed) {
    return {
      bucket: "custom",
      label: facts.expenseEvidenceLabel ?? "Documented expense",
      tone: "neutral",
    };
  }

  if (facts.documentExceptionLabel) {
    return {
      bucket: "custom",
      label: facts.documentExceptionLabel,
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
    return { bucket: "needs_review", label: "Needs review", tone: "warn" };
  }
  if (facts.customerRevenueStatus === "unmatched") {
    return {
      bucket: "needs_review",
      label: "Needs review",
      tone: "warn",
    };
  }

  if (facts.materialPaymentStatus === "fully_allocated") {
    return { bucket: "fully_matched", label: "Fully matched", tone: "good" };
  }
  if (
    facts.materialPaymentStatus === "partially_allocated" ||
    facts.materialPaymentStatus === "unmatched" ||
    facts.materialPaymentStatus === "needs_review"
  ) {
    return { bucket: "needs_review", label: "Needs review", tone: "warn" };
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
    return { bucket: "needs_review", label: "Needs review", tone: "warn" };
  }
  if (facts.paymentStatus === "unidentified") {
    return {
      bucket: "needs_review",
      label: "Needs review",
      tone: "warn",
    };
  }
  if (facts.paymentStatus === "unmatched") {
    return { bucket: "needs_review", label: "Needs review", tone: "warn" };
  }
  if (facts.paymentStatus === "needs_review") {
    return { bucket: "needs_review", label: "Needs review", tone: "warn" };
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
    expense_evidence_label: string | null;
    document_exception_label: string | null;
    customer_revenue_exception_kind: string | null;
    customer_revenue_exception_needs_review: boolean;
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
  material_payment_verification: {
    payment_status:
      | "unmatched"
      | "partially_allocated"
      | "fully_allocated"
      | "needs_review";
  } | null;
};

export function getTransactionSettlementStatus(
  transaction: TransactionSettlementInput,
): SettlementDisplay {
  return resolveSettlementStatus({
    transferCancelled:
      transaction.source_details.transfer_status === "cancelled",
    customerExceptionKind:
      transaction.source_details.customer_revenue_exception_kind,
    customerExceptionNeedsReview:
      transaction.source_details.customer_revenue_exception_needs_review,
    customerRevenueStatus:
      transaction.customer_revenue_verification?.payment_status ?? null,
    materialPaymentStatus:
      transaction.material_payment_verification?.payment_status ?? null,
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
        ? transaction.source_details.expense_evidence_label ??
          (transaction.transaction_type === "credit"
            ? "Subscription credit"
            : "Documented expense")
        : null,
    documentExceptionLabel:
      transaction.source_details.document_exception_label,
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
