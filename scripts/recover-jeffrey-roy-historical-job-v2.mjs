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
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
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

const env = {
  ...envFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")),
  ...envFile(path.join(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const INVOICE_ID = "309fd233-6f0e-514a-84c0-93e143833136";
const CONTACT_ID = "4cec4288-4371-52f0-8db7-5964b16b93ed";
const PROPOSAL_ID = "2101292";
const COMPANYCAM_ID = `dripjobs-${PROPOSAL_ID}`;
const JOB_ID = stableUuid(`job:recovered-dripjobs-proposal:${PROPOSAL_ID}`);
const EXPECTED_LINES = [
  { id: "d7e335f8-77c6-5e89-b850-33fb9da3722a", subtotal_cents: 6345, tax_cents: 825, total_cents: 7170 },
  { id: "bace8053-b292-5ca8-ba63-fccdaa1bb5c1", subtotal_cents: 441, tax_cents: 57, total_cents: 498 },
  { id: "64a0bfb8-fef9-547d-a3ba-3296190624d1", subtotal_cents: 491, tax_cents: 64, total_cents: 555 },
];

const [invoiceResult, contactResult, jobIdResult, proposalJobResult, quoteResult] = await Promise.all([
  db.from("invoices").select("id,invoice_number,issued_on,category,subtotal_cents,tax_cents,total_cents,metadata,lines:invoice_lines(id,line_number,subtotal_cents,tax_cents,total_cents),job_allocations:invoice_job_allocations(id,invoice_line_id,job_id,subtotal_cents,tax_cents,total_cents,metadata)").eq("id", INVOICE_ID).single(),
  db.from("contacts").select("id,name,email,phone,metadata").eq("id", CONTACT_ID).single(),
  db.from("jobs").select("*").eq("id", JOB_ID).maybeSingle(),
  db.from("jobs").select("*").or(`metadata->>dripjobs_job_number.eq.${PROPOSAL_ID},companycam_project_ids.cs.{${COMPANYCAM_ID}}`),
  db.from("quotes").select("id,dripjobs_proposal_id,amount_cents").eq("dripjobs_proposal_id", PROPOSAL_ID),
]);
for (const [label, result] of [
  ["invoice", invoiceResult],
  ["contact", contactResult],
  ["job id", jobIdResult],
  ["proposal job", proposalJobResult],
  ["quote", quoteResult],
]) if (result.error) throw new Error(`${label}: ${result.error.message}`);

const invoice = invoiceResult.data;
const contact = contactResult.data;
const projectMatch = invoice.metadata?.source_payload?.project_match;
assert(invoice.invoice_number === "2900-6", "Sherwin invoice number changed.");
assert(invoice.issued_on === "2025-10-14" && invoice.category === "material", "Sherwin invoice identity changed.");
assert(Number(invoice.subtotal_cents) === 7277 && Number(invoice.tax_cents) === 946 && Number(invoice.total_cents) === 8223, "Sherwin invoice totals changed.");
assert(projectMatch?.kind === "job" && projectMatch?.method === "customer_exact" && Number(projectMatch?.confidence) === 1, "Saved exact project match is missing.");
assert(projectMatch?.project?.companycam_id === COMPANYCAM_ID, "Saved proposal identity changed.");
assert(projectMatch?.project?.formatted_address === "10 Lynhurst Ave, Ottawa, ON, K1V 9W7", "Saved project address changed.");
assert(projectMatch?.project?.is_archived === true, "Saved historical job status changed.");
assert(contact.name === "Jeffrey Ian" && contact.email === "jeffreyianroy@gmail.com", "Jeffrey customer identity changed.");
assert(invoice.lines.length === EXPECTED_LINES.length, "Sherwin line count changed.");
for (const expected of EXPECTED_LINES) {
  const line = invoice.lines.find((row) => row.id === expected.id);
  assert(line, `Missing invoice line ${expected.id}.`);
  assert(Number(line.subtotal_cents) === expected.subtotal_cents && Number(line.tax_cents) === expected.tax_cents && Number(line.total_cents) === expected.total_cents, `Invoice line totals changed for ${expected.id}.`);
}
const existingProposalJobs = (proposalJobResult.data ?? []).filter((row) => row.id !== JOB_ID);
assert(existingProposalJobs.length === 0, "A different job already represents proposal 2101292.");
assert((quoteResult.data ?? []).length === 0, "A customer quote now exists for proposal 2101292; recover through that source instead.");
assert(invoice.job_allocations.length === 0 || invoice.job_allocations.every((row) => row.job_id === JOB_ID), "Invoice already has a different job allocation.");

const jobRow = {
  id: JOB_ID,
  contact_id: CONTACT_ID,
  lead_id: null,
  accepted_quote_id: null,
  name: "Jeffrey Roy / Jeffrey Ian — proposal 2101292 (completed)",
  status: "archived",
  contract_amount_cents: 0,
  address_line_1: "10 Lynhurst Ave",
  address_line_2: null,
  city: "Ottawa",
  province: "ON",
  postal_code: "K1V 9W7",
  country: "CA",
  formatted_address: "10 Lynhurst Ave, Ottawa, ON, K1V 9W7",
  companycam_project_ids: [COMPANYCAM_ID],
  archived_at: invoice.issued_on,
  is_feed_visible: true,
  source: "dripjobs_recovered_from_saved_supplier_match",
  metadata: {
    accounting_status: "active",
    dripjobs_job_number: PROPOSAL_ID,
    old_project_id: COMPANYCAM_ID,
    recovery_basis: "Saved exact customer/project match on Sherwin invoice 2900-6",
    recovery_source_invoice_id: INVOICE_ID,
    recovery_source_invoice_number: invoice.invoice_number,
    contract_amount_basis: "No customer quote or invoice evidence is stored; contract value intentionally remains zero.",
    source_payload: { project_match: projectMatch },
  },
  created_at: `${invoice.issued_on}T12:00:00.000Z`,
  updated_at: capturedAt,
};

const allocationRows = EXPECTED_LINES.map((line) => ({
  id: stableUuid(`invoice-job-allocation:${line.id}:${JOB_ID}`),
  invoice_id: INVOICE_ID,
  invoice_line_id: line.id,
  job_id: JOB_ID,
  subtotal_cents: line.subtotal_cents,
  tax_cents: line.tax_cents,
  total_cents: line.total_cents,
  quantity: null,
  minutes: null,
  allocation_method: "saved_exact_project_match,recovered_historical_job",
  confidence: 1,
  needs_review: false,
  metadata: {
    po_number: "JEFFREY",
    dripjobs_job_number: PROPOSAL_ID,
    companycam_project_id: COMPANYCAM_ID,
    source_invoice_id: INVOICE_ID,
    evidence_basis: "Exact saved Sherwin project match; no email rescan.",
  },
  created_at: capturedAt,
  updated_at: capturedAt,
}));

console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  no_email_used: true,
  job: jobRow,
  existing_job: jobIdResult.data,
  invoice: { id: invoice.id, invoice_number: invoice.invoice_number, subtotal_cents: invoice.subtotal_cents, total_cents: invoice.total_cents },
  allocations: allocationRows,
}, null, 2));
if (!APPLY) process.exit(0);

const jobWrite = await db.from("jobs").upsert(jobRow, { onConflict: "id" });
if (jobWrite.error) throw jobWrite.error;
const allocationWrite = await db.from("invoice_job_allocations").upsert(allocationRows, { onConflict: "id" });
if (allocationWrite.error) throw allocationWrite.error;

const [verifiedJobResult, verifiedInvoiceResult] = await Promise.all([
  db.from("jobs").select("id,contact_id,name,status,contract_amount_cents,formatted_address,companycam_project_ids,source,metadata").eq("id", JOB_ID).single(),
  db.from("invoices").select("id,invoice_number,job_allocations:invoice_job_allocations(id,invoice_line_id,job_id,subtotal_cents,tax_cents,total_cents,needs_review,confidence,allocation_method)").eq("id", INVOICE_ID).single(),
]);
if (verifiedJobResult.error) throw verifiedJobResult.error;
if (verifiedInvoiceResult.error) throw verifiedInvoiceResult.error;
const verifiedAllocations = verifiedInvoiceResult.data.job_allocations.filter((row) => row.job_id === JOB_ID);
assert(verifiedJobResult.data.contact_id === CONTACT_ID && verifiedJobResult.data.status === "archived", "Recovered job verification failed.");
assert(Number(verifiedJobResult.data.contract_amount_cents) === 0, "Recovered job contract value must remain zero without customer evidence.");
assert(verifiedAllocations.length === EXPECTED_LINES.length && verifiedAllocations.every((row) => row.needs_review === false && Number(row.confidence) === 1), "Sherwin allocation verification failed.");
assert(verifiedAllocations.reduce((sum, row) => sum + Number(row.subtotal_cents), 0) === 7277, "Sherwin subtotal allocation verification failed.");

console.log(JSON.stringify({ applied: true, no_email_used: true, job: verifiedJobResult.data, invoice: verifiedInvoiceResult.data }, null, 2));
