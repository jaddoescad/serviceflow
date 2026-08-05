import assert from "node:assert/strict";
import test from "node:test";

import {
  isCostingInvoice,
  selectUsableInvoiceJobAllocations,
} from "../src/lib/invoice-allocation-selection.ts";

test("keeps invoice-level allocations when no line allocation exists", () => {
  const allocation = {
    id: "coarse",
    invoice_id: "invoice-1",
    invoice_line_id: null,
    job_id: "job-1",
  };
  assert.deepEqual(selectUsableInvoiceJobAllocations([allocation]), [allocation]);
});

test("uses line allocations instead of also counting the invoice-level allocation", () => {
  const allocations = [
    { id: "coarse", invoice_id: "invoice-1", invoice_line_id: null, job_id: "job-1" },
    { id: "line-1", invoice_id: "invoice-1", invoice_line_id: "line-a", job_id: "job-1" },
    { id: "line-2", invoice_id: "invoice-1", invoice_line_id: "line-b", job_id: "job-1" },
  ];
  assert.deepEqual(
    selectUsableInvoiceJobAllocations(allocations).map((row) => row.id),
    ["line-1", "line-2"],
  );
});

test("scopes line precedence to the same invoice and job", () => {
  const allocations = [
    { id: "job-1-line", invoice_id: "invoice-1", invoice_line_id: "line-a", job_id: "job-1" },
    { id: "job-2-coarse", invoice_id: "invoice-1", invoice_line_id: null, job_id: "job-2" },
  ];
  assert.deepEqual(
    selectUsableInvoiceJobAllocations(allocations).map((row) => row.id),
    ["job-1-line", "job-2-coarse"],
  );
});

test("ignores reversed allocations before applying line precedence", () => {
  const allocations = [
    { id: "active", invoice_id: "invoice-1", invoice_line_id: "line-a", job_id: "job-1", metadata: { reversed_at: null } },
    { id: "reversed", invoice_id: "invoice-1", invoice_line_id: "line-a", job_id: "job-1", metadata: { reversed_at: "2026-08-04T20:00:00Z" } },
  ];
  assert.deepEqual(
    selectUsableInvoiceJobAllocations(allocations).map((row) => row.id),
    ["active"],
  );
});

test("excludes preserved supporting documents from job costs", () => {
  assert.equal(isCostingInvoice({ status: "supporting_document" }), false);
  assert.equal(isCostingInvoice({ status: "matched" }), true);
});
