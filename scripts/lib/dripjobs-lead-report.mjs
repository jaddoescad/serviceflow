import crypto from "node:crypto";

import { normalizeDripJobsLeadChannel } from "./dripjobs-sales-list.mjs";

export const DRIPJOBS_LEAD_REPORT_HEADERS = Object.freeze([
  "First Name",
  "Last Name",
  "Email",
  "Phone",
  "Lead Source",
  "Label",
  "Salesperson",
  "Deal Name",
  "Date Created",
  "Appt Date",
  "Status",
]);

const TEST_TOKEN = /(^|[^a-z0-9])(test|testing|tester|dummy|fake|asdf|qwerty)([^a-z0-9]|$)/i;

export function leadReportSha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function bounded(value, label, maximum, { allowEmpty = false } = {}) {
  const text = String(value ?? "").trim();
  if (!allowEmpty && !text) throw new Error(`${label} is empty`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeLeadReportEmail(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-CA") || null;
}

export function normalizeLeadReportPhone(value) {
  return String(value ?? "").replace(/[^0-9]+/g, "") || null;
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
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("Lead report has an unterminated quoted field");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const [rawHeaders, ...values] = rows;
  if (!rawHeaders) throw new Error("Lead report is empty");
  const headers = rawHeaders.map((header) => header.replace(/^\uFEFF/, "").trim());
  if (JSON.stringify(headers) !== JSON.stringify(DRIPJOBS_LEAD_REPORT_HEADERS)) {
    throw new Error(`unexpected Lead report headers: ${JSON.stringify(headers)}`);
  }
  return values
    .filter((cells) => cells.some((cell) => String(cell ?? "").trim()))
    .map((cells, index) => ({
      sourceRowNumber: index + 2,
      row: Object.fromEntries(headers.map((header, cellIndex) => [header, String(cells[cellIndex] ?? "").trim()])),
    }));
}

export function parseLeadReportDate(value, label) {
  const match = String(value ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error(`${label} must be MM/DD/YYYY`);
  const [, month, day, year] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T12:00:00Z`);
  if (parsed.toISOString().slice(0, 10) !== iso) throw new Error(`${label} is not a real date`);
  return iso;
}

export function parseLeadReportAppointment(value, label) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}) (AM|PM)$/);
  if (!match) throw new Error(`${label} must be MM/DD/YYYY hh:mm AM/PM`);
  const [, month, day, year, rawHour, minute, meridiem] = match;
  let hour = Number(rawHour);
  if (hour < 1 || hour > 12 || Number(minute) > 59) throw new Error(`${label} has an invalid time`);
  if (hour === 12) hour = 0;
  if (meridiem === "PM") hour += 12;
  const date = parseLeadReportDate(`${month}/${day}/${year}`, label);
  return `${date}T${String(hour).padStart(2, "0")}:${minute}:00`;
}

export function classifyLeadReportRow(row) {
  const fullName = normalizeName(`${row.firstName} ${row.lastName}`);
  const email = normalizeLeadReportEmail(row.email) ?? "";
  const search = [fullName, email, normalizeName(row.dealName), normalizeName(row.label)].join(" ");
  const vendorTest = email.endsWith("@dripjobs.com") || fullName === "laura dripjobs";
  const explicitTest =
    fullName === "jad slim" ||
    fullName === "blocked don t book" ||
    fullName.startsWith("codex test") ||
    fullName.startsWith("codex acceptance test") ||
    email.startsWith("meta-acceptance-") ||
    TEST_TOKEN.test(search);
  const migrationBatch =
    row.rawSource === "/https://paintersottawa.com/" &&
    row.createdOn >= "2025-06-18" &&
    row.createdOn <= "2025-06-21";
  const classificationFlags = [
    ...(vendorTest ? ["vendor_test"] : []),
    ...(explicitTest ? ["test"] : []),
    ...(migrationBatch ? ["migration_batch"] : []),
  ];
  if (vendorTest) return { marketingEligible: false, exclusionReason: "vendor_test", classificationFlags };
  if (explicitTest) return { marketingEligible: false, exclusionReason: "test", classificationFlags };
  if (migrationBatch) return { marketingEligible: false, exclusionReason: "migration_batch", classificationFlags };
  return { marketingEligible: true, exclusionReason: null, classificationFlags };
}

export function validateDripJobsLeadReport(input, {
  minimumRows = 100,
  maximumRows = 10_000,
  capturedAt = new Date().toISOString(),
} = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ""), "utf8");
  if (bytes.length < 1_024) throw new Error("Lead report is too small to be complete");
  if (bytes.length > 20_000_000) throw new Error("Lead report exceeds the 20 MB limit");
  const parsed = parseCsv(bytes.toString("utf8"));
  if (parsed.length < minimumRows) throw new Error(`Lead report has only ${parsed.length} rows`);
  if (parsed.length > maximumRows) throw new Error(`Lead report has ${parsed.length} rows; maximum is ${maximumRows}`);
  const rows = parsed.map(({ sourceRowNumber, row }) => {
    const label = `Lead report row ${sourceRowNumber}`;
    const firstName = bounded(row["First Name"], `${label} First Name`, 200);
    const lastName = bounded(row["Last Name"], `${label} Last Name`, 200);
    const email = bounded(row.Email, `${label} Email`, 320, { allowEmpty: true }) || null;
    const phone = bounded(row.Phone, `${label} Phone`, 80, { allowEmpty: true }) || null;
    const rawSource = bounded(row["Lead Source"], `${label} Lead Source`, 500);
    const status = bounded(row.Status, `${label} Status`, 40);
    if (!["Scheduled", "Not Booked"].includes(status)) throw new Error(`${label} has unsupported Status ${status}`);
    const appointmentAtLocal = parseLeadReportAppointment(row["Appt Date"], `${label} Appt Date`);
    if ((status === "Scheduled") !== Boolean(appointmentAtLocal)) {
      throw new Error(`${label} Status and Appt Date disagree`);
    }
    const prepared = {
      sourceRowNumber,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      email,
      phone,
      normalizedEmail: normalizeLeadReportEmail(email),
      normalizedPhone: normalizeLeadReportPhone(phone),
      rawSource,
      normalizedChannel: normalizeDripJobsLeadChannel(rawSource),
      label: bounded(row.Label, `${label} Label`, 200, { allowEmpty: true }) || null,
      salesperson: bounded(row.Salesperson, `${label} Salesperson`, 200),
      dealName: bounded(row["Deal Name"], `${label} Deal Name`, 300, { allowEmpty: true }) || null,
      createdOn: parseLeadReportDate(row["Date Created"], `${label} Date Created`),
      appointmentAtLocal,
      bookingStatus: status,
      sourcePayload: row,
    };
    return {
      ...prepared,
      ...classifyLeadReportRow(prepared),
      rowFingerprint: leadReportSha256(JSON.stringify(row)),
    };
  });
  const createdDates = rows.map((row) => row.createdOn).sort();
  const sourceSha256 = leadReportSha256(bytes);
  return {
    rows,
    bytes,
    sourceSha256,
    capturedAt,
    manifest: {
      schema_version: 1,
      source_type: "dripjobs_lead_report_csv_v1",
      source_sha256: sourceSha256,
      row_count: rows.length,
      scheduled_count: rows.filter((row) => row.bookingStatus === "Scheduled").length,
      marketing_eligible_count: rows.filter((row) => row.marketingEligible).length,
      excluded_test_count: rows.filter((row) => row.exclusionReason === "test").length,
      excluded_vendor_test_count: rows.filter((row) => row.exclusionReason === "vendor_test").length,
      migration_batch_count: rows.filter((row) => row.exclusionReason === "migration_batch").length,
      test_or_vendor_flag_count: rows.filter((row) =>
        row.classificationFlags.includes("test") || row.classificationFlags.includes("vendor_test")
      ).length,
      migration_batch_flag_count: rows.filter((row) => row.classificationFlags.includes("migration_batch")).length,
      first_created_on: createdDates[0],
      last_created_on: createdDates.at(-1),
      captured_at: capturedAt,
    },
  };
}

export function validateLeadReportManifestContinuity(current, previous) {
  if (previous.source_type !== "dripjobs_lead_report_csv_v1") throw new Error("previous Lead report manifest has the wrong source type");
  const previousRows = Number(previous.row_count);
  if (!Number.isInteger(previousRows) || previousRows < 100) throw new Error("previous Lead report manifest has an invalid row count");
  if (current.row_count < previousRows) throw new Error(`Lead report row count dropped from ${previousRows} to ${current.row_count}`);
  if (current.row_count > previousRows + Math.max(100, Math.ceil(previousRows * 0.2))) {
    throw new Error(`Lead report row count jumped from ${previousRows} to ${current.row_count}`);
  }
  if (current.last_created_on < previous.last_created_on) throw new Error("Lead report latest created date moved backward");
  return true;
}
