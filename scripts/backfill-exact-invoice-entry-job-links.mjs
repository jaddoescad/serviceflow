#!/usr/bin/env node
// Backfill only invoice-entry/job links supported by exact stored evidence.

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
const apply = process.argv.includes("--apply");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [lineResult, projectResult] = await Promise.all([
  db.from("labour_invoice_lines").select(`
    id,
    invoice_id,
    line_number,
    entry_type,
    description,
    amount_before_tax,
    quantity_hours,
    labour_invoice_line_allocations (
      companycam_project_id
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
  `),
  db
    .from("companycam_projects")
    .select("companycam_id,name,formatted_address")
    .limit(5000),
]);

if (lineResult.error) throw lineResult.error;
if (projectResult.error) throw projectResult.error;

const data = lineResult.data ?? [];
const allProjects = (projectResult.data ?? []).map((project) => ({
  companycam_project_id: project.companycam_id,
  needs_review: false,
  companycam_projects: {
    name: project.name,
    formatted_address: project.formatted_address,
  },
}));

function normalize(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function exactProjectMatch(row, projects) {
  const description = normalize(row.description);
  const matches = projects.filter((project) => {
    const fullName = project.companycam_projects?.name ?? "";
    const customerName = fullName
      .replace(/\s+—\s+proposal.*$/i, "")
      .replace(/\s+-\s+20\d{2}-\d{2}-\d{2}.*$/i, "");
    const street =
      project.companycam_projects?.formatted_address?.split(",")[0] ?? "";
    const nameKey = normalize(customerName);
    const streetKey = normalize(street);
    return (
      (nameKey.length >= 6 && description.includes(nameKey)) ||
      (streetKey.length >= 6 && description.includes(streetKey))
    );
  });
  return matches.length === 1 ? matches[0] : null;
}

const currentInvoiceByGroup = new Map();
for (const row of data) {
  const invoice = row.labour_invoices;
  if (
    invoice.document_type !== "invoice" ||
    invoice.match_status === "supporting_document"
  ) {
    continue;
  }
  const groupId = invoice.duplicate_group_id ?? invoice.id;
  const current = currentInvoiceByGroup.get(groupId);
  if (!current) {
    currentInvoiceByGroup.set(groupId, invoice);
    continue;
  }
  const date = invoice.source_date ?? invoice.invoice_date ?? "";
  const currentDate = current.source_date ?? current.invoice_date ?? "";
  const amount = Number(invoice.amount_paid ?? 0);
  const currentAmount = Number(current.amount_paid ?? 0);
  if (
    date > currentDate ||
    (date === currentDate &&
      (amount > currentAmount ||
        (amount === currentAmount && invoice.id > current.id)))
  ) {
    currentInvoiceByGroup.set(groupId, invoice);
  }
}
const currentInvoiceIds = new Set(
  [...currentInvoiceByGroup.values()].map((invoice) => invoice.id),
);

const candidates = data
  .map((row) => {
    const invoice = row.labour_invoices;
    const projects = invoice.labour_invoice_projects ?? [];
    const isUnallocatedCurrentInvoice =
      invoice.document_type === "invoice" &&
      currentInvoiceIds.has(invoice.id) &&
      (row.labour_invoice_line_allocations ?? []).length === 0;
    if (!isUnallocatedCurrentInvoice) return null;

    if (
      invoice.match_status === "matched" &&
      projects.length === 1 &&
      !projects[0].needs_review
    ) {
      return { row, project: projects[0], rule: "exact_single_invoice_project" };
    }

    if (invoice.match_status === "matched_multiple" && projects.length > 1) {
      const project = exactProjectMatch(row, projects);
      if (project && !project.needs_review) {
        return { row, project, rule: "exact_invoice_item_project_match" };
      }
    }

    if (
      projects.length === 0 &&
      row.entry_type !== "commission" &&
      !["overhead_unmatched", "supporting_document"].includes(
        invoice.match_status,
      )
    ) {
      const project = exactProjectMatch(row, allProjects);
      if (project) {
        return {
          row,
          project,
          rule: "exact_invoice_item_global_project_match",
        };
      }
    }
    return null;
  })
  .filter(Boolean)
  .map(({ row, project, rule }) => ({
    invoice_line_id: row.id,
    companycam_project_id: project.companycam_project_id,
    allocated_amount: Number(row.amount_before_tax),
    allocated_hours:
      row.quantity_hours == null ? null : Number(row.quantity_hours),
    allocation_method: [
      rule,
      "entry_amount_from_physical_invoice",
      "backfill_20260731",
    ],
    needs_review: false,
    audit: {
      supplier: row.labour_invoices.supplier_name,
      invoice: row.labour_invoices.invoice_number,
      line: row.line_number,
      description: row.description,
    },
  }));

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      projectRef: new URL(supabaseUrl).hostname.split(".")[0],
      candidateCount: candidates.length,
      candidates: candidates.map(({ audit, ...candidate }) => ({
        ...audit,
        ...candidate,
      })),
    },
    null,
    2,
  ),
);

if (!apply || candidates.length === 0) process.exit(0);

const payload = candidates.map(({ audit: _audit, ...candidate }) => candidate);
const upsert = await db
  .from("labour_invoice_line_allocations")
  .upsert(payload, {
    onConflict: "invoice_line_id,companycam_project_id",
  })
  .select("invoice_line_id,companycam_project_id,allocated_amount");

if (upsert.error) throw upsert.error;

console.log(
  JSON.stringify(
    {
      applied: upsert.data?.length ?? 0,
      allocations: upsert.data ?? [],
    },
    null,
    2,
  ),
);
