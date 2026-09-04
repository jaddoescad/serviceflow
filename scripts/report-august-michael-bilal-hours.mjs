#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");

const jobs = [
  ["Amal Malik", "2e473c02-16fe-58a7-8675-5b5b00a93ae6"],
  ["Carina Stark", "5c68f2f5-68b9-5606-8c97-0ff0eb4b07eb"],
  ["Darya Rafi", "7b11cfde-5772-5682-a09f-2061255fa01a"],
  ["Erin Zuber", "b66f4fa0-d463-5c6e-8442-e40a75122327"],
  ["Herkirt Dhillon", "54efc97f-ae24-556c-9fef-c280849204d8"],
  ["Irene Roberts", "984741d2-5587-50a6-9bb1-9158b52c3216"],
  ["Katharina Keet", "19a09c1e-bdc2-5f32-ad3f-67c4b2b3242d"],
  ["Kim Kim", "7100e6e5-1667-5b1b-a986-9487145c58d1"],
  ["Lesley Lesley", "bd28a7cb-d6a7-5467-960c-966696416d09"],
  ["Mehaly Marinakis", "f34caa2c-4b8f-5600-9642-abc7f228ab50"],
  ["Mehaly Marinakis (2959424)", "ec24398b-3137-5b77-b59a-6497cd648aa9"],
  ["Paul Toonders", "3955bafb-4b27-5d9b-a7df-5db84d087341"],
  ["Phil Anido", "fa9d5e0b-4192-5251-8d16-5d7d7dd0ac16"],
  ["Sherrie Egan", "b0bc0dba-9412-50de-afb8-d26899e4330f"],
  ["Shezara Ali", "f0cd9e9f-f153-5bae-a68f-4b940e99fbee"],
  ["Sue Deluney", "7b0d9ef0-c0b7-507a-b74d-4fe1bd7c6eb7"],
  ["Tasha Thornton", "76f23ac5-0a28-5268-9175-672cec8d1716"],
  ["Wardah Vacher", "4cb883f3-58e6-5fa0-861a-05680f692bd3"],
];
const costing = {
  "2e473c02-16fe-58a7-8675-5b5b00a93ae6": [34000, 14250, ["Bilal Akkacha"]],
  "5c68f2f5-68b9-5606-8c97-0ff0eb4b07eb": [543900, 231000, ["Michael Matambo", "Bilal Akkacha"]],
  "7b11cfde-5772-5682-a09f-2061255fa01a": [511400, 87000, ["Michael Matambo"]],
  "b66f4fa0-d463-5c6e-8442-e40a75122327": [353600, 54000, ["Michael Matambo"]],
  "54efc97f-ae24-556c-9fef-c280849204d8": [234000, 72000, ["Michael Matambo", "Bilal Akkacha"]],
  "984741d2-5587-50a6-9bb1-9158b52c3216": [195701, 90750, ["Michael Matambo", "Bilal Akkacha"]],
  "19a09c1e-bdc2-5f32-ad3f-67c4b2b3242d": [117000, 15000, ["Michael Matambo"]],
  "7100e6e5-1667-5b1b-a986-9487145c58d1": [176200, 72000, ["Michael Matambo", "Bilal Akkacha"]],
  "bd28a7cb-d6a7-5467-960c-966696416d09": [265000, 66000, ["Michael Matambo"]],
  "f34caa2c-4b8f-5600-9642-abc7f228ab50": [164300, 57000, ["Michael Matambo"]],
  "ec24398b-3137-5b77-b59a-6497cd648aa9": [57568, 21000, ["Michael Matambo"]],
  "3955bafb-4b27-5d9b-a7df-5db84d087341": [245500, 82500, ["Michael Matambo", "Bilal Akkacha"]],
  "fa9d5e0b-4192-5251-8d16-5d7d7dd0ac16": [331000, 144781, ["Michael Matambo", "Bilal Akkacha"]],
  "b0bc0dba-9412-50de-afb8-d26899e4330f": [399000, 166600, ["Michael Matambo", "U&V Painting"]],
  "f0cd9e9f-f153-5bae-a68f-4b940e99fbee": [85500, 35250, ["Bilal Akkacha"]],
  "7b0d9ef0-c0b7-507a-b74d-4fe1bd7c6eb7": [333200, 130500, ["Michael Matambo", "Bilal Akkacha"]],
  "76f23ac5-0a28-5268-9175-672cec8d1716": [79500, 36745, ["Michael Matambo"]],
  "4cb883f3-58e6-5fa0-861a-05680f692bd3": [445000, 63000, ["Michael Matambo"]],
};
const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
if (process.argv.includes("--delete-katharina-jad")) {
  const jobId = "19a09c1e-bdc2-5f32-ad3f-67c4b2b3242d";
  const employeeId = "97b8cd3f-ec14-418b-81e5-837a64be906e";
  const { data: candidates, error: readError } = await db.from("time_entries").select("*").eq("job_id", jobId).eq("employee_id", employeeId);
  if (readError) throw readError;
  const ended = (candidates ?? []).filter((row) => row.ended_at);
  const minutes = ended.reduce((sum, row) => sum + (new Date(row.ended_at) - new Date(row.started_at)) / 60000, 0);
  const summary = { jobId, employeeId, rows: candidates?.length ?? 0, minutes, ids: (candidates ?? []).map((row) => row.id), statuses: (candidates ?? []).map((row) => row.status) };
  if (!process.argv.includes("--apply")) {
    console.log(JSON.stringify({ mode: "dry-run", ...summary }, null, 2));
    process.exit(0);
  }
  if ((candidates?.length ?? 0) !== 7 || minutes < 28 || minutes > 30) throw new Error(`Unexpected candidate set: ${JSON.stringify(summary)}`);
  const { data: deleted, error: deleteError } = await db.from("time_entries").delete().in("id", summary.ids).select("id");
  if (deleteError) throw deleteError;
  const { data: remaining, error: verifyError } = await db.from("time_entries").select("id").eq("job_id", jobId).eq("employee_id", employeeId);
  if (verifyError) throw verifyError;
  console.log(JSON.stringify({ mode: "apply", ...summary, deleted: deleted?.length ?? 0, remaining: remaining?.length ?? 0 }, null, 2));
  process.exit(0);
}
if (process.argv.includes("--xdesign-august")) {
  const contactId = "ac2a71c8-5082-5bad-af43-d785ed98b30a";
  const { data: invoices, error } = await db
    .from("invoices")
    .select("*,lines:invoice_lines(*),payments:transaction_allocations!transaction_allocations_invoice_id_fkey(*)")
    .eq("contact_id", contactId)
    .eq("category", "labour")
    .gte("issued_on", "2026-08-01")
    .lte("issued_on", "2026-08-31")
    .order("issued_on")
    .order("invoice_number");
  if (error) throw error;
  console.log(JSON.stringify((invoices ?? []).map((invoice) => ({
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    issued_on: invoice.issued_on,
    status: invoice.status,
    subtotal_cents: invoice.subtotal_cents,
    tax_cents: invoice.tax_cents,
    total_cents: invoice.total_cents,
    paid_cents: invoice.paid_cents,
    balance_cents: invoice.balance_cents,
    source_system: invoice.source_system,
    document_type: invoice.metadata?.document_type,
    match_status: invoice.metadata?.match_status,
    settlement_status: invoice.metadata?.settlement?.status,
    dispatch_status: invoice.metadata?.payment_dispatch?.status,
    lines: (invoice.lines ?? []).map((line) => ({
      description: line.description,
      subtotal_cents: line.subtotal_cents,
      tax_cents: line.tax_cents,
      total_cents: line.total_cents,
      entry_type: line.metadata?.entry_type,
      printed_hours: line.metadata?.printed_hours,
      hourly_rate_cents: line.metadata?.hourly_rate_cents,
    })),
    active_payment_cents: (invoice.payments ?? []).filter((payment) => !payment.reversed_at).reduce((sum, payment) => sum + Number(payment.amount_cents ?? 0), 0),
  })), null, 2));
  process.exit(0);
}
if (process.argv.includes("--lesley-evidence")) {
  const jobId = "bd28a7cb-d6a7-5467-960c-966696416d09";
  const { data: allocations, error: allocationError } = await db.from("invoice_job_allocations").select("*,invoice:invoices(*),line:invoice_lines(*)").eq("job_id", jobId);
  if (allocationError) throw allocationError;
  console.log(JSON.stringify(allocations, null, 2));
  process.exit(0);
}
if (process.argv.includes("--search-grutenco")) {
  const [{ data: contacts, error: contactError }, { data: allInvoices, error: invoiceError }, { data: allLines, error: lineError }] = await Promise.all([
    db.from("contacts").select("*"),
    db.from("invoices").select("*"),
    db.from("invoice_lines").select("*"),
  ]);
  if (contactError) throw contactError;
  if (invoiceError) throw invoiceError;
  if (lineError) throw lineError;
  const grutencoContacts = (contacts ?? []).filter((row) => JSON.stringify(row).toLowerCase().includes("grutenco"));
  const contactIds = new Set(grutencoContacts.map((row) => row.id));
  const grutencoInvoices = (allInvoices ?? []).filter((row) => contactIds.has(row.supplier_contact_id) || JSON.stringify(row).toLowerCase().includes("grutenco"));
  const invoiceIds = new Set(grutencoInvoices.map((row) => row.id));
  const { data: targetedLines, error: targetedLineError } = invoiceIds.size
    ? await db.from("invoice_lines").select("*").in("invoice_id", [...invoiceIds])
    : { data: [], error: null };
  if (targetedLineError) throw targetedLineError;
  const grutencoLines = targetedLines ?? [];
  console.log(JSON.stringify({
    contacts: grutencoContacts,
    invoices: grutencoInvoices.map(({ id, invoice_number, issued_on, status, subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents, supplier_contact_id, source_data, metadata }) => ({ id, invoice_number, issued_on, status, subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents, supplier_contact_id, source_data, metadata })),
    lines: grutencoLines,
  }, null, 2));
  process.exit(0);
}
if (process.argv.includes("--mehaly-evidence")) {
  const mehalyIds = ["f34caa2c-4b8f-5600-9642-abc7f228ab50", "ec24398b-3137-5b77-b59a-6497cd648aa9"];
  const { data: allocations, error: allocationError } = await db.from("invoice_job_allocations").select("*").in("job_id", mehalyIds);
  if (allocationError) throw allocationError;
  const lineIds = [...new Set((allocations ?? []).map((row) => row.invoice_line_id).filter(Boolean))];
  const invoiceIdsFromAllocations = [...new Set((allocations ?? []).map((row) => row.invoice_id).filter(Boolean))];
  const { data: lines, error: lineError } = lineIds.length
    ? await db.from("invoice_lines").select("*").in("id", lineIds)
    : { data: [], error: null };
  if (lineError) throw lineError;
  const invoiceIds = [...new Set([...invoiceIdsFromAllocations, ...(lines ?? []).map((row) => row.invoice_id).filter(Boolean)])];
  const { data: invoices, error: invoiceError } = invoiceIds.length
    ? await db.from("invoices").select("*").in("id", invoiceIds)
    : { data: [], error: null };
  if (invoiceError) throw invoiceError;
  const { data: transactionAllocations, error: transactionAllocationError } = invoiceIds.length
    ? await db.from("transaction_allocations").select("*").in("invoice_id", invoiceIds)
    : { data: [], error: null };
  if (transactionAllocationError) throw transactionAllocationError;
  const transactionIds = [...new Set((transactionAllocations ?? []).map((row) => row.transaction_id).filter(Boolean))];
  const { data: transactions, error: transactionError } = transactionIds.length
    ? await db.from("transactions").select("*").in("id", transactionIds)
    : { data: [], error: null };
  if (transactionError) throw transactionError;
  console.log(JSON.stringify({
    allocations: (allocations ?? []).map(({ id, job_id, invoice_id, invoice_line_id, amount_cents, allocated_amount_cents, status, created_at }) => ({ id, job_id, invoice_id, invoice_line_id, amount_cents, allocated_amount_cents, status, created_at })),
    lines: (lines ?? []).map(({ id, invoice_id, description, service_date, quantity, unit_price_cents, amount_before_tax_cents, subtotal_cents, line_total_cents, total_cents }) => ({ id, invoice_id, description, service_date, quantity, unit_price_cents, amount_before_tax_cents, subtotal_cents, line_total_cents, total_cents })),
    invoices: (invoices ?? []).map(({ id, invoice_number, invoice_date, issued_on, document_date, due_date, period_start, period_end, status, subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents, paid_at, supplier_contact_id, payment_status }) => ({ id, invoice_number, invoice_date, issued_on, document_date, due_date, period_start, period_end, status, subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents, paid_at, supplier_contact_id, payment_status })),
    transactionAllocations: (transactionAllocations ?? []).map(({ invoice_id, transaction_id, amount_cents, allocated_amount_cents, status, created_at }) => ({ invoice_id, transaction_id, amount_cents, allocated_amount_cents, status, created_at })),
    transactions: (transactions ?? []).map(({ id, transaction_date, posted_date, occurred_on, occurred_at, transacted_at, settled_at, amount_cents, description, status, source, metadata, created_at }) => ({ id, transaction_date, posted_date, occurred_on, occurred_at, transacted_at, settled_at, amount_cents, description, status, source, metadata, created_at })),
  }, null, 2));
  process.exit(0);
}
const [{ data, error }, { data: jobRows, error: jobError }, { data: budgetRows, error: budgetError }] = await Promise.all([
  db.from("time_entries").select("*").in("job_id", jobs.map(([, id]) => id)).order("started_at"),
  db.from("jobs").select("*").in("id", jobs.map(([, id]) => id)),
  db.from("job_budgets").select("*").in("job_id", jobs.map(([, id]) => id)),
]);
if (error) throw error;
if (jobError) throw jobError;
if (budgetError) throw budgetError;

const jobById = new Map((jobRows ?? []).map((row) => [row.id, row]));
const budgetsByJob = Object.groupBy(budgetRows ?? [], (row) => row.job_id);

const byJob = new Map(jobs.map(([name, id]) => [id, { name, id, entries: [] }]));
for (const row of data ?? []) byJob.get(row.job_id)?.entries.push(row);
const result = [...byJob.values()].map((job) => {
  const entries = job.entries.filter((row) => row.status !== "deleted" && row.ended_at).map((row) => ({
    id: row.id,
    employee_id: row.employee_id,
    employee_name: row.employee_name,
    started_at: row.started_at,
    ended_at: row.ended_at,
    status: row.status,
    hours: row.ended_at ? (new Date(row.ended_at) - new Date(row.started_at)) / 3_600_000 : null,
    notes: row.notes,
  }));
  const [revenueCents, invoiceLabourCents, invoicedPainters] = costing[job.id];
  const hoursByPainter = Object.groupBy(entries, (entry) => entry.employee_name ?? "Unknown");
  const painterHours = Object.fromEntries(Object.entries(hoursByPainter).map(([name, rows]) => [name, rows.reduce((sum, row) => sum + row.hours, 0)]));
  const totalHours = Object.values(painterHours).reduce((sum, hours) => sum + hours, 0);
  const missingInvoicePainters = Object.keys(painterHours).filter((name) => !invoicedPainters.includes(name));
  return {
    name: job.name,
    job_record: jobById.get(job.id),
    budget_records: budgetsByJob[job.id] ?? [],
    revenue: revenueCents / 100,
    invoice_labour: invoiceLabourCents / 100,
    invoice_labour_percent: invoiceLabourCents / revenueCents * 100,
    painter_hours: painterHours,
    total_hours: totalHours,
    labour_at_30: totalHours * 30,
    labour_percent_at_30: totalHours * 3000 / revenueCents * 100,
    missing_invoice_painters: missingInvoicePainters,
    status: missingInvoicePainters.length ? "Incomplete — please check" : "Complete from recorded evidence",
  };
}).sort((a, b) => a.invoice_labour_percent - b.invoice_labour_percent);
console.log(JSON.stringify(result, null, 2));
