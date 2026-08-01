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
          line
            .slice(separator + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
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

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function isoDate(value) {
  const match = String(value ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

function normalized(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(street|st\.?|road|rd\.?|avenue|ave\.?|crescent|cres\.?|court|ct\.?|drive|dr\.?|boulevard|blvd\.?|private|pvt\.?|lane|ln\.?|way)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshtein(left, right) {
  if (!left) return right.length;
  if (!right) return left.length;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const upper = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = upper;
    }
  }
  return previous[right.length];
}

function findLastMatch(text, expression) {
  const matches = [...text.matchAll(expression)];
  return matches.length ? matches.at(-1) : null;
}

function isLineHeader(line) {
  return (
    (line.includes("SALES NUMBER") && line.includes("DESCRIPTION") && line.includes("VALUE")) ||
    (line.includes("# VENTE") && line.includes("DESCRIPTION") && line.includes("VALEUR"))
  );
}

function parseDueOn(text, invoiceDate) {
  const match = text.match(/DUE ON\s+([A-Z]+)\.?\s+(\d{1,2})(?:ST|ND|RD|TH)?/i);
  if (!match || !invoiceDate) return null;
  const monthNames = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  ];
  const month = monthNames.findIndex((name) => match[1].toUpperCase().startsWith(name));
  if (month < 0) return null;
  const invoiceYear = Number(invoiceDate.slice(0, 4));
  const invoiceMonth = Number(invoiceDate.slice(5, 7)) - 1;
  const year = month < invoiceMonth ? invoiceYear + 1 : invoiceYear;
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
}

function lineColumns(page) {
  const header = page
    .split("\n")
    .find(isLineHeader);
  if (!header) return null;
  const french = header.includes("# VENTE");
  return {
    sales: header.indexOf(french ? "# VENTE" : "SALES NUMBER"),
    size: header.indexOf(french ? "FORMAT" : "SIZE"),
    product: header.indexOf(french ? "PRODUIT" : "PRODUCT"),
    description: header.indexOf("DESCRIPTION"),
    quantity: header.indexOf(french ? "QTE" : "QTY"),
    price: header.indexOf(french ? "PRIX" : "PRICE"),
    value: header.indexOf(french ? "VALEUR" : "VALUE"),
  };
}

function allocateTax(lines, invoiceTax, invoiceSubtotal) {
  if (!lines.length) return lines;
  let remaining = roundMoney(invoiceTax);
  return lines.map((line, index) => {
    const isLast = index === lines.length - 1;
    const share =
      isLast || Math.abs(invoiceSubtotal) < 0.005
        ? remaining
        : roundMoney(invoiceTax * (line.amount_before_tax / invoiceSubtotal));
    remaining = roundMoney(remaining - share);
    return {
      ...line,
      tax_amount: share,
      total_amount: roundMoney(line.amount_before_tax + share),
    };
  });
}

function parseLines(page, invoiceSubtotal, invoiceTax) {
  const columns = lineColumns(page);
  if (!columns) return [];
  const rows = page.split("\n");
  const headerIndex = rows.findIndex(isLineHeader);
  const lines = [];
  let current = null;
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.includes("Thank You") || /^\s*Merci\b/i.test(row)) break;
    if (row.includes("SUBTOTAL BEFORE TAX") || row.includes("CORRECTED TOTALS")) continue;
    if (/^\s*[.*-]{12,}/.test(row)) continue;

    const salesNumber = row.match(/^\s*(\d{3,4}-\d{4,5})\s+/)?.[1] ?? null;
    const description = row.slice(columns.description, columns.quantity).trim();
    const productAmounts = row.match(
      /(-?(?:\d[\d,]*|\d*\.\d+)\*?)\s+(-?(?:\d[\d,]*|\d*\.\d+)\*?)\s+(-?(?:\d[\d,]*|\d*\.\d+))\s*$/,
    );
    const trailingAmount = row.match(/([$()\-]?\d[\d,.]*|[$()\-]?\.\d+)\s*$/)?.[1];
    const value = money(productAmounts?.[3] ?? trailingAmount);

    if (current && /\bDISCOUNT\b/i.test(row)) {
      const discount = value ?? 0;
      current.discount_amount = roundMoney(current.discount_amount + discount);
      current.amount_before_tax = roundMoney(current.amount_before_tax + discount);
      current.source_text += `\n${row.trim()}`;
      continue;
    }

    if (salesNumber) {
      current = {
        line_number: lines.length + 1,
        line_type: value != null && value < 0 ? "return" : "product",
        sales_number: salesNumber,
        size: row.slice(columns.size, columns.product).trim() || null,
        product_code: row.slice(columns.product, columns.description).trim() || null,
        description: description || salesNumber,
        color_code: null,
        color_name: null,
        quantity: money(productAmounts?.[1] ?? row.slice(columns.quantity, columns.price)),
        unit_price: money(productAmounts?.[2] ?? row.slice(columns.price, columns.value)),
        gross_amount: value ?? 0,
        discount_amount: 0,
        amount_before_tax: value ?? 0,
        tax_amount: 0,
        total_amount: value ?? 0,
        source_text: row.trim(),
        needs_review: value == null,
      };
      lines.push(current);
      continue;
    }

    if (!current || !description) continue;
    if (/^Color:/i.test(description)) {
      const color = description.replace(/^Color:\s*/i, "").trim();
      const colorMatch = color.match(/^([A-Z]{1,4}\d{2,5})\s+(.+)$/i);
      current.color_code = colorMatch?.[1] ?? null;
      current.color_name = colorMatch?.[2]?.trim() ?? color;
      current.source_text += `\n${row.trim()}`;
      continue;
    }
    if (/^(Pricing Accommodation|ORIGINAL|TERM:|TRAN:|DATE:|REASON:)/i.test(description)) {
      current.source_text += `\n${row.trim()}`;
      continue;
    }
    if (!current.color_name && current.color_code) {
      current.color_name = `${current.color_name ?? ""} ${description}`.trim();
    } else if (!current.description.includes(description)) {
      current.description = `${current.description} ${description}`.trim();
    }
    current.source_text += `\n${row.trim()}`;
  }

  const parsedSubtotal = roundMoney(lines.reduce((sum, line) => sum + line.amount_before_tax, 0));
  const difference = roundMoney(invoiceSubtotal - parsedSubtotal);
  if (lines.length && Math.abs(difference) <= 0.02 && Math.abs(difference) > 0.005) {
    lines.at(-1).amount_before_tax = roundMoney(lines.at(-1).amount_before_tax + difference);
  }
  return allocateTax(lines, invoiceTax, invoiceSubtotal);
}

function parseInvoicePage(page, pageNumber) {
  if (!/\b(?:INVOICE|CREDIT|CORRECT|FACTURE)\b/.test(page) || !page.split("\n").some(isLineHeader)) return null;
  const invoiceNumber = page.match(/\bNo\.\s*([A-Z0-9-]+)/i)?.[1] ?? null;
  const accountNumber = page.match(/(?:ACCOUNT|COMPTE):\s*([0-9-]+)/i)?.[1] ?? null;
  const storeNumber = page.match(/\bStore\s+(\d+)/i)?.[1] ?? null;
  const invoiceDate = isoDate(page.match(/\bDATE:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]);
  const invoiceTime = page.match(/\b(?:TIME|HEURE):\s*(\d{1,2}:\d{2})\s*(AM|PM)/i);
  const poNumber = page.match(/\bPO#[ \t]*([^\n\r]*)/i)?.[1]?.trim() || null;
  const orderNumber = page.match(/\bORDER:\s*([^\s\n\r]+)/i)?.[1]?.trim() ?? null;
  const subtotalMatch = findLastMatch(
    page,
    /(?:SUBTOTAL BEFORE TAX|TOTAL AVANT TAXES)\s+([$()\-\d,.]+)/gi,
  );
  const taxMatches = [...page.matchAll(/13\.000%[^\n]*?([$()\-\d,.]+)\s*$/gim)];
  const totalMatch = findLastMatch(
    page,
    /(?:CHARGE CREDIT|CHARGE|CHARG|CASH|TOTAL)\s+\$?([$()\-\d,.]+)\s*$/gim,
  );
  const amountBeforeTax = money(subtotalMatch?.[1]);
  const totalAmount = money(totalMatch?.[1]);
  const printedTax = money(taxMatches.at(-1)?.[1]);
  const taxAmount =
    amountBeforeTax != null && totalAmount != null
      ? roundMoney(totalAmount - amountBeforeTax)
      : printedTax;
  if (!invoiceNumber || !invoiceDate || amountBeforeTax == null || taxAmount == null || totalAmount == null) {
    return {
      page_number: pageNumber,
      error: "Missing invoice number, date, subtotal, tax, or total",
      source_text: page,
    };
  }

  const lines = parseLines(page, amountBeforeTax, taxAmount);
  const lineSubtotal = roundMoney(lines.reduce((sum, line) => sum + line.amount_before_tax, 0));
  const lineTax = roundMoney(lines.reduce((sum, line) => sum + line.tax_amount, 0));
  const arithmeticOk =
    Math.abs(amountBeforeTax + taxAmount - totalAmount) <= 0.02 &&
    Math.abs(lineSubtotal - amountBeforeTax) <= 0.02 &&
    Math.abs(lineTax - taxAmount) <= 0.02 &&
    lines.length > 0;
  const receivedBy =
    page.match(/MERCHANDISE RECEIVED IN GOOD ORDER BY:\s*\n\s*([^\n\r]+)/i)?.[1]?.trim() ??
    page.match(/MARCHANDISE RECUE EN BON ETAT PAR:\s*\n\s*([^\n\r]+)/i)?.[1]?.trim() ??
    page.match(/ORDERED BY:\s*([^\n\r]+)/i)?.[1]?.trim() ??
    null;

  return {
    page_number: pageNumber,
    page_end: pageNumber,
    source_system: "sherwin_daily_email",
    external_invoice_id: [accountNumber, storeNumber, invoiceNumber, invoiceDate].join("|"),
    supplier_name: "Sherwin-Williams Canada",
    account_number: accountNumber,
    job_account: page.match(/\bJOB\s+([^\n\r]+)/i)?.[1]?.trim() ?? null,
    invoice_number: invoiceNumber,
    invoice_type: /\bCREDIT\b/.test(page) ? "credit_memo" : "charge_invoice",
    invoice_date: invoiceDate,
    invoice_time: invoiceTime
      ? `${String((Number(invoiceTime[1].split(":")[0]) % 12) + (invoiceTime[2].toUpperCase() === "PM" ? 12 : 0)).padStart(2, "0")}:${invoiceTime[1].split(":")[1]}:00`
      : null,
    due_on: parseDueOn(page, invoiceDate),
    po_number: poNumber,
    order_number: orderNumber,
    store_number: storeNumber,
    received_by: receivedBy,
    currency: "CAD",
    amount_before_tax: amountBeforeTax,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    extraction_status: arithmeticOk ? "verified" : "needs_review",
    source_text: page,
    lines,
    arithmetic_ok: arithmeticOk,
  };
}

function parsePdf(filePath) {
  const buffer = readFileSync(filePath);
  const text = execFileSync("pdftotext", ["-layout", filePath, "-"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const pages = text.split("\f").filter((page) => page.trim());
  const invoices = [];
  const groups = [];
  pages.forEach((page, index) => {
    const invoiceNumber = page.match(/\bNo\.\s*([A-Z0-9-]+)/i)?.[1] ?? null;
    const previous = groups.at(-1);
    if (previous && invoiceNumber && invoiceNumber === previous.invoiceNumber) {
      previous.pages.push(page);
      previous.pageEnd = index + 1;
      return;
    }
    groups.push({
      invoiceNumber,
      pages: [page],
      pageStart: index + 1,
      pageEnd: index + 1,
    });
  });
  groups.forEach((group) => {
    const parsed = parseInvoicePage(group.pages.join("\n\f"), group.pageStart);
    if (!parsed) return;
    parsed.page_end = group.pageEnd;
    invoices.push(parsed);
  });
  return {
    buffer,
    text,
    pages,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    invoices,
  };
}

function projectMatcher(projects) {
  const active = projects.filter((project) => !project.is_deleted && !project.is_lead);
  const overheadPatterns = /\b(supplies|sundries|blue bucket|stock|shop|office|tools?)\b/i;
  return (poNumber) => {
    const po = normalized(poNumber);
    if (!po) return { kind: "unmatched", reason: "PO missing" };
    if (overheadPatterns.test(poNumber)) {
      return { kind: "overhead", category: "General paint supplies", method: "overhead_rule" };
    }

    const scored = active
      .map((project) => {
        const name = normalized(project.name);
        const address = normalized(project.formatted_address);
        const nameWords = name.split(" ").filter(Boolean);
        const addressPrefix = address.split(" ").slice(0, 4).join(" ");
        const lastName = nameWords.at(-1) ?? "";
        let score = 0;
        let method = "customer_exact";
        if (po === name || (po.length >= 5 && name.includes(po))) score = 1;
        else if (po === lastName) score = 0.99;
        else if (/\d/.test(po) && (address.includes(po) || po.includes(addressPrefix))) {
          score = 1;
          method = "address_exact";
        } else if (po.length >= 5 && lastName.length >= 5) {
          const distance = levenshtein(po, lastName);
          if (distance <= 1) score = 0.95;
          else if (distance === 2 && Math.max(po.length, lastName.length) >= 7) score = 0.9;
        }
        return { project, score, method };
      })
      .filter((candidate) => candidate.score >= 0.9)
      .sort((left, right) => right.score - left.score);
    if (!scored.length) return { kind: "unmatched", reason: `No project matched PO ${poNumber}` };
    if (scored.length > 1 && scored[0].score === scored[1].score) {
      return { kind: "unmatched", reason: `Ambiguous PO ${poNumber}` };
    }
    return {
      kind: "job",
      project: scored[0].project,
      confidence: scored[0].score,
      method: scored[0].method,
    };
  };
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

const projects = await fetchAll(() =>
  db
    .from("companycam_projects")
    .select("companycam_id,name,formatted_address,is_deleted,is_lead,is_archived"),
);
const matchProject = projectMatcher(projects);
const files = readdirSync(sourceDir)
  .filter((filename) => filename.endsWith(".pdf") && filename.includes("--INVOICES-E_"))
  .sort();
const parsedFiles = files.map((filename) => {
  const [messageId, originalFilename] = filename.split("--", 2);
  return {
    filename,
    messageId,
    originalFilename,
    parsed: parsePdf(path.join(sourceDir, filename)),
  };
});

const audit = {
  mode: apply ? "apply" : "dry-run",
  source_files: files.length,
  source_pages: parsedFiles.reduce((sum, file) => sum + file.parsed.pages.length, 0),
  parsed_invoices: parsedFiles.reduce((sum, file) => sum + file.parsed.invoices.filter((invoice) => !invoice.error).length, 0),
  unparsed_pages: [],
  parse_errors: [],
  arithmetic_review: [],
  project_matched: 0,
  overhead_matched: 0,
  job_unmatched: 0,
  unmatched_pos: {},
  imported_documents: 0,
  imported_invoices: 0,
  imported_lines: 0,
  imported_allocations: 0,
};

for (const file of parsedFiles) {
  const parsedPageNumbers = new Set(
    file.parsed.invoices.flatMap((invoice) =>
      Array.from(
        { length: invoice.page_end - invoice.page_number + 1 },
        (_, index) => invoice.page_number + index,
      ),
    ),
  );
  file.parsed.pages.forEach((page, index) => {
    if (!parsedPageNumbers.has(index + 1)) {
      audit.unparsed_pages.push({
        file: file.filename,
        page: index + 1,
        excerpt: page.replace(/\s+/g, " ").trim().slice(0, 180),
      });
    }
  });
  for (const invoice of file.parsed.invoices) {
    if (invoice.error) {
      audit.parse_errors.push({ file: file.filename, page: invoice.page_number, error: invoice.error });
      continue;
    }
    invoice.match = matchProject(invoice.po_number);
    if (!invoice.arithmetic_ok) {
      audit.arithmetic_review.push({
        file: file.filename,
        page: invoice.page_number,
        invoice: invoice.invoice_number,
        po: invoice.po_number,
        subtotal: invoice.amount_before_tax,
        line_total: roundMoney(invoice.lines.reduce((sum, line) => sum + line.amount_before_tax, 0)),
      });
    }
    if (invoice.match.kind === "job") audit.project_matched += 1;
    else if (invoice.match.kind === "overhead") audit.overhead_matched += 1;
    else {
      audit.job_unmatched += 1;
      const po = invoice.po_number || "(missing PO)";
      audit.unmatched_pos[po] = (audit.unmatched_pos[po] ?? 0) + 1;
    }
  }
}

if (apply) {
  for (const file of parsedFiles) {
    const documentDateMatch = file.originalFilename.match(/_(\d{4})(\d{2})(\d{2})/);
    const documentDate = documentDateMatch
      ? `${documentDateMatch[1]}-${documentDateMatch[2]}-${documentDateMatch[3]}`
      : null;
    const storageYear = documentDate?.slice(0, 4) ?? "unknown-year";
    const storagePath = `sherwin/${storageYear}/${file.messageId}/${file.originalFilename}`;
    const existingDocument = await db
      .from("material_invoice_documents")
      .select("id")
      .eq("content_sha256", file.parsed.sha256)
      .maybeSingle();
    if (existingDocument.error) throw existingDocument.error;
    let documentId = existingDocument.data?.id ?? null;
    if (!documentId) {
      const upload = await db.storage
        .from("material-invoices")
        .upload(storagePath, file.parsed.buffer, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (upload.error && !/already exists/i.test(upload.error.message)) throw upload.error;
      const inserted = await db
        .from("material_invoice_documents")
        .insert({
          source_system: "gmail_sherwin_daily_invoices",
          external_message_id: file.messageId,
          source_reference: `gmail:${file.messageId}`,
          document_date: documentDate,
          original_filename: file.originalFilename,
          mime_type: "application/pdf",
          file_size: file.parsed.buffer.length,
          content_sha256: file.parsed.sha256,
          storage_bucket: "material-invoices",
          storage_path: storagePath,
          page_count: file.parsed.pages.length,
          extracted_text: file.parsed.text,
          source_payload: { gmail_message_id: file.messageId },
        })
        .select("id")
        .single();
      if (inserted.error) throw inserted.error;
      documentId = inserted.data.id;
      audit.imported_documents += 1;
    }

    for (const invoice of file.parsed.invoices) {
      if (invoice.error) continue;
      const upsertedInvoice = await db
        .from("material_invoices")
        .upsert(
          {
            document_id: documentId,
            source_system: invoice.source_system,
            external_invoice_id: invoice.external_invoice_id,
            source_page_start: invoice.page_number,
            source_page_end: invoice.page_end,
            supplier_name: invoice.supplier_name,
            account_number: invoice.account_number,
            job_account: invoice.job_account,
            invoice_number: invoice.invoice_number,
            invoice_type: invoice.invoice_type,
            invoice_date: invoice.invoice_date,
            invoice_time: invoice.invoice_time,
            due_on: invoice.due_on,
            po_number: invoice.po_number,
            order_number: invoice.order_number,
            store_number: invoice.store_number,
            received_by: invoice.received_by,
            currency: invoice.currency,
            amount_before_tax: invoice.amount_before_tax,
            tax_amount: invoice.tax_amount,
            total_amount: invoice.total_amount,
            extraction_status: invoice.extraction_status,
            source_text: invoice.source_text,
            source_payload: {
              gmail_message_id: file.messageId,
              document_filename: file.originalFilename,
              arithmetic_ok: invoice.arithmetic_ok,
              project_match: invoice.match,
            },
          },
          { onConflict: "source_system,external_invoice_id" },
        )
        .select("id")
        .single();
      if (upsertedInvoice.error) throw upsertedInvoice.error;
      const invoiceId = upsertedInvoice.data.id;
      audit.imported_invoices += 1;

      const existingLines = await db
        .from("material_invoice_lines")
        .select("id")
        .eq("material_invoice_id", invoiceId)
        .limit(1);
      if (existingLines.error) throw existingLines.error;
      if (existingLines.data?.length) continue;

      const insertedLines = await db
        .from("material_invoice_lines")
        .insert(
          invoice.lines.map((line) => ({
            material_invoice_id: invoiceId,
            ...line,
            source_payload: {},
          })),
        )
        .select("id,line_number,amount_before_tax,tax_amount,total_amount");
      if (insertedLines.error) throw insertedLines.error;
      audit.imported_lines += insertedLines.data.length;

      if (invoice.match.kind === "unmatched") continue;
      const allocations = insertedLines.data.map((line) => ({
        material_invoice_line_id: line.id,
        allocation_scope: invoice.match.kind === "job" ? "job" : "overhead",
        companycam_project_id:
          invoice.match.kind === "job" ? invoice.match.project.companycam_id : null,
        overhead_category:
          invoice.match.kind === "overhead" ? invoice.match.category : null,
        allocated_before_tax: line.amount_before_tax,
        allocated_tax: line.tax_amount,
        allocated_total: line.total_amount,
        allocation_method: invoice.match.method,
        evidence_reference: `Sherwin PO# ${invoice.po_number}`,
        confidence: invoice.match.kind === "job" ? invoice.match.confidence : 1,
        needs_review: false,
        source_payload:
          invoice.match.kind === "job"
            ? { project_name: invoice.match.project.name }
            : { rule: "supplier PO identifies company supplies" },
      }));
      const insertedAllocations = await db
        .from("material_invoice_line_allocations")
        .insert(allocations);
      if (insertedAllocations.error) throw insertedAllocations.error;
      audit.imported_allocations += allocations.length;
    }
  }
}

audit.unmatched_pos = Object.fromEntries(
  Object.entries(audit.unmatched_pos).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  ),
);

console.log(JSON.stringify(audit, null, 2));
