#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const TARGET_PROJECT_ID = "dripjobs-2193648";
const apply = process.argv.includes("--apply");
const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);

const targets = new Map([
  ["0793-3|2025-08-21", "Receipt predates the customer's first recorded appointment by 58 days and proposal acceptance by 67 days."],
  ["1036-6|2025-08-26", "Receipt predates the customer's first recorded appointment by 53 days and proposal acceptance by 62 days."],
  ["5718-6|2026-07-23", "Generic receipt is more than eight months after the customer's completed November 2025 job."],
]);

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await queryFactory().range(
      page * pageSize,
      page * pageSize + pageSize - 1,
    );
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Pagination exceeded 100,000 rows.");
}

const env = {
  ...parseEnvFile(
    path.resolve(repoRoot, "../Ottawa Painters App/.env.local"),
  ),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase credentials.");
}
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF) {
  throw new Error("Refusing correction for an unexpected Supabase project.");
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const invoices = await fetchAll(() =>
  db
    .from("material_invoices")
    .select("id,invoice_number,invoice_date,po_number,total_amount")
    .in(
      "invoice_number",
      [...targets.keys()].map((key) => key.split("|")[0]),
    ),
);
const matchingInvoices = invoices.filter((invoice) =>
  targets.has(`${invoice.invoice_number}|${invoice.invoice_date}`),
);
if (matchingInvoices.length !== targets.size) {
  throw new Error(
    `Expected ${targets.size} target invoices, found ${matchingInvoices.length}.`,
  );
}
for (const invoice of matchingInvoices) {
  if (invoice.po_number !== "SCOTT") {
    throw new Error(
      `Invoice ${invoice.invoice_number} no longer has the audited PO SCOTT.`,
    );
  }
}

const invoiceIds = matchingInvoices.map((invoice) => invoice.id);
const lines = await fetchAll(() =>
  db
    .from("material_invoice_lines")
    .select("id,material_invoice_id,line_number,description,total_amount")
    .in("material_invoice_id", invoiceIds),
);
const lineIds = lines.map((line) => line.id);
const allocations = lineIds.length
  ? await fetchAll(() =>
      db
        .from("material_invoice_line_allocations")
        .select(
          "id,material_invoice_line_id,allocation_scope,companycam_project_id,allocation_method,allocated_total,reversed_at",
        )
        .in("material_invoice_line_id", lineIds)
        .is("reversed_at", null),
    )
  : [];
const targetAllocations = allocations.filter(
  (allocation) =>
    allocation.allocation_scope === "job" &&
    allocation.companycam_project_id === TARGET_PROJECT_ID,
);
const unexpectedAllocations = allocations.filter(
  (allocation) => !targetAllocations.includes(allocation),
);
if (unexpectedAllocations.length) {
  throw new Error(
    `Target receipts have ${unexpectedAllocations.length} unexpected active allocations.`,
  );
}

const lineById = new Map(lines.map((line) => [line.id, line]));
const invoiceById = new Map(matchingInvoices.map((invoice) => [invoice.id, invoice]));
const planned = targetAllocations.map((allocation) => {
  const line = lineById.get(allocation.material_invoice_line_id);
  const invoice = invoiceById.get(line?.material_invoice_id);
  const key = `${invoice?.invoice_number}|${invoice?.invoice_date}`;
  return {
    allocation_id: allocation.id,
    invoice_number: invoice?.invoice_number,
    invoice_date: invoice?.invoice_date,
    line_number: line?.line_number,
    description: line?.description,
    allocated_total: Number(allocation.allocated_total),
    previous_project_id: allocation.companycam_project_id,
    reason: targets.get(key),
  };
});

console.log(
  JSON.stringify(
    {
      mode: apply ? "apply" : "dry-run",
      target_invoices: matchingInvoices.length,
      active_allocations_to_reverse: planned.length,
      amount_removed_from_wrong_job: planned.reduce(
        (sum, row) => sum + row.allocated_total,
        0,
      ),
      planned,
    },
    null,
    2,
  ),
);

if (!apply || !targetAllocations.length) process.exit(0);

const reversedAt = new Date().toISOString();
for (const allocation of targetAllocations) {
  const line = lineById.get(allocation.material_invoice_line_id);
  const invoice = invoiceById.get(line.material_invoice_id);
  const key = `${invoice.invoice_number}|${invoice.invoice_date}`;
  const result = await db
    .from("material_invoice_line_allocations")
    .update({
      reversed_at: reversedAt,
      reversal_reason: `Correct false customer match for purchaser-name PO SCOTT. ${targets.get(key)} Gmail evidence: Scott Maxwell appointment 199f7cb2f629693b; proposal acceptance 19a232558daaa27a.`,
    })
    .eq("id", allocation.id)
    .is("reversed_at", null);
  if (result.error) throw result.error;
}

console.log(
  JSON.stringify({ applied: true, reversed_allocations: targetAllocations.length }),
);
