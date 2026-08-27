import crypto from "node:crypto";

import { parseCsv, parseMoneyCents } from "./dripjobs-invoice-list.mjs";
import { normalizeDripJobsLeadChannel } from "./dripjobs-sales-list.mjs";

export const DRIPJOBS_PROPOSAL_REPORT_HEADERS = Object.freeze([
  "Proposal Name",
  "First Name",
  "Last Name",
  "Email",
  "Phone",
  "Salesperson",
  "Deal Name",
  "Lead Source",
  "Sent Date",
  "Sent By",
  "Appointment Linked",
  "Status",
  "Proposal Value",
  "Delivery Method",
]);

const ALLOWED_STATUSES = new Set(["Pending", "Cancelled", "Completed", "Scheduled", "Accepted"]);
const ALLOWED_DELIVERY_METHODS = new Set(["Email", "SMS", "Not Sent"]);
const TEST_TOKEN = /(^|[^a-z0-9])(test|testing|tester|dummy|fake|asdf|qwerty)([^a-z0-9]|$)/i;

export function proposalReportSha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function bounded(value, label, maximum, { allowEmpty = false } = {}) {
  const text = String(value ?? "").trim();
  if (!allowEmpty && !text) throw new Error(`${label} is empty`);
  if (text.length > maximum) throw new Error(`${label} exceeds ${maximum} characters`);
  return text;
}

export function normalizeProposalReportEmail(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-CA") || null;
}

export function normalizeProposalReportPhone(value) {
  return String(value ?? "").replace(/[^0-9]+/g, "") || null;
}

export function normalizeProposalReportName(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseProposalReportDate(value, label) {
  const match = String(value ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new Error(`${label} must be MM/DD/YYYY`);
  const [, month, day, year] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T12:00:00Z`);
  if (parsed.toISOString().slice(0, 10) !== iso) throw new Error(`${label} is not a real date`);
  return iso;
}

export function proposalIdFromName(value) {
  return String(value ?? "").match(/#(\d{7})\b/)?.[1] ?? null;
}

export function classifyProposalReportRow(row) {
  const fullName = normalizeProposalReportName(`${row.firstName} ${row.lastName}`);
  const email = normalizeProposalReportEmail(row.email) ?? "";
  const search = [
    fullName,
    email,
    normalizeProposalReportName(row.dealName),
    normalizeProposalReportName(row.proposalName),
  ].join(" ");
  const vendorTest = email.endsWith("@dripjobs.com") || fullName === "laura dripjobs";
  const explicitTest =
    fullName === "jad slim" ||
    fullName === "blocked don t book" ||
    fullName.startsWith("codex test") ||
    fullName.startsWith("codex acceptance test") ||
    email.startsWith("meta-acceptance-") ||
    TEST_TOKEN.test(search);
  if (vendorTest) return { marketingEligible: false, exclusionReason: "vendor_test", classificationFlags: ["vendor_test"] };
  if (explicitTest) return { marketingEligible: false, exclusionReason: "test", classificationFlags: ["test"] };
  return { marketingEligible: true, exclusionReason: null, classificationFlags: [] };
}

function proposalKey(row) {
  if (row.proposalId) return `proposal:${row.proposalId}`;
  const identity = [
    row.normalizedEmail ?? "",
    row.normalizedPhone ?? "",
    normalizeProposalReportName(row.proposalName),
    row.proposalValueCents,
  ];
  return `fallback:${proposalReportSha256(JSON.stringify(identity))}`;
}

export function validateDripJobsProposalReport(input, {
  minimumRows = 100,
  maximumRows = 10_000,
  capturedAt = new Date().toISOString(),
} = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ""), "utf8");
  if (bytes.length < 1_024) throw new Error("Proposal report is too small to be complete");
  if (bytes.length > 20_000_000) throw new Error("Proposal report exceeds the 20 MB limit");
  if (bytes.includes(0)) throw new Error("Proposal report contains binary data instead of CSV text");
  const parsed = parseCsv(bytes.toString("utf8").replace(/^\uFEFF/, ""));
  if (!parsed.length) throw new Error("Proposal report is empty");
  const headers = parsed[0].map((header) => String(header ?? "").trim());
  if (JSON.stringify(headers) !== JSON.stringify(DRIPJOBS_PROPOSAL_REPORT_HEADERS)) {
    throw new Error(`unexpected Proposal report headers: ${JSON.stringify(headers)}`);
  }
  const dataRows = parsed.slice(1).filter((values) => values.some((value) => String(value ?? "").trim()));
  if (dataRows.length < minimumRows) throw new Error(`Proposal report has only ${dataRows.length} rows`);
  if (dataRows.length > maximumRows) throw new Error(`Proposal report has ${dataRows.length} rows; maximum is ${maximumRows}`);

  const rows = dataRows.map((values, index) => {
    const sourceRowNumber = index + 2;
    const label = `Proposal report row ${sourceRowNumber}`;
    if (values.length !== headers.length) throw new Error(`${label} has ${values.length} columns; expected ${headers.length}`);
    const source = Object.fromEntries(headers.map((header, column) => [header, String(values[column] ?? "").trim()]));
    const status = bounded(source.Status, `${label} Status`, 40);
    if (!ALLOWED_STATUSES.has(status)) throw new Error(`${label} has unsupported Status ${status}`);
    const deliveryMethod = bounded(source["Delivery Method"], `${label} Delivery Method`, 40);
    if (!ALLOWED_DELIVERY_METHODS.has(deliveryMethod)) throw new Error(`${label} has unsupported Delivery Method ${deliveryMethod}`);
    const appointmentLinkedText = bounded(source["Appointment Linked"], `${label} Appointment Linked`, 10);
    if (!['Yes', 'No'].includes(appointmentLinkedText)) throw new Error(`${label} has unsupported Appointment Linked ${appointmentLinkedText}`);
    const proposalName = bounded(source["Proposal Name"], `${label} Proposal Name`, 300);
    const firstName = bounded(source["First Name"], `${label} First Name`, 200);
    const lastName = bounded(source["Last Name"], `${label} Last Name`, 200);
    const email = bounded(source.Email, `${label} Email`, 320, { allowEmpty: true }) || null;
    const phone = bounded(source.Phone, `${label} Phone`, 80, { allowEmpty: true }) || null;
    const rawSource = bounded(source["Lead Source"], `${label} Lead Source`, 1_000);
    const proposalValueCents = parseMoneyCents(source["Proposal Value"], `${label} Proposal Value`);
    if (proposalValueCents < 0) throw new Error(`${label} Proposal Value cannot be negative`);
    const prepared = {
      sourceRowNumber,
      proposalName,
      proposalId: proposalIdFromName(proposalName),
      firstName,
      lastName,
      email,
      phone,
      normalizedEmail: normalizeProposalReportEmail(email),
      normalizedPhone: normalizeProposalReportPhone(phone),
      salesperson: bounded(source.Salesperson, `${label} Salesperson`, 200),
      dealName: bounded(source["Deal Name"], `${label} Deal Name`, 300),
      rawSource,
      normalizedChannel: normalizeDripJobsLeadChannel(rawSource),
      sentOn: parseProposalReportDate(source["Sent Date"], `${label} Sent Date`),
      sentBy: bounded(source["Sent By"], `${label} Sent By`, 200),
      appointmentLinked: appointmentLinkedText === "Yes",
      reportStatus: status,
      proposalValueCents,
      deliveryMethod,
      isDelivered: deliveryMethod === "Email" || deliveryMethod === "SMS",
      sourcePayload: source,
    };
    return {
      ...prepared,
      ...classifyProposalReportRow(prepared),
      proposalKey: proposalKey(prepared),
      rowFingerprint: proposalReportSha256(JSON.stringify(source)),
    };
  });

  const sentDates = rows.map((row) => row.sentOn).sort();
  const proposalIds = rows.map((row) => row.proposalId).filter(Boolean);
  const sourceSha256 = proposalReportSha256(bytes);
  return {
    rows,
    bytes,
    sourceSha256,
    capturedAt,
    manifest: {
      schema_version: 1,
      source_type: "dripjobs_total_proposals_sent_csv_v1",
      source_sha256: sourceSha256,
      row_count: rows.length,
      delivered_row_count: rows.filter((row) => row.isDelivered).length,
      not_sent_row_count: rows.filter((row) => !row.isDelivered).length,
      test_or_vendor_row_count: rows.filter((row) => !row.marketingEligible).length,
      eligible_delivered_row_count: rows.filter((row) => row.isDelivered && row.marketingEligible).length,
      distinct_proposal_key_count: new Set(rows.map((row) => row.proposalKey)).size,
      eligible_delivered_proposal_key_count: new Set(rows.filter((row) => row.isDelivered && row.marketingEligible).map((row) => row.proposalKey)).size,
      proposal_id_row_count: proposalIds.length,
      distinct_proposal_id_count: new Set(proposalIds).size,
      first_sent_on: sentDates[0],
      last_sent_on: sentDates.at(-1),
      captured_at: capturedAt,
    },
  };
}
