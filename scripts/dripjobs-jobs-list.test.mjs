import assert from "node:assert/strict";
import test from "node:test";

import {
  productionMonthForStage,
  validateDripJobsJobsExports,
  validateDripJobsJobsList,
  validateJobsManifestContinuity,
} from "./lib/dripjobs-jobs-list.mjs";

const headers = "Status,Label,Job,Customer Name,Email,Phone Number,Salesperson,Project Manager,Crew,Proposal ID,Invoice ID,Invoice Status,Amount,Paid,Balance,Deal Stage,Deal Stage Date,Proposal Signed Date,Job Scheduled Date,Job Start Date,Job Completion Date";

function row({ status = "COMPLETED", proposal = "3000001", invoice = "#500001", stage = "Project Complete", date = "Saturday, August 15, 2026", amount = "$1,130.00" } = {}) {
  return `${status},,Customer ${proposal},Customer ${proposal},customer@example.com,6135551212,Scott Madden,Scott Madden,No crew,${proposal},${invoice},Paid,"${amount}","${amount}",$0.00,${stage},"${date}",8/1/2026 1:00:00 PM,,08/01/2026,08/15/2026`;
}

function csv(rows) {
  return Buffer.from([headers, ...rows].join("\r\n") + "\r\n");
}

test("Jobs List validator derives production months from workflow stage dates", () => {
  const result = validateDripJobsJobsList(csv([
    row({ stage: "Work Finished", date: "Friday, July 31, 2026" }),
    row({ proposal: "3000002", invoice: "#500002", stage: "Review Request", date: "Saturday, August 1, 2026" }),
    row({ proposal: "3000003", invoice: "#500003", stage: "Project Scheduled", date: "Saturday, August 1, 2026" }),
  ]), { view: "active", minimumBytes: 1, minimumRows: 3, now: new Date("2026-08-16T12:00:00Z") });
  assert.equal(result.rows[0].productionMonth, "2026-07-01");
  assert.equal(result.rows[1].productionMonth, "2026-08-01");
  assert.equal(result.rows[2].productionMonth, null);
  assert.deepEqual(productionMonthForStage("Job Completed", "Thursday, June 4, 2026"), {
    normalizedStage: "project_complete",
    stageDateIso: "2026-06-04",
    productionMonth: "2026-06-01",
  });
});

test("combined validator requires disjoint active and archived All views", () => {
  const active = csv([row({ proposal: "3000001" }), row({ proposal: "3000002", invoice: "#500002" })]);
  const archived = csv([row({ status: "ARCHIVED", proposal: "2000001", invoice: "#400001" }), row({ status: "CANCELLED", proposal: "2000002", invoice: "#400002", stage: "Pending Schedule" })]);
  const result = validateDripJobsJobsExports({ active, archived }, {
    minimumTotalRows: 4,
    validatorOptions: { active: { minimumBytes: 1, minimumRows: 2 }, archived: { minimumBytes: 1, minimumRows: 2 } },
    now: new Date("2026-08-16T12:00:00Z"),
  });
  assert.equal(result.manifest.row_count, 4);
  assert.equal(result.manifest.active_row_count, 2);
  assert.equal(result.manifest.archived_row_count, 2);
  assert.equal(result.manifest.distinct_proposals, 4);
  assert.equal(validateJobsManifestContinuity({ ...result.manifest }, result.manifest), true);
});

test("validator fails closed on wrong views, duplicates, arithmetic, and continuity", () => {
  assert.throws(() => validateDripJobsJobsList(csv([row({ status: "ARCHIVED" })]), { view: "active", minimumBytes: 1, minimumRows: 1 }), /Show Archived was not off/);
  assert.throws(() => validateDripJobsJobsList(csv([row({ status: "COMPLETED" })]), { view: "archived", minimumBytes: 1, minimumRows: 1 }), /Show Archived was not on/);
  assert.throws(() => validateDripJobsJobsList(Buffer.from("Name,Email\nA,a@example.com\n"), { view: "active", minimumBytes: 1, minimumRows: 1 }), /unexpected active Jobs List headers/);
  const duplicate = csv([row(), row()]);
  assert.throws(() => validateDripJobsJobsList(duplicate, { view: "active", minimumBytes: 1, minimumRows: 2 }), /duplicate Proposal ID/);
  const brokenArithmetic = csv([row().replace('"$1,130.00",$0.00', '"$1,130.00",$1.00')]);
  assert.throws(() => validateDripJobsJobsList(brokenArithmetic, { view: "active", minimumBytes: 1, minimumRows: 1 }), /paid plus balance/);
});
