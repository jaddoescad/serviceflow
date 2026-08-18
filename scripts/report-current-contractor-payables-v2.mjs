#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { selectUsableInvoiceJobAllocations } from "../src/lib/invoice-allocation-selection.ts";
import { deriveInvoiceReadiness } from "../src/lib/invoice-readiness.ts";
import {
  isContractorInvoiceReviewRecord,
  isHistoricalLabourInvoice,
} from "../src/lib/invoice-review-visibility.ts";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const SENT_PENDING_BANK_SYNC = new Map([
  ["3e859614-a397-5670-b0ab-af0963807eb1", {
    note: "Caledonian transfer already sent by the user; EasyWeb confirmation C1AjG8***QaV. Awaiting bank-feed sync.",
  }],
]);

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) value = value.slice(1, -1);
    values[line.slice(0, separator).trim()] = value;
  }
  return values;
}

function data(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

function one(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function invoiceSummary(invoice, readiness, extra = {}) {
  return {
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    contractor: one(invoice.contact)?.name ?? "Unknown",
    issued_on: invoice.issued_on,
    remaining_cents: readiness.remainingBalanceCents,
    jobs: (invoice.allocations ?? []).map((allocation) => ({
      name: one(allocation.job)?.name ?? null,
      production_month: one(allocation.job)?.production_month ?? null,
    })),
    ...extra,
  };
}

function groupTotals(rows) {
  const totals = new Map();
  for (const row of rows) {
    totals.set(row.contractor, (totals.get(row.contractor) ?? 0) + row.remaining_cents);
  }
  return [...totals.entries()]
    .map(([contractor, amount_cents]) => ({ contractor, amount_cents }))
    .sort((a, b) => a.contractor.localeCompare(b.contractor));
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== PROJECT_REF) {
  throw new Error("Refusing report for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rawInvoices = data("invoices", await db
  .from("invoices")
  .select("*,contact:contacts(name),lines:invoice_lines(id,line_number,subtotal_cents,tax_cents,total_cents,source_kind,metadata),allocations:invoice_job_allocations(id,invoice_id,invoice_line_id,job_id,subtotal_cents,total_cents,needs_review,metadata,job:jobs(name,status,started_on,completed_on,production_month)),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(id,invoice_id,amount_cents,needs_review,reversed_at,transaction:transactions(id,posted_on,review_status))")
  .eq("direction", "payable")
  .in("category", ["labour", "other"])
  .order("issued_on", { ascending: false, nullsFirst: false })
  .limit(2000));

const invoices = rawInvoices
  .filter(isContractorInvoiceReviewRecord)
  .map((invoice) => ({
    ...invoice,
    metadata: invoice.category === "other"
      ? {
          ...(invoice.metadata ?? {}),
          job_allocation_required:
            typeof invoice.metadata?.job_allocation_required === "boolean"
              ? invoice.metadata.job_allocation_required
              : false,
        }
      : invoice.metadata,
    allocations: selectUsableInvoiceJobAllocations(invoice.allocations ?? []),
  }));

const evidenceRows = invoices.length
  ? data("evidence", await db
      .from("evidence_links")
      .select("id,entity_id,evidence_role,metadata,document:documents(id,original_filename,mime_type,storage_bucket,storage_path,source_url)")
      .eq("entity_type", "invoice")
      .in("entity_id", invoices.map((invoice) => invoice.id)))
  : [];
const evidenceByInvoice = new Map();
for (const row of evidenceRows) {
  const list = evidenceByInvoice.get(row.entity_id) ?? [];
  list.push(row);
  evidenceByInvoice.set(row.entity_id, list);
}

const readyToSend = [];
const sentPendingBankSync = [];
const hold = [];
for (const invoice of invoices) {
  const withEvidence = { ...invoice, evidence: evidenceByInvoice.get(invoice.id) ?? [] };
  if (isHistoricalLabourInvoice(withEvidence)) continue;
  const readiness = deriveInvoiceReadiness(withEvidence);
  if (readiness.paymentState !== "unpaid") continue;

  const pending = SENT_PENDING_BANK_SYNC.get(invoice.id);
  if (pending) {
    sentPendingBankSync.push(invoiceSummary(invoice, readiness, pending));
    continue;
  }

  const missingProductionMonth = readiness.allocationRequired &&
    (invoice.allocations.length === 0 || invoice.allocations.some((allocation) => !one(allocation.job)?.production_month));
  if (readiness.state === "ready_to_pay" && !missingProductionMonth) {
    readyToSend.push(invoiceSummary(invoice, readiness));
  } else {
    hold.push(invoiceSummary(invoice, readiness, {
      reason: missingProductionMonth
        ? "Linked work has no production month"
        : readiness.reason,
    }));
  }
}

const sum = (rows) => rows.reduce((total, row) => total + row.remaining_cents, 0);
console.log(JSON.stringify({
  generated_at: new Date().toISOString(),
  ready_to_send: {
    invoices: readyToSend,
    per_contractor: groupTotals(readyToSend),
    total_cents: sum(readyToSend),
  },
  sent_pending_bank_sync: {
    invoices: sentPendingBankSync,
    per_contractor: groupTotals(sentPendingBankSync),
    total_cents: sum(sentPendingBankSync),
  },
  hold: {
    invoices: hold,
    per_contractor: groupTotals(hold),
    total_cents: sum(hold),
  },
}, null, 2));
