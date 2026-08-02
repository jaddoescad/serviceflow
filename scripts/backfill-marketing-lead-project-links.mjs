#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

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
          line
            .slice(separator + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
}

async function fetchAll(db, table, select) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const result = await db
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...result.data);
    if (result.data.length < pageSize) return rows;
  }
}

const env = {
  ...parseEnvFile(
    path.resolve(repoRoot, "../Ottawa Painters App/.env.local"),
  ),
  ...parseEnvFile(path.join(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase credentials.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== TARGET_PROJECT_REF) {
  throw new Error(`Refusing backfill for unexpected project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const [leads, projects] = await Promise.all([
  fetchAll(
    db,
    "marketing_leads",
    "deal_id,proposal_number,created_on,email,phone,address,postal_code",
  ),
  fetchAll(
    db,
    "companycam_projects",
    "companycam_id,is_lead,is_archived,companycam_created_at,formatted_address,street_address_1,postal_code,raw",
  ),
]);

const leadsById = new Map(leads.map((lead) => [lead.deal_id, lead]));
function normalizedEmail(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-CA") || null;
}

function normalizedPhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parsedDate(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function projectEvidenceDate(project) {
  const dripJobs = project.raw?.dripjobs ?? {};
  for (const value of [
    dripJobs.proposal_created_date,
    dripJobs.proposal_signed_date,
    dripJobs.deal_stage_date,
    project.companycam_created_at,
    project.raw?.created_at,
  ]) {
    const date = parsedDate(value);
    if (date) return date;
  }
  return null;
}

function projectEmails(project) {
  const raw = project.raw ?? {};
  return new Set(
    [
      raw.dripjobs?.email,
      raw.dripjobs?.customer_email,
      raw.primary_contact?.email,
    ]
      .map(normalizedEmail)
      .filter(Boolean),
  );
}

function projectPhones(project) {
  const raw = project.raw ?? {};
  const phones = [
    raw.dripjobs?.phone,
    raw.dripjobs?.customer_phone,
    raw.primary_contact?.phone_number,
  ];
  for (const value of Array.isArray(raw.dripjobs?.phones)
    ? raw.dripjobs.phones
    : []) {
    phones.push(
      typeof value === "object" && value != null
        ? value.phone ?? value.number ?? value.value
        : value,
    );
  }
  return new Set(phones.map(normalizedPhone).filter(Boolean));
}

const leadsByEmailAndPhone = new Map();
for (const lead of leads) {
  const email = normalizedEmail(lead.email);
  const phone = normalizedPhone(lead.phone);
  if (!email || !phone) continue;
  const key = `${email}\u0000${phone}`;
  const matches = leadsByEmailAndPhone.get(key) ?? [];
  matches.push(lead);
  leadsByEmailAndPhone.set(key, matches);
}

const projectsByProposal = new Map();
for (const project of projects) {
  const proposalIds = new Set();
  if (project.companycam_id.startsWith("dripjobs-")) {
    proposalIds.add(project.companycam_id.slice("dripjobs-".length));
  }
  const rawProposal = String(project.raw?.dripjobs?.proposal_id ?? "").trim();
  if (rawProposal) proposalIds.add(rawProposal);
  for (const proposalId of proposalIds) {
    const matches = projectsByProposal.get(proposalId) ?? [];
    matches.push(project);
    projectsByProposal.set(proposalId, matches);
  }
}

const candidates = new Map();
function addCandidate(leadId, project, method, evidenceValue) {
  if (!leadsById.has(leadId)) return;
  const key = `${leadId}\u0000${project.companycam_id}`;
  const candidate = candidates.get(key) ?? {
    leadId,
    project,
    methods: new Set(),
    evidenceValues: {},
  };
  candidate.methods.add(method);
  candidate.evidenceValues[method] = evidenceValue;
  candidates.set(key, candidate);
}

for (const project of projects) {
  const raw = project.raw ?? {};
  for (const integration of Array.isArray(raw.integrations)
    ? raw.integrations
    : []) {
    const relationId = String(integration?.relation_id ?? "").trim();
    if (relationId) {
      addCandidate(
        relationId,
        project,
        "companycam_relation_id",
        relationId,
      );
    }
  }
  const contactUuid = String(raw.dripjobs?.contact_uuid ?? "").trim();
  if (contactUuid) {
    addCandidate(
      contactUuid,
      project,
      "dripjobs_contact_uuid",
      contactUuid,
    );
  }
}

for (const lead of leads) {
  const proposalNumber = String(lead.proposal_number ?? "").trim();
  if (!proposalNumber) continue;
  for (const project of projectsByProposal.get(proposalNumber) ?? []) {
    addCandidate(
      lead.deal_id,
      project,
      "proposal_number",
      proposalNumber,
    );
  }
}

const projectsWithStrongCandidates = new Set(
  [...candidates.values()].map(
    (candidate) => candidate.project.companycam_id,
  ),
);
for (const project of projects) {
  if (projectsWithStrongCandidates.has(project.companycam_id)) continue;
  const evidenceDate = projectEvidenceDate(project);
  if (!evidenceDate) continue;
  const contactCandidates = new Map();
  for (const email of projectEmails(project)) {
    for (const phone of projectPhones(project)) {
      for (const lead of leadsByEmailAndPhone.get(`${email}\u0000${phone}`) ?? []) {
        contactCandidates.set(lead.deal_id, { lead, email, phone });
      }
    }
  }
  if (contactCandidates.size !== 1) continue;
  const [{ lead, email, phone }] = [...contactCandidates.values()];
  const leadDate = parsedDate(`${lead.created_on}T12:00:00Z`);
  const gapDays = Math.round(
    (evidenceDate.getTime() - leadDate.getTime()) / 86_400_000,
  );
  if (gapDays < -7 || gapDays > 365) continue;
  addCandidate(lead.deal_id, project, "email_and_phone", {
    email_sha256: sha256(email),
    phone_sha256: sha256(phone),
    lead_created_on: lead.created_on,
    project_evidence_on: evidenceDate.toISOString().slice(0, 10),
    gap_days: gapDays,
  });
}

const leadIdsByProject = new Map();
for (const candidate of candidates.values()) {
  const leadIds =
    leadIdsByProject.get(candidate.project.companycam_id) ?? new Set();
  leadIds.add(candidate.leadId);
  leadIdsByProject.set(candidate.project.companycam_id, leadIds);
}
const conflictingProjectIds = new Set(
  [...leadIdsByProject.entries()]
    .filter(([, leadIds]) => leadIds.size > 1)
    .map(([projectId]) => projectId),
);

let existingLinks = [];
const existingResult = await db
  .from("marketing_lead_project_links")
  .select(
    "lead_deal_id,companycam_project_id,relationship_type,link_status,match_method",
  )
  .limit(5000);
if (existingResult.error) {
  if (APPLY) throw existingResult.error;
} else {
  existingLinks = existingResult.data;
}
const existingPairs = new Set(
  existingLinks.map(
    (link) => `${link.lead_deal_id}\u0000${link.companycam_project_id}`,
  ),
);
const existingOriginByProject = new Map(
  existingLinks
    .filter(
      (link) =>
        link.relationship_type === "originated" &&
        link.link_status === "confirmed",
    )
    .map((link) => [link.companycam_project_id, link.lead_deal_id]),
);

const capturedAt = new Date().toISOString();
const methodPriority = [
  "proposal_number",
  "companycam_relation_id",
  "dripjobs_contact_uuid",
  "email_and_phone",
];
const rows = [...candidates.values()]
  .map((candidate) => {
    const methods = methodPriority.filter((method) =>
      candidate.methods.has(method),
    );
    const existingOrigin = existingOriginByProject.get(
      candidate.project.companycam_id,
    );
    const ambiguous =
      conflictingProjectIds.has(candidate.project.companycam_id) ||
      (existingOrigin != null && existingOrigin !== candidate.leadId);
    const confirmed = !ambiguous;
    const confidence = candidate.methods.has("proposal_number")
      ? 1
      : candidate.methods.has("companycam_relation_id")
        ? 0.99
        : candidate.methods.has("dripjobs_contact_uuid")
          ? 0.98
          : 0.92;
    return {
      lead_deal_id: candidate.leadId,
      companycam_project_id: candidate.project.companycam_id,
      relationship_type: "originated",
      link_status: confirmed ? "confirmed" : "suggested",
      match_method: methods[0],
      confidence,
      evidence: {
        decision_source: "automated_exact_identifier_backfill_v1",
        exact_identifiers: methods,
        identifier_values: candidate.evidenceValues,
        returning_customer_safe: true,
      },
      review_note: confirmed
        ? candidate.methods.has("email_and_phone")
          ? "Confirmed from a unique exact email-and-phone pair plus compatible lead/project dates; duplicate contacts were excluded."
          : "Confirmed from exact external identifiers; email and phone were not used as keys."
        : "Multiple leads claim this project; manual confirmation is required.",
      confirmed_at: confirmed ? capturedAt : null,
      confirmed_by: null,
    };
  })
  .sort(
    (left, right) =>
      left.companycam_project_id.localeCompare(
        right.companycam_project_id,
        "en-CA",
      ) || left.lead_deal_id.localeCompare(right.lead_deal_id, "en-CA"),
  );
const newRows = rows.filter(
  (row) =>
    !existingPairs.has(
      `${row.lead_deal_id}\u0000${row.companycam_project_id}`,
    ),
);
const confirmedProjectIds = new Set(
  rows
    .filter((row) => row.link_status === "confirmed")
    .map((row) => row.companycam_project_id),
);
const jobProjects = projects.filter((project) => !project.is_lead);
const leadProjects = projects.filter((project) => project.is_lead);
const earliestLeadOn = leads
  .map((lead) => lead.created_on)
  .sort()[0];
const unlinkedJobProjects = jobProjects.filter(
  (project) => !confirmedProjectIds.has(project.companycam_id),
);
const unlinkedJobTiming = Object.fromEntries(
  Object.entries(
    Object.groupBy(unlinkedJobProjects, (project) => {
      const evidenceDate = projectEvidenceDate(project);
      if (!evidenceDate) return "date_unknown";
      const evidenceOn = evidenceDate.toISOString().slice(0, 10);
      return evidenceOn < earliestLeadOn
        ? "before_canonical_lead_history"
        : "during_canonical_lead_history";
    }),
  ).map(([group, groupProjects]) => [group, groupProjects.length]),
);
const preview = {
  project_ref: TARGET_PROJECT_REF,
  apply: APPLY,
  leads_scanned: leads.length,
  projects_scanned: projects.length,
  exact_candidate_pairs: rows.length,
  confirmed_pairs: rows.filter((row) => row.link_status === "confirmed")
    .length,
  suggested_pairs: rows.filter((row) => row.link_status === "suggested")
    .length,
  leads_with_confirmed_projects: new Set(
    rows
      .filter((row) => row.link_status === "confirmed")
      .map((row) => row.lead_deal_id),
  ).size,
  projects_with_multiple_candidate_leads: conflictingProjectIds.size,
  project_coverage: {
    jobs_total: jobProjects.length,
    jobs_with_confirmed_lead: jobProjects.filter((project) =>
      confirmedProjectIds.has(project.companycam_id),
    ).length,
    jobs_missing_confirmed_lead: jobProjects.filter(
      (project) => !confirmedProjectIds.has(project.companycam_id),
    ).length,
    companycam_leads_total: leadProjects.length,
    companycam_leads_linked: leadProjects.filter((project) =>
      confirmedProjectIds.has(project.companycam_id),
    ).length,
    canonical_lead_history_starts: earliestLeadOn,
    unlinked_job_timing: unlinkedJobTiming,
    unlinked_job_sources: {
      dripjobs_import: unlinkedJobProjects.filter((project) =>
        project.companycam_id.startsWith("dripjobs-"),
      ).length,
      companycam: unlinkedJobProjects.filter(
        (project) => !project.companycam_id.startsWith("dripjobs-"),
      ).length,
    },
  },
  existing_pairs_preserved: existingLinks.length,
  new_pairs: newRows.length,
  method_counts: Object.fromEntries(
    Object.entries(
      Object.groupBy(rows, (row) => row.match_method),
    ).map(([method, methodRows]) => [method, methodRows.length]),
  ),
};

if (!APPLY) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

for (let index = 0; index < newRows.length; index += 400) {
  const result = await db
    .from("marketing_lead_project_links")
    .insert(newRows.slice(index, index + 400));
  if (result.error) throw result.error;
}

const [confirmedResult, suggestedResult] = await Promise.all([
  db
    .from("marketing_lead_project_links")
    .select("id", { count: "exact", head: true })
    .eq("link_status", "confirmed"),
  db
    .from("marketing_lead_project_links")
    .select("id", { count: "exact", head: true })
    .eq("link_status", "suggested"),
]);
if (confirmedResult.error) throw confirmedResult.error;
if (suggestedResult.error) throw suggestedResult.error;

console.log(
  JSON.stringify(
    {
      ...preview,
      database_confirmed_pairs: confirmedResult.count,
      database_suggested_pairs: suggestedResult.count,
    },
    null,
    2,
  ),
);
