import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDripJobsProjectIdentity,
  dripJobsProjectId,
} from "./lib/dripjobs-job-identity.mjs";

test("uses a stable DripJobs identity when CompanyCam is absent", () => {
  const job = {
    proposal_id: "2390920",
    proposal_uuid: "old-tom",
    companycam_project_id: null,
    archived: true,
  };
  const result = buildDripJobsProjectIdentity([job], new Set());
  assert.equal(result.projectIdByProposal.get("old-tom"), "dripjobs-2390920");
  assert.equal(dripJobsProjectId(job), "dripjobs-2390920");
});

test("keeps CompanyCam as a supporting ID for one proposal", () => {
  const job = {
    proposal_id: "2523918",
    proposal_uuid: "current-tom",
    companycam_project_id: "97216872",
    archived: false,
  };
  const result = buildDripJobsProjectIdentity([job], new Set(["97216872"]));
  assert.equal(result.projectIdByProposal.get("current-tom"), "97216872");
  assert.deepEqual(result.collisions, []);
});

test("separates repeated proposals that reuse one CompanyCam project", () => {
  const result = buildDripJobsProjectIdentity(
    [
      {
        proposal_id: "2370863",
        proposal_uuid: "old-christine",
        companycam_project_id: "96770884",
        archived: true,
      },
      {
        proposal_id: "3006955",
        proposal_uuid: "current-christine",
        companycam_project_id: "96770884",
        archived: false,
      },
    ],
    new Set(["96770884"]),
  );

  assert.equal(
    result.projectIdByProposal.get("current-christine"),
    "96770884",
  );
  assert.equal(
    result.projectIdByProposal.get("old-christine"),
    "dripjobs-2370863",
  );
  assert.deepEqual(result.collisions, [
    {
      companycam_project_id: "96770884",
      operational_proposal_id: "3006955",
      separated_proposal_ids: ["2370863"],
    },
  ]);
});

test("refuses a DripJobs link to a missing CompanyCam project", () => {
  assert.throws(
    () =>
      buildDripJobsProjectIdentity(
        [
          {
            proposal_id: "1",
            proposal_uuid: "proposal-1",
            companycam_project_id: "missing",
            archived: false,
          },
        ],
        new Set(),
      ),
    /missing CompanyCam project/,
  );
});
