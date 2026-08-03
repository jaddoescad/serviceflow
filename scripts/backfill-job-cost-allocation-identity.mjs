#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
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

function chunks(values, size = 200) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
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

const apply = process.argv.includes("--apply");
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const {
  jobs,
  projects,
  projectBudgets,
  customerInvoices,
  leadJobLinks,
  leadProjectLinks,
  allocations,
} =
  await resolveJobCostAllocationIdentities(db);
const summary = summarizeJobCostAllocationIdentities(allocations);
const resolved = allocations.filter(
  (allocation) => allocation.resolution.proposalIds.length === 1,
);

const projectIds = new Set(projects.map((project) => project.companycam_id));
const jobIds = new Set(jobs.map((job) => job.proposal_id));
const linkByPair = new Map();
for (const job of jobs) {
  const projectId = `dripjobs-${job.proposal_id}`;
  if (!projectIds.has(projectId)) continue;
  linkByPair.set(`${job.proposal_id}\u0000${projectId}`, {
    job_proposal_id: job.proposal_id,
    companycam_project_id: projectId,
    link_role: "canonical",
    link_status: "confirmed",
    match_method: "synthetic_project_id",
    confidence: 1,
    evidence: {
      source: "job_cost_allocation_identity_backfill_v1",
      proposal_id: job.proposal_id,
    },
    review_note: "Exact synthetic DripJobs project ID.",
    confirmed_at: new Date().toISOString(),
  });
}

for (const budget of projectBudgets) {
  const proposalId = String(budget.notes ?? "").match(
    /\bproposal\s+([0-9]+)\b/i,
  )?.[1];
  if (!proposalId || !jobIds.has(proposalId)) continue;
  const key = `${proposalId}\u0000${budget.companycam_project_id}`;
  if (linkByPair.has(key)) continue;
  linkByPair.set(key, {
    job_proposal_id: proposalId,
    companycam_project_id: budget.companycam_project_id,
    link_role: "supporting",
    link_status: "confirmed",
    match_method: "project_budget_proposal",
    confidence: 1,
    evidence: {
      source: "project_budget_notes",
      proposal_id: proposalId,
    },
    review_note: "Proposal ID recorded in the existing job budget evidence.",
    confirmed_at: new Date().toISOString(),
  });
}

for (const invoice of customerInvoices) {
  const proposalId = invoice.external_proposal_id;
  if (
    invoice.accounting_status === "void" ||
    !invoice.companycam_project_id ||
    !jobIds.has(proposalId)
  ) {
    continue;
  }
  const key = `${proposalId}\u0000${invoice.companycam_project_id}`;
  if (linkByPair.has(key)) continue;
  linkByPair.set(key, {
    job_proposal_id: proposalId,
    companycam_project_id: invoice.companycam_project_id,
    link_role: "supporting",
    link_status: "confirmed",
    match_method: "customer_invoice_project",
    confidence: 1,
    evidence: {
      source: "customer_invoice_external_proposal",
      customer_invoice_id: invoice.id,
      proposal_id: proposalId,
    },
    review_note: "Customer invoice carries the DripJobs proposal ID.",
    confirmed_at: new Date().toISOString(),
  });
}

const proposalsByLead = new Map();
for (const link of leadJobLinks) {
  if (
    link.relationship_type !== "originated" ||
    link.link_status !== "confirmed"
  ) {
    continue;
  }
  const proposals = proposalsByLead.get(link.lead_deal_id) ?? new Set();
  proposals.add(link.job_proposal_id);
  proposalsByLead.set(link.lead_deal_id, proposals);
}
for (const link of leadProjectLinks) {
  if (
    link.relationship_type !== "originated" ||
    link.link_status !== "confirmed"
  ) {
    continue;
  }
  const proposals = [...(proposalsByLead.get(link.lead_deal_id) ?? [])];
  if (proposals.length !== 1) continue;
  const proposalId = proposals[0];
  const key = `${proposalId}\u0000${link.companycam_project_id}`;
  if (linkByPair.has(key)) continue;
  linkByPair.set(key, {
    job_proposal_id: proposalId,
    companycam_project_id: link.companycam_project_id,
    link_role: "supporting",
    link_status: "confirmed",
    match_method: "confirmed_lead_bridge",
    confidence: 0.98,
    evidence: {
      source: "confirmed_originating_lead_bridge",
      lead_deal_id: link.lead_deal_id,
      proposal_id: proposalId,
    },
    review_note: "Unique confirmed originating lead connects this project to one job.",
    confirmed_at: new Date().toISOString(),
  });
}

for (const allocation of resolved) {
  const proposalId = allocation.resolution.proposalIds[0];
  const pairKey = `${proposalId}\u0000${allocation.projectId}`;
  const existing = linkByPair.get(pairKey);
  const evidenceItem = {
    cost_type: allocation.kind,
    allocation_id: allocation.allocationId,
    supplier: allocation.supplierName,
    invoice_number: allocation.invoiceNumber,
    invoice_date: allocation.invoiceDate ?? allocation.sourceDate,
  };
  if (existing) {
    const allocationEvidence = existing.evidence.allocations ?? [];
    existing.evidence.allocations = [...allocationEvidence, evidenceItem].slice(0, 50);
    continue;
  }
  linkByPair.set(pairKey, {
    job_proposal_id: proposalId,
    companycam_project_id: allocation.projectId,
    link_role:
      allocation.projectId === `dripjobs-${proposalId}`
        ? "canonical"
        : "supporting",
    link_status: "confirmed",
    match_method: allocation.resolution.method,
    confidence: allocation.resolution.confidence,
    evidence: {
      source: "job_cost_allocation_identity_backfill_v1",
      allocations: [evidenceItem],
    },
    review_note:
      "Confirmed from existing invoice, project, proposal, and job-date evidence.",
    confirmed_at: new Date().toISOString(),
  });
}

const report = {
  mode: apply ? "apply" : "dry_run",
  allocations: allocations.length,
  resolved: resolved.length,
  unresolved: summary.unresolved.length,
  links: linkByPair.size,
  costLinks: resolved.length,
  methodCounts: summary.methodCounts,
  unresolvedProjects: [
    ...new Set(
      summary.unresolved.map(
        (allocation) =>
          `${allocation.projectId} · ${allocation.projectName ?? "Unknown"}`,
      ),
    ),
  ],
};

if (!apply) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

for (const batch of chunks([...linkByPair.values()], 200)) {
  const { error } = await db.from("job_project_links").upsert(batch, {
    onConflict: "job_proposal_id,companycam_project_id",
  });
  if (error) throw error;
}

const costLinks = resolved.map((allocation) => {
  const proposalId = allocation.resolution.proposalIds[0];
  const material = allocation.kind === "material";
  return {
    allocation_key: material
      ? `material:${allocation.allocationId}`
      : `labour:${allocation.allocationId}:${allocation.projectId}`,
    cost_type: allocation.kind,
    labour_invoice_line_id: material ? null : allocation.allocationId,
    material_line_allocation_id: material ? allocation.allocationId : null,
    companycam_project_id: allocation.projectId,
    job_proposal_id: proposalId,
    match_method: allocation.resolution.method,
    confidence: allocation.resolution.confidence,
    evidence: {
      source: "job_cost_allocation_identity_backfill_v1",
      supplier: allocation.supplierName,
      invoice_number: allocation.invoiceNumber,
      invoice_date: allocation.invoiceDate ?? allocation.sourceDate,
      amount_before_hst: allocation.amount,
    },
    confirmed_at: new Date().toISOString(),
  };
});
for (const batch of chunks(costLinks, 200)) {
  const { error } = await db.from("job_cost_allocation_links").upsert(batch, {
    onConflict: "allocation_key",
  });
  if (error) throw error;
}

const { data: exceptions, error: exceptionError } = await db
  .from("job_cost_allocation_identity_exceptions")
  .select("cost_type,allocation_id,companycam_project_id,amount_before_hst,needs_review");
if (exceptionError) throw exceptionError;

report.databaseExceptions = exceptions?.length ?? 0;
console.log(JSON.stringify(report, null, 2));

if (report.databaseExceptions !== summary.unresolved.length) {
  throw new Error(
    `Expected ${summary.unresolved.length} unresolved allocations; database has ${report.databaseExceptions}.`,
  );
}
