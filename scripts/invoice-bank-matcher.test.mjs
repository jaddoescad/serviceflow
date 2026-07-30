import assert from "node:assert/strict";
import test from "node:test";
import { buildInvoiceBankMatchReport } from "../src/lib/invoice-bank-matcher.ts";

function invoice(id, amount, overrides = {}) {
  return {
    id,
    contractorId: "contractor-1",
    supplierName: "Test Painter",
    invoiceNumber: id,
    invoiceDate: "2026-07-01",
    sourceDate: null,
    currency: "CAD",
    grossAmount: amount,
    allocatedAmount: 0,
    remainingAmount: amount,
    originalFilename: `${id}.pdf`,
    duplicateVersionCount: 1,
    ...overrides,
  };
}

function payment(id, amount, overrides = {}) {
  return {
    id,
    contractorId: "contractor-1",
    supplierName: "Test Painter",
    recipientStatus: "confirmed",
    confirmationMethod: "bank_record",
    confirmationNote: "Test recipient evidence",
    confirmedAt: "2026-07-03T12:00:00Z",
    postedOn: "2026-07-03",
    currency: "CAD",
    paymentAmount: amount,
    allocatedAmount: 0,
    availableAmount: amount,
    description: "SEND E-TFR ***abc",
    counterparty: "Test Painter",
    category: "Subcontractors",
    accountName: "Business Chequing",
    accountLastFour: "6970",
    sourceFilename: "bank.json",
    recipientName: "Test Painter",
    recipientEmail: "test@example.com",
    confirmationSuffix: "abc",
    ...overrides,
  };
}

function report(invoices, payments) {
  return buildInvoiceBankMatchReport({
    invoices,
    payments,
    metadata: {
      sourceInvoiceFiles: invoices.length,
      duplicateVersionsExcluded: 0,
      invoicesAlreadyAllocated: invoices.filter(
        (item) => item.allocatedAmount > 0,
      ).length,
      paymentsAlreadyAllocated: payments.filter(
        (item) => item.allocatedAmount > 0,
      ).length,
    },
    generatedAt: "2026-07-30T12:00:00Z",
  });
}

test("creates one high-confidence proposal for a unique exact match", () => {
  const result = report([invoice("INV-1", 3690)], [payment("BANK-1", 3690)]);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].queue, "ready_to_confirm");
  assert.equal(result.proposals[0].kind, "exact_one_to_one");
  assert.equal(result.proposals[0].difference, 0);
});

test("combines invoices only when their total is uniquely exact", () => {
  const result = report(
    [invoice("INV-1", 200), invoice("INV-2", 150), invoice("INV-3", 90)],
    [payment("BANK-1", 440)],
  );
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].kind, "combined_invoices");
  assert.deepEqual(
    new Set(result.proposals[0].invoices.map((item) => item.id)),
    new Set(["INV-1", "INV-2", "INV-3"]),
  );
});

test("does not guess when an unknown recipient amount is ambiguous", () => {
  const result = report(
    [
      invoice("INV-1", 500),
      invoice("INV-2", 500, {
        contractorId: "contractor-2",
        supplierName: "Other Painter",
      }),
    ],
    [
      payment("BANK-1", 500, {
        contractorId: null,
        supplierName: null,
        recipientStatus: "unknown",
        confirmationMethod: null,
        confirmationNote: null,
        confirmedAt: null,
        recipientName: null,
        recipientEmail: null,
      }),
    ],
  );
  assert.equal(result.proposals.length, 0);
  assert.equal(result.stats.unmatchedInvoices, 2);
  assert.equal(result.stats.unmatchedPayments, 1);
});

test("matches only the unallocated remainder of invoices and payments", () => {
  const result = report(
    [
      invoice("INV-1", 1000, {
        allocatedAmount: 400,
        remainingAmount: 600,
      }),
    ],
    [
      payment("BANK-1", 1000, {
        allocatedAmount: 400,
        availableAmount: 600,
      }),
    ],
  );
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].invoiceAmount, 600);
  assert.equal(result.proposals[0].paymentAmount, 600);
  assert.equal(result.proposals[0].difference, 0);
});

test("never reuses an invoice or payment across proposals", () => {
  const result = report(
    [invoice("INV-1", 250), invoice("INV-2", 750)],
    [payment("BANK-1", 250), payment("BANK-2", 750)],
  );
  const invoiceIds = result.proposals.flatMap((proposal) =>
    proposal.invoices.map((item) => item.id),
  );
  const paymentIds = result.proposals.flatMap((proposal) =>
    proposal.payments.map((item) => item.id),
  );
  assert.equal(new Set(invoiceIds).size, invoiceIds.length);
  assert.equal(new Set(paymentIds).size, paymentIds.length);
});
