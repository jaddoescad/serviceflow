import assert from "node:assert/strict";
import test from "node:test";

import { validateDripJobsClosingRatioCohort } from "./lib/dripjobs-closing-ratio-cohort.mjs";

function hexId(value) {
  return value.toString(16).padStart(32, "0");
}

function augustEvidence() {
  return {
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    qualified_proposals_count: 75,
    accepted_proposals_count: 13,
    jobs_won_count: 18,
    captured_at: "2026-09-01T20:42:12.176Z",
    source_url: "https://app.dripjobs.com/metricsreport?report=Total+Proposals+Sent",
    company_timezone: "America/Toronto",
    capture_method: "authenticated_total_proposals_report",
    rows: Array.from({ length: 75 }, (_, index) => {
      const isAccepted = index < 13;
      const rawSource = index % 3 === 0 ? "Meta Ads - Ottawa" : "Google";
      return {
        source_row_number: index + 1,
        job_id: hexId(index + 1),
        contact_id: hexId(index + 1_001),
        proposal_id: String(3_200_001 + index),
        sent_on: index === 0 ? "2026-07-31" : "2026-08-15",
        raw_source: rawSource,
        normalized_channel: rawSource.startsWith("Meta Ads") ? "paid_social" : "organic_search",
        appointment_linked: index % 2 === 0,
        report_status: isAccepted ? "Accepted" : "Pending",
        acceptance_method: isAccepted
          ? index < 11 ? "signed" : "no_signature"
          : "none",
        is_accepted: isAccepted,
        proposal_value_cents: 100_000 + index,
        delivery_method: "Email",
      };
    }),
  };
}

test("validates the exact August 75/13 closing-ratio cohort without PII", () => {
  const validation = validateDripJobsClosingRatioCohort(augustEvidence());
  assert.equal(validation.rows.length, 75);
  assert.equal(validation.rows.filter((row) => row.is_accepted).length, 13);
  assert.equal(validation.parent.qualified_proposals_count, 75);
  assert.equal(validation.parent.accepted_proposals_count, 13);
  assert.match(validation.sourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(new Set(validation.rows.map((row) => row.row_sha256)).size, 75);
  assert.equal(validation.parent.source_rows.find((row) => row.acceptance_method === "signed")?.count, 11);
  assert.equal(validation.parent.source_rows.find((row) => row.acceptance_method === "no_signature")?.count, 2);
});

test("rejects an August cohort that does not contain exactly 75 qualified proposals", () => {
  const evidence = augustEvidence();
  evidence.rows.pop();
  evidence.qualified_proposals_count = 74;
  assert.throws(
    () => validateDripJobsClosingRatioCohort(evidence),
    /August 2026 must contain exactly 75 qualified proposals/,
  );
});

test("rejects an accepted-count mismatch", () => {
  const evidence = augustEvidence();
  evidence.accepted_proposals_count = 12;
  assert.throws(
    () => validateDripJobsClosingRatioCohort(evidence),
    /rows contain 13 accepted proposals; expected 12/,
  );
});

test("rejects PII and any other unsupported row fields", () => {
  const evidence = augustEvidence();
  evidence.rows[0].email = "not-allowed@example.com";
  assert.throws(
    () => validateDripJobsClosingRatioCohort(evidence),
    /unsupported fields: email/,
  );
});

test("rejects a lead-source channel mismatch", () => {
  const evidence = augustEvidence();
  evidence.rows[0].normalized_channel = "website";
  assert.throws(
    () => validateDripJobsClosingRatioCohort(evidence),
    /normalized_channel must be paid_social/,
  );
});
