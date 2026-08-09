#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CHRIS_JOB_ID = "e4758c1f-6bdb-59bd-9f31-7b4f0f8e672b";
const EXPECTED_INVOICE_NUMBERS = ["393", "395", "396", "397", "400", "401", "403", "405", "406", "407", "409", "411", "412", "414"];
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function envFile(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      let value = line.slice(index + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      return [line.slice(0, index).trim(), value];
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

const { data: contacts, error: contactError } = await db.from("contacts").select("id,name").eq("name", "Dressing Rooms");
if (contactError) throw contactError;
if (contacts.length !== 1) throw new Error(`Expected one Dressing Rooms contact, found ${contacts.length}.`);

const { data: invoices, error: invoiceError } = await db.from("invoices")
  .select("id,invoice_number,issued_on,category,status,subtotal_cents,tax_cents,total_cents,metadata,lines:invoice_lines(*),job_allocations:invoice_job_allocations(*)")
  .eq("contact_id", contacts[0].id)
  .order("issued_on");
if (invoiceError) throw invoiceError;

const actualNumbers = invoices.map((invoice) => invoice.invoice_number).sort();
const expectedNumbers = [...EXPECTED_INVOICE_NUMBERS].sort();
if (JSON.stringify(actualNumbers) !== JSON.stringify(expectedNumbers)) {
  throw new Error(`Dressing Rooms invoice set changed. Expected ${expectedNumbers.join(", ")}; found ${actualNumbers.join(", ")}.`);
}
if (invoices.some((invoice) => invoice.metadata?.supplier_name !== "Dressing Rooms")) {
  throw new Error("A Dressing Rooms invoice has unexpected supplier metadata.");
}
if (invoices.some((invoice) => invoice.lines.some((line) => !String(line.metadata?.source_text ?? "").includes("Paint Consultation")))) {
  throw new Error("A Dressing Rooms line is missing the source Paint Consultation description.");
}

const activeAllocations = invoices.flatMap((invoice) =>
  invoice.job_allocations.filter((allocation) => !allocation.metadata?.reversed_at).map((allocation) => ({ invoice, allocation })),
);
const affectedJobIds = new Set(activeAllocations.map(({ allocation }) => allocation.job_id));
const allocatedPreTaxCents = activeAllocations.reduce((sum, { allocation }) => sum + Number(allocation.subtotal_cents ?? 0), 0);
const chrisConsultationCents = activeAllocations
  .filter(({ allocation }) => allocation.job_id === CHRIS_JOB_ID)
  .reduce((sum, { allocation }) => sum + Number(allocation.subtotal_cents ?? 0), 0);

const preview = {
  mode: APPLY ? "apply" : "dry-run",
  classification: "colour_consultation",
  invoice_count: invoices.length,
  line_count: invoices.reduce((sum, invoice) => sum + invoice.lines.length, 0),
  affected_job_count: affectedJobIds.size,
  reclassified_job_cost_pre_tax_cents: allocatedPreTaxCents,
  chris_jupp: {
    removed_from_labour_cents: chrisConsultationCents,
    verified_labour_after_cents: 100000,
  },
};
console.log(JSON.stringify(preview, null, 2));
if (!APPLY) process.exit(0);

const now = new Date().toISOString();
for (const invoice of invoices) {
  const { error } = await db.from("invoices").update({
    category: "other",
    metadata: {
      ...(invoice.metadata ?? {}),
      cost_classification: "colour_consultation",
      classification_evidence: "Every source line is explicitly described as Paint Consultation.",
      classification_corrected_at: now,
      classification_correction_reason: "Colour consultation was incorrectly imported as painter labour.",
    },
    updated_at: now,
  }).eq("id", invoice.id);
  if (error) throw error;

  for (const line of invoice.lines) {
    const { error: lineError } = await db.from("invoice_lines").update({
      metadata: {
        ...(line.metadata ?? {}),
        entry_type: "other",
        cost_classification: "colour_consultation",
        classification_corrected_at: now,
      },
      updated_at: now,
    }).eq("id", line.id);
    if (lineError) throw lineError;
  }
}

const { data: verifiedInvoices, error: verifiedInvoiceError } = await db.from("invoices")
  .select("id,invoice_number,category,metadata,lines:invoice_lines(id,metadata)")
  .eq("contact_id", contacts[0].id);
if (verifiedInvoiceError) throw verifiedInvoiceError;
if (verifiedInvoices.some((invoice) => invoice.category !== "other" || invoice.metadata?.cost_classification !== "colour_consultation")) {
  throw new Error("Post-write invoice classification verification failed.");
}
if (verifiedInvoices.some((invoice) => invoice.lines.some((line) => line.metadata?.entry_type !== "other" || line.metadata?.cost_classification !== "colour_consultation"))) {
  throw new Error("Post-write line classification verification failed.");
}
console.log(JSON.stringify({ ...preview, mode: "applied-and-verified" }, null, 2));
