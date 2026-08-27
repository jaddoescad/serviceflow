import assert from "node:assert/strict";
import test from "node:test";

import {
  DRIPJOBS_PROPOSAL_REPORT_HEADERS,
  classifyProposalReportRow,
  proposalIdFromName,
  validateDripJobsProposalReport,
} from "./lib/dripjobs-proposal-report.mjs";

function csv(rows) {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return Buffer.from([
    DRIPJOBS_PROPOSAL_REPORT_HEADERS.join(","),
    ...rows.map((row) => DRIPJOBS_PROPOSAL_REPORT_HEADERS.map((header) => escape(row[header])).join(",")),
  ].join("\n"));
}

const base = {
  "Proposal Name": "Proposal #3216476",
  "First Name": "Real",
  "Last Name": "Customer",
  Email: "real@example.com",
  Phone: "(613) 555-0100",
  Salesperson: "Scott Madden",
  "Deal Name": "Real Customer",
  "Lead Source": "Meta Ads - Interior",
  "Sent Date": "08/14/2026",
  "Sent By": "Real Customer",
  "Appointment Linked": "No",
  Status: "Pending",
  "Proposal Value": "$6167.54",
  "Delivery Method": "Email",
};

test("proposal report validator preserves delivery evidence and excludes tests", () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    ...base,
    "Proposal Name": `Proposal #${String(3_000_000 + index)}`,
    Email: `real-${index}@example.com`,
  }));
  rows[1] = { ...base, "First Name": "Jad", "Last Name": "Slim", Email: "jadslimm@gmail.com" };
  rows[2] = { ...base, "Proposal Name": "Proposal for Real Customer", "Delivery Method": "Not Sent" };
  const result = validateDripJobsProposalReport(csv(rows), { capturedAt: "2026-08-20T20:00:00.000Z" });
  assert.equal(result.manifest.row_count, 100);
  assert.equal(result.manifest.delivered_row_count, 99);
  assert.equal(result.manifest.test_or_vendor_row_count, 1);
  assert.equal(result.manifest.eligible_delivered_row_count, 98);
  assert.equal(result.rows[0].proposalId, "3000000");
  assert.equal(result.rows[0].proposalValueCents, 616754);
  assert.match(result.rows[2].proposalKey, /^fallback:[0-9a-f]{64}$/);
});

test("proposal number requires an exact seven-digit hash identifier", () => {
  assert.equal(proposalIdFromName("Proposal #3216476"), "3216476");
  assert.equal(proposalIdFromName("Paint apartment #704"), null);
});

test("ordinary customer names are not classified as tests", () => {
  assert.deepEqual(classifyProposalReportRow({
    firstName: "Clayton",
    lastName: "Block",
    email: "clayton.block63@gmail.com",
    dealName: "Clayton Block",
    proposalName: "Proposal for Clayton Block",
  }), { marketingEligible: true, exclusionReason: null, classificationFlags: [] });
});

test("proposal report validator rejects unknown delivery methods", () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({ ...base, Email: `${index}@example.com` }));
  rows[0]["Delivery Method"] = "Carrier Pigeon";
  assert.throws(() => validateDripJobsProposalReport(csv(rows)), /unsupported Delivery Method/);
});
