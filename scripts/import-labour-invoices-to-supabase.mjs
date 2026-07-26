#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";

globalThis.WebSocket = WebSocket;
const { createClient } = await import("@supabase/supabase-js");

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

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const manifestPath = path.resolve(
  repoRoot,
  "tmp/invoice-reconciliation/manifest.json",
);
const contextPath = path.resolve(
  repoRoot,
  "tmp/invoice-reconciliation/project-context.json",
);
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const context = JSON.parse(await fs.readFile(contextPath, "utf8"));
const apply = process.argv.includes("--apply");
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
if (projectRef !== context.project_ref) {
  throw new Error(
    `Refusing import: manifest project ${context.project_ref} does not match ${projectRef}.`,
  );
}

const invoiceRows = manifest.map((item) => ({
  supplier_name: item.supplier_name,
  invoice_number: item.invoice_number,
  invoice_date: item.invoice_date,
  currency: item.currency,
  amount_paid: item.amount_paid,
  amount_before_tax: item.amount_before_tax,
  tax_amount: item.tax_amount,
  payment_basis: item.payment_basis,
  document_type: item.document_type,
  match_status: item.match_status,
  storage_bucket: item.storage_bucket,
  storage_path: item.storage_path,
  original_filename: item.source_filename,
  mime_type: item.mime_type,
  file_size: item.file_size,
  content_sha256: item.sha256,
  source_date: item.source_date,
  source_label: "Gmail / Labour Invoices",
  duplicate_group_id: item.duplicate_group_id,
  duplicate_group_size: item.duplicate_group_size,
  supporting_invoice_reference: item.supporting_invoice_reference,
  text_excerpt: item.text_excerpt,
}));

const preview = {
  mode: apply ? "apply" : "dry-run",
  projectRef,
  files: manifest.length,
  bytes: manifest.reduce((sum, item) => sum + item.file_size, 0),
  invoiceRows: invoiceRows.length,
  jobLinks: manifest.reduce(
    (sum, item) => sum + (item.match_candidates?.length ?? 0),
    0,
  ),
  matchStatuses: Object.fromEntries(
    [...new Set(manifest.map((item) => item.match_status))]
      .sort()
      .map((status) => [
        status,
        manifest.filter((item) => item.match_status === status).length,
      ]),
  ),
};
console.log(JSON.stringify(preview, null, 2));
if (!apply) process.exit(0);

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const bucketResult = await db.storage.getBucket("labour-invoices");
if (bucketResult.error) {
  throw new Error(`Private bucket is missing: ${bucketResult.error.message}`);
}
if (bucketResult.data.public) {
  throw new Error("Refusing import because labour-invoices bucket is public.");
}

let uploaded = 0;
let alreadyStored = 0;
await mapLimit(manifest, 4, async (item) => {
  const file = await fs.readFile(item.source_path);
  const actualHash = createHash("sha256").update(file).digest("hex");
  if (actualHash !== item.sha256) {
    throw new Error(`Hash changed since extraction: ${item.source_filename}`);
  }
  const result = await db.storage
    .from(item.storage_bucket)
    .upload(item.storage_path, file, {
      contentType: item.mime_type,
      upsert: false,
      cacheControl: "3600",
    });
  if (result.error) {
    if (
      String(result.error.statusCode) === "409" ||
      /already exists|duplicate/i.test(result.error.message)
    ) {
      alreadyStored += 1;
      return;
    }
    throw new Error(`Upload failed for ${item.source_filename}: ${result.error.message}`);
  }
  uploaded += 1;
  if ((uploaded + alreadyStored) % 25 === 0) {
    console.log(
      `Stored ${uploaded + alreadyStored}/${manifest.length} files (${uploaded} new).`,
    );
  }
});

const storedInvoices = [];
for (const rows of chunk(invoiceRows, 75)) {
  const result = await db
    .from("labour_invoices")
    .upsert(rows, { onConflict: "content_sha256" })
    .select("id,content_sha256");
  if (result.error) {
    throw new Error(`Invoice metadata import failed: ${result.error.message}`);
  }
  storedInvoices.push(...(result.data ?? []));
}

const idByHash = new Map(
  storedInvoices.map((invoice) => [invoice.content_sha256, invoice.id]),
);
const linkRows = [];
for (const item of manifest) {
  const invoiceId = idByHash.get(item.sha256);
  if (!invoiceId) throw new Error(`Missing imported invoice ID for ${item.source_filename}`);
  const candidates = item.match_candidates ?? [];
  for (const [index, candidate] of candidates.entries()) {
    linkRows.push({
      invoice_id: invoiceId,
      companycam_project_id: candidate.companycam_project_id,
      allocated_amount:
        candidate.allocated_amount ??
        (candidates.length === 1 ? item.amount_before_tax : null),
      match_score: candidate.score,
      match_method: candidate.evidence,
      is_primary: index === 0,
      needs_review: candidate.score < 65 || candidate.is_lead,
    });
  }
}

for (const rows of chunk(linkRows, 100)) {
  const result = await db
    .from("labour_invoice_projects")
    .upsert(rows, { onConflict: "invoice_id,companycam_project_id" });
  if (result.error) {
    throw new Error(`Invoice-to-job link import failed: ${result.error.message}`);
  }
}

const [invoiceCount, linkCount] = await Promise.all([
  db.from("labour_invoices").select("*", { count: "exact", head: true }),
  db.from("labour_invoice_projects").select("*", { count: "exact", head: true }),
]);
if (invoiceCount.error) throw invoiceCount.error;
if (linkCount.error) throw linkCount.error;

console.log(
  JSON.stringify(
    {
      uploaded,
      alreadyStored,
      invoiceRowsUpserted: storedInvoices.length,
      jobLinksUpserted: linkRows.length,
      remoteInvoiceCount: invoiceCount.count,
      remoteJobLinkCount: linkCount.count,
      bucketPublic: bucketResult.data.public,
    },
    null,
    2,
  ),
);
