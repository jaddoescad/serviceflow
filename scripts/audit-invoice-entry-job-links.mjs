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

function groupCount(rows, keyFor) {
  const counts = new Map();
  for (const row of rows) {
    const key = keyFor(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) =>
      left.localeCompare(right, "en-CA"),
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

const { data, error } = await db
  .from("labour_invoice_lines")
  .select(
    `
      id,
      invoice_id,
      line_number,
      entry_type,
      description,
      amount_before_tax,
      needs_review,
      labour_invoice_line_allocations (
        companycam_project_id,
        allocated_amount,
        needs_review
      ),
      labour_invoices!inner (
        id,
        supplier_name,
        invoice_number,
        invoice_date,
        source_date,
        amount_paid,
        document_type,
        match_status,
        duplicate_group_id,
        duplicate_group_size,
        labour_invoice_projects (
          companycam_project_id,
          needs_review,
          companycam_projects (
            name,
            formatted_address
          )
        )
      )
    `,
  )
  .eq("labour_invoices.document_type", "invoice")
  .order("invoice_id")
  .order("line_number");

if (error) throw error;

const entries = (data ?? []).map((value) => {
  const row = value;
  const invoice = row.labour_invoices;
  const allocations = row.labour_invoice_line_allocations ?? [];
  const invoiceProjects = invoice.labour_invoice_projects ?? [];
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    supplier: invoice.supplier_name,
    invoiceNumber: invoice.invoice_number,
    entryType: row.entry_type,
    description: row.description,
    amount: Number(row.amount_before_tax),
    needsReview: Boolean(row.needs_review),
    matchStatus: invoice.match_status,
    invoiceDate: invoice.invoice_date,
    sourceDate: invoice.source_date,
    amountAfterTax: Number(invoice.amount_paid ?? 0),
    duplicateGroupId: invoice.duplicate_group_id,
    duplicateGroupSize: Number(invoice.duplicate_group_size ?? 1),
    allocations: allocations.map((allocation) => ({
      projectId: allocation.companycam_project_id,
      amount: Number(allocation.allocated_amount),
      needsReview: Boolean(allocation.needs_review),
    })),
    invoiceProjects: invoiceProjects.map((project) => ({
      projectId: project.companycam_project_id,
      needsReview: Boolean(project.needs_review),
      name:
        project.companycam_projects?.name ?? project.companycam_project_id,
      address: project.companycam_projects?.formatted_address ?? null,
    })),
  };
});

const currentInvoiceByGroup = new Map();
for (const entry of entries) {
  if (entry.matchStatus === "supporting_document") continue;
  const groupId = entry.duplicateGroupId ?? entry.invoiceId;
  const current = currentInvoiceByGroup.get(groupId);
  if (!current) {
    currentInvoiceByGroup.set(groupId, entry);
    continue;
  }
  const date = entry.sourceDate ?? entry.invoiceDate ?? "";
  const currentDate = current.sourceDate ?? current.invoiceDate ?? "";
  if (
    date > currentDate ||
    (date === currentDate &&
      (entry.amountAfterTax > current.amountAfterTax ||
        (entry.amountAfterTax === current.amountAfterTax &&
          entry.invoiceId > current.invoiceId)))
  ) {
    currentInvoiceByGroup.set(groupId, entry);
  }
}
const currentInvoiceIds = new Set(
  [...currentInvoiceByGroup.values()].map((entry) => entry.invoiceId),
);
const currentEntries = entries.filter((entry) =>
  currentInvoiceIds.has(entry.invoiceId),
);

const assigned = currentEntries.filter(
  (entry) => entry.allocations.length === 1,
);
const split = currentEntries.filter((entry) => entry.allocations.length > 1);
const unassigned = currentEntries.filter(
  (entry) => entry.allocations.length === 0,
);
const explicitOverhead = unassigned.filter(
  (entry) => entry.matchStatus === "overhead_unmatched",
);
const invoiceLinkedButUnallocated = unassigned.filter(
  (entry) =>
    entry.matchStatus !== "overhead_unmatched" &&
    entry.invoiceProjects.length > 0,
);
const needsJobReview = unassigned.filter(
  (entry) => entry.matchStatus !== "overhead_unmatched",
);

const report = {
  projectRef: new URL(supabaseUrl).hostname.split(".")[0],
  totals: {
    entries: currentEntries.length,
    assignedToOneJob: assigned.length,
    splitAcrossJobs: split.length,
    unassigned: unassigned.length,
    explicitOverheadUnassigned: explicitOverhead.length,
    invoiceLinkedButEntryUnallocated: invoiceLinkedButUnallocated.length,
    needsJobReview: needsJobReview.length,
  },
  unassignedByMatchStatus: groupCount(
    unassigned,
    (entry) => entry.matchStatus,
  ),
  unassignedByEntryType: groupCount(unassigned, (entry) => entry.entryType),
  unassignedBySupplier: groupCount(unassigned, (entry) => entry.supplier),
  invoiceLinkedButEntryUnallocated: invoiceLinkedButUnallocated,
  needsJobReview,
};

console.log(JSON.stringify(report, null, 2));

if (invoiceLinkedButUnallocated.length > 0 || needsJobReview.length > 0) {
  process.exitCode = 1;
}
