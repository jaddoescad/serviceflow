#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  fetchAll,
  resolveJobCostAllocationIdentities,
  summarizeJobCostAllocationIdentities,
} from "./lib/job-cost-allocation-identity.mjs";

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
      }),
  );
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { jobs, projects, allocations } =
  await resolveJobCostAllocationIdentities(db);
const summary = summarizeJobCostAllocationIdentities(allocations);
const [storedLinks, databaseExceptions] = await Promise.all([
  fetchAll(() =>
    db
      .from("job_cost_allocation_links")
      .select("allocation_key,job_proposal_id,match_method,confidence"),
  ),
  fetchAll(() =>
    db
      .from("job_cost_allocation_identity_exceptions")
      .select("cost_type,allocation_id,companycam_project_id,amount_before_hst"),
  ),
]);
const storedLinkByKey = new Map(
  storedLinks.map((link) => [link.allocation_key, link]),
);
const allocationKey = (allocation) =>
  allocation.kind === "material"
    ? `material:${allocation.allocationId}`
    : `labour:${allocation.allocationId}:${allocation.projectId}`;
const failures = [];
for (const allocation of allocations) {
  if (allocation.resolution.proposalIds.length !== 1) continue;
  const key = allocationKey(allocation);
  const stored = storedLinkByKey.get(key);
  const expectedProposal = allocation.resolution.proposalIds[0];
  if (!stored) {
    failures.push({ key, reason: "missing_cost_identity_link", expectedProposal });
  } else if (stored.job_proposal_id !== expectedProposal) {
    failures.push({
      key,
      reason: "cost_identity_link_disagrees_with_evidence",
      expectedProposal,
      storedProposal: stored.job_proposal_id,
    });
  }
}
const unresolved = allocations.filter(
  (allocation) => !storedLinkByKey.has(allocationKey(allocation)),
);
if (databaseExceptions.length !== unresolved.length) {
  failures.push({
    reason: "exception_queue_count_mismatch",
    expected: unresolved.length,
    actual: databaseExceptions.length,
  });
}

console.log(
  JSON.stringify(
    {
      summary: {
        jobs: jobs.length,
        projects: projects.length,
        allocations: allocations.length,
        resolved: allocations.length - summary.unresolved.length,
        unresolved: unresolved.length,
        methodCounts: summary.methodCounts,
        mappedTotals: summary.mappedTotals,
        unresolvedTotals: summary.unresolvedTotals,
      },
      controls: {
        passed: failures.length === 0,
        storedLinks: storedLinks.length,
        databaseExceptions: databaseExceptions.length,
        failures,
      },
      unresolved: unresolved.map((allocation) => ({
        kind: allocation.kind,
        allocationId: allocation.allocationId,
        projectId: allocation.projectId,
        projectName: allocation.projectName,
        invoiceNumber: allocation.invoiceNumber,
        invoiceDate: allocation.invoiceDate ?? allocation.sourceDate,
        supplierName: allocation.supplierName,
        amount: allocation.amount,
        candidates: allocation.resolution.proposalIds,
      })),
    },
    null,
    2,
  ),
);

if (failures.length > 0) process.exitCode = 1;
