#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
if (APPLY) {
  throw new Error("Retired: proposal 2873427 is not a separate Shezara Ali job. Use repair-shezara-single-job-v2.mjs and the current proposal 3159412.");
}
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const TRANSACTION_ID = "89b0cacc-b071-57d6-a9c7-f817709eb4c9";
const FENNEC_CONTACT_ID = "e2500be8-15c2-5e95-8b37-7104814d14be";
const INVOICE_2_ID = "a0e6f4a9-46e6-5fb5-989e-ab2e7d00795f";
const capturedAt = new Date().toISOString();
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) {
  throw new Error("Refusing reconciliation for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const invoices = [
  {
    number: "3",
    messageId: "19fbabfb4f6c0a0b",
    receivedAt: "2026-08-01T00:35:51.000Z",
    issuedOn: "2026-07-31",
    dueOn: "2026-08-02",
    totalCents: 35_250,
    customer: "Shezara Ali",
    serviceText: "Friday, July 31 (11h 45min) · rate $30/hour",
    minutes: 705,
    jobId: stableUuid("job:dripjobs-proposal:2873427"),
    jobEvidence: "DripJobs proposal 2873427 accepted for Shezara Ali on 2026-07-31",
    sourcePath: "/Users/jadslim/.workspace-mcp/attachments/Invoice_3_2026-08-02_560440c0.pdf",
    expectedHash: "a5eebb1779d30d8a55f07c4e82989b70399c7cfd35a968e387ed7b10a250c6a8",
    originalFilename: "2026-07-31 - Fennec Invoice 3.pdf",
  },
  {
    number: "4",
    messageId: "19fc93f5b08960b5",
    receivedAt: "2026-08-03T20:09:57.000Z",
    issuedOn: "2026-08-03",
    dueOn: "2026-08-03",
    totalCents: 14_250,
    customer: "Amal Malik",
    serviceText: "Monday, August 3 (4h 45min) · rate $30/hour",
    minutes: 285,
    jobId: "2e473c02-16fe-58a7-8675-5b5b00a93ae6",
    jobEvidence: "Exact printed customer name and exact single DripJobs job",
    sourcePath: "/Users/jadslim/.workspace-mcp/attachments/Invoice_4_2026-08-03_abe9a0d9.pdf",
    expectedHash: "2ecc6945d7bcb7fbb9c6d91342b0a13b4eb19fc1e7bc4f043452a5a66ef090b5",
    originalFilename: "2026-08-03 - Fennec Invoice 4.pdf",
  },
  {
    number: "5",
    messageId: "19fd45f94879ac99",
    receivedAt: "2026-08-06T00:00:56.000Z",
    issuedOn: "2026-08-05",
    dueOn: "2026-08-07",
    totalCents: 51_000,
    customer: "Herkirt Dhillon",
    serviceText: "August 5 (6h 50min) and August 6 (9h 8min); printed total 16h at $30/hour plus $30 bonus",
    minutes: 1_020,
    jobId: "54efc97f-ae24-556c-9fef-c280849204d8",
    jobEvidence: "Exact printed customer name and exact single DripJobs job",
    sourcePath: "/Users/jadslim/.workspace-mcp/attachments/Invoice_5_2026-08-07_fc5a10eb.pdf",
    expectedHash: "151f9a8a7bdc3499a1b13de7bb322a031bf94738af4cbf91bfdce643502f8298",
    originalFilename: "2026-08-05 - Fennec Invoice 5.pdf",
  },
];

for (const invoice of invoices) {
  if (!existsSync(invoice.sourcePath)) throw new Error(`Missing ${invoice.sourcePath}`);
  const buffer = readFileSync(invoice.sourcePath);
  const actualHash = sha256(buffer);
  if (actualHash !== invoice.expectedHash) {
    throw new Error(`Invoice ${invoice.number} hash changed: ${actualHash}`);
  }
  invoice.sourceBuffer = buffer;
  invoice.id = stableUuid(`invoice:gmail:${invoice.messageId}:${invoice.number}`);
  invoice.lineId = stableUuid(`invoice-line:${invoice.id}:1`);
  invoice.documentId = stableUuid(`document:sha256:${actualHash}`);
  invoice.storagePath = `gmail-labour-invoices/${invoice.receivedAt.slice(0, 10)}/${actualHash.slice(0, 16)}-${invoice.originalFilename}`;
}

const shezara = {
  proposalNumber: "2873427",
  acceptedAt: "2026-07-31T20:27:51.000Z",
  grossCents: 140_685,
  subtotalCents: 124_500,
  taxCents: 16_185,
  gmailMessageId: "19fb9dc9e6a1c167",
  quoteId: stableUuid("quote:dripjobs:2873427"),
  jobId: invoices[0].jobId,
  sourceBody: [
    "Proposal 2873427 accepted on behalf of Shezara Ali.",
    "An invoice was automatically generated.",
    "Amount: $1,406.85.",
  ].join(" "),
};
shezara.documentId = stableUuid(`document:gmail:${shezara.gmailMessageId}`);
shezara.documentHash = sha256(shezara.sourceBody);

const invoice2MissingAllocations = [
  {
    lineId: "f7b86ccd-3525-52c1-a1ca-3c81058b697b",
    jobId: "b33ba56b-eb80-5496-8104-7ce504d7354c",
    customer: "Sally Bidal",
    amountCents: 32_250,
  },
  {
    lineId: "8d7f5add-cbaa-5e49-b5eb-e046d17ac441",
    jobId: "db0cd13b-212d-5f20-a9d7-eae148ea89df",
    customer: "Anjou Delplancke",
    amountCents: 21_750,
  },
  {
    lineId: "c721d636-fe4c-5b8f-9995-9011e3dee358",
    jobId: "3955bafb-4b27-5d9b-a7df-5db84d087341",
    customer: "Paul Toonders",
    amountCents: 13_500,
  },
];

const [contactResult, transactionResult, invoice2Result, targetJobsResult, existingInvoicesResult, shezaraQuoteResult, shezaraJobResult] =
  await Promise.all([
    db.from("contacts").select("*").eq("id", FENNEC_CONTACT_ID).single(),
    db.from("transactions").select("*,allocations:transaction_allocations(*)").eq("id", TRANSACTION_ID).single(),
    db.from("invoices").select("*,lines:invoice_lines(*),job_allocations:invoice_job_allocations(*),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(*)").eq("id", INVOICE_2_ID).single(),
    db.from("jobs").select("id,name,status,contact_id,lead_id,accepted_quote_id,metadata").in("id", [
      ...invoices.slice(1).map((invoice) => invoice.jobId),
      ...invoice2MissingAllocations.map((allocation) => allocation.jobId),
    ]),
    db.from("invoices").select("id,contact_id,invoice_number,total_cents,status").eq("contact_id", FENNEC_CONTACT_ID).in("invoice_number", ["3", "4", "5"]),
    db.from("quotes").select("*").eq("dripjobs_proposal_id", shezara.proposalNumber).maybeSingle(),
    db.from("jobs").select("*").eq("id", shezara.jobId).maybeSingle(),
  ]);
for (const [label, result] of [
  ["Fennec contact", contactResult],
  ["Bilal transaction", transactionResult],
  ["Fennec invoice 2", invoice2Result],
  ["target jobs", targetJobsResult],
  ["existing Fennec invoices", existingInvoicesResult],
  ["Shezara quote", shezaraQuoteResult],
  ["Shezara job", shezaraJobResult],
]) if (result.error) throw new Error(`${label}: ${result.error.message}`);

if (contactResult.data.name !== "Fennec Contracting") throw new Error("Fennec contact identity changed.");
const transaction = transactionResult.data;
if (
  Number(transaction.amount_cents) !== -244_500 ||
  !String(transaction.counterparty ?? "").toLocaleLowerCase("en-CA").includes("bilal")
) throw new Error("Bilal transfer identity or amount changed.");
const activeTransactionAllocations = (transaction.allocations ?? []).filter((allocation) => !allocation.reversed_at);
if (activeTransactionAllocations.length) {
  const expected = new Map([
    [INVOICE_2_ID, 144_000],
    ...invoices.map((invoice) => [invoice.id, invoice.totalCents]),
  ]);
  if (
    activeTransactionAllocations.length !== expected.size ||
    activeTransactionAllocations.some((allocation) =>
      expected.get(allocation.invoice_id) !== Number(allocation.amount_cents)
    )
  ) throw new Error("Bilal transfer has conflicting active allocations.");
}

const invoice2 = invoice2Result.data;
if (invoice2.invoice_number !== "2" || Number(invoice2.total_cents) !== 144_000) {
  throw new Error("Fennec invoice 2 identity or total changed.");
}
const invoice2LineById = new Map((invoice2.lines ?? []).map((line) => [line.id, line]));
for (const expected of invoice2MissingAllocations) {
  const line = invoice2LineById.get(expected.lineId);
  if (!line || Number(line.total_cents) !== expected.amountCents || !line.description.includes(expected.customer)) {
    throw new Error(`Invoice 2 line mismatch for ${expected.customer}.`);
  }
}

const jobById = new Map((targetJobsResult.data ?? []).map((job) => [job.id, job]));
for (const expected of [
  ...invoices.slice(1).map((invoice) => ({ jobId: invoice.jobId, customer: invoice.customer })),
  ...invoice2MissingAllocations,
]) {
  const job = jobById.get(expected.jobId);
  if (!job || !job.name.toLocaleLowerCase("en-CA").includes(expected.customer.split(" ")[0].toLocaleLowerCase("en-CA"))) {
    throw new Error(`Exact job identity missing for ${expected.customer}.`);
  }
}

for (const stored of existingInvoicesResult.data ?? []) {
  const expected = invoices.find((invoice) => invoice.number === stored.invoice_number);
  if (!expected || stored.id !== expected.id || Number(stored.total_cents) !== expected.totalCents) {
    throw new Error(`Conflicting existing Fennec invoice ${stored.invoice_number}.`);
  }
}
if (shezaraQuoteResult.data && shezaraQuoteResult.data.id !== shezara.quoteId) {
  throw new Error("Conflicting DripJobs quote identity for Shezara proposal 2873427.");
}
if (shezaraJobResult.data && shezaraJobResult.data.accepted_quote_id !== shezara.quoteId) {
  throw new Error("Conflicting Shezara proposal 2873427 job identity.");
}

const activeInvoice2LineAllocations = (invoice2.job_allocations ?? [])
  .filter((allocation) => allocation.invoice_line_id && !allocation.metadata?.reversed_at)
const invoice2ExistingLineTotal = activeInvoice2LineAllocations
  .reduce((sum, allocation) => sum + Number(allocation.total_cents), 0);
const invoice2PlannedAllocations = invoice2MissingAllocations.filter((expected) =>
  !activeInvoice2LineAllocations.some((allocation) =>
    allocation.invoice_line_id === expected.lineId &&
    allocation.job_id === expected.jobId &&
    Number(allocation.total_cents) === expected.amountCents
  )
);
const invoice2MissingTotal = invoice2PlannedAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0);
if (invoice2ExistingLineTotal + invoice2MissingTotal !== 144_000) {
  throw new Error("Invoice 2 existing and missing line allocations do not total $1,440.00.");
}
const paymentPlan = [
  { invoiceId: INVOICE_2_ID, invoiceNumber: "2", amountCents: 144_000 },
  ...invoices.map((invoice) => ({ invoiceId: invoice.id, invoiceNumber: invoice.number, amountCents: invoice.totalCents })),
];
if (paymentPlan.reduce((sum, payment) => sum + payment.amountCents, 0) !== 244_500) {
  throw new Error("Fennec invoices 2-5 do not total the $2,445 transfer.");
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  transaction: {
    id: transaction.id,
    posted_on: transaction.posted_on,
    counterparty: transaction.counterparty,
    amount_cents: transaction.amount_cents,
    active_allocation_count: activeTransactionAllocations.length,
  },
  invoice_2: {
    id: INVOICE_2_ID,
    total_cents: 144_000,
    existing_job_cost_cents: invoice2ExistingLineTotal,
    missing_job_cost_cents: invoice2MissingTotal,
    missing_allocations: invoice2PlannedAllocations,
  },
  new_invoices: invoices.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    issued_on: invoice.issuedOn,
    total_cents: invoice.totalCents,
    customer: invoice.customer,
    job_id: invoice.jobId,
    job_evidence: invoice.jobEvidence,
    source_path: invoice.sourcePath,
    sha256: invoice.expectedHash,
    document_id: invoice.documentId,
    storage_path: invoice.storagePath,
  })),
  missing_shezara_job: {
    proposal_number: shezara.proposalNumber,
    quote_id: shezara.quoteId,
    job_id: shezara.jobId,
    accepted_at: shezara.acceptedAt,
    gross_cents: shezara.grossCents,
    before_hst_cents: shezara.subtotalCents,
    hst_cents: shezara.taxCents,
    existing_quote: Boolean(shezaraQuoteResult.data),
    existing_job: Boolean(shezaraJobResult.data),
  },
  payment_plan: paymentPlan,
  payment_total_cents: 244_500,
}, null, 2));
if (!APPLY) process.exit(0);

const sourceJob = jobById.get("2e473c02-16fe-58a7-8675-5b5b00a93ae6");
const shezaraLeadId = "c96d6ad1-2899-5c95-8752-84376b34d2d8";

const contactWrite = await db.from("contacts").update({
  email: "fennecps@outlook.com",
  phone: "3439972114",
  normalized_email: "fennecps@outlook.com",
  normalized_phone: "3439972114",
  metadata: {
    ...(contactResult.data.metadata ?? {}),
    payment_destination: "bilal.akkacha2@outlook.com",
    source_sender_email: "fennecps@outlook.com",
    source_mobile: "3439972114",
    source_verified_from_invoices: ["3", "4", "5"],
  },
  updated_at: capturedAt,
}).eq("id", FENNEC_CONTACT_ID);
if (contactWrite.error) throw contactWrite.error;

const proposalDocumentWrite = await db.from("documents").upsert({
  id: shezara.documentId,
  kind: "dripjobs_proposal_acceptance_email",
  original_filename: "2026-07-31 - DripJobs proposal 2873427 accepted.txt",
  mime_type: "text/plain",
  size_bytes: Buffer.byteLength(shezara.sourceBody),
  content_sha256: shezara.documentHash,
  source_url: `https://mail.google.com/mail/#all/${shezara.gmailMessageId}`,
  captured_at: capturedAt,
  metadata: {
    gmail_message_id: shezara.gmailMessageId,
    sender: "Ottawa Painters job-updates@dripjobs.com",
    subject: "Proposal #2873427 Accepted on Behalf of Customer",
    email_timestamp: shezara.acceptedAt,
    customer: "Shezara Ali",
    proposal_number: shezara.proposalNumber,
    generated_invoice_gross_cents: shezara.grossCents,
    text_excerpt: shezara.sourceBody,
  },
}, { onConflict: "id" });
if (proposalDocumentWrite.error) throw proposalDocumentWrite.error;

const quoteWrite = await db.from("quotes").upsert({
  id: shezara.quoteId,
  lead_id: shezaraLeadId,
  dripjobs_proposal_id: shezara.proposalNumber,
  name: "Shezara Ali — proposal 2873427",
  status: "accepted",
  amount_cents: shezara.grossCents,
  tax_cents: shezara.taxCents,
  accepted_at: shezara.acceptedAt,
  source: "dripjobs_email_evidence",
  metadata: {
    source_gmail_message_id: shezara.gmailMessageId,
    source_document_id: shezara.documentId,
    generated_invoice_gross_cents: shezara.grossCents,
    derived_subtotal_cents: shezara.subtotalCents,
    tax_rate: 0.13,
    accounting_status: "active",
  },
  created_at: shezara.acceptedAt,
  updated_at: capturedAt,
}, { onConflict: "id" });
if (quoteWrite.error) throw quoteWrite.error;

const shezaraContactId = "4e4c54ac-89fb-5741-a2ae-9f39531d054e";
const shezaraCurrentJob = (await db.from("jobs").select("*").eq("id", "f0cd9e9f-f153-5bae-a68f-4b940e99fbee").single());
if (shezaraCurrentJob.error) throw shezaraCurrentJob.error;
const jobWrite = await db.from("jobs").upsert({
  id: shezara.jobId,
  contact_id: shezaraContactId,
  lead_id: shezaraLeadId,
  accepted_quote_id: shezara.quoteId,
  name: "Shezara Ali — proposal 2873427",
  status: "active",
  contract_amount_cents: shezara.grossCents,
  address_line_1: shezaraCurrentJob.data.address_line_1,
  address_line_2: shezaraCurrentJob.data.address_line_2,
  city: shezaraCurrentJob.data.city,
  province: shezaraCurrentJob.data.province,
  postal_code: shezaraCurrentJob.data.postal_code,
  country: shezaraCurrentJob.data.country,
  formatted_address: shezaraCurrentJob.data.formatted_address,
  companycam_project_ids: [],
  started_on: "2026-07-31",
  is_feed_visible: true,
  source: "dripjobs_email_evidence",
  metadata: {
    dripjobs_job_number: shezara.proposalNumber,
    accounting_status: "active",
    source_gmail_message_id: shezara.gmailMessageId,
    source_document_id: shezara.documentId,
    generated_invoice_gross_cents: shezara.grossCents,
    derived_subtotal_cents: shezara.subtotalCents,
    tax_rate: 0.13,
    identity_note: "Separate accounting job for DripJobs proposal 2873427; must not merge with proposal 3159412.",
  },
  created_at: shezara.acceptedAt,
  updated_at: capturedAt,
}, { onConflict: "id" });
if (jobWrite.error) throw jobWrite.error;

const budgetWrite = await db.from("job_budgets").upsert({
  id: stableUuid(`job-budget:${shezara.jobId}:project_budget:1`),
  job_id: shezara.jobId,
  quote_id: shezara.quoteId,
  version: 1,
  status: "active",
  budget_minutes: null,
  amount_including_tax_cents: shezara.subtotalCents,
  labour_allocation_percent: 40,
  source: "project_budget",
  notes: "Before-HST amount derived exactly from DripJobs generated-invoice gross $1,406.85 at 13% HST.",
  metadata: {
    source_gmail_message_id: shezara.gmailMessageId,
    source_document_id: shezara.documentId,
    source_gross_cents: shezara.grossCents,
    source_tax_cents: shezara.taxCents,
    source_before_hst_cents: shezara.subtotalCents,
    derivation: "gross / 1.13",
  },
  created_at: shezara.acceptedAt,
  updated_at: capturedAt,
}, { onConflict: "job_id,source,version" });
if (budgetWrite.error) throw budgetWrite.error;

for (const entity of [
  { type: "quote", id: shezara.quoteId, role: "proposal_acceptance" },
  { type: "job", id: shezara.jobId, role: "proposal_identity" },
]) {
  const linkWrite = await db.from("evidence_links").upsert({
    id: stableUuid(`evidence-link:${shezara.documentId}:${entity.type}:${entity.id}`),
    document_id: shezara.documentId,
    entity_type: entity.type,
    entity_id: entity.id,
    evidence_role: entity.role,
    metadata: { proposal_number: shezara.proposalNumber },
    created_at: capturedAt,
  }, { onConflict: "id" });
  if (linkWrite.error) throw linkWrite.error;
}

for (const invoice of invoices) {
  const upload = await db.storage.from("labour-invoices").upload(
    invoice.storagePath,
    invoice.sourceBuffer,
    { contentType: "application/pdf", upsert: false },
  );
  if (upload.error && !String(upload.error.message).toLocaleLowerCase("en-CA").includes("already exists")) {
    throw upload.error;
  }

  const documentWrite = await db.from("documents").upsert({
    id: invoice.documentId,
    kind: "invoice",
    original_filename: invoice.originalFilename,
    mime_type: "application/pdf",
    size_bytes: statSync(invoice.sourcePath).size,
    content_sha256: invoice.expectedHash,
    storage_bucket: "labour-invoices",
    storage_path: invoice.storagePath,
    source_url: `https://mail.google.com/mail/#all/${invoice.messageId}`,
    captured_at: capturedAt,
    metadata: {
      source_date: invoice.receivedAt.slice(0, 10),
      source_label: `Gmail / Labour Invoices · message ${invoice.messageId}`,
      gmail_message_id: invoice.messageId,
      sender: "Bilal Akkacha <fennecps@outlook.com>",
      subject: "BILAL AKKACHA - Painting Services",
      invoice_number: invoice.number,
      supplier_name: "Fennec Contracting",
      customer: invoice.customer,
      total_cents: invoice.totalCents,
      text_excerpt: `${invoice.customer}; ${invoice.serviceText}; total $${(invoice.totalCents / 100).toFixed(2)}.`,
    },
  }, { onConflict: "id" });
  if (documentWrite.error) throw documentWrite.error;

  const invoiceWrite = await db.from("invoices").upsert({
    id: invoice.id,
    contact_id: FENNEC_CONTACT_ID,
    direction: "payable",
    category: "labour",
    source_system: "gmail_labour_invoice",
    external_id: invoice.messageId,
    invoice_number: invoice.number,
    status: "paid",
    issued_on: invoice.issuedOn,
    due_on: invoice.dueOn,
    currency: "CAD",
    subtotal_cents: invoice.totalCents,
    tax_cents: 0,
    total_cents: invoice.totalCents,
    paid_cents: invoice.totalCents,
    balance_cents: 0,
    metadata: {
      source_label: `Gmail / Labour Invoices · message ${invoice.messageId}`,
      document_type: "invoice",
      payment_basis: "invoice_total",
      supplier_name: "Fennec Contracting",
      contractor_name: "Bilal Akkacha",
      source_document_id: invoice.documentId,
      source_document_sha256: invoice.expectedHash,
      source_gmail_message_id: invoice.messageId,
      payment_destination: "bilal.akkacha2@outlook.com",
      tax_registration_status: "not_registered_on_source",
    },
    created_at: invoice.receivedAt,
    updated_at: capturedAt,
  }, { onConflict: "id" });
  if (invoiceWrite.error) throw invoiceWrite.error;

  const lineWrite = await db.from("invoice_lines").upsert({
    id: invoice.lineId,
    invoice_id: invoice.id,
    line_number: 1,
    description: `${invoice.customer} — ${invoice.serviceText}`,
    quantity: 1,
    unit: "service",
    unit_price_cents: invoice.totalCents,
    subtotal_cents: invoice.totalCents,
    tax_cents: 0,
    total_cents: invoice.totalCents,
    service_started_on: invoice.issuedOn,
    service_ended_on: invoice.number === "5" ? "2026-08-06" : invoice.issuedOn,
    source_kind: "physical_labour_invoice_item",
    metadata: {
      entry_type: "labour",
      source_text: invoice.serviceText,
      source_document_id: invoice.documentId,
      source_document_sha256: invoice.expectedHash,
      source_gmail_message_id: invoice.messageId,
      printed_minutes: invoice.minutes,
    },
    created_at: invoice.receivedAt,
    updated_at: capturedAt,
  }, { onConflict: "id" });
  if (lineWrite.error) throw lineWrite.error;

  const jobAllocationWrite = await db.from("invoice_job_allocations").upsert({
    id: stableUuid(`invoice-job-allocation:${invoice.lineId}:${invoice.jobId}`),
    invoice_id: invoice.id,
    invoice_line_id: invoice.lineId,
    job_id: invoice.jobId,
    subtotal_cents: invoice.totalCents,
    tax_cents: 0,
    total_cents: invoice.totalCents,
    quantity: 1,
    minutes: invoice.minutes,
    allocation_method: invoice.number === "3"
      ? "printed_customer_plus_same_day_dripjobs_proposal_identity"
      : "exact_printed_customer_name",
    confidence: 1,
    needs_review: false,
    metadata: {
      customer: invoice.customer,
      job_evidence: invoice.jobEvidence,
      source_document_id: invoice.documentId,
      source_gmail_message_id: invoice.messageId,
    },
    created_at: invoice.receivedAt,
    updated_at: capturedAt,
  }, { onConflict: "id" });
  if (jobAllocationWrite.error) throw jobAllocationWrite.error;

  const evidenceWrite = await db.from("evidence_links").upsert({
    id: stableUuid(`evidence-link:${invoice.documentId}:invoice:${invoice.id}`),
    document_id: invoice.documentId,
    entity_type: "invoice",
    entity_id: invoice.id,
    evidence_role: "source_document",
    metadata: { invoice_number: invoice.number, gmail_message_id: invoice.messageId },
    created_at: capturedAt,
  }, { onConflict: "id" });
  if (evidenceWrite.error) throw evidenceWrite.error;
}

for (const allocation of invoice2PlannedAllocations) {
  const write = await db.from("invoice_job_allocations").upsert({
    id: stableUuid(`invoice-job-allocation:${allocation.lineId}:${allocation.jobId}`),
    invoice_id: INVOICE_2_ID,
    invoice_line_id: allocation.lineId,
    job_id: allocation.jobId,
    subtotal_cents: allocation.amountCents,
    tax_cents: 0,
    total_cents: allocation.amountCents,
    quantity: 1,
    minutes: Math.round(allocation.amountCents / 50),
    allocation_method: "exact_printed_customer_name_revised_invoice",
    confidence: 1,
    needs_review: false,
    metadata: {
      customer: allocation.customer,
      source_invoice_number: "2",
      correction_reason: "Current revised invoice line existed without a current line-level job allocation after v2 migration.",
    },
    created_at: capturedAt,
    updated_at: capturedAt,
  }, { onConflict: "id" });
  if (write.error) throw write.error;
}

for (const payment of paymentPlan) {
  const paymentWrite = await db.from("transaction_allocations").upsert({
    id: stableUuid(`transaction-allocation:${TRANSACTION_ID}:invoice:${payment.invoiceId}`),
    transaction_id: TRANSACTION_ID,
    invoice_id: payment.invoiceId,
    contact_id: FENNEC_CONTACT_ID,
    source_system: "gmail_labour_invoice_and_easyweb",
    external_id: `C1Afac***9rR:fennec-invoice-${payment.invoiceNumber}`,
    allocation_type: "labour_payment",
    amount_cents: payment.amountCents,
    allocation_method: "exact_contractor_and_grouped_invoice_sum",
    confidence: 1,
    needs_review: false,
    metadata: {
      invoice_number: payment.invoiceNumber,
      grouped_invoice_numbers: ["2", "3", "4", "5"],
      grouped_total_cents: 244_500,
      transaction_confirmation_masked: "C1Afac***9rR",
      payment_posted_on: "2026-08-06",
      recipient: "Bilal Akkacha",
      recipient_destination: "bilal.akkacha2@outlook.com",
    },
    created_at: capturedAt,
    updated_at: capturedAt,
  }, { onConflict: "id" });
  if (paymentWrite.error) throw paymentWrite.error;

  const invoiceWrite = await db.from("invoices").update({
    status: "paid",
    paid_cents: payment.amountCents,
    balance_cents: 0,
    updated_at: capturedAt,
  }).eq("id", payment.invoiceId).eq("total_cents", payment.amountCents);
  if (invoiceWrite.error) throw invoiceWrite.error;
}

const transactionWrite = await db.from("transactions").update({
  contact_id: FENNEC_CONTACT_ID,
  counterparty: "Bilal Akkacha / Fennec Contracting",
  category: "Subcontractors",
  review_status: "reconciled",
  notes: "Exact grouped settlement: Fennec invoices #2 ($1,440.00), #3 ($352.50), #4 ($142.50), and #5 ($510.00) total $2,445.00.",
  metadata: {
    ...(transaction.metadata ?? {}),
    recipient_verification: {
      ...(transaction.metadata?.recipient_verification ?? {}),
      invoice_match_status: "exact_grouped_payable_invoices",
      exact_invoice_numbers: ["2", "3", "4", "5"],
      exact_invoice_total_cents: 244_500,
      matched_contact_id: FENNEC_CONTACT_ID,
    },
    bank_reconciliation: {
      status: "reconciled",
      method: "exact_contractor_and_grouped_invoice_sum",
      invoice_numbers: ["2", "3", "4", "5"],
      invoice_ids: paymentPlan.map((payment) => payment.invoiceId),
      allocated_cents: 244_500,
      confirmation_masked: "C1Afac***9rR",
      reconciled_at: capturedAt,
    },
  },
  updated_at: capturedAt,
}).eq("id", TRANSACTION_ID).eq("amount_cents", -244_500);
if (transactionWrite.error) throw transactionWrite.error;

for (const invoice of [
  { id: INVOICE_2_ID, number: "2", documentId: "17d34d01-5ff5-5a81-aa0a-5a87b302412d", totalCents: 144_000 },
  ...invoices.map((invoice) => ({ id: invoice.id, number: invoice.number, documentId: invoice.documentId, totalCents: invoice.totalCents })),
]) {
  const eventWrite = await db.from("verification_events").upsert({
    id: stableUuid(`verification:fennec-invoice-payment:${invoice.id}:${TRANSACTION_ID}`),
    entity_type: "invoice",
    entity_id: invoice.id,
    action: "invoice_imported_allocated_and_paid",
    reason: `Fennec invoice #${invoice.number} is part of the exact $2,445.00 grouped settlement to Bilal Akkacha on 2026-08-06.`,
    old_values: invoice.number === "2" ? {
      status: invoice2.status,
      paid_cents: invoice2.paid_cents,
      balance_cents: invoice2.balance_cents,
      current_line_allocation_cents: invoice2ExistingLineTotal,
    } : null,
    new_values: {
      status: "paid",
      total_cents: invoice.totalCents,
      paid_cents: invoice.totalCents,
      balance_cents: 0,
      transaction_id: TRANSACTION_ID,
      grouped_invoice_numbers: ["2", "3", "4", "5"],
    },
    evidence: {
      source_document_id: invoice.documentId,
      transaction_id: TRANSACTION_ID,
      transaction_confirmation_masked: "C1Afac***9rR",
    },
    occurred_at: capturedAt,
  }, { onConflict: "id" });
  if (eventWrite.error) throw eventWrite.error;
}

const verification = await db.from("transactions")
  .select("id,amount_cents,category,review_status,contact:contacts(id,name,email),allocations:transaction_allocations(id,invoice_id,amount_cents,needs_review,reversed_at,invoice:invoices!transaction_allocations_invoice_id_fkey(id,invoice_number,status,subtotal_cents,tax_cents,total_cents,paid_cents,balance_cents,lines:invoice_lines(id,line_number,subtotal_cents,total_cents),job_allocations:invoice_job_allocations(id,invoice_line_id,job_id,subtotal_cents,total_cents,needs_review,job:jobs(id,name,status))))")
  .eq("id", TRANSACTION_ID)
  .single();
if (verification.error) throw verification.error;
const active = (verification.data.allocations ?? []).filter((allocation) => !allocation.reversed_at);
if (
  verification.data.review_status !== "reconciled" ||
  verification.data.category !== "Subcontractors" ||
  active.length !== 4 ||
  active.reduce((sum, allocation) => sum + Number(allocation.amount_cents), 0) !== 244_500 ||
  active.some((allocation) => allocation.needs_review)
) throw new Error("Post-write payment verification failed.");
for (const allocation of active) {
  const invoice = allocation.invoice;
  const lineTotal = (invoice.lines ?? []).reduce((sum, line) => sum + Number(line.total_cents), 0);
  const jobTotal = (invoice.job_allocations ?? [])
    .filter((jobAllocation) => jobAllocation.invoice_line_id && !jobAllocation.metadata?.reversed_at)
    .reduce((sum, jobAllocation) => sum + Number(jobAllocation.total_cents), 0);
  if (
    invoice.status !== "paid" ||
    Number(invoice.paid_cents) !== Number(invoice.total_cents) ||
    Number(invoice.balance_cents) !== 0 ||
    lineTotal !== Number(invoice.total_cents) ||
    jobTotal !== Number(invoice.total_cents)
  ) throw new Error(`Post-write invoice verification failed for Fennec #${invoice.invoice_number}.`);
}
console.log(JSON.stringify({ status: "verified", transaction: verification.data }, null, 2));
