import crypto from "node:crypto";

import { normalizeDripJobsLeadChannel } from "./dripjobs-sales-list.mjs";

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "period_start",
  "period_end",
  "captured_at",
  "source_url",
  "rows",
]);
const ALLOWED_ROW_KEYS = new Set([
  "row_number",
  "deal_id",
  "contact_id",
  "lead_source",
  "total_value_cents",
  "status",
  "scheduled_on",
  "record_type",
]);

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

function optionalDate(value, label) {
  if (value == null || value === "" || value === "—") return "";
  return exactDate(value, label);
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

function optionalHexId(value, label) {
  if (value == null || value === "") return null;
  const text = boundedText(String(value), label, 80).toLocaleLowerCase("en-CA");
  assert(/^[0-9a-f]{20,80}$/.test(text), `${label} must be a 20-80 character hexadecimal DripJobs ID`);
  return text;
}

function canonicalRow(source, index) {
  const label = `Sales snapshot row ${index + 1}`;
  exactObject(source, label);
  rejectUnknownKeys(source, ALLOWED_ROW_KEYS, label);
  const rowNumber = nonnegativeInteger(source.row_number, `${label} row_number`);
  assert(rowNumber === index + 1, `${label} row_number must be ${index + 1}`);
  const leadSource = boundedText(source.lead_source, `${label} lead_source`, 500, { allowEmpty: true });
  return {
    row_number: rowNumber,
    deal_id: optionalHexId(source.deal_id, `${label} deal_id`),
    contact_id: optionalHexId(source.contact_id, `${label} contact_id`),
    lead_source: leadSource,
    total_value_cents: nonnegativeInteger(source.total_value_cents, `${label} total_value_cents`),
    status: boundedText(source.status, `${label} status`, 40),
    scheduled_on: optionalDate(source.scheduled_on, `${label} scheduled_on`),
    record_type: boundedText(source.record_type, `${label} record_type`, 40),
  };
}

export function validateDripJobsSalesSnapshot(input) {
  const bytes = Buffer.isBuffer(input)
    ? input
    : Buffer.from(typeof input === "string" ? input : JSON.stringify(input), "utf8");
  assert(bytes.length > 0, "Sales snapshot evidence is empty");
  assert(bytes.length <= 5_000_000, "Sales snapshot evidence exceeds 5 MB");
  assert(!bytes.includes(0), "Sales snapshot evidence contains binary data");

  let source;
  try {
    source = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("Sales snapshot evidence is not valid JSON");
  }
  exactObject(source, "Sales snapshot evidence");
  rejectUnknownKeys(source, ALLOWED_TOP_LEVEL_KEYS, "Sales snapshot evidence");
  const periodStart = exactDate(source.period_start, "period_start");
  const periodEnd = exactDate(source.period_end, "period_end");
  assert(periodStart <= periodEnd, "period_start must not be after period_end");
  assert(Array.isArray(source.rows), "rows must be an array");
  assert(source.rows.length <= 10_000, "rows exceeds the 10,000-row safety limit");
  const rows = source.rows.map(canonicalRow);

  const dealIds = rows.map((row) => row.deal_id).filter(Boolean);
  const contactIds = rows.map((row) => row.contact_id).filter(Boolean);
  assert(new Set(dealIds).size === dealIds.length, "rows contain duplicate DripJobs deal IDs");
  const rowFingerprints = rows.map(({ row_number: _rowNumber, ...row }) => sha256(JSON.stringify(row)));
  assert(new Set(rowFingerprints).size === rows.length, "rows contain duplicate source evidence");
  const grossSalesCents = rows.reduce((total, row) => total + row.total_value_cents, 0);
  assert(Number.isSafeInteger(grossSalesCents), "gross sales cents exceeds JavaScript safe-integer precision");
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
  const sourceSha256 = sha256(bytes);
  const paidSocialRows = rows.filter(
    (row) => normalizeDripJobsLeadChannel(row.lead_source) === "paid_social",
  );

  return {
    sourceSha256,
    rowFingerprints,
    snapshot: {
      period_start: periodStart,
      period_end: periodEnd,
      sales_count: rows.length,
      gross_sales_cents: grossSalesCents,
      source_sha256: sourceSha256,
      source_rows: rows,
      metadata: {
        validation_status: "accepted",
        schema_version: 1,
        source_type: "dripjobs_metrics_sales_rows_v1",
        source_url: sourceUrl,
        source_hash_basis: "SHA-256 of the exact UTF-8 non-PII JSON evidence file bytes",
        source_row_fingerprints: rowFingerprints,
        company_timezone: "America/Toronto",
        capture_method: "authenticated_sales_metrics_report",
        privacy_contract: "No names, email addresses, phone numbers, project names, salesperson names, crew names, or postal codes are accepted.",
      },
      captured_at: capturedAt,
    },
    manifest: {
      period_start: periodStart,
      period_end: periodEnd,
      sales_count: rows.length,
      gross_sales_cents: grossSalesCents,
      paid_social_sales_count: paidSocialRows.length,
      paid_social_gross_sales_cents: paidSocialRows.reduce(
        (total, row) => total + row.total_value_cents,
        0,
      ),
      populated_contact_id_count: contactIds.length,
      source_sha256: sourceSha256,
      captured_at: capturedAt,
    },
  };
}
