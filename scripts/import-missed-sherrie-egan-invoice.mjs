#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const SOURCE_SYSTEM = "dripjobs";
const STORAGE_BUCKET = "customer-invoices";
const APPLY = process.argv.includes("--apply");
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pdfArgument = process.argv.find((value) => value.startsWith("--pdf="));
const pdfPath = path.resolve(
  pdfArgument?.slice("--pdf=".length) ||
    "/Users/jadslim/Downloads/invoice-490662-download.pdf",
);

const source = {
  proposalId: "3156466",
  proposalUuid: "4202913968f69401c332eb4c22ab44",
  invoiceUuid: "4264711416bca74c0eca654af1a68c",
  invoiceNumber: "490662",
  projectId: "dripjobs-3156466",
  customerName: "Sherrie Egan",
  customerEmail: "sherrie.egan084@sympatico.ca",
  customerPhone: "(613) 820-8839",
  address: "992 Alenmede Crescent, Ottawa, ON, K2B 8K5",
  invoiceDate: "2026-07-31",
  subtotal: 3860,
  tax: 501.8,
  total: 4361.8,
  sourcePaid: 0,
  sourceBalance: 4361.8,
  sourceStatus: "Open",
  salesperson: "Asmaa Senni",
  projectManager: "Scott Madden",
  sourceUrl:
    "https://app.dripjobs.com/jobs/invoice/4264711416bca74c0eca654af1a68c",
  capturedFrom:
    "Authenticated DripJobs invoice page and original PDF downloaded 2026-08-02",
  items: [
    ["Why Choose Ottawa Painters", 0, 0, 0],
    ["Client Notes", 0, 0, 0],
    ["Interior Painting - Master Bedroom", 1080, 140.4, 1220.4],
    ["Interior Painting - En Suite", 520, 67.6, 587.6],
    ["Interior Painting - Living Room", 780, 101.4, 881.4],
    ["Interior Painting - Kitchen", 480, 62.4, 542.4],
    ["Interior Painting - Dining", 480, 62.4, 542.4],
    ["Interior Painting - Entranceway", 520, 67.6, 587.6],
  ],
};

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

function assertNoError(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

function closeEnough(left, right) {
  return Math.abs(Number(left ?? 0) - Number(right ?? 0)) <= 0.02;
}

const itemSubtotal = source.items.reduce((sum, item) => sum + item[1], 0);
const itemTax = source.items.reduce((sum, item) => sum + item[2], 0);
const itemTotal = source.items.reduce((sum, item) => sum + item[3], 0);
if (
  !closeEnough(itemSubtotal, source.subtotal) ||
  !closeEnough(itemTax, source.tax) ||
  !closeEnough(itemTotal, source.total) ||
  !closeEnough(source.subtotal + source.tax, source.total)
) {
  throw new Error("Sherrie Egan invoice arithmetic does not reconcile.");
}
if (!existsSync(pdfPath)) {
  throw new Error(`Original invoice PDF not found: ${pdfPath}`);
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl =
  env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== TARGET_PROJECT_REF) {
  throw new Error(`Refusing write for unexpected project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const [jobResult, invoiceResult, projectResult] = await Promise.all([
  db.from("dripjobs_jobs").select("*").eq("proposal_id", source.proposalId).single(),
  db
    .from("customer_invoices")
    .select("id,invoice_number")
    .eq("source_system", SOURCE_SYSTEM)
    .eq("external_invoice_id", source.invoiceUuid)
    .maybeSingle(),
  db
    .from("companycam_projects")
    .select("*")
    .eq("companycam_id", source.projectId)
    .maybeSingle(),
]);
const job = assertNoError("DripJobs job lookup", jobResult);
const existingInvoice = assertNoError("invoice lookup", invoiceResult);
const existingProject = assertNoError("project lookup", projectResult);

if (
  String(job.invoice_id).replace(/^#/, "") !== source.invoiceNumber ||
  !closeEnough(job.amount, source.total) ||
  !closeEnough(job.paid_amount, source.sourcePaid) ||
  !closeEnough(job.balance_amount, source.sourceBalance)
) {
  throw new Error("Current DripJobs job export conflicts with the physical invoice.");
}

const pdf = readFileSync(pdfPath);
const pdfSha256 = createHash("sha256").update(pdf).digest("hex");
const plan = {
  mode: APPLY ? "apply" : "dry-run",
  project_ref: projectRef,
  invoice: {
    customer: source.customerName,
    proposal_id: source.proposalId,
    invoice_number: source.invoiceNumber,
    before_hst: source.subtotal,
    hst: source.tax,
    after_hst: source.total,
    source_status: source.sourceStatus,
    item_count: source.items.length,
    pdf_sha256: pdfSha256,
  },
  existing: {
    invoice: existingInvoice ? existingInvoice.invoice_number : null,
    project: existingProject ? existingProject.companycam_id : null,
  },
  reason_missed:
    "The archived browser invoice export ended before this July 31 invoice was created; the August 1 Jobs List already contained invoice #490662.",
};
console.log(JSON.stringify(plan, null, 2));
if (!APPLY) {
  console.log("\nDry run only. Re-run with --apply to archive the verified invoice.");
  process.exit(0);
}

const now = new Date().toISOString();
const projectRow = {
  ...(existingProject ?? {}),
  companycam_id: source.projectId,
  name: source.customerName,
  street_address_1: "992 Alenmede Crescent",
  street_address_2: null,
  city: "Ottawa",
  state: "ON",
  postal_code: "K2B 8K5",
  country: "CA",
  formatted_address: source.address,
  is_archived: false,
  companycam_created_at: existingProject?.companycam_created_at ?? null,
  companycam_updated_at: now,
  raw: {
    ...(existingProject?.raw ?? {}),
    source: "dripjobs_live_invoice_recovery",
    dripjobs: job,
    recovered_invoice: {
      invoice_uuid: source.invoiceUuid,
      invoice_number: source.invoiceNumber,
      source_url: source.sourceUrl,
      captured_from: source.capturedFrom,
      pdf_sha256: pdfSha256,
    },
  },
  last_synced_at: now,
  inserted_at: existingProject?.inserted_at ?? now,
  updated_at: now,
  labels:
    Array.isArray(existingProject?.labels) && existingProject.labels.length > 0
      ? existingProject.labels
      : [{ name: "DripJobs accounting job" }],
  is_lead: false,
  companycam_status: "dripjobs_job",
  is_deleted: false,
};
assertNoError(
  "accounting project upsert",
  await db.from("companycam_projects").upsert(projectRow, {
    onConflict: "companycam_id",
  }),
);

const invoiceRows = assertNoError(
  "customer invoice upsert",
  await db
    .from("customer_invoices")
    .upsert(
      {
        source_system: SOURCE_SYSTEM,
        external_invoice_id: source.invoiceUuid,
        invoice_number: source.invoiceNumber,
        companycam_project_id: source.projectId,
        external_proposal_id: source.proposalId,
        external_proposal_uuid: source.proposalUuid,
        customer_name: source.customerName,
        customer_email: source.customerEmail,
        customer_phone: source.customerPhone,
        billing_address: source.address,
        job_name: source.customerName,
        job_address: source.address,
        invoice_date: source.invoiceDate,
        due_date: null,
        currency: "CAD",
        subtotal: source.subtotal,
        tax_amount: source.tax,
        total_amount: source.total,
        source_paid_amount: source.sourcePaid,
        source_balance: source.sourceBalance,
        source_status: source.sourceStatus,
        visible_status: source.sourceStatus,
        salesperson: source.salesperson,
        source_url: source.sourceUrl,
        is_archived_job: false,
        source_payload: {
          ...source,
          pdf_sha256: pdfSha256,
          captured_at: now,
          project_manager: source.projectManager,
          recovery_reason: plan.reason_missed,
        },
        imported_at: now,
      },
      { onConflict: "source_system,external_invoice_id" },
    )
    .select("id")
    .single(),
);
const customerInvoiceId = invoiceRows.id;

const itemRows = source.items.map(([description, beforeHst, tax, total], index) => ({
  customer_invoice_id: customerInvoiceId,
  source_system: SOURCE_SYSTEM,
  external_item_id: `${source.invoiceUuid}:physical-line:${index + 1}`,
  line_number: index + 1,
  description,
  quantity: 1,
  unit_price: beforeHst,
  amount_before_tax: beforeHst,
  tax_amount: tax,
  total_amount: total,
  source_text: `${description} | 1.00 | $${beforeHst.toFixed(2)} | $${tax.toFixed(2)} | $${total.toFixed(2)}`,
  source_url: source.sourceUrl,
  source_payload: {
    extraction_source: "original DripJobs invoice PDF and authenticated invoice page",
    invoice_number: source.invoiceNumber,
    captured_at: now,
  },
}));
assertNoError(
  "customer invoice items upsert",
  await db.from("customer_invoice_items").upsert(itemRows, {
    onConflict: "source_system,external_item_id",
  }),
);

const storagePath = `dripjobs/${source.invoiceUuid}/invoice-${source.invoiceNumber}-download.pdf`;
assertNoError(
  "original invoice PDF upload",
  await db.storage.from(STORAGE_BUCKET).upload(storagePath, pdf, {
    contentType: "application/pdf",
    cacheControl: "3600",
    upsert: true,
  }),
);
assertNoError(
  "customer invoice document upsert",
  await db.from("customer_invoice_documents").upsert(
    {
      customer_invoice_id: customerInvoiceId,
      document_kind: "original_invoice",
      original_filename: `invoice-${source.invoiceNumber}-download.pdf`,
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      content_type: "application/pdf",
      size_bytes: statSync(pdfPath).size,
      content_sha256: pdfSha256,
      source_url: source.sourceUrl,
      captured_at: now,
    },
    { onConflict: "storage_bucket,storage_path" },
  ),
);

assertNoError(
  "project budget upsert",
  await db.from("project_budgets").upsert(
    {
      companycam_project_id: source.projectId,
      amount_including_tax: source.subtotal,
      notes:
        `Job value is the before-HST subtotal from DripJobs invoice #${source.invoiceNumber} ` +
        `(${source.sourceUrl}); HST $${source.tax.toFixed(2)} is stored separately on the invoice.`,
      updated_at: now,
    },
    { onConflict: "companycam_project_id" },
  ),
);

const [verificationResult, accountingResult, storedItemsResult, storedDocumentsResult] =
  await Promise.all([
    db
      .from("customer_invoice_verification")
      .select("*")
      .eq("customer_invoice_id", customerInvoiceId)
      .single(),
    db.rpc("read_job_accounting_reconciliation", {
      p_companycam_project_id: source.projectId,
    }),
    db
      .from("customer_invoice_items")
      .select("id", { count: "exact", head: true })
      .eq("customer_invoice_id", customerInvoiceId),
    db
      .from("customer_invoice_documents")
      .select("id", { count: "exact", head: true })
      .eq("customer_invoice_id", customerInvoiceId),
  ]);
const verification = assertNoError("invoice verification", verificationResult);
const accountingRows = assertNoError("job accounting verification", accountingResult);
if (
  verification.verification_status !== "verified" ||
  !closeEnough(verification.item_difference, 0) ||
  storedItemsResult.error ||
  storedItemsResult.count !== source.items.length ||
  storedDocumentsResult.error ||
  storedDocumentsResult.count !== 1 ||
  accountingRows.length !== 1 ||
  accountingRows[0].review_reasons.includes("missing_customer_invoice")
) {
  throw new Error(
    `Post-write verification failed: ${JSON.stringify({
      verification,
      item_count: storedItemsResult.count,
      document_count: storedDocumentsResult.count,
      accounting: accountingRows,
    })}`,
  );
}

console.log(
  JSON.stringify(
    {
      applied: true,
      customer_invoice_id: customerInvoiceId,
      verification_status: verification.verification_status,
      item_count: storedItemsResult.count,
      document_count: storedDocumentsResult.count,
      job_review_reasons: accountingRows[0].review_reasons,
      job_open_items: accountingRows[0].open_items,
    },
    null,
    2,
  ),
);
