#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const PROJECT_ID = "dripjobs-1889052";
const RECEIPT_EXTERNAL_ID = "sherwin-store-receipt:0449-2:2025-08-13";
const LABOUR_LINE_ID = "9c3b0ef4-74ff-400c-8e0b-dc0acde6cd04";
const INCORRECT_LABOUR_PROJECT_ID = "dripjobs-1865720";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const apply = process.argv.includes("--apply");

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

const [projectResult, receiptResult, labourLineResult] = await Promise.all([
  db.from("companycam_projects").select("*").eq("companycam_id", PROJECT_ID).maybeSingle(),
  db
    .from("material_invoices")
    .select(
      "id,source_system,external_invoice_id,supplier_name,invoice_number,invoice_date,po_number,amount_before_tax,tax_amount,total_amount,material_invoice_lines(*)",
    )
    .eq("source_system", "gmail_sherwin_store_receipt")
    .eq("external_invoice_id", RECEIPT_EXTERNAL_ID)
    .single(),
  db
    .from("labour_invoice_lines")
    .select(
      "id,invoice_id,description,amount_before_tax,labour_invoice_line_allocations(*)",
    )
    .eq("id", LABOUR_LINE_ID)
    .single(),
]);
if (projectResult.error) throw projectResult.error;
if (receiptResult.error) throw receiptResult.error;
if (labourLineResult.error) throw labourLineResult.error;

const receipt = receiptResult.data;
const receiptLines = receipt.material_invoice_lines ?? [];
assert(receipt.supplier_name === "Sherwin-Williams Canada", "Unexpected receipt supplier.");
assert(receipt.invoice_number === "0449-2", "Unexpected receipt number.");
assert(receipt.invoice_date === "2025-08-13", "Unexpected receipt date.");
assert(receipt.po_number === "SCOTT", "Unexpected receipt PO.");
assert(cents(receipt.amount_before_tax) === 16_633, "Unexpected receipt subtotal.");
assert(cents(receipt.tax_amount) === 2_162, "Unexpected receipt HST.");
assert(cents(receipt.total_amount) === 18_795, "Unexpected receipt total.");
assert(receiptLines.length === 7, "Expected seven structured receipt lines.");
assert(
  receiptLines.reduce((sum, line) => sum + cents(line.amount_before_tax), 0) === 16_633,
  "Receipt line subtotal changed.",
);
const receiptColours = new Set(
  receiptLines.map((line) => String(line.color_name ?? "").toLowerCase()).filter(Boolean),
);
for (const colour of ["sea salt", "alabaster", "black magic", "evergreen fog"]) {
  assert(receiptColours.has(colour), `Receipt is missing ${colour}.`);
}

const labourLine = labourLineResult.data;
assert(/Scott MacEwen/i.test(labourLine.description), "Unexpected labour invoice line.");
assert(cents(labourLine.amount_before_tax) === 590_000, "Unexpected labour line amount.");
const labourAllocations = labourLine.labour_invoice_line_allocations ?? [];
assert(labourAllocations.length === 1, "Expected one labour job allocation.");
assert(
  [INCORRECT_LABOUR_PROJECT_ID, PROJECT_ID].includes(
    labourAllocations[0].companycam_project_id,
  ),
  "Labour allocation no longer matches the audited before-state or target state.",
);

const activeMaterialAllocationsResult = await db
  .from("material_invoice_line_allocations")
  .select("*")
  .in(
    "material_invoice_line_id",
    receiptLines.map((line) => line.id),
  )
  .is("reversed_at", null);
if (activeMaterialAllocationsResult.error) throw activeMaterialAllocationsResult.error;
const activeMaterialAllocations = activeMaterialAllocationsResult.data ?? [];
assert(
  activeMaterialAllocations.length === 0 ||
    (activeMaterialAllocations.length === receiptLines.length &&
      activeMaterialAllocations.every(
        (allocation) => allocation.companycam_project_id === PROJECT_ID,
      )),
  "Receipt lines already have a different active allocation.",
);

const projectRow = {
  companycam_id: PROJECT_ID,
  name: "Scott MacEwen — proposal 1889052 (completed)",
  street_address_1: "263 Waymark Crescent",
  street_address_2: null,
  city: "Ottawa",
  state: "ON",
  postal_code: "K2M 0A5",
  country: "CA",
  formatted_address: "263 Waymark Crescent, Ottawa, ON, K2M 0A5",
  latitude: null,
  longitude: null,
  is_archived: true,
  companycam_created_at: "2025-07-22T16:12:16Z",
  companycam_updated_at: "2025-09-17T13:06:19Z",
  raw: {
    source: "dripjobs_email_accounting_job",
    dripjobs: {
      proposal_id: "1889052",
      proposal_uuid: null,
      customer_name: "Scott MacEwen",
      job_name: "Scott MacEwen",
      email: "smacewen@bell.net",
      address: "263 Waymark Crescent, Ottawa, ON K2M 0A5",
      status: "ARCHIVED",
      archived: true,
      stage: "Project Complete",
      deal_stage: "Project Complete",
      accepted_proposal_total: 14227.45,
      later_signed_agreement_total: 12169.9,
      source_evidence: {
        appointment: "Gmail 19832e839386dd8a",
        proposal_accepted: "Gmail 19889de284307470",
        colour_confirmation: [
          "Gmail 1989ff693f9eb3ea",
          "Gmail 198a02943f47dfb8",
          "Gmail 198a408d3331973b",
        ],
        progress_payment: "Gmail 19957c87685223bf",
        receipt: "Gmail 198b2d23d426b449",
      },
    },
    recovery_note:
      "Proposal 1889052 was absent from the 2026-07-31 DripJobs export. This accounting job is recovered from DripJobs-generated emails and the exact customer correspondence; no job value is created without the physical customer invoice.",
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
    dripjobs_proposal: "1889052",
    customer: "Scott MacEwen",
    address: projectRow.formatted_address,
    receipt: "Sherwin-Williams 0449-2",
    receipt_total: Number(receipt.total_amount),
    receipt_lines: receiptLines.length,
    labour_line: labourLine.description,
    labour_amount: Number(labourLine.amount_before_tax),
  },
  planned: {
    project_insert: projectResult.data ? 0 : 1,
    labour_allocation_correction:
      labourAllocations[0].companycam_project_id === PROJECT_ID ? 0 : 1,
    material_line_allocations:
      activeMaterialAllocations.length === receiptLines.length ? 0 : receiptLines.length,
  },
  applied: {
    project_insert: 0,
    labour_allocation_correction: 0,
    material_line_allocations: 0,
  },
};

if (!apply) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (!projectResult.data) {
  const insertedProject = await db.from("companycam_projects").insert(projectRow);
  if (insertedProject.error) throw insertedProject.error;
  report.applied.project_insert = 1;
}

if (labourAllocations[0].companycam_project_id !== PROJECT_ID) {
  const correctedLabour = await db
    .from("labour_invoice_line_allocations")
    .update({
      companycam_project_id: PROJECT_ID,
      allocation_method: [
        "physical_invoice_names_scott_macewen",
        "dripjobs_proposal_1889052_recovered_from_email",
        "corrected_unrelated_project_allocation_20260801",
      ],
      needs_review: false,
    })
    .eq("invoice_line_id", LABOUR_LINE_ID)
    .eq("companycam_project_id", INCORRECT_LABOUR_PROJECT_ID)
    .select("invoice_line_id");
  if (correctedLabour.error) throw correctedLabour.error;
  assert(correctedLabour.data?.length === 1, "Labour correction affected an unexpected row count.");
  report.applied.labour_allocation_correction = 1;
}

if (!activeMaterialAllocations.length) {
  const insertedMaterial = await db.from("material_invoice_line_allocations").insert(
    receiptLines.map((line) => ({
      material_invoice_line_id: line.id,
      allocation_scope: "job",
      companycam_project_id: PROJECT_ID,
      overhead_category: null,
      allocated_quantity: line.quantity,
      allocated_before_tax: line.amount_before_tax,
      allocated_tax: line.tax_amount,
      allocated_total: line.total_amount,
      allocation_method: "manual",
      evidence_reference:
        "Sherwin receipt 0449-2 · DripJobs proposal 1889052 · exact Scott MacEwen colour conversation",
      confidence: 1,
      needs_review: false,
      source_payload: {
        project_name: "Scott MacEwen",
        proposal_id: "1889052",
        receipt_gmail_message_id: "198b2d23d426b449",
        proposal_gmail_message_id: "19889de284307470",
        appointment_gmail_message_id: "19832e839386dd8a",
        colour_gmail_message_ids: [
          "1989ff693f9eb3ea",
          "198a02943f47dfb8",
          "198a408d3331973b",
        ],
        rule:
          "PO SCOTT plus exact four-colour correspondence one day before purchase, tied to DripJobs proposal 1889052",
      },
    })),
  );
  if (insertedMaterial.error) throw insertedMaterial.error;
  report.applied.material_line_allocations = receiptLines.length;
}

const [verifiedProject, verifiedLabour, verifiedMaterial] = await Promise.all([
  db.from("companycam_projects").select("companycam_id,name,formatted_address").eq("companycam_id", PROJECT_ID).single(),
  db.from("labour_invoice_line_allocations").select("companycam_project_id").eq("invoice_line_id", LABOUR_LINE_ID).single(),
  db
    .from("material_invoice_line_allocations")
    .select("companycam_project_id,allocated_before_tax,allocated_tax,allocated_total")
    .in("material_invoice_line_id", receiptLines.map((line) => line.id))
    .is("reversed_at", null),
]);
if (verifiedProject.error) throw verifiedProject.error;
if (verifiedLabour.error) throw verifiedLabour.error;
if (verifiedMaterial.error) throw verifiedMaterial.error;
assert(verifiedLabour.data.companycam_project_id === PROJECT_ID, "Labour correction did not persist.");
assert(verifiedMaterial.data?.length === receiptLines.length, "Material allocations did not persist.");
assert(
  verifiedMaterial.data.every((row) => row.companycam_project_id === PROJECT_ID),
  "Material allocation target mismatch.",
);
assert(
  verifiedMaterial.data.reduce((sum, row) => sum + cents(row.allocated_total), 0) ===
    cents(receipt.total_amount),
  "Material allocation total mismatch.",
);

console.log(JSON.stringify(report, null, 2));
