#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const INVOICE_NUMBER = "8957-0";
const apply = process.argv.includes("--apply");
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const corrections = [
  {
    lineId: "8b7ef828-9289-407b-9963-04034671739d",
    productCode: "SD7TQ0254 SPRDK",
    expectedTotal: 123.06,
    projectId: "104252366",
    projectName: "Tareq Shiblaq",
    proposalId: "2790387",
    evidence:
      "Sherwin invoice 8957-0 line 1 is custom stain labelled MTC TAREQ. Gmail thread 19e42137e30b11e6 is the May 19 DripJobs work order for Tareq Shiblaq at 1327 S Beach Blvd; Gmail 19e50f62f56c1a30 and Interac Gmail 19e50f162502a7a1 confirm final payment for the same job on May 22.",
    sourcePayload: {
      work_order_gmail_thread_id: "19e42137e30b11e6",
      invoice_payment_gmail_message_id: "19e50f62f56c1a30",
      interac_gmail_message_id: "19e50f162502a7a1",
    },
  },
  {
    lineId: "9daee320-f90c-4bf9-b069-ef5672707001",
    productCode: "K62WQ1651 LATIT",
    expectedTotal: 155.83,
    projectId: "105302560",
    projectName: "Saroeun Cole",
    proposalId: "2792078",
    evidence:
      "Sherwin invoice 8957-0 line 2 is Latitude exterior paint labelled MTC COLE WHITE, purchased on Saroeun Cole's verified first job day for DripJobs proposal 2792078. Gmail 19e69bbc126a5d7c confirms the same customer's active change order, and subcontractor payment Gmail 19e6663e2d98878c explicitly includes Saroeun Cole.",
    sourcePayload: {
      change_order_gmail_message_id: "19e69bbc126a5d7c",
      subcontractor_payment_gmail_message_id: "19e6663e2d98878c",
    },
  },
  {
    lineId: "fea809fb-4e8d-4c96-a4f9-bcf8d851892e",
    productCode: "CLRTP",
    expectedTotal: 140.01,
    projectId: "dripjobs-2658593",
    projectName: "Rashonda Legault — proposal 2658593",
    proposalId: "2658593",
    evidence:
      "Sherwin invoice 8957-0 line 3 is custom stain labelled MTC RASHONDA, purchased during Rashonda Legault's verified May 20-27 DripJobs proposal 2658593 job. The identical MTC RASHONDA product on invoice 2887-2 is already allocated to that job, and subcontractor payment Gmail 19e6663e2d98878c explicitly includes Rashonda Legault.",
    sourcePayload: {
      related_material_invoice: "2887-2",
      subcontractor_payment_gmail_message_id: "19e6663e2d98878c",
    },
  },
];

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
  throw new Error("Refusing correction for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [invoiceResult, projectsResult] = await Promise.all([
  db
    .from("material_invoices")
    .select(
      "id,invoice_number,invoice_date,po_number,total_amount,material_invoice_lines(id,line_number,product_code,quantity,amount_before_tax,tax_amount,total_amount,material_invoice_line_allocations(*))",
    )
    .eq("invoice_number", INVOICE_NUMBER)
    .single(),
  db
    .from("companycam_projects")
    .select("companycam_id,name,is_deleted")
    .in(
      "companycam_id",
      corrections.map((correction) => correction.projectId),
    ),
]);
if (invoiceResult.error) throw invoiceResult.error;
if (projectsResult.error) throw projectsResult.error;

const invoice = invoiceResult.data;
assert(invoice.invoice_date === "2026-05-21", "Unexpected invoice date.");
assert(invoice.po_number === "FRANCISCO SUPPLIES", "Unexpected invoice PO.");
assert(cents(invoice.total_amount) === 68_565, "Unexpected invoice total.");
assert(invoice.material_invoice_lines?.length === 8, "Expected eight invoice lines.");

const projectsById = new Map(
  (projectsResult.data ?? []).map((project) => [project.companycam_id, project]),
);
const linesById = new Map(
  (invoice.material_invoice_lines ?? []).map((line) => [line.id, line]),
);
const plans = [];

for (const correction of corrections) {
  const project = projectsById.get(correction.projectId);
  assert(project, `Missing target project ${correction.projectId}.`);
  assert(project.name === correction.projectName, `Target project name changed for ${correction.projectId}.`);
  assert(!project.is_deleted, `Target project ${correction.projectId} is deleted.`);

  const line = linesById.get(correction.lineId);
  assert(line, `Missing material line ${correction.lineId}.`);
  assert(line.product_code === correction.productCode, `Product changed for line ${line.id}.`);
  assert(cents(line.total_amount) === cents(correction.expectedTotal), `Amount changed for line ${line.id}.`);

  const allocations = line.material_invoice_line_allocations ?? [];
  const active = allocations.filter((allocation) => allocation.reversed_at == null);
  if (
    active.length === 1 &&
    active[0].allocation_scope === "job" &&
    active[0].companycam_project_id === correction.projectId &&
    active[0].overhead_category == null
  ) {
    continue;
  }
  assert(active.length <= 1, `Line ${line.id} has multiple active allocations.`);
  if (active.length === 1) {
    assert(active[0].allocation_scope === "overhead", `Line ${line.id} is not overhead.`);
    assert(active[0].companycam_project_id == null, `Line ${line.id} already targets another job.`);
    assert(
      active[0].overhead_category === "General paint supplies",
      `Line ${line.id} has an unexpected overhead category.`,
    );
  } else {
    assert(
      allocations.some(
        (allocation) =>
          allocation.reversed_at != null &&
          String(allocation.reversal_reason ?? "").includes("customer-labelled paint"),
      ),
      `Line ${line.id} has no active allocation and no audited correction history.`,
    );
  }
  plans.push({ correction, line, oldAllocation: active[0] ?? null });
}

const report = {
  mode: apply ? "apply" : "dry-run",
  invoice_number: INVOICE_NUMBER,
  invoice_total: Number(invoice.total_amount),
  corrections: plans.map(({ correction, line, oldAllocation }) => ({
    line_id: line.id,
    line_number: line.line_number,
    amount: Number(line.total_amount),
    from: oldAllocation ? oldAllocation.overhead_category : "reversed correction awaiting insert",
    to_project_id: correction.projectId,
    to_project_name: correction.projectName,
  })),
  applied_reversals: 0,
  applied_job_allocations: 0,
};

if (!apply) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

for (const { correction, line, oldAllocation } of plans) {
  if (oldAllocation) {
    const reversed = await db
      .from("material_invoice_line_allocations")
      .update({
        reversed_at: new Date().toISOString(),
        reversal_reason:
          "Corrected 2026-08-01: customer-labelled paint line was incorrectly classified as general overhead.",
      })
      .eq("id", oldAllocation.id)
      .is("reversed_at", null)
      .select("id");
    if (reversed.error) throw reversed.error;
    assert(reversed.data?.length === 1, `Unexpected reversal count for line ${line.id}.`);
    report.applied_reversals += 1;
  }

  const inserted = await db.from("material_invoice_line_allocations").insert({
    material_invoice_line_id: line.id,
    allocation_scope: "job",
    companycam_project_id: correction.projectId,
    overhead_category: null,
    allocated_quantity: line.quantity,
    allocated_before_tax: line.amount_before_tax,
    allocated_tax: line.tax_amount,
    allocated_total: line.total_amount,
    allocation_method: "manual",
    evidence_reference: correction.evidence,
    confidence: 1,
    needs_review: false,
    source_payload: {
      ...correction.sourcePayload,
      proposal_id: correction.proposalId,
      rule: "customer-labelled paint overrides generic whole-invoice PO overhead classification",
      corrected_from_allocation_id: oldAllocation?.id ?? null,
    },
  });
  if (inserted.error) throw inserted.error;
  report.applied_job_allocations += 1;
}

const verified = await db
  .from("material_invoice_line_allocations")
  .select("material_invoice_line_id,allocation_scope,companycam_project_id,overhead_category,reversed_at")
  .in(
    "material_invoice_line_id",
    corrections.map((correction) => correction.lineId),
  )
  .is("reversed_at", null);
if (verified.error) throw verified.error;
assert(verified.data?.length === corrections.length, "Corrected active allocation count is invalid.");
for (const correction of corrections) {
  assert(
    verified.data.some(
      (allocation) =>
        allocation.material_invoice_line_id === correction.lineId &&
        allocation.allocation_scope === "job" &&
        allocation.companycam_project_id === correction.projectId &&
        allocation.overhead_category == null,
    ),
    `Corrected allocation did not persist for line ${correction.lineId}.`,
  );
}
console.log(JSON.stringify(report, null, 2));
