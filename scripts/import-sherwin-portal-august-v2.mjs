#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const SOURCE_PATH = "/Users/jadslim/Downloads/InvExport_08062026.csv";
const EXPECTED_SHA256 = "10870c153c6908d1702b28c9d3f98c3ba8d5ff98ab4566686f10dc5f7cf0f154";
const SOURCE_URL = "https://www.sherwin-williams.com/en-us/pro/pro-plus/account/invoices?catalogId=11051&storeId=10151&langId=-1";
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

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-CA")
    .replace(/\b(street|st|road|rd|avenue|ave|crescent|cres|court|ct|drive|dr|boulevard|blvd|private|pvt|lane|ln|way)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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
  throw new Error("Refusing import for an unexpected Supabase project.");
}
if (!existsSync(SOURCE_PATH)) throw new Error(`Missing Sherwin export: ${SOURCE_PATH}`);

const sourceBuffer = readFileSync(SOURCE_PATH);
const sourceHash = crypto.createHash("sha256").update(sourceBuffer).digest("hex");
if (sourceHash !== EXPECTED_SHA256) {
  throw new Error(`Sherwin export changed: expected ${EXPECTED_SHA256}, received ${sourceHash}.`);
}
const sourceText = sourceBuffer.toString("utf8");
for (const required of [
  '"17041","186 LAMPREY ST","2026-08-03","41.30","4.75"',
  '"13527","37 DOGWOOD DRIVE","2026-08-05","137.97","15.87"',
  '"4673","DHILLON","2026-08-04","349.41","40.20"',
]) {
  if (!sourceText.includes(required)) throw new Error(`Sherwin export is missing ${required}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const invoices = [
  {
    rawInvoiceNumber: "17041",
    invoiceNumber: "1704-1",
    orderNumber: null,
    poNumber: "186 LAMPREY ST",
    issuedOn: "2026-08-03",
    subtotalCents: 3_655,
    taxCents: 475,
    totalCents: 4_130,
    storeNumber: "8812",
    storeAddress: "1440 BANK ST",
    lines: [
      { sku: "650495062", productCode: null, description: "240MM MARATHON 1/2 C", quantity: 1, unitPriceCents: 790, subtotalCents: 790, taxCents: 103, colorName: null },
      { sku: "650362783", productCode: "B30W4651", description: "PM 400 0 FL EXTRA", quantity: 1, unitPriceCents: 2_865, subtotalCents: 2_865, taxCents: 372, colorName: null },
    ],
  },
  {
    rawInvoiceNumber: "13527",
    invoiceNumber: "1352-7",
    orderNumber: "OE0089180A763591",
    poNumber: "37 DOGWOOD DRIVE",
    issuedOn: "2026-08-05",
    subtotalCents: 12_210,
    taxCents: 1_587,
    totalCents: 13_797,
    storeNumber: "3591",
    storeAddress: "2900 WOODROFFE AVE UNIT 11",
    lines: [
      { sku: "651254666", productCode: "K33TQ8354", description: "DURATION EX SA UD", quantity: 1, unitPriceCents: 6_865, subtotalCents: 6_865, taxCents: 892, colorName: null },
      { sku: "601219900", productCode: "A15TQ8054", description: "WDSCAPES SC ULTRAD", quantity: 1, unitPriceCents: 5_345, subtotalCents: 5_345, taxCents: 695, colorName: null },
    ],
  },
  {
    rawInvoiceNumber: "4673",
    invoiceNumber: "0467-3",
    orderNumber: "OE0127065A768785",
    poNumber: "DHILLON",
    issuedOn: "2026-08-04",
    subtotalCents: 30_921,
    taxCents: 4_020,
    totalCents: 34_941,
    storeNumber: "8785",
    storeAddress: "UNITS B & C-3891 INNES RD",
    lines: [
      { sku: "1770239", productCode: "A1770239", description: "IND CLNR/DEGREAS 24O", quantity: 1, unitPriceCents: 696, subtotalCents: 696, taxCents: 90, colorName: null },
      { sku: "651353021", productCode: "K38WQ9053", description: "EMERALD UTE SG DB", quantity: 1, unitPriceCents: 6_845, subtotalCents: 6_845, taxCents: 890, colorName: "SANDERLING" },
      { sku: "650108202", productCode: "A97WQ1251", description: "DUR HOME SA EXTRA", quantity: 2, unitPriceCents: 5_845, subtotalCents: 11_690, taxCents: 1_520, colorName: "EIDER WHITE" },
      { sku: "650377005", productCode: "A97WQ1353", description: "DUR HOME SA DEEP", quantity: 2, unitPriceCents: 5_845, subtotalCents: 11_690, taxCents: 1_520, colorName: "MATCH BLUE" },
    ],
  },
];

for (const invoice of invoices) {
  const subtotal = invoice.lines.reduce((sum, line) => sum + line.subtotalCents, 0);
  const tax = invoice.lines.reduce((sum, line) => sum + line.taxCents, 0);
  if (subtotal !== invoice.subtotalCents || tax !== invoice.taxCents || subtotal + tax !== invoice.totalCents) {
    throw new Error(`${invoice.invoiceNumber}: line totals do not reconcile.`);
  }
  invoice.id = stableUuid(`invoice:sherwin-portal:${invoice.rawInvoiceNumber}`);
  invoice.lines = invoice.lines.map((line, index) => ({
    ...line,
    lineNumber: index + 1,
    id: stableUuid(`invoice-line:${invoice.id}:${index + 1}`),
    totalCents: line.subtotalCents + line.taxCents,
  }));
}

const [contactsResult, jobsResult, existingInvoicesResult] = await Promise.all([
  db.from("contacts").select("id,name,email,metadata"),
  db.from("jobs").select("id,name,status,address_line_1,address_line_2,formatted_address,scheduled_on,completed_on,source,metadata,contact:contacts(id,name,email)"),
  db.from("invoices").select("id,invoice_number,source_system,external_id,total_cents,status,metadata").eq("direction", "payable"),
]);
if (contactsResult.error) throw contactsResult.error;
if (jobsResult.error) throw jobsResult.error;
if (existingInvoicesResult.error) throw existingInvoicesResult.error;

const sherwinContacts = (contactsResult.data ?? []).filter((contact) =>
  normalize(contact.name).includes("sherwin williams"),
);
if (sherwinContacts.length > 1) {
  throw new Error(`Expected at most one Sherwin-Williams contact, found ${sherwinContacts.length}.`);
}
const supplier = sherwinContacts[0] ?? {
  id: stableUuid("contact:supplier:sherwin-williams-canada"),
  name: "Sherwin-Williams Canada",
  email: null,
  metadata: {
    source: "sherwin_authenticated_portal",
    account_number_masked: "XXXX-X272-9",
  },
  pending_insert: true,
};

for (const invoice of invoices) {
  const po = normalize(invoice.poNumber);
  invoice.jobCandidates = (jobsResult.data ?? []).map((job) => {
    const fields = [job.name, job.address_line_1, job.formatted_address, job.contact?.name]
      .map(normalize)
      .filter(Boolean);
    let score = 0;
    let method = null;
    if (fields.some((field) => field === po)) {
      score = 100;
      method = "exact_po_name_or_address";
    } else if (fields.some((field) => field.includes(po) || po.includes(field))) {
      score = 80;
      method = "po_contained_in_name_or_address";
    }
    return { job, score, method };
  }).filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);
  const topScore = invoice.jobCandidates[0]?.score ?? 0;
  const topCandidates = invoice.jobCandidates.filter((candidate) => candidate.score === topScore);
  if (topScore < 80 || topCandidates.length !== 1) {
    throw new Error(`${invoice.invoiceNumber}: exact PO/job match is ambiguous or missing.`);
  }
  invoice.jobMatch = topCandidates[0];

  invoice.duplicates = (existingInvoicesResult.data ?? []).filter((stored) => {
    const storedNumber = normalize(stored.invoice_number).replaceAll(" ", "");
    const currentNumbers = [invoice.invoiceNumber, invoice.rawInvoiceNumber]
      .map((value) => normalize(value).replaceAll(" ", ""));
    return currentNumbers.includes(storedNumber) ||
      String(stored.external_id ?? "") === invoice.rawInvoiceNumber;
  });
  const conflict = invoice.duplicates.find((stored) =>
    stored.id !== invoice.id || Number(stored.total_cents) !== invoice.totalCents,
  );
  if (conflict) {
    throw new Error(`${invoice.invoiceNumber}: conflicting existing invoice ${conflict.id}.`);
  }
}

const documentId = stableUuid(`document:sherwin-portal-export:${sourceHash}`);
const storagePath = `sherwin/portal/2026/08/${sourceHash}-InvExport_08062026.csv`;

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  source: {
    path: SOURCE_PATH,
    sha256: sourceHash,
    size_bytes: sourceBuffer.length,
    document_id: documentId,
    storage_path: storagePath,
  },
  supplier,
  invoices: invoices.map((invoice) => ({
    id: invoice.id,
    invoice_number: invoice.invoiceNumber,
    raw_invoice_number: invoice.rawInvoiceNumber,
    issued_on: invoice.issuedOn,
    po_number: invoice.poNumber,
    subtotal_cents: invoice.subtotalCents,
    tax_cents: invoice.taxCents,
    total_cents: invoice.totalCents,
    lines: invoice.lines,
    job_match: {
      method: invoice.jobMatch.method,
      score: invoice.jobMatch.score,
      job: invoice.jobMatch.job,
    },
    existing_duplicates: invoice.duplicates,
  })),
  totals: {
    invoice_count: invoices.length,
    line_count: invoices.reduce((sum, invoice) => sum + invoice.lines.length, 0),
    subtotal_cents: invoices.reduce((sum, invoice) => sum + invoice.subtotalCents, 0),
    tax_cents: invoices.reduce((sum, invoice) => sum + invoice.taxCents, 0),
    total_cents: invoices.reduce((sum, invoice) => sum + invoice.totalCents, 0),
  },
}, null, 2));
if (!APPLY) process.exit(0);

const supplierWrite = await db.from("contacts").upsert({
  id: supplier.id,
  kind: "supplier",
  dripjobs_contact_id: null,
  name: "Sherwin-Williams Canada",
  email: supplier.email ?? null,
  phone: null,
  normalized_email: supplier.email?.toLocaleLowerCase("en-CA") ?? null,
  normalized_phone: null,
  metadata: {
    ...(supplier.metadata ?? {}),
    source: "sherwin_authenticated_portal",
    account_number_masked: "XXXX-X272-9",
    source_url: SOURCE_URL,
  },
  created_at: capturedAt,
  updated_at: capturedAt,
}, { onConflict: "id" });
if (supplierWrite.error) throw supplierWrite.error;

const uploadResult = await db.storage.from("material-invoices").upload(
  storagePath,
  sourceBuffer,
  { contentType: "text/csv", upsert: false },
);
if (uploadResult.error && !String(uploadResult.error.message).toLocaleLowerCase("en-CA").includes("already exists")) {
  throw uploadResult.error;
}

const documentWrite = await db.from("documents").upsert({
  id: documentId,
  kind: "supplier_invoice_export",
  original_filename: path.basename(SOURCE_PATH),
  mime_type: "text/csv",
  size_bytes: sourceBuffer.length,
  content_sha256: sourceHash,
  storage_bucket: "material-invoices",
  storage_path: storagePath,
  source_url: SOURCE_URL,
  captured_at: capturedAt,
  metadata: {
    supplier: "Sherwin-Williams Canada",
    account_number_masked: "XXXX-X272-9",
    portal_exported_on: "2026-08-06",
    invoice_numbers: invoices.map((invoice) => invoice.invoiceNumber),
    no_email_used: true,
    file_mtime: statSync(SOURCE_PATH).mtime.toISOString(),
  },
}, { onConflict: "id" });
if (documentWrite.error) throw documentWrite.error;

for (const invoice of invoices) {
  const invoiceWrite = await db.from("invoices").upsert({
    id: invoice.id,
    contact_id: supplier.id,
    direction: "payable",
    category: "material",
    source_system: "sherwin_portal_export",
    external_id: invoice.rawInvoiceNumber,
    invoice_number: invoice.invoiceNumber,
    status: "unpaid",
    issued_on: invoice.issuedOn,
    due_on: null,
    currency: "CAD",
    subtotal_cents: invoice.subtotalCents,
    tax_cents: invoice.taxCents,
    total_cents: invoice.totalCents,
    paid_cents: 0,
    balance_cents: invoice.totalCents,
    metadata: {
      supplier_name: "Sherwin-Williams Canada",
      account_number: "404242729",
      order_number: invoice.orderNumber,
      po_number: invoice.poNumber,
      store_number: invoice.storeNumber,
      store_address: invoice.storeAddress,
      source_document_id: documentId,
      source_document_sha256: sourceHash,
      source_kind: "authenticated_portal_csv_export",
      tax_rate: 0.13,
      settlement_status: "unpaid_account_charge",
      no_email_used: true,
    },
    updated_at: capturedAt,
    created_at: capturedAt,
  }, { onConflict: "id" });
  if (invoiceWrite.error) throw invoiceWrite.error;

  const lineRows = invoice.lines.map((line) => ({
    id: line.id,
    invoice_id: invoice.id,
    line_number: line.lineNumber,
    description: line.description,
    quantity: line.quantity,
    unit: "each",
    unit_price_cents: line.unitPriceCents,
    subtotal_cents: line.subtotalCents,
    tax_cents: line.taxCents,
    total_cents: line.totalCents,
    service_started_on: invoice.issuedOn,
    service_ended_on: invoice.issuedOn,
    source_kind: "supplier_product",
    metadata: {
      sku: line.sku,
      product_code: line.productCode,
      color_name: line.colorName,
      po_number: invoice.poNumber,
      source_document_id: documentId,
      source_document_sha256: sourceHash,
    },
    updated_at: capturedAt,
    created_at: capturedAt,
  }));
  const lineWrite = await db.from("invoice_lines").upsert(lineRows, { onConflict: "id" });
  if (lineWrite.error) throw lineWrite.error;

  const jobAllocationRows = invoice.lines.map((line) => ({
    id: stableUuid(`invoice-job-allocation:${line.id}:${invoice.jobMatch.job.id}`),
    invoice_id: invoice.id,
    invoice_line_id: line.id,
    job_id: invoice.jobMatch.job.id,
    subtotal_cents: line.subtotalCents,
    tax_cents: line.taxCents,
    total_cents: line.totalCents,
    quantity: line.quantity,
    minutes: null,
    allocation_method: invoice.jobMatch.method,
    confidence: 1,
    needs_review: false,
    metadata: {
      po_number: invoice.poNumber,
      source_document_id: documentId,
      source_document_sha256: sourceHash,
    },
    updated_at: capturedAt,
    created_at: capturedAt,
  }));
  const allocationWrite = await db.from("invoice_job_allocations").upsert(
    jobAllocationRows,
    { onConflict: "id" },
  );
  if (allocationWrite.error) throw allocationWrite.error;

  const evidenceLinkWrite = await db.from("evidence_links").upsert({
    id: stableUuid(`evidence-link:${documentId}:invoice:${invoice.id}`),
    document_id: documentId,
    entity_type: "invoice",
    entity_id: invoice.id,
    evidence_role: "source_supplier_invoice_export",
    metadata: { invoice_number: invoice.invoiceNumber, po_number: invoice.poNumber },
    created_at: capturedAt,
  }, { onConflict: "id" });
  if (evidenceLinkWrite.error) throw evidenceLinkWrite.error;

  const eventWrite = await db.from("verification_events").upsert({
    id: stableUuid(`verification:sherwin-portal-import:${invoice.id}`),
    entity_type: "invoice",
    entity_id: invoice.id,
    action: "supplier_invoice_imported_and_job_linked",
    reason: `Authenticated Sherwin portal export PO ${invoice.poNumber} matched one exact job name/address.`,
    old_values: invoice.duplicates[0] ?? null,
    new_values: {
      invoice_number: invoice.invoiceNumber,
      subtotal_cents: invoice.subtotalCents,
      tax_cents: invoice.taxCents,
      total_cents: invoice.totalCents,
      line_count: invoice.lines.length,
      job_id: invoice.jobMatch.job.id,
      job_name: invoice.jobMatch.job.name,
      allocation_method: invoice.jobMatch.method,
    },
    evidence: {
      source_document_id: documentId,
      source_document_sha256: sourceHash,
      source_url: SOURCE_URL,
      no_email_used: true,
    },
    occurred_at: capturedAt,
  }, { onConflict: "id" });
  if (eventWrite.error) throw eventWrite.error;
}

const verificationResult = await db
  .from("invoices")
  .select("id,invoice_number,status,subtotal_cents,tax_cents,total_cents,paid_cents,balance_cents,lines:invoice_lines(id,line_number,subtotal_cents,tax_cents,total_cents),job_allocations:invoice_job_allocations(id,invoice_line_id,subtotal_cents,tax_cents,total_cents,needs_review,job:jobs(id,name,status,formatted_address))")
  .in("id", invoices.map((invoice) => invoice.id));
if (verificationResult.error) throw verificationResult.error;
if ((verificationResult.data ?? []).length !== invoices.length) {
  throw new Error("Post-import invoice count verification failed.");
}
for (const invoice of verificationResult.data ?? []) {
  const lineSubtotal = (invoice.lines ?? []).reduce((sum, line) => sum + Number(line.subtotal_cents), 0);
  const lineTax = (invoice.lines ?? []).reduce((sum, line) => sum + Number(line.tax_cents), 0);
  const allocatedSubtotal = (invoice.job_allocations ?? []).reduce((sum, allocation) => sum + Number(allocation.subtotal_cents), 0);
  if (
    lineSubtotal !== Number(invoice.subtotal_cents) ||
    lineTax !== Number(invoice.tax_cents) ||
    allocatedSubtotal !== Number(invoice.subtotal_cents) ||
    (invoice.job_allocations ?? []).some((allocation) => allocation.needs_review)
  ) {
    throw new Error(`${invoice.invoice_number}: post-import arithmetic or job allocation verification failed.`);
  }
}
console.log(JSON.stringify({ status: "verified", invoices: verificationResult.data }, null, 2));
