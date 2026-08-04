#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const reportPath = path.resolve(
  repoRoot,
  "tmp/pdfs/derived-invoice-audit/audit.json",
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

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl =
  env.SUPABASE_URL ??
  env.NEXT_PUBLIC_SUPABASE_URL ??
  env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== TARGET_PROJECT_REF) {
  throw new Error(`Refusing to use unexpected Supabase project ${projectRef}.`);
}
if (!existsSync(reportPath)) {
  throw new Error("Run audit-derived-invoice-sources.mjs first.");
}

const report = JSON.parse(readFileSync(reportPath, "utf8"));
const manualInvoiceIds = report.audits
  .filter((audit) => !audit.exact_candidate)
  .map((audit) => audit.invoice.id);
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const invoiceResult = await db
  .from("labour_invoices")
  .select(
    "id,supplier_name,invoice_number,invoice_date,source_date,amount_before_tax,tax_amount,amount_paid,match_status,duplicate_group_id,duplicate_group_size,supporting_invoice_reference,original_filename",
  )
  .in("id", manualInvoiceIds)
  .order("supplier_name")
  .order("invoice_number");
if (invoiceResult.error) throw invoiceResult.error;

const duplicateGroupIds = [
  ...new Set(
    (invoiceResult.data ?? [])
      .map((invoice) => invoice.duplicate_group_id)
      .filter(Boolean),
  ),
];
const duplicateResult = duplicateGroupIds.length
  ? await db
      .from("labour_invoices")
      .select(
        "id,supplier_name,invoice_number,invoice_date,source_date,amount_before_tax,tax_amount,amount_paid,match_status,duplicate_group_id,duplicate_group_size,supporting_invoice_reference,original_filename",
      )
      .in("duplicate_group_id", duplicateGroupIds)
      .order("source_date")
  : { data: [], error: null };
if (duplicateResult.error) throw duplicateResult.error;

const projectResult = await db
  .from("companycam_projects")
  .select("companycam_id,name,formatted_address")
  .or(
    "name.ilike.%Joel%,formatted_address.ilike.%236 Trails%,name.ilike.%Nicole%,formatted_address.ilike.%1347 Maxime%",
  )
  .limit(50);
if (projectResult.error) throw projectResult.error;

const groups = Map.groupBy(
  duplicateResult.data ?? [],
  (invoice) => invoice.duplicate_group_id,
);
const output = {
  project_ref: projectRef,
  remaining_invoice_count: manualInvoiceIds.length,
  invoices: (invoiceResult.data ?? []).map((invoice) => ({
    ...invoice,
    duplicate_versions: groups.get(invoice.duplicate_group_id) ?? [],
  })),
  matching_projects: projectResult.data ?? [],
};

console.log(JSON.stringify(output, null, 2));
