import assert from "node:assert/strict";
import test from "node:test";

import { validateDripJobsSalesSnapshot } from "./lib/dripjobs-sales-snapshot.mjs";

function hexId(value) {
  return value.toString(16).padStart(32, "0");
}

function evidence() {
  return {
    period_start: "2026-01-01",
    period_end: "2026-01-31",
    captured_at: "2026-09-01T20:42:12.176Z",
    source_url: "https://app.dripjobs.com/metricsreport?report=Sales",
    rows: [
      {
        row_number: 1,
        deal_id: hexId(1),
        contact_id: hexId(101),
        lead_source: "Meta-Perspective",
        total_value_cents: 113_000,
        status: "Completed",
        scheduled_on: "2026-01-15",
        record_type: "Deal",
      },
      {
        row_number: 2,
        deal_id: hexId(2),
        contact_id: hexId(102),
        lead_source: "Google",
        total_value_cents: 226_001,
        status: "Accepted",
        scheduled_on: "",
        record_type: "Deal",
      },
    ],
  };
}

test("validates a privacy-safe DripJobs Sales snapshot and derives exact totals", () => {
  const validation = validateDripJobsSalesSnapshot(evidence());
  assert.equal(validation.snapshot.sales_count, 2);
  assert.equal(validation.snapshot.gross_sales_cents, 339_001);
  assert.equal(validation.manifest.paid_social_sales_count, 1);
  assert.equal(validation.manifest.paid_social_gross_sales_cents, 113_000);
  assert.match(validation.sourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(validation.rowFingerprints.length, 2);
});

test("rejects duplicate DripJobs deal IDs", () => {
  const source = evidence();
  source.rows[1].deal_id = source.rows[0].deal_id;
  assert.throws(
    () => validateDripJobsSalesSnapshot(source),
    /duplicate DripJobs deal IDs/,
  );
});

test("rejects negative Sales values", () => {
  const source = evidence();
  source.rows[0].total_value_cents = -1;
  assert.throws(
    () => validateDripJobsSalesSnapshot(source),
    /total_value_cents must be a non-negative safe integer/,
  );
});

test("rejects malformed optional IDs", () => {
  const source = evidence();
  source.rows[0].contact_id = "not-a-dripjobs-id";
  assert.throws(
    () => validateDripJobsSalesSnapshot(source),
    /contact_id must be a 20-80 character hexadecimal DripJobs ID/,
  );
});

test("rejects PII and unsupported fields", () => {
  const source = evidence();
  source.rows[0].contact_name = "Not allowed";
  assert.throws(
    () => validateDripJobsSalesSnapshot(source),
    /unsupported fields: contact_name/,
  );
});
