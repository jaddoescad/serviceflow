#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const PROJECT_ID = "dripjobs-2101292";
const RECEIPT_NUMBER = "2900-6";
const apply = process.argv.includes("--apply");
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

function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF) {
  throw new Error("Refusing recovery for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [projectResult, receiptResult] = await Promise.all([
  db.from("companycam_projects").select("*").eq("companycam_id", PROJECT_ID).maybeSingle(),
  db
    .from("material_invoices")
    .select(
      "id,source_system,supplier_name,invoice_number,invoice_date,po_number,amount_before_tax,tax_amount,total_amount,material_invoice_lines(id,line_number,product_code,color_code,color_name,amount_before_tax,tax_amount,total_amount)",
    )
    .eq("invoice_number", RECEIPT_NUMBER)
    .single(),
]);
if (projectResult.error) throw projectResult.error;
if (receiptResult.error) throw receiptResult.error;

const receipt = receiptResult.data;
const receiptLines = receipt.material_invoice_lines ?? [];
assert(receipt.source_system === "sherwin_daily_email", "Unexpected receipt source.");
assert(receipt.supplier_name === "Sherwin-Williams Canada", "Unexpected receipt supplier.");
assert(receipt.invoice_date === "2025-10-14", "Unexpected receipt date.");
assert(receipt.po_number === "JEFFREY", "Unexpected receipt PO.");
assert(cents(receipt.amount_before_tax) === 7_277, "Unexpected receipt subtotal.");
assert(cents(receipt.tax_amount) === 946, "Unexpected receipt HST.");
assert(cents(receipt.total_amount) === 8_223, "Unexpected receipt total.");
assert(receiptLines.length === 3, "Expected three structured receipt lines.");
assert(
  receiptLines.some(
    (line) =>
      line.product_code === "B42WQ8141" &&
      line.color_code === "SW6199" &&
      line.color_name === "RARE GRAY",
  ),
  "Receipt no longer contains the audited Rare Gray exterior wood primer.",
);

const projectRow = {
  companycam_id: PROJECT_ID,
  name: "Jeffrey Roy / Jeffrey Ian — proposal 2101292 (completed)",
  street_address_1: "10 Lynhurst Ave",
  street_address_2: null,
  city: "Ottawa",
  state: "ON",
  postal_code: "K1V 9W7",
  country: "CA",
  formatted_address: "10 Lynhurst Ave, Ottawa, ON, K1V 9W7",
  latitude: null,
  longitude: null,
  is_archived: true,
  companycam_created_at: "2025-09-24T13:18:56Z",
  companycam_updated_at: "2025-10-15T13:24:43Z",
  raw: {
    source: "dripjobs_email_accounting_job",
    dripjobs: {
      proposal_id: "2101292",
      proposal_uuid: null,
      customer_name: "Jeffrey Ian",
      alternate_customer_name: "Jeffrey Roy",
      customer_email: "jeffreyianroy@gmail.com",
      customer_phone: "6138848764",
      address: "10 Lynhurst Ave, Ottawa, ON K1V 9W7",
      status: "ARCHIVED",
      archived: true,
      stage: "Project Complete",
      accepted_proposal_total: 2472,
      source_evidence: {
        appointment: "Gmail 1997be08a3fe7614",
        proposal_accepted: "Gmail 199a066563102fa1",
        accepted_customer_reply: "Gmail 199bf003818d5875",
        weather_scheduling: "Gmail thread 19998a6515e7f0cb",
        material_receipt_email: "Gmail 199e817b6c323cc5",
        material_receipt: "Sherwin-Williams 2900-6",
      },
    },
    recovery_note:
      "Proposal 2101292 was absent from the 2026-07-31 DripJobs export. This accounting job is recovered from DripJobs-generated emails, the customer's accepted-proposal reply, the exact appointment address, and the named material receipt. No job value is created without a physical customer invoice.",
    recovered_at: new Date().toISOString(),
  },
  last_synced_at: new Date().toISOString(),
  labels: [{ name: "DripJobs email recovery" }, { name: "Project Complete" }],
  is_lead: false,
  companycam_status: "dripjobs_completed",
  is_deleted: false,
};

if (projectResult.data) {
  assert(projectResult.data.name === projectRow.name, "Recovered project name changed.");
  assert(
    projectResult.data.formatted_address === projectRow.formatted_address,
    "Recovered project address changed.",
  );
}

const report = {
  mode: apply ? "apply" : "dry-run",
  evidence: {
    proposal_id: "2101292",
    accepted_total: 2472,
    customer: "Jeffrey Roy / Jeffrey Ian",
    address: projectRow.formatted_address,
    receipt: `Sherwin-Williams ${RECEIPT_NUMBER}`,
    receipt_total: Number(receipt.total_amount),
    receipt_lines: receiptLines.length,
  },
  planned_project_insert: projectResult.data ? 0 : 1,
  applied_project_insert: 0,
};

if (!apply) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (!projectResult.data) {
  const inserted = await db.from("companycam_projects").insert(projectRow);
  if (inserted.error) throw inserted.error;
  report.applied_project_insert = 1;
}

const verified = await db
  .from("companycam_projects")
  .select("companycam_id,name,formatted_address,is_archived,is_lead,companycam_status")
  .eq("companycam_id", PROJECT_ID)
  .single();
if (verified.error) throw verified.error;
assert(verified.data.name === projectRow.name, "Recovered project did not persist.");
assert(verified.data.is_archived && !verified.data.is_lead, "Recovered job flags are invalid.");
console.log(JSON.stringify({ ...report, verified: verified.data }, null, 2));
