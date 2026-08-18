import assert from "node:assert/strict";
import test from "node:test";
import { deriveInvoiceReadiness } from "../src/lib/invoice-readiness.ts";
import {
  isContractorInvoiceReviewRecord,
  isHistoricalLabourInvoice,
  isPayableLabourInvoiceRecord,
} from "../src/lib/invoice-review-visibility.ts";

test("contractor review includes labour and contractor-origin company expenses", () => {
  assert.equal(isContractorInvoiceReviewRecord({ direction: "payable", category: "labour", source_system: "labour_import" }), true);
  assert.equal(isContractorInvoiceReviewRecord({ direction: "payable", category: "other", source_system: "gmail_labour_invoice" }), true);
  assert.equal(isContractorInvoiceReviewRecord({ direction: "payable", category: "other", source_system: "gmail_contractor_invoice" }), true);
  assert.equal(isContractorInvoiceReviewRecord({ direction: "receivable", category: "other", source_system: "gmail_labour_invoice" }), false);
  assert.equal(isContractorInvoiceReviewRecord({ direction: "payable", category: "other", source_system: "stripe" }), false);
});

function validInvoice(overrides = {}) {
  return {
    status: "open",
    currency: "CAD",
    subtotal_cents: 10_000,
    tax_cents: 1_300,
    total_cents: 11_300,
    paid_cents: 0,
    balance_cents: 11_300,
    metadata: {},
    contact: { name: "Ottawa Painter" },
    evidence: [
      {
        evidence_role: "source_document",
        document: {
          original_filename: "invoice-100.pdf",
          storage_path: "labour/invoice-100.pdf",
        },
      },
    ],
    lines: [
      {
        subtotal_cents: 10_000,
        tax_cents: 1_300,
        total_cents: 11_300,
      },
    ],
    allocations: [
      {
        job_id: "job-1",
        subtotal_cents: 10_000,
        needs_review: false,
      },
    ],
    payments: [],
    ...overrides,
  };
}

test("a verified unpaid invoice is ready to pay", () => {
  const readiness = deriveInvoiceReadiness(validInvoice());

  assert.equal(readiness.state, "ready_to_pay");
  assert.equal(readiness.paymentState, "unpaid");
  assert.equal(readiness.reviewState, "not_required");
  assert.equal(readiness.matchedPaidCents, 0);
  assert.equal(readiness.remainingBalanceCents, 11_300);
  assert.equal(readiness.passedCheckCount, 4);
});

test("a fully matched bank payment makes the invoice paid", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({
      payments: [
        {
          amount_cents: 11_300,
          needs_review: false,
          reversed_at: null,
          transaction: { posted_on: "2026-08-04", review_status: "reconciled" },
        },
      ],
    }),
  );

  assert.equal(readiness.state, "paid");
  assert.equal(readiness.paymentState, "paid");
  assert.equal(readiness.reviewState, "complete");
  assert.equal(readiness.passedCheckCount, 5);
  assert.equal(readiness.paidOn, "2026-08-04");
  assert.equal(readiness.remainingBalanceCents, 0);
});

test("void wins even when every readiness prerequisite fails", () => {
  const readiness = deriveInvoiceReadiness({
    ...validInvoice({
      status: "void",
      metadata: { void_reason: "Duplicate of invoice 99" },
    }),
    contact: null,
    evidence: [],
    lines: [],
    allocations: [],
  });

  assert.equal(readiness.state, "void");
  assert.equal(readiness.paymentState, "void");
  assert.equal(readiness.reviewState, "not_required");
  assert.equal(readiness.voidReason, "Duplicate of invoice 99");
  assert.match(readiness.reason, /Duplicate of invoice 99/);
});

test("metadata accounting status also recognizes a void invoice", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({ status: "open", metadata: { accounting_status: "void" } }),
  );

  assert.equal(readiness.state, "void");
});

test("a zero stored balance without bank evidence is not paid", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({ paid_cents: 11_300, balance_cents: 0, payments: [] }),
  );

  assert.equal(readiness.state, "ready_to_pay");
  assert.equal(readiness.matchedPaidCents, 0);
  assert.equal(readiness.remainingBalanceCents, 11_300);
});

test("an explicit user-confirmed payment is paid without inventing a bank match", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({
      status: "paid",
      paid_cents: 11_300,
      balance_cents: 0,
      metadata: {
        payment_confirmation: {
          status: "paid",
          confirmation_method: "user_confirmation",
          confirmed_on: "2026-08-17",
        },
      },
      payments: [],
    }),
  );

  assert.equal(readiness.state, "paid");
  assert.equal(readiness.paymentState, "paid");
  assert.equal(readiness.reviewState, "complete");
  assert.equal(readiness.matchedPaidCents, 0);
  assert.equal(readiness.remainingBalanceCents, 11_300);
  assert.match(readiness.paymentReason, /User confirmed paid on Aug 17, 2026/);
  assert.match(readiness.paymentReason, /no bank transaction matched/);
});

test("stored paid fields alone still cannot bypass payment evidence", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({
      status: "paid",
      paid_cents: 11_300,
      balance_cents: 0,
      metadata: {},
      payments: [],
    }),
  );

  assert.equal(readiness.paymentState, "unpaid");
});

test("a reversed payment allocation does not count", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({
      payments: [
        {
          amount_cents: 11_300,
          reversed_at: "2026-08-05T12:00:00Z",
          transaction: { posted_on: "2026-08-04", review_status: "reconciled" },
        },
      ],
    }),
  );

  assert.equal(readiness.state, "ready_to_pay");
  assert.equal(readiness.matchedPaidCents, 0);
});

test("a partial payment remains ready with the exact remainder", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({
      payments: [
        {
          amount_cents: 5_000,
          reversed_at: null,
          transaction: { posted_on: "2026-08-04", review_status: "reconciled" },
        },
      ],
    }),
  );

  assert.equal(readiness.state, "ready_to_pay");
  assert.equal(readiness.remainingBalanceCents, 6_300);
});

test("a job allocation variance requires review", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({
      allocations: [
        { job_id: "job-1", subtotal_cents: 8_000, needs_review: false },
      ],
    }),
  );

  assert.equal(readiness.state, "needs_review");
  assert.equal(readiness.paymentState, "unpaid");
  assert.equal(readiness.reviewState, "not_required");
  assert.equal(readiness.allocationVarianceCents, 2_000);
  assert.match(readiness.reason, /not allocated/);
});

test("an overhead invoice does not require a job allocation", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({ status: "overhead_unmatched", allocations: [] }),
  );

  assert.equal(readiness.state, "ready_to_pay");
  assert.equal(readiness.allocationRequired, false);
  assert.equal(readiness.allocationTargetSubtotalCents, 0);
  assert.equal(readiness.allocationVarianceCents, 0);
  assert.equal(
    readiness.checks.find((check) => check.key === "allocation")?.detail,
    "Not required for this invoice",
  );
});

test("commission and VA expense lines do not require a job allocation", () => {
  for (const entryType of ["commission", "expense"]) {
    const readiness = deriveInvoiceReadiness(
      validInvoice({
        allocations: [],
        lines: [
          {
            subtotal_cents: 10_000,
            tax_cents: 1_300,
            total_cents: 11_300,
            metadata: { entry_type: entryType },
          },
        ],
      }),
    );

    assert.equal(readiness.state, "ready_to_pay");
    assert.equal(readiness.allocationRequired, false);
  }
});

test("a job-linked bonus requires and accepts an exact allocation", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({
      lines: [
        {
          subtotal_cents: 7_500,
          tax_cents: 975,
          total_cents: 8_475,
          metadata: { entry_type: "bonus" },
        },
      ],
      subtotal_cents: 7_500,
      tax_cents: 975,
      total_cents: 8_475,
      allocations: [
        { job_id: "job-1", subtotal_cents: 7_500, needs_review: false },
      ],
    }),
  );

  assert.equal(readiness.state, "ready_to_pay");
  assert.equal(readiness.allocationRequired, true);
  assert.equal(readiness.allocationTargetSubtotalCents, 7_500);
});

test("a job-cost adjustment contributes to the allocation target", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({
      lines: [
        {
          subtotal_cents: 10_000,
          tax_cents: 1_300,
          total_cents: 11_300,
          metadata: { entry_type: "labour" },
        },
        {
          subtotal_cents: -1_500,
          tax_cents: 0,
          total_cents: -1_500,
          metadata: { entry_type: "other", is_adjustment: true },
        },
      ],
      subtotal_cents: 8_500,
      tax_cents: 1_300,
      total_cents: 9_800,
      allocations: [
        { job_id: "job-1", subtotal_cents: 8_500, needs_review: false },
      ],
    }),
  );

  assert.equal(readiness.state, "ready_to_pay");
  assert.equal(readiness.allocationTargetSubtotalCents, 8_500);
  assert.equal(readiness.allocationVarianceCents, 0);
});

test("a zero-dollar job bonus still needs an explicit allocation", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({
      subtotal_cents: 0,
      tax_cents: 0,
      total_cents: 1,
      lines: [
        {
          subtotal_cents: 0,
          tax_cents: 0,
          total_cents: 1,
          metadata: { entry_type: "bonus" },
        },
      ],
      allocations: [],
    }),
  );

  assert.equal(readiness.allocationRequired, true);
  assert.equal(readiness.state, "needs_review");
  assert.match(readiness.reason, /No job allocation/);
});

test("a mixed invoice only requires job allocation for job-cost lines", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({
      allocations: [
        { job_id: "job-1", subtotal_cents: 8_000, needs_review: false },
      ],
      lines: [
        {
          subtotal_cents: 8_000,
          tax_cents: 1_040,
          total_cents: 9_040,
          metadata: { entry_type: "labour" },
        },
        {
          subtotal_cents: 2_000,
          tax_cents: 260,
          total_cents: 2_260,
          metadata: { entry_type: "commission" },
        },
      ],
    }),
  );

  assert.equal(readiness.state, "ready_to_pay");
  assert.equal(readiness.allocationRequired, true);
  assert.equal(readiness.allocationTargetSubtotalCents, 8_000);
  assert.equal(readiness.allocationVarianceCents, 0);
});

test("an unclassified invoice still requires a job allocation", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({ allocations: [] }),
  );

  assert.equal(readiness.state, "needs_review");
  assert.equal(readiness.allocationRequired, true);
  assert.match(readiness.reason, /No job allocation/);
});

test("line subtotal and tax differences cannot hide behind a matching total", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({
      lines: [
        { subtotal_cents: 9_900, tax_cents: 1_400, total_cents: 11_300 },
      ],
    }),
  );

  assert.equal(readiness.state, "needs_review");
  assert.match(readiness.reason, /subtotal difference/);
});

test("a line explicitly marked for review blocks readiness", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({
      lines: [
        {
          subtotal_cents: 10_000,
          tax_cents: 1_300,
          total_cents: 11_300,
          metadata: { needs_review: true },
        },
      ],
    }),
  );

  assert.equal(readiness.state, "needs_review");
  assert.match(readiness.reason, /invoice line needs review/);
});

test("a paid invoice with another accounting issue is paid and needs review", () => {
  const readiness = deriveInvoiceReadiness(
    validInvoice({
      allocations: [
        { job_id: "job-1", subtotal_cents: 8_000, needs_review: false },
      ],
      payments: [
        {
          amount_cents: 11_300,
          needs_review: false,
          reversed_at: null,
          transaction: { posted_on: "2026-08-04", review_status: "reconciled" },
        },
      ],
    }),
  );

  assert.equal(readiness.paymentState, "paid");
  assert.equal(readiness.reviewState, "needs_review");
  assert.match(readiness.reviewReason, /not allocated/);
});

test("overpayments and payment review flags require review", () => {
  const overpaid = deriveInvoiceReadiness(
    validInvoice({
      payments: [
        {
          amount_cents: 12_000,
          reversed_at: null,
          transaction: { posted_on: "2026-08-04", review_status: "reconciled" },
        },
      ],
    }),
  );
  const flagged = deriveInvoiceReadiness(
    validInvoice({
      payments: [
        {
          amount_cents: 11_300,
          needs_review: true,
          reversed_at: null,
          transaction: { posted_on: "2026-08-04", review_status: "reconciled" },
        },
      ],
    }),
  );

  assert.equal(overpaid.state, "needs_review");
  assert.equal(overpaid.paymentState, "paid");
  assert.equal(overpaid.reviewState, "needs_review");
  assert.match(overpaid.reason, /overpaid/);
  assert.equal(flagged.state, "needs_review");
  assert.equal(flagged.paymentState, "paid");
  assert.equal(flagged.reviewState, "needs_review");
  assert.match(flagged.reason, /needs review/);
});

test("supporting and non-invoice records stay out of the payable queue", () => {
  assert.equal(
    isPayableLabourInvoiceRecord({ status: "supporting_document" }),
    false,
  );
  assert.equal(
    isPayableLabourInvoiceRecord({
      status: "unmatched",
      metadata: { document_type: "not_invoice" },
    }),
    false,
  );
  assert.equal(isPayableLabourInvoiceRecord({ status: "unmatched" }), true);
});

test("historical review classification follows invoice and linked-job dates", () => {
  assert.equal(
    isHistoricalLabourInvoice({ issued_on: "2026-05-31" }),
    true,
  );
  assert.equal(
    isHistoricalLabourInvoice({
      issued_on: "2026-07-01",
      allocations: [
        { job: { status: "active", started_on: "2026-05-15" } },
      ],
    }),
    true,
  );
  assert.equal(
    isHistoricalLabourInvoice({
      issued_on: "2026-07-01",
      allocations: [
        { job: { status: "completed", started_on: null, completed_on: null } },
      ],
    }),
    true,
  );
  assert.equal(
    isHistoricalLabourInvoice({
      issued_on: "2026-07-01",
      allocations: [
        { job: { status: "active", started_on: "2026-06-15" } },
      ],
    }),
    false,
  );
});
