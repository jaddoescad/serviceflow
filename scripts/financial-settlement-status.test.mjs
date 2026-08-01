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

test("complete invoice allocations are fully matched", () => {
  assert.equal(
    resolveSettlementStatus({
      paymentStatus: "fully_allocated",
      invoiceAllocatedAmount: 5193.05,
    }).bucket,
    "fully_matched",
  );
});

test("manual no-invoice evidence is a custom resolved state", () => {
  const result = resolveSettlementStatus({
    manualResolution: {
      status: "confirmed",
      kind: "no_invoice",
      label: "No invoice",
      note: "Owner confirmed no supplier invoice exists.",
      amount: 5193.05,
      confirmed_by: "admin",
      confirmed_at: "2026-08-01T12:00:00.000Z",
    },
  });
  assert.equal(result.bucket, "custom");
  assert.equal(result.label, "No invoice");
});

test("an invoice that should exist but was not found remains in review", () => {
  const result = resolveSettlementStatus({
    invoiceEvidenceStatus: "invoice_not_found",
  });
  assert.equal(result.bucket, "needs_review");
  assert.equal(result.label, "Invoice not found");
});

test("a complete non-invoice allocation is a custom resolved state", () => {
  const result = resolveSettlementStatus({
    paymentStatus: "fully_allocated",
    otherAllocatedAmount: 400,
  });
  assert.equal(result.bucket, "custom");
  assert.equal(result.label, "Settled without invoice");
});

