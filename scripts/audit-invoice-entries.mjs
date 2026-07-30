#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

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

function countsBy(rows, key) {
  const counts = {};
  for (const row of rows) {
    counts[row[key]] = (counts[row[key]] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
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

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [invoiceResult, entryResult, allocationResult] = await Promise.all([
  db
    .from("labour_invoices")
    .select("id,supplier_name,invoice_number,amount_before_tax")
    .eq("document_type", "invoice"),
  db
    .from("invoice_entries")
    .select(
      "id,invoice_id,entry_type,source_kind,amount_before_tax,needs_review",
    ),
  db
    .from("labour_invoice_line_allocations")
    .select("invoice_line_id,allocated_amount"),
]);

if (invoiceResult.error) throw invoiceResult.error;
if (entryResult.error) throw entryResult.error;
if (allocationResult.error) throw allocationResult.error;

const invoices = invoiceResult.data ?? [];
const entries = entryResult.data ?? [];
const allocations = allocationResult.data ?? [];
const entriesByInvoice = Map.groupBy(entries, (entry) => entry.invoice_id);
const allocatedEntryIds = new Set(
  allocations.map((allocation) => allocation.invoice_line_id),
);
const documentsWithoutEntries = invoices.filter(
  (invoice) => !entriesByInvoice.has(invoice.id),
);
const derivedEntriesWithoutJob = entries.filter(
  (entry) =>
    entry.source_kind === "legacy_project_link" &&
    !allocatedEntryIds.has(entry.id),
);
const totalMismatches = invoices
  .map((invoice) => ({
    supplier: invoice.supplier_name,
    invoice: invoice.invoice_number,
    printedAmount: Number(invoice.amount_before_tax),
    entryAmount: (entriesByInvoice.get(invoice.id) ?? []).reduce(
      (total, entry) => total + Number(entry.amount_before_tax),
      0,
    ),
  }))
  .map((comparison) => ({
    ...comparison,
    difference: Number(
      (comparison.entryAmount - comparison.printedAmount).toFixed(2),
    ),
  }))
  .filter((comparison) => Math.abs(comparison.difference) > 0.005);

const audit = {
  projectRef: new URL(supabaseUrl).hostname.split(".")[0],
  invoiceDocuments: invoices.length,
  invoiceEntries: entries.length,
  entryTypes: countsBy(entries, "entry_type"),
  evidenceSources: countsBy(entries, "source_kind"),
  jobAllocations: allocations.length,
  controls: {
    allInvoiceDocumentsHaveEntries: documentsWithoutEntries.length === 0,
    allDerivedJobEntriesHaveJobAllocations:
      derivedEntriesWithoutJob.length === 0,
    exactOrManualEntries: entries.filter((entry) =>
      ["extracted", "manual"].includes(entry.source_kind),
    ).length,
    entriesNeedingExactExtraction: entries.filter(
      (entry) => entry.source_kind === "legacy_invoice_total",
    ).length,
  },
  documentsWithoutEntries: documentsWithoutEntries.map((invoice) => ({
    supplier: invoice.supplier_name,
    invoice: invoice.invoice_number,
  })),
  derivedEntriesWithoutJob: derivedEntriesWithoutJob.map((entry) => entry.id),
  totalMismatches,
};

console.log(JSON.stringify(audit, null, 2));

if (
  documentsWithoutEntries.length > 0 ||
  derivedEntriesWithoutJob.length > 0
) {
  process.exitCode = 1;
}
