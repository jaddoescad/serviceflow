import assert from "node:assert/strict";
import test from "node:test";
import { deriveInvoiceReadiness } from "../src/lib/invoice-readiness.ts";

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
  assert.equal(readiness.allocationVarianceCents, 2_000);
  assert.match(readiness.reason, /not allocated/);
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
  assert.match(overpaid.reason, /overpaid/);
  assert.equal(flagged.state, "needs_review");
  assert.match(flagged.reason, /needs review/);
});
