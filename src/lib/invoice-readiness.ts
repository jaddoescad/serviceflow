export type InvoiceReadinessState =
  | "needs_review"
  | "ready_to_pay"
  | "payment_sent"
  | "paid"
  | "void";

export type InvoicePaymentState = "unpaid" | "sent_pending" | "paid" | "void";

export type InvoiceReviewState = "not_required" | "complete" | "needs_review";

export type InvoiceReadinessCheckKey =
  | "source"
  | "supplier"
  | "line_totals"
  | "allocation"
  | "payment";

export type InvoiceReadinessCheck = {
  key: InvoiceReadinessCheckKey;
  label: string;
  status: "pass" | "pending" | "fail";
  detail: string;
};

type RelatedDocument = {
  original_filename?: string | null;
  storage_path?: string | null;
  source_url?: string | null;
  signed_url?: string | null;
};

type InvoiceEvidence = {
  evidence_role?: string | null;
  document?: RelatedDocument | RelatedDocument[] | null;
};

type InvoiceLine = {
  subtotal_cents?: number | string | null;
  tax_cents?: number | string | null;
  total_cents?: number | string | null;
  source_kind?: string | null;
  metadata?: Record<string, unknown> | null;
};

type InvoiceJobAllocation = {
  job_id?: string | null;
  subtotal_cents?: number | string | null;
  needs_review?: boolean | null;
};

type PaymentTransaction = {
  posted_on?: string | null;
  review_status?: string | null;
};

type InvoicePayment = {
  amount_cents?: number | string | null;
  needs_review?: boolean | null;
  reversed_at?: string | null;
  transaction?: PaymentTransaction | PaymentTransaction[] | null;
};

export type InvoiceReadinessInput = {
  status?: string | null;
  subtotal_cents?: number | string | null;
  tax_cents?: number | string | null;
  total_cents?: number | string | null;
  paid_cents?: number | string | null;
  balance_cents?: number | string | null;
  currency?: string | null;
  metadata?: Record<string, unknown> | null;
  contact?: { name?: string | null } | Array<{ name?: string | null }> | null;
  evidence?: InvoiceEvidence[] | null;
  lines?: InvoiceLine[] | null;
  allocations?: InvoiceJobAllocation[] | null;
  payments?: InvoicePayment[] | null;
};

export type InvoiceReadiness = {
  state: InvoiceReadinessState;
  reason: string;
  paymentState: InvoicePaymentState;
  paymentReason: string;
  reviewState: InvoiceReviewState;
  reviewReason: string;
  checks: InvoiceReadinessCheck[];
  passedCheckCount: number;
  allocationRequired: boolean;
  allocationTargetSubtotalCents: number;
  allocatedSubtotalCents: number;
  allocationVarianceCents: number;
  matchedPaidCents: number;
  remainingBalanceCents: number;
  paidOn: string | null;
  voidReason: string | null;
};

const VOID_STATUSES = new Set(["void", "voided"]);
const NON_JOB_ALLOCATION_STATUSES = new Set([
  "not_invoice",
  "overhead_unmatched",
  "supporting_document",
]);
const NON_JOB_LINE_TYPES = new Set([
  "administrative",
  "commission",
  "expense",
  "other",
  "sales",
  "va",
  "virtual_assistant",
]);

function cents(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function relatedOne<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("en-CA")
    .replace(/[\s-]+/g, "_");
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

function dateLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Toronto",
  }).format(new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00-04:00`));
}

function metadataText(
  metadata: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function invoiceIsVoid(invoice: InvoiceReadinessInput): boolean {
  return (
    VOID_STATUSES.has(normalizeStatus(invoice.status)) ||
    VOID_STATUSES.has(normalizeStatus(invoice.metadata?.accounting_status))
  );
}

function userConfirmedPayment(
  invoice: InvoiceReadinessInput,
): { confirmedOn: string | null } | null {
  const confirmation = invoice.metadata?.payment_confirmation;
  if (!confirmation || typeof confirmation !== "object" || Array.isArray(confirmation)) {
    return null;
  }
  const values = confirmation as Record<string, unknown>;
  if (
    values.status !== "paid" ||
    values.confirmation_method !== "user_confirmation" ||
    normalizeStatus(invoice.status) !== "paid" ||
    cents(invoice.paid_cents) < cents(invoice.total_cents) ||
    cents(invoice.balance_cents) !== 0
  ) {
    return null;
  }
  return {
    confirmedOn:
      typeof values.confirmed_on === "string" ? values.confirmed_on : null,
  };
}

function sentPendingPayment(
  invoice: InvoiceReadinessInput,
): {
  confirmationMasked: string | null;
  bankStatus: string | null;
  dispatchedOn: string | null;
} | null {
  const dispatch = invoice.metadata?.payment_dispatch;
  if (!dispatch || typeof dispatch !== "object" || Array.isArray(dispatch)) {
    return null;
  }
  const values = dispatch as Record<string, unknown>;
  if (
    !["sent_pending_bank_deposit", "sent_pending_bank_sync"].includes(
      normalizeStatus(values.status),
    )
  ) {
    return null;
  }
  return {
    confirmationMasked:
      typeof values.confirmation_masked === "string"
        ? values.confirmation_masked
        : null,
    bankStatus:
      typeof values.bank_status === "string" ? values.bank_status : null,
    dispatchedOn:
      typeof values.dispatched_on === "string" ? values.dispatched_on : null,
  };
}

function booleanMetadata(
  metadata: Record<string, unknown> | null | undefined,
  key: string,
): boolean | null {
  return typeof metadata?.[key] === "boolean"
    ? (metadata[key] as boolean)
    : null;
}

function lineRequiresJobAllocation(line: InvoiceLine): boolean {
  const explicit = booleanMetadata(line.metadata, "job_allocation_required");
  if (explicit !== null) return explicit;

  const entryType = normalizeStatus(line.metadata?.entry_type);
  if (entryType === "other" && line.metadata?.is_adjustment === true) {
    return true;
  }
  return !entryType || !NON_JOB_LINE_TYPES.has(entryType);
}

function jobAllocationTarget(
  invoice: InvoiceReadinessInput,
  lines: InvoiceLine[],
  subtotalCents: number,
): { required: boolean; subtotalCents: number } {
  const explicit = booleanMetadata(invoice.metadata, "job_allocation_required");
  if (explicit === false) return { required: false, subtotalCents: 0 };
  if (explicit === true) return { required: true, subtotalCents };

  const status = normalizeStatus(invoice.status);
  const importedStatus = normalizeStatus(invoice.metadata?.match_status);
  if (
    NON_JOB_ALLOCATION_STATUSES.has(status) ||
    NON_JOB_ALLOCATION_STATUSES.has(importedStatus)
  ) {
    return { required: false, subtotalCents: 0 };
  }

  if (!lines.length) return { required: true, subtotalCents };

  const jobCostLines = lines.filter(lineRequiresJobAllocation);
  const targetSubtotalCents = jobCostLines.reduce(
    (sum, line) => sum + cents(line.subtotal_cents),
    0,
  );
  return {
    required: jobCostLines.length > 0,
    subtotalCents: targetSubtotalCents,
  };
}

function sourceDocument(invoice: InvoiceReadinessInput): RelatedDocument | null {
  const evidence = invoice.evidence ?? [];
  const ordered = [
    ...evidence.filter((item) =>
      ["primary_invoice", "source_document", "source_supplier_invoice_export"].includes(
        normalizeStatus(item.evidence_role),
      ),
    ),
    ...evidence.filter(
      (item) =>
        !["primary_invoice", "source_document", "source_supplier_invoice_export"].includes(
          normalizeStatus(item.evidence_role),
        ),
    ),
  ];
  for (const item of ordered) {
    const document = relatedOne(item.document);
    if (document?.storage_path || document?.source_url || document?.signed_url) {
      return document;
    }
  }
  return null;
}

export function invoiceReadinessLabel(state: InvoiceReadinessState): string {
  return {
    needs_review: "Needs review",
    ready_to_pay: "Ready to pay",
    payment_sent: "Payment sent",
    paid: "Paid",
    void: "Void",
  }[state];
}

export function invoiceReadinessTone(
  state: InvoiceReadinessState,
): "neutral" | "good" | "warn" | "brand" {
  return {
    needs_review: "warn",
    ready_to_pay: "brand",
    payment_sent: "neutral",
    paid: "good",
    void: "neutral",
  }[state] as "neutral" | "good" | "warn" | "brand";
}

export function invoicePaymentLabel(state: InvoicePaymentState): string {
  return {
    unpaid: "Unpaid",
    sent_pending: "Sent",
    paid: "Paid",
    void: "Void",
  }[state];
}

export function invoicePaymentTone(
  state: InvoicePaymentState,
): "neutral" | "good" | "warn" {
  return {
    unpaid: "warn",
    sent_pending: "neutral",
    paid: "good",
    void: "neutral",
  }[state] as "neutral" | "good" | "warn";
}

export function invoiceReviewLabel(state: InvoiceReviewState): string {
  return {
    not_required: "Not needed",
    complete: "Complete",
    needs_review: "Needs review",
  }[state];
}

export function invoiceReviewTone(
  state: InvoiceReviewState,
): "neutral" | "good" | "warn" {
  return {
    not_required: "neutral",
    complete: "good",
    needs_review: "warn",
  }[state] as "neutral" | "good" | "warn";
}

/**
 * Read-only readiness calculation shared by invoice lists and details.
 * Bank allocations, rather than the stored invoice balance, are payment truth.
 */
export function deriveInvoiceReadiness(
  invoice: InvoiceReadinessInput,
): InvoiceReadiness {
  const currency = invoice.currency || "CAD";
  const subtotalCents = cents(invoice.subtotal_cents);
  const taxCents = cents(invoice.tax_cents);
  const totalCents = cents(invoice.total_cents);
  const contact = relatedOne(invoice.contact);
  const lines = invoice.lines ?? [];
  const allocations = invoice.allocations ?? [];
  const activePayments = (invoice.payments ?? []).filter(
    (payment) => !payment.reversed_at,
  );
  const confirmedPayment = userConfirmedPayment(invoice);
  const pendingPayment = sentPendingPayment(invoice);

  const allocationTarget = jobAllocationTarget(invoice, lines, subtotalCents);
  const allocationRequired = allocationTarget.required;
  const allocationTargetSubtotalCents = allocationTarget.subtotalCents;
  const allocatedSubtotalCents = allocations.reduce(
    (sum, allocation) => sum + cents(allocation.subtotal_cents),
    0,
  );
  const allocationVarianceCents =
    allocationTargetSubtotalCents - allocatedSubtotalCents;
  const matchedPaidCents = activePayments.reduce(
    (sum, payment) => sum + cents(payment.amount_cents),
    0,
  );
  const remainingBalanceCents = totalCents - matchedPaidCents;
  const paidDates = activePayments
    .map((payment) => relatedOne(payment.transaction)?.posted_on ?? null)
    .filter((value): value is string => Boolean(value))
    .sort();
  const paidOn = paidDates.at(-1) ?? null;

  const source = sourceDocument(invoice);
  const sourceCheck: InvoiceReadinessCheck = source
    ? {
        key: "source",
        label: "Source document",
        status: "pass",
        detail: source.original_filename || "Archived source attached",
      }
    : {
        key: "source",
        label: "Source document",
        status: "fail",
        detail: "No archived source document",
      };

  const supplierCheck: InvoiceReadinessCheck = contact?.name?.trim()
    ? {
        key: "supplier",
        label: "Supplier",
        status: "pass",
        detail: `${contact.name.trim()} identified`,
      }
    : {
        key: "supplier",
        label: "Supplier",
        status: "fail",
        detail: "Supplier not identified",
      };

  const lineSubtotalCents = lines.reduce(
    (sum, line) => sum + cents(line.subtotal_cents),
    0,
  );
  const lineTaxCents = lines.reduce(
    (sum, line) => sum + cents(line.tax_cents),
    0,
  );
  const lineTotalCents = lines.reduce(
    (sum, line) => sum + cents(line.total_cents),
    0,
  );
  const lineNeedsReview = lines.some(
    (line) =>
      line.metadata?.needs_review === true ||
      normalizeStatus(line.source_kind) === "legacy_invoice_total",
  );
  const lineTotalsMatch =
    lines.length > 0 &&
    totalCents > 0 &&
    !lineNeedsReview &&
    lineSubtotalCents === subtotalCents &&
    lineTaxCents === taxCents &&
    lineTotalCents === totalCents;
  const lineDifferenceCents = totalCents - lineTotalCents;
  const lineSubtotalDifferenceCents = subtotalCents - lineSubtotalCents;
  const lineTaxDifferenceCents = taxCents - lineTaxCents;
  const lineTotalsCheck: InvoiceReadinessCheck = lineTotalsMatch
    ? {
        key: "line_totals",
        label: "Invoice totals",
        status: "pass",
        detail: `${lines.length} ${lines.length === 1 ? "line equals" : "lines equal"} ${money(totalCents, currency)}`,
      }
    : {
        key: "line_totals",
        label: "Invoice totals",
        status: "fail",
        detail:
          totalCents <= 0
            ? "Invoice total must be greater than zero"
            : lines.length === 0
              ? "No invoice lines recorded"
              : lineNeedsReview
                ? "An invoice line needs review"
                : lineSubtotalDifferenceCents !== 0
                ? `${money(Math.abs(lineSubtotalDifferenceCents), currency)} subtotal difference between lines and invoice`
                : lineTaxDifferenceCents !== 0
                  ? `${money(Math.abs(lineTaxDifferenceCents), currency)} tax difference between lines and invoice`
                  : `${money(Math.abs(lineDifferenceCents), currency)} total difference between lines and invoice`,
      };

  const allocationNeedsReview = allocations.some(
    (allocation) => allocation.needs_review,
  );
  const jobCount = new Set(
    allocations.map((allocation) => allocation.job_id).filter(Boolean),
  ).size;
  const allocationMatches =
    !allocationNeedsReview &&
    allocationVarianceCents === 0 &&
    (!allocationRequired || allocations.length > 0);
  const allocationCheck: InvoiceReadinessCheck = allocationMatches
    ? {
        key: "allocation",
        label: "Job allocation",
        status: "pass",
        detail: allocationRequired
          ? `${money(allocatedSubtotalCents, currency)} across ${jobCount} ${jobCount === 1 ? "job" : "jobs"}`
          : "Not required for this invoice",
      }
    : {
        key: "allocation",
        label: "Job allocation",
        status: "fail",
        detail: allocationNeedsReview
          ? "A job allocation needs review"
          : allocations.length === 0
            ? "No job allocation recorded"
            : allocationVarianceCents > 0
              ? `${money(allocationVarianceCents, currency)} not allocated to a job`
              : `${money(Math.abs(allocationVarianceCents), currency)} overallocated`,
      };

  const paymentWithoutTransaction = activePayments.some(
    (payment) => !relatedOne(payment.transaction),
  );
  const paymentNeedsReview = activePayments.some(
    (payment) =>
      payment.needs_review ||
      normalizeStatus(relatedOne(payment.transaction)?.review_status) ===
        "needs_review",
  );
  let paymentCheck: InvoiceReadinessCheck;
  if (confirmedPayment) {
    paymentCheck = {
      key: "payment",
      label: "Payment confirmation",
      status: "pass",
      detail: confirmedPayment.confirmedOn
        ? `User confirmed paid on ${dateLabel(confirmedPayment.confirmedOn)} · no bank transaction matched`
        : "User confirmed paid · no bank transaction matched",
    };
  } else if (paymentWithoutTransaction) {
    paymentCheck = {
      key: "payment",
      label: "Bank payment",
      status: "fail",
      detail: "A payment allocation has no bank transaction",
    };
  } else if (paymentNeedsReview) {
    paymentCheck = {
      key: "payment",
      label: "Bank payment",
      status: "fail",
      detail: "A matched bank payment needs review",
    };
  } else if (pendingPayment) {
    paymentCheck = {
      key: "payment",
      label: "Bank payment",
      status: "pending",
      detail: `${pendingPayment.confirmationMasked ? `Transfer ${pendingPayment.confirmationMasked}` : "Transfer"} sent${pendingPayment.dispatchedOn ? ` on ${dateLabel(pendingPayment.dispatchedOn)}` : ""} · awaiting recipient deposit`,
    };
  } else if (matchedPaidCents < 0) {
    paymentCheck = {
      key: "payment",
      label: "Bank payment",
      status: "fail",
      detail: "Matched payment amount cannot be negative",
    };
  } else if (remainingBalanceCents < 0) {
    paymentCheck = {
      key: "payment",
      label: "Bank payment",
      status: "fail",
      detail: `${money(Math.abs(remainingBalanceCents), currency)} overpaid`,
    };
  } else if (matchedPaidCents > 0 && remainingBalanceCents === 0) {
    paymentCheck = {
      key: "payment",
      label: "Bank payment",
      status: "pass",
      detail: `${money(matchedPaidCents, currency)} matched${paidOn ? ` on ${dateLabel(paidOn)}` : ""}`,
    };
  } else {
    paymentCheck = {
      key: "payment",
      label: "Bank payment",
      status: "pending",
      detail:
        matchedPaidCents > 0
          ? `${money(matchedPaidCents, currency)} matched · ${money(remainingBalanceCents, currency)} remaining`
          : `No payment matched · ${money(remainingBalanceCents, currency)} remaining`,
    };
  }

  const checks = [
    sourceCheck,
    supplierCheck,
    lineTotalsCheck,
    allocationCheck,
    paymentCheck,
  ];
  const failedCheck = checks.find((check) => check.status === "fail");
  const voidReason = metadataText(invoice.metadata, [
    "void_reason",
    "reversal_reason",
    "reason",
  ]);
  const isVoid = invoiceIsVoid(invoice);
  const paymentState: InvoicePaymentState = isVoid
    ? "void"
    : confirmedPayment || (totalCents > 0 && matchedPaidCents >= totalCents)
      ? "paid"
      : pendingPayment
        ? "sent_pending"
        : "unpaid";
  const paymentReason = isVoid
    ? voidReason
      ? `Void · ${voidReason}`
      : "Void · excluded from payment"
    : paymentState === "paid"
      ? confirmedPayment
        ? confirmedPayment.confirmedOn
          ? `User confirmed paid on ${dateLabel(confirmedPayment.confirmedOn)} · no bank transaction matched`
          : "User confirmed paid · no bank transaction matched"
        : remainingBalanceCents < 0
        ? `${money(matchedPaidCents, currency)} matched · ${money(Math.abs(remainingBalanceCents), currency)} overpaid`
        : paidOn
          ? `Cleared by matched bank payment on ${dateLabel(paidOn)}`
          : "Cleared by matched bank payment"
      : paymentState === "sent_pending"
        ? `${pendingPayment?.confirmationMasked ? `Transfer ${pendingPayment.confirmationMasked}` : "Transfer"} sent${pendingPayment?.dispatchedOn ? ` on ${dateLabel(pendingPayment.dispatchedOn)}` : ""} · awaiting recipient deposit`
        : matchedPaidCents > 0
          ? `${money(matchedPaidCents, currency)} matched · ${money(remainingBalanceCents, currency)} remaining`
          : `${money(remainingBalanceCents, currency)} outstanding`;
  const reviewState: InvoiceReviewState = paymentState !== "paid"
    ? "not_required"
    : failedCheck
      ? "needs_review"
      : "complete";
  const reviewReason = reviewState === "needs_review"
    ? failedCheck?.detail ?? "A paid invoice check needs review"
    : reviewState === "complete"
      ? "No other invoice issues"
      : paymentState === "void"
        ? "Void invoices do not require review"
        : paymentState === "sent_pending"
          ? "Review begins after the transfer is deposited"
          : "Review begins after payment";

  let state: InvoiceReadinessState;
  let reason: string;
  if (isVoid) {
    state = "void";
    reason = voidReason ? `Void · ${voidReason}` : "Void · excluded from payment";
  } else if (failedCheck) {
    state = "needs_review";
    reason = failedCheck.detail;
  } else if (pendingPayment) {
    state = "payment_sent";
    reason = `${pendingPayment.confirmationMasked ? `Transfer ${pendingPayment.confirmationMasked}` : "Transfer"} sent · awaiting recipient deposit`;
  } else if (paymentCheck.status === "pass") {
    state = "paid";
    reason = confirmedPayment
      ? confirmedPayment.confirmedOn
        ? `User confirmed paid on ${dateLabel(confirmedPayment.confirmedOn)} · no bank transaction matched`
        : "User confirmed paid · no bank transaction matched"
      : paidOn
      ? `Cleared by matched bank payment on ${dateLabel(paidOn)}`
      : "Cleared by matched bank payment";
  } else {
    state = "ready_to_pay";
    reason =
      matchedPaidCents > 0
        ? `${money(matchedPaidCents, currency)} matched · ${money(remainingBalanceCents, currency)} remaining`
        : `All checks passed · ${money(remainingBalanceCents, currency)} outstanding`;
  }

  return {
    state,
    reason,
    paymentState,
    paymentReason,
    reviewState,
    reviewReason,
    checks,
    passedCheckCount: checks.filter((check) => check.status === "pass").length,
    allocationRequired,
    allocationTargetSubtotalCents,
    allocatedSubtotalCents,
    allocationVarianceCents,
    matchedPaidCents,
    remainingBalanceCents,
    paidOn,
    voidReason,
  };
}
