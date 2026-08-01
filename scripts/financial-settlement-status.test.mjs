import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { resolveSettlementStatus } = require(
  "../.test-dist/financial-settlement-status.js",
);

test("a legacy reviewed flag cannot create a settlement", () => {
  assert.deepEqual(resolveSettlementStatus({}), {
    bucket: "needs_review",
    label: "Needs review",
    tone: "warn",
  });
});

test("a legacy manual override cannot create a settlement", () => {
  assert.deepEqual(
    resolveSettlementStatus({
      manualResolution: {
        status: "confirmed",
        label: "No invoice",
      },
    }),
    {
      bucket: "needs_review",
      label: "Needs review",
      tone: "warn",
    },
  );
});

test("complete invoice allocations are fully matched", () => {
  assert.equal(
    resolveSettlementStatus({
      paymentStatus: "fully_allocated",
      invoiceAllocatedAmount: 5193.05,
    }).bucket,
    "fully_matched",
  );
});

test("stored invoice evidence creates a custom no-invoice state", () => {
  const result = resolveSettlementStatus({
    invoiceEvidenceStatus: "no_invoice_provided",
  });
  assert.equal(result.bucket, "custom");
  assert.equal(result.label, "No invoice");
  assert.equal(result.tone, "bad");
});

test("a documented no-invoice residual is a red custom state", () => {
  const result = resolveSettlementStatus({
    invoiceEvidenceStatus: "partial_no_invoice_residual",
  });
  assert.equal(result.bucket, "custom");
  assert.equal(result.label, "Partial match · balance has no invoice");
  assert.equal(result.tone, "bad");
});

test("bank-supported overhead uses its accounting label", () => {
  const result = resolveSettlementStatus({
    expenseEvidenceConfirmed: true,
    expenseEvidenceLabel: "Recruiting expense",
  });
  assert.equal(result.bucket, "custom");
  assert.equal(result.label, "Recruiting expense");
});

test("a credit-card transfer is a documented custom state", () => {
  const result = resolveSettlementStatus({
    documentExceptionLabel: "Credit card payment",
  });
  assert.equal(result.bucket, "custom");
  assert.equal(result.label, "Credit card payment");
});

test("an invoice that should exist but was not found remains in review", () => {
  const result = resolveSettlementStatus({
    invoiceEvidenceStatus: "invoice_not_found",
  });
  assert.equal(result.bucket, "needs_review");
  assert.equal(result.label, "Needs review");
});

test("unmatched payments use the canonical needs-review state", () => {
  const result = resolveSettlementStatus({ paymentStatus: "unmatched" });
  assert.deepEqual(result, {
    bucket: "needs_review",
    label: "Needs review",
    tone: "warn",
  });
});

test("unmatched customer income uses the canonical needs-review state", () => {
  const result = resolveSettlementStatus({ customerRevenueStatus: "unmatched" });
  assert.deepEqual(result, {
    bucket: "needs_review",
    label: "Needs review",
    tone: "warn",
  });
});

test("every needs-review reason uses the same amber tone", () => {
  const cases = [
    { invoiceEvidenceStatus: "invoice_not_found" },
    { customerRevenueStatus: "partially_allocated" },
    { customerRevenueStatus: "unmatched" },
    { paymentStatus: "partially_allocated" },
    { paymentStatus: "unidentified" },
    { paymentStatus: "unmatched" },
    { paymentStatus: "needs_review" },
  ];
  for (const facts of cases) {
    const result = resolveSettlementStatus(facts);
    assert.equal(result.bucket, "needs_review");
    assert.equal(result.label, "Needs review");
    assert.equal(result.tone, "warn");
  }
});

test("a complete non-invoice allocation is a custom resolved state", () => {
  const result = resolveSettlementStatus({
    paymentStatus: "fully_allocated",
    otherAllocatedAmount: 400,
  });
  assert.equal(result.bucket, "custom");
  assert.equal(result.label, "Settled without invoice");
});
