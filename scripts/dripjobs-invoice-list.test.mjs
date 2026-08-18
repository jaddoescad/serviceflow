import assert from "node:assert/strict";
import test from "node:test";

import {
  validateDripJobsInvoiceList,
  validateManifestContinuity,
} from "./lib/dripjobs-invoice-list.mjs";

function csv(rows = []) {
  return Buffer.from([
    "Status,Customer,Proposal Name,Invoice ID,Amount,Paid,Balance,Date",
    ...rows,
  ].join("\r\n") + "\r\n");
}

const baseRows = [
  'Open,Customer One,Proposal #3000001,500001,"$1,130.00","$0.00","$1,130.00",8/15/2026 9:48:24 AM',
  'Partially Paid,Customer Two,Proposal #3000002,500002,"$2,260.00","$1,130.00","$1,130.00",8/14/2026 1:00:00 PM',
  'Paid,Customer Three,Proposal #3000003,500003,"$3,390.00","$3,390.00","$0.00",8/13/2026 10:00:00 AM',
];

test("strict validator accepts a real-shaped full invoice list", () => {
  const result = validateDripJobsInvoiceList(csv(baseRows), { minimumBytes: 1, minimumRows: 3, now: new Date("2026-08-15T18:00:00Z") });
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].beforeHstCents, 100000);
  assert.equal(result.manifest.distinct_proposals, 3);
  assert.equal(result.manifest.invoice_ids.length, 3);
});

test("validator rejects wrong files before any importer can run", () => {
  assert.throws(() => validateDripJobsInvoiceList(Buffer.from("Name,Email\nA,a@example.com\n"), { minimumBytes: 1, minimumRows: 1 }), /unexpected CSV headers/);
  assert.throws(() => validateDripJobsInvoiceList(Buffer.concat([csv(baseRows), Buffer.from([0])]), { minimumBytes: 1, minimumRows: 3 }), /binary data/);
  assert.throws(() => validateDripJobsInvoiceList(csv([baseRows[0], baseRows[0]]), { minimumBytes: 1, minimumRows: 2 }), /duplicate Invoice ID/);
  assert.throws(() => validateDripJobsInvoiceList(csv([baseRows[2].replace("$0.00", "$1.00")]), { minimumBytes: 1, minimumRows: 1 }), /paid plus balance/);
});

test("continuity validator rejects implausible exports", () => {
  const previous = validateDripJobsInvoiceList(csv(baseRows), { minimumBytes: 1, minimumRows: 3, now: new Date("2026-08-15T18:00:00Z") }).manifest;
  assert.equal(validateManifestContinuity({ ...previous }, previous), true);
  assert.throws(() => validateManifestContinuity({ ...previous, invoice_ids: ["900001", "900002", "900003"] }, previous), /overlap/);
  assert.throws(() => validateManifestContinuity({ ...previous, gross_total_cents: previous.gross_total_cents * 2 }, previous), /increased/);
});
