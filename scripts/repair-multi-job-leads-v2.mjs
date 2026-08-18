#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import { validateDripJobsJobsExports } from "./lib/dripjobs-jobs-list.mjs";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ACTIVE_CSV = argument("--active=") ?? "/Users/jadslim/Downloads/Jobs_List_20260818_122528.csv";
const ARCHIVED_CSV = argument("--archived=") ?? "/Users/jadslim/Downloads/Jobs_List_20260818_122627.csv";
const repairedAt = new Date().toISOString();

const CASES = Object.freeze([
  { contact: "Ben Javanpour", proposals: ["1908273", "2047974"] },
  { contact: "Carol Anderson", proposals: ["2235938", "1890091"] },
  { contact: "Christine Leclair", proposals: ["2370863", "3006955"] },
  { contact: "Claire Colbert", proposals: ["2425225", "2510231"] },
  { contact: "Corey Parsons", proposals: ["2790181", "2663981"] },
  { contact: "Elizabeth McCrea", proposals: ["2230810", "2230796"] },
  { contact: "Gregg Alexander", proposals: ["2974561", "2484669"] },
  { contact: "Jillian Letts", proposals: ["2473605", "2894053"] },
  { contact: "Laura Van Cleef", proposals: ["2666986", "2413005"] },
  { contact: "Mehaly Marinakis", proposals: ["2846697", "2959424"] },
  { contact: "Paul Harrison", proposals: ["2496838", "2597426"] },
  { contact: "Roxanne Dore", proposals: ["1799093", "1844880"] },
  { contact: "Sheila McSwiggan", proposals: ["3019123", "2140736"] },
  { contact: "Tom Benton", proposals: ["2523918", "2390920"] },
]);

function argument(prefix) {
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function data(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

function normalizedName(value) {
  return String(value ?? "").toLocaleLowerCase("en-CA").replace(/[^a-z0-9]+/g, " ").trim();
}

function proposalHints(metadata) {
  const values = [
    metadata?.proposal_number,
    metadata?.proposal_id,
    metadata?.dripjobs_proposal_id,
    metadata?.source_payload?.["Proposal ID"],
    metadata?.source_payload?.proposal_id,
  ];
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function oldestIdentityDate(record) {
  const candidates = [
    record.quote.accepted_at,
    record.job.started_on,
    record.job.completed_on,
    record.quote.created_at,
    record.job.created_at,
  ].filter(Boolean);
  return candidates.sort()[0] ?? "9999-12-31";
}

function isHistoricalJobLocked(job) {
  return (
    (job.started_on && job.started_on < "2026-06-01") ||
    (!job.started_on && job.completed_on && job.completed_on < "2026-06-01") ||
    (!job.started_on && !job.completed_on && ["completed", "archived"].includes(job.status))
  );
}

function selectRetained(records, originalLead, leadLinks) {
  const candidates = new Set(records.map((record) => record.proposal));
  const hints = proposalHints(originalLead.metadata).filter((proposal) => candidates.has(proposal));
  if (hints.length === 1) {
    return { record: records.find((record) => record.proposal === hints[0]), reason: "lead_metadata_proposal" };
  }
  const exactLinks = leadLinks.filter((link) =>
    candidates.has(String(link.job_proposal_id)) &&
    link.link_status === "confirmed" &&
    link.match_method === "proposal_number"
  );
  if (exactLinks.length === 1) {
    return {
      record: records.find((record) => record.proposal === String(exactLinks[0].job_proposal_id)),
      reason: "confirmed_proposal_number_link",
    };
  }
  const ordered = [...records].sort((left, right) =>
    oldestIdentityDate(left).localeCompare(oldestIdentityDate(right)) ||
    Number(left.proposal) - Number(right.proposal)
  );
  return { record: ordered[0], reason: "earliest_job_identity" };
}

assert(existsSync(ACTIVE_CSV), `Missing active Jobs List: ${ACTIVE_CSV}`);
assert(existsSync(ARCHIVED_CSV), `Missing archived Jobs List: ${ARCHIVED_CSV}`);
const validation = validateDripJobsJobsExports({
  active: readFileSync(ACTIVE_CSV),
  archived: readFileSync(ARCHIVED_CSV),
});
const authorityByProposal = new Map(validation.rows.map((row) => [row.proposalId, row]));
const proposalIds = CASES.flatMap((entry) => entry.proposals);
assert(new Set(proposalIds).size === proposalIds.length, "Repair proposal list contains duplicates.");
for (const entry of CASES) {
  for (const proposal of entry.proposals) {
    const row = authorityByProposal.get(proposal);
    assert(row, `${entry.contact} proposal ${proposal} is absent from the validated Jobs List exports.`);
    assert(normalizedName(row.customer) === normalizedName(entry.contact), `${proposal} no longer belongs to ${entry.contact}.`);
  }
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && secretKey, "Missing Supabase credentials.");
assert(new URL(supabaseUrl).hostname.split(".")[0] === PROJECT_REF, "Unexpected Supabase project.");
const db = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const quoteRows = data("quotes", await db.from("quotes")
  .select("id,lead_id,dripjobs_proposal_id,name,status,amount_cents,tax_cents,accepted_at,valid_until,source,created_at,updated_at,metadata")
  .in("dripjobs_proposal_id", proposalIds));
assert(quoteRows.length === proposalIds.length, `Expected ${proposalIds.length} quotes, found ${quoteRows.length}.`);
const quoteByProposal = new Map(quoteRows.map((quote) => [String(quote.dripjobs_proposal_id), quote]));
const quoteIds = quoteRows.map((quote) => quote.id);
const jobRows = data("jobs", await db.from("jobs")
  .select("id,contact_id,lead_id,accepted_quote_id,name,status,contract_amount_cents,is_feed_visible,formatted_address,address_line_1,address_line_2,city,province,postal_code,scheduled_on,started_on,completed_on,production_month,archived_at,source,created_at,updated_at,metadata")
  .in("accepted_quote_id", quoteIds));
assert(jobRows.length === proposalIds.length, `Expected ${proposalIds.length} jobs, found ${jobRows.length}.`);
const jobByQuote = new Map(jobRows.map((job) => [job.accepted_quote_id, job]));

async function protectedState() {
  const jobIds = jobRows.map((job) => job.id);
  const results = await Promise.all([
    db.from("jobs")
      .select("id,contact_id,accepted_quote_id,name,status,contract_amount_cents,is_feed_visible,formatted_address,address_line_1,address_line_2,city,province,postal_code,scheduled_on,started_on,completed_on,production_month,archived_at,source,created_at")
      .in("id", jobIds).order("id"),
    db.from("quotes")
      .select("id,dripjobs_proposal_id,name,status,amount_cents,tax_cents,accepted_at,valid_until,source,created_at")
      .in("id", quoteIds).order("id"),
    db.from("job_budgets").select("*").in("job_id", jobIds).order("id"),
    db.from("invoice_job_allocations").select("*").in("job_id", jobIds).order("id"),
    db.from("transaction_allocations").select("*").in("job_id", jobIds).order("id"),
    db.from("time_entries").select("*").in("job_id", jobIds).order("id"),
    db.from("job_tasks").select("*").in("job_id", jobIds).order("id"),
  ]);
  const labels = ["jobs", "quotes", "job_budgets", "invoice_job_allocations", "transaction_allocations", "time_entries", "job_tasks"];
  return Object.fromEntries(results.map((result, index) => [labels[index], data(`protected ${labels[index]}`, result)]));
}

const protectedBefore = await protectedState();
const protectedBeforeJson = JSON.stringify(protectedBefore);
const protectedBeforeSha256 = crypto.createHash("sha256").update(protectedBeforeJson).digest("hex");

const allLeadIds = [...new Set([
  ...quoteRows.map((quote) => quote.lead_id),
  ...jobRows.map((job) => job.lead_id),
  ...proposalIds.map((proposal) => stableUuid(`lead:dripjobs-proposal:${proposal}`)),
].filter(Boolean))];
const leadRows = data("leads", await db.from("leads")
  .select("*")
  .in("id", allLeadIds));
const leadById = new Map(leadRows.map((lead) => [lead.id, lead]));
const originalDealIds = [...new Set(leadRows.map((lead) => lead.dripjobs_deal_id).filter(Boolean))];
let leadLinks = [];
if (originalDealIds.length > 0) {
  const leadLinkResult = await db
    .from("marketing_lead_job_links")
    .select("lead_deal_id,job_proposal_id,relationship_type,link_status,match_method,confidence")
    .in("lead_deal_id", originalDealIds);
  if (!leadLinkResult.error) leadLinks = leadLinkResult.data ?? [];
  else if (!/Could not find the table .*marketing_lead_job_links/.test(leadLinkResult.error.message)) {
    throw new Error(`marketing lead job links: ${leadLinkResult.error.message}`);
  }
}
const contactIds = [...new Set(jobRows.map((job) => job.contact_id).filter(Boolean))];
const contacts = data("contacts", await db.from("contacts")
  .select("id,name")
  .in("id", contactIds));
const contactById = new Map(contacts.map((contact) => [contact.id, contact]));
const originalLeadIds = [...new Set(quoteRows.map((quote) => quote.lead_id))];
const [allQuotesOnLeads, allJobsOnLeads, attributionRows, leadMediaRows] = await Promise.all([
  db.from("quotes").select("id,lead_id,dripjobs_proposal_id,status").in("lead_id", originalLeadIds),
  db.from("jobs").select("id,lead_id,accepted_quote_id,status,is_feed_visible").in("lead_id", originalLeadIds),
  db.from("acquisition_attributions").select("id,lead_id,job_id,invoice_id,source_system,normalized_channel,evidence").in("lead_id", originalLeadIds),
  db.from("job_media").select("id,lead_id,job_id,source_provider,source_project_id").in("lead_id", originalLeadIds),
]);
for (const [label, result] of [
  ["all quotes on affected leads", allQuotesOnLeads],
  ["all jobs on affected leads", allJobsOnLeads],
  ["affected acquisition attributions", attributionRows],
  ["affected lead media", leadMediaRows],
]) data(label, result);
const quotesByLead = Map.groupBy(allQuotesOnLeads.data ?? [], (quote) => quote.lead_id);
const jobsByLead = Map.groupBy(allJobsOnLeads.data ?? [], (job) => job.lead_id);
const attributionsByLead = Map.groupBy(attributionRows.data ?? [], (row) => row.lead_id);
const mediaByLead = Map.groupBy(leadMediaRows.data ?? [], (row) => row.lead_id);

const plans = [];
for (const entry of CASES) {
  const records = entry.proposals.map((proposal) => {
    const quote = quoteByProposal.get(proposal);
    assert(quote, `Missing quote ${proposal}.`);
    const job = jobByQuote.get(quote.id);
    assert(job, `Missing job for quote ${proposal}.`);
    const deterministicLeadId = stableUuid(`lead:dripjobs-proposal:${proposal}`);
    assert(
      job.lead_id === quote.lead_id ||
        (isHistoricalJobLocked(job) && quote.lead_id === deterministicLeadId),
      `${entry.contact} proposal ${proposal} job and quote have an unexplained lead mismatch.`,
    );
    assert(job.contact_id, `${entry.contact} proposal ${proposal} has no contact.`);
    assert(normalizedName(contactById.get(job.contact_id)?.name) === normalizedName(entry.contact), `${proposal} contact identity changed.`);
    return { proposal, quote, job, authority: authorityByProposal.get(proposal) };
  });
  assert(new Set(records.map((record) => record.job.contact_id)).size === 1, `${entry.contact} proposals are attached to different contacts.`);

  const derivedRecord = records.find((record) => record.quote.lead_id === stableUuid(`lead:dripjobs-proposal:${record.proposal}`));
  if (derivedRecord) {
    const retained = records.find((record) => record !== derivedRecord);
    assert(retained && retained.quote.lead_id !== derivedRecord.quote.lead_id, `${entry.contact} has an incomplete lead split.`);
    const originalLead = leadById.get(retained.quote.lead_id);
    assert(originalLead, `${entry.contact} retained lead is missing.`);
    const alreadyAnnotated = originalLead.metadata?.multi_job_lead_repair?.separated_lead_id === derivedRecord.quote.lead_id;
    plans.push({
      contact: entry.contact,
      status: alreadyAnnotated ? "already_split" : "needs_split",
      originalLead,
      retained,
      moved: derivedRecord,
      newLeadId: derivedRecord.quote.lead_id,
      selectionReason: alreadyAnnotated ? "existing_deterministic_split" : "resume_deterministic_split",
    });
    continue;
  }

  assert(records[0].quote.lead_id === records[1].quote.lead_id, `${entry.contact} proposals are already on unexpected separate leads.`);
  const originalLead = leadById.get(records[0].quote.lead_id);
  assert(originalLead, `${entry.contact} original lead is missing.`);
  assert(originalLead.contact_id === records[0].job.contact_id, `${entry.contact} lead and jobs have different contacts.`);
  const leadQuotes = quotesByLead.get(originalLead.id) ?? [];
  const leadJobs = jobsByLead.get(originalLead.id) ?? [];
  assert(leadQuotes.length === 2, `${entry.contact} original lead has ${leadQuotes.length} quotes instead of 2.`);
  assert(leadJobs.length === 2, `${entry.contact} original lead has ${leadJobs.length} jobs instead of 2.`);
  assert(new Set(leadQuotes.map((quote) => String(quote.dripjobs_proposal_id))).size === 2, `${entry.contact} lead quote identity is ambiguous.`);
  assert((mediaByLead.get(originalLead.id) ?? []).length === 0, `${entry.contact} has lead-owned media that cannot be assigned safely.`);

  const linkedEvidence = leadLinks.filter((link) => link.lead_deal_id === originalLead.dripjobs_deal_id);
  const retainedSelection = selectRetained(records, originalLead, linkedEvidence);
  const retained = retainedSelection.record;
  const moved = records.find((record) => record !== retained);
  plans.push({
    contact: entry.contact,
    status: "needs_split",
    originalLead,
    retained,
    moved,
    newLeadId: stableUuid(`lead:dripjobs-proposal:${moved.proposal}`),
    selectionReason: retainedSelection.reason,
  });
}

const reportPlan = (plan) => ({
  contact: plan.contact,
  status: plan.status,
  original_lead_id: plan.originalLead?.id ?? null,
  original_dripjobs_deal_id: plan.originalLead?.dripjobs_deal_id ?? null,
  retained_proposal: plan.retained.proposal,
  moved_proposal: plan.moved.proposal,
  new_lead_id: plan.newLeadId,
  selection_reason: plan.selectionReason,
  retained_job_started_on: plan.retained.job.started_on,
  moved_job_started_on: plan.moved.job.started_on,
  retained_view: plan.retained.authority.view,
  moved_view: plan.moved.authority.view,
  moved_job_historical_locked: isHistoricalJobLocked(plan.moved.job),
  attribution_rows_on_original_lead: (attributionsByLead.get(plan.originalLead?.id) ?? []).length,
});

if (!APPLY) {
  console.log(JSON.stringify({
    mode: "dry-run",
    authority: {
      active_file: path.basename(ACTIVE_CSV),
      archived_file: path.basename(ARCHIVED_CSV),
      active_sha256: validation.active.sourceSha256,
      archived_sha256: validation.archived.sourceSha256,
      combined_sha256: validation.manifest.source_sha256,
      active_rows: validation.manifest.active_row_count,
      archived_rows: validation.manifest.archived_row_count,
      distinct_proposals: validation.manifest.distinct_proposals,
    },
    cases: plans.map(reportPlan),
  }, null, 2));
  process.exit(0);
}

for (const plan of plans.filter((entry) => entry.status === "needs_split")) {
  const { originalLead, retained, moved, newLeadId } = plan;
  const sourceFilename = moved.authority.view === "active" ? path.basename(ACTIVE_CSV) : path.basename(ARCHIVED_CSV);
  const sourceSha256 = moved.authority.view === "active" ? validation.active.sourceSha256 : validation.archived.sourceSha256;
  const newLeadMetadata = {
    ...(originalLead.metadata ?? {}),
    proposal_number: moved.proposal,
    dripjobs_proposal_id: moved.proposal,
    derived_from_dripjobs_deal_id: originalLead.dripjobs_deal_id,
    split_from_lead_id: originalLead.id,
    multi_job_lead_repair: {
      schema_version: 1,
      repaired_at: repairedAt,
      reason: "One lead/estimate must represent exactly one DripJobs job.",
      retained_proposal_id: retained.proposal,
      moved_proposal_id: moved.proposal,
      source_filename: sourceFilename,
      source_sha256: sourceSha256,
      combined_source_sha256: validation.manifest.source_sha256,
    },
  };
  const leadWrite = await db.from("leads").upsert({
    id: newLeadId,
    contact_id: originalLead.contact_id,
    dripjobs_deal_id: null,
    status: "won",
    pipeline_stage_raw: moved.authority.dealStage,
    source: originalLead.source,
    normalized_channel: originalLead.normalized_channel,
    address: moved.job.formatted_address || originalLead.address,
    city: moved.job.city || originalLead.city,
    province: moved.job.province || originalLead.province,
    postal_code: moved.job.postal_code || originalLead.postal_code,
    estimate_scheduled_on: originalLead.estimate_scheduled_on,
    estimate_appointment_on: originalLead.estimate_appointment_on,
    is_interior: originalLead.is_interior,
    is_exterior: originalLead.is_exterior,
    is_cabinets: originalLead.is_cabinets,
    created_at: moved.quote.accepted_at || moved.quote.created_at || moved.job.created_at,
    captured_at: originalLead.captured_at,
    updated_at: repairedAt,
    metadata: newLeadMetadata,
  }, { onConflict: "id" }).select("id").single();
  data(`${plan.contact} new lead`, leadWrite);

  if (moved.quote.lead_id === originalLead.id) {
    const quoteWrite = await db.from("quotes")
      .update({
        lead_id: newLeadId,
        metadata: {
          ...(moved.quote.metadata ?? {}),
          previous_lead_id: originalLead.id,
          multi_job_lead_repair: true,
        },
        updated_at: repairedAt,
      })
      .eq("id", moved.quote.id)
      .eq("lead_id", originalLead.id)
      .select("id,lead_id");
    const updatedQuote = data(`${plan.contact} quote`, quoteWrite);
    assert(updatedQuote.length === 1, `${plan.contact} quote was not moved exactly once.`);
  } else {
    assert(moved.quote.lead_id === newLeadId, `${plan.contact} quote is on an unexpected lead.`);
  }

  if (!isHistoricalJobLocked(moved.job)) {
    if (moved.job.lead_id === originalLead.id) {
      const jobWrite = await db.from("jobs")
        .update({
          lead_id: newLeadId,
          metadata: {
            ...(moved.job.metadata ?? {}),
            previous_lead_id: originalLead.id,
            multi_job_lead_repair: true,
          },
          updated_at: repairedAt,
        })
        .eq("id", moved.job.id)
        .eq("lead_id", originalLead.id)
        .select("id,lead_id");
      const updatedJob = data(`${plan.contact} job`, jobWrite);
      assert(updatedJob.length === 1, `${plan.contact} job was not moved exactly once.`);
    } else {
      assert(moved.job.lead_id === newLeadId, `${plan.contact} job is on an unexpected lead.`);
    }
  } else {
    assert(moved.job.lead_id === originalLead.id, `${plan.contact} locked historical job identity changed.`);
  }

  const matchingAttributions = (attributionsByLead.get(originalLead.id) ?? [])
    .filter((row) => row.job_id === moved.job.id);
  for (const attribution of matchingAttributions) {
    const attributionWrite = await db.from("acquisition_attributions")
      .update({
        lead_id: newLeadId,
        evidence: {
          ...(attribution.evidence ?? {}),
          previous_lead_id: originalLead.id,
          multi_job_lead_repair: true,
        },
      })
      .eq("id", attribution.id)
      .eq("lead_id", originalLead.id)
      .select("id");
    assert(data(`${plan.contact} attribution`, attributionWrite).length === 1, `${plan.contact} attribution was not moved exactly once.`);
  }

  const retainedLeadWrite = await db.from("leads")
    .update({
      metadata: {
        ...(originalLead.metadata ?? {}),
        proposal_number: retained.proposal,
        dripjobs_proposal_id: retained.proposal,
        multi_job_lead_repair: {
          schema_version: 1,
          repaired_at: repairedAt,
          retained_proposal_id: retained.proposal,
          separated_proposal_id: moved.proposal,
          separated_lead_id: newLeadId,
          combined_source_sha256: validation.manifest.source_sha256,
        },
      },
      updated_at: repairedAt,
    })
    .eq("id", originalLead.id)
    .select("id");
  assert(data(`${plan.contact} retained lead`, retainedLeadWrite).length === 1, `${plan.contact} retained lead was not annotated.`);

  const eventWrite = await db.from("verification_events").upsert({
    id: stableUuid(`verification:multi-job-lead-split:${originalLead.id}:${moved.proposal}`),
    entity_type: "lead",
    entity_id: newLeadId,
    action: "split_multi_job_lead",
    reason: "A contact may have multiple jobs, but each lead/estimate represents exactly one job.",
    old_values: {
      lead_id: originalLead.id,
      proposal_ids: [retained.proposal, moved.proposal],
      job_ids: [retained.job.id, moved.job.id],
    },
    new_values: {
      retained_lead_id: originalLead.id,
      retained_proposal_id: retained.proposal,
      separated_lead_id: newLeadId,
      separated_proposal_id: moved.proposal,
      separated_job_id: moved.job.id,
      historical_job_row_remained_locked: isHistoricalJobLocked(moved.job),
    },
    evidence: {
      source_type: "dripjobs_jobs_list_all_views_csv",
      active_source_filename: path.basename(ACTIVE_CSV),
      archived_source_filename: path.basename(ARCHIVED_CSV),
      active_source_sha256: validation.active.sourceSha256,
      archived_source_sha256: validation.archived.sourceSha256,
      combined_source_sha256: validation.manifest.source_sha256,
      retained_source_view: retained.authority.view,
      moved_source_view: moved.authority.view,
      selection_reason: plan.selectionReason,
      semantic_job_lead_source: "accepted_quote.lead_id",
      historical_job_row_remained_locked: isHistoricalJobLocked(moved.job),
      accounting_fields_changed: false,
    },
    occurred_at: repairedAt,
  }, { onConflict: "id" });
  data(`${plan.contact} verification event`, eventWrite);
}

const verifiedQuotes = data("verified quotes", await db.from("quotes")
  .select("id,lead_id,dripjobs_proposal_id")
  .in("dripjobs_proposal_id", proposalIds));
const verifiedJobs = data("verified jobs", await db.from("jobs")
  .select("id,lead_id,accepted_quote_id,status,contract_amount_cents,started_on,completed_on,production_month")
  .in("accepted_quote_id", verifiedQuotes.map((quote) => quote.id)));
const verifiedJobByQuote = new Map(verifiedJobs.map((job) => [job.accepted_quote_id, job]));
for (const entry of CASES) {
  const leadIds = entry.proposals.map((proposal) => {
    const quote = verifiedQuotes.find((row) => String(row.dripjobs_proposal_id) === proposal);
    assert(quote, `Verification missing quote ${proposal}.`);
    const job = verifiedJobByQuote.get(quote.id);
    assert(job, `Verification missing job for ${entry.contact} proposal ${proposal}.`);
    assert(
      job.lead_id === quote.lead_id ||
        (isHistoricalJobLocked(job) && quote.lead_id === stableUuid(`lead:dripjobs-proposal:${proposal}`)),
      `Verification failed for ${entry.contact} proposal ${proposal}.`,
    );
    return quote.lead_id;
  });
  assert(new Set(leadIds).size === 2, `${entry.contact} still has two jobs on one lead.`);
}
const protectedAfter = await protectedState();
const protectedAfterJson = JSON.stringify(protectedAfter);
const protectedAfterSha256 = crypto.createHash("sha256").update(protectedAfterJson).digest("hex");
assert(protectedAfterJson === protectedBeforeJson, "Protected accounting, job, quote, date, or production fields changed during the lead split.");

const allConvertedQuotes = data("global converted quote audit", await db.from("quotes")
  .select("id,lead_id,status,job:jobs(id,is_feed_visible)")
  .not("lead_id", "is", null)
  .limit(5000));
const activeJobsByLead = new Map();
for (const quote of allConvertedQuotes) {
  if (["superseded", "declined", "expired"].includes(quote.status)) continue;
  const relatedJobs = Array.isArray(quote.job) ? quote.job : quote.job ? [quote.job] : [];
  for (const job of relatedJobs) {
    if (job.is_feed_visible === false) continue;
    const jobIds = activeJobsByLead.get(quote.lead_id) ?? new Set();
    jobIds.add(job.id);
    activeJobsByLead.set(quote.lead_id, jobIds);
  }
}
const remainingMultiJobLeads = [...activeJobsByLead.entries()]
  .filter(([, jobIds]) => jobIds.size > 1)
  .map(([leadId, jobIds]) => ({ lead_id: leadId, job_count: jobIds.size }));
assert(remainingMultiJobLeads.length === 0, `${remainingMultiJobLeads.length} lead records still resolve to more than one visible job.`);

console.log(JSON.stringify({
  mode: "applied",
  repaired_at: repairedAt,
  changed_cases: plans.filter((entry) => entry.status === "needs_split").length,
  already_split_cases: plans.filter((entry) => entry.status === "already_split").length,
  protected_state_sha256_before: protectedBeforeSha256,
  protected_state_sha256_after: protectedAfterSha256,
  remaining_visible_multi_job_leads: remainingMultiJobLeads.length,
  cases: plans.map(reportPlan),
}, null, 2));
