export type MatchQueue =
  | "ready_to_confirm"
  | "combined_or_split"
  | "recipient_confirmation"
  | "no_candidate";

export type MatchKind =
  | "exact_one_to_one"
  | "combined_invoices"
  | "split_payment"
  | "partial_payment"
  | "possible_overpayment"
  | "recipient_unknown_exact";

export type MatchConfidence = "high" | "medium" | "low";

export type MatchableInvoice = {
  id: string;
  contractorId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  sourceDate: string | null;
  currency: string;
  grossAmount: number;
  allocatedAmount: number;
  remainingAmount: number;
  originalFilename: string;
  duplicateVersionCount: number;
};

export type MatchablePayment = {
  id: string;
  contractorId: string | null;
  supplierName: string | null;
  recipientStatus: "unknown" | "confirmed";
  confirmationMethod: string | null;
  confirmationNote: string | null;
  confirmedAt: string | null;
  postedOn: string;
  currency: string;
  paymentAmount: number;
  allocatedAmount: number;
  availableAmount: number;
  description: string;
  counterparty: string | null;
  category: string;
  accountName: string;
  accountLastFour: string | null;
  sourceFilename: string;
  recipientName: string | null;
  recipientEmail: string | null;
  confirmationSuffix: string | null;
};

export type InvoiceBankMatchProposal = {
  id: string;
  queue: Exclude<MatchQueue, "no_candidate">;
  kind: MatchKind;
  confidence: MatchConfidence;
  contractorId: string | null;
  supplierName: string;
  invoices: MatchableInvoice[];
  payments: MatchablePayment[];
  invoiceAmount: number;
  paymentAmount: number;
  difference: number;
  dateDistanceDays: number | null;
  evidence: string[];
};

export type UnmatchedInvoiceItem = {
  id: string;
  queue: "no_candidate";
  itemType: "invoice";
  supplierName: string;
  invoice: MatchableInvoice;
  payment: null;
  amount: number;
  reason: string;
};

export type UnmatchedPaymentItem = {
  id: string;
  queue: "no_candidate";
  itemType: "payment";
  supplierName: string;
  invoice: null;
  payment: MatchablePayment;
  amount: number;
  reason: string;
};

export type UnmatchedMatchItem =
  | UnmatchedInvoiceItem
  | UnmatchedPaymentItem;

export type InvoiceBankMatchReport = {
  generatedAt: string;
  proposals: InvoiceBankMatchProposal[];
  unmatched: UnmatchedMatchItem[];
  stats: {
    sourceInvoiceFiles: number;
    canonicalInvoices: number;
    duplicateVersionsExcluded: number;
    invoicesAlreadyAllocated: number;
    paymentsAlreadyAllocated: number;
    outstandingInvoices: number;
    eligibleBankPayments: number;
    confirmedRecipientPayments: number;
    unknownRecipientPayments: number;
    readyToConfirm: number;
    combinedOrSplit: number;
    recipientConfirmation: number;
    unmatchedInvoices: number;
    unmatchedPayments: number;
    proposedInvoiceAmount: number;
    proposedPaymentAmount: number;
  };
};

export type InvoiceBankMatchMetadata = {
  sourceInvoiceFiles: number;
  duplicateVersionsExcluded: number;
  invoicesAlreadyAllocated: number;
  paymentsAlreadyAllocated: number;
};

const DATE_EARLY_TOLERANCE_DAYS = 7;
const DATE_WINDOW_DAYS = 180;
const MAX_SUBSET_SIZE = 6;
const MAX_SUBSET_RESULTS = 8;

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function money(value: number): number {
  return cents(value) / 100;
}

function groupBy<T>(
  items: T[],
  getKey: (item: T) => string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function dateDistance(paymentDate: string, invoiceDate: string): number {
  const payment = new Date(`${paymentDate}T12:00:00Z`).getTime();
  const invoice = new Date(`${invoiceDate}T12:00:00Z`).getTime();
  return Math.round((payment - invoice) / 86_400_000);
}

function dateEligible(paymentDate: string, invoiceDate: string): boolean {
  const distance = dateDistance(paymentDate, invoiceDate);
  return (
    distance >= -DATE_EARLY_TOLERANCE_DAYS &&
    distance <= DATE_WINDOW_DAYS
  );
}

function proposalDateDistance(
  invoices: MatchableInvoice[],
  payments: MatchablePayment[],
): number | null {
  const distances = payments.flatMap((payment) =>
    invoices.map((invoice) =>
      Math.abs(dateDistance(payment.postedOn, invoice.invoiceDate)),
    ),
  );
  return distances.length ? Math.min(...distances) : null;
}

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function proposalId(
  kind: MatchKind,
  invoices: MatchableInvoice[],
  payments: MatchablePayment[],
): string {
  return `match-${hashText(
    [
      kind,
      ...invoices.map((invoice) => invoice.id).sort(),
      ...payments.map((payment) => payment.id).sort(),
    ].join("|"),
  )}`;
}

function createProposal({
  queue,
  kind,
  confidence,
  invoices,
  payments,
  evidence,
}: {
  queue: Exclude<MatchQueue, "no_candidate">;
  kind: MatchKind;
  confidence: MatchConfidence;
  invoices: MatchableInvoice[];
  payments: MatchablePayment[];
  evidence: string[];
}): InvoiceBankMatchProposal {
  const invoiceAmount = money(
    invoices.reduce(
      (total, invoice) => total + invoice.remainingAmount,
      0,
    ),
  );
  const paymentAmount = money(
    payments.reduce(
      (total, payment) => total + payment.availableAmount,
      0,
    ),
  );
  const supplierNames = [
    ...new Set(
      [
        ...invoices.map((invoice) => invoice.supplierName),
        ...payments
          .map((payment) => payment.supplierName)
          .filter((name): name is string => Boolean(name)),
      ].filter(Boolean),
    ),
  ];
  const contractorIds = [
    ...new Set(
      [
        ...invoices.map((invoice) => invoice.contractorId),
        ...payments
          .map((payment) => payment.contractorId)
          .filter((id): id is string => Boolean(id)),
      ].filter(Boolean),
    ),
  ];

  return {
    id: proposalId(kind, invoices, payments),
    queue,
    kind,
    confidence,
    contractorId: contractorIds.length === 1 ? contractorIds[0]! : null,
    supplierName:
      supplierNames.length === 1
        ? supplierNames[0]!
        : supplierNames.join(" / ") || "Unknown recipient",
    invoices,
    payments,
    invoiceAmount,
    paymentAmount,
    difference: money(paymentAmount - invoiceAmount),
    dateDistanceDays: proposalDateDistance(invoices, payments),
    evidence,
  };
}

type AmountItem = {
  id: string;
  amount: number;
};

function findExactSubsets<T extends AmountItem>(
  items: T[],
  targetAmount: number,
  minimumItems = 2,
): T[][] {
  const target = cents(targetAmount);
  if (target <= 0 || items.length < minimumItems) return [];

  const sorted = [...items].sort(
    (left, right) =>
      cents(right.amount) - cents(left.amount) ||
      left.id.localeCompare(right.id),
  );
  const levels = Array.from(
    { length: MAX_SUBSET_SIZE + 1 },
    () => new Map<number, number[][]>(),
  );
  levels[0]!.set(0, [[]]);

  for (let itemIndex = 0; itemIndex < sorted.length; itemIndex += 1) {
    const itemAmount = cents(sorted[itemIndex]!.amount);
    for (
      let itemCount = Math.min(MAX_SUBSET_SIZE - 1, itemIndex);
      itemCount >= 0;
      itemCount -= 1
    ) {
      for (const [subtotal, combinations] of [
        ...levels[itemCount]!.entries(),
      ]) {
        const nextTotal = subtotal + itemAmount;
        if (nextTotal > target) continue;
        const destination = levels[itemCount + 1]!;
        const existing = destination.get(nextTotal) ?? [];
        if (existing.length >= MAX_SUBSET_RESULTS) continue;
        destination.set(nextTotal, [
          ...existing,
          ...combinations
            .slice(0, MAX_SUBSET_RESULTS - existing.length)
            .map((combination) => [...combination, itemIndex]),
        ]);
      }
    }
  }

  const results: T[][] = [];
  const seen = new Set<string>();
  for (
    let itemCount = minimumItems;
    itemCount <= MAX_SUBSET_SIZE;
    itemCount += 1
  ) {
    for (const combination of levels[itemCount]!.get(target) ?? []) {
      const subset = combination.map((index) => sorted[index]!);
      const key = subset
        .map((item) => item.id)
        .sort()
        .join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(subset);
      if (results.length >= MAX_SUBSET_RESULTS) return results;
    }
  }
  return results;
}

function proposalSort(
  left: InvoiceBankMatchProposal,
  right: InvoiceBankMatchProposal,
): number {
  const queueOrder: Record<InvoiceBankMatchProposal["queue"], number> = {
    ready_to_confirm: 0,
    combined_or_split: 1,
    recipient_confirmation: 2,
  };
  return (
    queueOrder[left.queue] - queueOrder[right.queue] ||
    (left.dateDistanceDays ?? Number.MAX_SAFE_INTEGER) -
      (right.dateDistanceDays ?? Number.MAX_SAFE_INTEGER) ||
    right.paymentAmount - left.paymentAmount ||
    left.supplierName.localeCompare(right.supplierName, "en-CA")
  );
}

export function buildInvoiceBankMatchReport({
  invoices,
  payments,
  metadata,
  generatedAt = new Date().toISOString(),
}: {
  invoices: MatchableInvoice[];
  payments: MatchablePayment[];
  metadata: InvoiceBankMatchMetadata;
  generatedAt?: string;
}): InvoiceBankMatchReport {
  const outstandingInvoices = invoices.filter(
    (invoice) => invoice.remainingAmount > 0.005,
  );
  const availablePayments = payments.filter(
    (payment) => payment.availableAmount > 0.005,
  );
  const proposals: InvoiceBankMatchProposal[] = [];
  const reservedInvoiceIds = new Set<string>();
  const reservedPaymentIds = new Set<string>();

  const confirmedPayments = availablePayments.filter(
    (payment) =>
      payment.recipientStatus === "confirmed" && payment.contractorId != null,
  );

  const exactPairs = confirmedPayments.flatMap((payment) =>
    outstandingInvoices
      .filter(
        (invoice) =>
          invoice.contractorId === payment.contractorId &&
          invoice.currency === payment.currency &&
          dateEligible(payment.postedOn, invoice.invoiceDate) &&
          cents(invoice.remainingAmount) === cents(payment.availableAmount),
      )
      .map((invoice) => ({ invoice, payment })),
  );
  const exactCountByInvoice = new Map<string, number>();
  const exactCountByPayment = new Map<string, number>();
  for (const pair of exactPairs) {
    exactCountByInvoice.set(
      pair.invoice.id,
      (exactCountByInvoice.get(pair.invoice.id) ?? 0) + 1,
    );
    exactCountByPayment.set(
      pair.payment.id,
      (exactCountByPayment.get(pair.payment.id) ?? 0) + 1,
    );
  }

  for (const pair of exactPairs) {
    if (
      exactCountByInvoice.get(pair.invoice.id) !== 1 ||
      exactCountByPayment.get(pair.payment.id) !== 1 ||
      reservedInvoiceIds.has(pair.invoice.id) ||
      reservedPaymentIds.has(pair.payment.id)
    ) {
      continue;
    }
    proposals.push(
      createProposal({
        queue: "ready_to_confirm",
        kind: "exact_one_to_one",
        confidence: "high",
        invoices: [pair.invoice],
        payments: [pair.payment],
        evidence: [
          "Bank recipient is confirmed for this contractor.",
          "Bank amount exactly equals the outstanding gross invoice amount.",
          `Payment is ${Math.abs(
            dateDistance(pair.payment.postedOn, pair.invoice.invoiceDate),
          )} day(s) from the invoice date.`,
        ],
      }),
    );
    reservedInvoiceIds.add(pair.invoice.id);
    reservedPaymentIds.add(pair.payment.id);
  }

  for (const payment of confirmedPayments) {
    if (reservedPaymentIds.has(payment.id)) continue;
    const candidates = outstandingInvoices.filter(
      (invoice) =>
        !reservedInvoiceIds.has(invoice.id) &&
        invoice.contractorId === payment.contractorId &&
        invoice.currency === payment.currency &&
        dateEligible(payment.postedOn, invoice.invoiceDate),
    );
    const subsets = findExactSubsets(
      candidates.map((invoice) => ({
        ...invoice,
        amount: invoice.remainingAmount,
      })),
      payment.availableAmount,
    );
    if (subsets.length !== 1) continue;

    const matchedInvoices = subsets[0]!;
    proposals.push(
      createProposal({
        queue: "combined_or_split",
        kind: "combined_invoices",
        confidence: "high",
        invoices: matchedInvoices,
        payments: [payment],
        evidence: [
          "Bank recipient is confirmed for this contractor.",
          `One bank payment exactly equals ${matchedInvoices.length} outstanding invoices.`,
          "No other invoice combination in the date window produced the same total.",
        ],
      }),
    );
    reservedPaymentIds.add(payment.id);
    for (const invoice of matchedInvoices) {
      reservedInvoiceIds.add(invoice.id);
    }
  }

  for (const invoice of outstandingInvoices) {
    if (reservedInvoiceIds.has(invoice.id)) continue;
    const candidates = confirmedPayments.filter(
      (payment) =>
        !reservedPaymentIds.has(payment.id) &&
        payment.contractorId === invoice.contractorId &&
        payment.currency === invoice.currency &&
        dateEligible(payment.postedOn, invoice.invoiceDate),
    );
    const subsets = findExactSubsets(
      candidates.map((payment) => ({
        ...payment,
        amount: payment.availableAmount,
      })),
      invoice.remainingAmount,
    );
    if (subsets.length !== 1) continue;

    const matchedPayments = subsets[0]!;
    proposals.push(
      createProposal({
        queue: "combined_or_split",
        kind: "split_payment",
        confidence: "high",
        invoices: [invoice],
        payments: matchedPayments,
        evidence: [
          "Every bank recipient is confirmed for this contractor.",
          `${matchedPayments.length} bank payments exactly equal the outstanding invoice amount.`,
          "No other payment combination in the date window produced the same total.",
        ],
      }),
    );
    reservedInvoiceIds.add(invoice.id);
    for (const payment of matchedPayments) {
      reservedPaymentIds.add(payment.id);
    }
  }

  const remainingInvoicesByContractor = groupBy(
    outstandingInvoices.filter(
      (invoice) => !reservedInvoiceIds.has(invoice.id),
    ),
    (invoice) => `${invoice.contractorId}|${invoice.currency}`,
  );
  const remainingPaymentsByContractor = groupBy(
    confirmedPayments.filter(
      (payment) => !reservedPaymentIds.has(payment.id),
    ),
    (payment) => `${payment.contractorId}|${payment.currency}`,
  );

  for (const [contractorKey, contractorInvoices] of [
    ...remainingInvoicesByContractor.entries(),
  ]) {
    const contractorPayments =
      remainingPaymentsByContractor.get(contractorKey) ?? [];
    if (contractorInvoices.length !== 1 || !contractorPayments.length) {
      continue;
    }
    const invoice = contractorInvoices[0]!;
    const eligiblePayments = contractorPayments.filter((payment) =>
      dateEligible(payment.postedOn, invoice.invoiceDate),
    );
    if (!eligiblePayments.length) continue;

    const paymentTotal = money(
      eligiblePayments.reduce(
        (total, payment) => total + payment.availableAmount,
        0,
      ),
    );
    const ratio = paymentTotal / invoice.remainingAmount;
    if (ratio < 0.2 || ratio > 2) continue;

    const kind: MatchKind =
      eligiblePayments.length > 1
        ? "split_payment"
        : paymentTotal < invoice.remainingAmount
          ? "partial_payment"
          : "possible_overpayment";
    proposals.push(
      createProposal({
        queue: "combined_or_split",
        kind,
        confidence: "medium",
        invoices: [invoice],
        payments: eligiblePayments,
        evidence: [
          "The recipient is confirmed and this is the only outstanding invoice for the contractor in this currency.",
          `${eligiblePayments.length} available bank payment(s) total ${money(
            paymentTotal,
          ).toFixed(2)} against ${invoice.remainingAmount.toFixed(2)} outstanding.`,
          "The amount difference requires a manual explanation before settlement.",
        ],
      }),
    );
    reservedInvoiceIds.add(invoice.id);
    for (const payment of eligiblePayments) {
      reservedPaymentIds.add(payment.id);
    }
  }

  const unknownPayments = availablePayments.filter(
    (payment) =>
      payment.recipientStatus === "unknown" &&
      !reservedPaymentIds.has(payment.id),
  );
  const unknownExactPairs = unknownPayments.flatMap((payment) =>
    outstandingInvoices
      .filter(
        (invoice) =>
          !reservedInvoiceIds.has(invoice.id) &&
          invoice.currency === payment.currency &&
          dateEligible(payment.postedOn, invoice.invoiceDate) &&
          cents(invoice.remainingAmount) === cents(payment.availableAmount),
      )
      .map((invoice) => ({ invoice, payment })),
  );
  const unknownCountByInvoice = new Map<string, number>();
  const unknownCountByPayment = new Map<string, number>();
  for (const pair of unknownExactPairs) {
    unknownCountByInvoice.set(
      pair.invoice.id,
      (unknownCountByInvoice.get(pair.invoice.id) ?? 0) + 1,
    );
    unknownCountByPayment.set(
      pair.payment.id,
      (unknownCountByPayment.get(pair.payment.id) ?? 0) + 1,
    );
  }

  for (const pair of unknownExactPairs) {
    if (
      unknownCountByInvoice.get(pair.invoice.id) !== 1 ||
      unknownCountByPayment.get(pair.payment.id) !== 1 ||
      reservedInvoiceIds.has(pair.invoice.id) ||
      reservedPaymentIds.has(pair.payment.id)
    ) {
      continue;
    }
    proposals.push(
      createProposal({
        queue: "recipient_confirmation",
        kind: "recipient_unknown_exact",
        confidence: "medium",
        invoices: [pair.invoice],
        payments: [pair.payment],
        evidence: [
          "Bank amount exactly equals one outstanding gross invoice amount in the date window.",
          "The bank recipient has not been confirmed, so this cannot be settled yet.",
          "Confirm the e-transfer recipient before approving this match.",
        ],
      }),
    );
    reservedInvoiceIds.add(pair.invoice.id);
    reservedPaymentIds.add(pair.payment.id);
  }

  const unmatchedInvoices: UnmatchedInvoiceItem[] = outstandingInvoices
    .filter((invoice) => !reservedInvoiceIds.has(invoice.id))
    .map((invoice) => {
      const hasConfirmedPayments = confirmedPayments.some(
        (payment) =>
          payment.contractorId === invoice.contractorId &&
          payment.currency === invoice.currency,
      );
      return {
        id: `unmatched-invoice-${invoice.id}`,
        queue: "no_candidate",
        itemType: "invoice",
        supplierName: invoice.supplierName,
        invoice,
        payment: null,
        amount: invoice.remainingAmount,
        reason: hasConfirmedPayments
          ? "Confirmed contractor payments exist, but no reliable amount/date combination matched this invoice."
          : "No available bank payment has a confirmed recipient for this contractor.",
      };
    });

  const unmatchedPayments: UnmatchedPaymentItem[] = availablePayments
    .filter((payment) => !reservedPaymentIds.has(payment.id))
    .map((payment) => ({
      id: `unmatched-payment-${payment.id}`,
      queue: "no_candidate",
      itemType: "payment",
      supplierName:
        payment.supplierName ??
        payment.counterparty ??
        "Recipient not confirmed",
      invoice: null,
      payment,
      amount: payment.availableAmount,
      reason:
        payment.recipientStatus === "unknown"
          ? "Recipient is not confirmed and no unique exact invoice amount was found."
          : "Recipient is confirmed, but no reliable invoice amount/date combination matched this payment.",
    }));

  proposals.sort(proposalSort);
  const unmatched = [...unmatchedInvoices, ...unmatchedPayments].sort(
    (left, right) =>
      right.amount - left.amount ||
      left.supplierName.localeCompare(right.supplierName, "en-CA"),
  );

  return {
    generatedAt,
    proposals,
    unmatched,
    stats: {
      sourceInvoiceFiles: metadata.sourceInvoiceFiles,
      canonicalInvoices: invoices.length,
      duplicateVersionsExcluded: metadata.duplicateVersionsExcluded,
      invoicesAlreadyAllocated: metadata.invoicesAlreadyAllocated,
      paymentsAlreadyAllocated: metadata.paymentsAlreadyAllocated,
      outstandingInvoices: outstandingInvoices.length,
      eligibleBankPayments: availablePayments.length,
      confirmedRecipientPayments: confirmedPayments.length,
      unknownRecipientPayments: unknownPayments.length,
      readyToConfirm: proposals.filter(
        (proposal) => proposal.queue === "ready_to_confirm",
      ).length,
      combinedOrSplit: proposals.filter(
        (proposal) => proposal.queue === "combined_or_split",
      ).length,
      recipientConfirmation: proposals.filter(
        (proposal) => proposal.queue === "recipient_confirmation",
      ).length,
      unmatchedInvoices: unmatchedInvoices.length,
      unmatchedPayments: unmatchedPayments.length,
      proposedInvoiceAmount: money(
        proposals.reduce(
          (total, proposal) => total + proposal.invoiceAmount,
          0,
        ),
      ),
      proposedPaymentAmount: money(
        proposals.reduce(
          (total, proposal) => total + proposal.paymentAmount,
          0,
        ),
      ),
    },
  };
}
