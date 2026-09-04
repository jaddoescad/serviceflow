#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

import {
  amountAuthorityEquivalent,
  currentAuthorityBudget,
  isCanonicalAuthorityJob,
  jobAccountingLockReason,
  normalizedAuthorityValue,
  operationalAuthorityEquivalent,
  productionMonthDecision,
} from "./lib/dripjobs-job-authority.mjs";
import { validateDripJobsJobsExports } from "./lib/dripjobs-jobs-list.mjs";

const APPLY = process.argv.includes("--apply");
const SUMMARY_ONLY = process.argv.includes("--summary");
const JSON_ONLY = process.argv.includes("--json");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const STORAGE_BUCKET = "material-invoices";
const activeArgument = process.argv.find((value) => value.startsWith("--active-csv="));
const archivedArgument = process.argv.find((value) => value.startsWith("--archived-csv="));
const envArgument = process.argv.find((value) => value.startsWith("--env="));
const ACTIVE_CSV_PATH = path.resolve(activeArgument?.slice("--active-csv=".length) ?? "/Users/jadslim/Downloads/Jobs_List_active.csv");
const ARCHIVED_CSV_PATH = path.resolve(archivedArgument?.slice("--archived-csv=".length) ?? "/Users/jadslim/Downloads/Jobs_List_archived.csv");

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resultData(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

function matchingProposal(job) {
  return String(
    job.metadata?.dripjobs_job_number ??
    job.metadata?.external_proposal_id ??
    job.metadata?.source_payload?.["Proposal ID"] ??
    "",
  ).replace(/^#/, "").trim();
}

function sourceDescriptor(filePath, validated, view) {
  return {
    view,
    path: filePath,
    filename: path.basename(filePath),
    sha256: validated.sourceSha256,
    size_bytes: statSync(filePath).size,
    rows: validated.rows.length,
  };
}

assert(existsSync(ACTIVE_CSV_PATH), `Active Jobs List not found: ${ACTIVE_CSV_PATH}`);
assert(existsSync(ARCHIVED_CSV_PATH), `Archived Jobs List not found: ${ARCHIVED_CSV_PATH}`);
const activeBuffer = readFileSync(ACTIVE_CSV_PATH);
const archivedBuffer = readFileSync(ARCHIVED_CSV_PATH);
const validation = validateDripJobsJobsExports({ active: activeBuffer, archived: archivedBuffer });
const csvRows = validation.rows;

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...(envArgument ? parseEnvFile(path.resolve(envArgument.slice("--env=".length))) : {}),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const backendSecretKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !backendSecretKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Refusing job-authority import for an unexpected Supabase project.");
const db = createClient(supabaseUrl, backendSecretKey, { auth: { persistSession: false, autoRefreshToken: false } });

const [quotesResult, jobsResult, budgetsResult, configResult] = await Promise.all([
  db.from("quotes").select("id,dripjobs_proposal_id"),
  db.from("jobs").select("*"),
  db.from("job_budgets").select("*"),
  db.from("app_config").select("settings").eq("id", "default").single(),
]);
const quotes = resultData("quotes", quotesResult) ?? [];
const jobs = resultData("jobs", jobsResult) ?? [];
const budgets = resultData("job budgets", budgetsResult) ?? [];
const appConfig = resultData("app config", configResult) ?? {};

const quotesByProposal = new Map();
for (const quote of quotes) {
  const key = String(quote.dripjobs_proposal_id ?? "").trim();
  if (!key) continue;
  const values = quotesByProposal.get(key) ?? [];
  values.push(quote);
  quotesByProposal.set(key, values);
}
const jobsByQuote = new Map();
for (const job of jobs) {
  if (!job.accepted_quote_id) continue;
  const values = jobsByQuote.get(job.accepted_quote_id) ?? [];
  values.push(job);
  jobsByQuote.set(job.accepted_quote_id, values);
}
const budgetsByJob = new Map();
for (const budget of budgets) {
  const values = budgetsByJob.get(budget.job_id) ?? [];
  values.push(budget);
  budgetsByJob.set(budget.job_id, values);
}

function matchingJobs(proposalId) {
  const candidates = new Map();
  for (const quote of quotesByProposal.get(proposalId) ?? []) {
    for (const job of jobsByQuote.get(quote.id) ?? []) candidates.set(job.id, job);
  }
  for (const job of jobs) if (matchingProposal(job) === proposalId) candidates.set(job.id, job);
  return [...candidates.values()].filter(isCanonicalAuthorityJob);
}

const eligible = [];
const locked = [];
const unresolved = [];
for (const row of csvRows) {
  const candidates = matchingJobs(row.proposalId);
  if (candidates.length !== 1) {
    unresolved.push({
      proposalId: row.proposalId,
      invoiceId: row.invoiceId,
      customer: row.customer,
      candidateJobIds: candidates.map((job) => job.id),
      reason: candidates.length === 0 ? "no canonical job matched the proposal number" : "more than one canonical job matched the proposal number",
    });
    continue;
  }
  const job = candidates[0];
  const jobBudgets = budgetsByJob.get(job.id) ?? [];
  const currentBudget = currentAuthorityBudget(jobBudgets);
  const currentJobAmountCents = Number(job.contract_amount_cents ?? 0);
  const currentBudgetAmountCents = currentBudget?.amount_including_tax_cents == null ? null : Number(currentBudget.amount_including_tax_cents);
  const monthDecision = productionMonthDecision(job.production_month, row.productionMonth);
  const effectiveProductionMonth = monthDecision.effectiveMonth;
  const budgetProductionMismatch = Boolean(
    effectiveProductionMonth && jobBudgets.some((budget) => String(budget.production_month ?? "").slice(0, 10) !== effectiveProductionMonth),
  );
  const amountValueChanged = currentJobAmountCents !== row.beforeHstCents || currentBudgetAmountCents !== row.beforeHstCents;
  const amountAuthorityRefresh = !amountAuthorityEquivalent(job.metadata?.job_amount_authority, row) || !amountAuthorityEquivalent(currentBudget?.metadata?.job_amount_authority, row);
  const operationalAuthorityRefresh = !operationalAuthorityEquivalent(job.metadata?.dripjobs_operational_authority, row);
  const operationalValueChanged = Boolean(
    (row.scheduledStartDateIso && String(job.scheduled_on ?? "").slice(0, 10) !== row.scheduledStartDateIso) ||
    (row.scheduledEndDateIso && String(job.scheduled_end_on ?? "").slice(0, 10) !== row.scheduledEndDateIso) ||
    (row.jobStartDateIso && String(job.started_on ?? "").slice(0, 10) !== row.jobStartDateIso) ||
    (row.jobCompletionDateIso && String(job.completed_on ?? "").slice(0, 10) !== row.jobCompletionDateIso)
  );
  const item = {
    ...row,
    job,
    jobBudgets,
    currentBudget,
    currentJobAmountCents,
    currentBudgetAmountCents,
    amountValueChanged,
    amountAuthorityRefresh,
    operationalAuthorityRefresh,
    operationalValueChanged,
    monthDecision,
    effectiveProductionMonth,
    productionNeedsApply: monthDecision.apply || budgetProductionMismatch,
  };
  const reason = jobAccountingLockReason({
    ...job,
    started_on: job.started_on ?? row.jobStartDateIso,
    completed_on: job.completed_on ?? row.jobCompletionDateIso,
  });
  if (reason) locked.push({ ...item, lockReason: reason });
  else eligible.push(item);
}

const changed = eligible.filter((item) =>
  item.amountValueChanged ||
  item.amountAuthorityRefresh ||
  item.productionNeedsApply ||
  item.operationalAuthorityRefresh ||
  item.operationalValueChanged
);
const sources = {
  active: sourceDescriptor(ACTIVE_CSV_PATH, validation.active, "active"),
  archived: sourceDescriptor(ARCHIVED_CSV_PATH, validation.archived, "archived"),
  combined_sha256: validation.manifest.source_sha256,
  combined_rows: validation.manifest.row_count,
  gross_amount_semantics: "includes 13% HST",
  stored_job_amount_formula: "round(Amount cents / 1.13)",
  production_month_rule: "assign from the first qualifying Deal Stage Date only when missing; never change an existing production month",
  operational_date_rule: "sync non-empty planned and actual DripJobs dates for current unlocked jobs; never infer application status",
};
const preview = {
  mode: APPLY ? "apply" : "dry-run",
  source: sources,
  counts: {
    csv_rows: csvRows.length,
    distinct_proposals: validation.manifest.distinct_proposals,
    eligible: eligible.length,
    to_apply: changed.length,
    amount_value_changes: changed.filter((item) => item.amountValueChanged).length,
    amount_authority_refreshes: changed.filter((item) => item.amountAuthorityRefresh).length,
    production_month_changes: changed.filter((item) => item.monthDecision.apply).length,
    budget_production_backfills: changed.filter((item) => item.productionNeedsApply && !item.monthDecision.apply).length,
    operational_value_changes: changed.filter((item) => item.operationalValueChanged).length,
    operational_authority_refreshes: changed.filter((item) => item.operationalAuthorityRefresh).length,
    schedule_parse_errors: csvRows.filter((item) => item.scheduleParseError).length,
    already_applied: eligible.length - changed.length,
    historical_locked: locked.length,
    unresolved: unresolved.length,
  },
  candidates: changed.map((item) => ({
    csv_view: item.view,
    csv_row: item.rowNumber,
    proposal_id: item.proposalId,
    invoice_id: item.invoiceId,
    customer: item.customer,
    job_id: item.job.id,
    job_status: item.job.status,
    deal_stage: item.dealStage,
    deal_stage_date: item.dealStageDateIso,
    gross_amount_cents: item.grossCents,
    before_hst_cents: item.beforeHstCents,
    old_job_amount_cents: item.currentJobAmountCents,
    old_budget_amount_cents: item.currentBudgetAmountCents,
    amount_value_changed: item.amountValueChanged,
    amount_authority_refresh: item.amountAuthorityRefresh,
    old_production_month: item.job.production_month,
    candidate_production_month: item.productionMonth,
    effective_production_month: item.effectiveProductionMonth,
    production_month_decision: item.monthDecision.reason,
    production_needs_apply: item.productionNeedsApply,
    old_scheduled_on: item.job.scheduled_on ?? null,
    candidate_scheduled_on: item.scheduledStartDateIso,
    old_scheduled_end_on: item.job.scheduled_end_on ?? null,
    candidate_scheduled_end_on: item.scheduledEndDateIso,
    old_started_on: item.job.started_on ?? null,
    candidate_started_on: item.jobStartDateIso,
    old_completed_on: item.job.completed_on ?? null,
    candidate_completed_on: item.jobCompletionDateIso,
    schedule_parse_error: item.scheduleParseError,
    operational_value_changed: item.operationalValueChanged,
    operational_authority_refresh: item.operationalAuthorityRefresh,
  })),
  historical_locked: locked.map((item) => ({
    csv_view: item.view,
    csv_row: item.rowNumber,
    proposal_id: item.proposalId,
    invoice_id: item.invoiceId,
    customer: item.customer,
    job_id: item.job.id,
    reason: item.lockReason,
  })),
  unresolved,
};
if (!JSON_ONLY || !APPLY) {
  console.log(JSON.stringify(SUMMARY_ONLY ? {
    ...preview,
    candidates: undefined,
    historical_locked: undefined,
    unresolved: preview.unresolved.map((item) => ({ proposal_id: item.proposalId, invoice_id: item.invoiceId, customer: item.customer, reason: item.reason })),
  } : preview, null, JSON_ONLY ? 0 : 2));
}
if (!APPLY) process.exit(0);

const importedAt = new Date().toISOString();
const sourceDocuments = [];
for (const [view, filePath, buffer, validated] of [
  ["active", ACTIVE_CSV_PATH, activeBuffer, validation.active],
  ["archived", ARCHIVED_CSV_PATH, archivedBuffer, validation.archived],
]) {
  const documentId = stableUuid(`document:dripjobs-jobs-list:${validated.sourceSha256}`);
  const storagePath = `job-amount-authority/jobs-list/${validated.sourceSha256.slice(0, 16)}-${path.basename(filePath)}`;
  const upload = await db.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, { contentType: "text/csv", cacheControl: "3600", upsert: false });
  if (upload.error && !String(upload.error.message).toLocaleLowerCase("en-CA").includes("already exists")) throw upload.error;
  resultData(`${view} Jobs List document`, await db.from("documents").upsert({
    id: documentId,
    kind: "job_amount_authority_export",
    original_filename: path.basename(filePath),
    mime_type: "text/csv",
    size_bytes: statSync(filePath).size,
    content_sha256: validated.sourceSha256,
    storage_bucket: STORAGE_BUCKET,
    storage_path: storagePath,
    source_url: "https://app.dripjobs.com/jobs/list",
    captured_at: importedAt,
    metadata: {
      source_type: "dripjobs_jobs_list_all_views_csv",
      view,
      row_count: validated.rows.length,
      combined_source_sha256: validation.manifest.source_sha256,
      gross_amount_semantics: "includes 13% HST",
      stored_job_amount_formula: "round(Amount cents / 1.13)",
      user_confirmed_authority: true,
    },
    created_at: importedAt,
  }, { onConflict: "id" }));
  sourceDocuments.push({ view, id: documentId, sha256: validated.sourceSha256, filename: path.basename(filePath), storagePath });
}

if (changed.length === 0) {
  console.log(JSON.stringify({
    status: "verified",
    source_sha256: validation.manifest.source_sha256,
    source_document_ids: sourceDocuments.map((document) => document.id),
    archived_exports: true,
    applied_jobs: 0,
    applied_amount_changes: 0,
    applied_production_month_changes: 0,
    applied_authority_refreshes: 0,
    applied_operational_value_changes: 0,
    applied_operational_authority_refreshes: 0,
    historical_locked_unchanged: locked.length,
    unresolved_unchanged: unresolved.length,
  }, null, JSON_ONLY ? 0 : 2));
  process.exit(0);
}

const defaultAllocationPercent = Number(appConfig.settings?.labour_budget?.allocation_percent ?? 37);
const defaultHourlyRateCents = Number(appConfig.settings?.labour_budget?.planning_hourly_rate_cents ?? 3500);
assert(defaultHourlyRateCents > 0, "Invalid default labour planning hourly rate.");
const sourceByView = new Map(sourceDocuments.map((document) => [document.view, document]));
const applied = [];

for (const item of changed) {
  const freshJob = resultData(`fresh job ${item.job.id}`, await db.from("jobs").select("*").eq("id", item.job.id).single());
  assert(freshJob.updated_at === item.job.updated_at, `Job ${item.job.id} changed during the import.`);
  assert(!jobAccountingLockReason(freshJob), `Job ${item.job.id} became historically locked.`);
  const freshBudgets = resultData(`fresh budgets ${item.job.id}`, await db.from("job_budgets").select("*").eq("job_id", item.job.id)) ?? [];
  const previousBudget = currentAuthorityBudget(freshBudgets);
  const freshMonthDecision = productionMonthDecision(freshJob.production_month, item.productionMonth);
  const effectiveProductionMonth = freshMonthDecision.effectiveMonth;
  const sourceDocument = sourceByView.get(item.view);
  const amountAuthority = {
    source_type: "dripjobs_jobs_list_all_views_csv",
    source_view: item.view,
    source_filename: sourceDocument.filename,
    source_sha256: sourceDocument.sha256,
    combined_source_sha256: validation.manifest.source_sha256,
    source_document_id: sourceDocument.id,
    csv_row: item.rowNumber,
    proposal_id: item.proposalId,
    invoice_id: item.invoiceId,
    customer: item.customer,
    job_status: item.status,
    invoice_status: item.invoiceStatus,
    gross_amount_cents: item.grossCents,
    paid_cents: item.paidCents,
    balance_cents: item.balanceCents,
    hst_rate: 0.13,
    formula: "round(gross_amount_cents / 1.13)",
    before_hst_cents: item.beforeHstCents,
    implied_hst_cents: item.impliedHstCents,
    imported_at: importedAt,
  };
  const productionAuthority = item.productionMonth ? {
    source_type: "dripjobs_jobs_list_all_views_csv",
    source_view: item.view,
    source_filename: sourceDocument.filename,
    source_sha256: sourceDocument.sha256,
    combined_source_sha256: validation.manifest.source_sha256,
    source_document_id: sourceDocument.id,
    csv_row: item.rowNumber,
    proposal_id: item.proposalId,
    deal_stage: item.dealStage,
    normalized_stage: item.normalizedProductionStage,
    deal_stage_date: item.dealStageDateIso,
    candidate_production_month: item.productionMonth,
    effective_production_month: effectiveProductionMonth,
    rule: "assign from the first qualifying workflow transition only when missing; never change an existing production month",
    imported_at: importedAt,
  } : null;
  const operationalAuthority = {
    source_type: "dripjobs_jobs_list_all_views_csv",
    source_view: item.view,
    source_filename: sourceDocument.filename,
    source_sha256: sourceDocument.sha256,
    combined_source_sha256: validation.manifest.source_sha256,
    source_document_id: sourceDocument.id,
    csv_row: item.rowNumber,
    proposal_id: item.proposalId,
    job_status: item.status,
    label: item.label,
    deal_stage: item.dealStage,
    deal_stage_date: item.dealStageDateIso,
    invoice_id: item.invoiceId,
    invoice_status: item.invoiceStatus,
    paid_cents: item.paidCents,
    balance_cents: item.balanceCents,
    proposal_signed_on: item.proposalSignedDateIso,
    job_schedule_raw: item.jobScheduledDateRaw,
    scheduled_on: item.scheduledStartDateIso,
    scheduled_end_on: item.scheduledEndDateIso,
    schedule_parse_error: item.scheduleParseError,
    started_on: item.jobStartDateIso,
    completed_on: item.jobCompletionDateIso,
    salesperson: item.salesperson,
    project_manager: item.projectManager,
    crew: item.crew,
    imported_at: importedAt,
  };

  let budgetId = previousBudget?.id ?? null;
  if (item.amountValueChanged) {
    const nextVersion = Math.max(0, ...freshBudgets.map((budget) => Number(budget.version))) + 1;
    budgetId = stableUuid(`job-budget:jobs-list:${validation.manifest.source_sha256}:${item.job.id}`);
    const formulaBudget = previousBudget == null || previousBudget.metadata?.budget_minutes_source === "formula" || previousBudget.budget_minutes == null;
    const formulaAllocationPercent = Number(previousBudget?.metadata?.formula_allocation_percent ?? defaultAllocationPercent);
    const formulaHourlyRateCents = Number(previousBudget?.metadata?.formula_hourly_rate_cents ?? previousBudget?.hourly_rate_cents ?? defaultHourlyRateCents);
    const derivedMinutes = Math.round(item.beforeHstCents * (formulaAllocationPercent / 100) * 60 / formulaHourlyRateCents);
    const activeBudgetIds = freshBudgets.filter((budget) => ["manual", "project_budget"].includes(budget.source) && budget.status === "active").map((budget) => budget.id);
    if (activeBudgetIds.length) resultData(`supersede budgets ${item.job.id}`, await db.from("job_budgets").update({ status: "superseded", updated_at: importedAt }).in("id", activeBudgetIds));
    const notes = `Job amount imported from ${sourceDocument.filename} row ${item.rowNumber}: proposal ${item.proposalId}, gross $${(item.grossCents / 100).toFixed(2)} including 13% HST ÷ 1.13 = $${(item.beforeHstCents / 100).toFixed(2)} before HST.`;
    resultData(`insert budget ${item.job.id}`, await db.from("job_budgets").insert({
      id: budgetId,
      job_id: item.job.id,
      quote_id: item.job.accepted_quote_id,
      version: nextVersion,
      status: ["completed", "cancelled", "archived"].includes(normalizedAuthorityValue(item.job.status)) ? "closed" : "active",
      production_month: effectiveProductionMonth,
      budget_minutes: formulaBudget ? derivedMinutes : previousBudget?.budget_minutes ?? null,
      calculated_minutes: formulaBudget ? derivedMinutes : previousBudget?.calculated_minutes ?? previousBudget?.budget_minutes ?? null,
      hourly_rate_cents: formulaBudget ? formulaHourlyRateCents : previousBudget?.hourly_rate_cents ?? null,
      amount_including_tax_cents: item.beforeHstCents,
      labour_allocation_percent: Number(previousBudget?.labour_allocation_percent ?? 40),
      actual_labour_cost_cents: previousBudget?.actual_labour_cost_cents ?? null,
      instructions: previousBudget?.instructions ?? null,
      notes,
      closed_at: previousBudget?.closed_at ?? null,
      closed_by: previousBudget?.closed_by ?? null,
      source: "manual",
      metadata: {
        ...(previousBudget?.metadata ?? {}),
        copied_from_budget_id: previousBudget?.id ?? null,
        previous_notes: previousBudget?.notes ?? null,
        job_amount_authority: amountAuthority,
        ...(productionAuthority ? { production_month_authority: productionAuthority } : {}),
        ...(formulaBudget ? {
          budget_minutes_source: "formula",
          formula_allocation_percent: formulaAllocationPercent,
          formula_hourly_rate_cents: formulaHourlyRateCents,
          formula_amount_cents: item.beforeHstCents,
          formula_updated_at: importedAt,
        } : {}),
      },
      created_at: importedAt,
      updated_at: importedAt,
    }));
  } else if (item.amountAuthorityRefresh && previousBudget) {
    resultData(`refresh budget authority ${item.job.id}`, await db.from("job_budgets").update({
      metadata: { ...(previousBudget.metadata ?? {}), job_amount_authority: amountAuthority },
      updated_at: importedAt,
    }).eq("id", previousBudget.id));
  }

  if (item.productionNeedsApply && effectiveProductionMonth) {
    const budgetIds = freshBudgets.map((budget) => budget.id).filter((id) => id !== budgetId);
    if (budgetIds.length) resultData(`update budget production months ${item.job.id}`, await db.from("job_budgets").update({
      production_month: effectiveProductionMonth,
      updated_at: importedAt,
    }).in("id", budgetIds));
    if (!item.amountValueChanged && budgetId) {
      const latestBudget = resultData(`read current budget ${item.job.id}`, await db.from("job_budgets").select("metadata").eq("id", budgetId).single());
      resultData(`update current budget production month ${item.job.id}`, await db.from("job_budgets").update({
        production_month: effectiveProductionMonth,
        metadata: {
          ...(latestBudget.metadata ?? {}),
          ...(productionAuthority ? { production_month_authority: productionAuthority } : {}),
        },
        updated_at: importedAt,
      }).eq("id", budgetId));
    }
  }

  const jobUpdate = {
    contract_amount_cents: item.beforeHstCents,
    metadata: {
      ...(freshJob.metadata ?? {}),
      job_amount_authority: amountAuthority,
      ...(productionAuthority ? { production_month_authority: productionAuthority } : {}),
      dripjobs_operational_authority: operationalAuthority,
    },
    updated_at: importedAt,
  };
  if (effectiveProductionMonth) jobUpdate.production_month = effectiveProductionMonth;
  if (item.scheduledStartDateIso) jobUpdate.scheduled_on = item.scheduledStartDateIso;
  if (item.scheduledEndDateIso) jobUpdate.scheduled_end_on = item.scheduledEndDateIso;
  if (item.jobStartDateIso) jobUpdate.started_on = item.jobStartDateIso;
  if (item.jobCompletionDateIso) jobUpdate.completed_on = item.jobCompletionDateIso;
  resultData(`update job ${item.job.id}`, await db.from("jobs").update(jobUpdate).eq("id", item.job.id).eq("updated_at", freshJob.updated_at));

  for (const document of sourceDocuments) {
    resultData(`job evidence ${item.job.id} ${document.view}`, await db.from("evidence_links").upsert({
      id: stableUuid(`evidence-link:${document.id}:job:${item.job.id}`),
      document_id: document.id,
      entity_type: "job",
      entity_id: item.job.id,
      evidence_role: "job_amount_authority",
      metadata: { proposal_id: item.proposalId, selected_source_view: item.view, selected_csv_row: item.rowNumber, combined_source_sha256: validation.manifest.source_sha256 },
      created_at: importedAt,
    }, { onConflict: "id" }));
  }
  resultData(`job verification ${item.job.id}`, await db.from("verification_events").upsert({
    id: stableUuid(`verification:job-authority:${validation.manifest.source_sha256}:${item.job.id}`),
    entity_type: "job",
    entity_id: item.job.id,
    action: "job_authority_imported_from_jobs_list",
    reason: "Ottawa Painters directed that DripJobs Jobs List All views are authoritative for before-HST job amount and qualifying production month.",
    old_values: {
      contract_amount_cents: item.currentJobAmountCents,
      budget_id: previousBudget?.id ?? null,
      budget_amount_cents: item.currentBudgetAmountCents,
      production_month: item.job.production_month ?? null,
      scheduled_on: item.job.scheduled_on ?? null,
      scheduled_end_on: item.job.scheduled_end_on ?? null,
      started_on: item.job.started_on ?? null,
      completed_on: item.job.completed_on ?? null,
    },
    new_values: {
      contract_amount_cents: item.beforeHstCents,
      budget_id: budgetId,
      budget_amount_cents: item.beforeHstCents,
      production_month: effectiveProductionMonth,
      scheduled_on: item.scheduledStartDateIso ?? item.job.scheduled_on ?? null,
      scheduled_end_on: item.scheduledEndDateIso ?? item.job.scheduled_end_on ?? null,
      started_on: item.jobStartDateIso ?? item.job.started_on ?? null,
      completed_on: item.jobCompletionDateIso ?? item.job.completed_on ?? null,
    },
    evidence: { amount: amountAuthority, production_month: productionAuthority, operational: operationalAuthority, source_documents: sourceDocuments.map((document) => document.id) },
    occurred_at: importedAt,
  }, { onConflict: "id" }));
  applied.push({ ...item, budgetId, effectiveProductionMonth });
}

const appliedJobIds = applied.map((item) => item.job.id);
const verificationJobs = resultData("updated jobs verification", await db.from("jobs").select("id,contract_amount_cents,production_month,scheduled_on,scheduled_end_on,started_on,completed_on,metadata").in("id", appliedJobIds)) ?? [];
const verificationBudgets = resultData("updated budgets verification", await db.from("job_budgets").select("id,job_id,version,source,status,production_month,amount_including_tax_cents,metadata,updated_at").in("job_id", appliedJobIds)) ?? [];
const verifiedJobById = new Map(verificationJobs.map((job) => [job.id, job]));
const verifiedBudgetsByJob = new Map();
for (const budget of verificationBudgets) {
  const values = verifiedBudgetsByJob.get(budget.job_id) ?? [];
  values.push(budget);
  verifiedBudgetsByJob.set(budget.job_id, values);
}
for (const item of applied) {
  const job = verifiedJobById.get(item.job.id);
  assert(Number(job?.contract_amount_cents) === item.beforeHstCents, `Job ${item.job.id} amount verification failed.`);
  assert(amountAuthorityEquivalent(job?.metadata?.job_amount_authority, item), `Job ${item.job.id} authority verification failed.`);
  assert(operationalAuthorityEquivalent(job?.metadata?.dripjobs_operational_authority, item), `Job ${item.job.id} operational authority verification failed.`);
  if (item.scheduledStartDateIso) assert(String(job?.scheduled_on).slice(0, 10) === item.scheduledStartDateIso, `Job ${item.job.id} scheduled start verification failed.`);
  if (item.scheduledEndDateIso) assert(String(job?.scheduled_end_on).slice(0, 10) === item.scheduledEndDateIso, `Job ${item.job.id} scheduled end verification failed.`);
  if (item.jobStartDateIso) assert(String(job?.started_on).slice(0, 10) === item.jobStartDateIso, `Job ${item.job.id} actual start verification failed.`);
  if (item.jobCompletionDateIso) assert(String(job?.completed_on).slice(0, 10) === item.jobCompletionDateIso, `Job ${item.job.id} actual completion verification failed.`);
  if (item.effectiveProductionMonth) {
    assert(String(job?.production_month).slice(0, 10) === item.effectiveProductionMonth, `Job ${item.job.id} production month verification failed.`);
    for (const budget of verifiedBudgetsByJob.get(item.job.id) ?? []) {
      assert(String(budget.production_month).slice(0, 10) === item.effectiveProductionMonth, `Job ${item.job.id} budget ${budget.id} production month verification failed.`);
    }
  }
  const currentBudget = currentAuthorityBudget(verifiedBudgetsByJob.get(item.job.id) ?? []);
  assert(Number(currentBudget?.amount_including_tax_cents) === item.beforeHstCents, `Job ${item.job.id} current budget amount verification failed.`);
}

console.log(JSON.stringify({
  status: "verified",
  source_sha256: validation.manifest.source_sha256,
  source_document_ids: sourceDocuments.map((document) => document.id),
  applied_jobs: applied.length,
  applied_amount_changes: applied.filter((item) => item.amountValueChanged).length,
  applied_production_month_changes: applied.filter((item) => item.monthDecision.apply).length,
  applied_authority_refreshes: applied.filter((item) => item.amountAuthorityRefresh).length,
  applied_operational_value_changes: applied.filter((item) => item.operationalValueChanged).length,
  applied_operational_authority_refreshes: applied.filter((item) => item.operationalAuthorityRefresh).length,
  historical_locked_unchanged: locked.length,
  unresolved_unchanged: unresolved.length,
  updated: SUMMARY_ONLY ? undefined : applied.map((item) => ({
    job_id: item.job.id,
    customer: item.customer,
    proposal_id: item.proposalId,
    invoice_id: item.invoiceId,
    before_hst_cents: item.beforeHstCents,
    production_month: item.effectiveProductionMonth,
    scheduled_on: item.scheduledStartDateIso,
    scheduled_end_on: item.scheduledEndDateIso,
    started_on: item.jobStartDateIso,
    completed_on: item.jobCompletionDateIso,
    budget_id: item.budgetId,
  })),
}, null, JSON_ONLY ? 0 : 2));
