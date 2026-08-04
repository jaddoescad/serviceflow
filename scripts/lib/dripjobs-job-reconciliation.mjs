import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const evidencePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/dripjobs-job-reconciliation-2026-08-02.json",
);

export const DRIPJOBS_JOB_RECONCILIATION = JSON.parse(
  readFileSync(evidencePath, "utf8"),
);
export const EXCLUDED_TEST_JOBS =
  DRIPJOBS_JOB_RECONCILIATION.excluded_test_jobs;
export const EXCLUDED_TEST_PROPOSAL_IDS = new Set(
  EXCLUDED_TEST_JOBS.map((job) => String(job.proposal_id)),
);
export const EXCLUDED_TEST_INVOICE_IDS = new Set(
  EXCLUDED_TEST_JOBS.map((job) => String(job.invoice_uuid)),
);
export const CONFIRMED_LEAD_JOB_LINKS =
  DRIPJOBS_JOB_RECONCILIATION.confirmed_lead_job_links;
export const CONFIRMED_LEAD_BY_ID = new Map(
  CONFIRMED_LEAD_JOB_LINKS.map((record) => [record.lead_deal_id, record]),
);
