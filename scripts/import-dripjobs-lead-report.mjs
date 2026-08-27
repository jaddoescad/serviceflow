#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { validateDripJobsLeadReport } from "./lib/dripjobs-lead-report.mjs";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const STORAGE_BUCKET = "material-invoices";
const APPLY = process.argv.includes("--apply");
const JSON_ONLY = process.argv.includes("--json");
const fileArgument = process.argv.find((value) => value.startsWith("--file="));
const envArgument = process.argv.find((value) => value.startsWith("--env="));
if (!fileArgument) throw new Error("Provide --file=/absolute/path/to/Leads.csv");
const filePath = path.resolve(fileArgument.slice("--file=".length));
if (!existsSync(filePath)) throw new Error(`Lead report not found: ${filePath}`);

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

function data(label, result) {
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

function normalizedName(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-CA").replace(/[^a-z0-9]+/g, " ").trim();
}

function localDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

async function allRows(db, table, columns) {
  const rows = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = data(`${table} ${offset + 1}-${offset + 1_000}`, await db.from(table).select(columns).range(offset, offset + 999)) ?? [];
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
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Refusing Lead report import for an unexpected Supabase project");
const db = createClient(supabaseUrl, backendKey, { auth: { persistSession: false, autoRefreshToken: false } });

const buffer = readFileSync(filePath);
const capturedAt = statSync(filePath).mtime.toISOString();
const validation = validateDripJobsLeadReport(buffer, { capturedAt });
const [contacts, leads, deals] = await Promise.all([
  allRows(db, "contacts", "id,name,normalized_email,normalized_phone,email,phone"),
  allRows(db, "leads", "*"),
  allRows(db, "dripjobs_sales_deals", "deal_id,lead_id,deal_name,raw_source"),
]);

const contactsByEmail = new Map();
const contactsByPhone = new Map();
for (const contact of contacts) {
  add(contactsByEmail, String(contact.normalized_email ?? contact.email ?? "").trim().toLocaleLowerCase("en-CA"), contact);
  add(contactsByPhone, String(contact.normalized_phone ?? contact.phone ?? "").replace(/[^0-9]+/g, ""), contact);
}
const leadsByContact = new Map();
for (const lead of leads) add(leadsByContact, lead.contact_id, lead);
const dealNamesByLead = new Map();
for (const deal of deals) add(dealNamesByLead, deal.lead_id, normalizedName(deal.deal_name));

function contactCandidates(row) {
  const email = row.normalizedEmail ? contactsByEmail.get(row.normalizedEmail) ?? [] : [];
  const phone = row.normalizedPhone ? contactsByPhone.get(row.normalizedPhone) ?? [] : [];
  if (email.length && phone.length) {
    const phoneIds = new Set(phone.map((contact) => contact.id));
    const intersection = email.filter((contact) => phoneIds.has(contact.id));
    if (intersection.length) return { contacts: intersection, method: "email_phone" };
  }
  const union = [...new Map([...email, ...phone].map((contact) => [contact.id, contact])).values()];
  return { contacts: union, method: email.length ? "email" : phone.length ? "phone" : "none" };
}

const candidateRows = validation.rows.map((row, index) => {
  const contact = contactCandidates(row);
  const candidates = contact.contacts
    .flatMap((item) => leadsByContact.get(item.id) ?? [])
    .filter((lead) => lead.source !== "legacy_companycam" && localDate(lead.created_at) === row.createdOn)
    .map((lead) => {
      const sourceExact = String(lead.source ?? "").trim().toLocaleLowerCase("en-CA") === row.rawSource.toLocaleLowerCase("en-CA");
      const dealExact = (dealNamesByLead.get(lead.id) ?? []).includes(normalizedName(row.dealName));
      return {
        lead,
        score: 100 + (sourceExact ? 50 : 0) + (dealExact ? 25 : 0) + (contact.method === "email_phone" ? 10 : 0),
        method: `${contact.method}+created_on${sourceExact ? "+source" : ""}${dealExact ? "+deal" : ""}`,
        confidence: sourceExact && contact.method === "email_phone" ? 0.99 : sourceExact ? 0.97 : dealExact ? 0.95 : 0.9,
      };
    })
    .sort((left, right) => right.score - left.score || left.lead.id.localeCompare(right.lead.id));
  return { index, row, candidates };
});

const unresolved = new Set(candidateRows.map((item) => item.index));
const usedLeadIds = new Set();
const matches = new Map();
let changed = true;
while (changed) {
  changed = false;
  const proposals = [];
  for (const index of unresolved) {
    const available = candidateRows[index].candidates.filter((candidate) => !usedLeadIds.has(candidate.lead.id));
    if (!available.length) continue;
    if (available.length > 1 && available[0].score === available[1].score) continue;
    proposals.push({ index, candidate: available[0] });
  }
  const byLead = new Map();
  for (const proposal of proposals) add(byLead, proposal.candidate.lead.id, proposal);
  for (const proposal of proposals) {
    if ((byLead.get(proposal.candidate.lead.id) ?? []).length !== 1) continue;
    matches.set(proposal.index, proposal.candidate);
    usedLeadIds.add(proposal.candidate.lead.id);
    unresolved.delete(proposal.index);
    changed = true;
  }
}

const prepared = candidateRows.map((item) => {
  const matched = matches.get(item.index) ?? null;
  const available = item.candidates.filter((candidate) => !usedLeadIds.has(candidate.lead.id));
  const matchStatus = item.row.marketingEligible
    ? matched ? "matched" : item.candidates.length ? "ambiguous" : "unmatched"
    : "excluded";
  return {
    row: item.row,
    matched,
    matchStatus,
    remainingCandidates: available.length,
  };
});

const appointmentUpdates = prepared.filter((item) =>
  item.row.marketingEligible &&
  item.matched &&
  item.row.appointmentAtLocal &&
  item.matched.lead.estimate_appointment_on !== item.row.appointmentAtLocal.slice(0, 10)
);
const exclusionUpdates = prepared.filter((item) =>
  !item.row.marketingEligible && item.matched && (
    item.matched.lead.marketing_eligible !== false ||
    item.matched.lead.marketing_exclusion_reason !== item.row.exclusionReason
  )
);
const counts = {
  ...validation.manifest,
  matched_rows: prepared.filter((item) => item.matched).length,
  matched_eligible_rows: prepared.filter((item) => item.row.marketingEligible && item.matched).length,
  unmatched_eligible_rows: prepared.filter((item) => item.row.marketingEligible && item.matchStatus === "unmatched").length,
  ambiguous_eligible_rows: prepared.filter((item) => item.row.marketingEligible && item.matchStatus === "ambiguous").length,
  excluded_rows: prepared.filter((item) => !item.row.marketingEligible).length,
  eligible_scheduled_rows: prepared.filter((item) => item.row.marketingEligible && item.row.appointmentAtLocal).length,
  matched_eligible_scheduled_rows: prepared.filter((item) => item.row.marketingEligible && item.row.appointmentAtLocal && item.matched).length,
  unmatched_eligible_scheduled_rows: prepared.filter((item) => item.row.marketingEligible && item.row.appointmentAtLocal && item.matchStatus === "unmatched").length,
  ambiguous_eligible_scheduled_rows: prepared.filter((item) => item.row.marketingEligible && item.row.appointmentAtLocal && item.matchStatus === "ambiguous").length,
  appointment_updates: appointmentUpdates.length,
  exclusion_updates: exclusionUpdates.length,
};

if (!APPLY) {
  process.stdout.write(`${JSON.stringify({ status: "dry_run", project_ref: PROJECT_REF, source_filename: path.basename(filePath), ...counts }, null, JSON_ONLY ? 0 : 2)}\n`);
  process.exit(0);
}

const importedAt = new Date().toISOString();
const documentId = uuidV5(`document:dripjobs-lead-report:${validation.sourceSha256}`);
const storagePath = `dripjobs/lead-report/${validation.sourceSha256.slice(0, 16)}-${path.basename(filePath)}`;
const upload = await db.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, {
  contentType: "text/csv",
  cacheControl: "3600",
  upsert: false,
});
if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) throw new Error(`Lead report upload: ${upload.error.message}`);
data("Lead report document", await db.from("documents").upsert({
  id: documentId,
  kind: "dripjobs_lead_report",
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
  first_name: item.row.firstName,
  last_name: item.row.lastName,
  email: item.row.email,
  phone: item.row.phone,
  normalized_email: item.row.normalizedEmail,
  normalized_phone: item.row.normalizedPhone,
  raw_source: item.row.rawSource,
  normalized_channel: item.row.normalizedChannel,
  label: item.row.label,
  salesperson: item.row.salesperson,
  deal_name: item.row.dealName,
  created_on: item.row.createdOn,
  appointment_at_local: item.row.appointmentAtLocal,
  booking_status: item.row.bookingStatus,
  marketing_eligible: item.row.marketingEligible,
  exclusion_reason: item.row.exclusionReason,
  matched_lead_id: item.matched?.lead.id ?? null,
  match_status: item.matchStatus,
  match_method: item.matched?.method ?? null,
  match_confidence: item.matched?.confidence ?? null,
  source_payload: {
    ...item.row.sourcePayload,
    classification_flags: item.row.classificationFlags,
    remaining_match_candidates: item.remainingCandidates,
  },
  captured_at: validation.capturedAt,
  created_at: importedAt,
  updated_at: importedAt,
}));
for (let offset = 0; offset < reportRows.length; offset += 250) {
  const batch = reportRows.slice(offset, offset + 250);
  const persisted = data(`Lead report rows ${offset + 1}-${offset + batch.length}`, await db
    .from("dripjobs_lead_report_rows")
    .upsert(batch, { onConflict: "source_document_id,source_row_number" })
    .select("source_row_number"));
  assert(persisted?.length === batch.length, `Only ${persisted?.length ?? 0}/${batch.length} Lead report rows persisted`);
}

for (const item of [...appointmentUpdates, ...exclusionUpdates]) {
  const fresh = data(`fresh lead ${item.matched.lead.id}`, await db.from("leads").select("*").eq("id", item.matched.lead.id).single());
  const nextMetadata = {
    ...(fresh.metadata ?? {}),
    dripjobs_lead_report: {
      source_document_id: documentId,
      source_sha256: validation.sourceSha256,
      source_row_number: item.row.sourceRowNumber,
      appointment_at_local: item.row.appointmentAtLocal,
      booking_status: item.row.bookingStatus,
      marketing_eligible: item.row.marketingEligible,
      exclusion_reason: item.row.exclusionReason,
      match_method: item.matched.method,
      imported_at: importedAt,
    },
  };
  const changes = {
    metadata: nextMetadata,
    updated_at: importedAt,
    ...(item.row.marketingEligible && item.row.appointmentAtLocal
      ? { estimate_appointment_on: item.row.appointmentAtLocal.slice(0, 10) }
      : {}),
    ...(!item.row.marketingEligible
      ? { marketing_eligible: false, marketing_exclusion_reason: item.row.exclusionReason }
      : {}),
  };
  const updated = data(`update lead ${fresh.id}`, await db.from("leads").update(changes).eq("id", fresh.id).eq("updated_at", fresh.updated_at).select("id"));
  assert(updated?.length === 1, `Lead ${fresh.id} changed during Lead report import`);
  data(`verify lead ${fresh.id}`, await db.from("verification_events").upsert({
    id: uuidV5(`verification:dripjobs-lead-report:${validation.sourceSha256}:${fresh.id}`),
    entity_type: "lead",
    entity_id: fresh.id,
    action: item.row.marketingEligible ? "dripjobs_lead_appointment_synced" : "marketing_lead_excluded",
    reason: item.row.marketingEligible
      ? "The exact DripJobs Lead report contact/date row supplied the missing scheduled estimate date."
      : `The DripJobs Lead report classified this row as ${item.row.exclusionReason}; the row remains operationally visible but is excluded from marketing denominators.`,
    old_values: {
      estimate_appointment_on: fresh.estimate_appointment_on,
      marketing_eligible: fresh.marketing_eligible,
      marketing_exclusion_reason: fresh.marketing_exclusion_reason,
    },
    new_values: changes,
    evidence: {
      source_document_id: documentId,
      source_row_number: item.row.sourceRowNumber,
      row_fingerprint: item.row.rowFingerprint,
      match_method: item.matched.method,
    },
    occurred_at: importedAt,
  }, { onConflict: "id" }));
}

const persistedRows = await db.from("dripjobs_lead_report_rows").select("source_row_number", { count: "exact", head: true }).eq("source_document_id", documentId);
if (persistedRows.error) throw new Error(`Lead report verification: ${persistedRows.error.message}`);
assert(persistedRows.count === validation.rows.length, `Persisted Lead report count ${persistedRows.count ?? 0} does not match ${validation.rows.length}`);
const scheduledRows = await db.from("dripjobs_lead_report_rows").select("source_row_number", { count: "exact", head: true }).eq("source_document_id", documentId).eq("booking_status", "Scheduled");
if (scheduledRows.error) throw new Error(`Lead appointment verification: ${scheduledRows.error.message}`);
assert(scheduledRows.count === validation.manifest.scheduled_count, `Persisted scheduled count ${scheduledRows.count ?? 0} does not match ${validation.manifest.scheduled_count}`);
data("accept Lead report document", await db.from("documents").update({
  metadata: { ...validation.manifest, validation_status: "accepted", imported_at: importedAt, match_counts: counts },
}).eq("id", documentId));

process.stdout.write(`${JSON.stringify({ status: "verified", project_ref: PROJECT_REF, source_document_id: documentId, source_filename: path.basename(filePath), ...counts }, null, JSON_ONLY ? 0 : 2)}\n`);
