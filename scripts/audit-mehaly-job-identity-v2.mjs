#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const PROPOSAL_IDS = ["2846697", "2959424"];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function envFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(readFileSync(filePath, "utf8").split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      return [line.slice(0, separator).trim(), value];
    }));
}

function one(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

const env = {
  ...envFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...envFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const quoteResult = await db.from("quotes")
  .select("id,dripjobs_proposal_id,name,status,amount_cents,tax_cents,metadata,created_at,updated_at")
  .in("dripjobs_proposal_id", PROPOSAL_IDS);
if (quoteResult.error) throw quoteResult.error;
const quotes = quoteResult.data ?? [];
const quoteIds = quotes.map((row) => row.id);

const jobResult = await db.from("jobs")
  .select("id,accepted_quote_id,name,status,contract_amount_cents,scheduled_on,started_on,completed_on,formatted_address,is_feed_visible,source,metadata,created_at,updated_at,contact:contacts(id,name,email)")
  .in("accepted_quote_id", quoteIds);
if (jobResult.error) throw jobResult.error;
const jobs = jobResult.data ?? [];
const jobIds = jobs.map((row) => row.id);

const [budgetResult, allocationResult] = await Promise.all([
  db.from("job_budgets")
    .select("id,job_id,status,version,amount_including_tax_cents,budget_minutes,hourly_rate_cents,source,notes,metadata,created_at,updated_at")
    .in("job_id", jobIds)
    .order("version", { ascending: false }),
  db.from("invoice_job_allocations")
    .select("id,invoice_id,invoice_line_id,job_id,subtotal_cents,tax_cents,total_cents,needs_review,confidence,allocation_method,metadata,created_at,updated_at,line:invoice_lines(id,line_number,description,subtotal_cents,tax_cents,total_cents,metadata),invoice:invoices(id,invoice_number,issued_on,due_on,category,direction,status,source_system,external_id,subtotal_cents,tax_cents,total_cents,paid_cents,balance_cents,metadata,contact:contacts(name))")
    .in("job_id", jobIds),
]);
for (const [label, result] of Object.entries({ budgetResult, allocationResult })) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

const quoteById = new Map(quotes.map((row) => [row.id, row]));
const budgetsByJob = Map.groupBy(budgetResult.data ?? [], (row) => row.job_id);
const allocationsByJob = Map.groupBy(allocationResult.data ?? [], (row) => row.job_id);

const result = jobs.map((job) => {
  const quote = quoteById.get(job.accepted_quote_id);
  const allocations = (allocationsByJob.get(job.id) ?? []).filter((row) => !row.metadata?.reversed_at);
  return {
    proposal_id: quote.dripjobs_proposal_id,
    quote: {
      id: quote.id,
      name: quote.name,
      status: quote.status,
      amount_cents: quote.amount_cents,
      tax_cents: quote.tax_cents,
      metadata: quote.metadata,
    },
    job: {
      id: job.id,
      name: job.name,
      status: job.status,
      visible: job.is_feed_visible,
      contract_amount_cents: job.contract_amount_cents,
      scheduled_on: job.scheduled_on,
      started_on: job.started_on,
      completed_on: job.completed_on,
      address: job.formatted_address,
      contact: one(job.contact),
      source: job.source,
      metadata: job.metadata,
    },
    budgets: budgetsByJob.get(job.id) ?? [],
    current_invoice_allocations: allocations.map((allocation) => ({
      id: allocation.id,
      subtotal_cents: allocation.subtotal_cents,
      tax_cents: allocation.tax_cents,
      total_cents: allocation.total_cents,
      needs_review: allocation.needs_review,
      confidence: allocation.confidence,
      allocation_method: allocation.allocation_method,
      metadata: allocation.metadata,
      line: one(allocation.line),
      invoice: one(allocation.invoice),
    })),
  };
}).sort((left, right) => left.proposal_id.localeCompare(right.proposal_id));

if (process.argv.includes("--summary")) {
  const summary = result.map((row) => {
    const invoicesWithLineAllocations = new Set(row.current_invoice_allocations
      .filter((allocation) => allocation.line?.id)
      .map((allocation) => allocation.invoice.id));
    const financialAllocations = row.current_invoice_allocations.filter((allocation) =>
      allocation.line?.id || !invoicesWithLineAllocations.has(allocation.invoice.id));
    const invoices = [...Map.groupBy(financialAllocations, (allocation) => allocation.invoice.id)]
      .map(([, allocations]) => ({
        invoice_id: allocations[0].invoice.id,
        invoice_number: allocations[0].invoice.invoice_number,
        supplier_or_customer: one(allocations[0].invoice.contact)?.name ?? null,
        category: allocations[0].invoice.category,
        issued_on: allocations[0].invoice.issued_on,
        status: allocations[0].invoice.status,
        allocated_before_hst_cents: allocations.reduce((sum, allocation) => sum + Number(allocation.subtotal_cents ?? 0), 0),
        allocation_rows: allocations.map((allocation) => ({
          allocation_id: allocation.id,
          line_id: allocation.line?.id ?? null,
          description: allocation.line?.description ?? null,
          before_hst_cents: allocation.subtotal_cents,
          method: allocation.allocation_method,
          needs_review: allocation.needs_review,
        })),
      }))
      .sort((left, right) => (left.issued_on ?? "").localeCompare(right.issued_on ?? "") || left.invoice_number.localeCompare(right.invoice_number, "en-CA", { numeric: true }));
    return {
      proposal_id: row.proposal_id,
      customer_invoice: row.quote.metadata?.invoice_id ?? null,
      job_id: row.job.id,
      job_name: row.job.name,
      job_status: row.job.status,
      contract_gross_cents: row.job.contract_amount_cents,
      scheduled_on: row.job.scheduled_on,
      started_on: row.job.started_on,
      completed_on: row.job.completed_on,
      source_job_schedule_date: row.quote.metadata?.source_payload?.["Job Schedule Date"] ?? null,
      source_job_start_date: row.quote.metadata?.source_payload?.["Job Start Date"] ?? null,
      source_job_completion_date: row.quote.metadata?.source_payload?.["Job Completion Date"] ?? null,
      current_budget: row.budgets.find((budget) => ["active", "closed"].includes(budget.status)) ?? null,
      invoices,
      labour_before_hst_cents: invoices.filter((invoice) => invoice.category === "labour").reduce((sum, invoice) => sum + invoice.allocated_before_hst_cents, 0),
      material_before_hst_cents: invoices.filter((invoice) => invoice.category === "material").reduce((sum, invoice) => sum + invoice.allocated_before_hst_cents, 0),
    };
  });
  console.log(JSON.stringify({ jobs: summary }, null, 2));
} else {
  console.log(JSON.stringify({ proposal_ids: PROPOSAL_IDS, jobs: result }, null, 2));
}
