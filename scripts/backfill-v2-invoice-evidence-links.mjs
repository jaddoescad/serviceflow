#!/usr/bin/env node

import crypto from "node:crypto";
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

function uuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function migratedMaterialDocumentUuid(oldId) {
  const namespace = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
  const bytes = crypto.createHash("sha1").update(Buffer.concat([
    namespace,
    Buffer.from(`document:material:${oldId}`, "utf8"),
  ])).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

async function all(table, columns, apply = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const result = await apply(db.from(table).select(columns).order("id").range(from, from + 999));
    if (result.error) throw result.error;
    rows.push(...result.data);
    if (result.data.length < 1000) return rows;
  }
}

const [invoices, links, documents] = await Promise.all([
  all("invoices", "id,invoice_number,issued_on,total_cents,status,metadata,contact:contacts(name)"),
  all("evidence_links", "id,document_id,entity_type,entity_id,evidence_role,metadata", (query) => query.eq("entity_type", "invoice")),
  all("documents", "id,original_filename,content_sha256,mime_type,metadata"),
]);

const linkedInvoiceIds = new Set(links.map((row) => row.entity_id));
const documentById = new Map(documents.map((row) => [row.id, row]));
const candidates = [];
const missingDocuments = [];
for (const invoice of invoices) {
  const documentId = invoice.metadata?.source_document_id ?? invoice.metadata?.document_id;
  if (linkedInvoiceIds.has(invoice.id) || !documentId) continue;
  const migratedDocumentId = migratedMaterialDocumentUuid(documentId);
  const document = documentById.get(documentId) ?? documentById.get(migratedDocumentId);
  if (!document) {
    missingDocuments.push({ invoice_id: invoice.id, invoice_number: invoice.invoice_number, contact: invoice.contact?.name ?? null, document_id: documentId, migrated_document_id: migratedDocumentId });
    continue;
  }
  candidates.push({ invoice, document, legacyDocumentId: documentId === document.id ? null : documentId });
}

const preview = candidates.map(({ invoice, document }) => ({
  invoice_id: invoice.id,
  invoice_number: invoice.invoice_number,
  contact: invoice.contact?.name ?? null,
  issued_on: invoice.issued_on,
  total_cents: invoice.total_cents,
  status: invoice.status,
  document_id: document.id,
  filename: document.original_filename,
  legacy_document_id: invoice.metadata?.document_id === document.id ? null : invoice.metadata?.document_id ?? null,
}));

if (!APPLY) {
  console.log(JSON.stringify({ mode: "dry-run", count: preview.length, links: preview, missing_documents: missingDocuments }, null, 2));
  process.exit(0);
}

const rows = candidates.map(({ invoice, document }) => ({
  id: uuid(`evidence-link:${document.id}:invoice:${invoice.id}`),
  document_id: document.id,
  entity_type: "invoice",
  entity_id: invoice.id,
  evidence_role: "source_document",
  metadata: {
    backfill_reason: "The unified invoice retained its source document_id, but the v2 evidence link was missing.",
    backfilled_at: now,
  },
  created_at: now,
}));
const { error: writeError } = await db.from("evidence_links").upsert(rows, { onConflict: "id" });
if (writeError) throw writeError;

for (const { invoice, document, legacyDocumentId } of candidates) {
  if (!legacyDocumentId && invoice.metadata?.source_document_id === document.id) continue;
  const update = await db.from("invoices").update({
    metadata: {
      ...(invoice.metadata ?? {}),
      source_document_id: document.id,
      legacy_material_document_id: legacyDocumentId ?? invoice.metadata?.legacy_material_document_id ?? null,
      evidence_link_backfilled_at: now,
    },
    updated_at: now,
  }).eq("id", invoice.id);
  if (update.error) throw update.error;
}

const { data: verified, error: verifyError } = await db.from("evidence_links").select("id,document_id,entity_id,evidence_role").in("id", rows.map((row) => row.id));
if (verifyError) throw verifyError;
if (verified.length !== rows.length || verified.some((row) => row.evidence_role !== "source_document")) throw new Error("Post-write evidence verification failed.");

console.log(JSON.stringify({ mode: "applied", count: preview.length, links: preview, missing_documents: missingDocuments }, null, 2));
