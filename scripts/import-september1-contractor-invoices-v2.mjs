#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const SOURCE_SYSTEM = "gmail_contractor_invoice";
const STORAGE_BUCKET = "labour-invoices";
const ACCOUNTING_CUTOFF = "2026-06-01";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const capturedAt = new Date().toISOString();

const contacts = {
  dressing: "3ebc77f7-30c4-557a-ad7c-b33ea1bbd518",
  fennec: "e2500be8-15c2-5e95-8b37-7104814d14be",
  abdellah: "14354ec3-5e7c-5638-bc9a-282df6296244",
};

const jobs = {
  sherrie: "b0bc0dba-9412-50de-afb8-d26899e4330f",
  christine: "562e008b-5e8d-5c14-a9e5-32ac068bb64d",
  darya: "7b11cfde-5772-5682-a09f-2061255fa01a",
  erin: "b66f4fa0-d463-5c6e-8442-e40a75122327",
  chris: "0ac3da2a-7b22-5192-8f18-4875015f3546",
  adeel: "23736ee5-8e26-5c33-9993-a0254e1d2f27",
};

const invoices = [
  {
    supplier: "Dressing Rooms",
    contactId: contacts.dressing,
    category: "other",
    number: "416",
    issuedOn: "2026-09-01",
    dueOn: "2026-09-01",
    messageId: "1a05d3fb6d3686db",
    filename: "Invoice_416_from_Dressing_Rooms.pdf",
    localPath: "/Users/jadslim/.workspace-mcp/attachments/Invoice_416_from_Dressing_Rooms_c0552938-12fa-4f32-9394-66a478c3302e.pdf",
    expectedHash: "0a587cc908621ca2745ac0a2acc720a5c6ab566b825d550447bb5e251a041852",
    senderEmail: "quickbooks@notification.intuit.com",
    replyToEmail: "creativespaces@dressingrooms.ca",
    supplierMatchMethod: "authenticated_invoice_platform",
    costClassification: "colour_consultation",
    lines: [
      { description: "Sherrie Egan - Paint Consultation - August 3, 2026", printedMatchValue: "SHERRIE EGAN", serviceOn: "2026-08-03", subtotal: 18_000, tax: 2_340, jobId: jobs.sherrie, expectedJobName: "Sherrie Egan" },
      { description: "Christine Nasrallah - Paint Consultation - August 14, 2026", printedMatchValue: "CHRISTINE NASRALLAH", serviceOn: "2026-08-14", subtotal: 18_000, tax: 2_340, jobId: jobs.christine, expectedJobName: "Christine Nasrallah" },
      { description: "Darya Rafi - Paint Consultation - August 14, 2026", printedMatchValue: "DARYA RAFI", serviceOn: "2026-08-14", subtotal: 18_000, tax: 2_340, jobId: jobs.darya, expectedJobName: "Darya Rafi" },
      { description: "Erin Zuber - Paint Consultation - August 24, 2026", printedMatchValue: "ERIN ZUBER", serviceOn: "2026-08-24", subtotal: 18_000, tax: 2_340, jobId: jobs.erin, expectedJobName: "Erin zuber" },
      { description: "Chris Casey - Paint Consultation - August 31, 2026", printedMatchValue: "CHRIS CASEY", serviceOn: "2026-08-31", subtotal: 18_000, tax: 2_340, jobId: jobs.chris, expectedJobName: "Chris Casey" },
      { description: "Adeel Anwar - Paint Consultation - August 31, 2026", printedMatchValue: "ADEEL ANWAR", serviceOn: "2026-08-31", subtotal: 18_000, tax: 2_340, jobId: jobs.adeel, expectedJobName: "Adeel Anwar" },
    ],
  },
  {
    supplier: "Fennec Contracting",
    contactId: contacts.fennec,
    category: "labour",
    number: "13",
    issuedOn: "2026-08-30",
    dueOn: "2026-09-14",
    messageId: "1a0553764b7bbe79",
    filename: "Invoice_13_2026-09-14.pdf",
    localPath: "/Users/jadslim/.workspace-mcp/attachments/Invoice_13_2026-09-14_a795a901-a4a4-49cd-bb3d-c758dc90fbe5.pdf",
    expectedHash: "b13348b4c326cb4a2218d7c5bbcf55939d8b71ea40c40121a1c7433d44323f72",
    senderEmail: "fennecps@outlook.com",
    supplierMatchMethod: "exact_sender_email",
    paymentDestination: "akkachabilal@gmail.com",
    lines: [
      { description: "Wardah Vacher - painting services, August 24-27; printed total 31h", printedMatchValue: "Wardah Vacher", serviceStart: "2026-08-24", serviceEnd: "2026-08-27", subtotal: 93_000, tax: 0, reviewReason: "No exact current job named Wardah Vacher exists." },
    ],
  },
  {
    supplier: "Fennec Contracting",
    contactId: contacts.fennec,
    category: "labour",
    number: "12",
    issuedOn: "2026-08-30",
    dueOn: "2026-09-14",
    messageId: "1a055315c40bb246",
    filename: "Invoice_12_2026-09-14.pdf",
    localPath: "/Users/jadslim/.workspace-mcp/attachments/Invoice_12_2026-09-14_424b72f3-0f94-45e0-8a53-d0933a052b6d.pdf",
    expectedHash: "f538cb38c547494e37fe2de025792dbedc7910f2b3b827516c9618b631d249b5",
    senderEmail: "fennecps@outlook.com",
    supplierMatchMethod: "exact_sender_email",
    paymentDestination: "akkachabilal@gmail.com",
    lines: [
      { description: "Darya Raffi - painting services, August 20-23; printed total 30h30m", printedMatchValue: "Darya Raffi", serviceStart: "2026-08-20", serviceEnd: "2026-08-23", subtotal: 91_500, tax: 0, reviewReason: "Printed Darya Raffi is not an exact match for the current job Darya Rafi." },
    ],
  },
  {
    supplier: "Fennec Contracting",
    contactId: contacts.fennec,
    category: "labour",
    number: "11",
    issuedOn: "2026-08-30",
    dueOn: "2026-09-14",
    messageId: "1a0552c01ba0940e",
    filename: "Invoice_11_2026-09-14.pdf",
    localPath: "/Users/jadslim/.workspace-mcp/attachments/Invoice_11_2026-09-14_ec56eaa9-7d8d-4529-96d1-3efdab4fd758.pdf",
    expectedHash: "6cb3fb0857d075a5e2a8c24b76d76e1237e518ddebd6836d80a288293d537bf2",
    senderEmail: "fennecps@outlook.com",
    supplierMatchMethod: "exact_sender_email",
    paymentDestination: "akkachabilal@gmail.com",
    lines: [
      { description: "Lesley - painting services, August 18; printed 11h 5mn", printedMatchValue: "Lesley", serviceStart: "2026-08-18", serviceEnd: "2026-08-18", subtotal: 33_150, tax: 0, reviewReason: "Printed Lesley is not an exact match for the current job Lesley Lesley." },
    ],
  },
  {
    supplier: "Fennec Contracting",
    contactId: contacts.fennec,
    category: "labour",
    number: "10",
    issuedOn: "2026-08-30",
    dueOn: "2026-09-14",
    messageId: "1a05523af1f830c5",
    filename: "Invoice_10_2026-09-14.pdf",
    localPath: "/Users/jadslim/.workspace-mcp/attachments/Invoice_10_2026-09-14_f0588f97-40c9-4f1c-9506-2b407e7ecbfd.pdf",
    expectedHash: "0ad2ecb186b3cf5cf117ba7170a889a7c3b860011040e57954f43b8607da4d86",
    senderEmail: "fennecps@outlook.com",
    supplierMatchMethod: "exact_sender_email",
    paymentDestination: "akkachabilal@gmail.com",
    lines: [
      { description: "Sherrie Egan - painting services, August 12-17; printed total 45h 19m", printedMatchValue: "Sherrie Egan", serviceStart: "2026-08-12", serviceEnd: "2026-08-17", subtotal: 135_950, tax: 0, jobId: jobs.sherrie, expectedJobName: "Sherrie Egan" },
    ],
  },
  {
    supplier: "Abdellah Aouf",
    contactId: contacts.abdellah,
    category: "labour",
    number: "INV-20260829-001",
    issuedOn: "2026-08-29",
    dueOn: "2026-09-12",
    messageId: "1a0543a3aec5424c",
    filename: "INV-20260829-001.pdf",
    localPath: "/Users/jadslim/.workspace-mcp/attachments/INV-20260829-001_f5a2538e-a924-4752-a811-3c00c12150ab.pdf",
    expectedHash: "1ed066dc037e5d9ebbbb38acdf6f6ddaf9f821f3aedad960c5a439579b852ee5",
    senderEmail: "anasalgonq@gmail.com",
    supplierMatchMethod: "labelled_labour_invoice_exact_supplier_name",
    lines: [
      { description: "Job 1: Katharina - 1 White Cedar street, Ottawa, ON K2S 1P1", printedMatchValue: "Katharina / 1 White Cedar street", subtotal: 37_050, tax: 0, reviewReason: "Conflicting exact evidence: Katharina identifies one current job while 1 White Cedar identifies Erin Zuber." },
    ],
  },
];

function parseEnv(file) {
  if (!existsSync(file)) return {};
  const result = {};
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    let value = line.slice(index + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[line.slice(0, index).trim()] = value;
  }
  return result;
}

function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

function data(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

for (const invoice of invoices) {
  assert(existsSync(invoice.localPath), `Missing invoice PDF: ${invoice.filename}`);
  invoice.bytes = readFileSync(invoice.localPath);
  invoice.hash = sha256(invoice.bytes);
  assert(invoice.hash === invoice.expectedHash, `Invoice PDF hash changed: ${invoice.filename}`);
  invoice.subtotal = invoice.lines.reduce((sum, line) => sum + line.subtotal, 0);
  invoice.tax = invoice.lines.reduce((sum, line) => sum + line.tax, 0);
  invoice.total = invoice.subtotal + invoice.tax;
  invoice.id = stableUuid(`invoice:${SOURCE_SYSTEM}:sha256:${invoice.hash}`);
  invoice.documentId = stableUuid(`document:sha256:${invoice.hash}`);
  invoice.storagePath = `gmail-contractor-invoices/${invoice.issuedOn}/${invoice.hash.slice(0, 16)}-${invoice.filename}`;
  for (const [index, line] of invoice.lines.entries()) {
    line.lineNumber = index + 1;
    line.total = line.subtotal + line.tax;
    line.id = stableUuid(`invoice-line:${invoice.id}:${line.lineNumber}`);
  }
}

const env = {
  ...parseEnv(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnv(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
assert(supabaseUrl && env.SUPABASE_SERVICE_ROLE_KEY, "Missing server-side Supabase credentials.");
assert(new URL(supabaseUrl).hostname.split(".")[0] === PROJECT_REF, "Unexpected Supabase project.");
const db = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const allJobIds = [...new Set(invoices.flatMap((invoice) => invoice.lines.map((line) => line.jobId).filter(Boolean)))];
const [contactRows, jobRows, invoiceRows, documentRows] = await Promise.all([
  db.from("contacts").select("id,name,email,kind").in("id", Object.values(contacts)),
  db.from("jobs").select("id,name,status,started_on,completed_on,archived_at,production_month").in("id", allJobIds),
  db.from("invoices").select("id,contact_id,invoice_number,total_cents,external_id,metadata").or(`id.in.(${invoices.map((invoice) => invoice.id).join(",")}),external_id.in.(${invoices.map((invoice) => `sha256:${invoice.hash}`).join(",")})`),
  db.from("documents").select("id,content_sha256,storage_bucket,storage_path").in("content_sha256", invoices.map((invoice) => invoice.hash)),
]);
for (const [label, result] of Object.entries({ contactRows, jobRows, invoiceRows, documentRows })) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

assert(contactRows.data.length === Object.keys(contacts).length, "A contractor contact is missing.");
assert(jobRows.data.length === allJobIds.length, "A required current job is missing.");
const jobsById = new Map(jobRows.data.map((job) => [job.id, job]));
for (const invoice of invoices) {
  const contact = contactRows.data.find((row) => row.id === invoice.contactId);
  assert(contact?.name === invoice.supplier, `Contractor identity changed for ${invoice.supplier}.`);
  for (const line of invoice.lines.filter((item) => item.jobId)) {
    const job = jobsById.get(line.jobId);
    assert(job?.name === line.expectedJobName, `Exact job identity changed for ${line.printedMatchValue}.`);
    assert(!job.archived_at && !["archived", "cancelled", "canceled"].includes(String(job.status).toLowerCase()), `${job.name} is not an eligible current job.`);
    assert(!job.started_on || job.started_on >= ACCOUNTING_CUTOFF, `${job.name} is locked by the historical accounting cutoff.`);
    assert(job.started_on || !["completed", "archived"].includes(String(job.status).toLowerCase()), `${job.name} has no verified current date.`);
  }
  const duplicate = invoiceRows.data.find((row) => row.id === invoice.id || row.external_id === `sha256:${invoice.hash}`);
  if (duplicate) {
    assert(duplicate.id === invoice.id && Number(duplicate.total_cents) === invoice.total && duplicate.contact_id === invoice.contactId, `Conflicting existing invoice for ${invoice.number}.`);
  }
  const document = documentRows.data.find((row) => row.content_sha256 === invoice.hash);
  if (document) assert(document.id === invoice.documentId, `Conflicting archived document for ${invoice.number}.`);
}

const preview = invoices.map((invoice) => ({
  supplier: invoice.supplier,
  invoice_number: invoice.number,
  issued_on: invoice.issuedOn,
  subtotal_cents: invoice.subtotal,
  tax_cents: invoice.tax,
  total_cents: invoice.total,
  existing: invoiceRows.data.some((row) => row.id === invoice.id),
  job_links: invoice.lines.filter((line) => line.jobId).map((line) => ({ printed: line.printedMatchValue, job: jobsById.get(line.jobId)?.name, subtotal_cents: line.subtotal })),
  unassigned: invoice.lines.filter((line) => !line.jobId).map((line) => ({ printed: line.printedMatchValue, subtotal_cents: line.subtotal, reason: line.reviewReason })),
}));
console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", invoices: preview }, null, 2));
if (!APPLY) process.exit(0);

async function archiveDocument(invoice) {
  const existing = documentRows.data.find((row) => row.content_sha256 === invoice.hash);
  if (!existing) {
    const upload = await db.storage.from(STORAGE_BUCKET).upload(invoice.storagePath, invoice.bytes, { contentType: "application/pdf", upsert: false });
    if (upload.error && !/already exists/i.test(upload.error.message)) throw upload.error;
    data(`document ${invoice.number}`, await db.from("documents").insert({
      id: invoice.documentId,
      kind: "labour_invoice",
      original_filename: invoice.filename,
      mime_type: "application/pdf",
      size_bytes: invoice.bytes.length,
      content_sha256: invoice.hash,
      storage_bucket: STORAGE_BUCKET,
      storage_path: invoice.storagePath,
      source_url: `https://mail.google.com/mail/u/0/#all/${invoice.messageId}`,
      captured_at: capturedAt,
      metadata: {
        source: SOURCE_SYSTEM,
        gmail_message_id: invoice.messageId,
        attachment_index: 1,
        sender_email: invoice.senderEmail,
        supplier_match_method: invoice.supplierMatchMethod,
        source_label_name: "Finance/Contractor invoices",
      },
    }));
  }
}

for (const invoice of invoices) {
  await archiveDocument(invoice);
  const existing = invoiceRows.data.find((row) => row.id === invoice.id);
  if (existing) continue;
  const assigned = invoice.lines.filter((line) => line.jobId);
  const unassigned = invoice.lines.filter((line) => !line.jobId);
  data(`invoice ${invoice.number}`, await db.from("invoices").insert({
    id: invoice.id,
    contact_id: invoice.contactId,
    direction: "payable",
    category: invoice.category,
    source_system: SOURCE_SYSTEM,
    external_id: `sha256:${invoice.hash}`,
    invoice_number: invoice.number,
    status: "recorded",
    issued_on: invoice.issuedOn,
    due_on: invoice.dueOn,
    currency: "CAD",
    subtotal_cents: invoice.subtotal,
    tax_cents: invoice.tax,
    total_cents: invoice.total,
    paid_cents: 0,
    balance_cents: invoice.total,
    metadata: {
      match_status: unassigned.length ? "needs_review" : "assigned",
      document_type: "invoice",
      supplier_name: invoice.supplier,
      supplier_sender_email: invoice.senderEmail,
      supplier_reply_to_email: invoice.replyToEmail ?? null,
      supplier_match_method: invoice.supplierMatchMethod,
      payment_destination: invoice.paymentDestination ?? null,
      source_label_name: "Finance/Contractor invoices",
      source_document_id: invoice.documentId,
      source_document_sha256: invoice.hash,
      source_gmail_message_id: invoice.messageId,
      source_gmail_attachment_index: 1,
      automatic_import: true,
      payment_status: "unpaid",
      itemization_status: "itemized_from_source",
      job_assignment_status: unassigned.length ? (assigned.length ? "partially_unassigned" : "unassigned") : "fully_assigned",
      job_assignment_count: assigned.length,
      unassigned_line_count: unassigned.length,
      job_allocation_required: true,
      ...(invoice.costClassification ? { cost_classification: invoice.costClassification, classification_evidence: "Every printed line is explicitly Paint Consultation." } : {}),
    },
    created_at: capturedAt,
    updated_at: capturedAt,
  }));

  for (const line of invoice.lines) {
    data(`line ${invoice.number}.${line.lineNumber}`, await db.from("invoice_lines").insert({
      id: line.id,
      invoice_id: invoice.id,
      line_number: line.lineNumber,
      description: line.description,
      quantity: 1,
      unit: "service",
      unit_price_cents: line.subtotal,
      subtotal_cents: line.subtotal,
      tax_cents: line.tax,
      total_cents: line.total,
      service_started_on: line.serviceOn ?? line.serviceStart ?? null,
      service_ended_on: line.serviceOn ?? line.serviceEnd ?? null,
      source_kind: "gmail_contractor_invoice_item",
      metadata: {
        entry_type: invoice.category === "other" ? "other" : "labour",
        needs_review: !line.jobId,
        job_allocation_required: true,
        source_document_id: invoice.documentId,
        source_gmail_message_id: invoice.messageId,
        printed_match_type: line.jobId ? "name" : "unassigned",
        printed_match_value: line.printedMatchValue,
        ...(line.reviewReason ? { review_reason: line.reviewReason } : {}),
        ...(invoice.costClassification ? { cost_classification: invoice.costClassification } : {}),
      },
      created_at: capturedAt,
      updated_at: capturedAt,
    }));
    if (line.jobId) {
      data(`allocation ${invoice.number}.${line.lineNumber}`, await db.from("invoice_job_allocations").insert({
        id: stableUuid(`invoice-job-allocation:${line.id}:${line.jobId}`),
        invoice_id: invoice.id,
        invoice_line_id: line.id,
        job_id: line.jobId,
        subtotal_cents: line.subtotal,
        tax_cents: line.tax,
        total_cents: line.total,
        quantity: 1,
        allocation_method: "exact_printed_name",
        confidence: 1,
        needs_review: false,
        metadata: {
          source_document_id: invoice.documentId,
          source_document_sha256: invoice.hash,
          source_gmail_message_id: invoice.messageId,
          printed_description: line.description,
          printed_match_type: "name",
          printed_match_value: line.printedMatchValue,
        },
        created_at: capturedAt,
        updated_at: capturedAt,
      }));
    }
  }
  data(`evidence ${invoice.number}`, await db.from("evidence_links").insert({
    id: stableUuid(`evidence-link:${invoice.documentId}:invoice:${invoice.id}`),
    document_id: invoice.documentId,
    entity_type: "invoice",
    entity_id: invoice.id,
    evidence_role: "primary_invoice",
    metadata: { gmail_message_id: invoice.messageId, attachment_index: 1 },
    created_at: capturedAt,
  }));
  data(`verification ${invoice.number}`, await db.from("verification_events").insert({
    id: stableUuid(`verification:${SOURCE_SYSTEM}:${invoice.id}:imported`),
    entity_type: "invoice",
    entity_id: invoice.id,
    action: "contractor_invoice_imported_unpaid",
    reason: "Exact attachment fields and itemized lines verified; eligible jobs assigned only from exact printed evidence.",
    old_values: null,
    new_values: { status: "recorded", paid_cents: 0, balance_cents: invoice.total, line_count: invoice.lines.length, job_allocation_count: assigned.length, unassigned_line_count: unassigned.length },
    evidence: { document_id: invoice.documentId, content_sha256: invoice.hash, gmail_message_id: invoice.messageId, attachment_index: 1 },
    performed_by: null,
    occurred_at: capturedAt,
  }));
}

const verified = data("verification", await db.from("invoices")
  .select("id,invoice_number,category,status,subtotal_cents,tax_cents,total_cents,paid_cents,balance_cents,metadata,contact:contacts(name),lines:invoice_lines(id,line_number,subtotal_cents,tax_cents,total_cents,metadata),allocations:invoice_job_allocations(id,invoice_line_id,job_id,subtotal_cents,tax_cents,total_cents,needs_review,job:jobs(name,status,started_on,production_month)),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,amount_cents,reversed_at)")
  .in("id", invoices.map((invoice) => invoice.id))
  .order("issued_on", { ascending: false }));
assert(verified.length === invoices.length, "Not all imported invoices were returned for verification.");
for (const row of verified) {
  assert(row.lines.reduce((sum, line) => sum + Number(line.subtotal_cents), 0) === Number(row.subtotal_cents), `Invoice ${row.invoice_number} line subtotals differ.`);
  assert(row.lines.reduce((sum, line) => sum + Number(line.tax_cents), 0) === Number(row.tax_cents), `Invoice ${row.invoice_number} line tax differs.`);
  assert(row.lines.reduce((sum, line) => sum + Number(line.total_cents), 0) === Number(row.total_cents), `Invoice ${row.invoice_number} line totals differ.`);
  assert((row.payments ?? []).filter((payment) => !payment.reversed_at).length === 0, `Invoice ${row.invoice_number} unexpectedly has payment evidence.`);
}
console.log(JSON.stringify({ applied: true, invoices: verified }, null, 2));
