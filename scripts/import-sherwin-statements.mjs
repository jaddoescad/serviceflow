#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sourceDir = path.resolve(
  repoRoot,
  process.env.SHERWIN_PDF_DIR ?? "tmp/material-invoices/sherwin",
);
const apply = process.argv.includes("--apply");

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

function money(value) {
  const raw = String(value ?? "").trim();
  const parsed = Number(raw.replace(/[$,()\s-]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

function isoDate(value) {
  const match = String(value ?? "").match(/(\d{2})\/(\d{2})\/(\d{4}|\d{2})/);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[1]}-${match[2]}`;
}

function statementValue(text, label) {
  const match = text.match(new RegExp(`${label}:?\\s+\\$?([\\d,.]+)-?`, "i"));
  return money(match?.[1]);
}

function parseStatement(filePath) {
  const buffer = readFileSync(filePath);
  const text = execFileSync("pdftotext", ["-layout", filePath, "-"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const asOfMatch = text.match(/TOTAL BALANCE AS OF\s+(\d{2}\/\d{2}\/\d{2})\s+([\d,.]+)/i);
  const rows = [];
  for (const line of text.split("\n")) {
    const match = line.match(
      /^\s*(\d{2}\/\d{2}\/\d{4})\s+(CHARGE|CREDIT MEMO|PAYMENT)\s+(\d+)\s+(\d+)\s+(.*)$/,
    );
    if (!match) continue;
    const amountMatches = [...match[5].matchAll(/\$([\d,.]+)(-?)/g)];
    if (!amountMatches.length) continue;
    const firstAmountIndex = match[5].indexOf(amountMatches[0][0]);
    rows.push({
      date: isoDate(match[1]),
      type: match[2].toLowerCase().replace(/\s+/g, "_"),
      store_number: match[3],
      reference_number: match[4],
      po_or_description: match[5].slice(0, firstAmountIndex).trim() || null,
      amount: money(amountMatches[0][1]),
      is_credit: amountMatches[0][2] === "-" || match[2] !== "CHARGE",
      source_text: line.trim(),
    });
  }
  return {
    buffer,
    text,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    page_count: text.split("\f").filter((page) => page.trim()).length,
    statement_as_of: isoDate(asOfMatch?.[1]),
    ending_balance: money(asOfMatch?.[2]),
    current_month_charges: statementValue(text, "CURRENT MONTH CHARGES"),
    current_month_payments: statementValue(text, "CURRENT MONTH PAYMENTS"),
    current_month_store_credits: statementValue(text, "CURRENT MONTH STORE CREDITS"),
    current_month_other_credits: statementValue(text, "CURRENT MONTH OTHER CREDITS"),
    net_amount_due: statementValue(text, "NET AMOUNT DUE"),
    rows,
  };
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase credentials.");
if (new URL(supabaseUrl).hostname.split(".")[0] !== TARGET_PROJECT_REF) {
  throw new Error("Refusing import for an unexpected Supabase project.");
}
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const files = readdirSync(sourceDir)
  .filter((filename) => filename.endsWith(".pdf") && filename.includes("--STATEMNT-E_"))
  .sort();
const statements = files.map((filename) => {
  const [messageId, originalFilename] = filename.split("--", 2);
  return {
    filename,
    messageId,
    originalFilename,
    parsed: parseStatement(path.join(sourceDir, filename)),
  };
});

const audit = {
  mode: apply ? "apply" : "dry-run",
  statements: statements.length,
  statement_dates: statements.map((statement) => statement.parsed.statement_as_of),
  statement_payment_totals: statements.map((statement) => ({
    as_of: statement.parsed.statement_as_of,
    payments: statement.parsed.current_month_payments,
  })),
  parsed_rows: statements.reduce((sum, statement) => sum + statement.parsed.rows.length, 0),
  imported_documents: 0,
};

if (apply) {
  for (const statement of statements) {
    const existing = await db
      .from("material_invoice_documents")
      .select("id")
      .eq("content_sha256", statement.parsed.sha256)
      .maybeSingle();
    if (existing.error) throw existing.error;
    const year = statement.parsed.statement_as_of?.slice(0, 4) ?? "unknown-year";
    const storagePath = `sherwin/${year}/${statement.messageId}/${statement.originalFilename}`;
    const documentValues = {
      source_system: "gmail_sherwin_monthly_statement",
      external_message_id: statement.messageId,
      source_reference: `gmail:${statement.messageId}`,
      document_date: statement.parsed.statement_as_of,
      original_filename: statement.originalFilename,
      mime_type: "application/pdf",
      file_size: statement.parsed.buffer.length,
      content_sha256: statement.parsed.sha256,
      storage_bucket: "material-invoices",
      storage_path: storagePath,
      page_count: statement.parsed.page_count,
      extracted_text: statement.parsed.text,
      source_payload: {
        gmail_message_id: statement.messageId,
        statement_as_of: statement.parsed.statement_as_of,
        ending_balance: statement.parsed.ending_balance,
        current_month_charges: statement.parsed.current_month_charges,
        current_month_payments: statement.parsed.current_month_payments,
        current_month_store_credits: statement.parsed.current_month_store_credits,
        current_month_other_credits: statement.parsed.current_month_other_credits,
        net_amount_due: statement.parsed.net_amount_due,
        statement_rows: statement.parsed.rows,
      },
    };
    if (existing.data) {
      const updated = await db
        .from("material_invoice_documents")
        .update(documentValues)
        .eq("id", existing.data.id);
      if (updated.error) throw updated.error;
    } else {
      const upload = await db.storage
        .from("material-invoices")
        .upload(storagePath, statement.parsed.buffer, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (upload.error && !/already exists/i.test(upload.error.message)) throw upload.error;
      const inserted = await db.from("material_invoice_documents").insert(documentValues);
      if (inserted.error) throw inserted.error;
      audit.imported_documents += 1;
    }
  }
}

console.log(JSON.stringify(audit, null, 2));
