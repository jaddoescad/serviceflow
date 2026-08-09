#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");
const PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const confirmedAt = new Date().toISOString();
function envFile(file) { if (!existsSync(file)) return {}; return Object.fromEntries(readFileSync(file, "utf8").split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("=")).map((line) => { const i = line.indexOf("="); let value = line.slice(i + 1).trim(); if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1); return [line.slice(0, i).trim(), value]; })); }
function assert(condition, message) { if (!condition) throw new Error(message); }
const env = { ...envFile(path.join(repoRoot, "../Ottawa Painters App/.env.local")), ...envFile(path.join(repoRoot, ".env.local")), ...process.env };
const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL; if (!url || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
if (new URL(url).hostname.split(".")[0] !== PROJECT_REF) throw new Error("Unexpected Supabase project.");
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const TRANSACTION_ID = "7fecc380-de39-4d4e-9ad9-28f78080a5e0";
const INVOICE_ID = "dc3bf16c-43da-54ff-96e9-1ed478318375";
const result = await db.from("transactions").select("id,posted_on,description,counterparty,amount_cents,category,review_status,notes,metadata,allocations:transaction_allocations(id,invoice_id,amount_cents,needs_review,reversed_at,metadata,invoice:invoices!transaction_allocations_invoice_id_fkey(id,invoice_number,total_cents,paid_cents,balance_cents))").eq("id", TRANSACTION_ID).single();
if (result.error) throw result.error;
const transaction = result.data;
const active = transaction.allocations.filter((row) => !row.reversed_at);
const allocatedCents = active.reduce((sum, row) => sum + Number(row.amount_cents), 0);
const residualCents = Math.abs(Number(transaction.amount_cents)) - allocatedCents;
const research = transaction.metadata?.reconciliation_research ?? {};

assert(transaction.posted_on === "2026-05-04" && transaction.counterparty === "Youssef Mroueh" && transaction.category === "Subcontractors", "Youssef transaction identity changed.");
assert(Number(transaction.amount_cents) === -300000 && transaction.review_status === "reconciled", "Youssef transaction amount/status changed.");
assert(active.length === 1 && active[0].invoice_id === INVOICE_ID && Number(active[0].amount_cents) === 80000 && active[0].needs_review === false, "Youssef invoice allocation changed.");
assert(active[0].invoice?.invoice_number === "4" && Number(active[0].invoice?.total_cents) === 315000, "Youssef invoice 4 identity changed.");
assert(residualCents === 220000, "Youssef no-invoice residual changed.");
assert(research.status === "partial_invoice_allocation_with_no_invoice_residual" && Number(research.no_invoice_residual) === 2200, "Youssef stored research conclusion changed.");
assert(research.evidence_conclusion === "$800.00 is allocated to the archived invoices; $2200.00 remains a documented no-invoice exception.", "Youssef evidence conclusion changed.");
assert(research.invoice_submission_message_id === "19d350724dd19e98" && research.allocation_method === "documented_fifo", "Youssef stored batch evidence changed.");

const updatedResearch = {
  ...research,
  confirmation_status: "confirmed_from_stored_invoice_batch_and_payment_inventory",
  confirmation_basis: "The archived four-invoice submission batch and all active Youssef payment allocations were already reviewed; the exact residual has no fifth invoice in the stored evidence inventory.",
  no_invoice_amount: 2200,
  no_invoice_amount_cents: 220000,
  user_confirmed: false,
  no_email_rescan: true,
  confirmed_at: confirmedAt,
};
console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", no_email_used: true, transaction_id: TRANSACTION_ID, transaction_cents: Math.abs(Number(transaction.amount_cents)), allocated_invoice_cents: allocatedCents, no_invoice_residual_cents: residualCents, invoice_id: INVOICE_ID, confirmation_status: updatedResearch.confirmation_status }, null, 2));
if (!APPLY) process.exit(0);

const update = await db.from("transactions").update({
  metadata: { ...(transaction.metadata ?? {}), reconciliation_research: updatedResearch },
  notes: "$800.00 is allocated by documented FIFO to Youssef invoice #4; the remaining $2,200.00 is an explicit no-invoice residual supported by the stored four-invoice batch and payment inventory.",
  updated_at: confirmedAt,
}).eq("id", TRANSACTION_ID).eq("review_status", "reconciled");
if (update.error) throw update.error;
const verifiedResult = await db.from("transactions").select("id,amount_cents,review_status,notes,metadata,allocations:transaction_allocations(id,invoice_id,amount_cents,reversed_at)").eq("id", TRANSACTION_ID).single();
if (verifiedResult.error) throw verifiedResult.error;
const verified = verifiedResult.data;
const verifiedAllocated = verified.allocations.filter((row) => !row.reversed_at).reduce((sum, row) => sum + Number(row.amount_cents), 0);
assert(verified.review_status === "reconciled" && Math.abs(Number(verified.amount_cents)) - verifiedAllocated === 220000, "Youssef residual verification failed.");
assert(verified.metadata?.reconciliation_research?.confirmation_status === "confirmed_from_stored_invoice_batch_and_payment_inventory" && verified.metadata?.reconciliation_research?.user_confirmed === false, "Youssef exception provenance verification failed.");
console.log(JSON.stringify({ applied: true, no_email_used: true, transaction_id: TRANSACTION_ID, allocated_invoice_cents: verifiedAllocated, no_invoice_residual_cents: 220000 }, null, 2));
