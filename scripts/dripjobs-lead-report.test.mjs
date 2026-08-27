import assert from "node:assert/strict";
import test from "node:test";

import {
  DRIPJOBS_LEAD_REPORT_HEADERS,
  classifyLeadReportRow,
  validateDripJobsLeadReport,
  validateLeadReportManifestContinuity,
} from "./lib/dripjobs-lead-report.mjs";

function csv(rows) {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return Buffer.from([
    DRIPJOBS_LEAD_REPORT_HEADERS.join(","),
    ...rows.map((row) => DRIPJOBS_LEAD_REPORT_HEADERS.map((header) => escape(row[header])).join(",")),
  ].join("\n"));
}

const base = {
  "First Name": "Real",
  "Last Name": "Customer",
  Email: "real@example.com",
  Phone: "613-555-0100",
  "Lead Source": "Meta Ads - Interior",
  Label: "",
  Salesperson: "Scott Madden",
  "Deal Name": "Real Customer",
  "Date Created": "08/20/2026",
  "Appt Date": "08/25/2026 03:00 PM",
  Status: "Scheduled",
};

test("Lead report validator preserves rows and classifies exclusions", () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    ...base,
    Email: `real-${index}@example.com`,
    Phone: `613555${String(index).padStart(4, "0")}`,
  }));
  rows[1] = { ...base, "First Name": "Jad", "Last Name": "Slim", Email: "jadslimm@gmail.com", "Appt Date": "", Status: "Not Booked" };
  rows[2] = { ...base, "First Name": "Laura", "Last Name": "DripJobs", Email: "laura@dripjobs.com", "Appt Date": "", Status: "Not Booked" };
  rows[3] = { ...base, "Lead Source": "/https://paintersottawa.com/", "Date Created": "06/21/2025", "Appt Date": "", Status: "Not Booked" };
  rows[4] = { ...base, "First Name": "Clayton", "Last Name": "Block", Email: "clayton@example.com", "Appt Date": "", Status: "Not Booked" };
  const result = validateDripJobsLeadReport(csv(rows), { capturedAt: "2026-08-20T20:00:00.000Z" });
  assert.equal(result.manifest.row_count, 100);
  assert.equal(result.manifest.excluded_test_count, 1);
  assert.equal(result.manifest.excluded_vendor_test_count, 1);
  assert.equal(result.manifest.migration_batch_count, 1);
  assert.equal(result.rows[4].marketingEligible, true);
  assert.equal(result.rows[0].appointmentAtLocal, "2026-08-25T15:00:00");
});

test("classification does not treat the surname Block as a blocked test", () => {
  const classification = classifyLeadReportRow({
    firstName: "Clayton",
    lastName: "Block",
    email: "clayton.block63@gmail.com",
    rawSource: "/Contact",
    createdOn: "2026-08-20",
    dealName: "Clayton Block",
    label: "#1 Attempt",
  });
  assert.deepEqual(classification, {
    marketingEligible: true,
    exclusionReason: null,
    classificationFlags: [],
  });
});

test("Lead report validator rejects appointment/status disagreement", () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({ ...base, Email: `${index}@example.com` }));
  rows[0].Status = "Not Booked";
  assert.throws(() => validateDripJobsLeadReport(csv(rows)), /Status and Appt Date disagree/);
});

test("Lead report continuity fails closed on row loss", () => {
  assert.throws(() => validateLeadReportManifestContinuity(
    { source_type: "dripjobs_lead_report_csv_v1", row_count: 1_400, last_created_on: "2026-08-20" },
    { source_type: "dripjobs_lead_report_csv_v1", row_count: 1_428, last_created_on: "2026-08-20" },
  ), /dropped/);
});
