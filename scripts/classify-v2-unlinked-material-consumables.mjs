#!/usr/bin/env node

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

const env = {
  ...envFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")),
  ...envFile(path.join(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const TARGETS = new Map([
  ["1388bf85-7c6f-56b2-b060-a549b3869235", "4692-5"],
  ["304b31db-3932-5263-b15a-dee1c0c59441", "OR018443"],
  ["362a0ee5-a839-5b88-acd7-0494835b5132", "5758-0"],
  ["3a3e0020-89fb-5c22-a55b-f49a0288bd5d", "0598-6"],
  ["4f4149b4-8250-53c2-82e2-46349e37224c", "2977-0"],
  ["6fdb3b5e-fc3e-5516-99b3-9e9d21086f1b", "1036-6"],
  ["74f32156-8d94-5916-9308-f8cf41f03342", "7079-00061-46435"],
  ["765da33e-5853-5164-a290-c7a7e309e1bb", "6481-7"],
  ["9b7e9999-d6e7-5dac-b417-8322cd0ca28c", "3648-8"],
  ["a2daa40b-1d35-5601-8a07-13d33833f208", "3220-6"],
  ["a8116727-9295-5362-8d3d-3cff524df815", "OR017881"],
  ["a928536e-d5d5-5c08-b704-ac1c38d8d714", "3621-5"],
  ["b245c053-c2cd-5449-a077-8646861811a5", "7392-0"],
  ["bc47dc15-a561-5914-9619-367e71d467ea", "8817-1"],
  ["cc569974-f585-5924-82ba-56ccf533cf0b", "8128-6"],
  ["f1eba349-3f1e-543d-bacf-ee8dfc7c801d", "0262-9"],
  ["fc1ba667-9abf-53d8-934d-e34ea2d94d2b", "5718-6"],
]);

const { data: invoices, error } = await db.from("invoices")
  .select("id,invoice_number,category,subtotal_cents,status,metadata,contact:contacts(name),lines:invoice_lines(*),job_allocations:invoice_job_allocations(*)")
  .in("id", [...TARGETS.keys()]);
if (error) throw error;
if (invoices.length !== TARGETS.size) throw new Error(`Expected ${TARGETS.size} invoices, found ${invoices.length}.`);

const lineUpdates = [];
for (const invoice of invoices) {
  if (invoice.invoice_number !== TARGETS.get(invoice.id) || invoice.category !== "material" || invoice.lines.length === 0) throw new Error(`Invoice precondition changed for ${invoice.id}.`);
  if ((invoice.job_allocations ?? []).some((row) => !row.metadata?.reversed_at)) throw new Error(`Invoice ${invoice.invoice_number} gained a job allocation; stopping.`);
  const lineSubtotal = invoice.lines.reduce((sum, line) => sum + Number(line.subtotal_cents), 0);
  if (Math.abs(lineSubtotal - Number(invoice.subtotal_cents)) > 2) throw new Error(`Line arithmetic changed for ${invoice.invoice_number}.`);
  const projectMatch = invoice.metadata?.source_payload?.project_match;
  if (projectMatch?.kind === "job") throw new Error(`Invoice ${invoice.invoice_number} has a job match and must not be classified as general supplies.`);
  for (const line of invoice.lines) {
    if ((line.metadata?.overhead_allocations ?? []).some((row) => !row.reversed_at) || line.metadata?.non_job_classification?.status === "confirmed") {
      throw new Error(`Line ${line.id} already has an explicit non-job classification.`);
    }
    const safetyEquipment = /goggles|resp(?:irator)?|n95/i.test(line.description);
    lineUpdates.push({
      invoice,
      line,
      category: safetyEquipment ? "Safety equipment" : "General paint supplies",
      reason: safetyEquipment
        ? "The archived supplier line is safety/PPE and has no supported customer-job identity."
        : "The archived paint/material line has no exact customer, address, or proposal identity, so it remains outside job-specific material cost.",
    });
  }
}

const preview = {
  invoice_count: invoices.length,
  line_count: lineUpdates.length,
  subtotal_cents: lineUpdates.reduce((sum, row) => sum + Number(row.line.subtotal_cents), 0),
  categories: Object.entries(Object.groupBy(lineUpdates, (row) => row.category)).map(([category, rows]) => ({
    category,
    line_count: rows.length,
    subtotal_cents: rows.reduce((sum, row) => sum + Number(row.line.subtotal_cents), 0),
  })),
  invoices: invoices.map((invoice) => ({
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    supplier: invoice.contact?.name,
    subtotal_cents: invoice.subtotal_cents,
    po_number: invoice.metadata?.po_number ?? null,
    project_match: invoice.metadata?.source_payload?.project_match ?? null,
  })).sort((a, b) => a.invoice_number.localeCompare(b.invoice_number)),
};
if (!APPLY) {
  console.log(JSON.stringify({ mode: "dry-run", ...preview }, null, 2));
  process.exit(0);
}

for (const { invoice, line, category, reason } of lineUpdates) {
  const update = await db.from("invoice_lines").update({
    metadata: {
      ...(line.metadata ?? {}),
      non_job_classification: {
        status: "confirmed",
        category,
        allocated_subtotal_cents: Number(line.subtotal_cents),
        reason,
        classification_rule: "material_consumables_without_exact_job_evidence",
        invoice_po_number: invoice.metadata?.po_number ?? null,
        classified_at: now,
      },
    },
    updated_at: now,
  }).eq("id", line.id);
  if (update.error) throw update.error;
}
for (const invoice of invoices) {
  const categories = [...new Set(lineUpdates.filter((row) => row.invoice.id === invoice.id).map((row) => row.category))];
  const update = await db.from("invoices").update({
    metadata: {
      ...(invoice.metadata ?? {}),
      job_costing_classification: {
        status: "explicit_non_job_material",
        categories,
        reason: "No exact customer, address, or proposal identity exists in the archived supplier evidence; no job cost was invented.",
        classified_at: now,
      },
    },
    updated_at: now,
  }).eq("id", invoice.id);
  if (update.error) throw update.error;
}

const { data: verified, error: verifyError } = await db.from("invoice_lines").select("id,subtotal_cents,metadata").in("id", lineUpdates.map((row) => row.line.id));
if (verifyError) throw verifyError;
if (verified.length !== lineUpdates.length) throw new Error("Line verification count failed.");
for (const expected of lineUpdates) {
  const line = verified.find((row) => row.id === expected.line.id);
  if (line?.metadata?.non_job_classification?.status !== "confirmed" || line.metadata.non_job_classification.category !== expected.category || Number(line.metadata.non_job_classification.allocated_subtotal_cents) !== Number(expected.line.subtotal_cents)) {
    throw new Error(`Line verification failed for ${expected.line.id}.`);
  }
}

console.log(JSON.stringify({ mode: "applied", ...preview }, null, 2));
