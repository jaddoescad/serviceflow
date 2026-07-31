import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CURRENT_PROJECT_ID = "97216872";
const COMPLETED_PROJECT_ID = "dripjobs-2390920";
const COMPLETED_PROPOSAL_UUID = "127094288004291df8b66843b6ad47";
const CURRENT_PROPOSAL_UUID = "940461602060f6c08356384505b64b";
const ANGEL_INVOICE_ID = "dbb0c085-568b-4fc0-8f1a-238a2c5e955b";

const targetLines = [
  {
    id: "29987cab-299d-4ed6-9d0b-42986666f5cd",
    date: "2026-02-12",
    amount: 325,
  },
  {
    id: "196a04ff-25b6-4220-b6dc-86b638e21cdc",
    date: "2026-02-13",
    amount: 343.75,
  },
  {
    id: "f4077c7e-a0dd-4b4b-93f3-70718cca1b07",
    date: "2026-02-17",
    amount: 312.5,
  },
];

function loadEnv(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator),
          line
            .slice(separator + 1)
            .replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
}

function assertNoError(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const env = loadEnv(
  "/Users/jadslim/Desktop/Ottawa Painters App/.env.local",
);
const supabaseUrl =
  env.SUPABASE_URL ??
  env.NEXT_PUBLIC_SUPABASE_URL ??
  env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [projects, customerInvoices, lines, existingAllocations, currentBudget] =
  await Promise.all([
    db
      .from("companycam_projects")
      .select("companycam_id,name,formatted_address,is_archived,companycam_status")
      .in("companycam_id", [CURRENT_PROJECT_ID, COMPLETED_PROJECT_ID]),
    db
      .from("customer_invoices")
      .select(
        "id,invoice_number,invoice_date,companycam_project_id,subtotal,tax_amount,total_amount,source_paid_amount,source_balance,source_status,external_proposal_uuid,is_archived_job",
      )
      .in("external_proposal_uuid", [
        COMPLETED_PROPOSAL_UUID,
        CURRENT_PROPOSAL_UUID,
      ]),
    db
      .from("labour_invoice_lines")
      .select(
        "id,invoice_id,line_number,description,service_started_on,amount_before_tax,source_text,needs_review",
      )
      .in(
        "id",
        targetLines.map((line) => line.id),
      ),
    db
      .from("labour_invoice_line_allocations")
      .select(
        "invoice_line_id,companycam_project_id,allocated_amount,allocation_method,needs_review",
      )
      .in(
        "invoice_line_id",
        targetLines.map((line) => line.id),
      ),
    db
      .from("project_budgets")
      .select("*")
      .eq("companycam_project_id", CURRENT_PROJECT_ID),
  ]);

const projectRows = assertNoError("projects", projects);
const customerInvoiceRows = assertNoError("customer invoices", customerInvoices);
const lineRows = assertNoError("invoice lines", lines);
const allocationRows = assertNoError("existing allocations", existingAllocations);
const currentBudgetRows = assertNoError("current budget", currentBudget);

assert(projectRows.length === 2, "Expected both Tom Benton project rows.");
assert(
  customerInvoiceRows.length === 2,
  "Expected both Tom Benton customer invoices.",
);
assert(lineRows.length === 3, "Expected exactly three Roberval invoice lines.");
assert(
  allocationRows.every(
    (row) => row.companycam_project_id === COMPLETED_PROJECT_ID,
  ),
  "A target Roberval line is allocated to an unexpected project.",
);

for (const expected of targetLines) {
  const actual = lineRows.find((line) => line.id === expected.id);
  assert(actual, `Missing invoice line ${expected.id}.`);
  assert(actual.invoice_id === ANGEL_INVOICE_ID, `Wrong invoice for ${expected.id}.`);
  assert(
    actual.service_started_on === expected.date,
    `Wrong service date for ${expected.id}.`,
  );
  assert(
    Math.abs(Number(actual.amount_before_tax) - expected.amount) < 0.001,
    `Wrong amount for ${expected.id}.`,
  );
  assert(
    /Roberval Avenue/i.test(actual.description),
    `Missing Roberval evidence for ${expected.id}.`,
  );
}

const completedCustomerInvoice = customerInvoiceRows.find(
  (invoice) => invoice.external_proposal_uuid === COMPLETED_PROPOSAL_UUID,
);
const currentCustomerInvoice = customerInvoiceRows.find(
  (invoice) => invoice.external_proposal_uuid === CURRENT_PROPOSAL_UUID,
);
assert(
  completedCustomerInvoice?.companycam_project_id === COMPLETED_PROJECT_ID &&
    completedCustomerInvoice.invoice_number === "371133",
  "Completed proposal is not mapped to the completed Tom Benton job.",
);
assert(
  currentCustomerInvoice?.companycam_project_id === CURRENT_PROJECT_ID &&
    currentCustomerInvoice.invoice_number === "487895" &&
    currentCustomerInvoice.is_archived_job === false,
  "Current proposal is not mapped to the current Tom Benton job.",
);

const allocatedTotal = targetLines.reduce((sum, line) => sum + line.amount, 0);
const plan = {
  projectRef: PROJECT_REF,
  apply: APPLY,
  projects: projectRows,
  customerInvoices: customerInvoiceRows,
  invoiceEntryAllocations: targetLines.map((line) => ({
    invoiceLineId: line.id,
    serviceDate: line.date,
    allocatedAmount: line.amount,
    targetProjectId: COMPLETED_PROJECT_ID,
  })),
  allocatedTotal,
  currentProjectBudget: {
    before: currentBudgetRows[0] ?? null,
    after: {
      companycam_project_id: CURRENT_PROJECT_ID,
      amount_including_tax: 1699,
      labour_allocation_percent: 40,
      labour_invoice_job_started_on: "2026-07-28",
      labour_closed_at: null,
    },
  },
};
console.log(JSON.stringify(plan, null, 2));

if (!APPLY) {
  console.log("\nDry run only. Re-run with --apply to write this verified plan.");
  process.exit(0);
}

const now = new Date().toISOString();
const evidenceMethods = [
  "address:roberval avenue",
  "dripjobs_proposal:2390920",
  "dripjobs_schedule:2026-02-11/2026-02-13",
  "user_confirmed_tom_benton_cycle_fix_20260731",
];

assertNoError(
  "invoice line allocation upsert",
  await db.from("labour_invoice_line_allocations").upsert(
    targetLines.map((line) => ({
      invoice_line_id: line.id,
      companycam_project_id: COMPLETED_PROJECT_ID,
      allocated_amount: line.amount,
      allocated_hours: null,
      allocation_method: [...evidenceMethods, `service_date:${line.date}`],
      needs_review: false,
      updated_at: now,
    })),
    { onConflict: "invoice_line_id,companycam_project_id" },
  ),
);

assertNoError(
  "invoice project link upsert",
  await db.from("labour_invoice_projects").upsert(
    {
      invoice_id: ANGEL_INVOICE_ID,
      companycam_project_id: COMPLETED_PROJECT_ID,
      allocated_amount: allocatedTotal,
      match_score: 200,
      match_method: evidenceMethods,
      is_primary: false,
      needs_review: false,
      updated_at: now,
    },
    { onConflict: "invoice_id,companycam_project_id" },
  ),
);

assertNoError(
  "current project budget upsert",
  await db.from("project_budgets").upsert(
    {
      companycam_project_id: CURRENT_PROJECT_ID,
      amount_including_tax: 1699,
      labour_allocation_percent: 40,
      labour_invoice_job_started_on: "2026-07-28",
      labour_closed_at: null,
      notes:
        "DripJobs proposal 2523918; scheduled July 28-29, 2026; customer invoice #487895; amount before HST $1,699.00.",
      updated_at: now,
    },
    { onConflict: "companycam_project_id" },
  ),
);

const [verifiedAllocations, verifiedProjectLink, verifiedBudget] =
  await Promise.all([
    db
      .from("labour_invoice_line_allocations")
      .select(
        "invoice_line_id,companycam_project_id,allocated_amount,allocation_method,needs_review",
      )
      .in(
        "invoice_line_id",
        targetLines.map((line) => line.id),
      ),
    db
      .from("labour_invoice_projects")
      .select(
        "invoice_id,companycam_project_id,allocated_amount,match_method,needs_review",
      )
      .eq("invoice_id", ANGEL_INVOICE_ID)
      .eq("companycam_project_id", COMPLETED_PROJECT_ID),
    db
      .from("project_budgets")
      .select(
        "companycam_project_id,amount_including_tax,labour_allocation_percent,labour_invoice_job_started_on,labour_closed_at,notes",
      )
      .eq("companycam_project_id", CURRENT_PROJECT_ID),
  ]);

const verifiedAllocationRows = assertNoError(
  "verify invoice line allocations",
  verifiedAllocations,
);
const verifiedProjectLinkRows = assertNoError(
  "verify invoice project link",
  verifiedProjectLink,
);
const verifiedBudgetRows = assertNoError("verify current budget", verifiedBudget);
assert(
  verifiedAllocationRows.length === 3 &&
    Math.abs(
      verifiedAllocationRows.reduce(
        (sum, row) => sum + Number(row.allocated_amount),
        0,
      ) - allocatedTotal,
    ) < 0.001,
  "Post-write invoice allocation verification failed.",
);
assert(
  verifiedProjectLinkRows.length === 1 &&
    Math.abs(Number(verifiedProjectLinkRows[0].allocated_amount) - allocatedTotal) <
      0.001,
  "Post-write invoice project verification failed.",
);
assert(
  verifiedBudgetRows.length === 1 &&
    Number(verifiedBudgetRows[0].amount_including_tax) === 1699 &&
    verifiedBudgetRows[0].labour_invoice_job_started_on === "2026-07-28",
  "Post-write current budget verification failed.",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      allocations: verifiedAllocationRows,
      invoiceProjectLink: verifiedProjectLinkRows[0],
      currentProjectBudget: verifiedBudgetRows[0],
    },
    null,
    2,
  ),
);
