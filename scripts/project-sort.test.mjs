import assert from "node:assert/strict";
import test from "node:test";
import { compareJobsTableRows } from "../src/lib/project-sort.ts";

function row(overrides) {
  return {
    name: "Job",
    jobStartedOn: null,
    labourClosedAt: null,
    lastClockIn: null,
    labourInvoices: { latestInvoiceDate: null },
    ...overrides,
  };
}

test("open jobs with clock activity sort ahead of invoice-only and inactive jobs", () => {
  const ongoing = row({
    name: "Carina Stark",
    jobStartedOn: "2026-07-20",
    lastClockIn: "2026-08-09T13:00:00Z",
  });
  const newerCompleted = row({
    name: "Newer completed job",
    jobStartedOn: "2026-08-08",
    labourClosedAt: "2026-08-09T14:00:00Z",
    lastClockIn: "2026-08-09T14:00:00Z",
  });
  const newerWithoutHours = row({
    name: "Newer job without hours",
    jobStartedOn: "2026-08-09",
  });
  const subcontractorJob = row({
    name: "Tom Benton",
    labourInvoices: { latestInvoiceDate: "2026-07-31" },
  });

  assert.deepEqual(
    [newerCompleted, newerWithoutHours, subcontractorJob, ongoing]
      .sort(compareJobsTableRows)
      .map((item) => item.name),
    ["Carina Stark", "Tom Benton", "Newer job without hours", "Newer completed job"],
  );
});

test("open clocked jobs use their latest clock-in before job start date", () => {
  const latestClock = row({
    name: "Older job with current activity",
    jobStartedOn: "2026-07-01",
    lastClockIn: "2026-08-09T13:00:00Z",
  });
  const olderClock = row({
    name: "Newer job with older activity",
    jobStartedOn: "2026-08-01",
    lastClockIn: "2026-08-08T13:00:00Z",
  });

  assert.deepEqual(
    [olderClock, latestClock].sort(compareJobsTableRows).map((item) => item.name),
    ["Older job with current activity", "Newer job with older activity"],
  );
});

test("open invoice-only jobs use their latest invoice date", () => {
  const latestInvoice = row({
    name: "Tom Benton",
    labourInvoices: { latestInvoiceDate: "2026-07-31" },
  });
  const olderInvoice = row({
    name: "Older subcontractor activity",
    jobStartedOn: "2026-08-05",
    labourInvoices: { latestInvoiceDate: "2026-07-25" },
  });

  assert.deepEqual(
    [olderInvoice, latestInvoice].sort(compareJobsTableRows).map((item) => item.name),
    ["Tom Benton", "Older subcontractor activity"],
  );
});

test("all remaining jobs retain start-date then name ordering", () => {
  const rows = [
    row({ name: "Zulu", jobStartedOn: "2026-08-01" }),
    row({
      name: "Completed with hours",
      jobStartedOn: "2026-07-01",
      labourClosedAt: "2026-08-08T12:00:00Z",
      lastClockIn: "2026-08-09T12:00:00Z",
      labourInvoices: { latestInvoiceDate: "2026-08-09" },
    }),
    row({ name: "Alpha", jobStartedOn: "2026-08-01" }),
  ];

  assert.deepEqual(rows.sort(compareJobsTableRows).map((item) => item.name), [
    "Alpha",
    "Zulu",
    "Completed with hours",
  ]);
});
