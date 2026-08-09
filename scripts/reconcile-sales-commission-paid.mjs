#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const SUMMARY = process.argv.includes("--summary");
const csvArg = process.argv.find((value) => value.startsWith("--csv="));
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const csvPath = path.resolve(
  csvArg?.slice("--csv=".length) ||
    "/Users/jadslim/Downloads/Ottawa Painters Dashboard - 2026 Profit Sheet.csv",
);
const expectedProjectRef = "bwbckdkouqghdadpkjvn";

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
    ) {
      value = value.slice(1, -1);
    }
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function moneyCents(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[,$\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

function canonicalName(value) {
  let normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/:\s*\$?\s*$/, "")
    .replace(/[^a-z0-9]/g, "");
  const aliases = new Map([
    ["christineleclaire", "christineleclair"],
    ["lauravancleef", "lauravankleef"],
    ["kistyharris", "kirstyharris"],
    ["kirstyjohnson", "kristijohnson"],
    ["mehalymarikanis", "mehalymarinakis"],
  ]);
  normalized = aliases.get(normalized) ?? normalized;
  return normalized;
}

function monthNumber(label) {
  const match = String(label ?? "").match(
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+2026$/i,
  );
  if (!match) return null;
  return (
    [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ].indexOf(match[1].toLowerCase()) + 1
  );
}

function sourceObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let page = 0; page < 100; page += 1) {
    const from = page * pageSize;
    const result = await queryFactory().range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Pagination exceeded 100,000 rows.");
}

function dateMonth(value) {
  const match = String(value ?? "").match(/^2026-(\d{2})-/);
  return match ? Number(match[1]) : null;
}

function circularMonthDistance(left, right) {
  if (left == null || right == null) return 12;
  return Math.abs(left - right);
}

const csvText = readFileSync(csvPath, "utf8");
const csvSha256 = crypto.createHash("sha256").update(csvText).digest("hex");
const parsedRows = parseCsv(csvText);
const paidRows = [];
let currentMonth = null;
let reachedStatistics = false;
for (let index = 0; index < parsedRows.length; index += 1) {
  const values = parsedRows[index].map((value) => value.trim());
  if (values.some((value) => value === "Finished Jobs Statistics")) {
    reachedStatistics = true;
  }
  if (reachedStatistics) continue;
  const parsedMonth = monthNumber(values[0]);
  if (parsedMonth != null) {
    currentMonth = parsedMonth;
    continue;
  }
  const jobName = values[2];
  const revenueCents = moneyCents(values[3]);
  if (
    currentMonth == null ||
    !jobName ||
    ["job name", "totals", "average"].includes(jobName.toLowerCase()) ||
    revenueCents == null ||
    revenueCents <= 0
  ) {
    continue;
  }
  const printedCommissionCents = moneyCents(values[6]);
  const commissionCents =
    printedCommissionCents != null && printedCommissionCents > 0
      ? printedCommissionCents
      : Math.round(revenueCents * 0.06);
  paidRows.push({
    rowNumber: index + 1,
    month: currentMonth,
    printedName: jobName.replace(/:\s*\$?\s*$/, "").trim(),
    canonicalName: canonicalName(jobName),
    revenueCents,
    commissionCents,
    commissionSource:
      printedCommissionCents != null && printedCommissionCents > 0
        ? "printed_csv_sales"
        : "six_percent_of_csv_revenue",
  });
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl =
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== expectedProjectRef) {
  throw new Error(`Refusing reconciliation for unexpected project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [jobs, quotes, invoices, allocations] = await Promise.all([
  fetchAll(() =>
    db
      .from("jobs")
      .select(
        "id,name,status,contract_amount_cents,scheduled_on,started_on,completed_on,source,metadata,accepted_quote_id,updated_at",
      ),
  ),
  fetchAll(() =>
    db
      .from("quotes")
      .select("id,dripjobs_proposal_id,name,amount_cents,accepted_at,metadata"),
  ),
  fetchAll(() =>
    db
      .from("invoices")
      .select(
        "id,invoice_number,status,issued_on,subtotal_cents,tax_cents,total_cents,metadata",
      )
      .eq("direction", "receivable")
      .eq("category", "customer"),
  ),
  fetchAll(() =>
    db
      .from("invoice_job_allocations")
      .select("job_id,invoice_id,subtotal_cents,total_cents,needs_review,metadata"),
  ),
]);

const quoteById = new Map(quotes.map((quote) => [quote.id, quote]));
const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
const invoicesByJob = new Map();
for (const allocation of allocations) {
  const invoice = invoiceById.get(allocation.invoice_id);
  if (!invoice) continue;
  const rows = invoicesByJob.get(allocation.job_id) ?? [];
  rows.push({ invoice, allocation });
  invoicesByJob.set(allocation.job_id, rows);
}

function jobNames(job) {
  const names = new Set([canonicalName(job.name)]);
  for (const { invoice } of invoicesByJob.get(job.id) ?? []) {
    const metadata = sourceObject(invoice.metadata);
    for (const value of [metadata.customer_name, metadata.job_name]) {
      if (value) names.add(canonicalName(value));
    }
  }
  return names;
}

function scoreMatch(row, job) {
  const quote = quoteById.get(job.accepted_quote_id);
  const invoiceRows = invoicesByJob.get(job.id) ?? [];
  const amountEvidence = [
    { kind: "job_contract", cents: Number(job.contract_amount_cents ?? 0) },
    { kind: "accepted_quote", cents: Number(quote?.amount_cents ?? 0) },
    ...invoiceRows.flatMap(({ invoice, allocation }) => [
      { kind: `invoice_${invoice.invoice_number || invoice.id}`, cents: Number(invoice.subtotal_cents ?? 0) },
      { kind: `invoice_allocation_${invoice.invoice_number || invoice.id}`, cents: Number(allocation.subtotal_cents ?? 0) },
    ]),
  ].filter((value) => value.cents > 0);
  const nearestAmount = amountEvidence
    .map((value) => ({ ...value, difference: Math.abs(value.cents - row.revenueCents) }))
    .sort((left, right) => left.difference - right.difference)[0] ?? null;
  const relativeDifference = nearestAmount
    ? nearestAmount.difference / Math.max(row.revenueCents, nearestAmount.cents)
    : 1;
  let amountScore = 0;
  if (nearestAmount?.difference <= 100) amountScore = 100;
  else if (relativeDifference <= 0.01) amountScore = 80;
  else if (relativeDifference <= 0.05) amountScore = 55;
  else if (relativeDifference <= 0.15) amountScore = 25;
  else if (relativeDifference <= 0.3) amountScore = 10;

  const evidenceMonths = [
    dateMonth(job.scheduled_on),
    dateMonth(job.started_on),
    dateMonth(job.completed_on),
    dateMonth(quote?.accepted_at),
    ...invoiceRows.map(({ invoice }) => dateMonth(invoice.issued_on)),
  ].filter((value) => value != null);
  const dateDistance = Math.min(
    ...evidenceMonths.map((value) => circularMonthDistance(row.month, value)),
    12,
  );
  const dateScore = dateDistance === 0 ? 30 : dateDistance === 1 ? 15 : dateDistance === 2 ? 5 : 0;
  const preferredInvoice = invoiceRows
    .map(({ invoice }) => invoice)
    .sort((left, right) => {
      const leftDifference = Math.abs(Number(left.subtotal_cents ?? 0) - row.revenueCents);
      const rightDifference = Math.abs(Number(right.subtotal_cents ?? 0) - row.revenueCents);
      return leftDifference - rightDifference;
    })[0] ?? null;
  return {
    row,
    job,
    quote,
    preferredInvoice,
    nearestAmount,
    relativeDifference,
    dateDistance,
    score: amountScore + dateScore,
  };
}

const jobsByName = new Map();
for (const job of jobs) {
  for (const name of jobNames(job)) {
    const values = jobsByName.get(name) ?? [];
    values.push(job);
    jobsByName.set(name, values);
  }
}

const matches = [];
const unresolved = [];
const orphanPaidRows = [];
const usedJobIds = new Set();
const explicitMissingJobEvidence = new Set(["3:justinwager:1127200"]);
const groupedRows = Map.groupBy(paidRows, (row) => row.canonicalName);
for (const [name, rows] of groupedRows) {
  const candidates = jobsByName.get(name) ?? [];
  const pairs = rows
    .flatMap((row) => candidates.map((job) => scoreMatch(row, job)))
    .sort((left, right) =>
      right.score - left.score ||
      left.relativeDifference - right.relativeDifference ||
      left.dateDistance - right.dateDistance,
    );
  const assignedRows = new Set();
  const assignedJobs = new Set();
  for (const pair of pairs) {
    if (assignedRows.has(pair.row.rowNumber) || assignedJobs.has(pair.job.id)) continue;
    const singleCandidate = rows.length === 1 && candidates.length === 1;
    if (pair.score < 30 && !singleCandidate) continue;
    assignedRows.add(pair.row.rowNumber);
    assignedJobs.add(pair.job.id);
    pair.evidenceRows = [pair.row];
    matches.push(pair);
  }
  for (const row of rows) {
    if (!assignedRows.has(row.rowNumber)) {
      const assignedMatch = matches.find(
        (match) =>
          match.row.canonicalName === name &&
          candidates.length === 1 &&
          match.job.id === candidates[0].id,
      );
      if (assignedMatch) {
        assignedMatch.evidenceRows.push(row);
        const currentHasPrinted =
          assignedMatch.row.commissionSource === "printed_csv_sales";
        if (!currentHasPrinted && row.commissionSource === "printed_csv_sales") {
          assignedMatch.row = row;
        }
        assignedRows.add(row.rowNumber);
        continue;
      }
      const missingEvidenceKey = `${row.month}:${row.canonicalName}:${row.revenueCents}`;
      if (!candidates.length && explicitMissingJobEvidence.has(missingEvidenceKey)) {
        orphanPaidRows.push({
          row,
          reason:
            "Historical paid job is present in the user-confirmed CSV, but no canonical job, quote, contact, or customer invoice exists in the migrated database.",
        });
        assignedRows.add(row.rowNumber);
        continue;
      }
      unresolved.push({
        row,
        candidates: candidates.map((job) => ({
          id: job.id,
          name: job.name,
          status: job.status,
          contractAmountCents: job.contract_amount_cents,
          score: scoreMatch(row, job).score,
        })),
      });
    }
  }
}

for (const match of matches) {
  if (usedJobIds.has(match.job.id)) {
    throw new Error(`Duplicate job assignment detected for ${match.job.id}.`);
  }
  usedJobIds.add(match.job.id);
}

const conflicts = [];
const changes = [];
const alreadyPaid = [];
for (const match of matches) {
  const metadata = sourceObject(match.job.metadata);
  const existingPayment = sourceObject(metadata.sales_commission_payment);
  if (
    existingPayment.status === "paid" &&
    existingPayment.recipient &&
    existingPayment.recipient !== "Scott Madden"
  ) {
    conflicts.push({
      row: match.row,
      jobId: match.job.id,
      jobName: match.job.name,
      existingPayment,
    });
    continue;
  }
  if (existingPayment.status === "paid") {
    alreadyPaid.push({
      row: match.row,
      jobId: match.job.id,
      jobName: match.job.name,
      existingPayment,
    });
    continue;
  }
  const payment = {
    status: "paid",
    recipient: "Scott Madden",
    rate_percent: 6,
    base_before_hst_cents: match.row.revenueCents,
    commission_paid_cents: match.row.commissionCents,
    confirmation_method: "user_confirmed_2026_profit_sheet",
    confirmed_at: new Date().toISOString(),
    evidence: {
      source_filename: path.basename(csvPath),
      source_sha256: csvSha256,
      source_row_number: match.row.rowNumber,
      csv_month: `2026-${String(match.row.month).padStart(2, "0")}`,
      csv_job_name: match.row.printedName,
      csv_revenue_cents: match.row.revenueCents,
      csv_commission_cents: match.row.commissionCents,
      commission_source: match.row.commissionSource,
      matched_invoice_id: match.preferredInvoice?.id ?? null,
      matched_invoice_number: match.preferredInvoice?.invoice_number ?? null,
      matched_invoice_subtotal_cents: match.preferredInvoice?.subtotal_cents ?? null,
      matched_quote_proposal_id: match.quote?.dripjobs_proposal_id ?? null,
      match_amount_evidence: match.nearestAmount,
      match_date_distance_months: match.dateDistance,
      user_confirmed_on: "2026-08-06",
      csv_rows: (match.evidenceRows ?? [match.row]).map((row) => ({
        source_row_number: row.rowNumber,
        csv_month: `2026-${String(row.month).padStart(2, "0")}`,
        csv_job_name: row.printedName,
        csv_revenue_cents: row.revenueCents,
        csv_commission_cents: row.commissionCents,
        commission_source: row.commissionSource,
      })),
    },
  };
  changes.push({
    match,
    oldMetadata: metadata,
    newMetadata: { ...metadata, sales_commission_payment: payment },
    payment,
  });
}

const report = {
  mode: APPLY ? "apply" : "dry-run",
  csv: {
    path: csvPath,
    sha256: csvSha256,
    paidJobRows: paidRows.length,
    commissionCents: paidRows.reduce((sum, row) => sum + row.commissionCents, 0),
  },
  database: {
    jobs: jobs.length,
    customerInvoices: invoices.length,
    invoiceJobAllocations: allocations.length,
  },
  matched: matches.length,
  orphanPaidRows,
  alreadyPaid: alreadyPaid.length,
  changes: changes.length,
  conflicts,
  unresolved,
  candidates: changes.map(({ match, payment }) => ({
    csvRow: match.row.rowNumber,
    month: match.row.month,
    csvName: match.row.printedName,
    jobId: match.job.id,
    jobName: match.job.name,
    jobStatus: match.job.status,
    proposalId: match.quote?.dripjobs_proposal_id ?? null,
    invoiceNumber: match.preferredInvoice?.invoice_number ?? null,
    invoiceSubtotalCents: match.preferredInvoice?.subtotal_cents ?? null,
    csvRevenueCents: payment.base_before_hst_cents,
    commissionPaidCents: payment.commission_paid_cents,
    matchScore: match.score,
    amountEvidence: match.nearestAmount,
    dateDistanceMonths: match.dateDistance,
    evidenceRows: match.evidenceRows?.map((row) => row.rowNumber) ?? [match.row.rowNumber],
  })),
};

console.log(
  JSON.stringify(
    SUMMARY
      ? {
          mode: report.mode,
          csv: report.csv,
          database: report.database,
          matched: report.matched,
          orphanPaidRows: report.orphanPaidRows,
          alreadyPaid: report.alreadyPaid,
          changes: report.changes,
          conflicts: report.conflicts,
          unresolved: report.unresolved,
          lowScoreCandidates: report.candidates.filter(
            (candidate) => candidate.matchScore < 50,
          ),
        }
      : report,
    null,
    2,
  ),
);

if (!APPLY) process.exit(0);
if (unresolved.length || conflicts.length) {
  throw new Error(
    `Refusing apply with ${unresolved.length} unresolved rows and ${conflicts.length} conflicts.`,
  );
}

const orphanEvents = [];
for (const orphan of orphanPaidRows) {
  const entityId = `profit-sheet:${csvSha256}:row:${orphan.row.rowNumber}`;
  const existingResult = await db
    .from("verification_events")
    .select("id")
    .eq("entity_type", "sales_commission_ledger_row")
    .eq("entity_id", entityId)
    .eq("action", "marked_paid")
    .limit(1);
  if (existingResult.error) throw existingResult.error;
  if ((existingResult.data ?? []).length) continue;
  const eventResult = await db.from("verification_events").insert({
    id: crypto.randomUUID(),
    entity_type: "sales_commission_ledger_row",
    entity_id: entityId,
    action: "marked_paid",
    reason: orphan.reason,
    old_values: null,
    new_values: {
      status: "paid",
      recipient: "Scott Madden",
      rate_percent: 6,
      base_before_hst_cents: orphan.row.revenueCents,
      commission_paid_cents: orphan.row.commissionCents,
    },
    evidence: {
      source_filename: path.basename(csvPath),
      source_sha256: csvSha256,
      source_row_number: orphan.row.rowNumber,
      csv_month: `2026-${String(orphan.row.month).padStart(2, "0")}`,
      csv_job_name: orphan.row.printedName,
      user_confirmed_on: "2026-08-06",
      canonical_job_missing: true,
    },
    occurred_at: new Date().toISOString(),
  });
  if (eventResult.error) throw eventResult.error;
  orphanEvents.push(entityId);
}

const applied = [];
for (const change of changes) {
  const now = new Date().toISOString();
  const updateResult = await db
    .from("jobs")
    .update({ metadata: change.newMetadata, updated_at: now })
    .eq("id", change.match.job.id)
    .eq("updated_at", change.match.job.updated_at)
    .select("id,name,metadata,updated_at")
    .maybeSingle();
  if (updateResult.error) throw updateResult.error;
  if (!updateResult.data) {
    throw new Error(`Concurrent job update detected for ${change.match.job.id}.`);
  }
  const eventResult = await db.from("verification_events").insert({
    id: crypto.randomUUID(),
    entity_type: "job_sales_commission",
    entity_id: change.match.job.id,
    action: "marked_paid",
    reason: "User confirmed Scott Madden's 6% sales commission was paid for every job row in the supplied 2026 Profit Sheet.",
    old_values: { sales_commission_payment: change.oldMetadata.sales_commission_payment ?? null },
    new_values: { sales_commission_payment: change.payment },
    evidence: change.payment.evidence,
    occurred_at: now,
  });
  if (eventResult.error) throw eventResult.error;
  applied.push(updateResult.data);
}

const verifiedJobs = [];
for (let index = 0; index < usedJobIds.size; index += 150) {
  const ids = [...usedJobIds].slice(index, index + 150);
  const result = await db.from("jobs").select("id,name,metadata").in("id", ids);
  if (result.error) throw result.error;
  verifiedJobs.push(...(result.data ?? []));
}
const verifiedPaid = verifiedJobs.filter(
  (job) => sourceObject(sourceObject(job.metadata).sales_commission_payment).status === "paid",
);
if (verifiedPaid.length !== usedJobIds.size) {
  throw new Error(
    `Verification failed: ${verifiedPaid.length} of ${usedJobIds.size} matched jobs are marked paid.`,
  );
}

console.log(
  JSON.stringify(
    {
      applied: applied.length,
      alreadyPaid: alreadyPaid.length,
      verifiedPaid: verifiedPaid.length,
      totalMatchedJobs: usedJobIds.size,
      orphanPaidEventsInserted: orphanEvents.length,
    },
    null,
    2,
  ),
);
