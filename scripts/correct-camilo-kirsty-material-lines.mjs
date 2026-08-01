#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const INVOICE_NUMBER = "8135-4";
const INVOICE_DATE = "2026-06-08";
const TARGET_PROJECT_ID = "104899421";
const TARGET_PROJECT_NAME = "Kirsty Harris";
const PROPOSAL_ID = "2818188";
const WORK_ORDER_GMAIL_MESSAGE_ID = "19e9a056075e7999";
const apply = process.argv.includes("--apply");
const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);

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
  ...parseEnvFile(
    path.resolve(repoRoot, "../Ottawa Painters App/.env.local"),
  ),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase credentials.");
}
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF) {
  throw new Error("Refusing correction for an unexpected Supabase project.");
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [invoiceResult, projectResult] = await Promise.all([
  db
    .from("material_invoices")
    .select(
      "id,invoice_number,invoice_date,po_number,total_amount,material_invoice_lines(id,line_number,product_code,description,quantity,amount_before_tax,tax_amount,total_amount,material_invoice_line_allocations(*))",
    )
    .eq("invoice_number", INVOICE_NUMBER)
    .eq("invoice_date", INVOICE_DATE)
    .single(),
  db
    .from("companycam_projects")
    .select("companycam_id,name,formatted_address,is_archived,is_deleted,is_lead")
    .eq("companycam_id", TARGET_PROJECT_ID)
    .single(),
]);
if (invoiceResult.error) throw invoiceResult.error;
if (projectResult.error) throw projectResult.error;

const invoice = invoiceResult.data;
const project = projectResult.data;
assert(invoice.po_number == null, "Expected the audited receipt to have no PO.");
assert(cents(invoice.total_amount) === 2_844, "Unexpected invoice total.");
assert(invoice.material_invoice_lines?.length === 2, "Expected two invoice lines.");
assert(project.name === TARGET_PROJECT_NAME, "Target project name changed.");
assert(
  project.formatted_address?.startsWith("1502 Tonilee Dr"),
  "Target project address changed.",
);
assert(!project.is_archived, "Target project is archived.");
assert(!project.is_deleted, "Target project is deleted.");
assert(!project.is_lead, "Target project is still a lead.");

const evidence =
  "Gmail 19e9a056075e7999 records Camilo Alvarez/Grutenco accepting the Kirsty Harris work order at 1502 Tonilee Dr on Friday June 5 and explicitly confirms a Monday June 8 start. Sherwin invoice 8135-4 was received by Camilo on June 8 and contains masking paper and contractor tape used to prepare that job.";
const plans = [];

for (const line of invoice.material_invoice_lines) {
  const allocations = line.material_invoice_line_allocations ?? [];
  const active = allocations.filter((allocation) => allocation.reversed_at == null);
  assert(active.length <= 1, `Line ${line.id} has multiple active allocations.`);
  if (
    active.length === 1 &&
    active[0].allocation_scope === "job" &&
    active[0].companycam_project_id === TARGET_PROJECT_ID &&
    active[0].overhead_category == null
  ) {
    continue;
  }
  if (active.length === 1) {
    assert(
      active[0].allocation_scope === "overhead" &&
        active[0].companycam_project_id == null &&
        active[0].overhead_category === "Shop supplies",
      `Line ${line.id} has an unexpected active allocation.`,
    );
  } else {
    assert(
      allocations.some(
        (allocation) =>
          allocation.reversed_at != null &&
          String(allocation.reversal_reason ?? "").includes(
            "Kirsty Harris work order",
          ),
      ),
      `Line ${line.id} has no active allocation or correction history.`,
    );
  }
  plans.push({ line, oldAllocation: active[0] ?? null });
}

const report = {
  mode: apply ? "apply" : "dry-run",
  invoice_number: INVOICE_NUMBER,
  invoice_date: INVOICE_DATE,
  invoice_total: Number(invoice.total_amount),
  target_project_id: TARGET_PROJECT_ID,
  target_project_name: TARGET_PROJECT_NAME,
  corrections: plans.map(({ line, oldAllocation }) => ({
    line_id: line.id,
    line_number: line.line_number,
    description: line.description,
    amount: Number(line.total_amount),
    from: oldAllocation
      ? `overhead:${oldAllocation.overhead_category}`
      : "reversed correction awaiting insert",
    to: `job:${TARGET_PROJECT_NAME}`,
  })),
  applied_reversals: 0,
  applied_job_allocations: 0,
};

if (!apply) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

for (const { line, oldAllocation } of plans) {
  if (oldAllocation) {
    const reversed = await db
      .from("material_invoice_line_allocations")
      .update({
        reversed_at: new Date().toISOString(),
        reversal_reason:
          "Corrected 2026-08-01: Gmail evidence proves this crew-purchased receipt was preparation for the Kirsty Harris work order starting the same day, not unassigned shop overhead.",
      })
      .eq("id", oldAllocation.id)
      .is("reversed_at", null)
      .select("id");
    if (reversed.error) throw reversed.error;
    assert(
      reversed.data?.length === 1,
      `Unexpected reversal count for line ${line.id}.`,
    );
    report.applied_reversals += 1;
  }

  const inserted = await db.from("material_invoice_line_allocations").insert({
    material_invoice_line_id: line.id,
    allocation_scope: "job",
    companycam_project_id: TARGET_PROJECT_ID,
    overhead_category: null,
    allocated_quantity: line.quantity,
    allocated_before_tax: line.amount_before_tax,
    allocated_tax: line.tax_amount,
    allocated_total: line.total_amount,
    allocation_method: "manual",
    evidence_reference: evidence,
    confidence: 1,
    needs_review: false,
    source_payload: {
      source: "gmail_subcontractor_work_order_and_receipt_purchaser",
      work_order_gmail_message_id: WORK_ORDER_GMAIL_MESSAGE_ID,
      proposal_id: PROPOSAL_ID,
      received_by: "CAMILO",
      actual_job_start_date: INVOICE_DATE,
      rule: "same-crew-purchaser plus explicit same-day job start",
      corrected_from_allocation_id: oldAllocation?.id ?? null,
    },
  });
  if (inserted.error) throw inserted.error;
  report.applied_job_allocations += 1;
}

const verified = await db
  .from("material_invoice_line_allocations")
  .select(
    "material_invoice_line_id,allocation_scope,companycam_project_id,overhead_category,reversed_at",
  )
  .in(
    "material_invoice_line_id",
    invoice.material_invoice_lines.map((line) => line.id),
  )
  .is("reversed_at", null);
if (verified.error) throw verified.error;
assert(
  verified.data?.length === invoice.material_invoice_lines.length,
  "Corrected active allocation count is invalid.",
);
for (const line of invoice.material_invoice_lines) {
  assert(
    verified.data.some(
      (allocation) =>
        allocation.material_invoice_line_id === line.id &&
        allocation.allocation_scope === "job" &&
        allocation.companycam_project_id === TARGET_PROJECT_ID &&
        allocation.overhead_category == null,
    ),
    `Corrected allocation did not persist for line ${line.id}.`,
  );
}

console.log(JSON.stringify(report, null, 2));
