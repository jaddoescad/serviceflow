#!/usr/bin/env node

import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const now = new Date().toISOString();

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
  ...envFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")),
  ...envFile(path.join(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// Each mapping is anchored to a printed invoice line. Historical proposal variants
// are used where the customer later bought another job under the same name.
const mappings = [
  ["393", 1, "Bethan Elliott", "70e73d08-0aa6-5402-bf2c-844ad6c98f4c", "Bethan Elliott", "exact_printed_customer_name"],
  ["395", 1, "Jillian Morgan", "2b7c0b7c-3041-5960-95c0-a3ae4e3d429a", "Jillian Morgan", "exact_printed_customer_name"],
  ["395", 2, "Tom Benton", "5e4558ff-c4bb-5591-b33b-69929b13732e", "Tom Benton — proposal 2390920 (completed)", "printed_name_and_historical_proposal_date"],
  ["395", 3, "Natasha Kawan", "057e0dde-2a8d-5321-9e79-63f4b4521d0f", "Natasha Kawam", "printed_name_typo_and_proposal_date"],
  ["395", 4, "Marilyn Hingorani", "b3fde37d-4e80-56ec-8535-c10e9c02c7c2", "Marilyn Hingorani", "exact_printed_customer_name"],
  ["396", 1, "Nixon-Janssen", "53ce3349-2d3f-530d-b760-d364afefe5fe", "Luke Nixon-Janssen... — proposal 2372277 (completed)", "printed_surname_and_historical_proposal_date"],
  ["396", 2, "Leclair", "a98b213f-f49a-5ae5-9738-45086317a2b4", "Christine Leclair — proposal 2370863 (completed)", "printed_surname_and_historical_proposal_date"],
  ["396", 3, "McGuire", "a3c24514-b777-5a97-9645-de69d406a830", "Natacha McGuire", "printed_surname_and_proposal_date"],
  ["397", 1, "Sukaina Okorofsky", "07e911af-522a-5b46-93a6-8f5d3c9dfb6b", "Sukaina Okorofsky", "exact_printed_customer_name"],
  ["397", 2, "Courtney Mondoux", "5703b1e6-c394-5e43-9230-0119f76c1783", "Courtney Mondoux", "exact_printed_customer_name"],
  ["400", 1, "Kim Johnston", "5f6ca26b-e988-5255-8d3b-0568cd52c930", "Kim Johnston — proposal 2383685 (completed)", "printed_name_and_historical_proposal_date"],
  ["401", 1, "Libby Boulianne", "22c7c14e-7050-586b-be72-0dee546a64ea", "Libby Boulianne", "exact_printed_customer_name"],
  ["403", 1, "Gregg Alexander", "e3f3842c-238d-59de-b71c-13eefff23430", "Gregg Alexander — proposal 2484669 (completed)", "printed_name_and_historical_proposal_date"],
  ["403", 2, "Noah Rossman", "e5acf9f3-8f1e-5904-98bb-db6f276490d2", "Noah Rossman", "exact_printed_customer_name"],
  ["403", 3, "Laura Van Cleef", "1c43f245-68ce-5386-ab69-f77fc276744a", "Laura Van Cleef — proposal 2413005 (completed)", "printed_name_and_historical_proposal_date"],
  ["405", 1, "Debbie Lundin", "53e52081-6c7c-5cce-b914-3c08e0d7bb17", "Debbie Lundin", "exact_printed_customer_name"],
  ["406", 1, "Gord Stockdale", "c8c4ffc7-65f7-5e61-a5b8-a128eb314b90", "Gord Stockdale", "exact_printed_customer_name"],
  ["406", 2, "Heather Thomsen", "0a729fba-26bb-562b-81f0-415d9cf4dae0", "Heather Thomsen", "exact_printed_customer_name"],
  ["406", 3, "Sarah Cruikshank", "86ce4cd0-3546-59c7-bbb0-5b602f3d9c38", "Sarah Cruickshank", "printed_name_typo_and_proposal_date"],
  ["406", 4, "Yacoub Abdulla", "2a5db544-6d2c-5f33-83f1-6fe065d2f2c2", "Yacoub Abdulla", "exact_printed_customer_name"],
  ["407", 1, "Matt Mitchell", "fb46c1ea-86a4-539f-bb95-cd7905873067", "Matt Mitchell", "exact_printed_customer_name"],
  ["409", 1, "Dever Jylha", "512f9bdf-8533-5c99-9e9c-12c7f3702a71", "Dever Jylha", "exact_printed_customer_name"],
  ["409", 2, "Marianne Graham — phone consultation", "c4c269e3-5a2b-535e-a15f-1476c3938033", "Marienne Graham", "printed_name_typo_email_and_proposal_date"],
  ["409", 3, "Sue Dulaney", "7b0d9ef0-c0b7-507a-b74d-4fe1bd7c6eb7", "Sue Deluney", "printed_name_typo_and_proposal_date"],
  ["409", 4, "Roslyn Adu — phone consultation", "f0743718-d031-5e03-9f60-0628bb0d82d7", "Roslyn Mulongo", "printed_name_email_and_source_last_name"],
  ["409", 5, "Alexandra Mackenzie", "c10c5dbe-c027-5a80-9876-e705f7c637eb", "Alexandra Mackenzie", "exact_printed_customer_name"],
  ["411", 1, "Paul Toonders", "3955bafb-4b27-5d9b-a7df-5db84d087341", "Paul Toonders", "printed_name_and_active_project"],
  ["411", 2, "Kirsty Harris", "937164b8-fd2e-5d1c-bcf5-6d6797684c15", "Kirsty Harris", "exact_printed_customer_name"],
  ["411", 3, "David Rennie", "e4d85d8a-7da6-59c3-be6b-951cf5dd6a66", "David Rennie", "exact_printed_customer_name"],
  ["412", 1, "Phil Anido", "fa9d5e0b-4192-5251-8d16-5d7d7dd0ac16", "Phil Anido", "exact_printed_customer_name"],
  ["412", 2, "Corey Parsons", "f5f15bfe-5ac7-53da-9296-bfd1cfa8dd41", "Corey Parsons", "printed_name_and_current_proposal_date"],
  ["412", 3, "Barry Dollin", "006776be-552c-5deb-aeb9-f190d6b5a558", "Barry Dollin", "exact_printed_customer_name"],
];

const invoiceNumbers = [...new Set(mappings.map(([number]) => number))];
const jobIds = [...new Set(mappings.map(([, , , jobId]) => jobId))];
const [{ data: invoices, error: invoiceError }, { data: jobs, error: jobError }] = await Promise.all([
  db.from("invoices").select("id,invoice_number,issued_on,subtotal_cents,total_cents,status,metadata,contact:contacts(name),lines:invoice_lines(*),job_allocations:invoice_job_allocations(*)").in("invoice_number", invoiceNumbers),
  db.from("jobs").select("id,name,status,metadata").in("id", jobIds),
]);
if (invoiceError) throw invoiceError;
if (jobError) throw jobError;

const invoiceByNumber = new Map(invoices.filter((row) => row.contact?.name === "Dressing Rooms").map((row) => [row.invoice_number, row]));
const jobById = new Map(jobs.map((row) => [row.id, row]));
const writes = [];
for (const [invoiceNumber, lineNumber, expectedDescription, jobId, expectedJobName, method] of mappings) {
  const invoice = invoiceByNumber.get(invoiceNumber);
  if (!invoice) throw new Error(`Missing Dressing Rooms invoice ${invoiceNumber}.`);
  const line = invoice.lines.find((row) => Number(row.line_number) === lineNumber);
  if (!line || line.description !== expectedDescription) throw new Error(`Invoice ${invoiceNumber} line ${lineNumber} changed.`);
  const job = jobById.get(jobId);
  if (!job || job.name !== expectedJobName || job.status === "cancelled") throw new Error(`Job target changed for invoice ${invoiceNumber} line ${lineNumber}.`);
  const active = invoice.job_allocations.filter((row) => row.invoice_line_id === line.id && !row.metadata?.reversed_at);
  if (active.some((row) => row.job_id !== jobId)) throw new Error(`Conflicting allocation on invoice ${invoiceNumber} line ${lineNumber}.`);
  writes.push({
    id: uuid(`invoice-job-allocation:${line.id}:${jobId}`),
    invoice_id: invoice.id,
    invoice_line_id: line.id,
    job_id: jobId,
    subtotal_cents: Number(line.subtotal_cents),
    tax_cents: 0,
    total_cents: Number(line.subtotal_cents),
    allocation_method: method,
    confidence: method === "exact_printed_customer_name" ? 1 : 0.99,
    needs_review: false,
    metadata: {
      source: "gmail_dressing_rooms_invoice_line",
      printed_customer: expectedDescription,
      repair_reason: "Supplier invoice and bank payment were linked, but the printed customer line was not linked to the job.",
    },
    created_at: now,
    updated_at: now,
  });
}

const expectedByInvoice = Map.groupBy(writes, (row) => row.invoice_id);
const preview = [...expectedByInvoice.entries()].map(([invoiceId, rows]) => {
  const invoice = invoices.find((row) => row.id === invoiceId);
  return {
    invoice_number: invoice.invoice_number,
    issued_on: invoice.issued_on,
    linked_line_count: rows.length,
    linked_pre_tax_cents: rows.reduce((sum, row) => sum + row.subtotal_cents, 0),
    invoice_pre_tax_cents: Number(invoice.subtotal_cents),
    unlinked_pre_tax_cents: Number(invoice.subtotal_cents) - rows.reduce((sum, row) => sum + row.subtotal_cents, 0),
  };
});

if (!APPLY) {
  console.log(JSON.stringify({ mode: "dry-run", allocation_count: writes.length, invoices: preview }, null, 2));
  process.exit(0);
}

const { error: writeError } = await db.from("invoice_job_allocations").upsert(writes, { onConflict: "id" });
if (writeError) throw writeError;

for (const invoice of invoices.filter((row) => expectedByInvoice.has(row.id))) {
  const rows = expectedByInvoice.get(invoice.id);
  const linked = rows.reduce((sum, row) => sum + row.subtotal_cents, 0);
  const update = await db.from("invoices").update({
    metadata: {
      ...(invoice.metadata ?? {}),
      job_costing_repair: {
        status: linked === Number(invoice.subtotal_cents) ? "fully_linked" : "partially_linked",
        linked_line_count: rows.length,
        linked_pre_tax_cents: linked,
        unlinked_pre_tax_cents: Number(invoice.subtotal_cents) - linked,
        repaired_at: now,
        source: "gmail_invoice_lines_and_dripjobs_proposal_dates",
      },
    },
    updated_at: now,
  }).eq("id", invoice.id);
  if (update.error) throw update.error;
}

const { data: verified, error: verifyError } = await db.from("invoice_job_allocations")
  .select("id,invoice_id,invoice_line_id,job_id,subtotal_cents,total_cents,needs_review,metadata")
  .in("id", writes.map((row) => row.id));
if (verifyError) throw verifyError;
if (verified.length !== writes.length) throw new Error(`Expected ${writes.length} stored allocations, found ${verified.length}.`);
for (const row of writes) {
  const stored = verified.find((candidate) => candidate.id === row.id);
  if (!stored || stored.job_id !== row.job_id || Number(stored.subtotal_cents) !== row.subtotal_cents || stored.needs_review) {
    throw new Error(`Post-write verification failed for ${row.id}.`);
  }
}

console.log(JSON.stringify({ mode: "applied", allocation_count: writes.length, invoices: preview }, null, 2));
