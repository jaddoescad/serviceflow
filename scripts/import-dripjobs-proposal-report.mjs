#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  normalizeProposalReportName,
  validateDripJobsProposalReport,
} from "./lib/dripjobs-proposal-report.mjs";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const STORAGE_BUCKET = "material-invoices";
const APPLY = process.argv.includes("--apply");
const JSON_ONLY = process.argv.includes("--json");
const fileArgument = process.argv.find((value) => value.startsWith("--file="));
const envArgument = process.argv.find((value) => value.startsWith("--env="));
if (!fileArgument) throw new Error("Provide --file=/absolute/path/to/TotalProposalsSent.csv");
const filePath = path.resolve(fileArgument.slice("--file=".length));
if (!existsSync(filePath)) throw new Error(`Proposal report not found: ${filePath}`);

function parseEnvFile(envPath) {
  if (!existsSync(envPath)) return {};
  const values = {};
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resultData(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

function uuidV5(value, namespace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8") {
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  const bytes = crypto.createHash("sha1").update(namespaceBytes).update(String(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function add(map, key, value) {
  if (!key) return;
  const values = map.get(String(key)) ?? [];
  values.push(value);
  map.set(String(key), values);
}

function uniqueBy(rows, key) {
  return [...new Map(rows.map((row) => [key(row), row])).values()];
}

async function allRows(db, table, columns) {
  const rows = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = resultData(`${table} ${offset + 1}-${offset + 1_000}`, await db.from(table).select(columns).range(offset, offset + 999)) ?? [];
    rows.push(...page);
    if (page.length < 1_000) return rows;
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...(envArgument ? parseEnvFile(path.resolve(envArgument.slice("--env=".length))) : {}),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const backendKey = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !backendKey) throw new Error("Missing Supabase backend credentials");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Refusing Proposal report import for an unexpected Supabase project");
const db = createClient(supabaseUrl, backendKey, { auth: { persistSession: false, autoRefreshToken: false } });

const buffer = readFileSync(filePath);
const capturedAt = statSync(filePath).mtime.toISOString();
const validation = validateDripJobsProposalReport(buffer, { capturedAt });
const [leadReportRows, leads, quotes, jobs] = await Promise.all([
  allRows(db, "dripjobs_lead_report_latest", "source_document_id,source_row_number,matched_lead_id,normalized_email,normalized_phone,deal_name,raw_source,created_on,marketing_eligible,exclusion_reason"),
  allRows(db, "leads", "id,marketing_eligible,marketing_exclusion_reason"),
  allRows(db, "quotes", "id,lead_id,dripjobs_proposal_id,accepted_at,status"),
  allRows(db, "jobs", "id,lead_id,accepted_quote_id,source,status"),
]);

const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
const quoteByProposal = new Map(quotes.filter((quote) => quote.dripjobs_proposal_id).map((quote) => [String(quote.dripjobs_proposal_id), quote]));
const jobByQuote = new Map(jobs.filter((job) => job.accepted_quote_id).map((job) => [job.accepted_quote_id, job]));
const reportByEmail = new Map();
const reportByPhone = new Map();
for (const row of leadReportRows) {
  add(reportByEmail, row.normalized_email, row);
  add(reportByPhone, row.normalized_phone, row);
}

function leadReportRowKey(row) {
  return `${row.source_document_id}:${row.source_row_number}`;
}

function contactCandidates(row) {
  const byEmail = row.normalizedEmail ? reportByEmail.get(row.normalizedEmail) ?? [] : [];
  const byPhone = row.normalizedPhone ? reportByPhone.get(row.normalizedPhone) ?? [] : [];
  let candidates = [];
  let method = "none";
  if (byEmail.length && byPhone.length) {
    const phoneRows = new Set(byPhone.map(leadReportRowKey));
    candidates = byEmail.filter((candidate) => phoneRows.has(leadReportRowKey(candidate)));
    method = "email_phone_latest_lead_report";
  }
  if (!candidates.length && byEmail.length) {
    candidates = byEmail;
    method = "email_latest_lead_report";
  }
  if (!candidates.length && byPhone.length) {
    candidates = byPhone;
    method = "phone_latest_lead_report";
  }
  candidates = uniqueBy(
    candidates.filter((candidate) => candidate.created_on <= row.sentOn && candidate.marketing_eligible),
    leadReportRowKey,
  );
  if (candidates.length > 1) {
    const exactDeal = candidates.filter((candidate) =>
      normalizeProposalReportName(candidate.deal_name) === normalizeProposalReportName(row.dealName)
    );
    if (exactDeal.length === 1) {
      candidates = exactDeal;
      method += "+exact_deal_name";
    }
  }
  return { candidates, method };
}

const prepared = validation.rows.map((row) => {
  const quote = row.proposalId ? quoteByProposal.get(row.proposalId) ?? null : null;
  const job = quote ? jobByQuote.get(quote.id) ?? null : null;
  let matchedLeadId = quote?.lead_id ?? null;
  let matchedLeadReportRow = null;
  let matchMethod = quote ? "exact_proposal_id" : null;
  let matchConfidence = quote ? 1 : null;
  let matchStatus = quote ? "matched" : "unmatched";
  let candidateCount = quote ? 1 : 0;
  if (!quote) {
    const contact = contactCandidates(row);
    candidateCount = contact.candidates.length;
    if (contact.candidates.length === 1) {
      matchedLeadReportRow = contact.candidates[0];
      matchedLeadId = matchedLeadReportRow.matched_lead_id;
      matchMethod = contact.method;
      matchConfidence = contact.method.startsWith("email_phone") ? 0.99 : 0.95;
      matchStatus = "matched";
    } else if (contact.candidates.length > 1) {
      matchMethod = contact.method;
      matchStatus = "ambiguous";
    }
  } else {
    const contact = contactCandidates(row);
    const exactLeadRows = contact.candidates.filter((candidate) => candidate.matched_lead_id === quote.lead_id);
    if (exactLeadRows.length === 1) matchedLeadReportRow = exactLeadRows[0];
  }

  const matchedLead = matchedLeadId ? leadsById.get(matchedLeadId) ?? null : null;
  let marketingEligible = row.marketingEligible;
  let exclusionReason = row.exclusionReason;
  if (marketingEligible && matchedLead?.marketing_eligible === false) {
    marketingEligible = false;
    exclusionReason = "matched_ineligible_lead";
  }
  if (!marketingEligible) {
    matchStatus = "excluded";
    matchMethod = matchMethod ?? "proposal_row_classification";
    matchConfidence = matchConfidence ?? 1;
  }
  return {
    row,
    quote,
    job,
    matchedLeadReportRow,
    matchedLeadId,
    matchedLead,
    matchStatus,
    matchMethod,
    matchConfidence,
    candidateCount,
    marketingEligible,
    exclusionReason,
  };
});

const eligibleDelivered = prepared.filter((item) => item.row.isDelivered && item.marketingEligible);
const counts = {
  ...validation.manifest,
  matched_rows: prepared.filter((item) => item.matchStatus === "matched").length,
  ambiguous_rows: prepared.filter((item) => item.matchStatus === "ambiguous").length,
  unmatched_rows: prepared.filter((item) => item.matchStatus === "unmatched").length,
  excluded_rows: prepared.filter((item) => item.matchStatus === "excluded").length,
  eligible_delivered_matched_rows: eligibleDelivered.filter((item) => item.matchStatus === "matched").length,
  eligible_delivered_ambiguous_rows: eligibleDelivered.filter((item) => item.matchStatus === "ambiguous").length,
  eligible_delivered_unmatched_rows: eligibleDelivered.filter((item) => item.matchStatus === "unmatched").length,
  exact_proposal_id_matches: prepared.filter((item) => item.quote).length,
  accepted_job_matches: prepared.filter((item) => item.job && item.row.isDelivered && item.marketingEligible).length,
  final_eligible_delivered_row_count: eligibleDelivered.length,
  final_eligible_delivered_proposal_key_count: new Set(eligibleDelivered.map((item) => item.row.proposalKey)).size,
};

if (!APPLY) {
  process.stdout.write(`${JSON.stringify({ status: "dry_run", project_ref: PROJECT_REF, source_filename: path.basename(filePath), ...counts }, null, JSON_ONLY ? 0 : 2)}\n`);
  process.exit(0);
}

const importedAt = new Date().toISOString();
const documentId = uuidV5(`document:dripjobs-proposal-report:${validation.sourceSha256}`);
const storagePath = `dripjobs/proposal-report/${validation.sourceSha256.slice(0, 16)}-${path.basename(filePath)}`;
const upload = await db.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, {
  contentType: "text/csv",
  cacheControl: "3600",
  upsert: false,
});
if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) throw new Error(`Proposal report upload: ${upload.error.message}`);

resultData("Proposal report document", await db.from("documents").upsert({
  id: documentId,
  kind: "dripjobs_proposal_sent_report",
  original_filename: path.basename(filePath),
  mime_type: "text/csv",
  size_bytes: buffer.length,
  content_sha256: validation.sourceSha256,
  storage_bucket: STORAGE_BUCKET,
  storage_path: storagePath,
  source_url: "https://app.dripjobs.com/",
  captured_at: validation.capturedAt,
  metadata: { ...validation.manifest, validation_status: "pending", imported_at: importedAt },
  created_at: importedAt,
}, { onConflict: "id" }));

const reportRows = prepared.map((item) => ({
  source_document_id: documentId,
  source_row_number: item.row.sourceRowNumber,
  row_fingerprint: item.row.rowFingerprint,
  proposal_key: item.row.proposalKey,
  proposal_id: item.row.proposalId,
  proposal_name: item.row.proposalName,
  first_name: item.row.firstName,
  last_name: item.row.lastName,
  email: item.row.email,
  phone: item.row.phone,
  normalized_email: item.row.normalizedEmail,
  normalized_phone: item.row.normalizedPhone,
  salesperson: item.row.salesperson,
  deal_name: item.row.dealName,
  raw_source: item.row.rawSource,
  normalized_channel: item.row.normalizedChannel,
  sent_on: item.row.sentOn,
  sent_by: item.row.sentBy,
  appointment_linked: item.row.appointmentLinked,
  report_status: item.row.reportStatus,
  proposal_value_cents: item.row.proposalValueCents,
  delivery_method: item.row.deliveryMethod,
  is_delivered: item.row.isDelivered,
  marketing_eligible: item.marketingEligible,
  exclusion_reason: item.exclusionReason,
  matched_lead_report_document_id: item.matchedLeadReportRow?.source_document_id ?? null,
  matched_lead_report_row_number: item.matchedLeadReportRow?.source_row_number ?? null,
  matched_lead_id: item.matchedLeadId,
  matched_quote_id: item.quote?.id ?? null,
  matched_job_id: item.job?.id ?? null,
  match_status: item.matchStatus,
  match_method: item.matchMethod,
  match_confidence: item.matchConfidence,
  source_payload: {
    ...item.row.sourcePayload,
    classification_flags: item.row.classificationFlags,
    matched_lead_exclusion_reason: item.matchedLead?.marketing_exclusion_reason ?? null,
    candidate_count: item.candidateCount,
    tax_inclusion: "not_inferred_from_proposal_report",
  },
  captured_at: validation.capturedAt,
  created_at: importedAt,
  updated_at: importedAt,
}));

for (let offset = 0; offset < reportRows.length; offset += 250) {
  const batch = reportRows.slice(offset, offset + 250);
  const persisted = resultData(`Proposal report rows ${offset + 1}-${offset + batch.length}`, await db
    .from("dripjobs_proposal_report_rows")
    .upsert(batch, { onConflict: "source_document_id,source_row_number" })
    .select("source_row_number"));
  assert(persisted?.length === batch.length, `Only ${persisted?.length ?? 0}/${batch.length} Proposal report rows persisted`);
}

const verification = await db
  .from("dripjobs_proposal_report_rows")
  .select("source_row_number", { count: "exact", head: true })
  .eq("source_document_id", documentId);
if (verification.error) throw new Error(`Proposal report row verification: ${verification.error.message}`);
assert(verification.count === reportRows.length, `Proposal report verification found ${verification.count ?? 0}/${reportRows.length} rows`);

resultData("Accept Proposal report document", await db.from("documents").update({
  metadata: {
    ...validation.manifest,
    validation_status: "accepted",
    imported_at: importedAt,
    match_counts: counts,
  },
}).eq("id", documentId));

const [latestRows, deliveryRows, proposalFacts] = await Promise.all([
  db.from("dripjobs_proposal_report_latest").select("source_row_number", { count: "exact", head: true }),
  db.from("marketing_proposal_delivery_events").select("source_row_number", { count: "exact", head: true }),
  db.from("marketing_proposal_facts").select("proposal_key", { count: "exact", head: true }),
]);
for (const [label, result] of [["latest rows", latestRows], ["delivery events", deliveryRows], ["proposal facts", proposalFacts]]) {
  if (result.error) throw new Error(`Verify ${label}: ${result.error.message}`);
}
assert(latestRows.count === validation.rows.length, `Latest Proposal report has ${latestRows.count ?? 0}/${validation.rows.length} rows`);
assert(deliveryRows.count === counts.final_eligible_delivered_row_count, `Delivery event view has ${deliveryRows.count ?? 0}/${counts.final_eligible_delivered_row_count} rows`);
assert(proposalFacts.count === counts.final_eligible_delivered_proposal_key_count, `Proposal fact view has ${proposalFacts.count ?? 0}/${counts.final_eligible_delivered_proposal_key_count} rows`);

process.stdout.write(`${JSON.stringify({
  status: "applied",
  project_ref: PROJECT_REF,
  source_document_id: documentId,
  source_filename: path.basename(filePath),
  ...counts,
  verified_latest_rows: latestRows.count,
  verified_delivery_events: deliveryRows.count,
  verified_proposal_facts: proposalFacts.count,
}, null, JSON_ONLY ? 0 : 2)}\n`);
