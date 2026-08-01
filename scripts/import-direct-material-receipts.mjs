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
  process.env.DIRECT_MATERIAL_RECEIPT_DIR ?? "tmp/material-invoices/vendors",
);
const apply = process.argv.includes("--apply");
const includeDetails = process.argv.includes("--details");

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

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  const normalized = String(value ?? "").replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function allocateTax(lines, taxAmount, amountBeforeTax) {
  let remaining = roundMoney(taxAmount);
  return lines.map((line, index) => {
    const tax =
      index === lines.length - 1
        ? remaining
        : roundMoney(taxAmount * (line.amount_before_tax / amountBeforeTax));
    remaining = roundMoney(remaining - tax);
    return { ...line, tax_amount: tax, total_amount: roundMoney(line.amount_before_tax + tax) };
  });
}

function isoCanadianDate(day, month, year) {
  const fullYear = String(year).length === 2 ? `20${year}` : String(year);
  return `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseHomeDepot(file) {
  const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  const header = text.match(
    /^\s*(\d{4})\s+0*(\d{5})\s+(\d{5})\s+(\d{2})\/(\d{2})\/(\d{2,4})\s+/m,
  );
  const subtotal = money(text.match(/\bSUBTOTAL\s+\$?([\d,.]+)/i)?.[1]);
  const tax = money(text.match(/\bGST\/HST\s+\$?([\d,.]+)/i)?.[1]);
  const total = money(text.match(/\bTOTAL\s+\$?([\d,.]+)/i)?.[1]);
  if (!header || subtotal == null || tax == null || total == null) {
    throw new Error(`Could not parse Home Depot receipt ${path.basename(file)}`);
  }

  const rawLines = text.split("\n");
  const firstProduct = rawLines.findIndex((line) => /^\s*\d{6,13}\s+/.test(line));
  const subtotalIndex = rawLines.findIndex((line) => /\bSUBTOTAL\b/i.test(line));
  const lines = [];
  for (let index = firstProduct; index >= 0 && index < subtotalIndex; index += 1) {
    const row = rawLines[index];
    const product = row.match(/^\s*(\d{6,13})\s+(.+?)\s+<A>(?:\s+([\d,.]+))?\s*$/i);
    if (!product) continue;
    let amount = money(product[3]);
    let quantity = 1;
    let unitPrice = amount;
    let sourceText = row.trim();
    if (amount == null) {
      const continuation = rawLines[index + 1] ?? "";
      const continuationAmount = continuation.match(/([\d,.]+)\s*$/)?.[1];
      amount = money(continuationAmount);
      const quantityMatch = continuation.match(/(\d+(?:\.\d+)?)\s*@\s*([\d,.]+)/);
      if (quantityMatch) {
        quantity = Number(quantityMatch[1]);
        unitPrice = money(quantityMatch[2]);
      } else {
        unitPrice = amount;
      }
      sourceText += `\n${continuation.trim()}`;
    }
    if (amount == null) throw new Error(`Missing Home Depot line amount in ${path.basename(file)}`);
    lines.push({
      line_number: lines.length + 1,
      line_type: "product",
      sales_number: product[1],
      size: null,
      product_code: product[1],
      description: product[2].trim(),
      color_code: null,
      color_name: null,
      quantity,
      unit_price: unitPrice,
      gross_amount: amount,
      discount_amount: 0,
      amount_before_tax: amount,
      source_text: sourceText,
      source_payload: {},
      needs_review: false,
    });
  }
  if (!lines.length) throw new Error(`No Home Depot products parsed from ${path.basename(file)}`);
  const lineSubtotal = roundMoney(lines.reduce((sum, line) => sum + line.amount_before_tax, 0));
  if (Math.abs(lineSubtotal - subtotal) > 0.02) {
    throw new Error(`Home Depot line subtotal mismatch in ${path.basename(file)}`);
  }

  const invoiceDate = isoCanadianDate(header[4], header[5], header[6]);
  const po = text.match(/P\.O\.#\/JOB NAME:\s*([^\n\r]+)/i)?.[1]?.trim() || null;
  const storeAddress = rawLines.find((line) => /\b(?:ROAD|LINE|STRANDHERD|BASELINE)\b/i.test(line))?.trim() ?? null;
  const receiptNumber = `${header[1]}-${header[2]}-${header[3]}`;
  return {
    source_system: "gmail_home_depot_receipt",
    external_invoice_id: `home-depot:${receiptNumber}:${invoiceDate}`,
    supplier_name: "The Home Depot",
    account_number: null,
    job_account: null,
    invoice_number: receiptNumber,
    invoice_type: "cash_receipt",
    invoice_date: invoiceDate,
    invoice_time: null,
    due_on: invoiceDate,
    po_number: po,
    order_number: null,
    store_number: header[1],
    store_address: storeAddress,
    received_by: null,
    currency: "CAD",
    amount_before_tax: subtotal,
    tax_amount: tax,
    total_amount: total,
    extraction_status: "verified",
    source_text: text,
    source_payload: { receipt_number: receiptNumber, card_receipt: true },
    lines: allocateTax(lines, tax, subtotal),
  };
}

const prestonManifest = {
  "WhatsApp_Image_2026-03-24_at_1.22.20_PM.jpeg": {
    original_filename: "WhatsApp Image 2026-03-24 at 1.22.20 PM.jpeg",
    supplier_name: "The Home Depot",
    source_system: "gmail_home_depot_receipt",
    invoice_number: "7118-00062-67348", invoice_date: "2026-03-24", po_number: "SUPPLIES",
    amount_before_tax: 70.92, tax_amount: 9.22, total_amount: 80.14,
    store_number: "7118",
    store_address: "2121 Tenth Line Road, Orleans, ON K4A 4C5",
    lines: [
      ["069606002726", "LOWDUST 4.5L", 1, 25.98, 25.98],
      ["020066045111", "COVERS UP SP", 3, 14.98, 44.94],
    ],
  },
  "Image_260607_123600.jpeg": {
    original_filename: "Image_260607_123600.jpeg",
    invoice_number: "OR019440", invoice_date: "2026-06-07", po_number: "HARRIS",
    amount_before_tax: 673.20, tax_amount: 87.52, total_amount: 760.72,
    extraction_status: "needs_review",
    lines: [
      [null, "REGAL EGGSHELL BASE-1 3.79L (product code obscured)", 8, 67.32, 538.56, null, null, true],
      [null, "REGAL EGGSHELL BASE-1 3.79L (product code obscured)", 1, 67.32, 67.32, null, null, true],
      ["F551", "GLOSS WHITE 3.79L", 1, 67.32, 67.32, null, null, true],
    ],
  },
  "WhatsApp_Image_2026-06-04_at_09.17.30.jpeg": {
    original_filename: "WhatsApp Image 2026-06-04 at 09.17.30.jpeg",
    invoice_number: "OR019245", invoice_date: "2026-06-01", po_number: "BOULET",
    amount_before_tax: 67.32, tax_amount: 8.76, total_amount: 76.08,
    lines: [["K552", "REGAL ULTI-MATTE BASE-1 3.79L", 1, 67.32, 67.32]],
  },
  "vv.jpeg": {
    supplier_name: "The Home Depot",
    source_system: "gmail_home_depot_receipt",
    invoice_number: "7026-00060-21703", invoice_date: "2026-04-16", po_number: "ROSSMAN",
    amount_before_tax: 9.97, tax_amount: 1.30, total_amount: 11.27,
    store_number: "7026",
    store_address: "1900 Baseline Road, Ottawa, ON",
    lines: [["070798748200", "KS Ultra Wht", 1, 9.97, 9.97]],
  },
  "WhatsApp_Image_2026-04-14_at_5.30.16_PM.jpeg": {
    original_filename: "WhatsApp Image 2026-04-14 at 5.30.16 PM.jpeg",
    invoice_number: "OR017881", invoice_date: "2026-04-14", po_number: "SCOTT MADDEN",
    amount_before_tax: 42.45, tax_amount: 5.52, total_amount: 47.97,
    extraction_status: "needs_review",
    lines: [
      [null, "Receipt item (description obscured by card slip)", 1, 2.49, 2.49, null, null, true],
      [null, "Receipt item (description partially obscured)", 1, 16.99, 16.99, null, null, true],
      ["5010-64", "Receipt item 5010-64", 1, 13.99, 13.99, null, null, true],
      ["8629", "LINER F/PELICAN PAIL 3PK 946ML", 2, 4.49, 8.98],
    ],
  },
  "WhatsApp_Image_2026-04-07_at_6.59.53_PM.jpeg": {
    original_filename: "WhatsApp Image 2026-04-07 at 6.59.53 PM.jpeg",
    supplier_name: "The Home Depot",
    source_system: "gmail_home_depot_receipt",
    invoice_number: "7079-00060-10706", invoice_date: "2026-04-07", po_number: "VAN CLEEF",
    amount_before_tax: 47.64, tax_amount: 6.19, total_amount: 53.83,
    store_number: "7079",
    store_address: "3779 Strandherd Drive, Nepean, ON",
    lines: [
      ["772783120502", "2pk Vlr Rf1", 1, 5.67, 5.67],
      ["047719009146", "BIN PRIMER", 1, 41.97, 41.97],
    ],
  },
  "WhatsApp_Image_2026-04-06_at_6.12.24_PM.jpeg": {
    original_filename: "WhatsApp Image 2026-04-06 at 6.12.24 PM.jpeg",
    supplier_name: "Canadian Tire",
    source_system: "gmail_canadian_tire_receipt",
    invoice_number: "422-20260406-010177", invoice_date: "2026-04-06", po_number: "SCOTT MADDEN",
    amount_before_tax: 23.83, tax_amount: 3.10, total_amount: 26.93,
    store_number: "422",
    store_address: "3910 Innes Road, Ottawa, ON",
    lines: [
      ["069-1076-0", "ENERGIA alkaline battery", 1, 22.99, 22.99],
      ["398-6931-2", "Environmental fee", 1, 0.84, 0.84],
    ],
  },
  "CaledonianReceiptAPR9th2026.jpeg": {
    invoice_number: "OR017775", invoice_date: "2026-04-09", po_number: "CRUICK SHANK",
    amount_before_tax: 143.62, tax_amount: 18.68, total_amount: 162.30,
    lines: [
      ["F5491X-001", "REGAL EGGSHELL BASE-1 3.79L", 2, 67.32, 134.64, "OC-19", "Seapearl"],
      ["8629", "LINER F/PELICAN PAIL 3PK 946ML", 2, 4.49, 8.98],
    ],
  },
  "OttawaPaintersReceiptAPR222026.jpeg": {
    invoice_number: "OR018088", invoice_date: "2026-04-22", po_number: "ISSA DAOUD",
    amount_before_tax: 162.96, tax_amount: 21.19, total_amount: 184.15,
    lines: [
      ["F5383X-001", "ULTRASPEC EGGSHELL BASE-3 3.79L", 2, 40.74, 81.48, "1666", "In the Midnight Hour"],
      ["F5381X-001", "ULTRASPEC EGGSHELL BASE-1 3.79L", 2, 40.74, 81.48, "OC-25", "Cloud Cover"],
    ],
  },
  "OttawaPaintersReceiptAPR302026.jpeg": {
    invoice_number: "OR018281", invoice_date: "2026-04-30", po_number: null,
    amount_before_tax: 67.32, tax_amount: 8.76, total_amount: 76.08,
    lines: [["F5491X-001", "REGAL EGGSHELL BASE-1 3.79L", 1, 67.32, 67.32, "OC-45", "Swiss Coffee"]],
  },
  "OttawaPaintersReceiptMAY062026.jpeg": {
    invoice_number: "OR018443", invoice_date: "2026-05-06", po_number: null,
    amount_before_tax: 62.85, tax_amount: 8.18, total_amount: 71.03,
    lines: [["F6281X-001", "BEN INT LTX SATN/PRL BASE 1 GAL", 1, 62.85, 62.85, null, "Ginger Sugar"]],
  },
  "OttawaPaintersInvoiceHuot.jpeg.jpeg": {
    invoice_number: "OR019341", invoice_date: "2026-06-04", po_number: "HUOT",
    amount_before_tax: 23.99, tax_amount: 3.12, total_amount: 27.11,
    lines: [["SXA11009F-04", "PRIMER BONDING ACRYLIC STIX WHITE 946ML", 1, 23.99, 23.99]],
  },
  "OttawaPaintersInvoiceGoulet.jpeg": {
    invoice_number: "OR019342", invoice_date: "2026-06-04", po_number: "GOULET",
    amount_before_tax: 278.26, tax_amount: 36.18, total_amount: 314.44,
    lines: [
      ["F5502X-001", "REGAL PEARL BASE 2 3.79L", 1, 67.32, 67.32, "HC-151", "Buckland Blue"],
      ["K5524X-001", "REGAL ULTI-MATTE BASE-4 3.79L", 1, 67.32, 67.32, "HC-157", "Narragansett Green"],
      ["F5503X-001", "REGAL PEARL BASE 3 3.79L", 1, 67.32, 67.32, "1624", "Westcott Navy"],
      ["K5522X-001", "REGAL ULTI-MATTE BASE 2 3.79L", 1, 67.32, 67.32, "2130-40", "Black Pepper"],
      ["8629", "LINER F/PELICAN PAIL 3PK 946ML", 2, 4.49, 8.98],
    ],
  },
  "OttawaPaintersInvoiceDanielle.jpeg": {
    invoice_number: "OR019343", invoice_date: "2026-06-04", po_number: "DANIELLE",
    amount_before_tax: 42.57, tax_amount: 5.54, total_amount: 48.11,
    lines: [
      ["F5501X-004", "REGAL PEARL BASE 1 946ML", 1, 29.59, 29.59, "OC-65", "Chantilly Lace"],
      ["STRAINER1G", "STRAINER NYLON ELASTIC 1GAL", 1, 2.99, 2.99],
      ["6253017", "CAN EMPTY METAL 3.78L W/LID & HANDLE", 1, 9.99, 9.99],
    ],
  },
  "OttawaPaintersInvoiceJune26th2026.jpeg": {
    invoice_number: "OR020039", invoice_date: "2026-06-26", po_number: "HARRIS",
    amount_before_tax: 67.32, tax_amount: 8.76, total_amount: 76.08,
    lines: [["F5491X-001", "REGAL EGGSHELL BASE-1 3.79L", 1, 67.32, 67.32, "OC-117", "Simply White"]],
  },
  "InvoiceOR020440.PDF": {
    invoice_number: "OR020440", invoice_date: "2026-07-09", po_number: "SCOTT",
    amount_before_tax: 115.30, tax_amount: 14.99, total_amount: 130.29,
    lines: [
      ["AQ040009F-04", "PRIMER WB AQUALOCK PLUS WH 946ML", 1, 18.39, 18.39, "CSP-95", "Sea Salt"],
      ["F5491X-004", "REGAL EGGSHELL BASE 1 946ML", 1, 29.59, 29.59, "CSP-95", "Sea Salt"],
      ["F5491X-001", "REGAL EGGSHELL BASE-1 3.79L", 1, 67.32, 67.32, "CSP-95", "Sea Salt"],
    ],
  },
};

function parsePreston(file, originalFilename) {
  const manifest = prestonManifest[originalFilename];
  if (!manifest) throw new Error(`No audited Preston extraction for ${originalFilename}`);
  const isPdf = originalFilename.toLowerCase().endsWith(".pdf");
  const text = execFileSync(isPdf ? "pdftotext" : "tesseract", isPdf ? ["-layout", file, "-"] : [file, "stdout"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const rawLines = manifest.lines.map((line, index) => ({
    line_number: index + 1,
    line_type: "product",
    sales_number: line[0],
    size: null,
    product_code: line[0],
    description: line[1],
    color_code: line[5] ?? null,
    color_name: line[6] ?? null,
    quantity: line[2],
    unit_price: line[3],
    gross_amount: line[4],
    discount_amount: 0,
    amount_before_tax: line[4],
    source_text: line.filter(Boolean).join(" · "),
    source_payload: { extraction: "audited_from_source_image_or_pdf" },
    needs_review: Boolean(line[7]),
  }));
  const supplierName = manifest.supplier_name ?? "Preston Paint Center";
  const sourceSystem = manifest.source_system ?? "gmail_preston_material_receipt";
  const externalInvoiceId =
    sourceSystem === "gmail_preston_material_receipt"
      ? `preston:${manifest.invoice_number}`
      : sourceSystem === "gmail_home_depot_receipt"
        ? `home-depot:${manifest.invoice_number}:${manifest.invoice_date}`
        : `canadian-tire:${manifest.invoice_number}`;
  return {
    source_system: sourceSystem,
    external_invoice_id: externalInvoiceId,
    supplier_name: supplierName,
    account_number: supplierName === "Preston Paint Center" ? "Ottawa Painters" : null,
    job_account: null,
    invoice_number: manifest.invoice_number,
    invoice_type: originalFilename === "InvoiceOR020440.PDF" ? "charge_invoice" : "cash_receipt",
    invoice_date: manifest.invoice_date,
    invoice_time: null,
    due_on: originalFilename === "InvoiceOR020440.PDF" ? null : manifest.invoice_date,
    po_number: manifest.po_number,
    order_number: null,
    store_number: manifest.store_number ?? "PPC-Orleans",
    store_address: manifest.store_address ?? "2023 Tenth Line Road, Orleans, ON K4A 4C5",
    received_by: null,
    currency: "CAD",
    amount_before_tax: manifest.amount_before_tax,
    tax_amount: manifest.tax_amount,
    total_amount: manifest.total_amount,
    extraction_status: manifest.extraction_status ?? "verified",
    source_text: text,
    source_payload: {
      audited_manifest: true,
      source_quality: isPdf ? "text_pdf" : "receipt_image_ocr_and_visual_review",
      original_filename: manifest.original_filename ?? originalFilename,
    },
    lines: allocateTax(rawLines, manifest.tax_amount, manifest.amount_before_tax),
  };
}

function assertInvoice(invoice, filename) {
  const beforeTax = roundMoney(invoice.lines.reduce((sum, line) => sum + line.amount_before_tax, 0));
  const tax = roundMoney(invoice.lines.reduce((sum, line) => sum + line.tax_amount, 0));
  const total = roundMoney(invoice.lines.reduce((sum, line) => sum + line.total_amount, 0));
  if (
    Math.abs(beforeTax - invoice.amount_before_tax) > 0.02 ||
    Math.abs(tax - invoice.tax_amount) > 0.02 ||
    Math.abs(total - invoice.total_amount) > 0.02 ||
    Math.abs(invoice.amount_before_tax + invoice.tax_amount - invoice.total_amount) > 0.02
  ) {
    throw new Error(`Arithmetic mismatch in ${filename}`);
  }
}

function fileMetadata(filename) {
  const match = filename.match(/^(home-depot|preston)--([^-]+)--(.+)$/);
  if (!match) throw new Error(`Unexpected supplier filename ${filename}`);
  return { vendor: match[1], messageId: match[2], originalFilename: match[3] };
}

const sourceFiles = readdirSync(sourceDir)
  .filter((filename) => {
    if (filename.startsWith("home-depot--")) return true;
    if (!filename.startsWith("preston--")) return false;
    return Boolean(prestonManifest[fileMetadata(filename).originalFilename]);
  })
  .sort();
const parsed = sourceFiles.map((filename) => {
  const metadata = fileMetadata(filename);
  const filePath = path.join(sourceDir, filename);
  const buffer = readFileSync(filePath);
  const invoice =
    metadata.vendor === "home-depot"
      ? parseHomeDepot(filePath)
      : parsePreston(filePath, metadata.originalFilename);
  assertInvoice(invoice, filename);
  const originalFilename = invoice.source_payload?.original_filename ?? metadata.originalFilename;
  const storageVendor =
    invoice.supplier_name === "The Home Depot"
      ? "home-depot"
      : invoice.supplier_name === "Canadian Tire"
        ? "canadian-tire"
        : "preston";
  return {
    ...metadata,
    originalFilename,
    storageVendor,
    filename,
    filePath,
    buffer,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    mimeType: metadata.originalFilename.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg",
    invoice,
  };
});

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

const report = {
  mode: apply ? "apply" : "dry-run",
  source_files: parsed.length,
  suppliers: Object.fromEntries(
    ["The Home Depot", "Preston Paint Center", "Canadian Tire"].map((supplier) => [
      supplier,
      parsed.filter((file) => file.invoice.supplier_name === supplier).length,
    ]),
  ),
  invoice_total: roundMoney(parsed.reduce((sum, file) => sum + file.invoice.total_amount, 0)),
  verified_arithmetic: parsed.length,
  imported_documents: 0,
  imported_invoices: 0,
  imported_lines: 0,
  ...(includeDetails
    ? {
        invoices: parsed.map((file) => ({
          supplier: file.invoice.supplier_name,
          invoice_number: file.invoice.invoice_number,
          invoice_date: file.invoice.invoice_date,
          po_number: file.invoice.po_number,
          before_tax: file.invoice.amount_before_tax,
          tax: file.invoice.tax_amount,
          total: file.invoice.total_amount,
          lines: file.invoice.lines.map((line) => ({
            product: line.description,
            quantity: line.quantity,
            before_tax: line.amount_before_tax,
          })),
        })),
      }
    : {}),
};

if (apply) {
  for (const file of parsed) {
    const storagePath = `${file.storageVendor}/${file.invoice.invoice_date.slice(0, 4)}/${file.messageId}/${file.originalFilename}`;
    const existing = await db
      .from("material_invoice_documents")
      .select("id")
      .eq("source_system", file.invoice.source_system)
      .eq("external_message_id", file.messageId)
      .eq("original_filename", file.originalFilename)
      .maybeSingle();
    if (existing.error) throw existing.error;
    let documentId = existing.data?.id ?? null;
    if (!documentId) {
      const upload = await db.storage.from("material-invoices").upload(storagePath, file.buffer, {
        contentType: file.mimeType,
        upsert: false,
      });
      if (upload.error && !/already exists/i.test(upload.error.message)) throw upload.error;
      const inserted = await db
        .from("material_invoice_documents")
        .insert({
          source_system: file.invoice.source_system,
          external_message_id: file.messageId,
          source_reference: `gmail:${file.messageId}`,
          document_date: file.invoice.invoice_date,
          original_filename: file.originalFilename,
          mime_type: file.mimeType,
          file_size: file.buffer.length,
          content_sha256: file.sha256,
          storage_bucket: "material-invoices",
          storage_path: storagePath,
          page_count: 1,
          extracted_text: file.invoice.source_text,
          source_payload: { gmail_message_id: file.messageId, supplier: file.invoice.supplier_name },
        })
        .select("id")
        .single();
      if (inserted.error) throw inserted.error;
      documentId = inserted.data.id;
      report.imported_documents += 1;
    }

    const invoice = file.invoice;
    const upserted = await db
      .from("material_invoices")
      .upsert(
        {
          document_id: documentId,
          ...Object.fromEntries(Object.entries(invoice).filter(([key]) => key !== "lines")),
          source_page_start: 1,
          source_page_end: 1,
          source_payload: {
            ...invoice.source_payload,
            gmail_message_id: file.messageId,
            document_filename: file.originalFilename,
            arithmetic_ok: true,
          },
        },
        { onConflict: "source_system,external_invoice_id" },
      )
      .select("id")
      .single();
    if (upserted.error) throw upserted.error;
    report.imported_invoices += 1;

    const currentLines = await db
      .from("material_invoice_lines")
      .select("id")
      .eq("material_invoice_id", upserted.data.id)
      .limit(1);
    if (currentLines.error) throw currentLines.error;
    if (currentLines.data?.length) continue;
    const insertedLines = await db.from("material_invoice_lines").insert(
      invoice.lines.map((line) => ({ material_invoice_id: upserted.data.id, ...line })),
    );
    if (insertedLines.error) throw insertedLines.error;
    report.imported_lines += invoice.lines.length;
  }
}

console.log(JSON.stringify(report, null, 2));
