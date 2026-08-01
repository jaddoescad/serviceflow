#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const SUPPLIER = "Sherwin-Williams Canada";
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const apply = process.argv.includes("--apply");
const csvPath = path.resolve(
  process.env.SHERWIN_PORTAL_CSV ?? "/Users/jadslim/Downloads/export_Aug_01_2026.csv",
);
const sourceDir = path.resolve(
  repoRoot,
  process.env.SHERWIN_PDF_DIR ?? "tmp/material-invoices/sherwin",
);
const outputDir = path.resolve(
  repoRoot,
  process.env.SHERWIN_PRIMARY_PDF_DIR ?? "tmp/material-invoices/sherwin-primary",
);

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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  if (!rows.length) return [];
  const headers = rows
    .shift()
    .map((header, index) => (index === 0 ? header.replace(/^\uFEFF/, "") : header));
  return rows
    .filter((values) => values.some(Boolean))
    .map((values, index) => ({
      rowNumber: index + 2,
      values: Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""])),
    }));
}

function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function dollars(value) {
  return Math.round(value) / 100;
}

function normalizeDigits(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return String(Number(digits));
}

function identityKey({ accountNumber, storeNumber, invoiceNumber, invoiceDate }) {
  return [
    normalizeDigits(accountNumber),
    normalizeDigits(storeNumber),
    normalizeDigits(invoiceNumber),
    invoiceDate,
  ].join("|");
}

function safeSegment(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function money(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const negative = raw.startsWith("(") || raw.includes("-");
  const parsed = Number(raw.replace(/[$,()\s-]/g, ""));
  if (!Number.isFinite(parsed)) return null;
  return Math.round((negative ? -parsed : parsed) * 100) / 100;
}

function findLastMatch(text, expression) {
  const matches = [...text.matchAll(expression)];
  return matches.length ? matches.at(-1) : null;
}

function textInvoiceTotal(text) {
  return money(
    findLastMatch(
      text,
      /(?:CHARGE CREDIT|CHARGE|CHARG|CASH|TOTAL)\s+\$?([$()\-\d,.]+)\s*$/gim,
    )?.[1],
  );
}

function dateAsPrinted(value) {
  return `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`;
}

function selectPython() {
  const candidates = [
    process.env.PDF_PYTHON,
    path.join(
      homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3",
    ),
    "python3",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const check = spawnSync(candidate, ["-c", "import pypdf"], { encoding: "utf8" });
    if (check.status === 0) return candidate;
  }
  throw new Error("No Python runtime with pypdf is available.");
}

async function fetchAll(queryFactory, pageSize = 1000) {
  const rows = [];
  for (let page = 0; page < 100; page += 1) {
    const result = await queryFactory().range(page * pageSize, page * pageSize + pageSize - 1);
    if (result.error) throw result.error;
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) return rows;
  }
  throw new Error("Pagination exceeded 100,000 rows.");
}

if (!existsSync(csvPath)) throw new Error(`Sherwin portal CSV not found: ${csvPath}`);
if (!existsSync(sourceDir)) throw new Error(`Sherwin source PDF directory not found: ${sourceDir}`);

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

const csvBuffer = readFileSync(csvPath);
const csvHash = sha256(csvBuffer);
const csvRows = parseCsv(csvBuffer.toString("utf8")).map(({ rowNumber, values }) => ({
  rowNumber,
  accountNumber: values["Account Number"].trim(),
  invoiceNumber: values["Invoice Number"].trim(),
  invoiceDate: values.Date.trim(),
  storeNumber: values.Store.trim(),
  jobAccount: values["Job #"].trim() || null,
  totalAmount: Number(values.Amount),
  poNumber: values["PO Number"].trim() || null,
  portalType: values.Type.trim().toLowerCase(),
  unitNumber: values["Unit #"].trim() || null,
  extendedInvoice: values["Extended Invoice"].trim() === "1",
  raw: values,
}));
const allowedPortalTypes = new Set(["invoice", "correction", "return"]);
if (csvRows.some((row) => !allowedPortalTypes.has(row.portalType))) {
  throw new Error("The Sherwin CSV contains an unexpected transaction type.");
}
if (csvRows.some((row) => !Number.isFinite(row.totalAmount))) {
  throw new Error("The Sherwin CSV contains an invalid amount.");
}

const [invoices, documents] = await Promise.all([
  fetchAll(() =>
    db
      .from("material_invoices")
      .select(
        "id,document_id,source_system,external_invoice_id,source_page_start,source_page_end,account_number,job_account,invoice_number,invoice_type,invoice_date,po_number,store_number,total_amount,source_payload",
      )
      .eq("supplier_name", SUPPLIER),
  ),
  fetchAll(() =>
    db
      .from("material_invoice_documents")
      .select(
        "id,source_system,external_message_id,source_reference,document_date,original_filename,mime_type,file_size,content_sha256,storage_bucket,storage_path,page_count,source_payload",
      )
      .eq("source_system", "gmail_sherwin_daily_invoices"),
  ),
]);

const dailyInvoices = invoices.filter((invoice) => invoice.source_system === "sherwin_daily_email");
const documentById = new Map(documents.map((document) => [document.id, document]));
const invoicesByDocument = Map.groupBy(dailyInvoices, (invoice) => invoice.document_id);
const invoiceByIdentity = new Map();
for (const invoice of dailyInvoices) {
  const key = identityKey({
    accountNumber: invoice.account_number,
    storeNumber: invoice.store_number,
    invoiceNumber: invoice.invoice_number,
    invoiceDate: invoice.invoice_date,
  });
  if (invoiceByIdentity.has(key)) throw new Error(`Duplicate stored Sherwin identity ${key}.`);
  invoiceByIdentity.set(key, invoice);
}
const seenCsvKeys = new Set();
for (const row of csvRows) {
  const key = identityKey(row);
  if (seenCsvKeys.has(key)) throw new Error(`Duplicate Sherwin CSV identity ${key}.`);
  seenCsvKeys.add(key);
}

const originalHashChecks = new Map();
const matched = [];
const sourceMissing = [];
const validationErrors = [];
for (const row of csvRows) {
  const key = identityKey(row);
  const invoice = invoiceByIdentity.get(key) ?? null;
  if (!invoice) {
    sourceMissing.push({ row, key });
    continue;
  }
  const differences = [];
  if (Math.abs(cents(row.totalAmount) - cents(invoice.total_amount)) > 2) {
    differences.push({
      field: "total_amount",
      portal: row.totalAmount,
      physical_invoice: Number(invoice.total_amount),
    });
  }
  if ((row.poNumber ?? "") !== (invoice.po_number ?? "")) {
    differences.push({
      field: "po_number",
      portal: row.poNumber,
      physical_invoice: invoice.po_number,
    });
  }
  const expectedInvoiceType = cents(row.totalAmount) < 0 ? "credit_memo" : "charge_invoice";
  if (invoice.invoice_type !== expectedInvoiceType) {
    differences.push({
      field: "invoice_type",
      portal: row.portalType,
      physical_invoice: invoice.invoice_type,
    });
  }

  const document = documentById.get(invoice.document_id);
  if (!document) {
    validationErrors.push({ invoice: invoice.invoice_number, error: "Source document missing" });
    continue;
  }
  const sourceFile = path.join(
    sourceDir,
    `${document.external_message_id}--${document.original_filename}`,
  );
  if (!existsSync(sourceFile)) {
    validationErrors.push({
      invoice: invoice.invoice_number,
      error: `Local archived batch is missing: ${path.basename(sourceFile)}`,
    });
    continue;
  }
  if (!originalHashChecks.has(document.id)) {
    const actualHash = sha256(readFileSync(sourceFile));
    originalHashChecks.set(document.id, actualHash);
    if (actualHash !== document.content_sha256) {
      validationErrors.push({
        invoice: invoice.invoice_number,
        error: `Archived batch hash mismatch for ${document.original_filename}`,
      });
      continue;
    }
  }
  const documentInvoiceCount = invoicesByDocument.get(document.id)?.length ?? 0;
  const needsDerivedPdf = documentInvoiceCount > 1;
  const outputFilename = `Sherwin-Williams Invoice ${invoice.invoice_number} ${invoice.invoice_date}.pdf`;
  const outputPath = path.join(
    outputDir,
    invoice.invoice_date.slice(0, 4),
    `${invoice.invoice_date}--${safeSegment(invoice.invoice_number)}--${invoice.id}.pdf`,
  );
  matched.push({
    row,
    invoice,
    document,
    differences,
    sourceFile,
    documentInvoiceCount,
    needsDerivedPdf,
    outputFilename,
    outputPath,
  });
}

const matchedStoredIds = new Set(matched.map((item) => item.invoice.id));
const storedMissingFromCsv = dailyInvoices.filter((invoice) => !matchedStoredIds.has(invoice.id));
if (storedMissingFromCsv.length) {
  validationErrors.push({
    error: `${storedMissingFromCsv.length} stored Sherwin invoices are absent from the portal CSV`,
    invoices: storedMissingFromCsv.map((invoice) => invoice.invoice_number),
  });
}

const splitTasks = matched
  .filter((item) => item.needsDerivedPdf)
  .map((item) => ({
    source: item.sourceFile,
    output: item.outputPath,
    page_start: Number(item.invoice.source_page_start),
    page_end: Number(item.invoice.source_page_end),
  }));
if (splitTasks.length) {
  mkdirSync(outputDir, { recursive: true });
  const manifestPath = path.join(outputDir, "split-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(splitTasks, null, 2));
  const python = selectPython();
  execFileSync(
    python,
    [path.resolve(repoRoot, "scripts/split-pdf-pages.py"), "--manifest", manifestPath],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
}

for (const item of matched) {
  const evidenceFile = item.needsDerivedPdf ? item.outputPath : item.sourceFile;
  const text = execFileSync("pdftotext", ["-layout", evidenceFile, "-"], {
    encoding: "utf8",
    maxBuffer: 5 * 1024 * 1024,
  });
  const printedInvoice = text.match(/\bNo\.\s*([A-Z0-9-]+)/i)?.[1] ?? null;
  const printedDate = text.match(/\bDATE:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? null;
  const printedTotal = textInvoiceTotal(text);
  if (normalizeDigits(printedInvoice) !== normalizeDigits(item.invoice.invoice_number)) {
    validationErrors.push({
      invoice: item.invoice.invoice_number,
      error: `Invoice-specific PDF contains invoice ${printedInvoice ?? "unknown"}`,
    });
  }
  if (printedDate !== dateAsPrinted(item.invoice.invoice_date)) {
    validationErrors.push({
      invoice: item.invoice.invoice_number,
      error: `Invoice-specific PDF contains date ${printedDate ?? "unknown"}`,
    });
  }
  if (printedTotal == null || Math.abs(cents(printedTotal) - cents(item.invoice.total_amount)) > 2) {
    validationErrors.push({
      invoice: item.invoice.invoice_number,
      error: `Invoice-specific PDF total ${printedTotal ?? "unknown"} does not match ${item.invoice.total_amount}`,
    });
  }
  item.evidenceFile = evidenceFile;
  item.evidenceText = text;
  item.evidenceBuffer = readFileSync(evidenceFile);
  item.evidenceHash = sha256(item.evidenceBuffer);
  item.evidencePageCount =
    Number(item.invoice.source_page_end) - Number(item.invoice.source_page_start) + 1;
}

const report = {
  mode: apply ? "apply" : "dry-run",
  csv: {
    path: csvPath,
    sha256: csvHash,
    rows: csvRows.length,
    date_start: csvRows.map((row) => row.invoiceDate).sort().at(0),
    date_end: csvRows.map((row) => row.invoiceDate).sort().at(-1),
  },
  physical_invoices: {
    stored: dailyInvoices.length,
    matched_to_portal: matched.length,
    exact_header_matches: matched.filter((item) => !item.differences.length).length,
    matches_with_differences: matched.filter((item) => item.differences.length).map((item) => ({
      invoice: item.invoice.invoice_number,
      date: item.invoice.invoice_date,
      differences: item.differences,
    })),
    source_batches_verified_by_hash: originalHashChecks.size,
    existing_single_invoice_pdfs: matched.filter((item) => !item.needsDerivedPdf).length,
    derived_invoice_pdfs: matched.filter((item) => item.needsDerivedPdf).length,
  },
  portal_rows_without_physical_source: {
    count: sourceMissing.length,
    total: dollars(sourceMissing.reduce((sum, item) => sum + cents(item.row.totalAmount), 0)),
    rows: sourceMissing.map((item) => ({
      row: item.row.rowNumber,
      invoice: item.row.invoiceNumber,
      date: item.row.invoiceDate,
      store: item.row.storeNumber,
      po: item.row.poNumber,
      amount: item.row.totalAmount,
      type: item.row.portalType,
    })),
  },
  validation_errors: validationErrors,
  applied: {
    portal_documents: 0,
    portal_records: 0,
    derived_documents: 0,
    primary_evidence_links: 0,
    supporting_batch_links: 0,
    portal_export_links: 0,
  },
};

if (validationErrors.length) {
  console.log(JSON.stringify(report, null, 2));
  throw new Error(`Refusing import because ${validationErrors.length} evidence validation error(s) remain.`);
}

if (apply) {
  const portalStoragePath =
    `sherwin/portal-exports/2026/${safeSegment(path.basename(csvPath, ".csv"))}-${csvHash.slice(0, 12)}.csv`;
  const existingPortalDocument = await db
    .from("material_invoice_documents")
    .select("id")
    .eq("source_system", "sherwin_pro_portal_csv")
    .eq("content_sha256", csvHash)
    .maybeSingle();
  if (existingPortalDocument.error) throw existingPortalDocument.error;
  let portalDocumentId = existingPortalDocument.data?.id ?? null;
  if (!portalDocumentId) {
    const upload = await db.storage
      .from("material-invoices")
      .upload(portalStoragePath, csvBuffer, { contentType: "text/csv", upsert: false });
    if (upload.error && !/already exists/i.test(upload.error.message)) throw upload.error;
    const inserted = await db
      .from("material_invoice_documents")
      .insert({
        source_system: "sherwin_pro_portal_csv",
        external_message_id: csvHash,
        source_reference: "Sherwin-Williams PRO+ authenticated account CSV export",
        document_date: "2026-08-01",
        original_filename: path.basename(csvPath),
        mime_type: "text/csv",
        file_size: csvBuffer.length,
        content_sha256: csvHash,
        storage_bucket: "material-invoices",
        storage_path: portalStoragePath,
        page_count: null,
        extracted_text: csvBuffer.toString("utf8"),
        source_payload: {
          supplier: SUPPLIER,
          account: "4042-4272-9",
          exported_on: "2026-08-01",
          row_count: csvRows.length,
        },
      })
      .select("id")
      .single();
    if (inserted.error) throw inserted.error;
    portalDocumentId = inserted.data.id;
    report.applied.portal_documents = 1;
  }

  const portalRecords = csvRows.map((row) => {
    const item = matched.find(
      (candidate) =>
        identityKey(candidate.row) === identityKey(row),
    );
    const differences = item?.differences ?? [];
    return {
      source_document_id: portalDocumentId,
      supplier_name: SUPPLIER,
      account_number: row.accountNumber,
      store_number: row.storeNumber,
      invoice_number: row.invoiceNumber,
      invoice_number_normalized: normalizeDigits(row.invoiceNumber),
      transaction_date: row.invoiceDate,
      job_account: row.jobAccount,
      total_amount: row.totalAmount,
      po_number: row.poNumber,
      portal_type: row.portalType,
      unit_number: row.unitNumber,
      extended_invoice: row.extendedInvoice,
      source_row_number: row.rowNumber,
      material_invoice_id: item?.invoice.id ?? null,
      match_status: item
        ? differences.length
          ? "matched_with_difference"
          : "matched"
        : "source_missing",
      match_differences: differences,
      source_payload: {
        portal_export_filename: path.basename(csvPath),
        portal_export_sha256: csvHash,
        raw: row.raw,
      },
      last_seen_at: new Date().toISOString(),
    };
  });
  const upsertedPortalRecords = await db
    .from("material_supplier_portal_records")
    .upsert(portalRecords, {
      onConflict:
        "supplier_name,account_number,store_number,invoice_number_normalized,transaction_date",
    })
    .select("id");
  if (upsertedPortalRecords.error) throw upsertedPortalRecords.error;
  if (upsertedPortalRecords.data?.length !== portalRecords.length) {
    throw new Error("Not all Sherwin portal records were stored.");
  }
  report.applied.portal_records = portalRecords.length;

  const existingLinks = await fetchAll(() =>
    db
      .from("material_invoice_evidence_links")
      .select("id,material_invoice_id,document_id,evidence_role"),
  );
  const primaryByInvoice = new Map(
    existingLinks
      .filter((link) => link.evidence_role === "primary_invoice")
      .map((link) => [link.material_invoice_id, link]),
  );

  for (const item of matched) {
    let primaryDocumentId = item.document.id;
    if (item.needsDerivedPdf) {
      const existingDerived = await db
        .from("material_invoice_documents")
        .select("id,content_sha256")
        .eq("source_system", "derived_sherwin_invoice_pdf")
        .eq("external_message_id", item.invoice.id)
        .maybeSingle();
      if (existingDerived.error) throw existingDerived.error;
      if (existingDerived.data && existingDerived.data.content_sha256 !== item.evidenceHash) {
        throw new Error(`Derived PDF changed for invoice ${item.invoice.invoice_number}.`);
      }
      primaryDocumentId = existingDerived.data?.id ?? null;
      if (!primaryDocumentId) {
        const storagePath =
          `sherwin/invoice-specific/${item.invoice.invoice_date.slice(0, 4)}/` +
          `${item.invoice.invoice_date}/${safeSegment(item.invoice.invoice_number)}-${item.invoice.id.slice(0, 8)}.pdf`;
        const upload = await db.storage
          .from("material-invoices")
          .upload(storagePath, item.evidenceBuffer, {
            contentType: "application/pdf",
            upsert: false,
          });
        if (upload.error && !/already exists/i.test(upload.error.message)) throw upload.error;
        const inserted = await db
          .from("material_invoice_documents")
          .insert({
            source_system: "derived_sherwin_invoice_pdf",
            external_message_id: item.invoice.id,
            source_reference:
              `derived:${item.document.id}#pages=${item.invoice.source_page_start}-${item.invoice.source_page_end}`,
            document_date: item.invoice.invoice_date,
            original_filename: item.outputFilename,
            mime_type: "application/pdf",
            file_size: item.evidenceBuffer.length,
            content_sha256: item.evidenceHash,
            storage_bucket: "material-invoices",
            storage_path: storagePath,
            page_count: item.evidencePageCount,
            extracted_text: item.evidenceText,
            source_payload: {
              supplier: SUPPLIER,
              derivation: "Exact page-range copy from archived Sherwin email batch",
              source_document_id: item.document.id,
              source_document_sha256: item.document.content_sha256,
              source_page_start: item.invoice.source_page_start,
              source_page_end: item.invoice.source_page_end,
              portal_export_document_id: portalDocumentId,
              portal_row_number: item.row.rowNumber,
            },
          })
          .select("id")
          .single();
        if (inserted.error) throw inserted.error;
        primaryDocumentId = inserted.data.id;
        report.applied.derived_documents += 1;
      }
    }

    const existingPrimary = primaryByInvoice.get(item.invoice.id);
    if (existingPrimary && existingPrimary.document_id !== primaryDocumentId) {
      throw new Error(`Invoice ${item.invoice.invoice_number} already has a different primary document.`);
    }
    if (!existingPrimary) {
      const primaryLink = await db.from("material_invoice_evidence_links").insert({
        material_invoice_id: item.invoice.id,
        document_id: primaryDocumentId,
        evidence_role: "primary_invoice",
        source_page_start: item.needsDerivedPdf ? 1 : item.invoice.source_page_start,
        source_page_end: item.needsDerivedPdf
          ? item.evidencePageCount
          : item.invoice.source_page_end,
        evidence_label: item.needsDerivedPdf
          ? "Invoice-specific PDF derived from the archived Sherwin batch"
          : "Original Sherwin invoice PDF",
        source_payload: {
          supplier: SUPPLIER,
          invoice_number: item.invoice.invoice_number,
          portal_export_document_id: portalDocumentId,
          portal_row_number: item.row.rowNumber,
          physical_source_document_id: item.document.id,
          derivation: item.needsDerivedPdf ? "exact_page_range" : "none",
        },
      });
      if (primaryLink.error) throw primaryLink.error;
      report.applied.primary_evidence_links += 1;
    }

    if (item.needsDerivedPdf) {
      const supportingLink = await db.from("material_invoice_evidence_links").upsert(
        {
          material_invoice_id: item.invoice.id,
          document_id: item.document.id,
          evidence_role: "supporting_batch",
          source_page_start: item.invoice.source_page_start,
          source_page_end: item.invoice.source_page_end,
          evidence_label:
            `Original email batch · pages ${item.invoice.source_page_start}-${item.invoice.source_page_end}`,
          source_payload: {
            supplier: SUPPLIER,
            source_document_sha256: item.document.content_sha256,
          },
        },
        { onConflict: "material_invoice_id,document_id,evidence_role" },
      );
      if (supportingLink.error) throw supportingLink.error;
      report.applied.supporting_batch_links += 1;
    }

    const portalLink = await db.from("material_invoice_evidence_links").upsert(
      {
        material_invoice_id: item.invoice.id,
        document_id: portalDocumentId,
        evidence_role: "portal_export",
        source_page_start: null,
        source_page_end: null,
        evidence_label: `Sherwin PRO+ CSV export · row ${item.row.rowNumber}`,
        source_payload: {
          supplier: SUPPLIER,
          portal_row_number: item.row.rowNumber,
          portal_po_number: item.row.poNumber,
          portal_amount: item.row.totalAmount,
          portal_type: item.row.portalType,
          match_differences: item.differences,
        },
      },
      { onConflict: "material_invoice_id,document_id,evidence_role" },
    );
    if (portalLink.error) throw portalLink.error;
    report.applied.portal_export_links += 1;
  }

  const [portalCheck, evidenceCheck] = await Promise.all([
    db
      .from("material_supplier_portal_records")
      .select("id,match_status", { count: "exact" })
      .eq("source_document_id", portalDocumentId),
    db
      .from("material_invoice_evidence_links")
      .select("id,evidence_role,material_invoice_id", { count: "exact" })
      .in("material_invoice_id", matched.map((item) => item.invoice.id)),
  ]);
  if (portalCheck.error) throw portalCheck.error;
  if (evidenceCheck.error) throw evidenceCheck.error;
  const roleCounts = (evidenceCheck.data ?? []).reduce((counts, link) => {
    counts[link.evidence_role] = (counts[link.evidence_role] ?? 0) + 1;
    return counts;
  }, {});
  report.verified_after_apply = {
    portal_records: portalCheck.count,
    portal_statuses: (portalCheck.data ?? []).reduce((counts, row) => {
      counts[row.match_status] = (counts[row.match_status] ?? 0) + 1;
      return counts;
    }, {}),
    evidence_roles: roleCounts,
  };
  if (portalCheck.count !== csvRows.length) {
    throw new Error("The stored Sherwin portal-record count does not match the CSV.");
  }
  if (roleCounts.primary_invoice !== matched.length) {
    throw new Error("Not every matched Sherwin invoice has one primary evidence document.");
  }
}

console.log(JSON.stringify(report, null, 2));
