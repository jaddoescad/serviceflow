import crypto from "node:crypto";

import { normalizeDripJobsLeadChannel } from "./dripjobs-sales-list.mjs";

const AUGUST_2026_PERIOD_START = "2026-08-01";
const AUGUST_2026_PERIOD_END = "2026-08-31";
const AUGUST_2026_QUALIFIED_PROPOSALS = 75;
const AUGUST_2026_ACCEPTED_PROPOSALS = 13;

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "period_start",
  "period_end",
  "qualified_proposals_count",
  "accepted_proposals_count",
  "jobs_won_count",
  "captured_at",
  "source_url",
  "company_timezone",
  "capture_method",
  "rows",
]);

const ROW_FIELD_ALIASES = Object.freeze({
  sourceRowNumber: ["source_row_number", "sourceRowNumber"],
  jobId: ["job_id", "jobId", "job_uuid", "jobUuid", "dripjobs_job_id"],
  contactId: ["contact_id", "contactId", "contact_uuid", "contactUuid", "dripjobs_contact_id"],
  proposalId: ["proposal_id", "proposalId"],
  sentOn: ["sent_on", "sentOn"],
  rawSource: ["raw_source", "rawSource", "lead_source", "leadSource"],
  normalizedChannel: ["normalized_channel", "normalizedChannel"],
  appointmentLinked: ["appointment_linked", "appointmentLinked"],
  reportStatus: ["report_status", "reportStatus", "status"],
  acceptanceMethod: ["acceptance_method", "acceptanceMethod"],
  isAccepted: ["is_accepted", "isAccepted"],
  proposalValueCents: ["proposal_value_cents", "proposalValueCents"],
  deliveryMethod: ["delivery_method", "deliveryMethod"],
});

const ALLOWED_ROW_KEYS = new Set(Object.values(ROW_FIELD_ALIASES).flat());
function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function exactObject(value, label) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value;
}

function rejectUnknownKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) fail(`${label} contains unsupported fields: ${unknown.sort().join(", ")}`);
}

function aliasValue(row, field, label, { optional = false } = {}) {
  const present = ROW_FIELD_ALIASES[field].filter((key) => Object.hasOwn(row, key));
  if (present.length > 1) fail(`${label} supplies duplicate aliases for ${field}`);
  if (!present.length) {
    if (optional) return null;
    fail(`${label} is missing ${ROW_FIELD_ALIASES[field][0]}`);
  }
  return row[present[0]];
}

function boundedText(value, label, maximum, { allowEmpty = false } = {}) {
  assert(typeof value === "string", `${label} must be text`);
  const text = value.trim();
  if (!allowEmpty && !text) fail(`${label} is empty`);
  if (text.length > maximum) fail(`${label} exceeds ${maximum} characters`);
  return text;
}

function exactDate(value, label) {
  const text = boundedText(value, label, 10);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(text), `${label} must be YYYY-MM-DD`);
  const parsed = new Date(`${text}T12:00:00Z`);
  assert(!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text, `${label} is not a real date`);
  return text;
}

function exactTimestamp(value, label) {
  const text = boundedText(value, label, 80);
  assert(/(?:Z|[+-]\d{2}:\d{2})$/i.test(text), `${label} must include an explicit timezone`);
  assert(!Number.isNaN(Date.parse(text)), `${label} is not a valid timestamp`);
  return new Date(text).toISOString();
}

function nonnegativeInteger(value, label) {
  const number = Number(value);
  assert(Number.isSafeInteger(number) && number >= 0, `${label} must be a non-negative safe integer`);
  return number;
}

function normalizeHexId(value, label) {
  const text = boundedText(value, label, 80).toLocaleLowerCase("en-CA");
  assert(/^[0-9a-f]{20,80}$/.test(text), `${label} must be a 20-80 character hexadecimal DripJobs ID`);
  return text;
}

function normalizeProposalId(value, label) {
  if (value == null || value === "") return null;
  const text = String(value).trim();
  assert(/^[0-9]{1,20}$/.test(text), `${label} must contain digits only`);
  return text;
}

function normalizeAcceptanceMethod(value, label) {
  const text = boundedText(String(value ?? ""), label, 80, { allowEmpty: true })
    .toLocaleLowerCase("en-CA")
    .replaceAll("-", "_")
    .replace(/\s+/g, " ");
  if (["", "none", "—", "not accepted"].includes(text)) return "none";
  if (["signed", "accepted (signed)"].includes(text)) return "signed";
  if (["no_signature", "no signature", "accepted (no signature)"].includes(text)) return "no_signature";
  if (["on_site", "on site", "onsite", "accepted (on site)", "accepted (on_site)", "accepted (onsite)"].includes(text)) return "on_site";
  fail(`${label} has unsupported value ${String(value)}`);
}

function canonicalRow(source, index) {
  const label = `Closing-ratio row ${index + 1}`;
  exactObject(source, label);
  rejectUnknownKeys(source, ALLOWED_ROW_KEYS, label);

  const sourceRowNumber = nonnegativeInteger(aliasValue(source, "sourceRowNumber", label), `${label} source_row_number`);
  assert(sourceRowNumber === index + 1, `${label} source_row_number must be ${index + 1}`);
  const rawSource = boundedText(aliasValue(source, "rawSource", label), `${label} raw_source`, 500, { allowEmpty: true });
  const normalizedChannel = boundedText(
    aliasValue(source, "normalizedChannel", label),
    `${label} normalized_channel`,
    40,
  );
  const expectedChannel = normalizeDripJobsLeadChannel(rawSource);
  assert(normalizedChannel === expectedChannel, `${label} normalized_channel must be ${expectedChannel}`);
  const reportStatus = boundedText(aliasValue(source, "reportStatus", label), `${label} report_status`, 40);
  const acceptanceMethod = normalizeAcceptanceMethod(
    aliasValue(source, "acceptanceMethod", label),
    `${label} acceptance_method`,
  );
  const isAccepted = aliasValue(source, "isAccepted", label);
  assert(typeof isAccepted === "boolean", `${label} is_accepted must be boolean`);
  assert(isAccepted === (acceptanceMethod !== "none"), `${label} is_accepted disagrees with acceptance_method`);
  const appointmentLinked = aliasValue(source, "appointmentLinked", label);
  assert(typeof appointmentLinked === "boolean", `${label} appointment_linked must be boolean`);

  const row = {
    source_row_number: sourceRowNumber,
    dripjobs_job_id: normalizeHexId(aliasValue(source, "jobId", label), `${label} job_id`),
    dripjobs_contact_id: normalizeHexId(aliasValue(source, "contactId", label), `${label} contact_id`),
    proposal_id: normalizeProposalId(aliasValue(source, "proposalId", label, { optional: true }), `${label} proposal_id`),
    sent_on: exactDate(aliasValue(source, "sentOn", label), `${label} sent_on`),
    raw_source: rawSource,
    normalized_channel: normalizedChannel,
    appointment_linked: appointmentLinked,
    report_status: reportStatus,
    acceptance_method: acceptanceMethod,
    is_accepted: isAccepted,
    proposal_value_cents: nonnegativeInteger(
      aliasValue(source, "proposalValueCents", label),
      `${label} proposal_value_cents`,
    ),
    delivery_method: boundedText(
      aliasValue(source, "deliveryMethod", label),
      `${label} delivery_method`,
      80,
    ),
  };
  return { ...row, row_sha256: sha256(JSON.stringify(row)) };
}

function summaryRows({ qualifiedCount, acceptedCount, jobsWonCount, rows }) {
  return [
    { metric: "qualified_proposals", count: qualifiedCount },
    { metric: "accepted_proposals", count: acceptedCount },
    { metric: "jobs_won", count: jobsWonCount },
    ...["signed", "no_signature", "on_site", "none"].map((acceptanceMethod) => ({
      acceptance_method: acceptanceMethod,
      count: rows.filter((row) => row.acceptance_method === acceptanceMethod).length,
    })),
  ];
}

export function validateDripJobsClosingRatioCohort(input) {
  const bytes = Buffer.isBuffer(input)
    ? input
    : Buffer.from(typeof input === "string" ? input : JSON.stringify(input), "utf8");
  assert(bytes.length > 0, "Closing-ratio evidence is empty");
  assert(bytes.length <= 5_000_000, "Closing-ratio evidence exceeds 5 MB");
  assert(!bytes.includes(0), "Closing-ratio evidence contains binary data");

  let source;
  try {
    source = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("Closing-ratio evidence is not valid JSON");
  }
  exactObject(source, "Closing-ratio evidence");
  rejectUnknownKeys(source, ALLOWED_TOP_LEVEL_KEYS, "Closing-ratio evidence");

  const periodStart = exactDate(source.period_start, "period_start");
  const periodEnd = exactDate(source.period_end, "period_end");
  assert(periodStart <= periodEnd, "period_start must not be after period_end");
  const qualifiedCount = nonnegativeInteger(source.qualified_proposals_count, "qualified_proposals_count");
  const acceptedCount = nonnegativeInteger(source.accepted_proposals_count, "accepted_proposals_count");
  const jobsWonCount = nonnegativeInteger(source.jobs_won_count, "jobs_won_count");
  assert(acceptedCount <= qualifiedCount, "accepted_proposals_count exceeds qualified_proposals_count");
  assert(Array.isArray(source.rows), "rows must be an array");
  assert(source.rows.length === qualifiedCount, `rows has ${source.rows.length} entries; expected ${qualifiedCount}`);
  assert(source.rows.length <= 10_000, "rows exceeds the 10,000-row safety limit");

  const rows = source.rows.map(canonicalRow);
  const acceptedRows = rows.filter((row) => row.is_accepted).length;
  assert(acceptedRows === acceptedCount, `rows contain ${acceptedRows} accepted proposals; expected ${acceptedCount}`);
  assert(new Set(rows.map((row) => row.dripjobs_job_id)).size === rows.length, "rows contain duplicate DripJobs job IDs");
  assert(new Set(rows.map((row) => row.row_sha256)).size === rows.length, "rows contain duplicate fingerprints");

  if (periodStart === AUGUST_2026_PERIOD_START && periodEnd === AUGUST_2026_PERIOD_END) {
    assert(
      qualifiedCount === AUGUST_2026_QUALIFIED_PROPOSALS,
      `August 2026 must contain exactly ${AUGUST_2026_QUALIFIED_PROPOSALS} qualified proposals`,
    );
    assert(
      acceptedCount === AUGUST_2026_ACCEPTED_PROPOSALS,
      `August 2026 must contain exactly ${AUGUST_2026_ACCEPTED_PROPOSALS} accepted proposals`,
    );
  }

  const capturedAt = exactTimestamp(source.captured_at, "captured_at");
  const sourceUrl = source.source_url == null
    ? null
    : boundedText(source.source_url, "source_url", 2_000);
  if (sourceUrl) {
    let parsedUrl;
    try {
      parsedUrl = new URL(sourceUrl);
    } catch {
      fail("source_url is invalid");
    }
    assert(parsedUrl.protocol === "https:" && parsedUrl.hostname === "app.dripjobs.com", "source_url must be an app.dripjobs.com HTTPS URL");
  }
  const companyTimezone = source.company_timezone == null
    ? "America/Toronto"
    : boundedText(source.company_timezone, "company_timezone", 80);
  assert(companyTimezone === "America/Toronto", "company_timezone must be America/Toronto");
  const captureMethod = source.capture_method == null
    ? "authenticated_total_proposals_report"
    : boundedText(source.capture_method, "capture_method", 160);
  const sourceSha256 = sha256(bytes);

  return {
    sourceSha256,
    rows,
    parent: {
      period_start: periodStart,
      period_end: periodEnd,
      qualified_proposals_count: qualifiedCount,
      accepted_proposals_count: acceptedCount,
      jobs_won_count: jobsWonCount,
      source_sha256: sourceSha256,
      source_rows: summaryRows({ qualifiedCount, acceptedCount, jobsWonCount, rows }),
      metadata: {
        validation_status: "accepted",
        schema_version: 2,
        source_type: "dripjobs_metrics_closing_ratio_rows_v2",
        source_url: sourceUrl,
        source_hash_basis: "SHA-256 of the exact UTF-8 non-PII JSON evidence file bytes",
        company_timezone: companyTimezone,
        capture_method: captureMethod,
        child_row_count: rows.length,
        accepted_child_row_count: acceptedRows,
        privacy_contract: "No names, email addresses, phone numbers, deal names, or proposal labels are accepted.",
      },
      captured_at: capturedAt,
    },
    manifest: {
      period_start: periodStart,
      period_end: periodEnd,
      qualified_proposals_count: qualifiedCount,
      accepted_proposals_count: acceptedCount,
      jobs_won_count: jobsWonCount,
      appointment_proposals_count: rows.filter((row) => row.appointment_linked).length,
      appointment_accepted_proposals_count: rows.filter((row) => row.appointment_linked && row.is_accepted).length,
      paid_social_proposals_count: rows.filter((row) => row.normalized_channel === "paid_social").length,
      paid_social_accepted_proposals_count: rows.filter((row) => row.normalized_channel === "paid_social" && row.is_accepted).length,
      source_sha256: sourceSha256,
      captured_at: capturedAt,
    },
  };
}
