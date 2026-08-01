#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildDripJobsProjectIdentity } from "./lib/dripjobs-job-identity.mjs";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const jobsArchivePath = path.resolve(
  repoRoot,
  "tmp/dripjobs-export/2026-07-31/jobs.normalized.json",
);
const apply = process.argv.includes("--apply");
const includeDetails = process.argv.includes("--details");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
}

function normalized(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\bnorth\b/g, "n")
    .replace(
      /\b(street|st\.?|road|rd\.?|avenue|ave\.?|crescent|cres\.?|court|ct\.?|drive|dr\.?|boulevard|blvd\.?|private|pvt\.?|lane|ln\.?|way|terrace|terr\.?)\b/g,
      " ",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshtein(left, right) {
  if (!left) return right.length;
  if (!right) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const upper = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = upper;
    }
  }
  return previous[right.length];
}

function isoDate(value) {
  const match = String(value ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function dateDistance(left, right) {
  return Math.round(
    (new Date(`${left}T12:00:00Z`) - new Date(`${right}T12:00:00Z`)) /
      86_400_000,
  );
}

function nameParts(job) {
  const full = normalized(job.customer_name || job.job_name);
  const words = full.split(" ").filter(Boolean);
  return {
    full,
    first: words[0] ?? "",
    last: words.at(-1) ?? "",
    address: normalized(job.address),
  };
}

function addressParts(value) {
  const tokens = normalized(value).split(" ").filter(Boolean);
  if (!/^\d+[a-z]?$/.test(tokens[0] ?? "")) {
    return { civic: "", streetTokens: [], compactStreet: "" };
  }
  const cityTokens = new Set([
    "ottawa",
    "gatineau",
    "orleans",
    "nepean",
    "russell",
    "casselman",
    "greely",
    "gloucester",
    "kanata",
    "stittsville",
    "rockland",
    "clarence",
  ]);
  const cityIndex = tokens.findIndex((token, index) => index > 0 && cityTokens.has(token));
  const streetTokens = tokens.slice(1, cityIndex > 1 ? cityIndex : undefined);
  return {
    civic: tokens[0],
    streetTokens,
    compactStreet: streetTokens.join(""),
  };
}

function addressScore(po, address) {
  const poAddress = addressParts(po);
  const jobAddress = addressParts(address);
  if (
    !poAddress.civic ||
    poAddress.civic !== jobAddress.civic ||
    poAddress.compactStreet.length < 3 ||
    jobAddress.compactStreet.length < 3
  ) {
    return 0;
  }
  const comparableJobStreet = jobAddress.streetTokens
    .slice(0, poAddress.streetTokens.length)
    .join("");
  if (
    poAddress.compactStreet === comparableJobStreet ||
    comparableJobStreet.includes(poAddress.compactStreet) ||
    poAddress.compactStreet.includes(comparableJobStreet)
  ) {
    return 100;
  }
  const distance = levenshtein(poAddress.compactStreet, comparableJobStreet);
  const maxDistance = Math.max(poAddress.compactStreet.length, comparableJobStreet.length) >= 8 ? 2 : 1;
  if (distance <= maxDistance) return 96;
  const sharedStreetToken = poAddress.streetTokens.some(
    (token) => token.length >= 4 && jobAddress.streetTokens.includes(token),
  );
  return sharedStreetToken ? 92 : 0;
}

function fuzzyFullNameScore(po, fullName) {
  const poTokens = po.split(" ").filter(Boolean);
  const nameTokens = fullName.split(" ").filter(Boolean);
  if (poTokens.length < 2 || nameTokens.length < 2) return 0;
  const distances = poTokens.map((poToken) =>
    Math.min(...nameTokens.map((nameToken) => levenshtein(poToken, nameToken))),
  );
  if (distances[0] <= 1 && distances.every((distance) => distance <= 1)) return 91;
  return 0;
}

function baseScore(po, job) {
  const names = nameParts(job);
  const compactPo = po.replace(/\s+/g, "");
  const compactLast = names.last.replace(/\s+/g, "");
  if (!po) return { score: 0, method: "customer_exact" };
  const matchedAddressScore = addressScore(po, job.address);
  if (matchedAddressScore) return { score: matchedAddressScore, method: "address_exact" };
  if (po === names.full) return { score: 100, method: "customer_exact" };
  if (po === names.last) return { score: 92, method: "customer_exact" };
  if (po === names.first && po.length >= 4) {
    return { score: 76, method: "customer_exact" };
  }
  if (
    po.length >= 5 &&
    (names.full.includes(po) ||
      po.includes(names.full) ||
      (names.last.length >= 4 && po.includes(names.last)))
  ) {
    return { score: 88, method: "customer_exact" };
  }
  if (
    compactPo.length >= 6 &&
    compactLast.length >= 6 &&
    levenshtein(compactPo, compactLast) <= 1
  ) {
    return { score: 86, method: "customer_exact" };
  }
  const fullNameFuzzy = fuzzyFullNameScore(po, names.full);
  if (fullNameFuzzy) return { score: fullNameFuzzy, method: "customer_exact" };
  const poLast = po.split(" ").at(-1) ?? "";
  if (poLast.length >= 5 && names.last.length >= 5) {
    const distance = levenshtein(poLast, names.last);
    if (distance === 1) return { score: 86, method: "customer_exact" };
    if (distance === 2 && Math.max(poLast.length, names.last.length) >= 7) {
      return { score: 80, method: "customer_exact" };
    }
  }
  return { score: 0, method: "customer_exact" };
}

function temporalScore(invoiceDate, job) {
  const started = isoDate(job.job_start_date);
  const completed = isoDate(job.job_completion_date);
  const created = isoDate(job.proposal_created_date);
  if (started && completed) {
    const fromStart = dateDistance(invoiceDate, started);
    const fromCompletion = dateDistance(invoiceDate, completed);
    if (fromStart >= 0 && fromCompletion <= 0) return 45;
    if (fromStart >= -7 && fromStart < 0) return 30;
    if (fromStart >= -21 && fromStart < -7) return 18;
    if (fromCompletion > 0 && fromCompletion <= 14) return 25;
    if (fromStart >= -45 && fromCompletion <= 45) return 10;
    return -35;
  }
  if (started) {
    const fromStart = dateDistance(invoiceDate, started);
    if (fromStart >= 0 && fromStart <= 60) return 35;
    if (fromStart >= -7 && fromStart < 0) return 25;
    if (fromStart >= -21 && fromStart < -7) return 15;
    if (fromStart < -45) return -20;
  }
  if (created) {
    const fromCreated = dateDistance(invoiceDate, created);
    if (fromCreated >= 0 && fromCreated <= 240) return 8;
    if (fromCreated < -14) return -25;
  }
  return 0;
}

function matchInvoice(invoice, jobs, projectIdByProposal) {
  const po = normalized(invoice.po_number);
  if (!po) return { kind: "unmatched", reason: "PO missing", candidates: [] };
  if (["supplies", "shop supplies", "office supplies"].includes(po)) {
    return {
      kind: "overhead",
      category: "Shop supplies",
      method: "overhead_rule",
      confidence: 1,
      candidates: [],
    };
  }
  const auditedPoAliases = new Map([
    ["luke nickson", "2372277"],
    ["luck nickson", "2372277"],
    ["orokovsky", "2418171"],
    ["lecalire", "3006955"],
    ["loraine", "3022357"],
    ["lorraine don", "3022357"],
  ]);
  const aliasProposalId = auditedPoAliases.get(po);
  if (aliasProposalId) {
    const aliasJob = jobs.find((job) => String(job.proposal_id) === aliasProposalId);
    if (!aliasJob) throw new Error(`Audited PO alias ${po} has no DripJobs proposal ${aliasProposalId}.`);
    const temporal = temporalScore(invoice.invoice_date, aliasJob);
    return {
      kind: "matched",
      job: aliasJob,
      projectId: projectIdByProposal.get(aliasJob.proposal_uuid),
      method: "customer_exact",
      base: 100,
      temporal,
      score: 100 + temporal,
      matchingNote: `Audited PO spelling alias to DripJobs proposal ${aliasProposalId}`,
      candidates: [
        {
          job: aliasJob,
          projectId: projectIdByProposal.get(aliasJob.proposal_uuid),
          method: "customer_exact",
          base: 100,
          temporal,
          score: 100 + temporal,
        },
      ],
    };
  }
  const candidates = jobs
    .map((job) => {
      const base = baseScore(po, job);
      if (!base.score) return null;
      const temporal = temporalScore(invoice.invoice_date, job);
      return {
        job,
        projectId: projectIdByProposal.get(job.proposal_uuid),
        method: base.method,
        base: base.score,
        temporal,
        score: base.score + temporal,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);
  if (!candidates.length) {
    return { kind: "unmatched", reason: `No DripJobs customer matched PO ${invoice.po_number}`, candidates: [] };
  }
  const best = candidates[0];
  const runnerUp = candidates[1];
  const strongName = best.base >= 86;
  const decisive = !runnerUp || best.score - runnerUp.score >= 12;
  const uniqueFirstName = best.base === 76 && (!runnerUp || runnerUp.base < 76);
  const decisiveFirstName =
    invoice.supplier_name === "The Home Depot" &&
    best.base === 76 &&
    decisive &&
    best.temporal >= 25 &&
    best.score >= 101;
  const uniqueFuzzy = best.base >= 80 && !runnerUp && best.temporal >= 20;
  if (
    (strongName && decisive && best.score >= 86) ||
    ((uniqueFirstName || decisiveFirstName) && best.score >= 84) ||
    (uniqueFuzzy && best.score >= 100)
  ) {
    return { kind: "matched", ...best, candidates: candidates.slice(0, 3) };
  }
  return {
    kind: "ambiguous",
    reason: `PO ${invoice.po_number} matches multiple DripJobs jobs`,
    candidates: candidates.slice(0, 3),
  };
}

function auditedLineOverheadPlan(invoice, invoiceLines) {
  if (
    invoice.source_system !== "gmail_home_depot_order" ||
    invoice.external_invoice_id !== "home-depot-order:240846171"
  ) {
    return null;
  }
  const categoryByProductCode = new Map([
    ["1000738387", "Shop supplies"],
    ["1001237109", "Tools & equipment"],
  ]);
  if (
    invoiceLines.length !== categoryByProductCode.size ||
    invoiceLines.some((line) => !categoryByProductCode.has(line.product_code))
  ) {
    throw new Error("Home Depot order 240846171 line evidence changed; refusing allocation.");
  }
  return {
    kind: "overhead",
    category: "Mixed overhead",
    method: "overhead_rule",
    confidence: 1,
    lineOverheadCategories: Object.fromEntries(categoryByProductCode),
    evidence: "Home Depot order 240846171 · audited item-purpose classification",
    source: "audited_home_depot_order_240846171",
  };
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await queryFactory().range(page * pageSize, page * pageSize + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Pagination exceeded 100,000 rows.");
}

if (!existsSync(jobsArchivePath)) throw new Error("Verified DripJobs archive is missing.");
const jobs = JSON.parse(readFileSync(jobsArchivePath, "utf8")).jobs ?? [];
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF) {
  throw new Error("Refusing reconciliation for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [projects, invoices, lines, activeAllocations] = await Promise.all([
  fetchAll(() => db.from("companycam_projects").select("companycam_id,name")),
  fetchAll(() =>
      db
        .from("material_invoices")
      .select("id,source_system,external_invoice_id,supplier_name,invoice_number,invoice_date,po_number,total_amount")
      .order("invoice_date"),
  ),
  fetchAll(() =>
    db
      .from("material_invoice_lines")
      .select("id,material_invoice_id,product_code,description,amount_before_tax,tax_amount,total_amount")
      .order("line_number"),
  ),
  fetchAll(() =>
    db
      .from("material_invoice_line_allocations")
      .select("material_invoice_line_id")
      .is("reversed_at", null),
  ),
]);
const { projectIdByProposal } = buildDripJobsProjectIdentity(
  jobs,
  new Set(projects.map((project) => String(project.companycam_id))),
);
const linesByInvoice = new Map();
for (const line of lines) {
  const values = linesByInvoice.get(line.material_invoice_id) ?? [];
  values.push(line);
  linesByInvoice.set(line.material_invoice_id, values);
}
const allocatedLineIds = new Set(
  activeAllocations.map((allocation) => allocation.material_invoice_line_id),
);
const plans = [];
const ambiguous = [];
const unmatched = [];

for (const invoice of invoices) {
  const invoiceLines = linesByInvoice.get(invoice.id) ?? [];
  if (!invoiceLines.length || invoiceLines.some((line) => allocatedLineIds.has(line.id))) {
    continue;
  }
  const lineOverheadPlan = auditedLineOverheadPlan(invoice, invoiceLines);
  const match = lineOverheadPlan ?? matchInvoice(invoice, jobs, projectIdByProposal);
  const auditRow = {
    invoice_id: invoice.id,
    supplier_name: invoice.supplier_name,
    invoice_number: invoice.invoice_number,
    invoice_date: invoice.invoice_date,
    po: invoice.po_number,
    total: Number(invoice.total_amount),
    reason: match.reason ?? null,
    candidates: (match.candidates ?? []).map((candidate) => ({
      project_id: candidate.projectId,
      customer: candidate.job.customer_name,
      address: candidate.job.address,
      proposal_id: candidate.job.proposal_id,
      job_start: candidate.job.job_start_date,
      job_completion: candidate.job.job_completion_date,
      score: candidate.score,
    })),
  };
  if (match.kind === "ambiguous") {
    ambiguous.push(auditRow);
    continue;
  }
  if (match.kind !== "matched") {
    if (match.kind === "overhead") {
      plans.push({
        ...auditRow,
        kind: "overhead",
        project_id: null,
        project_name: null,
        overhead_category: match.category,
        line_overhead_categories: match.lineOverheadCategories ?? null,
        evidence: match.evidence ?? null,
        source: match.source ?? null,
        method: match.method,
        confidence: match.confidence,
        lines: invoiceLines,
      });
      continue;
    }
    unmatched.push(auditRow);
    continue;
  }
  plans.push({
    ...auditRow,
    kind: "job",
    project_id: match.projectId,
    project_name: match.job.customer_name,
    proposal_id: String(match.job.proposal_id),
    proposal_uuid: match.job.proposal_uuid,
    method: match.method,
    matching_note: match.matchingNote ?? null,
    confidence: Math.min(1, match.score / 127),
    lines: invoiceLines,
  });
}

const report = {
  mode: apply ? "apply" : "dry-run",
  source: {
    dripjobs_jobs: jobs.length,
    material_invoices: invoices.length,
    previously_allocated_invoices: invoices.length - plans.length - ambiguous.length - unmatched.length,
  },
  planned_invoices: plans.length,
  planned_lines: plans.reduce((sum, plan) => sum + plan.lines.length, 0),
  ambiguous_invoices: ambiguous.length,
  unmatched_invoices: unmatched.length,
  planned_by_customer: Object.fromEntries(
    [...new Set(plans.map((plan) => plan.project_name ?? `Overhead: ${plan.overhead_category}`))]
      .sort()
      .map((name) => [
        name,
        plans.filter(
          (plan) => (plan.project_name ?? `Overhead: ${plan.overhead_category}`) === name,
        ).length,
      ]),
  ),
  planned_review: plans
    .filter((plan) => plan.kind === "job" && (plan.candidates[0]?.score ?? 0) < 110)
    .map((plan) => ({
      invoice_number: plan.invoice_number,
      invoice_date: plan.invoice_date,
      po: plan.po,
      total: plan.total,
      project_id: plan.project_id,
      project_name: plan.project_name,
      candidates: plan.candidates,
    })),
  ...(includeDetails
    ? {
        planned: plans.map((plan) => ({
          supplier_name: plan.supplier_name,
          invoice_number: plan.invoice_number,
          invoice_date: plan.invoice_date,
          po: plan.po,
          total: plan.total,
          allocation_scope: plan.kind,
          project_id: plan.project_id,
          project_name: plan.project_name,
          overhead_category: plan.overhead_category,
          line_overhead_categories: plan.line_overhead_categories,
          score: plan.candidates[0]?.score ?? null,
        })),
      }
    : {}),
  ambiguous,
  unmatched,
  inserted_allocations: 0,
};

if (apply) {
  const allocations = plans.flatMap((plan) =>
    plan.lines.map((line) => ({
      material_invoice_line_id: line.id,
      allocation_scope: plan.kind,
      companycam_project_id: plan.kind === "job" ? plan.project_id : null,
      overhead_category:
        plan.kind === "overhead"
          ? plan.line_overhead_categories?.[line.product_code] ?? plan.overhead_category
          : null,
      allocated_before_tax: Number(line.amount_before_tax),
      allocated_tax: Number(line.tax_amount),
      allocated_total: Number(line.total_amount),
      allocation_method: plan.method,
      evidence_reference:
        plan.kind === "job"
          ? `${plan.supplier_name} PO# ${plan.po} · ${plan.matching_note ? `${plan.matching_note} · ` : ""}DripJobs proposal ${plan.proposal_id}`
          : plan.evidence ?? `${plan.supplier_name} PO# ${plan.po} · documented supplies rule`,
      confidence: plan.confidence,
      needs_review: false,
      source_payload: {
        source:
          plan.kind === "job"
            ? "verified_dripjobs_export_2026-07-31"
            : plan.source ?? "documented_supplier_po_rule",
        proposal_uuid: plan.proposal_uuid,
        proposal_id: plan.proposal_id,
        customer_name: plan.project_name,
        matching_rule:
          plan.kind === "job"
            ? plan.matching_note ?? "PO customer/address plus job-date disambiguation"
            : plan.line_overhead_categories
              ? "Audited receipt line-item purpose"
              : "Supplier PO supplies rule",
      },
    })),
  );
  if (allocations.length) {
    const inserted = await db.from("material_invoice_line_allocations").insert(allocations);
    if (inserted.error) throw inserted.error;
    report.inserted_allocations = allocations.length;
  }
}

console.log(JSON.stringify(report, null, 2));
