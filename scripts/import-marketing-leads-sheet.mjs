#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { CONFIRMED_LEAD_BY_ID } from "./lib/dripjobs-job-reconciliation.mjs";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const SPREADSHEET_ID = "1D5r_1r5Ldd_v5BbOcOUzM8XHF2z0kRGytcYxRsss54E";
const SHEET_NAME = "Deals";
const APPLY = process.argv.includes("--apply");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

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
  if (!rawHeaders) throw new Error("The CSV is empty.");
  const headers = rawHeaders.map((header) => header.trim());
  const required = [
    "Deal ID",
    "Date Created",
    "Name",
    "Email",
    "Phone",
    "Lead Source",
    "Address",
    "Postal Code",
  ];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) {
    throw new Error(`Missing expected columns: ${missing.join(", ")}.`);
  }

  return values
    .filter((cells) => cells.some((cell) => cell.trim()))
    .map((cells, index) => ({
      sourceRowNumber: index + 2,
      row: Object.fromEntries(
        headers.map((header, cellIndex) => [
          header,
          (cells[cellIndex] ?? "").trim(),
        ]),
      ),
    }));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nullable(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function parseCreated(value) {
  const normalized = String(value ?? "").trim();
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}):(\d{2}))?$/,
  );
  if (!match) throw new Error(`Invalid Date Created value: ${normalized || "(blank)"}.`);
  const [, year, month, day, hour, minute, second] = match;
  return {
    createdOn: `${year}-${month}-${day}`,
    createdAtLocal: hour
      ? `${year}-${month}-${day}T${hour.padStart(2, "0")}:${minute}:${second}`
      : null,
    precision: hour ? "timestamp" : "date",
  };
}

function parseDate(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const northAmerican = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!northAmerican) return null;
  return `${northAmerican[3]}-${northAmerican[1].padStart(2, "0")}-${northAmerican[2].padStart(2, "0")}`;
}

function money(value) {
  const normalized = String(value ?? "")
    .replaceAll("$", "")
    .replaceAll(",", "")
    .trim();
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0
    ? Math.round(number * 100) / 100
    : null;
}

function boolean(value) {
  return ["true", "yes", "1"].includes(
    String(value ?? "").trim().toLocaleLowerCase("en-CA"),
  );
}

function normalizeChannel(source) {
  const value = String(source ?? "").trim().toLocaleLowerCase("en-CA");
  if (value === "meta-perspective") return "paid_social";
  if (value === "facebook" || value === "instagram") return "organic_social";
  if (value === "/" || value.startsWith("/")) return "website";
  if (value === "phone call") return "phone";
  if (value === "mail") return "mail";
  if (value === "word of mouth") return "referral";
  if (value === "google") return "organic_search";
  if (value === "other") return "other";
  return "unknown";
}

const fileArgument = argumentValue("--file");
if (!fileArgument) {
  throw new Error(
    "Provide the downloaded All Leads CSV with --file /absolute/path/to/file.csv.",
  );
}
const filePath = path.resolve(fileArgument);
if (!existsSync(filePath)) throw new Error(`Missing source CSV: ${filePath}.`);

const source = readFileSync(filePath, "utf8");
const sourceSha256 = sha256(source);
const parsed = parseCsv(source);
const capturedAt = new Date().toISOString();
const seenDealIds = new Set();

const preparedRows = parsed.map(({ row, sourceRowNumber }) => {
  const dealId = nullable(row["Deal ID"]);
  if (!dealId) throw new Error(`Missing Deal ID on source row ${sourceRowNumber}.`);
  if (seenDealIds.has(dealId)) throw new Error(`Duplicate Deal ID ${dealId}.`);
  seenDealIds.add(dealId);
  const correction = CONFIRMED_LEAD_BY_ID.get(dealId);
  const created = parseCreated(
    correction?.contact_created_at_local ?? row["Date Created"],
  );
  return {
    deal_id: dealId,
    created_on: created.createdOn,
    created_at_local: created.createdAtLocal,
    created_at_precision: created.precision,
    contact_name: nullable(correction?.contact_name ?? row.Name),
    email: nullable(correction?.email ?? row.Email),
    phone: nullable(correction?.phone ?? row.Phone),
    raw_lead_source: nullable(correction?.lead_source ?? row["Lead Source"]),
    normalized_channel: normalizeChannel(
      correction?.lead_source ?? row["Lead Source"],
    ),
    address: nullable(correction?.address ?? row.Address),
    postal_code: nullable(correction?.postal_code ?? row["Postal Code"]),
    estimate_scheduled_on: parseDate(row["Estimate Scheduled Date"]),
    estimate_appointment_on: parseDate(row["Estimate Appointment Date"]),
    proposal_number: nullable(correction?.proposal_id ?? row["Proposal Number"]),
    proposal_amount: correction?.invoice_total ?? money(row["Proposal price"]),
    proposal_on: parseDate(
      correction?.proposal_created_on ?? row["Proposal Date"],
    ),
    job_crew: nullable(row["Job Crew"]),
    is_interior: boolean(row.Interior),
    is_exterior: boolean(row.Exterior),
    is_cabinets: boolean(row.Cabinets),
    source_system: "google_sheets_dripjobs_export",
    source_filename: path.basename(filePath),
    source_spreadsheet_id: SPREADSHEET_ID,
    source_sheet_name: SHEET_NAME,
    source_row_number: sourceRowNumber,
    source_sha256: sourceSha256,
    source_payload: correction
      ? {
          ...row,
          dripjobs_reconciliation: {
            status: "confirmed",
            evidence_source:
              "data/dripjobs-job-reconciliation-2026-08-02.json",
            contact_uuid: correction.contact_uuid,
            dripjobs_deal_uuid: correction.dripjobs_deal_uuid,
            proposal_uuid: correction.proposal_uuid,
            invoice_uuid: correction.invoice_uuid,
            identity_correction: correction.identity_correction ?? null,
          },
        }
      : row,
    captured_at: capturedAt,
  };
});

const year2026 = preparedRows.filter((row) => row.created_on.startsWith("2026-")).length;
const meta2026 = preparedRows.filter(
  (row) =>
    row.created_on.startsWith("2026-") && row.normalized_channel === "paid_social",
).length;
const createdDates = preparedRows.map((row) => row.created_on).toSorted();
const preview = {
  project_ref: TARGET_PROJECT_REF,
  apply: APPLY,
  source_filename: path.basename(filePath),
  source_sha256: sourceSha256,
  spreadsheet_id: SPREADSHEET_ID,
  sheet_name: SHEET_NAME,
  rows: preparedRows.length,
  unique_deal_ids: seenDealIds.size,
  leads_2026: year2026,
  meta_leads_2026: meta2026,
  directly_verified_lead_corrections: [...CONFIRMED_LEAD_BY_ID.keys()].length,
  date_range: {
    first: createdDates[0] ?? null,
    last: createdDates.at(-1) ?? null,
  },
};

if (preparedRows.length !== 1170 || year2026 !== 792 || meta2026 !== 501) {
  throw new Error(
    `Source validation failed: expected 1170 total / 792 in 2026 / 501 Meta in 2026; received ${preparedRows.length} / ${year2026} / ${meta2026}.`,
  );
}

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
for (let index = 0; index < preparedRows.length; index += 400) {
  const result = await db.from("marketing_leads").upsert(
    preparedRows.slice(index, index + 400),
    { onConflict: "deal_id" },
  );
  if (result.error) throw result.error;
}

const [allResult, yearResult, metaResult] = await Promise.all([
  db.from("marketing_leads").select("deal_id", { count: "exact", head: true }),
  db
    .from("marketing_leads")
    .select("deal_id", { count: "exact", head: true })
    .gte("created_on", "2026-01-01")
    .lte("created_on", "2026-12-31"),
  db
    .from("marketing_leads")
    .select("deal_id", { count: "exact", head: true })
    .gte("created_on", "2026-01-01")
    .lte("created_on", "2026-12-31")
    .eq("normalized_channel", "paid_social"),
]);
for (const result of [allResult, yearResult, metaResult]) {
  if (result.error) throw result.error;
}
if (allResult.count !== 1170 || yearResult.count !== 792 || metaResult.count !== 501) {
  throw new Error(
    `Database verification failed: found ${allResult.count} / ${yearResult.count} / ${metaResult.count}.`,
  );
}

console.log(
  JSON.stringify(
    {
      ...preview,
      imported_rows: allResult.count,
      verified_2026: yearResult.count,
      verified_meta_2026: metaResult.count,
    },
    null,
    2,
  ),
);
