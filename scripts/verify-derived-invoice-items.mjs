#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const reportPath = path.resolve(
  repoRoot,
  "tmp/pdfs/derived-invoice-audit/audit.json",
);

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cents(value) {
  return Math.round(Number(value) * 100);
}

async function insertAuditEvent(db, event) {
  const existing = await db
    .from("labour_verification_events")
    .select("id")
    .eq("entity_type", event.entity_type)
    .eq("entity_id", event.entity_id)
    .eq("action", event.action)
    .eq("reason", event.reason)
    .limit(1);
  if (existing.error) throw existing.error;
  if ((existing.data ?? []).length) return;
  const result = await db.from("labour_verification_events").insert(event);
  if (result.error) throw result.error;
}

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

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
assert(
  projectRef === TARGET_PROJECT_REF,
  `Refusing to use unexpected Supabase project ${projectRef}.`,
);
assert(existsSync(reportPath), "Run audit-derived-invoice-sources.mjs first.");

const report = JSON.parse(readFileSync(reportPath, "utf8"));
assert(
  report.project_ref === TARGET_PROJECT_REF,
  "The source audit belongs to a different Supabase project.",
);

const candidates = report.audits.filter((audit) => audit.exact_candidate);
const candidateEntries = candidates.flatMap((audit) =>
  audit.entries.map((entry) => ({
    audit,
    entry,
  })),
);
assert(candidates.length > 0, "The source audit has no exact candidates.");

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const candidateIds = candidateEntries.map(({ entry }) => entry.id);
const { data: currentLines, error: currentLinesError } = await db
  .from("labour_invoice_lines")
  .select(
    "id,invoice_id,line_number,description,amount_before_tax,source_kind,source_reference,source_text,needs_review",
  )
  .in("id", candidateIds);
if (currentLinesError) throw currentLinesError;

const currentById = new Map(
  (currentLines ?? []).map((line) => [line.id, line]),
);
assert(
  currentById.size === candidateIds.length,
  "One or more audited invoice entries no longer exist.",
);

const desiredLines = [];
for (const { audit, entry } of candidateEntries) {
  const current = currentById.get(entry.id);
  assert(
    current.invoice_id === audit.invoice.id,
    `Invoice changed for entry ${entry.id}.`,
  );
  assert(
    current.line_number === entry.line_number,
    `Line number changed for entry ${entry.id}.`,
  );
  assert(
    cents(current.amount_before_tax) === cents(entry.amount_before_tax),
    `Amount changed for entry ${entry.id}.`,
  );
  assert(
    current.source_kind === "legacy_project_link" ||
      current.source_kind === "extracted",
    `Unexpected source kind for entry ${entry.id}.`,
  );

  const evidenceParts = [
    `Verified directly against ${audit.invoice.original_filename}`,
    `printed amount $${Number(entry.amount_before_tax).toFixed(2)}`,
  ];
  if (entry.matched_phrases.length) {
    evidenceParts.push(
      `printed identity ${entry.matched_phrases.slice(0, 2).join(" / ")}`,
    );
  }
  if (entry.source_excerpt) {
    evidenceParts.push(entry.source_excerpt.replace(/\s+/g, " ").trim());
  }

  desiredLines.push({
    id: entry.id,
    invoice_id: audit.invoice.id,
    values: {
      source_kind: "extracted",
      source_reference: `physical-invoice:${audit.invoice.id}:line:${entry.line_number}`,
      source_text: evidenceParts.join(" · ").slice(0, 1800),
      needs_review: false,
    },
  });
}

const dryRun = {
  mode: APPLY ? "apply" : "dry-run",
  project_ref: projectRef,
  audited_invoice_count: report.invoice_count,
  exact_invoice_count: candidates.length,
  exact_entry_count: desiredLines.length,
  remaining_review_invoice_count:
    report.invoice_count - candidates.length,
  invoices: candidates.map((audit) => ({
    id: audit.invoice.id,
    supplier: audit.invoice.supplier_name,
    invoice: audit.invoice.invoice_number,
    entries: audit.entries.length,
  })),
};

if (!APPLY) {
  console.log(JSON.stringify(dryRun, null, 2));
  console.log("Dry run only. Re-run with --apply to write verified evidence.");
  process.exit(0);
}

let updatedLines = 0;
let updatedAllocations = 0;
let updatedProjectLinks = 0;

for (const desired of desiredLines) {
  const current = currentById.get(desired.id);
  const alreadyApplied =
    current.source_kind === desired.values.source_kind &&
    current.source_reference === desired.values.source_reference &&
    current.source_text === desired.values.source_text &&
    current.needs_review === desired.values.needs_review;
  if (!alreadyApplied) {
    const update = await db
      .from("labour_invoice_lines")
      .update(desired.values)
      .eq("id", desired.id)
      .eq("invoice_id", desired.invoice_id);
    if (update.error) throw update.error;
    updatedLines += 1;
  }

  const allocationUpdate = await db
    .from("labour_invoice_line_allocations")
    .update({ needs_review: false })
    .eq("invoice_line_id", desired.id)
    .eq("needs_review", true);
  if (allocationUpdate.error) throw allocationUpdate.error;
  updatedAllocations += 1;
}

for (const audit of candidates) {
  const projectUpdate = await db
    .from("labour_invoice_projects")
    .update({ needs_review: false })
    .eq("invoice_id", audit.invoice.id)
    .eq("needs_review", true);
  if (projectUpdate.error) throw projectUpdate.error;
  updatedProjectLinks += 1;

  await insertAuditEvent(db, {
    entity_type: "invoice",
    entity_id: audit.invoice.id,
    action: "update",
    old_values: {
      source_kind: "legacy_project_link",
      needs_review: true,
    },
    new_values: {
      source_kind: "extracted",
      needs_review: false,
      entry_ids: audit.entries.map((entry) => entry.id),
    },
    reason:
      `Physical source audit verified every stored item, amount, and job allocation ` +
      `for ${audit.invoice.supplier_name} invoice #${audit.invoice.invoice_number}. ` +
      `The invoice subtotal, tax, total, and item allocations all agree with ` +
      `${audit.invoice.original_filename}.`,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const { data: verifiedLines, error: verifiedLinesError } = await db
  .from("labour_invoice_lines")
  .select("id,source_kind,needs_review")
  .in("id", candidateIds);
if (verifiedLinesError) throw verifiedLinesError;
assert(
  (verifiedLines ?? []).every(
    (line) => line.source_kind === "extracted" && line.needs_review === false,
  ),
  "Post-write verification failed for one or more invoice entries.",
);

console.log(
  JSON.stringify(
    {
      ...dryRun,
      updated_lines: updatedLines,
      allocation_groups_reviewed: updatedAllocations,
      invoice_project_groups_reviewed: updatedProjectLinks,
      post_write_verified_entries: verifiedLines.length,
    },
    null,
    2,
  ),
);
