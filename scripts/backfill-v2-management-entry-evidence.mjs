#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const capturedAt = new Date().toISOString();

function envFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("=")).map((line) => {
    const i = line.indexOf("=");
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [line.slice(0, i).trim(), value];
  }));
}
function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const env = { ...envFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")), ...envFile(path.join(repoRoot, ".env.local")), ...process.env };
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const TARGETS = new Map([
  ["cba821d8-4770-58a7-845a-90188e0e0f56", { invoice_number: "INV-20260615-001", supplier: "Abdellah Aouf", worker: "Anas Aouf", subtotal_cents: 10400, job_id: "b5937a4d-2ef7-532d-be19-4b8039a6b8c5", old_project_id: "104147038" }],
  ["fd9bbf9f-74b3-5639-bcf5-d05a505f0cb8", { invoice_number: "INV-20260615-001", supplier: "Abdellah Aouf", worker: "Anas Aouf", subtotal_cents: 52000, job_id: "5e5f653b-e771-5b0b-8cde-bb804428e0e0", old_project_id: "102330774" }],
  ["efb06982-65ce-5487-bdad-53e779300ac3", { invoice_number: "MANUAL-20260722-CAMILLES-TEAM-01", supplier: "Camille's Team", worker: "Camille's Team", subtotal_cents: 60000, job_id: "f5f15bfe-5ac7-53da-9296-bfd1cfa8dd41", old_project_id: "103366525" }],
]);

const [invoiceResult, linkResult] = await Promise.all([
  db.from("invoices").select("id,invoice_number,issued_on,status,category,direction,subtotal_cents,tax_cents,total_cents,paid_cents,balance_cents,created_at,metadata,contact:contacts(id,name),lines:invoice_lines(id,line_number,description,subtotal_cents,tax_cents,total_cents,metadata),job_allocations:invoice_job_allocations(id,invoice_line_id,job_id,subtotal_cents,tax_cents,total_cents,needs_review,metadata)").in("id", [...TARGETS.keys()]),
  db.from("evidence_links").select("id,document_id,entity_id,evidence_role").eq("entity_type", "invoice").in("entity_id", [...TARGETS.keys()]),
]);
if (invoiceResult.error) throw invoiceResult.error;
if (linkResult.error) throw linkResult.error;
assert(invoiceResult.data.length === TARGETS.size, `Expected ${TARGETS.size} management entries, found ${invoiceResult.data.length}.`);

const plans = invoiceResult.data.map((invoice) => {
  const expected = TARGETS.get(invoice.id);
  assert(expected, `Unexpected invoice ${invoice.id}.`);
  assert(invoice.invoice_number === expected.invoice_number && invoice.contact?.name === expected.supplier, `Management entry identity changed for ${invoice.id}.`);
  assert(invoice.status === "recorded" && invoice.category === "labour" && invoice.direction === "payable", `Management entry status/category changed for ${invoice.id}.`);
  assert(Number(invoice.subtotal_cents) === expected.subtotal_cents && Number(invoice.tax_cents) === 0 && Number(invoice.total_cents) === expected.subtotal_cents, `Management entry totals changed for ${invoice.id}.`);
  assert(Number(invoice.paid_cents) === 0 && Number(invoice.balance_cents) === expected.subtotal_cents, `Management entry must remain unpaid for ${invoice.id}.`);
  assert(invoice.metadata?.worker_name === expected.worker && invoice.metadata?.old_project_id === expected.old_project_id, `Management entry metadata changed for ${invoice.id}.`);
  assert(invoice.lines.length === 1 && Number(invoice.lines[0].subtotal_cents) === expected.subtotal_cents, `Management entry line changed for ${invoice.id}.`);
  const activeJobRows = invoice.job_allocations.filter((row) => !row.metadata?.reversed_at);
  assert(activeJobRows.length === 1 && activeJobRows[0].job_id === expected.job_id && activeJobRows[0].needs_review === false && Number(activeJobRows[0].subtotal_cents) === expected.subtotal_cents, `Management entry job link changed for ${invoice.id}.`);
  const existingLinks = linkResult.data.filter((row) => row.entity_id === invoice.id);
  assert(existingLinks.length === 0 || existingLinks.every((row) => row.evidence_role === "management_entry_record"), `Invoice ${invoice.id} gained a different source document.`);

  const payload = {
    record_type: "management_entered_job_cost",
    physical_invoice_status: "not_provided",
    payment_evidence_status: "not_linked",
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    issued_on: invoice.issued_on,
    supplier_name: invoice.contact.name,
    worker_name: invoice.metadata.worker_name,
    notes: invoice.metadata.notes,
    currency: "CAD",
    subtotal_cents: Number(invoice.subtotal_cents),
    tax_cents: Number(invoice.tax_cents),
    total_cents: Number(invoice.total_cents),
    job_id: expected.job_id,
    old_project_id: expected.old_project_id,
    invoice_line_id: invoice.lines[0].id,
    job_allocation_id: activeJobRows[0].id,
    source_created_at: invoice.created_at,
  };
  const content = JSON.stringify(payload);
  const documentId = stableUuid(`document:management-job-cost:${invoice.id}`);
  return {
    invoice,
    expected,
    payload,
    content,
    document: {
      id: documentId,
      kind: "management_job_cost_record",
      original_filename: `Management job cost ${invoice.id}.json`,
      mime_type: "application/json",
      size_bytes: Buffer.byteLength(content),
      content_sha256: crypto.createHash("sha256").update(content).digest("hex"),
      storage_bucket: null,
      storage_path: null,
      source_url: null,
      captured_at: capturedAt,
      metadata: {
        source: "management_entered_job_cost",
        physical_invoice_status: "not_provided",
        payment_evidence_status: "not_linked",
        evidence_scope: "amount_and_job_identity_only",
        no_email_used: true,
        payload,
      },
      created_at: capturedAt,
    },
    evidenceLink: {
      id: stableUuid(`evidence-link:${documentId}:invoice:${invoice.id}:management-entry`),
      document_id: documentId,
      entity_type: "invoice",
      entity_id: invoice.id,
      evidence_role: "management_entry_record",
      metadata: {
        physical_invoice_status: "not_provided",
        payment_evidence_status: "not_linked",
        no_email_used: true,
      },
      created_at: capturedAt,
    },
  };
});

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  no_email_used: true,
  count: plans.length,
  total_cents: plans.reduce((sum, row) => sum + row.expected.subtotal_cents, 0),
  entries: plans.map((row) => ({
    invoice_id: row.invoice.id,
    invoice_number: row.invoice.invoice_number,
    supplier: row.invoice.contact.name,
    worker: row.expected.worker,
    subtotal_cents: row.expected.subtotal_cents,
    job_id: row.expected.job_id,
    document_id: row.document.id,
    physical_invoice_status: "not_provided",
    payment_status: "unpaid",
  })),
}, null, 2));
if (!APPLY) process.exit(0);

const documentWrite = await db.from("documents").upsert(plans.map((row) => row.document), { onConflict: "id" });
if (documentWrite.error) throw documentWrite.error;
const linkWrite = await db.from("evidence_links").upsert(plans.map((row) => row.evidenceLink), { onConflict: "id" });
if (linkWrite.error) throw linkWrite.error;
for (const plan of plans) {
  const update = await db.from("invoices").update({
    metadata: {
      ...(plan.invoice.metadata ?? {}),
      source_evidence: {
        status: "management_entry_only",
        document_id: plan.document.id,
        physical_invoice_status: "not_provided",
        payment_evidence_status: "not_linked",
        no_email_used: true,
        recorded_at: capturedAt,
      },
    },
    updated_at: capturedAt,
  }).eq("id", plan.invoice.id).eq("status", "recorded").eq("paid_cents", 0);
  if (update.error) throw update.error;
}

const [verifiedDocuments, verifiedLinks, verifiedInvoices] = await Promise.all([
  db.from("documents").select("id,kind,content_sha256,metadata").in("id", plans.map((row) => row.document.id)),
  db.from("evidence_links").select("id,document_id,entity_id,evidence_role").in("id", plans.map((row) => row.evidenceLink.id)),
  db.from("invoices").select("id,status,paid_cents,balance_cents,metadata").in("id", plans.map((row) => row.invoice.id)),
]);
if (verifiedDocuments.error) throw verifiedDocuments.error;
if (verifiedLinks.error) throw verifiedLinks.error;
if (verifiedInvoices.error) throw verifiedInvoices.error;
assert(verifiedDocuments.data.length === plans.length && verifiedDocuments.data.every((row) => row.kind === "management_job_cost_record" && row.metadata?.physical_invoice_status === "not_provided"), "Management document verification failed.");
assert(verifiedLinks.data.length === plans.length && verifiedLinks.data.every((row) => row.evidence_role === "management_entry_record"), "Management evidence-link verification failed.");
assert(verifiedInvoices.data.length === plans.length && verifiedInvoices.data.every((row) => row.status === "recorded" && Number(row.paid_cents) === 0 && row.metadata?.source_evidence?.status === "management_entry_only"), "Management invoice verification failed.");
console.log(JSON.stringify({ applied: true, no_email_used: true, count: plans.length, total_cents: plans.reduce((sum, row) => sum + row.expected.subtotal_cents, 0) }, null, 2));
