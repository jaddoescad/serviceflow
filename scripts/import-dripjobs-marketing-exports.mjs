#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const SNAPSHOT_ON = "2026-08-01";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const downloadsDirectory = path.join(homedir(), "Downloads");
const sourceFiles = [
  "Jobs_List_20260801_220912.csv",
  "Jobs_List_20260801_220854.csv",
  "Sales_List_20260801_220748.csv",
  "Sales_List_20260801_220723.csv",
].map((filename) => path.join(downloadsDirectory, filename));

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
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
  const [rawHeaders, ...values] = rows;
  const headers = rawHeaders.map((header) => header.trim());
  return values
    .filter((cells) => cells.some((cell) => cell.trim()))
    .map((cells) =>
      Object.fromEntries(
        headers.map((header, index) => [header, (cells[index] ?? "").trim()]),
      ),
    );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function money(value) {
  const normalized = String(value ?? "")
    .replaceAll("$", "")
    .replaceAll(",", "")
    .replace(/^\((.*)\)$/, "-$1")
    .trim();
  const number = Number(normalized || 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function normalizedContact(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]/g, "");
}

function contactKey(row, recordType) {
  const email = normalizedContact(row.Email);
  const phone = normalizedContact(
    recordType === "job" ? row.Phone : row["Phone Number"],
  );
  const name = normalizedContact(
    recordType === "job" ? row.Job : row["Customer Name"],
  );
  return sha256(email ? `email:${email}` : phone ? `phone:${phone}` : `name:${name}`);
}

function normalizeChannel(source) {
  const value = String(source ?? "").trim().toLocaleLowerCase("en-CA");
  if (value === "meta-perspective") return "paid_social";
  if (value === "facebook" || value === "instagram") return "organic_social";
  if (
    value === "website" ||
    value === "/" ||
    value === "/contact" ||
    value === "/gallery" ||
    value.startsWith("/locations/")
  ) {
    return "website";
  }
  if (value === "phone call") return "phone";
  if (value === "mail") return "mail";
  if (value === "word of mouth") return "referral";
  if (value === "google") return "organic_search";
  if (value === "other") return "other";
  return "unknown";
}

function parseDate(value) {
  const match = String(value ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function shiftDate(dateText, { days = 0, months = 0 }) {
  const [year, month, day] = dateText.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (months) date.setUTCMonth(date.getUTCMonth() - months);
  if (days) date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function estimateFromDealAge(rawAge) {
  const match = String(rawAge ?? "").trim().match(/^(\d+)(h|d|mo)$/);
  if (!match) {
    return { date: null, method: "unknown", confidence: 0 };
  }
  const amount = Number(match[1]);
  if (match[2] === "mo") {
    return {
      date: shiftDate(SNAPSHOT_ON, { months: amount }),
      method: "deal_age_month",
      confidence: 0.45,
    };
  }
  return {
    date: shiftDate(SNAPSHOT_ON, { days: match[2] === "h" ? 0 : amount }),
    method: "deal_age_day",
    confidence: match[2] === "h" ? 0.85 : 0.75,
  };
}

function median(values) {
  const sorted = values.toSorted((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function daysBetween(left, right) {
  return (
    (new Date(`${right}T12:00:00Z`).getTime() -
      new Date(`${left}T12:00:00Z`).getTime()) /
    86400000
  );
}

function sourceCapturedAt(filename) {
  const match = filename.match(/_(\d{8})_(\d{6})\.csv$/);
  if (!match) return `${SNAPSHOT_ON}T12:00:00.000Z`;
  const [, date, time] = match;
  const local = new Date(
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}-04:00`,
  );
  return local.toISOString();
}

for (const filePath of sourceFiles) {
  if (!existsSync(filePath)) throw new Error(`Missing source export ${filePath}.`);
}

const attributionSnapshot = JSON.parse(
  readFileSync(
    path.join(repoRoot, "data", "dripjobs-customer-attribution-2026-08-01.json"),
    "utf8",
  ),
);
const attributionByProposal = new Map(
  attributionSnapshot.records.map((row) => [String(row.proposal_id), row]),
);

const parsedFiles = sourceFiles.map((filePath) => {
  const source = readFileSync(filePath, "utf8");
  return {
    filePath,
    filename: path.basename(filePath),
    sourceSha256: sha256(source),
    rows: parseCsv(source),
  };
});

const jobSourceRows = parsedFiles
  .filter((file) => file.filename.startsWith("Jobs_List"))
  .flatMap((file) =>
    file.rows.map((row, index) => ({ file, row, sourceRowNumber: index + 2 })),
  );
const observedCycles = jobSourceRows
  .map(({ row }) => {
    const attribution = attributionByProposal.get(String(row["Proposal ID"]));
    const leadDate = attribution?.lead_created_at?.slice(0, 10) ?? null;
    const signedDate = parseDate(row["Proposal Signed Date"]);
    if (!leadDate || !signedDate) return null;
    const days = daysBetween(leadDate, signedDate);
    return days >= 0 && days <= 365 ? days : null;
  })
  .filter((value) => value != null);
const modeledSalesCycleDays = Math.round(median(observedCycles) ?? 23);

const seenFingerprints = new Set();
const preparedRows = [];
for (const file of parsedFiles) {
  const recordType = file.filename.startsWith("Jobs_List") ? "job" : "sales_deal";
  for (let index = 0; index < file.rows.length; index += 1) {
    const row = file.rows[index];
    const fingerprint = sha256(JSON.stringify(row));
    const canonical = !seenFingerprints.has(fingerprint);
    seenFingerprints.add(fingerprint);
    const attribution =
      recordType === "job"
        ? attributionByProposal.get(String(row["Proposal ID"]))
        : null;
    const rawLeadSource =
      recordType === "job" ? attribution?.lead_source ?? "" : row["Lead Source"];
    let leadDate;
    if (recordType === "sales_deal") {
      leadDate = estimateFromDealAge(row["Deal Age"]);
    } else if (attribution?.lead_created_at) {
      leadDate = {
        date: attribution.lead_created_at.slice(0, 10),
        method: "attribution_exact",
        confidence: 1,
      };
    } else {
      const anchor =
        parseDate(row["Proposal Signed Date"]) ??
        parseDate(row["Job Start Date"]) ??
        parseDate(row["Deal Stage Date"]);
      leadDate = anchor
        ? {
            date: shiftDate(anchor, { days: modeledSalesCycleDays }),
            method: "sales_cycle_model",
            confidence: 0.35,
          }
        : { date: null, method: "unknown", confidence: 0 };
    }
    preparedRows.push({
      source_system: "dripjobs",
      record_type: recordType,
      source_filename: file.filename,
      source_sha256: file.sourceSha256,
      source_row_number: index + 2,
      record_fingerprint: fingerprint,
      canonical_in_snapshot: canonical,
      snapshot_on: SNAPSHOT_ON,
      status: row.Status,
      label: row.Label || null,
      contact_name:
        recordType === "job" ? row.Job || null : row["Customer Name"] || null,
      email: row.Email || null,
      phone:
        (recordType === "job" ? row.Phone : row["Phone Number"]) || null,
      contact_key: contactKey(row, recordType),
      raw_lead_source: rawLeadSource || null,
      normalized_channel: normalizeChannel(rawLeadSource),
      deal_name:
        (recordType === "job" ? row.Job : row["Deal Name"]) || null,
      deal_stage: row["Deal Stage"] || null,
      salesperson: row.Salesperson || null,
      deal_amount: money(recordType === "job" ? row.Amount : row["Deal Amount"]),
      proposal_id: recordType === "job" ? row["Proposal ID"] || null : null,
      invoice_id: recordType === "job" ? row["Invoice ID"] || null : null,
      invoice_status:
        recordType === "job" ? row["Invoice Status"] || null : null,
      paid_amount: money(recordType === "job" ? row.Paid : 0),
      balance_amount: money(recordType === "job" ? row.Balance : 0),
      raw_last_change:
        recordType === "sales_deal" ? row["Last Change"] || null : null,
      raw_deal_age:
        recordType === "sales_deal" ? row["Deal Age"] || null : null,
      estimated_lead_created_on: leadDate.date,
      lead_date_method: leadDate.method,
      lead_date_confidence: leadDate.confidence,
      source_payload: {
        ...row,
        attribution_evidence:
          attribution == null
            ? null
            : {
                evidence_source: attribution.evidence_source,
                contact_uuid: attribution.contact_uuid,
                proposal_uuid: attribution.proposal_uuid,
              },
        modeled_sales_cycle_days: modeledSalesCycleDays,
      },
      captured_at: sourceCapturedAt(file.filename),
    });
  }
}

const canonicalRows = preparedRows.filter((row) => row.canonical_in_snapshot);
const salesRows = canonicalRows.filter((row) => row.record_type === "sales_deal");
const jobRows = canonicalRows.filter((row) => row.record_type === "job");
const activeSalesStatuses = new Set(["Open", "Pending", "Scheduled"]);
const wonJobs = jobRows.filter((row) => row.status.toUpperCase() !== "CANCELLED");
const lostRows = canonicalRows.filter(
  (row) =>
    (row.record_type === "sales_deal" && !activeSalesStatuses.has(row.status)) ||
    (row.record_type === "job" && row.status.toUpperCase() === "CANCELLED"),
);
const monthly = Object.entries(
  Object.groupBy(
    canonicalRows.filter((row) => row.estimated_lead_created_on),
    (row) => row.estimated_lead_created_on.slice(0, 7),
  ),
)
  .map(([month, rows]) => ({
    month,
    crm_records: rows.length,
    crm_meta_records: rows.filter((row) => row.normalized_channel === "paid_social")
      .length,
    won_jobs: rows.filter(
      (row) => row.record_type === "job" && row.status.toUpperCase() !== "CANCELLED",
    ).length,
  }))
  .sort((left, right) => left.month.localeCompare(right.month));

const preview = {
  project_ref: TARGET_PROJECT_REF,
  apply: APPLY,
  snapshot_on: SNAPSHOT_ON,
  sources: parsedFiles.map((file) => ({
    filename: file.filename,
    sha256: file.sourceSha256,
    rows: file.rows.length,
  })),
  raw_rows: preparedRows.length,
  canonical_records: canonicalRows.length,
  duplicate_source_rows: preparedRows.length - canonicalRows.length,
  sales_deals: salesRows.length,
  jobs: jobRows.length,
  active_pipeline: salesRows.filter((row) => activeSalesStatuses.has(row.status)).length,
  won_jobs: wonJobs.length,
  closed_lost: lostRows.length,
  known_source_records: canonicalRows.filter(
    (row) => row.normalized_channel !== "unknown",
  ).length,
  paid_social_records: canonicalRows.filter(
    (row) => row.normalized_channel === "paid_social",
  ).length,
  date_methods: Object.fromEntries(
    Object.entries(Object.groupBy(canonicalRows, (row) => row.lead_date_method)).map(
      ([method, rows]) => [method, rows.length],
    ),
  ),
  modeled_sales_cycle_days: modeledSalesCycleDays,
  exact_cycle_observations: observedCycles.length,
  monthly,
};

if (!APPLY) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.join(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== TARGET_PROJECT_REF) {
  throw new Error(`Refusing import for unexpected Supabase project ${projectRef}.`);
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
for (let index = 0; index < preparedRows.length; index += 500) {
  const result = await db
    .from("marketing_crm_records")
    .upsert(preparedRows.slice(index, index + 500), {
      onConflict: "source_sha256,source_row_number",
    });
  if (result.error) throw result.error;
}
const hashes = parsedFiles.map((file) => file.sourceSha256);
const verify = await db
  .from("marketing_crm_records")
  .select("id", { count: "exact", head: true })
  .in("source_sha256", hashes);
if (verify.error) throw verify.error;
if (verify.count !== preparedRows.length) {
  throw new Error(
    `Verification failed: expected ${preparedRows.length} rows, found ${verify.count}.`,
  );
}
console.log(JSON.stringify({ ...preview, imported_rows: verify.count }, null, 2));
