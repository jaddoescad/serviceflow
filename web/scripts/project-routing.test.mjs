import assert from "node:assert/strict";
import test from "node:test";

import { selectCanonicalJobId } from "../.test-dist/project-routing/project-routing.js";

test("uses the most recently accepted job as the canonical project", () => {
  assert.equal(
    selectCanonicalJobId([
      { jobId: "older", acceptedAt: "2026-06-01T12:00:00Z" },
      { jobId: "newer", acceptedAt: "2026-08-07T21:22:58Z" },
    ]),
    "newer",
  );
});

test("uses quote update time when accepted timestamps are unavailable", () => {
  assert.equal(
    selectCanonicalJobId([
      { jobId: "older", updatedAt: "2026-06-01T12:00:00Z" },
      { jobId: "newer", updatedAt: "2026-08-07T21:22:58Z" },
    ]),
    "newer",
  );
});

test("returns null when a lead has no converted jobs", () => {
  assert.equal(selectCanonicalJobId([]), null);
});

test("ignores hidden jobs and superseded proposals", () => {
  assert.equal(
    selectCanonicalJobId([
      {
        jobId: "hidden-newer",
        acceptedAt: "2026-08-10T12:00:00Z",
        isFeedVisible: false,
      },
      {
        jobId: "superseded-newer",
        acceptedAt: "2026-08-09T12:00:00Z",
        quoteStatus: "superseded",
      },
      {
        jobId: "current",
        acceptedAt: "2026-08-08T12:00:00Z",
        isFeedVisible: true,
        quoteStatus: "accepted",
      },
    ]),
    "current",
  );
});
