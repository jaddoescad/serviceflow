#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const now = new Date().toISOString();
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function envFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      let value = line.slice(i + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      return [line.slice(0, i).trim(), value];
    }));
}

function uuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const env = {
  ...envFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...envFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const contacts = {
  asmaa: "0110b963-3742-5c29-b42b-24b1be0f23fa",
  caledonian: "7bf04419-834a-5fbc-94e9-b3ffa40cab4e",
  curb: "aa2f1617-b5c1-5cda-b10b-eead26562cb3",
  grutenco: "2d6edf7a-2a0e-585e-8d62-adf89506e6d6",
  xdesign: "ac2a71c8-5082-5bad-af43-d785ed98b30a",
  dressing: "3ebc77f7-30c4-557a-ad7c-b33ea1bbd518",
  sherwin: "2604159a-1bae-5041-9f9a-8be7122a1af8",
};

const jobs = {
  sue: "7b0d9ef0-c0b7-507a-b74d-4fe1bd7c6eb7",
  herkirt: "54efc97f-ae24-556c-9fef-c280849204d8",
  mehaly: "f34caa2c-4b8f-5600-9642-abc7f228ab50",
  tom: "f545b045-29e8-5422-b8f1-4b101d5b0b94",
  patrick: "2d8c4129-67a4-55e1-ac96-71a76fbe5594",
  phil: "fa9d5e0b-4192-5251-8d16-5d7d7dd0ac16",
  barry: "006776be-552c-5deb-aeb9-f190d6b5a558",
  sally: "b33ba56b-eb80-5496-8104-7ce504d7354c",
  diane: "ad273558-c0ef-5abf-bf9c-6aad8178d886",
  chris: "e4758c1f-6bdb-59bd-9f31-7b4f0f8e672b",
  lorraine: "8fc3c2b0-ea4f-510d-803a-613eadf70b09",
  jon: "08df7a67-a226-5b8b-9e70-2a74953518a9",
  pauline: "790d1f16-664c-5b1a-b143-0183d97cc9cd",
  isabelle: "b526c337-9b1a-5dae-b738-08e36350482f",
};

const pdfDir = path.join(repoRoot, "tmp/pdfs/august-email-audit");
const invoices = [
  {
    key: "caledonian", contactId: contacts.caledonian, supplier: "Caledonian Painting Ltd", number: "239609",
    messageId: "19fd8b5663efed97", issuedOn: "2026-08-06", dueOn: "2026-09-05", currency: "CAD", category: "other",
    path: path.join(pdfDir, "Invoice_239609_from_Caledonian_Painting_Ltd.pdf"), hash: "5104578e9a3bd8b47875ccc042e889e74eeb63e3576f355f09a16c7b56328a7b",
    lines: [
      { description: "Sales OP — 6% of $53,223", subtotal: 319338, tax: 41514 },
      { description: "Business development", subtotal: 650000, tax: 84500 },
    ],
    note: "Open mixed sales-commission and business-development invoice. No job allocation: the job sales-commission ledger is already settled separately, so allocating this invoice to jobs would double count cost.",
  },
  {
    key: "asmaa", contactId: contacts.asmaa, supplier: "Assmaâ Senni", number: "2026-011",
    messageId: "19fceae2c5be3e6b", issuedOn: "2026-08-04", dueOn: null, currency: "USD", category: "other",
    path: "/Users/jadslim/.workspace-mcp/attachments/Invoice_2026-009 (3)_6e6fa335.pdf", hash: "403302c2012f8fec81a84d6d337f409a8da281cd86d45a0b6d1826749cd03be2",
    lines: [{ description: "Bonus pay of July", subtotal: 25000, tax: 0 }],
    note: "Open July bonus payable. The email attachment filename says 2026-009, but the invoice itself clearly says 2026-011.",
  },
  {
    key: "x8608", contactId: contacts.xdesign, supplier: "XDesign Dev Inc", number: "8608",
    messageId: "19fb7c77f1e709d2", issuedOn: "2026-07-30", dueOn: "2026-07-30", currency: "CAD", category: "labour",
    path: path.join(pdfDir, "Invoice_8608_2026-07-30.pdf"), hash: "ecdaf7bad068ea65972f804eb1371cf7f3f6e9c0ddee901a37ae1aa9dc70afd3",
    transactionId: "d27d240e-c0ce-508b-a2a6-d54a254b79d8", transactionAmount: 88140,
    genericAllocationId: "f2f04638-f5c7-5c63-985a-8640859cbd89",
    lines: [
      { description: "Sue Deluney — 25 hours at $30/hour", subtotal: 75000, tax: 9750, jobId: jobs.sue, minutes: 1500 },
      { description: "Sue Deluney — bonus", subtotal: 3000, tax: 390, jobId: jobs.sue },
    ],
  },
  {
    key: "x8609", contactId: contacts.xdesign, supplier: "XDesign Dev Inc", number: "8609",
    messageId: "19fd4128caf9b246", issuedOn: "2026-08-05", dueOn: "2026-08-05", currency: "CAD", category: "labour",
    path: path.join(pdfDir, "Invoice_8609_2026-08-05.pdf"), hash: "c80e55613af393d161a09466e8c238bbc4f7d50082af1e6b0eade04f801cd51f",
    transactionId: "88f8a793-9c91-57a6-b1ad-b652a7f27d31", transactionAmount: 47460,
    genericAllocationId: "753907c3-882c-568e-b0a7-4cc257e8f67d",
    lines: [{ description: "Herkirt Dhillon — 7 hours at $30/hour", subtotal: 21000, tax: 2730, jobId: jobs.herkirt, minutes: 420 }],
  },
  {
    key: "x8610", contactId: contacts.xdesign, supplier: "XDesign Dev Inc", number: "8610",
    messageId: "19fd4147bdae33c2", issuedOn: "2026-08-05", dueOn: "2026-08-05", currency: "CAD", category: "labour",
    path: path.join(pdfDir, "Invoice_8610_2026-08-05.pdf"), hash: "8f8c5eb4b3a70848b04ac355d4088ab24251106b6cf8de6c5b984a0497f756ac",
    transactionId: "88f8a793-9c91-57a6-b1ad-b652a7f27d31", transactionAmount: 47460,
    genericAllocationId: "753907c3-882c-568e-b0a7-4cc257e8f67d",
    lines: [{ description: "Mehaly Marinakis — 7 hours at $30/hour", subtotal: 21000, tax: 2730, jobId: jobs.mehaly, minutes: 420 }],
  },
  {
    key: "grutenco", contactId: contacts.grutenco, supplier: "Grutenco Painting & Construction Services", number: "GT-INV-202707-05",
    messageId: "19fbab1cb17f0950", issuedOn: "2026-07-31", dueOn: "2026-08-07", currency: "CAD", category: "labour",
    path: path.join(pdfDir, "GT-INV-202707-05-Ottawa-Painters.pdf"), hash: "b0e88633bd6c1fc326cc7b5f8316c1a36d704d15d4da5676a00a117a8bbf7e03",
    transactionId: "226de67e-fe2b-5364-9c53-44cd416d1372", transactionAmount: 83620,
    genericAllocationId: "8feaf5cd-383c-5f4a-afe0-6f14caeb419f",
    lines: [
      { description: "Tom Benton — 1518 Roberval", subtotal: 60000, tax: 7800, jobId: jobs.tom },
      { description: "Patrick Lenouvel", subtotal: 14000, tax: 1820, jobId: jobs.patrick },
    ],
  },
  {
    key: "curb1401", contactId: contacts.curb, supplier: "Curb Appeal Pro Wash", number: "1401",
    messageId: "19faf9cca271c345", issuedOn: "2026-07-29", dueOn: "2026-08-28", currency: "CAD", category: "other", costClassification: "pressure_washing",
    path: path.join(pdfDir, "invoice_1401.pdf"), hash: "75f7ae065200420cfcd16abf26273731c506ce43ad6b312797e4d4c0d9789c3b",
    transactionId: "629f7c1a-b269-560f-99ee-48bf52a8fdbd", transactionAmount: 35000,
    lines: [{ description: "Pressure washing — Phil Anido", subtotal: 20000, tax: 0, jobId: jobs.phil }],
  },
  {
    key: "curb1403", contactId: contacts.curb, supplier: "Curb Appeal Pro Wash", number: "1403",
    messageId: "19faf9b14b7fffbc", issuedOn: "2026-07-29", dueOn: "2026-08-28", currency: "CAD", category: "other", costClassification: "pressure_washing",
    path: path.join(pdfDir, "invoice_1403.pdf"), hash: "eec56a526c107694238fae74430b7359b48a960c8569da9b41906f168ab57ccd",
    transactionId: "629f7c1a-b269-560f-99ee-48bf52a8fdbd", transactionAmount: 35000,
    lines: [{ description: "Pressure washing — Barry Dollin", subtotal: 15000, tax: 0, jobId: jobs.barry }],
  },
];

for (const invoice of invoices) {
  if (!existsSync(invoice.path)) throw new Error(`Missing PDF ${invoice.path}`);
  const buffer = readFileSync(invoice.path);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  if (hash !== invoice.hash) throw new Error(`PDF hash changed for ${invoice.number}: ${hash}`);
  invoice.buffer = buffer;
  invoice.id = uuid(`invoice:gmail:${invoice.messageId}:${invoice.number}`);
  invoice.documentId = uuid(`document:sha256:${invoice.hash}`);
  invoice.subtotal = invoice.lines.reduce((sum, line) => sum + line.subtotal, 0);
  invoice.tax = invoice.lines.reduce((sum, line) => sum + line.tax, 0);
  invoice.total = invoice.subtotal + invoice.tax;
  invoice.storagePath = `gmail-labour-invoices/${invoice.issuedOn}/${invoice.hash.slice(0, 16)}-${path.basename(invoice.path)}`;
  invoice.lines.forEach((line, index) => {
    line.lineNumber = index + 1;
    line.total = line.subtotal + line.tax;
    line.id = uuid(`invoice-line:${invoice.id}:${line.lineNumber}`);
  });
}

const dressing = {
  invoiceId: "773f0293-15e2-5896-a587-571e03844abe",
  lines: [
    ["e6ed2d96-31a8-5e68-859f-04614b992596", jobs.sally, "Sally Bidal"],
    ["2322d599-5a94-5f97-907f-18bb42716529", jobs.diane, "Diane Benoit"],
    ["6a3623a2-f0bc-54ea-8c74-41c9ea7d5e77", jobs.chris, "Chris Jupp"],
    ["b3e6c0f4-bf02-50cd-aadf-697fc8867ee3", jobs.lorraine, "Lorraine Ulrick"],
    ["577c66a7-0a66-58b2-9a19-336867ecbe19", jobs.jon, "Jon Roebuck"],
    ["011aaebf-58ae-5d25-bdc0-52c15e094f4d", jobs.pauline, "Pauline Burton"],
    ["448dedc8-cfd7-5349-b60b-cf921eaa9c0b", jobs.isabelle, "Isabelle Alvarez"],
  ],
};

const sherwin = {
  transactionId: "9da0a9c1-8c59-5e4d-80cb-7be888584a9f",
  invoices: [
    ["62878021-ba28-5a05-aa5f-37bc53cc380e", "0223-0", 39499],
    ["2a3439ea-3bdb-5012-8fb7-12b69bed95b9", "0253-7", 6846],
    ["608602d9-fea3-51a7-825d-37cc1405058e", "0254-5", 25028],
    ["0fcd652c-bd6c-5368-9f55-cb5791129013", "5808-5", 16570],
    ["f40d7796-8645-5c7a-a44c-62bd518dc509", "0313-9", 30199],
    ["af2a0e0c-cfa2-5acb-bb0a-a1128040ae52", "0314-7", 873],
    ["b5b0b0c4-939e-5c78-a0c8-5083a26d2a44", "8969-3", 7757],
    ["8694e8d6-7e0d-50ff-88ad-2b8588bf5329", "8970-1", 3893],
  ],
};

const stripe = {
  transactionId: "a9b82343-0e0d-572e-bc8c-5da2ab4b5033",
  payoutId: "po_1Tz4Ow72vdHYfMJMNMEFjx5A",
  gross: 482797, fee: 14120, net: 468677,
  lines: [
    { invoiceId: "c29816c7-a900-58b1-8616-ed66b580d3a9", invoice: "471547", customer: "Gregg Alexander", eventId: "a12123f6-62cf-5626-a41b-6fb20142a428", externalId: "224820775518045bf413484288a715", gross: 49324, fee: 1460, net: 47864, chargeId: "ch_3TxuxM72vdHYfMJM0tyfgZZR" },
    { invoiceId: "666698e0-514d-5e0d-9b3e-2e66466c5d8b", invoice: "455713", customer: "Corey Parsons", eventId: "943240ea-75d8-5023-a218-1391f33be64f", externalId: "7710945486b87f80399fae430383eb", gross: 212670, fee: 6197, net: 206473, chargeId: "ch_3TxsEj72vdHYfMJM195AVwxU" },
    { invoiceId: "23d371cb-57ae-5b74-9c43-5e881a4f8a7b", invoice: "431681", customer: "Elaine Keveney", eventId: "24cee59e-e1f1-5cca-9bd9-4b2b72fa90f3", externalId: "6888444684f96eb7a539224145b6fa", gross: 76671, fee: 2253, net: 74418, chargeId: "ch_3TxZDz72vdHYfMJM0HQ5JMtN" },
    { invoiceId: "72bf43ea-3387-51f8-bcad-9ac7ea7ba7b9", invoice: "431865", customer: "Carina Stark", eventId: "4173df4c-e60f-5821-83e3-b73379a72826", externalId: "51111925524c0475665c744aac92f2", gross: 144132, fee: 4210, net: 139922, chargeId: "ch_3TwMVj72vdHYfMJM0uOwoVe9" },
  ],
};

const allJobIds = [...new Set([
  ...invoices.flatMap((invoice) => invoice.lines.map((line) => line.jobId).filter(Boolean)),
  ...dressing.lines.map((line) => line[1]),
])];
const [contactRows, jobRows, existingInvoiceRows, transactionRows, dressingInvoiceRows, sherwinInvoiceRows, stripeInvoiceRows] = await Promise.all([
  db.from("contacts").select("id,name").in("id", Object.values(contacts)),
  db.from("jobs").select("id,name,status").in("id", allJobIds),
  db.from("invoices").select("id,contact_id,invoice_number,total_cents,status").in("contact_id", [...new Set(invoices.map((invoice) => invoice.contactId))]).in("invoice_number", invoices.map((invoice) => invoice.number)),
  db.from("transactions").select("*,allocations:transaction_allocations(*)").in("id", [...new Set([...invoices.map((invoice) => invoice.transactionId).filter(Boolean), sherwin.transactionId, stripe.transactionId])]),
  db.from("invoices").select("*,lines:invoice_lines(*),job_allocations:invoice_job_allocations(*)").eq("id", dressing.invoiceId).single(),
  db.from("invoices").select("id,contact_id,invoice_number,total_cents,paid_cents,balance_cents,status,job_allocations:invoice_job_allocations(*)").in("id", sherwin.invoices.map((line) => line[0])),
  db.from("invoices").select("id,invoice_number,total_cents,paid_cents,balance_cents,status,allocations:transaction_allocations!transaction_allocations_invoice_id_fkey(*)").in("id", stripe.lines.map((line) => line.invoiceId)),
]);
for (const [label, result] of Object.entries({ contactRows, jobRows, existingInvoiceRows, transactionRows, dressingInvoiceRows, sherwinInvoiceRows, stripeInvoiceRows })) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
if (contactRows.data.length !== Object.keys(contacts).length) throw new Error("A required supplier contact is missing.");
if (jobRows.data.length !== allJobIds.length) throw new Error(`Required job identities: expected ${allJobIds.length}, found ${jobRows.data.length}.`);
for (const stored of existingInvoiceRows.data) {
  const expected = invoices.find((invoice) => invoice.contactId === stored.contact_id && invoice.number === stored.invoice_number);
  if (!expected || stored.id !== expected.id || Number(stored.total_cents) !== expected.total) throw new Error(`Conflicting invoice ${stored.invoice_number}.`);
}
const transactionById = new Map(transactionRows.data.map((transaction) => [transaction.id, transaction]));
for (const invoice of invoices.filter((invoice) => invoice.transactionId)) {
  const transaction = transactionById.get(invoice.transactionId);
  if (!transaction || Number(transaction.amount_cents) !== -invoice.transactionAmount || transaction.posted_on !== "2026-08-06") throw new Error(`Payment transaction mismatch for ${invoice.number}.`);
}
const sherwinTransaction = transactionById.get(sherwin.transactionId);
if (!sherwinTransaction || Number(sherwinTransaction.amount_cents) !== -130665 || sherwinTransaction.posted_on !== "2026-08-04") throw new Error("Sherwin transaction mismatch.");
if (sherwin.invoices.reduce((sum, line) => sum + line[2], 0) !== 130665) throw new Error("Sherwin grouped sum changed.");
for (const [id, number, total] of sherwin.invoices) {
  const stored = sherwinInvoiceRows.data.find((invoice) => invoice.id === id);
  if (!stored || stored.invoice_number !== number || Number(stored.total_cents) !== total || stored.contact_id !== contacts.sherwin) throw new Error(`Sherwin invoice mismatch ${number}.`);
  const allocated = (stored.job_allocations ?? []).filter((row) => !row.metadata?.reversed_at).reduce((sum, row) => sum + Number(row.total_cents), 0);
  if (allocated !== total) throw new Error(`Sherwin invoice ${number} is not fully job allocated.`);
}
const stripeTransaction = transactionById.get(stripe.transactionId);
if (!stripeTransaction || Number(stripeTransaction.amount_cents) !== stripe.net || stripeTransaction.posted_on !== "2026-08-04") throw new Error("Stripe transaction mismatch.");
if (stripe.lines.reduce((sum, line) => sum + line.gross, 0) !== stripe.gross || stripe.lines.reduce((sum, line) => sum + line.fee, 0) !== stripe.fee || stripe.lines.reduce((sum, line) => sum + line.net, 0) !== stripe.net) throw new Error("Stripe payout arithmetic changed.");
for (const line of stripe.lines) {
  const stored = stripeInvoiceRows.data.find((invoice) => invoice.id === line.invoiceId);
  if (!stored || stored.invoice_number !== line.invoice) throw new Error(`Stripe invoice mismatch ${line.invoice}.`);
  const event = (stored.allocations ?? []).find((allocation) => allocation.id === line.eventId && allocation.external_id === line.externalId && Number(allocation.amount_cents) === line.gross && allocation.allocation_type === "customer_payment_event");
  if (!event) throw new Error(`Stripe payment event mismatch ${line.invoice}.`);
}
if (dressingInvoiceRows.data.invoice_number !== "414" || Number(dressingInvoiceRows.data.total_cents) !== 142380) throw new Error("Dressing Rooms invoice 414 changed.");
for (const [lineId, jobId, name] of dressing.lines) {
  const line = dressingInvoiceRows.data.lines.find((row) => row.id === lineId);
  if (!line || line.description !== name || Number(line.total_cents) !== 20340 || !jobRows.data.some((job) => job.id === jobId)) throw new Error(`Dressing Rooms line mismatch ${name}.`);
}

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  email_invoices: invoices.map((invoice) => ({ number: invoice.number, supplier: invoice.supplier, total_cents: invoice.total, payment_transaction_id: invoice.transactionId ?? null, job_lines: invoice.lines.filter((line) => line.jobId).length })),
  dressing_job_links: dressing.lines.length,
  sherwin_grouped_payment_cents: 130665,
  stripe: { payout_id: stripe.payoutId, gross_cents: stripe.gross, fee_cents: stripe.fee, net_cents: stripe.net },
}, null, 2));
if (!APPLY) process.exit(0);

for (const invoice of invoices) {
  const upload = await db.storage.from("labour-invoices").upload(invoice.storagePath, invoice.buffer, { contentType: "application/pdf", upsert: false });
  if (upload.error && !String(upload.error.message).toLowerCase().includes("already exists")) throw upload.error;
  const writes = [
    db.from("documents").upsert({
      id: invoice.documentId, kind: "invoice", original_filename: path.basename(invoice.path), mime_type: "application/pdf", size_bytes: statSync(invoice.path).size,
      content_sha256: invoice.hash, storage_bucket: "labour-invoices", storage_path: invoice.storagePath, source_url: `https://mail.google.com/mail/#all/${invoice.messageId}`,
      captured_at: now, metadata: { source: "gmail_labour_invoice_audit", gmail_message_id: invoice.messageId, supplier: invoice.supplier, invoice_number: invoice.number, currency: invoice.currency, total_cents: invoice.total },
    }, { onConflict: "id" }),
    db.from("invoices").upsert({
      id: invoice.id, contact_id: invoice.contactId, direction: "payable", category: invoice.category, source_system: "gmail_labour_invoice", external_id: invoice.messageId,
      invoice_number: invoice.number, status: invoice.transactionId ? "paid" : "open", issued_on: invoice.issuedOn, due_on: invoice.dueOn, currency: invoice.currency,
      subtotal_cents: invoice.subtotal, tax_cents: invoice.tax, total_cents: invoice.total, paid_cents: invoice.transactionId ? invoice.total : 0, balance_cents: invoice.transactionId ? 0 : invoice.total,
      metadata: { supplier_name: invoice.supplier, source_document_id: invoice.documentId, source_document_sha256: invoice.hash, source_gmail_message_id: invoice.messageId, audit_note: invoice.note ?? null, tax_evidence: invoice.tax ? "printed_invoice_hst" : "no_tax_printed", cost_classification: invoice.costClassification ?? null, service_category: invoice.costClassification === "pressure_washing" ? "Pressure washing" : null }, created_at: now, updated_at: now,
    }, { onConflict: "id" }),
  ];
  for (const write of writes) { const result = await write; if (result.error) throw result.error; }
  for (const line of invoice.lines) {
    const lineWrite = await db.from("invoice_lines").upsert({
      id: line.id, invoice_id: invoice.id, line_number: line.lineNumber, description: line.description, quantity: 1, unit: "service", unit_price_cents: line.subtotal,
      subtotal_cents: line.subtotal, tax_cents: line.tax, total_cents: line.total, service_started_on: invoice.issuedOn, service_ended_on: invoice.issuedOn,
      source_kind: "physical_invoice_item", metadata: { source_document_id: invoice.documentId, source_gmail_message_id: invoice.messageId, ...(invoice.costClassification ? { entry_type: "other", cost_classification: invoice.costClassification, service_category: "Pressure washing" } : {}) }, created_at: now, updated_at: now,
    }, { onConflict: "id" });
    if (lineWrite.error) throw lineWrite.error;
    if (line.jobId) {
      const allocationWrite = await db.from("invoice_job_allocations").upsert({
        id: uuid(`invoice-job-allocation:${line.id}:${line.jobId}`), invoice_id: invoice.id, invoice_line_id: line.id, job_id: line.jobId,
        subtotal_cents: line.subtotal, tax_cents: line.tax, total_cents: line.total, quantity: 1, minutes: line.minutes ?? null,
        allocation_method: "exact_printed_customer_name", confidence: 1, needs_review: false,
        metadata: { source_document_id: invoice.documentId, source_gmail_message_id: invoice.messageId, printed_description: line.description, ...(invoice.costClassification ? { entry_type: "other", cost_classification: invoice.costClassification, service_category: "Pressure washing" } : {}) }, created_at: now, updated_at: now,
      }, { onConflict: "id" });
      if (allocationWrite.error) throw allocationWrite.error;
    }
  }
  const evidenceWrite = await db.from("evidence_links").upsert({ id: uuid(`evidence-link:${invoice.documentId}:invoice:${invoice.id}`), document_id: invoice.documentId, entity_type: "invoice", entity_id: invoice.id, evidence_role: "source_document", metadata: { gmail_message_id: invoice.messageId }, created_at: now }, { onConflict: "id" });
  if (evidenceWrite.error) throw evidenceWrite.error;
}

for (const [lineId, jobId, name] of dressing.lines) {
  const write = await db.from("invoice_job_allocations").upsert({
    id: uuid(`invoice-job-allocation:${lineId}:${jobId}`), invoice_id: dressing.invoiceId, invoice_line_id: lineId, job_id: jobId,
    subtotal_cents: 18000, tax_cents: 2340, total_cents: 20340, quantity: 1, minutes: null,
    allocation_method: "exact_printed_customer_name", confidence: 1, needs_review: false,
    metadata: { customer: name, repair_reason: "Paid invoice 414 had line items but no v2 job allocations." }, created_at: now, updated_at: now,
  }, { onConflict: "id" });
  if (write.error) throw write.error;
}

const paidEmailInvoices = invoices.filter((invoice) => invoice.transactionId);
for (const invoice of paidEmailInvoices) {
  if (invoice.genericAllocationId) {
    const reverse = await db.from("transaction_allocations").update({ reversed_at: now, reversal_reason: "Replaced generic confirmed transfer with exact emailed supplier invoice allocation.", updated_at: now }).eq("id", invoice.genericAllocationId).is("reversed_at", null);
    if (reverse.error) throw reverse.error;
  }
  const payment = await db.from("transaction_allocations").upsert({
    id: uuid(`transaction-allocation:${invoice.transactionId}:invoice:${invoice.id}`), transaction_id: invoice.transactionId, invoice_id: invoice.id, contact_id: invoice.contactId,
    source_system: "gmail_invoice_and_easyweb", external_id: `${invoice.messageId}:${invoice.number}`, allocation_type: invoice.costClassification === "pressure_washing" ? "pressure_washing_payment" : "labour_payment", amount_cents: invoice.total,
    allocation_method: "exact_supplier_and_grouped_invoice_sum", confidence: 1, needs_review: false,
    metadata: { invoice_number: invoice.number, source_gmail_message_id: invoice.messageId, source_document_id: invoice.documentId, paid_on: "2026-08-06" }, created_at: now, updated_at: now,
  }, { onConflict: "id" });
  if (payment.error) throw payment.error;
}

for (const transactionId of [...new Set(paidEmailInvoices.map((invoice) => invoice.transactionId))]) {
  const transactionInvoices = paidEmailInvoices.filter((invoice) => invoice.transactionId === transactionId);
  const transaction = transactionById.get(transactionId);
  const allocated = transactionInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
  const isPressureWashing = transactionInvoices.every((invoice) => invoice.costClassification === "pressure_washing");
  if (allocated !== Math.abs(Number(transaction.amount_cents))) throw new Error(`Invoice allocation does not balance ${transactionId}.`);
  const txWrite = await db.from("transactions").update({
    contact_id: transactionInvoices[0].contactId, counterparty: transactionInvoices[0].supplier, category: isPressureWashing ? "Pressure washing" : transaction.category, review_status: "reconciled",
    notes: `Exact emailed invoice settlement: ${transactionInvoices.map((invoice) => `#${invoice.number}`).join(", ")} totals $${(allocated / 100).toFixed(2)}.`,
    metadata: { ...(transaction.metadata ?? {}), tax_evidence: { status: "documented", source: "emailed supplier invoices", tax_cents: transactionInvoices.reduce((sum, invoice) => sum + invoice.tax, 0), invoice_numbers: transactionInvoices.map((invoice) => invoice.number) }, settlement_confirmation: { status: "settled", invoice_ids: transactionInvoices.map((invoice) => invoice.id), invoice_numbers: transactionInvoices.map((invoice) => invoice.number), allocated_cents: allocated, reconciled_at: now } }, updated_at: now,
  }).eq("id", transactionId).eq("amount_cents", -allocated);
  if (txWrite.error) throw txWrite.error;
}

for (const [invoiceId, number, total] of sherwin.invoices) {
  const payment = await db.from("transaction_allocations").upsert({
    id: uuid(`transaction-allocation:${sherwin.transactionId}:invoice:${invoiceId}`), transaction_id: sherwin.transactionId, invoice_id: invoiceId, contact_id: contacts.sherwin,
    source_system: "sherwin_portal_and_easyweb", external_id: `2026-08-04:${number}`, allocation_type: "material_payment", amount_cents: total,
    allocation_method: "exact_consecutive_portal_invoice_sum", confidence: 1, needs_review: false,
    metadata: { invoice_number: number, grouped_invoice_numbers: sherwin.invoices.map((line) => line[1]), grouped_total_cents: 130665, paid_on: "2026-08-04" }, created_at: now, updated_at: now,
  }, { onConflict: "id" });
  if (payment.error) throw payment.error;
  const invoiceWrite = await db.from("invoices").update({ status: "paid", paid_cents: total, balance_cents: 0, updated_at: now }).eq("id", invoiceId).eq("total_cents", total);
  if (invoiceWrite.error) throw invoiceWrite.error;
}
const sherwinWrite = await db.from("transactions").update({
  contact_id: contacts.sherwin, counterparty: "Sherwin-Williams Canada", category: "Paint & materials", review_status: "reconciled",
  notes: `Exact grouped Sherwin settlement for invoices ${sherwin.invoices.map((line) => line[1]).join(", ")}; total $1,306.65.`,
  metadata: { ...(sherwinTransaction.metadata ?? {}), supplier_reconciliation: { status: "reconciled", method: "exact_consecutive_portal_invoice_sum", invoice_numbers: sherwin.invoices.map((line) => line[1]), invoice_ids: sherwin.invoices.map((line) => line[0]), allocated_cents: 130665, reconciled_at: now }, tax_evidence: { status: "documented", source: "allocated Sherwin invoices", invoice_numbers: sherwin.invoices.map((line) => line[1]) } }, updated_at: now,
}).eq("id", sherwin.transactionId).eq("amount_cents", -130665);
if (sherwinWrite.error) throw sherwinWrite.error;

for (const line of stripe.lines) {
  const payment = await db.from("transaction_allocations").upsert({
    id: uuid(`transaction-allocation:${stripe.transactionId}:invoice:${line.invoiceId}:event:${line.eventId}`), transaction_id: stripe.transactionId, invoice_id: line.invoiceId,
    source_system: "stripe_payout", external_id: line.eventId, allocation_type: "customer_payment", amount_cents: line.gross,
    allocation_method: "stripe_payout_confirmation,stripe_payment_event,gross_less_processor_fee", confidence: 1, needs_review: false,
    metadata: { source_payment_event_id: line.eventId, source_payment_external_id: line.externalId, payout_id: stripe.payoutId, charge_id: line.chargeId, customer: line.customer, invoice_number: line.invoice, gross_cents: line.gross, processor_fee_cents: line.fee, bank_cash_cents: line.net, evidence_note: `Stripe payout ${stripe.payoutId}: invoice #${line.invoice} gross $${(line.gross / 100).toFixed(2)}, fee $${(line.fee / 100).toFixed(2)}, net bank cash $${(line.net / 100).toFixed(2)}.` }, created_at: now, updated_at: now,
  }, { onConflict: "id" });
  if (payment.error) throw payment.error;
}
const stripeWrite = await db.from("transactions").update({
  counterparty: "Stripe", category: "Painting revenue", review_status: "reconciled",
  notes: `Stripe payout ${stripe.payoutId}: four charges gross $4,827.97 less $141.20 fees equals $4,686.77 bank deposit.`,
  metadata: { ...(stripeTransaction.metadata ?? {}), customer_revenue_identity: { status: "confirmed", provider: "stripe", payout_id: stripe.payoutId, stripe_gross_charges_cents: stripe.gross, processor_fee_cents: stripe.fee, bank_cash_cents: stripe.net, charge_count: stripe.lines.length, invoice_numbers: stripe.lines.map((line) => line.invoice), verified_at: now }, customer_revenue_settlement: { status: "fully_allocated", gross_invoice_credit_cents: stripe.gross, processing_fee_cents: stripe.fee, allocated_bank_cash_cents: stripe.net, unallocated_bank_cash_cents: 0, updated_at: now } }, updated_at: now,
}).eq("id", stripe.transactionId).eq("amount_cents", stripe.net);
if (stripeWrite.error) throw stripeWrite.error;

for (const entity of [
  ...invoices.map((invoice) => ({ type: "invoice", id: invoice.id, action: "email_invoice_imported", evidence: { document_id: invoice.documentId, gmail_message_id: invoice.messageId } })),
  { type: "invoice", id: dressing.invoiceId, action: "job_allocations_repaired", evidence: { invoice_number: "414", job_link_count: 7 } },
  { type: "transaction", id: sherwin.transactionId, action: "grouped_supplier_payment_reconciled", evidence: { invoice_numbers: sherwin.invoices.map((line) => line[1]) } },
  { type: "transaction", id: stripe.transactionId, action: "stripe_payout_reconciled", evidence: { payout_id: stripe.payoutId, gross_cents: stripe.gross, fee_cents: stripe.fee, net_cents: stripe.net } },
]) {
  const event = await db.from("verification_events").upsert({ id: uuid(`verification:${entity.action}:${entity.type}:${entity.id}`), entity_type: entity.type, entity_id: entity.id, action: entity.action, reason: "Email, portal, processor, and bank evidence reconciled for current job costing.", old_values: null, new_values: { reconciled_at: now }, evidence: entity.evidence, occurred_at: now }, { onConflict: "id" });
  if (event.error) throw event.error;
}

const [verifiedInvoices, verifiedTransactions] = await Promise.all([
  db.from("invoices").select("id,invoice_number,status,total_cents,paid_cents,balance_cents,lines:invoice_lines(id,total_cents),job_allocations:invoice_job_allocations(id,invoice_line_id,job_id,total_cents,metadata),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,transaction_id,amount_cents,reversed_at)").in("id", [...invoices.map((invoice) => invoice.id), dressing.invoiceId, ...sherwin.invoices.map((line) => line[0])]),
  db.from("transactions").select("id,amount_cents,review_status,counterparty,allocations:transaction_allocations(id,invoice_id,amount_cents,reversed_at,metadata)").in("id", [...new Set([...paidEmailInvoices.map((invoice) => invoice.transactionId), sherwin.transactionId, stripe.transactionId])]),
]);
if (verifiedInvoices.error) throw verifiedInvoices.error;
if (verifiedTransactions.error) throw verifiedTransactions.error;
for (const invoice of invoices) {
  const stored = verifiedInvoices.data.find((row) => row.id === invoice.id);
  if (!stored || (stored.lines ?? []).reduce((sum, line) => sum + Number(line.total_cents), 0) !== invoice.total) throw new Error(`Post-write line verification failed ${invoice.number}.`);
  const jobTotal = (stored.job_allocations ?? []).filter((row) => !row.metadata?.reversed_at).reduce((sum, row) => sum + Number(row.total_cents), 0);
  const expectedJobTotal = invoice.lines.filter((line) => line.jobId).reduce((sum, line) => sum + line.total, 0);
  if (jobTotal !== expectedJobTotal) throw new Error(`Post-write job allocation failed ${invoice.number}.`);
  if (invoice.transactionId && (stored.status !== "paid" || Number(stored.balance_cents) !== 0)) throw new Error(`Post-write payment state failed ${invoice.number}.`);
}
const dressingStored = verifiedInvoices.data.find((row) => row.id === dressing.invoiceId);
if ((dressingStored.job_allocations ?? []).filter((row) => !row.metadata?.reversed_at).reduce((sum, row) => sum + Number(row.total_cents), 0) !== 142380) throw new Error("Dressing Rooms job allocations do not total invoice 414.");
for (const transaction of verifiedTransactions.data) {
  if (transaction.review_status !== "reconciled") throw new Error(`Transaction not reconciled ${transaction.id}.`);
  const active = (transaction.allocations ?? []).filter((allocation) => !allocation.reversed_at);
  if (transaction.id === stripe.transactionId) {
    if (active.reduce((sum, allocation) => sum + Number(allocation.amount_cents), 0) !== stripe.gross || active.reduce((sum, allocation) => sum + Number(allocation.metadata?.bank_cash_cents ?? 0), 0) !== stripe.net) throw new Error("Stripe post-write totals failed.");
  } else if (active.reduce((sum, allocation) => sum + Number(allocation.amount_cents), 0) !== Math.abs(Number(transaction.amount_cents))) throw new Error(`Transaction allocation does not balance ${transaction.id}.`);
}
console.log(JSON.stringify({ status: "verified", invoices_imported: invoices.length, dressing_job_links: 7, sherwin_invoices_paid: 8, stripe_charges_linked: 4 }, null, 2));
