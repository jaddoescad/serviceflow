import crypto from "node:crypto";

import { parseCsv, parseMoneyCents } from "./dripjobs-invoice-list.mjs";

export const DRIPJOBS_JOBS_LIST_HEADERS = Object.freeze([
  "Status",
  "Label",
  "Job",
  "Customer Name",
  "Email",
  "Phone Number",
  "Salesperson",
  "Project Manager",
  "Crew",
  "Proposal ID",
  "Invoice ID",
  "Invoice Status",
  "Amount",
  "Paid",
  "Balance",
  "Deal Stage",
  "Deal Stage Date",
  "Proposal Signed Date",
  "Job Scheduled Date",
  "Job Start Date",
  "Job Completion Date",
]);

const ACTIVE_EXCLUDED_STATUSES = new Set(["ARCHIVED", "CANCELLED", "CANCELED"]);
const ARCHIVED_STATUSES = new Set(["ARCHIVED", "CANCELLED", "CANCELED"]);
const MONTH_NUMBER = new Map([
  ["january", 1], ["february", 2], ["march", 3], ["april", 4],
  ["may", 5], ["june", 6], ["july", 7], ["august", 8],
  ["september", 9], ["october", 10], ["november", 11], ["december", 12],
]);

export function jobsListSha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function boundedText(value, label, maximum, { allowEmpty = false } = {}) {
  const text = String(value ?? "").trim();
  if (!allowEmpty && !text) throw new Error(`${label} is empty`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

function parseOptionalMoneyCents(value, label) {
  const text = String(value ?? "").trim();
  if (!text || /^N\/?A$/i.test(text)) return null;
  return parseMoneyCents(text, label);
}

export function normalizeProductionStage(value) {
  const stage = String(value ?? "")
    .trim()
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (["work finished", "work complete", "work completed"].includes(stage)) return "work_complete";
  if (["review request", "review requested"].includes(stage)) return "review_request";
  if (["project complete", "project completed", "job complete", "job completed"].includes(stage)) return "project_complete";
  return null;
}

export function parseDripJobsDate(value, label, { optional = false } = {}) {
  const text = String(value ?? "").trim();
  if (!text || /^N\/?A$/i.test(text) || (optional && /^Accepted without signature$/i.test(text))) {
    if (optional) return null;
    throw new Error(`${label} is empty`);
  }
  let year;
  let month;
  let day;
  let match = text.match(/^(?:[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (match) {
    month = MONTH_NUMBER.get(match[1].toLocaleLowerCase("en-CA"));
    day = Number(match[2]);
    year = Number(match[3]);
  } else {
    match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)?$/i);
    if (match) {
      month = Number(match[1]);
      day = Number(match[2]);
      year = Number(match[3]);
    } else {
      match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (match) {
        year = Number(match[1]);
        month = Number(match[2]);
        day = Number(match[3]);
      }
    }
  }
  if (!year || !month || !day) throw new Error(`${label}: unexpected date format`);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    year < 2010 ||
    year > new Date().getUTCFullYear() + 1
  ) throw new Error(`${label}: invalid date`);
  return date.toISOString().slice(0, 10);
}

function dateIso(year, month, day, label) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) throw new Error(`${label}: invalid date`);
  return date.toISOString().slice(0, 10);
}

function scheduleMonthDay(monthName, dayText, label) {
  const normalizedMonth = String(monthName).toLocaleLowerCase("en-CA");
  const month = MONTH_NUMBER.get(normalizedMonth) ?? [...MONTH_NUMBER.entries()].find(([name]) => name.startsWith(normalizedMonth))?.[1];
  const day = Number(dayText);
  if (!month || !Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error(`${label}: invalid month or day`);
  }
  return { month, day };
}

function daysApart(leftIso, rightIso) {
  return Math.round((Date.parse(`${rightIso}T00:00:00Z`) - Date.parse(`${leftIso}T00:00:00Z`)) / 86_400_000);
}

export function parseDripJobsScheduleRange(value, label, {
  proposalSignedDateIso = null,
  jobStartDateIso = null,
  now = new Date(),
} = {}) {
  const raw = String(value ?? "").trim();
  if (!raw || /^N\/?A$/i.test(raw)) {
    return { raw: raw || null, startDateIso: null, endDateIso: null, parseError: null };
  }
  const match = raw.match(/^[A-Za-z]{3,9}\.?\s+([A-Za-z]+)\s+(\d{1,2})\s+-\s+[A-Za-z]{3,9}\.?\s+([A-Za-z]+)\s+(\d{1,2})$/);
  if (!match) return { raw, startDateIso: null, endDateIso: null, parseError: "unexpected schedule range format" };

  try {
    const start = scheduleMonthDay(match[1], match[2], label);
    const end = scheduleMonthDay(match[3], match[4], label);
    const anchorIso = jobStartDateIso || proposalSignedDateIso || now.toISOString().slice(0, 10);
    const anchorYear = Number(anchorIso.slice(0, 4));
    const candidates = [];
    for (let year = anchorYear - 1; year <= anchorYear + 2; year += 1) {
      const candidate = dateIso(year, start.month, start.day, label);
      const distance = daysApart(anchorIso, candidate);
      let score;
      if (jobStartDateIso) score = Math.abs(distance);
      else if (proposalSignedDateIso) score = distance >= -7 ? distance : 10_000 + Math.abs(distance);
      else score = distance >= -183 && distance <= 550 ? Math.abs(distance) : 10_000 + Math.abs(distance);
      candidates.push({ candidate, year, score });
    }
    candidates.sort((left, right) => left.score - right.score || left.candidate.localeCompare(right.candidate));
    const selected = candidates[0];
    let endYear = selected.year;
    if (end.month < start.month || (end.month === start.month && end.day < start.day)) endYear += 1;
    const endDateIso = dateIso(endYear, end.month, end.day, label);
    const durationDays = daysApart(selected.candidate, endDateIso);
    if (durationDays < 0 || durationDays > 45) {
      return { raw, startDateIso: null, endDateIso: null, parseError: `schedule range spans ${durationDays} days` };
    }
    return { raw, startDateIso: selected.candidate, endDateIso, parseError: null };
  } catch (error) {
    return { raw, startDateIso: null, endDateIso: null, parseError: String(error?.message || error) };
  }
}

export function productionMonthForStage(stage, stageDate, label = "Deal Stage Date") {
  const normalizedStage = normalizeProductionStage(stage);
  if (!normalizedStage) return { normalizedStage: null, stageDateIso: null, productionMonth: null };
  const stageDateIso = parseDripJobsDate(stageDate, label);
  return {
    normalizedStage,
    stageDateIso,
    productionMonth: `${stageDateIso.slice(0, 7)}-01`,
  };
}

function assertInvoiceArithmetic(row, label) {
  if (row.grossCents <= 0) throw new Error(`${label}: amount must be positive`);
  if (row.invoiceId == null) return;
  if (row.paidCents == null || row.balanceCents == null) {
    throw new Error(`${label}: invoice rows require paid and balance values`);
  }
  if (row.paidCents < 0) throw new Error(`${label}: paid amount cannot be negative`);
  if (Math.abs(row.paidCents + row.balanceCents - row.grossCents) > 1) {
    throw new Error(`${label}: paid plus balance does not equal amount`);
  }
}

export function validateDripJobsJobsList(input, {
  view,
  minimumBytes = 512,
  minimumRows = view === "archived" ? 50 : 25,
  maximumRows = 10_000,
  now = new Date(),
} = {}) {
  if (!["active", "archived"].includes(view)) throw new Error("Jobs List view must be active or archived");
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input), "utf8");
  if (bytes.length < minimumBytes) throw new Error(`${view} Jobs List is too small to be complete`);
  if (bytes.length > 5_000_000) throw new Error(`${view} Jobs List exceeds the 5 MB limit`);
  if (bytes.includes(0)) throw new Error(`${view} Jobs List contains binary data instead of CSV text`);
  const text = bytes.toString("utf8").replace(/^\uFEFF/, "");
  const parsed = parseCsv(text);
  const headers = parsed[0] ?? [];
  if (JSON.stringify(headers) !== JSON.stringify(DRIPJOBS_JOBS_LIST_HEADERS)) {
    throw new Error(`unexpected ${view} Jobs List headers: ${JSON.stringify(headers)}`);
  }
  const valuesRows = parsed.slice(1).filter((values) => values.some((value) => String(value).trim()));
  if (valuesRows.length < minimumRows) throw new Error(`${view} Jobs List has only ${valuesRows.length} rows`);
  if (valuesRows.length > maximumRows) throw new Error(`${view} Jobs List has ${valuesRows.length} rows; maximum is ${maximumRows}`);

  const proposalIds = new Set();
  const rows = valuesRows.map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) throw new Error(`${view} CSV row ${rowNumber} has ${values.length} columns`);
    const source = Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    const status = boundedText(source.Status, `${view} CSV row ${rowNumber} Status`, 40).toUpperCase();
    if (!/^[A-Z][A-Z _-]*$/.test(status)) throw new Error(`${view} CSV row ${rowNumber}: invalid status`);
    if (view === "active" && ACTIVE_EXCLUDED_STATUSES.has(status)) {
      throw new Error(`active Jobs List contains ${status}; Show Archived was not off`);
    }
    if (view === "archived" && !ARCHIVED_STATUSES.has(status)) {
      throw new Error(`archived Jobs List contains ${status}; Show Archived was not on`);
    }
    const proposalId = boundedText(source["Proposal ID"], `${view} CSV row ${rowNumber} Proposal ID`, 80).replace(/^#/, "");
    if (!/^\d+$/.test(proposalId)) throw new Error(`${view} CSV row ${rowNumber}: Proposal ID must be numeric`);
    if (proposalIds.has(proposalId)) throw new Error(`${view} CSV row ${rowNumber}: duplicate Proposal ID ${proposalId}`);
    proposalIds.add(proposalId);
    const rawInvoiceId = boundedText(source["Invoice ID"], `${view} CSV row ${rowNumber} Invoice ID`, 80, { allowEmpty: true }).replace(/^#/, "");
    const invoiceId = !rawInvoiceId || /^N\/?A$/i.test(rawInvoiceId) ? null : rawInvoiceId;
    if (invoiceId && !/^\d+$/.test(invoiceId)) throw new Error(`${view} CSV row ${rowNumber}: Invoice ID must be numeric`);
    const grossCents = parseMoneyCents(source.Amount, `${view} CSV row ${rowNumber} Amount`);
    const paidCents = parseOptionalMoneyCents(source.Paid, `${view} CSV row ${rowNumber} Paid`);
    const balanceCents = parseOptionalMoneyCents(source.Balance, `${view} CSV row ${rowNumber} Balance`);
    const dealStage = boundedText(source["Deal Stage"], `${view} CSV row ${rowNumber} Deal Stage`, 100);
    const dealStageDate = boundedText(source["Deal Stage Date"], `${view} CSV row ${rowNumber} Deal Stage Date`, 100);
    const production = productionMonthForStage(dealStage, dealStageDate, `${view} CSV row ${rowNumber} Deal Stage Date`);
    const dealStageDateIso = production.stageDateIso ?? parseDripJobsDate(dealStageDate, `${view} CSV row ${rowNumber} Deal Stage Date`);
    const proposalSignedDateIso = parseDripJobsDate(source["Proposal Signed Date"], `${view} CSV row ${rowNumber} Proposal Signed Date`, { optional: true });
    const jobStartDateIso = parseDripJobsDate(source["Job Start Date"], `${view} CSV row ${rowNumber} Job Start Date`, { optional: true });
    const schedule = parseDripJobsScheduleRange(source["Job Scheduled Date"], `${view} CSV row ${rowNumber} Job Scheduled Date`, {
      proposalSignedDateIso,
      jobStartDateIso,
      now,
    });
    const parsedRow = {
      view,
      rowNumber,
      status,
      label: boundedText(source.Label, `${view} CSV row ${rowNumber} Label`, 160, { allowEmpty: true }) || null,
      jobName: boundedText(source.Job, `${view} CSV row ${rowNumber} Job`, 300),
      customer: boundedText(source["Customer Name"], `${view} CSV row ${rowNumber} Customer Name`, 300),
      salesperson: boundedText(source.Salesperson, `${view} CSV row ${rowNumber} Salesperson`, 160, { allowEmpty: true }) || null,
      projectManager: boundedText(source["Project Manager"], `${view} CSV row ${rowNumber} Project Manager`, 160, { allowEmpty: true }) || null,
      crew: boundedText(source.Crew, `${view} CSV row ${rowNumber} Crew`, 300, { allowEmpty: true }) || null,
      proposalId,
      invoiceId,
      invoiceStatus: boundedText(source["Invoice Status"], `${view} CSV row ${rowNumber} Invoice Status`, 80, { allowEmpty: true }) || null,
      grossCents,
      paidCents,
      balanceCents,
      beforeHstCents: Math.round(grossCents / 1.13),
      impliedHstCents: grossCents - Math.round(grossCents / 1.13),
      dealStage,
      dealStageDate,
      dealStageDateIso,
      normalizedProductionStage: production.normalizedStage,
      productionMonth: production.productionMonth,
      proposalSignedDateIso,
      jobScheduledDateRaw: schedule.raw,
      scheduledStartDateIso: schedule.startDateIso,
      scheduledEndDateIso: schedule.endDateIso,
      scheduleParseError: schedule.parseError,
      jobStartDateIso,
      jobCompletionDateIso: parseDripJobsDate(source["Job Completion Date"], `${view} CSV row ${rowNumber} Job Completion Date`, { optional: true }),
    };
    assertInvoiceArithmetic(parsedRow, `${view} CSV row ${rowNumber}`);
    if (Date.parse(`${dealStageDateIso}T00:00:00Z`) > now.getTime() + 48 * 60 * 60 * 1000) {
      throw new Error(`${view} CSV row ${rowNumber}: Deal Stage Date is more than two days in the future`);
    }
    return parsedRow;
  });
  return { view, headers, rows, bytes, sourceSha256: jobsListSha256(bytes) };
}

export function validateDripJobsJobsExports({ active, archived }, {
  previousManifest = null,
  now = new Date(),
  minimumTotalRows = 100,
  validatorOptions = {},
} = {}) {
  const activeResult = validateDripJobsJobsList(active, { view: "active", now, ...validatorOptions.active });
  const archivedResult = validateDripJobsJobsList(archived, { view: "archived", now, ...validatorOptions.archived });
  const rows = [...activeResult.rows, ...archivedResult.rows];
  if (rows.length < minimumTotalRows) throw new Error(`combined Jobs List has only ${rows.length} rows`);
  const proposalIds = new Set();
  for (const row of rows) {
    if (proposalIds.has(row.proposalId)) throw new Error(`Proposal ID ${row.proposalId} appears in both Jobs List views`);
    proposalIds.add(row.proposalId);
  }
  if (!rows.some((row) => row.productionMonth)) throw new Error("combined Jobs List has no qualifying production stages");
  const manifest = {
    schema_version: 1,
    source_type: "dripjobs_jobs_list_all_views_csv",
    accepted_at: now.toISOString(),
    source_sha256: jobsListSha256(`${activeResult.sourceSha256}:${archivedResult.sourceSha256}`),
    active_source_sha256: activeResult.sourceSha256,
    archived_source_sha256: archivedResult.sourceSha256,
    active_row_count: activeResult.rows.length,
    archived_row_count: archivedResult.rows.length,
    row_count: rows.length,
    distinct_proposals: proposalIds.size,
    gross_total_cents: rows.reduce((sum, row) => sum + row.grossCents, 0),
    qualifying_production_rows: rows.filter((row) => row.productionMonth).length,
    scheduled_rows: rows.filter((row) => row.jobScheduledDateRaw).length,
    parsed_schedule_rows: rows.filter((row) => row.scheduledStartDateIso).length,
    schedule_parse_errors: rows.filter((row) => row.scheduleParseError).length,
    proposal_ids: [...proposalIds].sort(),
  };
  if (previousManifest) validateJobsManifestContinuity(manifest, previousManifest);
  return { active: activeResult, archived: archivedResult, rows, manifest };
}

export function validateJobsManifestContinuity(current, previous) {
  if (previous.source_type !== "dripjobs_jobs_list_all_views_csv") {
    throw new Error("previous Jobs List manifest has the wrong source type");
  }
  const previousRows = Number(previous.row_count);
  if (!Number.isInteger(previousRows) || previousRows < 1) throw new Error("previous Jobs List manifest has an invalid row count");
  const allowedDecrease = Math.max(10, Math.ceil(previousRows * 0.1));
  const allowedIncrease = Math.max(50, Math.ceil(previousRows * 0.35));
  if (current.row_count < previousRows - allowedDecrease) throw new Error(`combined row count dropped from ${previousRows} to ${current.row_count}`);
  if (current.row_count > previousRows + allowedIncrease) throw new Error(`combined row count jumped from ${previousRows} to ${current.row_count}`);
  const previousIds = new Set(Array.isArray(previous.proposal_ids) ? previous.proposal_ids.map(String) : []);
  if (previousIds.size !== previousRows) throw new Error("previous Jobs List manifest has an invalid Proposal ID set");
  const overlap = current.proposal_ids.filter((id) => previousIds.has(String(id))).length;
  const requiredOverlap = Math.floor(Math.min(previousRows, current.row_count) * 0.85);
  if (overlap < requiredOverlap) throw new Error(`only ${overlap} Proposal IDs overlap the last accepted export; expected at least ${requiredOverlap}`);
  const previousGross = Number(previous.gross_total_cents);
  if (!Number.isSafeInteger(previousGross) || previousGross <= 0) throw new Error("previous Jobs List manifest has an invalid gross total");
  if (current.gross_total_cents < Math.floor(previousGross * 0.75)) throw new Error("gross job total dropped by more than 25%");
  if (current.gross_total_cents > Math.ceil(previousGross * 1.5)) throw new Error("gross job total increased by more than 50%");
  return true;
}
