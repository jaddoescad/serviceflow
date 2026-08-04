#!/usr/bin/env node

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

function parseDate(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const northAmerican = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return northAmerican
    ? `${northAmerican[3]}-${northAmerican[1].padStart(2, "0")}-${northAmerican[2].padStart(2, "0")}`
    : null;
}

function money(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function chunks(values, size = 250) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

async function fetchAll(db, table, select, configure = (query) => query) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const result = await configure(
      db.from(table).select(select).range(from, from + pageSize - 1),
    );
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
const [leads, jobRecords] = await Promise.all([
  fetchAll(
    db,
    "marketing_leads",
    "deal_id,proposal_number,created_on,email,phone",
  ),
  fetchAll(
    db,
    "marketing_crm_records",
    "id,proposal_id,invoice_id,status,label,contact_name,email,phone,deal_name,deal_stage,salesperson,deal_amount,invoice_status,paid_amount,balance_amount,source_filename,source_sha256,source_row_number,source_payload,captured_at",
    (query) =>
      query.eq("record_type", "job").eq("canonical_in_snapshot", true),
  ),
]);

const latestJobsByProposal = new Map();
for (const job of jobRecords) {
  const proposalId = String(job.proposal_id ?? "").trim();
  if (!proposalId) continue;
  const current = latestJobsByProposal.get(proposalId);
  if (!current || Date.parse(job.captured_at) > Date.parse(current.captured_at)) {
    latestJobsByProposal.set(proposalId, job);
  }
}
const jobs = [...latestJobsByProposal.values()];
const leadsById = new Map(leads.map((lead) => [lead.deal_id, lead]));
const leadsByProposal = new Map();
const leadsByContact = new Map();
const leadsByEmail = new Map();
const leadsByPhone = new Map();
for (const lead of leads) {
  const proposalNumber = String(lead.proposal_number ?? "").trim();
  if (proposalNumber) {
    const matches = leadsByProposal.get(proposalNumber) ?? [];
    matches.push(lead);
    leadsByProposal.set(proposalNumber, matches);
  }
  const email = normalizedEmail(lead.email);
  const phone = normalizedPhone(lead.phone);
  if (email) {
    const matches = leadsByEmail.get(email) ?? [];
    matches.push(lead);
    leadsByEmail.set(email, matches);
  }
  if (phone) {
    const matches = leadsByPhone.get(phone) ?? [];
    matches.push(lead);
    leadsByPhone.set(phone, matches);
  }
  if (email && phone) {
    const key = `${email}\u0000${phone}`;
    const matches = leadsByContact.get(key) ?? [];
    matches.push(lead);
    leadsByContact.set(key, matches);
  }
}

const candidatesByProposal = new Map();
function addCandidate(job, lead, method) {
  const proposalId = String(job.proposal_id);
  const candidates = candidatesByProposal.get(proposalId) ?? new Map();
  const candidate = candidates.get(lead.deal_id) ?? {
    lead,
    methods: new Set(),
  };
  candidate.methods.add(method);
  candidates.set(lead.deal_id, candidate);
  candidatesByProposal.set(proposalId, candidates);
}

for (const job of jobs) {
  const proposalId = String(job.proposal_id);
  for (const lead of leadsByProposal.get(proposalId) ?? []) {
    addCandidate(job, lead, "proposal_number");
  }
  const attributionContactId = String(
    job.source_payload?.attribution_evidence?.contact_uuid ?? "",
  ).trim();
  const attributedLead = leadsById.get(attributionContactId);
  if (attributedLead) {
    addCandidate(job, attributedLead, "dripjobs_contact_uuid");
  }
  const email = normalizedEmail(job.email);
  const phone = normalizedPhone(job.phone);
  if (email && phone) {
    const contactLeads = leadsByContact.get(`${email}\u0000${phone}`) ?? [];
    if (contactLeads.length === 1) {
      addCandidate(job, contactLeads[0], "email_and_phone");
    }
  }
  if (email && (leadsByEmail.get(email) ?? []).length === 1) {
    addCandidate(job, leadsByEmail.get(email)[0], "email");
  }
  if (phone && (leadsByPhone.get(phone) ?? []).length === 1) {
    addCandidate(job, leadsByPhone.get(phone)[0], "phone");
  }
}

const methodCounts = new Map();
let linkedJobs = 0;
let ambiguousJobs = 0;
const resolutionsByProposal = new Map();
function resolvedCandidate(candidates) {
  const strong = [...candidates.values()].filter(
    (candidate) =>
      candidate.methods.has("proposal_number") ||
      candidate.methods.has("dripjobs_contact_uuid"),
  );
  if (strong.length === 1) return { candidate: strong[0], ambiguous: false };
  if (strong.length > 1) return { candidate: null, ambiguous: true };
  const emailAndPhone = [...candidates.values()].filter((candidate) =>
    candidate.methods.has("email_and_phone"),
  );
  if (emailAndPhone.length === 1) {
    return { candidate: emailAndPhone[0], ambiguous: false };
  }
  if (emailAndPhone.length > 1) return { candidate: null, ambiguous: true };
  if (candidates.size === 1) {
    return { candidate: [...candidates.values()][0], ambiguous: false };
  }
  return { candidate: null, ambiguous: candidates.size > 1 };
}

for (const [proposalId, candidates] of candidatesByProposal.entries()) {
  const resolution = resolvedCandidate(candidates);
  resolutionsByProposal.set(proposalId, resolution);
  if (resolution.candidate) linkedJobs += 1;
  else if (resolution.ambiguous) ambiguousJobs += 1;
  for (const candidate of candidates.values()) {
    for (const method of candidate.methods) {
      methodCounts.set(method, (methodCounts.get(method) ?? 0) + 1);
    }
  }
}

const preview = {
  project_ref: TARGET_PROJECT_REF,
  apply: APPLY,
  canonical_job_records: jobRecords.length,
  unique_dripjobs_jobs: jobs.length,
  jobs_with_one_lead: linkedJobs,
  jobs_with_multiple_candidate_leads: ambiguousJobs,
  jobs_without_a_lead: jobs.length - linkedJobs - ambiguousJobs,
  method_candidate_counts: Object.fromEntries(methodCounts),
  unmatched_jobs: jobs
    .filter(
      (job) =>
        !resolutionsByProposal.get(String(job.proposal_id))?.candidate &&
        !resolutionsByProposal.get(String(job.proposal_id))?.ambiguous,
    )
    .map((job) => ({
      proposal_id: String(job.proposal_id),
      status: job.status,
      has_email: Boolean(normalizedEmail(job.email)),
      has_phone: Boolean(normalizedPhone(job.phone)),
      has_attribution_contact_id: Boolean(
        String(
          job.source_payload?.attribution_evidence?.contact_uuid ?? "",
        ).trim(),
      ),
      proposal_signed_on: parseDate(
        job.source_payload?.["Proposal Signed Date"],
      ),
      job_start_on: parseDate(job.source_payload?.["Job Start Date"]),
    })),
};

if (!APPLY) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

const [existingJobs, existingLinks] = await Promise.all([
  fetchAll(
    db,
    "dripjobs_jobs",
    "proposal_id,lead_resolution_status,lead_resolved_at",
  ),
  fetchAll(
    db,
    "marketing_lead_job_links",
    "lead_deal_id,job_proposal_id,relationship_type,link_status,match_method",
  ),
]);
const existingJobsByProposal = new Map(
  existingJobs.map((job) => [String(job.proposal_id), job]),
);
const existingLinksByPair = new Map(
  existingLinks.map((link) => [
    `${link.lead_deal_id}\u0000${link.job_proposal_id}`,
    link,
  ]),
);
const confirmedExistingByProposal = new Map(
  existingLinks
    .filter(
      (link) =>
        link.relationship_type === "originated" &&
        link.link_status === "confirmed",
    )
    .map((link) => [String(link.job_proposal_id), link]),
);

const methodPriority = [
  "proposal_number",
  "dripjobs_contact_uuid",
  "email_and_phone",
  "email",
  "phone",
];
const confidenceByMethod = {
  proposal_number: 1,
  dripjobs_contact_uuid: 0.99,
  email_and_phone: 0.94,
  email: 0.85,
  phone: 0.85,
};
const now = new Date().toISOString();
const jobWrites = jobs.map((job) => {
  const proposalId = String(job.proposal_id);
  const resolution = resolutionsByProposal.get(proposalId) ?? {
    candidate: null,
    ambiguous: false,
  };
  const existingConfirmed = confirmedExistingByProposal.get(proposalId);
  const selectedPair = resolution.candidate
    ? existingLinksByPair.get(
        `${resolution.candidate.lead.deal_id}\u0000${proposalId}`,
      )
    : null;
  let leadResolutionStatus = "missing_source";
  let leadResolutionNote =
    "No corresponding record exists in the maintained All Leads source.";
  if (existingConfirmed || (resolution.candidate && !selectedPair)) {
    leadResolutionStatus = "confirmed";
    leadResolutionNote = existingConfirmed
      ? "Originating lead relationship was already confirmed and preserved."
      : "Originating lead was resolved from deterministic DripJobs/contact evidence.";
  } else if (resolution.ambiguous || selectedPair) {
    leadResolutionStatus = "needs_review";
    leadResolutionNote = selectedPair
      ? "An existing review decision for this lead/job pair was preserved."
      : "More than one lead is supported by the available identifiers; no relationship was selected.";
  }

  const payload = job.source_payload ?? {};
  return {
    proposal_id: proposalId,
    source_crm_record_id: job.id,
    invoice_id: String(job.invoice_id ?? "").trim() || null,
    job_name:
      String(job.deal_name ?? "").trim() ||
      String(job.contact_name ?? "").trim() ||
      `DripJobs proposal ${proposalId}`,
    contact_name: String(job.contact_name ?? "").trim() || null,
    email: String(job.email ?? "").trim() || null,
    phone: String(job.phone ?? "").trim() || null,
    status: String(job.status ?? "").trim() || "Unknown",
    label: String(job.label ?? "").trim() || null,
    deal_stage: String(job.deal_stage ?? "").trim() || null,
    salesperson: String(job.salesperson ?? "").trim() || null,
    amount: money(job.deal_amount),
    invoice_status: String(job.invoice_status ?? "").trim() || null,
    paid_amount: money(job.paid_amount),
    balance_amount: money(job.balance_amount),
    proposal_signed_on: parseDate(payload["Proposal Signed Date"]),
    job_start_on: parseDate(payload["Job Start Date"]),
    job_scheduled_on: parseDate(payload["Job Schedule Date"]),
    job_completion_on: parseDate(payload["Job Completion Date"]),
    lead_resolution_status: leadResolutionStatus,
    lead_resolution_note: leadResolutionNote,
    lead_resolved_at:
      leadResolutionStatus === "confirmed"
        ? existingJobsByProposal.get(proposalId)?.lead_resolved_at ?? now
        : null,
    source_filename: job.source_filename,
    source_sha256: job.source_sha256,
    source_row_number: job.source_row_number,
    source_payload: payload,
    captured_at: job.captured_at,
  };
});

for (const batch of chunks(jobWrites)) {
  const result = await db.from("dripjobs_jobs").upsert(batch, {
    onConflict: "proposal_id",
  });
  if (result.error) throw result.error;
}

const proposedLinks = [];
for (const job of jobs) {
  const proposalId = String(job.proposal_id);
  if (confirmedExistingByProposal.has(proposalId)) continue;
  const candidate = resolutionsByProposal.get(proposalId)?.candidate;
  if (!candidate) continue;
  const pairKey = `${candidate.lead.deal_id}\u0000${proposalId}`;
  if (existingLinksByPair.has(pairKey)) continue;
  const method = methodPriority.find((value) => candidate.methods.has(value));
  if (!method) throw new Error(`No supported match method for ${proposalId}.`);
  const contactUuid = String(
    job.source_payload?.attribution_evidence?.contact_uuid ?? "",
  ).trim();
  proposedLinks.push({
    lead_deal_id: candidate.lead.deal_id,
    job_proposal_id: proposalId,
    relationship_type: "originated",
    link_status: "confirmed",
    match_method: method,
    confidence: confidenceByMethod[method],
    evidence: {
      decision: "deterministic_unique_identifier_match",
      available_match_methods: [...candidate.methods].sort(),
      proposal_id: proposalId,
      dripjobs_contact_uuid: contactUuid || null,
      source_crm_record_id: job.id,
      source_filename: job.source_filename,
      source_row_number: job.source_row_number,
    },
    review_note:
      "Created from a unique canonical DripJobs job-to-All-Leads match; raw contact values remain in their source records.",
    confirmed_at: now,
  });
}

for (const batch of chunks(proposedLinks)) {
  const result = await db.from("marketing_lead_job_links").insert(batch);
  if (result.error) throw result.error;
}

const [jobsVerification, linksVerification] = await Promise.all([
  db.from("dripjobs_jobs").select("proposal_id,lead_resolution_status"),
  db
    .from("marketing_lead_job_links")
    .select("job_proposal_id,link_status,relationship_type")
    .eq("link_status", "confirmed")
    .eq("relationship_type", "originated"),
]);
if (jobsVerification.error) throw jobsVerification.error;
if (linksVerification.error) throw linksVerification.error;
const storedJobs = jobsVerification.data ?? [];
const storedConfirmedLinks = linksVerification.data ?? [];
const storedStatusCounts = Object.fromEntries(
  Object.entries(
    Object.groupBy(storedJobs, (job) => job.lead_resolution_status),
  ).map(([status, rows]) => [status, rows.length]),
);
if (storedJobs.length !== jobs.length) {
  throw new Error(
    `Verification failed: expected ${jobs.length} jobs, found ${storedJobs.length}.`,
  );
}
const expectedConfirmedJobs = jobWrites.filter(
  (job) => job.lead_resolution_status === "confirmed",
).length;
if (storedConfirmedLinks.length !== expectedConfirmedJobs) {
  throw new Error(
    `Verification failed: expected ${expectedConfirmedJobs} originating lead links, found ${storedConfirmedLinks.length}.`,
  );
}

console.log(
  JSON.stringify(
    {
      ...preview,
      written_jobs: jobWrites.length,
      inserted_links: proposedLinks.length,
      stored_confirmed_links: storedConfirmedLinks.length,
      stored_resolution_statuses: storedStatusCounts,
    },
    null,
    2,
  ),
);
