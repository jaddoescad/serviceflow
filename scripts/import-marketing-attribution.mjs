#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const META_ACCOUNT_ID = "762696206838329";
const META_CAPTURED_AT = "2026-08-02T01:59:00.000Z";
const APPLY = process.argv.includes("--apply");
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

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
  const [headers, ...values] = rows;
  return values
    .filter((cells) => cells.some((cell) => cell !== ""))
    .map((cells) =>
      Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])),
    );
}

function numberOrNull(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(String(value).replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

function normalizeChannel(source) {
  const normalized = String(source ?? "").trim().toLocaleLowerCase("en-CA");
  if (normalized === "meta-perspective") return "paid_social";
  if (normalized === "facebook" || normalized === "instagram") {
    return "organic_social";
  }
  if (
    normalized === "website" ||
    normalized === "/contact" ||
    normalized.startsWith("/https://paintersottawa.com")
  ) {
    return "website";
  }
  if (normalized === "phone call") return "phone";
  if (normalized === "mail") return "mail";
  if (normalized === "word of mouth") return "referral";
  if (normalized === "other") return "other";
  return "unknown";
}

function campaignPurpose(name) {
  return /hiring|painter recruitment|recruit/i.test(name)
    ? "recruiting"
    : "customer_acquisition";
}

function groupTotals(rows, key) {
  return Object.entries(Object.groupBy(rows, (row) => row[key])).map(
    ([name, grouped]) => ({
      [key]: name,
      rows: grouped.length,
      spend: Math.round(
        grouped.reduce((total, row) => total + Number(row.amount_spent), 0) * 100,
      ) / 100,
      results:
        Math.round(
          grouped.reduce((total, row) => total + Number(row.results ?? 0), 0) * 10000,
        ) / 10000,
    }),
  );
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
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
const attributionSnapshot = JSON.parse(
  readFileSync(
    path.resolve(repoRoot, "data/dripjobs-customer-attribution-2026-08-01.json"),
    "utf8",
  ),
);
const proposalUuids = attributionSnapshot.records.map((row) => row.proposal_uuid);
const invoiceResult = await db
  .from("customer_invoices")
  .select("id,external_proposal_uuid")
  .in("external_proposal_uuid", proposalUuids);
if (invoiceResult.error) throw invoiceResult.error;
const invoiceByProposal = new Map(
  (invoiceResult.data ?? []).map((invoice) => [invoice.external_proposal_uuid, invoice]),
);
const missingProposals = proposalUuids.filter(
  (proposalUuid) => !invoiceByProposal.has(proposalUuid),
);

const attributionRows = attributionSnapshot.records
  .filter((record) => invoiceByProposal.has(record.proposal_uuid))
  .map((record) => ({
    customer_invoice_id: invoiceByProposal.get(record.proposal_uuid).id,
    source_system: "dripjobs",
    external_contact_id: record.contact_uuid,
    raw_lead_source: record.lead_source,
    normalized_channel: normalizeChannel(record.lead_source),
    lead_created_at: record.lead_created_at,
    evidence_source: record.evidence_source,
    evidence_reference: `https://app.dripjobs.com/contacts/edit/${record.contact_uuid}`,
    evidence_payload: {
      proposal_uuid: record.proposal_uuid,
      proposal_id: record.proposal_id,
      invoice_uuid: record.invoice_uuid,
      job_status: record.status,
      snapshot_captured_at: attributionSnapshot.captured_at,
    },
    captured_at: attributionSnapshot.captured_at,
  }));

const metaFiles = [
  {
    filename: "campaigns.csv",
    entity_level: "campaign",
    name_column: "Campaign name",
    delivery_column: "Campaign delivery",
  },
  {
    filename: "ad-sets.csv",
    entity_level: "ad_set",
    name_column: "Ad set name",
    delivery_column: "Ad set delivery",
  },
  {
    filename: "ads.csv",
    entity_level: "ad",
    name_column: "Ad name",
    delivery_column: "Ad delivery",
  },
];
const performanceRows = [];
for (const config of metaFiles) {
  const filePath = path.resolve(
    repoRoot,
    "data/marketing/meta/2026-08-01",
    config.filename,
  );
  const file = readFileSync(filePath, "utf8");
  const sourceSha256 = createHash("sha256").update(file).digest("hex");
  const parsed = parseCsv(file);
  parsed.forEach((sourceRow, index) => {
    const entityName = sourceRow[config.name_column]?.trim();
    if (!entityName) return;
    performanceRows.push({
      platform: "meta",
      account_id: META_ACCOUNT_ID,
      entity_level: config.entity_level,
      entity_name: entityName,
      parent_campaign_name:
        config.entity_level === "campaign" ? entityName : null,
      parent_ad_set_name:
        config.entity_level === "ad" ? sourceRow["Ad set name"] || null : null,
      delivery_state: sourceRow[config.delivery_column] || null,
      purpose: campaignPurpose(entityName),
      reporting_start: sourceRow["Reporting starts"],
      reporting_end: sourceRow["Reporting ends"],
      currency: "CAD",
      results: numberOrNull(sourceRow.Results),
      result_indicator: sourceRow["Result indicator"] || null,
      amount_spent: numberOrNull(sourceRow["Amount spent (CAD)"]) ?? 0,
      impressions: numberOrNull(sourceRow.Impressions) ?? 0,
      reach: numberOrNull(sourceRow.Reach) ?? 0,
      source_filename: config.filename,
      source_sha256: sourceSha256,
      source_row_number: index + 2,
      source_payload: sourceRow,
      captured_at: META_CAPTURED_AT,
    });
  });
}

const dryRun = {
  project_ref: projectRef,
  apply: APPLY,
  attribution: {
    source_records: attributionSnapshot.records.length,
    matched_invoices: attributionRows.length,
    missing_proposals: missingProposals,
    channels: groupTotals(attributionRows, "normalized_channel"),
  },
  platform_performance: {
    rows: performanceRows.length,
    levels: groupTotals(performanceRows, "entity_level"),
    campaign_purposes: groupTotals(
      performanceRows.filter((row) => row.entity_level === "campaign"),
      "purpose",
    ),
  },
};

if (!APPLY) {
  console.log(JSON.stringify(dryRun, null, 2));
  process.exit(0);
}
if (missingProposals.length) {
  throw new Error(`Missing ${missingProposals.length} customer invoices; refusing partial import.`);
}

const attributionUpsert = await db
  .from("customer_invoice_acquisition_attributions")
  .upsert(attributionRows, { onConflict: "customer_invoice_id" });
if (attributionUpsert.error) throw attributionUpsert.error;
const performanceUpsert = await db
  .from("marketing_platform_performance")
  .upsert(performanceRows, { onConflict: "source_sha256,source_row_number" });
if (performanceUpsert.error) throw performanceUpsert.error;

const [attributionVerification, performanceVerification] = await Promise.all([
  db
    .from("customer_invoice_acquisition_attributions")
    .select("customer_invoice_id,normalized_channel,lead_created_at"),
  db
    .from("marketing_platform_performance")
    .select("entity_level,purpose,amount_spent,results"),
]);
if (attributionVerification.error) throw attributionVerification.error;
if (performanceVerification.error) throw performanceVerification.error;

console.log(
  JSON.stringify(
    {
      ...dryRun,
      verification: {
        attribution_rows: attributionVerification.data?.length ?? 0,
        performance_rows: performanceVerification.data?.length ?? 0,
        campaign_purposes: groupTotals(
          (performanceVerification.data ?? []).filter(
            (row) => row.entity_level === "campaign",
          ),
          "purpose",
        ),
      },
    },
    null,
    2,
  ),
);
