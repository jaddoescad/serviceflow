#!/usr/bin/env node

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

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isOperationalJob(project) {
  const name = normalize(project.name);
  const address = normalize(project.formatted_address);
  return (
    !project.is_lead &&
    !project.is_deleted &&
    project.companycam_id !== "qa-web-smoke-project" &&
    !name.includes("test") &&
    !["jad slim", "scott"].includes(name) &&
    !address.startsWith("2377 walkley") &&
    !address.startsWith("2337 walkley")
  );
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
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

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [invoiceResult, linkResult, projectResult, bucketResult] = await Promise.all([
  db
    .from("labour_invoices")
    .select(
      "id,supplier_name,invoice_number,invoice_date,currency,amount_paid,amount_before_tax,tax_amount,payment_basis,document_type,match_status,storage_bucket,storage_path,original_filename,mime_type,file_size,content_sha256,source_date,duplicate_group_id,duplicate_group_size,supporting_invoice_reference,inserted_at",
    )
    .order("invoice_date", { ascending: true, nullsFirst: false })
    .order("original_filename", { ascending: true }),
  db
    .from("labour_invoice_projects")
    .select(
      "invoice_id,companycam_project_id,allocated_amount,match_score,match_method,is_primary,needs_review,companycam_projects(name,formatted_address,is_archived,is_lead,is_deleted)",
    ),
  db
    .from("companycam_projects")
    .select(
      "companycam_id,name,formatted_address,is_archived,is_lead,is_deleted,companycam_updated_at",
    )
    .limit(1000),
  db.storage.getBucket("labour-invoices"),
]);

for (const [label, result] of Object.entries({
  invoices: invoiceResult,
  links: linkResult,
  projects: projectResult,
  bucket: bucketResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

const storageFiles = [];
async function walkStorage(prefix) {
  let offset = 0;
  while (true) {
    const result = await db.storage.from("labour-invoices").list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (result.error) {
      throw new Error(`Storage listing failed at ${prefix}: ${result.error.message}`);
    }
    const items = result.data ?? [];
    for (const item of items) {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) {
        storageFiles.push({
          path: fullPath,
          id: item.id,
          created_at: item.created_at,
          updated_at: item.updated_at,
          metadata: item.metadata,
        });
      } else {
        await walkStorage(fullPath);
      }
    }
    if (items.length < 1000) break;
    offset += items.length;
  }
}
await walkStorage("gmail-labour-invoices");

const invoices = invoiceResult.data ?? [];
const links = linkResult.data ?? [];
const projects = projectResult.data ?? [];
const jobs = projects.filter(isOperationalJob);
const linkedJobIds = new Set(links.map((link) => link.companycam_project_id));
const jobsWithoutInvoices = jobs
  .filter((project) => !linkedJobIds.has(project.companycam_id))
  .sort(
    (left, right) =>
      Number(left.is_archived) - Number(right.is_archived) ||
      String(left.name).localeCompare(String(right.name)),
  );
const expectedPaths = new Set(invoices.map((invoice) => invoice.storage_path));
const storedPaths = new Set(storageFiles.map((file) => file.path));
const missingStorageObjects = [...expectedPaths].filter((item) => !storedPaths.has(item));
let orphanStorageObjects = [...storedPaths].filter((item) => !expectedPaths.has(item));
let verifiedStorageFiles = storageFiles;
if (process.argv.includes("--cleanup-orphans")) {
  if (missingStorageObjects.length) {
    throw new Error("Refusing orphan cleanup while expected storage objects are missing.");
  }
  for (let index = 0; index < orphanStorageObjects.length; index += 100) {
    const result = await db.storage
      .from("labour-invoices")
      .remove(orphanStorageObjects.slice(index, index + 100));
    if (result.error) {
      throw new Error(`Orphan cleanup failed: ${result.error.message}`);
    }
  }
  console.log(`Removed ${orphanStorageObjects.length} verified orphan storage objects.`);
  const orphanSet = new Set(orphanStorageObjects);
  verifiedStorageFiles = storageFiles.filter((file) => !orphanSet.has(file.path));
  orphanStorageObjects = [];
}

const output = {
  project_ref: new URL(supabaseUrl).hostname.split(".")[0],
  exported_at: new Date().toISOString(),
  bucket: bucketResult.data,
  invoices,
  links,
  storage_files: verifiedStorageFiles,
  jobs,
  jobs_without_invoices: jobsWithoutInvoices,
  summary: {
    invoices: invoices.length,
    links: links.length,
    distinct_linked_projects: linkedJobIds.size,
    storage_objects: verifiedStorageFiles.length,
    missing_storage_objects: missingStorageObjects,
    orphan_storage_objects: orphanStorageObjects,
    duplicate_groups: new Set(
      invoices
        .map((invoice) => invoice.duplicate_group_id)
        .filter(Boolean),
    ).size,
    duplicate_group_files: invoices.filter((invoice) => invoice.duplicate_group_id)
      .length,
    status_counts: Object.fromEntries(
      [...new Set(invoices.map((invoice) => invoice.match_status))]
        .sort()
        .map((status) => [
          status,
          invoices.filter((invoice) => invoice.match_status === status).length,
        ]),
    ),
    operational_jobs: jobs.length,
    active_jobs: jobs.filter((job) => !job.is_archived).length,
    jobs_without_invoices: jobsWithoutInvoices.length,
    active_jobs_without_invoices: jobsWithoutInvoices.filter((job) => !job.is_archived)
      .length,
    private_bucket: bucketResult.data.public === false,
  },
};

const outputPath = path.resolve(
  repoRoot,
  "tmp/invoice-reconciliation/live-reconciliation.json",
);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ outputPath, ...output.summary }, null, 2));
