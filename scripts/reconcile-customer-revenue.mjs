#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const SOURCE_SYSTEM = "dripjobs";
const STORAGE_BUCKET = "customer-invoices";
const APPLY = process.argv.includes("--apply");
const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const archiveRoot = path.resolve(
  repoRoot,
  "tmp/dripjobs-export/2026-07-31/customer-invoices",
);
const jobsArchivePath = path.resolve(
  repoRoot,
  "tmp/dripjobs-export/2026-07-31/jobs.normalized.json",
);

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

function chunks(values, size = 150) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let page = 0; page < 100; page += 1) {
    const from = page * pageSize;
    const result = await queryFactory().range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Pagination exceeded 100,000 rows.");
}

function sourceObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function moneyFromCents(value) {
  return Number((Number(value) / 100).toFixed(2));
}

function parseSourceDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error(`Unsupported source date: ${value}`);
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function dateDistanceInDays(left, right) {
  const leftMs = Date.parse(`${left}T12:00:00Z`);
  const rightMs = Date.parse(`${right}T12:00:00Z`);
  return Math.abs(leftMs - rightMs) / 86_400_000;
}

function isDirectBankMethod(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return (
    normalized.includes("transfer") ||
    normalized === "etranser" ||
    normalized === "check" ||
    normalized === "cheque"
  );
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function addressFields(address) {
  const parts = String(address ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const provinceIndex = parts.findIndex((value) => /^(ON|Ontario)$/i.test(value));
  const postalIndex = parts.findIndex((value) => /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test(value));
  return {
    street_address_1: parts.length >= 2 ? parts[0] : null,
    street_address_2: null,
    city:
      provinceIndex > 0
        ? parts[provinceIndex - 1]
        : parts.length >= 2
          ? parts[1]
          : parts[0] || null,
    state: provinceIndex >= 0 ? "ON" : null,
    postal_code: postalIndex >= 0 ? parts[postalIndex].toUpperCase() : null,
    country: "CA",
    formatted_address: address || null,
  };
}

function projectName(job) {
  const suffix = job.archived ? " (completed)" : "";
  return `${job.job_name || job.customer_name || "DripJobs job"} — proposal ${
    job.proposal_id
  }${suffix}`;
}

function assertNoError(label, result) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.data ?? [];
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl =
  env.SUPABASE_URL ||
  env.NEXT_PUBLIC_SUPABASE_URL ||
  env.EXPO_PUBLIC_SUPABASE_URL;
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

const invoices = JSON.parse(
  readFileSync(path.resolve(archiveRoot, "invoices.normalized.json"), "utf8"),
);
const archivedItemRows = JSON.parse(
  readFileSync(
    path.resolve(archiveRoot, "invoice-line-items.normalized.json"),
    "utf8",
  ),
);
// DripJobs places payment-history rows in the same HTML table. They are not
// printed invoice items and are imported separately as payment events.
const invoiceItems = archivedItemRows.filter((item) => item.item_uuid);
const paymentEvents = JSON.parse(
  readFileSync(
    path.resolve(archiveRoot, "invoice-payments.normalized.json"),
    "utf8",
  ),
);
const jobsArchive = JSON.parse(readFileSync(jobsArchivePath, "utf8"));
const jobs = jobsArchive.jobs ?? [];
const detailDirectory = path.resolve(archiveRoot, "details");
const details = readdirSync(detailDirectory)
  .filter((filename) => filename.endsWith(".json"))
  .map((filename) =>
    JSON.parse(readFileSync(path.resolve(detailDirectory, filename), "utf8")),
  );

if (invoices.length !== 184) {
  throw new Error(`Expected 184 archived invoices; found ${invoices.length}.`);
}
if (invoiceItems.length !== 936) {
  throw new Error(`Expected 936 physical invoice items; found ${invoiceItems.length}.`);
}
if (paymentEvents.length !== 304) {
  throw new Error(`Expected 304 payment events; found ${paymentEvents.length}.`);
}
if (details.length !== invoices.length) {
  throw new Error("Invoice detail archive is incomplete.");
}

const invoiceIds = new Set(invoices.map((invoice) => invoice.invoice_uuid));
if (invoiceIds.size !== invoices.length) {
  throw new Error("Duplicate archived invoice UUIDs detected.");
}
const jobsByProposal = new Map(jobs.map((job) => [job.proposal_uuid, job]));
for (const invoice of invoices) {
  if (!jobsByProposal.has(invoice.proposal_uuid)) {
    throw new Error(`Invoice ${invoice.invoice_number} has no archived job.`);
  }
}

for (const invoice of invoices) {
  const items = invoiceItems.filter(
    (item) => item.invoice_uuid === invoice.invoice_uuid,
  );
  const itemTotal = items.reduce((total, item) => total + cents(item.total), 0);
  if (Math.abs(itemTotal - cents(invoice.total)) > 2) {
    throw new Error(`Printed item total mismatch on invoice ${invoice.invoice_number}.`);
  }
  const pdf = readFileSync(invoice.pdf_path);
  if (sha256(pdf) !== invoice.pdf_sha256) {
    throw new Error(`Archived PDF hash mismatch on invoice ${invoice.invoice_number}.`);
  }
}

const [projects, transactions, existingAllocations] = await Promise.all([
  fetchAll(() => db.from("companycam_projects").select("*")),
  fetchAll(() =>
    db
      .from("financial_transactions")
      .select(
        "id,posted_on,transaction_on,description,counterparty,amount,currency,transaction_type,category,is_transfer,review_status,notes,source_data",
      )
      .eq("category", "Painting revenue")
      .eq("transaction_type", "income")
      .eq("is_transfer", false),
  ),
  fetchAll(() =>
    db
      .from("customer_invoice_bank_allocations")
      .select(
        "id,financial_transaction_id,customer_invoice_id,source_payment_event_id,allocated_amount,reversed_at",
      )
      .is("reversed_at", null),
  ),
]);

const projectsById = new Map(
  projects.map((project) => [String(project.companycam_id), project]),
);
const projectIdByProposal = new Map();
for (const job of jobs) {
  const explicitId = job.companycam_project_id
    ? String(job.companycam_project_id)
    : null;
  if (explicitId && !projectsById.has(explicitId)) {
    throw new Error(
      `DripJobs proposal ${job.proposal_id} links missing CompanyCam project ${explicitId}.`,
    );
  }
  projectIdByProposal.set(
    job.proposal_uuid,
    explicitId ?? `dripjobs-${job.proposal_id}`,
  );
}

const projectsToCreate = jobs.filter(
  (job) => !projectsById.has(projectIdByProposal.get(job.proposal_uuid)),
);
const existingPlaceholdersToEnrich = jobs.filter((job) => {
  const projectId = projectIdByProposal.get(job.proposal_uuid);
  return projectId.startsWith("dripjobs-") && projectsById.has(projectId);
});
const companyCamProjectsToEnrich = jobs.filter((job) =>
  Boolean(job.companycam_project_id),
);

const directEvents = paymentEvents
  .filter((event) => isDirectBankMethod(event.method))
  .map((event) => ({
    ...event,
    received_on: parseSourceDate(event.received_date),
    amount_cents: cents(event.amount),
  }));
const eligibleTransactions = transactions.filter(
  (transaction) => Number(transaction.amount) > 0 && transaction.currency === "CAD",
);
const transactionCandidatesByEvent = new Map();
const eventCandidatesByTransaction = new Map();
for (const event of directEvents) {
  const candidates = eligibleTransactions.filter(
    (transaction) =>
      cents(transaction.amount) === event.amount_cents &&
      dateDistanceInDays(transaction.posted_on, event.received_on) <= 3,
  );
  transactionCandidatesByEvent.set(event.payment_uuid, candidates);
  for (const transaction of candidates) {
    const candidateEvents = eventCandidatesByTransaction.get(transaction.id) ?? [];
    candidateEvents.push(event);
    eventCandidatesByTransaction.set(transaction.id, candidateEvents);
  }
}

const exactMatches = directEvents
  .map((event) => {
    const candidates = transactionCandidatesByEvent.get(event.payment_uuid) ?? [];
    if (candidates.length !== 1) return null;
    const transaction = candidates[0];
    if ((eventCandidatesByTransaction.get(transaction.id) ?? []).length !== 1) {
      return null;
    }
    return { event, transaction };
  })
  .filter(Boolean);

const archivedInvoiceById = new Map(
  invoices.map((invoice) => [invoice.invoice_uuid, invoice]),
);
const plannedInvoiceCents = new Map();
const plannedExactMatches = [...exactMatches]
  .sort(
    (left, right) =>
      left.event.received_on.localeCompare(right.event.received_on) ||
      left.event.payment_uuid.localeCompare(right.event.payment_uuid),
  )
  .map((match) => {
    const invoice = archivedInvoiceById.get(match.event.invoice_uuid);
    const alreadyPlanned = plannedInvoiceCents.get(match.event.invoice_uuid) ?? 0;
    const invoiceRemaining = Math.max(0, cents(invoice.total) - alreadyPlanned);
    const allocationCents = Math.min(match.event.amount_cents, invoiceRemaining);
    plannedInvoiceCents.set(
      match.event.invoice_uuid,
      alreadyPlanned + allocationCents,
    );
    return {
      ...match,
      allocation_cents: allocationCents,
      bank_residual_cents: match.event.amount_cents - allocationCents,
    };
  })
  .filter((match) => match.allocation_cents > 0);

const existingAllocatedTransactionIds = new Set(
  existingAllocations.map((allocation) => allocation.financial_transaction_id),
);
const newExactMatches = plannedExactMatches.filter(
  ({ transaction }) => !existingAllocatedTransactionIds.has(transaction.id),
);

const plan = {
  mode: APPLY ? "apply" : "dry-run",
  target_project_ref: projectRef,
  archive: {
    invoices: invoices.length,
    physical_invoice_items: invoiceItems.length,
    source_payment_events: paymentEvents.length,
    source_pdfs: invoices.length,
    printed_invoice_total: moneyFromCents(
      invoices.reduce((total, invoice) => total + cents(invoice.total), 0),
    ),
    source_recorded_paid: moneyFromCents(
      invoices.reduce((total, invoice) => total + cents(invoice.paid_amount), 0),
    ),
  },
  jobs: {
    archived_jobs: jobs.length,
    projects_to_create: projectsToCreate.length,
    existing_placeholders_to_enrich: existingPlaceholdersToEnrich.length,
    companycam_projects_to_enrich: companyCamProjectsToEnrich.length,
    resolved_invoice_projects: new Set(
      invoices.map((invoice) => projectIdByProposal.get(invoice.proposal_uuid)),
    ).size,
  },
  bank_matching: {
    painting_revenue_rows: transactions.length,
    direct_source_payment_events: directEvents.length,
    mutually_unique_exact_matches: exactMatches.length,
    mutually_unique_exact_amount: moneyFromCents(
      exactMatches.reduce(
        (total, match) => total + cents(match.event.amount),
        0,
      ),
    ),
    invoice_allocatable_amount: moneyFromCents(
      plannedExactMatches.reduce(
        (total, match) => total + match.allocation_cents,
        0,
      ),
    ),
    exact_match_overpayment_residual: moneyFromCents(
      plannedExactMatches.reduce(
        (total, match) => total + match.bank_residual_cents,
        0,
      ),
    ),
    overpayment_candidates: plannedExactMatches
      .filter((match) => match.bank_residual_cents > 0)
      .map((match) => ({
        invoice_number: match.event.invoice_number,
        customer_name: match.event.customer_name,
        payment_number: match.event.payment_number,
        bank_posted_on: match.transaction.posted_on,
        bank_amount: moneyFromCents(match.event.amount_cents),
        invoice_allocation: moneyFromCents(match.allocation_cents),
        overpayment_residual: moneyFromCents(match.bank_residual_cents),
      })),
    existing_active_allocations: existingAllocations.length,
    new_allocations_to_insert: newExactMatches.length,
    ambiguous_or_unmatched_direct_events: directEvents.length - exactMatches.length,
  },
};

console.log(JSON.stringify(plan, null, 2));
if (!APPLY) {
  console.log("\nDry run only. Re-run with --apply to write the verified plan.");
  process.exit(0);
}

const now = new Date().toISOString();
const projectRows = jobs.map((job) => {
  const projectId = projectIdByProposal.get(job.proposal_uuid);
  const existing = projectsById.get(projectId);
  const isPlaceholder = projectId.startsWith("dripjobs-");
  const richRaw = {
    ...sourceObject(existing?.raw),
    source: isPlaceholder
      ? "dripjobs_full_export"
      : sourceObject(existing?.raw).source ?? "companycam",
    dripjobs: job,
    dripjobs_imported_at: now,
  };
  const parsedAddress = addressFields(job.address);

  if (!isPlaceholder) {
    return {
      ...existing,
      formatted_address: existing.formatted_address || job.address || null,
      raw: richRaw,
      updated_at: now,
    };
  }

  return {
    ...(existing ?? {}),
    companycam_id: projectId,
    name: projectName(job),
    street_address_1:
      existing?.street_address_1 ?? parsedAddress.street_address_1,
    street_address_2:
      existing?.street_address_2 ?? parsedAddress.street_address_2,
    city: existing?.city ?? parsedAddress.city,
    state: existing?.state ?? parsedAddress.state,
    postal_code: existing?.postal_code ?? parsedAddress.postal_code,
    country: existing?.country ?? parsedAddress.country,
    formatted_address: job.address || existing?.formatted_address || null,
    is_archived: Boolean(job.archived),
    companycam_created_at: existing?.companycam_created_at ?? null,
    companycam_updated_at: now,
    raw: richRaw,
    last_synced_at: now,
    inserted_at: existing?.inserted_at ?? now,
    updated_at: now,
    labels:
      Array.isArray(existing?.labels) && existing.labels.length > 0
        ? existing.labels
        : [{ name: "DripJobs job" }],
    is_lead: false,
    companycam_status: job.archived
      ? "dripjobs_completed"
      : "dripjobs_job",
    is_deleted: false,
  };
});

for (const batch of chunks(projectRows, 100)) {
  const result = await db
    .from("companycam_projects")
    .upsert(batch, { onConflict: "companycam_id" });
  assertNoError("companycam_projects upsert", result);
}

const invoiceRows = invoices.map((invoice) => ({
  source_system: SOURCE_SYSTEM,
  external_invoice_id: invoice.invoice_uuid,
  invoice_number: invoice.invoice_number,
  companycam_project_id: projectIdByProposal.get(invoice.proposal_uuid),
  external_proposal_id: invoice.proposal_id,
  external_proposal_uuid: invoice.proposal_uuid,
  customer_name: invoice.customer_name,
  customer_email: invoice.customer_email || null,
  customer_phone: invoice.customer_phone || null,
  billing_address: invoice.invoice_address || null,
  job_name: invoice.job_name || null,
  job_address: invoice.job_address || null,
  invoice_date: parseSourceDate(invoice.invoice_date),
  due_date: parseSourceDate(invoice.due_date),
  currency: "CAD",
  subtotal: moneyFromCents(cents(invoice.subtotal)),
  tax_amount: moneyFromCents(cents(invoice.sales_tax)),
  total_amount: moneyFromCents(cents(invoice.total)),
  source_paid_amount: moneyFromCents(cents(invoice.paid_amount)),
  source_balance: moneyFromCents(cents(invoice.balance)),
  source_status: invoice.status,
  visible_status: invoice.visible_status,
  salesperson: invoice.salesperson || null,
  source_url: invoice.source_url,
  is_archived_job: Boolean(invoice.archived_job),
  source_payload: invoice,
  imported_at: now,
}));

const storedInvoiceIds = new Map();
for (const batch of chunks(invoiceRows)) {
  const result = await db
    .from("customer_invoices")
    .upsert(batch, { onConflict: "source_system,external_invoice_id" })
    .select("id,external_invoice_id");
  const rows = assertNoError("customer_invoices upsert", result);
  for (const row of rows) storedInvoiceIds.set(row.external_invoice_id, row.id);
}
if (storedInvoiceIds.size !== invoices.length) {
  throw new Error("Not every customer invoice returned a stored ID.");
}

const itemRows = invoiceItems.map((item) => ({
  customer_invoice_id: storedInvoiceIds.get(item.invoice_uuid),
  source_system: SOURCE_SYSTEM,
  external_item_id: item.item_uuid,
  line_number: Number(item.position),
  description: item.name || "Invoice item",
  quantity: item.quantity == null ? null : Number(item.quantity),
  unit_price: item.unit_price == null ? null : Number(item.unit_price),
  amount_before_tax: moneyFromCents(cents(item.total) - cents(item.tax)),
  tax_amount: moneyFromCents(cents(item.tax)),
  total_amount: moneyFromCents(cents(item.total)),
  source_text: item.row_text || null,
  source_url: item.edit_url || null,
  source_payload: item,
}));
for (const batch of chunks(itemRows)) {
  const result = await db.from("customer_invoice_items").upsert(batch, {
    onConflict: "source_system,external_item_id",
  });
  assertNoError("customer_invoice_items upsert", result);
}

const paymentRows = paymentEvents.map((event) => ({
  customer_invoice_id: storedInvoiceIds.get(event.invoice_uuid),
  source_system: SOURCE_SYSTEM,
  external_payment_id: event.payment_uuid,
  payment_number: event.payment_number || null,
  received_on: parseSourceDate(event.received_date),
  method: event.method || null,
  reference: event.reference || null,
  amount: moneyFromCents(cents(event.amount)),
  currency: "CAD",
  source_statuses: Array.isArray(event.sync_statuses)
    ? event.sync_statuses
    : [],
  source_url: event.edit_url || null,
  source_payload: event,
}));
const storedPaymentIds = new Map();
for (const batch of chunks(paymentRows)) {
  const result = await db
    .from("customer_invoice_payment_events")
    .upsert(batch, { onConflict: "source_system,external_payment_id" })
    .select("id,external_payment_id");
  const rows = assertNoError("customer_invoice_payment_events upsert", result);
  for (const row of rows) storedPaymentIds.set(row.external_payment_id, row.id);
}

const detailByInvoice = new Map(
  details.map((detail) => [detail.invoice.invoice_uuid, detail]),
);
const documentRows = [];
let uploadedDocuments = 0;
for (const invoice of invoices) {
  const pdf = readFileSync(invoice.pdf_path);
  const basename = path.basename(invoice.pdf_path);
  const storagePath = `dripjobs/${invoice.invoice_uuid}/${basename}`;
  const uploadResult = await db.storage.from(STORAGE_BUCKET).upload(
    storagePath,
    pdf,
    {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: true,
    },
  );
  assertNoError(`PDF upload ${invoice.invoice_number}`, uploadResult);
  uploadedDocuments += 1;
  const detail = detailByInvoice.get(invoice.invoice_uuid);
  documentRows.push({
    customer_invoice_id: storedInvoiceIds.get(invoice.invoice_uuid),
    document_kind: "original_invoice",
    original_filename: basename,
    storage_bucket: STORAGE_BUCKET,
    storage_path: storagePath,
    content_type: "application/pdf",
    size_bytes: statSync(invoice.pdf_path).size,
    content_sha256: invoice.pdf_sha256,
    source_url: invoice.source_url,
    captured_at: detail?.invoice?.archived_at || now,
  });
}
for (const batch of chunks(documentRows)) {
  const result = await db.from("customer_invoice_documents").upsert(batch, {
    onConflict: "storage_bucket,storage_path",
  });
  assertNoError("customer_invoice_documents upsert", result);
}

const allocationRows = newExactMatches.map(
  ({ event, transaction, allocation_cents, bank_residual_cents }) => ({
  financial_transaction_id: transaction.id,
  customer_invoice_id: storedInvoiceIds.get(event.invoice_uuid),
  source_payment_event_id: storedPaymentIds.get(event.payment_uuid),
  allocated_amount: moneyFromCents(allocation_cents),
  match_method: [
    "dripjobs_payment_event",
    "exact_amount_cents",
    "date_within_3_days",
    "mutually_unique_candidate",
    "owner_authorized_2026_07_31",
  ],
  confidence: "confirmed",
  evidence_note: (() => {
    const residual = moneyFromCents(bank_residual_cents);
    return `DripJobs invoice #${event.invoice_number}, payment #${
      event.payment_number || "unknown"
    }, ${event.method || "direct payment"} received ${
      event.received_date
    }; exact unique bank amount posted ${transaction.posted_on}.${
      residual > 0
        ? ` Allocation capped at the invoice total; $${residual.toFixed(
            2,
          )} remains an overpayment residual.`
        : ""
    }`;
  })(),
  }),
);
for (const batch of chunks(allocationRows)) {
  const result = await db.from("customer_invoice_bank_allocations").insert(batch);
  assertNoError("customer_invoice_bank_allocations insert", result);
}

const [verificationRows, activeAllocationRows] = await Promise.all([
  fetchAll(() => db.from("customer_revenue_verification").select("*")),
  fetchAll(() =>
    db
      .from("customer_invoice_bank_allocations")
      .select(
        "financial_transaction_id,customer_invoice_id,allocated_amount,reversed_at",
      )
      .is("reversed_at", null),
  ),
]);
const verificationByTransaction = new Map(
  verificationRows.map((row) => [row.financial_transaction_id, row]),
);
const allocationsByTransaction = new Map();
for (const allocation of activeAllocationRows) {
  const rows = allocationsByTransaction.get(allocation.financial_transaction_id) ?? [];
  rows.push(allocation);
  allocationsByTransaction.set(allocation.financial_transaction_id, rows);
}

for (const transaction of transactions) {
  const verification = verificationByTransaction.get(transaction.id);
  const allocationRowsForTransaction =
    allocationsByTransaction.get(transaction.id) ?? [];
  const fullyAllocated = verification?.payment_status === "fully_allocated";
  const sourceData = sourceObject(transaction.source_data);
  const explicitException = sourceObject(
    sourceData.customer_revenue_exception,
  ).status === "confirmed";
  const reviewStatus = fullyAllocated
    ? "reconciled"
    : explicitException
      ? transaction.review_status
      : "needs_review";
  const settlementEvidence = {
    status: verification?.payment_status ?? "unmatched",
    allocated_amount: Number(verification?.allocated_amount ?? 0),
    unallocated_amount: Number(
      verification?.unallocated_amount ?? transaction.amount,
    ),
    customer_invoice_ids: allocationRowsForTransaction.map(
      (allocation) => allocation.customer_invoice_id,
    ),
    rule: "customer_invoice_bank_allocations_are_settlement_truth",
    updated_at: now,
  };
  const result = await db
    .from("financial_transactions")
    .update({
      review_status: reviewStatus,
      source_data: {
        ...sourceData,
        customer_revenue_settlement: settlementEvidence,
      },
    })
    .eq("id", transaction.id);
  assertNoError(`financial transaction ${transaction.id} update`, result);
}

const [
  invoiceCount,
  itemCount,
  paymentCount,
  documentCount,
  allocationCount,
  invoiceVerification,
  revenueVerification,
] = await Promise.all([
  db.from("customer_invoices").select("id", { count: "exact", head: true }),
  db.from("customer_invoice_items").select("id", { count: "exact", head: true }),
  db
    .from("customer_invoice_payment_events")
    .select("id", { count: "exact", head: true }),
  db
    .from("customer_invoice_documents")
    .select("id", { count: "exact", head: true }),
  db
    .from("customer_invoice_bank_allocations")
    .select("id", { count: "exact", head: true })
    .is("reversed_at", null),
  fetchAll(() => db.from("customer_invoice_verification").select("*")),
  fetchAll(() => db.from("customer_revenue_verification").select("*")),
]);
for (const [label, result] of Object.entries({
  invoiceCount,
  itemCount,
  paymentCount,
  documentCount,
  allocationCount,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

if (invoiceCount.count !== invoices.length) {
  throw new Error(`Stored invoice count is ${invoiceCount.count}, expected ${invoices.length}.`);
}
if (itemCount.count !== invoiceItems.length) {
  throw new Error(`Stored item count is ${itemCount.count}, expected ${invoiceItems.length}.`);
}
if (paymentCount.count !== paymentEvents.length) {
  throw new Error(
    `Stored payment-event count is ${paymentCount.count}, expected ${paymentEvents.length}.`,
  );
}
if (documentCount.count !== invoices.length || uploadedDocuments !== invoices.length) {
  throw new Error("Not every original customer invoice PDF was stored.");
}
const invalidPrintedInvoices = invoiceVerification.filter(
  (invoice) => Math.abs(Number(invoice.item_difference)) > 0.02,
);
if (invalidPrintedInvoices.length > 0) {
  throw new Error(
    `${invalidPrintedInvoices.length} stored customer invoices fail printed item arithmetic.`,
  );
}
const fullyAllocatedRevenue = revenueVerification.filter(
  (row) => row.payment_status === "fully_allocated",
);
const partiallyAllocatedRevenue = revenueVerification.filter(
  (row) => row.payment_status === "partially_allocated",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      stored: {
        customer_invoices: invoiceCount.count,
        physical_invoice_items: itemCount.count,
        source_payment_events: paymentCount.count,
        original_documents: documentCount.count,
        active_bank_allocations: allocationCount.count,
      },
      verification: {
        printed_invoice_arithmetic_failures: invalidPrintedInvoices.length,
        fully_allocated_revenue_rows: fullyAllocatedRevenue.length,
        partially_allocated_revenue_rows: partiallyAllocatedRevenue.length,
        unmatched_revenue_rows:
          revenueVerification.length -
          fullyAllocatedRevenue.length -
          partiallyAllocatedRevenue.length,
        fully_allocated_bank_amount: moneyFromCents(
          fullyAllocatedRevenue.reduce(
            (total, row) => total + cents(row.allocated_amount),
            0,
          ),
        ),
      },
    },
    null,
    2,
  ),
);
