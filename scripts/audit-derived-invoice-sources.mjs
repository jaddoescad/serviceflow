#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sourceKind =
  process.argv
    .find((argument) => argument.startsWith("--source-kind="))
    ?.split("=", 2)[1] ?? "legacy_project_link";
if (!["legacy_project_link", "legacy_invoice_total"].includes(sourceKind)) {
  throw new Error(`Unsupported source kind: ${sourceKind}`);
}
const auditDirectory =
  sourceKind === "legacy_project_link"
    ? "derived-invoice-audit"
    : "placeholder-invoice-audit";
const auditRoot = path.resolve(repoRoot, "tmp/pdfs", auditDirectory);
const sourceRoot = path.resolve(auditRoot, "sources");
const textRoot = path.resolve(auditRoot, "text");
const renderRoot = path.resolve(auditRoot, "renders");
const reportPath = path.resolve(auditRoot, "audit.json");

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

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-CA")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function extensionFor(filePath) {
  const extension = path.extname(filePath).toLocaleLowerCase("en-CA");
  return extension || ".bin";
}

function moneyVariants(value) {
  const number = Number(value);
  const fixed = number.toFixed(2);
  const grouped = number.toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  });
  const variants = new Set([
    fixed,
    grouped,
    `$${fixed}`,
    `$${grouped}`,
    fixed.replace(".", ","),
    grouped.replaceAll(",", " ").replace(".", ","),
  ]);
  if (Number.isInteger(number)) {
    variants.add(String(number));
    variants.add(`$${number}`);
  }
  return [...variants];
}

function containsMoney(value, text) {
  return moneyVariants(value).some((variant) => text.includes(variant));
}

function identityPhrases(entry) {
  const rawValues = [
    entry.description,
    ...entry.allocations.flatMap((allocation) => [
      allocation.project_name,
      allocation.project_address,
    ]),
  ];
  const phrases = new Set();
  for (const rawValue of rawValues) {
    const normalized = normalize(rawValue)
      .replace(/\bproposal \d+\b/g, "")
      .replace(/\bcompleted\b/g, "")
      .replace(/\b\d{4} \d{2} \d{2}t\d{2} \d{2} \d{2}\b/g, "")
      .trim();
    if (!normalized) continue;
    phrases.add(normalized);

    const words = normalized
      .split(" ")
      .filter(
        (word) =>
          word.length >= 3 &&
          ![
            "the",
            "and",
            "inc",
            "ontario",
            "ottawa",
            "canada",
            "store",
            "name",
            "apartment",
          ].includes(word),
      );
    if (words.length >= 2) {
      phrases.add(words.slice(0, 2).join(" "));
    }
    const streetNumber = normalized.match(/\b\d{1,5}\b/)?.[0];
    const streetWord = words.find((word) => !/^\d+$/.test(word));
    if (streetNumber && streetWord) {
      phrases.add(`${streetNumber} ${streetWord}`);
    }
  }
  return [...phrases].filter((phrase) => phrase.length >= 5);
}

function findEntryEvidence(entry, sourceText, entryCount) {
  const normalizedText = normalize(sourceText);
  const phrases = identityPhrases(entry);
  const matchedPhrases = phrases.filter((phrase) =>
    normalizedText.includes(phrase),
  );
  const amountFound = containsMoney(entry.amount_before_tax, sourceText);
  const lines = sourceText.split(/\r?\n/);
  const pairedLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const windowText = lines
      .slice(Math.max(0, index - 2), Math.min(lines.length, index + 3))
      .join(" ");
    if (
      containsMoney(entry.amount_before_tax, windowText) &&
      phrases.some((phrase) => normalize(windowText).includes(phrase))
    ) {
      pairedLines.push(
        lines
          .slice(Math.max(0, index - 1), Math.min(lines.length, index + 2))
          .map((line) => line.trim())
          .filter(Boolean)
          .join(" | "),
      );
    }
  }

  const identityFound = matchedPhrases.length > 0;
  const pairedEvidence =
    pairedLines.length > 0 || (entryCount === 1 && identityFound && amountFound);

  return {
    amount_found: amountFound,
    identity_found: identityFound,
    paired_evidence: pairedEvidence,
    matched_phrases: matchedPhrases,
    source_excerpt: pairedLines[0]?.slice(0, 500) ?? null,
  };
}

function extractPdfText(sourcePath, invoiceId) {
  const textPath = path.resolve(textRoot, `${invoiceId}.txt`);
  execFileSync("pdftotext", ["-layout", "-nopgbrk", sourcePath, textPath]);
  let text = readFileSync(textPath, "utf8");
  let method = "pdftotext";

  if (normalize(text).length < 40) {
    const prefix = path.resolve(renderRoot, invoiceId);
    execFileSync("pdftoppm", [
      "-r",
      "200",
      "-png",
      sourcePath,
      prefix,
    ]);
    const images = readdirSync(renderRoot)
      .filter((filename) => filename.startsWith(`${invoiceId}-`))
      .sort()
      .map((filename) => path.resolve(renderRoot, filename));
    text = images
      .map((imagePath) =>
        execFileSync("tesseract", [imagePath, "stdout"], {
          encoding: "utf8",
        }),
      )
      .join("\n");
    writeFileSync(textPath, text);
    method = "tesseract-rendered-pdf";
  }

  return { text, textPath, method };
}

function extractImageText(sourcePath, invoiceId) {
  const textPath = path.resolve(textRoot, `${invoiceId}.txt`);
  const text = execFileSync("tesseract", [sourcePath, "stdout"], {
    encoding: "utf8",
  });
  writeFileSync(textPath, text);
  return { text, textPath, method: "tesseract-image" };
}

function extractDocxText(sourcePath, invoiceId) {
  const textPath = path.resolve(textRoot, `${invoiceId}.txt`);
  const xml = execFileSync(
    "unzip",
    ["-p", sourcePath, "word/document.xml"],
    { encoding: "utf8" },
  );
  const text = xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
  writeFileSync(textPath, text);
  return { text, textPath, method: "docx-xml" };
}

function extractText(sourcePath, invoiceId) {
  const extension = extensionFor(sourcePath);
  if (extension === ".pdf") return extractPdfText(sourcePath, invoiceId);
  if ([".jpg", ".jpeg", ".png"].includes(extension)) {
    return extractImageText(sourcePath, invoiceId);
  }
  if (extension === ".docx") return extractDocxText(sourcePath, invoiceId);
  throw new Error(`Unsupported invoice source: ${extension}`);
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

async function runPool(items, concurrency, callback) {
  let nextIndex = 0;
  const results = new Array(items.length);
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

mkdirSync(sourceRoot, { recursive: true });
mkdirSync(textRoot, { recursive: true });
mkdirSync(renderRoot, { recursive: true });

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

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await db
  .from("labour_invoice_lines")
  .select(
    `
      id,
      invoice_id,
      line_number,
      entry_type,
      description,
      amount_before_tax,
      tax_amount,
      source_kind,
      source_text,
      needs_review,
      labour_invoices (
        id,
        supplier_name,
        invoice_number,
        invoice_date,
        amount_before_tax,
        tax_amount,
        amount_paid,
        original_filename,
        storage_path,
        match_status
      ),
      labour_invoice_line_allocations (
        companycam_project_id,
        allocated_amount,
        needs_review,
        companycam_projects (
          name,
          formatted_address
        )
      )
    `,
  )
  .eq("source_kind", sourceKind)
  .order("invoice_id")
  .order("line_number");

if (error) throw error;

const invoicesById = new Map();
for (const row of data ?? []) {
  const current = invoicesById.get(row.invoice_id) ?? {
    ...row.labour_invoices,
    entries: [],
  };
  current.entries.push({
    id: row.id,
    line_number: row.line_number,
    entry_type: row.entry_type,
    description: row.description,
    amount_before_tax: Number(row.amount_before_tax),
    tax_amount: Number(row.tax_amount),
    source_text: row.source_text,
    needs_review: row.needs_review,
    allocations: row.labour_invoice_line_allocations.map((allocation) => ({
      companycam_project_id: allocation.companycam_project_id,
      allocated_amount: Number(allocation.allocated_amount),
      needs_review: allocation.needs_review,
      project_name: allocation.companycam_projects?.name ?? null,
      project_address:
        allocation.companycam_projects?.formatted_address ?? null,
    })),
  });
  invoicesById.set(row.invoice_id, current);
}

const invoices = [...invoicesById.values()];
const audits = await runPool(invoices, 6, async (invoice, index) => {
  const extension = extensionFor(invoice.storage_path);
  const sourcePath = path.resolve(sourceRoot, `${invoice.id}${extension}`);
  if (!existsSync(sourcePath)) {
    const downloaded = await db.storage
      .from("labour-invoices")
      .download(invoice.storage_path);
    if (downloaded.error) throw downloaded.error;
    writeFileSync(sourcePath, Buffer.from(await downloaded.data.arrayBuffer()));
  }

  let extraction;
  try {
    extraction = extractText(sourcePath, invoice.id);
  } catch (extractionError) {
    extraction = {
      text: "",
      textPath: null,
      method: "failed",
      error:
        extractionError instanceof Error
          ? extractionError.message
          : String(extractionError),
    };
  }

  const entryEvidence = invoice.entries.map((entry) => ({
    id: entry.id,
    line_number: entry.line_number,
    entry_type: entry.entry_type,
    description: entry.description,
    amount_before_tax: entry.amount_before_tax,
    allocations: entry.allocations,
    ...findEntryEvidence(entry, extraction.text, invoice.entries.length),
  }));
  const entryTotal = roundMoney(
    invoice.entries.reduce(
      (total, entry) => total + Number(entry.amount_before_tax),
      0,
    ),
  );
  const allocationTotal = roundMoney(
    invoice.entries.reduce(
      (invoiceTotal, entry) =>
        invoiceTotal +
        entry.allocations.reduce(
          (entryTotalValue, allocation) =>
            entryTotalValue + Number(allocation.allocated_amount),
          0,
        ),
      0,
    ),
  );
  const printedBeforeTax = roundMoney(invoice.amount_before_tax);
  const printedTax = roundMoney(invoice.tax_amount);
  const printedAfterTax = roundMoney(invoice.amount_paid);
  const textLength = normalize(extraction.text).length;
  const controls = {
    source_text_readable: textLength >= 40,
    invoice_number_found: normalize(extraction.text).includes(
      normalize(invoice.invoice_number),
    ),
    before_tax_found: containsMoney(printedBeforeTax, extraction.text),
    tax_found:
      printedTax === 0 || containsMoney(printedTax, extraction.text),
    after_tax_found: containsMoney(printedAfterTax, extraction.text),
    entries_equal_before_tax:
      Math.abs(entryTotal - printedBeforeTax) <= 0.005,
    allocations_equal_entries:
      Math.abs(allocationTotal - entryTotal) <= 0.005,
    every_entry_has_identity: entryEvidence.every(
      (entry) => entry.identity_found,
    ),
    every_entry_has_amount: entryEvidence.every((entry) => entry.amount_found),
    every_entry_is_paired: entryEvidence.every(
      (entry) => entry.paired_evidence,
    ),
  };
  const exactCandidate = Object.values(controls).every(Boolean);

  process.stderr.write(
    `[${index + 1}/${invoices.length}] ${invoice.supplier_name} #${invoice.invoice_number}: ${
      exactCandidate ? "exact candidate" : "review"
    }\n`,
  );

  return {
    invoice: {
      id: invoice.id,
      supplier_name: invoice.supplier_name,
      invoice_number: invoice.invoice_number,
      invoice_date: invoice.invoice_date,
      amount_before_tax: printedBeforeTax,
      tax_amount: printedTax,
      amount_after_tax: printedAfterTax,
      original_filename: invoice.original_filename,
      storage_path: invoice.storage_path,
      match_status: invoice.match_status,
    },
    extraction: {
      method: extraction.method,
      error: extraction.error ?? null,
      normalized_text_length: textLength,
      source_path: path.relative(repoRoot, sourcePath),
      text_path: extraction.textPath
        ? path.relative(repoRoot, extraction.textPath)
        : null,
    },
    totals: {
      entry_total: entryTotal,
      allocation_total: allocationTotal,
    },
    controls,
    exact_candidate: exactCandidate,
    entries: entryEvidence,
  };
});

const report = {
  generated_at: new Date().toISOString(),
  project_ref: new URL(supabaseUrl).hostname.split(".")[0],
  source_kind: sourceKind,
  invoice_count: audits.length,
  entry_count: audits.reduce(
    (total, audit) => total + audit.entries.length,
    0,
  ),
  exact_candidate_count: audits.filter((audit) => audit.exact_candidate).length,
  review_count: audits.filter((audit) => !audit.exact_candidate).length,
  extraction_methods: Object.fromEntries(
    Object.entries(
      Object.groupBy(audits, (audit) => audit.extraction.method),
    ).map(([method, rows]) => [method, rows.length]),
  ),
  audits,
};

writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, audits: undefined }, null, 2));
console.log(`Report: ${path.relative(repoRoot, reportPath)}`);
