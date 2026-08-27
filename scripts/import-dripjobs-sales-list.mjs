#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { validateDripJobsSalesExports } from "./lib/dripjobs-sales-list.mjs";

const APPLY = process.argv.includes("--apply");
const SUMMARY_ONLY = process.argv.includes("--summary");
const JSON_ONLY = process.argv.includes("--json");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const STORAGE_BUCKET = "material-invoices";
const activeArgument = process.argv.find((value) => value.startsWith("--active-json="));
const archivedArgument = process.argv.find((value) => value.startsWith("--archived-json="));
const envArgument = process.argv.find((value) => value.startsWith("--env="));
const scopeArgument = process.argv.find((value) => value.startsWith("--scope="));
const SCOPE = String(scopeArgument?.slice("--scope=".length) || "backfill").replaceAll("-", "_");
if (!["backfill", "changed_delta"].includes(SCOPE)) throw new Error("--scope must be backfill or changed-delta.");
if (!activeArgument || !archivedArgument) throw new Error("Both --active-json and --archived-json are required.");
const ACTIVE_JSON_PATH = path.resolve(activeArgument.slice("--active-json=".length));
const ARCHIVED_JSON_PATH = path.resolve(archivedArgument.slice("--archived-json=".length));

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

function uuidV5(value, namespace = UUID_NAMESPACE) {
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  const bytes = crypto.createHash("sha1").update(namespaceBytes).update(String(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function estimatedLeadCreatedAt(row, capturedAt) {
  const captured = new Date(capturedAt);
  const match = String(row.dealAge ?? "").match(/^(\d+)(h|d|mo|y|yr)$/i);
  if (!match || !Number.isFinite(captured.getTime())) return { value: capturedAt, method: "sales_list_capture_fallback", confidence: 0.2 };
  const amount = Number(match[1]);
  const unit = match[2].toLocaleLowerCase("en-CA");
  if (unit === "mo") captured.setUTCMonth(captured.getUTCMonth() - amount);
  else if (unit === "y" || unit === "yr") captured.setUTCFullYear(captured.getUTCFullYear() - amount);
  else captured.setTime(captured.getTime() - amount * (unit === "h" ? 3_600_000 : 86_400_000));
  const confidence = unit === "h" ? 0.85 : unit === "d" ? 0.65 : unit === "mo" ? 0.35 : 0.2;
  return { value: captured.toISOString(), method: `sales_list_deal_age_${unit}`, confidence };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resultData(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

function authorityEquivalent(authority, row, sourceType) {
  return (
    String(authority?.source_type ?? "") === sourceType &&
    String(authority?.deal_id ?? "") === row.dealId &&
    String(authority?.source_view ?? "") === row.view &&
    String(authority?.sales_status ?? "") === row.status &&
    String(authority?.label ?? "") === String(row.label ?? "") &&
    String(authority?.raw_source ?? "") === String(row.rawSource ?? "") &&
    String(authority?.normalized_channel ?? "") === row.normalizedChannel &&
    String(authority?.deal_stage ?? "") === row.dealStage &&
    Number(authority?.deal_amount_cents ?? -1) === row.dealAmountCents &&
    String(authority?.last_change ?? "") === String(row.lastChange ?? "") &&
    String(authority?.deal_age ?? "") === String(row.dealAge ?? "") &&
    String(authority?.salesperson ?? "") === String(row.salesperson ?? "")
  );
}

assert(existsSync(ACTIVE_JSON_PATH), `Active Sales List not found: ${ACTIVE_JSON_PATH}`);
assert(existsSync(ARCHIVED_JSON_PATH), `Archived Sales List not found: ${ARCHIVED_JSON_PATH}`);
const activeBuffer = readFileSync(ACTIVE_JSON_PATH);
const archivedBuffer = readFileSync(ARCHIVED_JSON_PATH);
const validation = validateDripJobsSalesExports({ active: activeBuffer, archived: archivedBuffer }, { scope: SCOPE });

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...(envArgument ? parseEnvFile(path.resolve(envArgument.slice("--env=".length))) : {}),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const backendSecretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !backendSecretKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Refusing Sales List import for an unexpected Supabase project.");
const db = createClient(supabaseUrl, backendSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function allRows(table, columns) {
  const rows = [];
  for (let offset = 0; ; offset += 1_000) {
    const page = resultData(`${table} ${offset + 1}-${offset + 1_000}`, await db.from(table).select(columns).range(offset, offset + 999)) ?? [];
    rows.push(...page);
    if (page.length < 1_000) return rows;
  }
}
const [leads, contacts, existingDeals] = await Promise.all([
  allRows("leads", "*"),
  allRows("contacts", "*"),
  allRows("dripjobs_sales_deals", "deal_id,dripjobs_contact_id,lead_id"),
]);

function addToMap(map, key, value) {
  if (!key) return;
  const values = map.get(String(key)) ?? [];
  values.push(value);
  map.set(String(key), values);
}

const leadsBySalesDeal = new Map();
const leadsByEventIdentity = new Map();
const leadsByContact = new Map();
for (const lead of leads) {
  addToMap(leadsBySalesDeal, lead.dripjobs_sales_deal_id, lead);
  addToMap(leadsByEventIdentity, lead.dripjobs_deal_id, lead);
  addToMap(leadsByContact, lead.contact_id, lead);
}
const contactsByExternalId = new Map();
for (const contact of contacts) addToMap(contactsByExternalId, contact.dripjobs_contact_id, contact);
const existingDealsById = new Map(existingDeals.map((deal) => [deal.deal_id, deal]));
const lifetimeDealIdsByContact = new Map();
function addLifetimeDeal(contactId, dealId) {
  if (!contactId || !dealId) return;
  const dealIds = lifetimeDealIdsByContact.get(String(contactId)) ?? new Set();
  dealIds.add(String(dealId));
  lifetimeDealIdsByContact.set(String(contactId), dealIds);
}
for (const deal of existingDeals) addLifetimeDeal(deal.dripjobs_contact_id, deal.deal_id);
for (const row of validation.rows) addLifetimeDeal(row.contactId, row.dealId);

const resolved = [];
const missing = [];
const claimedLeadIds = new Set();
for (const row of validation.rows) {
  let candidates = leadsBySalesDeal.get(row.dealId) ?? [];
  let matchMethod = "sales_deal_id";
  if (candidates.length === 0) {
    candidates = leadsByEventIdentity.get(row.dealId) ?? [];
    matchMethod = "event_deal_id";
  }
  if (candidates.length === 0 && row.contactId && (lifetimeDealIdsByContact.get(row.contactId)?.size ?? 0) === 1) {
    candidates = leadsByEventIdentity.get(row.contactId) ?? [];
    matchMethod = "unique_lifetime_deal_for_legacy_contact_identity";
  }
  if (candidates.length === 0 && row.contactId && (lifetimeDealIdsByContact.get(row.contactId)?.size ?? 0) === 1) {
    const contactMatches = contactsByExternalId.get(row.contactId) ?? [];
    if (contactMatches.length === 1) {
      candidates = leadsByContact.get(contactMatches[0].id) ?? [];
      matchMethod = "exact_contact_id";
    }
  }
  if (candidates.length !== 1 || claimedLeadIds.has(candidates[0].id)) {
    missing.push({ row, reason: candidates.length === 0 ? "no exact identity match" : "identity is ambiguous or already claimed" });
    continue;
  }
  claimedLeadIds.add(candidates[0].id);
  resolved.push({ row, lead: candidates[0], matchMethod });
}
const missingActive = missing.filter((item) => item.row.view === "active");
const missingArchived = missing.filter((item) => item.row.view === "archived");
const recoverableActive = missingActive.filter((item) => (
  item.row.contactId &&
  (contactsByExternalId.get(item.row.contactId) ?? []).length <= 1 &&
  ["no exact identity match", "identity is ambiguous or already claimed"].includes(item.reason)
));
const unrecoverableActive = missingActive.filter((item) => !recoverableActive.includes(item));

const planned = resolved.flatMap(({ row, lead, matchMethod }) => {
  const nextStatus = lead.status === "won" ? "won" : row.leadStatus;
  const nextSource = row.rawSource ?? lead.source;
  const nextChannel = row.rawSource ? row.normalizedChannel : lead.normalized_channel;
  const valueChanged = (
    lead.status !== nextStatus ||
    String(lead.pipeline_stage_raw ?? "") !== row.dealStage ||
    String(lead.source ?? "") !== String(nextSource ?? "") ||
    String(lead.normalized_channel ?? "") !== String(nextChannel ?? "") ||
    String(lead.dripjobs_sales_deal_id ?? "") !== row.dealId
  );
  const authorityRefresh = !authorityEquivalent(lead.metadata?.dripjobs_sales_list_authority, row, validation.manifest.source_type);
  if (!valueChanged && !authorityRefresh) return [];
  return [{ row, lead, matchMethod, nextStatus, nextSource, nextChannel, valueChanged, authorityRefresh }];
});

const preview = {
  mode: APPLY ? "apply" : "dry-run",
  source: {
    source_type: validation.manifest.source_type,
    source_sha256: validation.manifest.source_sha256,
    active_rows: validation.manifest.active_row_count,
    archived_rows: validation.manifest.archived_row_count,
    distinct_deals: validation.manifest.distinct_deals,
  },
  counts: {
    matched_exact_identities: resolved.length,
    matched_sales_deal_ids: resolved.filter((item) => item.matchMethod === "sales_deal_id").length,
    matched_event_deal_ids: resolved.filter((item) => item.matchMethod === "event_deal_id").length,
    matched_unique_legacy_contact_identities: resolved.filter((item) => item.matchMethod === "unique_lifetime_deal_for_legacy_contact_identity").length,
    matched_exact_contact_ids: resolved.filter((item) => item.matchMethod === "exact_contact_id").length,
    to_apply: planned.length + recoverableActive.length,
    value_changes: planned.filter((item) => item.valueChanged).length + recoverableActive.length,
    authority_refreshes: planned.filter((item) => item.authorityRefresh).length,
    already_current: resolved.length - planned.length,
    active_leads_to_recover: recoverableActive.length,
    deals_to_persist: validation.rows.length,
    new_deals_to_persist: validation.rows.filter((row) => !existingDealsById.has(row.dealId)).length,
    deals_without_exact_lead: missing.length,
    missing_archived_unchanged: missingArchived.length,
    missing_active: missingActive.length,
    unrecoverable_active: unrecoverableActive.length,
  },
};
if (!JSON_ONLY || !APPLY) console.log(JSON.stringify(preview, null, JSON_ONLY ? 0 : 2));
if (!APPLY) process.exit(0);
assert(unrecoverableActive.length === 0, `${unrecoverableActive.length} active DripJobs deal(s) lack one recoverable exact Deal ID or Contact ID; refusing fuzzy matching.`);

const importedAt = new Date().toISOString();
const sourceDocuments = [];
for (const [view, filePath, buffer, validated] of [
  ["active", ACTIVE_JSON_PATH, activeBuffer, validation.active],
  ["archived", ARCHIVED_JSON_PATH, archivedBuffer, validation.archived],
]) {
  const documentId = stableUuid(`document:dripjobs-sales-list:${validated.sourceSha256}`);
  const storagePath = `dripjobs/sales-list/${validated.sourceSha256.slice(0, 16)}-${path.basename(filePath)}`;
  const upload = await db.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, { contentType: "application/json", cacheControl: "3600", upsert: false });
  if (upload.error && !/already exists/i.test(String(upload.error.message))) throw upload.error;
  resultData(`${view} Sales List document`, await db.from("documents").upsert({
    id: documentId,
    kind: "dripjobs_sales_list_snapshot",
    original_filename: path.basename(filePath),
    mime_type: "application/json",
    size_bytes: statSync(filePath).size,
    content_sha256: validated.sourceSha256,
    storage_bucket: STORAGE_BUCKET,
    storage_path: storagePath,
    source_url: "https://app.dripjobs.com/saleslist",
    captured_at: validated.capturedAt,
    metadata: {
      source_type: validation.manifest.source_type,
      scope: SCOPE,
      view,
      row_count: validated.rows.length,
      combined_source_sha256: validation.manifest.source_sha256,
      exact_identity: "DripJobs Deal ID from both the row checkbox and deal href",
    },
    created_at: importedAt,
  }, { onConflict: "id" }));
  sourceDocuments.push({ view, id: documentId, sha256: validated.sourceSha256, filename: path.basename(filePath) });
}
const sourceByView = new Map(sourceDocuments.map((document) => [document.view, document]));
function authorityFor(row, matchMethod, document) {
  return {
    source_type: validation.manifest.source_type,
    scope: SCOPE,
    source_view: row.view,
    source_filename: document.filename,
    source_sha256: document.sha256,
    combined_source_sha256: validation.manifest.source_sha256,
    source_document_id: document.id,
    source_row: row.rowNumber,
    deal_id: row.dealId,
    contact_id: row.contactId,
    match_method: matchMethod,
    sales_status: row.status,
    label: row.label,
    raw_source: row.rawSource,
    normalized_channel: row.normalizedChannel,
    deal_name: row.dealName,
    deal_stage: row.dealStage,
    deal_amount_cents: row.dealAmountCents,
    last_change: row.lastChange,
    deal_age: row.dealAge,
    salesperson: row.salesperson,
    imported_at: importedAt,
  };
}

const recovered = [];
for (const item of recoverableActive) {
  const row = item.row;
  const document = sourceByView.get(row.view);
  const authority = authorityFor(row, "sales_list_recovery_exact_ids", document);
  const existingContact = (contactsByExternalId.get(row.contactId) ?? [])[0] ?? null;
  const contactId = existingContact?.id ?? uuidV5(`contact:dripjobs:${row.contactId}`);
  const normalizedEmail = row.email ? row.email.trim().toLocaleLowerCase("en-CA") : null;
  const normalizedPhone = String(row.phone ?? "").replace(/[^0-9]+/g, "") || null;
  if (existingContact) {
    resultData(`recover contact ${contactId}`, await db.from("contacts").update({
      name: row.customer,
      email: row.email,
      phone: row.phone,
      normalized_email: normalizedEmail,
      normalized_phone: normalizedPhone,
      metadata: { ...(existingContact.metadata ?? {}), dripjobs_sales_list_recovery: { deal_id: row.dealId, imported_at: importedAt } },
      updated_at: importedAt,
    }).eq("id", contactId));
  } else {
    resultData(`insert recovered contact ${contactId}`, await db.from("contacts").insert({
      id: contactId,
      kind: "customer",
      dripjobs_contact_id: row.contactId,
      name: row.customer,
      email: row.email,
      phone: row.phone,
      normalized_email: normalizedEmail,
      normalized_phone: normalizedPhone,
      metadata: { source: "dripjobs_sales_list_recovery", deal_id: row.dealId, imported_at: importedAt },
      created_at: importedAt,
      updated_at: importedAt,
    }));
  }
  const contactIdentityAlreadyUsed = (leadsByEventIdentity.get(row.contactId) ?? []).length > 0;
  const eventIdentity = contactIdentityAlreadyUsed ? row.dealId : (row.contactId || row.dealId);
  const leadId = uuidV5(`lead:${eventIdentity}`);
  const createdAt = estimatedLeadCreatedAt(row, validation.active.capturedAt);
  resultData(`insert recovered lead ${leadId}`, await db.from("leads").insert({
    id: leadId,
    contact_id: contactId,
    dripjobs_deal_id: eventIdentity,
    dripjobs_sales_deal_id: row.dealId,
    status: row.leadStatus,
    pipeline_stage_raw: row.dealStage,
    source: row.rawSource,
    normalized_channel: row.normalizedChannel,
    created_at: createdAt.value,
    captured_at: importedAt,
    updated_at: importedAt,
    metadata: {
      source: "dripjobs_sales_list_recovery",
      created_at_method: createdAt.method,
      created_at_confidence: createdAt.confidence,
      dripjobs_sales_list_authority: authority,
    },
  }));
  resultData(`verify recovered lead ${leadId}`, await db.from("verification_events").upsert({
    id: stableUuid(`verification:dripjobs-sales-list-recovery:${validation.manifest.source_sha256}:${leadId}`),
    entity_type: "lead",
    entity_id: leadId,
    action: "dripjobs_sales_list_lead_recovered",
    reason: "The exact current DripJobs Sales List row was missing from live lead events; Hermes recovered it from exact Deal and Contact IDs and marked its Deal Age creation time as estimated.",
    old_values: null,
    new_values: { status: row.leadStatus, pipeline_stage_raw: row.dealStage, source: row.rawSource, normalized_channel: row.normalizedChannel, dripjobs_sales_deal_id: row.dealId },
    evidence: { authority, created_at: createdAt, source_document_id: document.id },
    occurred_at: importedAt,
  }, { onConflict: "id" }));
  recovered.push({ id: leadId, row });
}

const applied = [];
for (const item of planned) {
  const freshLead = resultData(`fresh lead ${item.lead.id}`, await db.from("leads").select("*").eq("id", item.lead.id).single());
  assert(freshLead.updated_at === item.lead.updated_at, `Lead ${item.lead.id} changed during the Sales List import.`);
  const document = sourceByView.get(item.row.view);
  const authority = authorityFor(item.row, item.matchMethod, document);
  const updated = resultData(`update lead ${item.lead.id}`, await db.from("leads").update({
    dripjobs_sales_deal_id: item.row.dealId,
    status: item.nextStatus,
    pipeline_stage_raw: item.row.dealStage,
    source: item.nextSource,
    normalized_channel: item.nextChannel,
    captured_at: importedAt,
    metadata: { ...(freshLead.metadata ?? {}), dripjobs_sales_list_authority: authority },
    updated_at: importedAt,
  }).eq("id", item.lead.id).eq("updated_at", freshLead.updated_at).select("id"));
  assert(updated?.length === 1, `Lead ${item.lead.id} concurrency update failed.`);
  resultData(`verify lead ${item.lead.id}`, await db.from("verification_events").upsert({
    id: stableUuid(`verification:dripjobs-sales-list:${validation.manifest.source_sha256}:${item.lead.id}`),
    entity_type: "lead",
    entity_id: item.lead.id,
    action: "dripjobs_sales_list_synced",
    reason: "Daily Hermes Sales List sync refreshed exact Deal ID pipeline and acquisition fields without fuzzy contact matching.",
    old_values: {
      status: item.lead.status,
      pipeline_stage_raw: item.lead.pipeline_stage_raw,
      source: item.lead.source,
      normalized_channel: item.lead.normalized_channel,
      dripjobs_sales_deal_id: item.lead.dripjobs_sales_deal_id ?? null,
    },
    new_values: {
      status: item.nextStatus,
      pipeline_stage_raw: item.row.dealStage,
      source: item.nextSource,
      normalized_channel: item.nextChannel,
      dripjobs_sales_deal_id: item.row.dealId,
    },
    evidence: { authority, source_document_id: document.id },
    occurred_at: importedAt,
  }, { onConflict: "id" }));
  applied.push(item);
}

const leadIdByDealId = new Map(resolved.map((item) => [item.row.dealId, item.lead.id]));
for (const item of recovered) leadIdByDealId.set(item.row.dealId, item.id);
const dealRecords = validation.rows.map((row) => {
  const document = sourceByView.get(row.view);
  const sourceCapture = row.view === "active" ? validation.active.capturedAt : validation.archived.capturedAt;
  const estimatedCreatedAt = estimatedLeadCreatedAt(row, sourceCapture);
  const normalizedEmail = row.email ? row.email.trim().toLocaleLowerCase("en-CA") : null;
  const normalizedPhone = String(row.phone ?? "").replace(/[^0-9]+/g, "") || null;
  return {
    deal_id: row.dealId,
    dripjobs_contact_id: row.contactId,
    lead_id: leadIdByDealId.get(row.dealId) ?? existingDealsById.get(row.dealId)?.lead_id ?? null,
    source_document_id: document.id,
    source_view: row.view,
    sales_status: row.status,
    label: row.label,
    customer_name: row.customer,
    email: row.email,
    phone: row.phone,
    normalized_email: normalizedEmail,
    normalized_phone: normalizedPhone,
    raw_source: row.rawSource,
    normalized_channel: row.normalizedChannel,
    deal_name: row.dealName,
    deal_stage: row.dealStage,
    deal_amount_cents: row.dealAmountCents,
    last_change: row.lastChange,
    deal_age: row.dealAge,
    salesperson: row.salesperson,
    estimated_created_at: estimatedCreatedAt.value,
    created_at_method: estimatedCreatedAt.method,
    created_at_confidence: estimatedCreatedAt.confidence,
    captured_at: sourceCapture,
    source_sha256: document.sha256,
    combined_source_sha256: validation.manifest.source_sha256,
    source_row_number: row.rowNumber,
    last_seen_at: importedAt,
    metadata: {
      source_type: validation.manifest.source_type,
      exact_identity: "DripJobs Deal ID from both the row checkbox and deal href",
      created_at_is_estimated: true,
    },
    updated_at: importedAt,
  };
});
for (let offset = 0; offset < dealRecords.length; offset += 250) {
  const batch = dealRecords.slice(offset, offset + 250);
  const persisted = resultData(`persist Sales List deals ${offset + 1}-${offset + batch.length}`, await db
    .from("dripjobs_sales_deals")
    .upsert(batch, { onConflict: "deal_id" })
    .select("deal_id"));
  assert(persisted?.length === batch.length, `Only ${persisted?.length ?? 0}/${batch.length} Sales List deals persisted in batch ${offset + 1}.`);
}
for (const [view, expected] of [["active", validation.active.rows.length], ["archived", validation.archived.rows.length]]) {
  const verification = await db
    .from("dripjobs_sales_deals")
    .select("deal_id", { count: "exact", head: true })
    .eq("combined_source_sha256", validation.manifest.source_sha256)
    .eq("source_view", view);
  if (verification.error) throw new Error(`verify ${view} persisted Sales List deals: ${verification.error.message}`);
  assert(verification.count === expected, `Persisted ${view} Sales List count ${verification.count ?? 0} does not match ${expected}.`);
}
const unlinkedDeals = dealRecords.filter((deal) => !deal.lead_id).length;
const canonicalCountResult = await db.from("dripjobs_sales_deals").select("deal_id", { count: "exact", head: true });
if (canonicalCountResult.error) throw new Error(`verify canonical Sales List count: ${canonicalCountResult.error.message}`);
const canonicalDealCount = Number(canonicalCountResult.count || 0);
assert(canonicalDealCount >= dealRecords.length, `Canonical Sales List count ${canonicalDealCount} is smaller than the imported ${dealRecords.length} rows.`);

if (applied.length) {
  const verified = [];
  for (let offset = 0; offset < applied.length; offset += 200) {
    const batchIds = applied.slice(offset, offset + 200).map((item) => item.lead.id);
    verified.push(...(resultData(`updated leads verification ${offset + 1}-${offset + batchIds.length}`, await db
      .from("leads")
      .select("id,dripjobs_sales_deal_id,status,pipeline_stage_raw,source,normalized_channel,metadata")
      .in("id", batchIds)) ?? []));
  }
  const verifiedById = new Map(verified.map((lead) => [lead.id, lead]));
  for (const item of applied) {
    const lead = verifiedById.get(item.lead.id);
    assert(lead?.status === item.nextStatus, `Lead ${item.lead.id} status verification failed.`);
    assert(lead?.dripjobs_sales_deal_id === item.row.dealId, `Lead ${item.lead.id} Sales Deal ID verification failed.`);
    assert(lead?.pipeline_stage_raw === item.row.dealStage, `Lead ${item.lead.id} stage verification failed.`);
    assert(lead?.normalized_channel === item.nextChannel, `Lead ${item.lead.id} channel verification failed.`);
    assert(authorityEquivalent(lead?.metadata?.dripjobs_sales_list_authority, item.row, validation.manifest.source_type), `Lead ${item.lead.id} authority verification failed.`);
  }
}

console.log(JSON.stringify({
  status: "verified",
  source_sha256: validation.manifest.source_sha256,
  source_document_ids: sourceDocuments.map((document) => document.id),
  applied_leads: applied.length + recovered.length,
  recovered_active_leads: recovered.length,
  applied_value_changes: applied.filter((item) => item.valueChanged).length + recovered.length,
  applied_authority_refreshes: applied.filter((item) => item.authorityRefresh).length,
  persisted_deals: dealRecords.length,
  canonical_deal_count: canonicalDealCount,
  linked_deals: dealRecords.length - unlinkedDeals,
  unlinked_deals: unlinkedDeals,
  missing_archived_unchanged: missingArchived.length,
  missing_active: unrecoverableActive.length,
  summary_only: SUMMARY_ONLY,
}, null, JSON_ONLY ? 0 : 2));
