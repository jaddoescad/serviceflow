#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const DUPLICATE_INVOICE_ID = "c5fb2783-4581-4469-9f07-f93b6213b5a6";
const SURVIVING_INVOICE_ID = "28a3a71a-a650-4eb5-9231-f72f1d470695";
const BANK_TRANSACTION_ID = "ce9d2d01-78ae-4c7c-9f2d-da1f05073ad3";
const DUPLICATE_PROPOSAL_ID = "2583136";
const SURVIVING_PROPOSAL_ID = "2195000";
const DUPLICATE_PROJECT_ID = `dripjobs-${DUPLICATE_PROPOSAL_ID}`;
const SURVIVING_PROJECT_ID = `dripjobs-${SURVIVING_PROPOSAL_ID}`;
const MATERIAL_LINE_IDS = [
  "929f39ee-480a-402d-8ecd-741658b37af8",
  "0aa1ef59-b831-492e-ab0e-fe49a508bef4",
  "bbb530d3-1f2d-4e3e-aaa6-89297d6d3053",
  "6fefae1d-0a81-4cf6-9612-16348b8dbd77",
];
const PARTIAL_PAYMENT = 6003.69;
const PRIOR_PAYMENT = 36022.14;
const SURVIVING_TOTAL = 42025.83;
const MATERIAL_BEFORE_TAX = 252.85;
const MATERIAL_TAX = 32.87;
const MATERIAL_TOTAL = 285.72;

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function money(value) {
  return Number(Number(value ?? 0).toFixed(2));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoError(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing Supabase credentials.");
assert(
  new URL(supabaseUrl).hostname.split(".")[0] === TARGET_PROJECT_REF,
  "Refusing reconciliation for an unexpected Supabase project.",
);

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function loadState() {
  const [
    invoiceResult,
    itemResult,
    allocationResult,
    transactionResult,
    jobResult,
    projectResult,
    materialAllocationResult,
  ] = await Promise.all([
    db
      .from("customer_invoices")
      .select(
        "id,invoice_number,invoice_date,customer_name,billing_address,external_proposal_id,subtotal,tax_amount,total_amount,source_paid_amount,source_balance,source_status,accounting_status,superseded_by_invoice_id,void_reason,voided_at",
      )
      .in("id", [DUPLICATE_INVOICE_ID, SURVIVING_INVOICE_ID]),
    db
      .from("customer_invoice_items")
      .select(
        "customer_invoice_id,line_number,description,quantity,amount_before_tax,tax_amount,total_amount",
      )
      .in("customer_invoice_id", [DUPLICATE_INVOICE_ID, SURVIVING_INVOICE_ID]),
    db
      .from("customer_invoice_bank_allocations")
      .select(
        "id,financial_transaction_id,customer_invoice_id,source_payment_event_id,allocated_amount,invoice_applied_amount,reversed_at,reversal_reason",
      )
      .eq("financial_transaction_id", BANK_TRANSACTION_ID),
    db
      .from("financial_transactions")
      .select(
        "id,posted_on,description,counterparty,amount,currency,transaction_type,category,is_transfer,review_status,notes,source_data",
      )
      .eq("id", BANK_TRANSACTION_ID)
      .single(),
    db
      .from("dripjobs_jobs")
      .select(
        "proposal_id,job_name,status,invoice_id,amount,paid_amount,balance_amount,accounting_status,superseded_by_proposal_id,accounting_note",
      )
      .in("proposal_id", [DUPLICATE_PROPOSAL_ID, SURVIVING_PROPOSAL_ID]),
    db
      .from("companycam_projects")
      .select("companycam_id,name,formatted_address")
      .in("companycam_id", [DUPLICATE_PROJECT_ID, SURVIVING_PROJECT_ID]),
    db
      .from("material_invoice_line_allocations")
      .select(
        "id,material_invoice_line_id,allocation_scope,companycam_project_id,overhead_category,allocated_quantity,allocated_before_tax,allocated_tax,allocated_total,allocation_method,evidence_reference,confidence,needs_review,source_payload,reversed_at,reversal_reason,material_invoice_lines(id,line_number,description,amount_before_tax,tax_amount,total_amount,material_invoices(id,invoice_number,invoice_date,supplier_name,po_number))",
      )
      .in("material_invoice_line_id", MATERIAL_LINE_IDS)
      .in("companycam_project_id", [
        DUPLICATE_PROJECT_ID,
        SURVIVING_PROJECT_ID,
      ]),
  ]);
  return {
    invoices: assertNoError("customer invoices", invoiceResult),
    items: assertNoError("invoice items", itemResult),
    allocations: assertNoError("bank allocations", allocationResult),
    transaction: assertNoError("bank transaction", transactionResult),
    jobs: assertNoError("DripJobs jobs", jobResult),
    projects: assertNoError("accounting projects", projectResult),
    materialAllocations: assertNoError(
      "material allocations",
      materialAllocationResult,
    ),
  };
}

function validate(state) {
  const duplicateInvoice = state.invoices.find(
    (row) => row.id === DUPLICATE_INVOICE_ID,
  );
  const survivingInvoice = state.invoices.find(
    (row) => row.id === SURVIVING_INVOICE_ID,
  );
  const duplicateJob = state.jobs.find(
    (row) => row.proposal_id === DUPLICATE_PROPOSAL_ID,
  );
  const survivingJob = state.jobs.find(
    (row) => row.proposal_id === SURVIVING_PROPOSAL_ID,
  );
  const duplicateAllocation = state.allocations.find(
    (row) =>
      row.customer_invoice_id === DUPLICATE_INVOICE_ID &&
      row.reversed_at == null,
  );
  const survivingAllocation = state.allocations.find(
    (row) =>
      row.customer_invoice_id === SURVIVING_INVOICE_ID &&
      row.reversed_at == null,
  );
  const duplicateProject = state.projects.find(
    (row) => row.companycam_id === DUPLICATE_PROJECT_ID,
  );
  const survivingProject = state.projects.find(
    (row) => row.companycam_id === SURVIVING_PROJECT_ID,
  );
  const activeDuplicateMaterialAllocations = state.materialAllocations.filter(
    (row) =>
      row.companycam_project_id === DUPLICATE_PROJECT_ID &&
      row.reversed_at == null,
  );
  const activeSurvivingMaterialAllocations = state.materialAllocations.filter(
    (row) =>
      row.companycam_project_id === SURVIVING_PROJECT_ID &&
      row.reversed_at == null,
  );

  assert(
    duplicateInvoice?.invoice_number === "399599",
    "Duplicate invoice changed.",
  );
  assert(
    survivingInvoice?.invoice_number === "399590",
    "Surviving invoice changed.",
  );
  assert(
    duplicateInvoice.customer_name === "Kim Switzer" &&
      survivingInvoice.customer_name === "Kim Switzer",
    "Invoice owner mismatch.",
  );
  assert(
    duplicateInvoice.billing_address === survivingInvoice.billing_address,
    "Invoice address mismatch.",
  );
  assert(
    duplicateInvoice.invoice_date === survivingInvoice.invoice_date,
    "Invoice dates do not match.",
  );
  assert(
    money(duplicateInvoice.total_amount) === PARTIAL_PAYMENT,
    "Duplicate invoice total changed.",
  );
  assert(
    money(survivingInvoice.total_amount) === SURVIVING_TOTAL,
    "Surviving invoice total changed.",
  );
  assert(
    duplicateJob?.status === "ARCHIVED",
    "Duplicate proposal is not archived.",
  );
  assert(
    survivingJob?.status === "COMPLETED",
    "Surviving proposal is not completed.",
  );
  assert(
    duplicateJob.invoice_id === "#399599",
    "Duplicate job invoice changed.",
  );
  assert(
    survivingJob.invoice_id === "#399590",
    "Surviving job invoice changed.",
  );
  assert(
    money(state.transaction.amount) === PARTIAL_PAYMENT,
    "Bank amount changed.",
  );
  assert(state.transaction.posted_on === "2026-04-06", "Bank date changed.");
  assert(
    state.transaction.transaction_type === "income",
    "Bank row is not income.",
  );
  assert(
    state.transaction.category === "Painting revenue",
    "Bank category changed.",
  );
  assert(!state.transaction.is_transfer, "Bank row is marked as a transfer.");
  assert(
    duplicateProject?.name === "Kim Switzer — proposal 2583136 (completed)",
    "Duplicate accounting project changed.",
  );
  assert(
    survivingProject?.name === "Kim Switzer — proposal 2195000",
    "Surviving accounting project changed.",
  );

  const duplicateItems = state.items.filter(
    (row) =>
      row.customer_invoice_id === DUPLICATE_INVOICE_ID &&
      money(row.total_amount) > 0,
  );
  const survivingItems = state.items.filter(
    (row) => row.customer_invoice_id === SURVIVING_INVOICE_ID,
  );
  assert(duplicateItems.length === 2, "Duplicate invoice item set changed.");
  for (const item of duplicateItems) {
    const matchingItems = survivingItems.filter(
      (candidate) =>
        candidate.description === item.description &&
        money(candidate.amount_before_tax) === money(item.amount_before_tax) &&
        money(candidate.tax_amount) === money(item.tax_amount) &&
        money(candidate.total_amount) === money(item.total_amount),
    );
    assert(
      matchingItems.length === 1,
      `Duplicate item ${item.description} is not uniquely present in #399590.`,
    );
  }

  assert(
    !(
      activeDuplicateMaterialAllocations.length > 0 &&
      activeSurvivingMaterialAllocations.length > 0
    ),
    "Kim material lines are actively allocated to both proposals.",
  );
  const activeMaterialAllocations =
    activeSurvivingMaterialAllocations.length > 0
      ? activeSurvivingMaterialAllocations
      : activeDuplicateMaterialAllocations;
  assert(
    activeMaterialAllocations.length === MATERIAL_LINE_IDS.length,
    "Kim material allocation set changed.",
  );
  assert(
    new Set(
      activeMaterialAllocations.map((row) => row.material_invoice_line_id),
    ).size === MATERIAL_LINE_IDS.length,
    "Kim material lines are not uniquely allocated.",
  );
  assert(
    money(
      activeMaterialAllocations.reduce(
        (sum, row) => sum + Number(row.allocated_before_tax),
        0,
      ),
    ) === MATERIAL_BEFORE_TAX,
    "Kim material amount before HST changed.",
  );
  assert(
    money(
      activeMaterialAllocations.reduce(
        (sum, row) => sum + Number(row.allocated_tax),
        0,
      ),
    ) === MATERIAL_TAX,
    "Kim material HST changed.",
  );
  assert(
    money(
      activeMaterialAllocations.reduce(
        (sum, row) => sum + Number(row.allocated_total),
        0,
      ),
    ) === MATERIAL_TOTAL,
    "Kim material total changed.",
  );
  for (const allocation of activeMaterialAllocations) {
    const invoice = allocation.material_invoice_lines?.material_invoices;
    assert(
      invoice?.supplier_name === "Sherwin-Williams Canada" &&
        invoice.invoice_number === "3282-6" &&
        invoice.invoice_date === "2026-03-10" &&
        invoice.po_number === "3791 CANYON WLAK",
      `Material evidence changed for line ${allocation.material_invoice_line_id}.`,
    );
  }

  if (duplicateInvoice.accounting_status === "active") {
    assert(duplicateAllocation, "Original $6,003.69 allocation is missing.");
    assert(
      money(duplicateAllocation.allocated_amount) === PARTIAL_PAYMENT,
      "Original allocation amount changed.",
    );
  }

  return {
    duplicateInvoice,
    survivingInvoice,
    duplicateJob,
    survivingJob,
    duplicateAllocation,
    survivingAllocation,
    duplicateItems,
    activeDuplicateMaterialAllocations,
    activeSurvivingMaterialAllocations,
  };
}

const before = await loadState();
const checkedBefore = validate(before);
const invoiceAlreadyApplied =
  checkedBefore.duplicateInvoice.accounting_status === "void" &&
  checkedBefore.duplicateJob.accounting_status === "superseded" &&
  checkedBefore.duplicateInvoice.superseded_by_invoice_id ===
    SURVIVING_INVOICE_ID &&
  checkedBefore.survivingAllocation != null;
const materialAlreadyApplied =
  checkedBefore.activeDuplicateMaterialAllocations.length === 0 &&
  checkedBefore.activeSurvivingMaterialAllocations.length ===
    MATERIAL_LINE_IDS.length;
const alreadyApplied = invoiceAlreadyApplied && materialAlreadyApplied;

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: TARGET_PROJECT_REF,
      customer: "Kim Switzer",
      action:
        "supersede duplicate partial invoice, move its bank evidence, and preserve its material costs on the consolidated job",
      evidence: {
        duplicate_invoice: "399599",
        duplicate_total: PARTIAL_PAYMENT,
        duplicate_items: checkedBefore.duplicateItems.map(
          (item) => item.description,
        ),
        duplicate_proposal_status: checkedBefore.duplicateJob.status,
        surviving_invoice: "399590",
        surviving_total: SURVIVING_TOTAL,
        existing_surviving_payment: PRIOR_PAYMENT,
        combined_bank_cash: money(PRIOR_PAYMENT + PARTIAL_PAYMENT),
        material_invoice: "3282-6",
        material_before_hst: MATERIAL_BEFORE_TAX,
        material_hst: MATERIAL_TAX,
        material_total: MATERIAL_TOTAL,
      },
      invoice_already_applied: invoiceAlreadyApplied,
      material_already_applied: materialAlreadyApplied,
      already_applied: alreadyApplied,
    },
    null,
    2,
  ),
);

if (!APPLY || alreadyApplied) process.exit(0);

const now = new Date().toISOString();
const reason =
  "Ottawa Painters confirmed Kim Switzer invoice #399599 is a superseded partial invoice. Its two items are already included in consolidated invoice #399590, and the $6,003.69 cheque combines with $36,022.14 to settle #399590 at exactly $42,025.83.";

if (!invoiceAlreadyApplied) {
  assertNoError(
    "reverse duplicate-invoice allocation",
    await db
      .from("customer_invoice_bank_allocations")
      .update({
        reversed_at: now,
        reversal_reason: reason,
      })
      .eq("id", checkedBefore.duplicateAllocation.id)
      .is("reversed_at", null),
  );

  assertNoError(
    "void duplicate invoice",
    await db
      .from("customer_invoices")
      .update({
        accounting_status: "void",
        superseded_by_invoice_id: SURVIVING_INVOICE_ID,
        void_reason: reason,
        voided_at: now,
      })
      .eq("id", DUPLICATE_INVOICE_ID),
  );

  assertNoError(
    "supersede duplicate proposal",
    await db
      .from("dripjobs_jobs")
      .update({
        accounting_status: "superseded",
        superseded_by_proposal_id: SURVIVING_PROPOSAL_ID,
        accounting_note: reason,
        accounting_status_updated_at: now,
      })
      .eq("proposal_id", DUPLICATE_PROPOSAL_ID),
  );

  assertNoError(
    "insert consolidated-invoice allocation",
    await db.from("customer_invoice_bank_allocations").insert({
      financial_transaction_id: BANK_TRANSACTION_ID,
      customer_invoice_id: SURVIVING_INVOICE_ID,
      source_payment_event_id: null,
      allocated_amount: PARTIAL_PAYMENT,
      invoice_applied_amount: PARTIAL_PAYMENT,
      match_method: [
        "invoice_supersession",
        "duplicate_invoice_items",
        "exact_bank_amount",
        "owner_confirmed_2026_08_02",
      ],
      confidence: "confirmed",
      evidence_note:
        "Invoice #399599 is an archived partial invoice whose two $6,003.69 items are already printed on consolidated invoice #399590. Ottawa Painters confirmed the cheque belongs to #399590; combined with $36,022.14 it exactly settles $42,025.83.",
      confirmed_at: now,
    }),
  );

  const sourceData = before.transaction.source_data ?? {};
  assertNoError(
    "update bank settlement evidence",
    await db
      .from("financial_transactions")
      .update({
        counterparty: "Kim Switzer",
        review_status: "reconciled",
        notes:
          "Kim Switzer cheque reassigned from superseded partial invoice #399599 to consolidated invoice #399590.",
        source_data: {
          ...sourceData,
          customer_revenue_identity: {
            ...(sourceData.customer_revenue_identity ?? {}),
            status: "confirmed",
            customer_name: "Kim Switzer",
            active_invoice_number: "399590",
            active_proposal_id: SURVIVING_PROPOSAL_ID,
            void_invoice_number: "399599",
            void_proposal_id: DUPLICATE_PROPOSAL_ID,
            confirmation_source: "owner_confirmation",
            confirmed_on: "2026-08-02",
          },
          customer_revenue_settlement: {
            status: "fully_allocated",
            allocated_amount: PARTIAL_PAYMENT,
            unallocated_amount: 0,
            customer_invoice_ids: [SURVIVING_INVOICE_ID],
            active_invoice_id: SURVIVING_INVOICE_ID,
            void_invoice_id: DUPLICATE_INVOICE_ID,
            reassigned_at: now,
            rule: "customer_invoice_bank_allocations_are_settlement_truth",
          },
        },
      })
      .eq("id", BANK_TRANSACTION_ID),
  );
}

if (!materialAlreadyApplied) {
  const materialReason =
    "Moved from superseded Kim Switzer proposal 2583136 to surviving proposal 2195000. The archived partial proposal is a duplicate of consolidated invoice #399590, while Sherwin-Williams invoice #3282-6 PO 3791 CANYON WLAK remains a legitimate cost of the same customer job.";

  for (const allocation of checkedBefore.activeDuplicateMaterialAllocations) {
    const reversed = assertNoError(
      `reverse material allocation ${allocation.id}`,
      await db
        .from("material_invoice_line_allocations")
        .update({
          reversed_at: now,
          reversal_reason: materialReason,
        })
        .eq("id", allocation.id)
        .is("reversed_at", null)
        .select("id"),
    );
    assert(
      reversed.length === 1,
      `Unexpected reversal count for material allocation ${allocation.id}.`,
    );

    assertNoError(
      `insert material allocation ${allocation.material_invoice_line_id}`,
      await db.from("material_invoice_line_allocations").insert({
        material_invoice_line_id: allocation.material_invoice_line_id,
        allocation_scope: "job",
        companycam_project_id: SURVIVING_PROJECT_ID,
        overhead_category: null,
        allocated_quantity: allocation.allocated_quantity,
        allocated_before_tax: allocation.allocated_before_tax,
        allocated_tax: allocation.allocated_tax,
        allocated_total: allocation.allocated_total,
        allocation_method: "manual",
        evidence_reference:
          "Sherwin-Williams Canada invoice #3282-6 PO 3791 CANYON WLAK · Kim Switzer consolidated DripJobs proposal 2195000",
        confidence: 1,
        needs_review: false,
        source_payload: {
          ...(allocation.source_payload ?? {}),
          proposal_id: SURVIVING_PROPOSAL_ID,
          source_proposal_id: DUPLICATE_PROPOSAL_ID,
          source_allocation_id: allocation.id,
          moved_on: "2026-08-02",
          matching_rule:
            "exact customer address and owner-confirmed invoice supersession",
        },
      }),
    );
  }
}

const after = await loadState();
const checkedAfter = validate(after);
assert(
  checkedAfter.duplicateInvoice.accounting_status === "void",
  "Duplicate invoice is not void.",
);
assert(
  checkedAfter.duplicateInvoice.superseded_by_invoice_id ===
    SURVIVING_INVOICE_ID,
  "Duplicate invoice supersession is missing.",
);
assert(
  checkedAfter.duplicateJob.accounting_status === "superseded" &&
    checkedAfter.duplicateJob.superseded_by_proposal_id ===
      SURVIVING_PROPOSAL_ID,
  "Duplicate proposal supersession is missing.",
);
assert(
  checkedAfter.activeDuplicateMaterialAllocations.length === 0 &&
    checkedAfter.activeSurvivingMaterialAllocations.length ===
      MATERIAL_LINE_IDS.length,
  "Kim material costs were not preserved on the surviving job.",
);
assert(
  checkedAfter.survivingAllocation &&
    money(checkedAfter.survivingAllocation.allocated_amount) ===
      PARTIAL_PAYMENT,
  "Consolidated-invoice allocation is missing.",
);

const verification = assertNoError(
  "surviving invoice verification",
  await db
    .from("customer_invoice_verification")
    .select(
      "invoice_number,total_amount,bank_cash_amount,bank_paid_amount,amount_remaining,bank_payment_status,verification_status",
    )
    .eq("customer_invoice_id", SURVIVING_INVOICE_ID)
    .single(),
);
assert(
  money(verification.bank_paid_amount) === SURVIVING_TOTAL,
  "Kim invoice credit does not equal $42,025.83.",
);
assert(
  money(verification.bank_cash_amount) === SURVIVING_TOTAL,
  "Kim bank cash does not equal $42,025.83.",
);
assert(
  money(verification.amount_remaining) === 0,
  "Kim invoice is still open.",
);
assert(verification.bank_payment_status === "paid", "Kim invoice is not paid.");
assert(
  verification.verification_status === "verified",
  "Kim invoice is not verified.",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      void_invoice: "399599",
      surviving_invoice: "399590",
      reassigned_bank_cash: PARTIAL_PAYMENT,
      combined_bank_cash: SURVIVING_TOTAL,
      material_lines_moved:
        checkedBefore.activeDuplicateMaterialAllocations.length,
      material_before_hst_preserved: MATERIAL_BEFORE_TAX,
      material_hst_preserved: MATERIAL_TAX,
      material_total_preserved: MATERIAL_TOTAL,
      verification,
    },
    null,
    2,
  ),
);
