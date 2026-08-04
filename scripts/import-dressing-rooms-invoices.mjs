#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const APPLY = process.argv.includes("--apply");
const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const attachmentRoot = "/Users/jadslim/.workspace-mcp/attachments";

const invoices = [
  {
    number: "393",
    date: "2026-01-16",
    subtotal: 180,
    tax: 23.4,
    total: 203.4,
    messageId: "19bc8f2d85df7364",
    file: "Invoice_393_from_Dressing_Rooms_fdd5ade2.pdf",
    lines: [["2026-01-16", "Bethan Elliott", 180]],
  },
  {
    number: "395",
    date: "2026-01-23",
    subtotal: 720,
    tax: 93.6,
    total: 813.6,
    messageId: "19bebf9c67d24312",
    file: "Invoice_395_from_Dressing_Rooms_412dd95a.pdf",
    lines: [
      ["2026-01-20", "Jillian Morgan", 180],
      ["2026-01-21", "Tom Benton", 180],
      ["2026-01-22", "Natasha Kawan", 180],
      ["2026-01-22", "Marilyn Hingorani", 180],
    ],
  },
  {
    number: "396",
    date: "2026-01-30",
    subtotal: 540,
    tax: 70.2,
    total: 610.2,
    messageId: "19c102cb0e55116f",
    file: "Invoice_396_from_Dressing_Rooms_954612cf.pdf",
    lines: [
      ["2026-01-27", "Nixon-Janssen", 180],
      ["2026-01-28", "Leclair", 180],
      ["2026-01-28", "McGuire", 180],
    ],
  },
  {
    number: "397",
    date: "2026-02-13",
    subtotal: 360,
    tax: 46.8,
    total: 406.8,
    messageId: "19c5807b27ddf297",
    file: "Invoice_397_from_Dressing_Rooms_62077746.pdf",
    lines: [
      ["2026-02-10", "Sukaina Okorofsky", 180],
      ["2026-02-10", "Courtney Mondoux", 180],
    ],
  },
  {
    number: "400",
    date: "2026-02-20",
    subtotal: 180,
    tax: 23.4,
    total: 203.4,
    messageId: "19c7ba62c43d7bd9",
    file: "Invoice_400_from_Dressing_Rooms_ffc93e77.pdf",
    lines: [["2026-02-18", "Kim Johnston", 180]],
  },
  {
    number: "401",
    date: "2026-02-26",
    subtotal: 270,
    tax: 35.1,
    total: 305.1,
    messageId: "19c9fba402aa4d99",
    file: "Invoice_401_from_Dressing_Rooms_4dcde700.pdf",
    lines: [
      ["2026-02-24", "Libby Boulianne", 180],
      ["2026-02-25", "Kristy — short phone consultation", 90],
    ],
  },
  {
    number: "403",
    date: "2026-03-06",
    subtotal: 540,
    tax: 70.2,
    total: 610.2,
    messageId: "19cc48aec7fa472c",
    file: "Invoice_403_from_Dressing_Rooms_ff1a5711.pdf",
    lines: [
      ["2026-03-04", "Gregg Alexander", 180],
      ["2026-03-04", "Noah Rossman", 180],
      ["2026-03-05", "Laura Van Cleef", 180],
    ],
  },
  {
    number: "405",
    date: "2026-03-20",
    subtotal: 180,
    tax: 23.4,
    total: 203.4,
    messageId: "19d0d57e337efaaf",
    file: "Invoice_405_from_Dressing_Rooms_e1ee5b02.pdf",
    lines: [["2026-03-14", "Debbie Lundin", 180]],
  },
  {
    number: "406",
    date: "2026-03-28",
    subtotal: 720,
    tax: 93.6,
    total: 813.6,
    messageId: "19d34d7a5336638f",
    file: "Invoice_406_from_Dressing_Rooms_a6aab355.pdf",
    lines: [
      ["2026-03-25", "Gord Stockdale", 180],
      ["2026-03-27", "Heather Thomsen", 180],
      ["2026-03-27", "Sarah Cruikshank", 180],
      ["2026-03-27", "Yacoub Abdulla", 180],
    ],
  },
  {
    number: "407",
    date: "2026-04-03",
    subtotal: 180,
    tax: 23.4,
    total: 203.4,
    messageId: "19d53a4dfe0a5393",
    file: "Invoice_407_from_Dressing_Rooms_ddaea047.pdf",
    lines: [["2026-04-02", "Matt Mitchell", 180]],
  },
  {
    number: "409",
    date: "2026-04-30",
    subtotal: 720,
    tax: 93.6,
    total: 813.6,
    messageId: "19ddff92c7e2a812",
    file: "Invoice_409_from_Dressing_Rooms_f4b6c6c4.pdf",
    lines: [
      ["2026-04-16", "Dever Jylha", 180],
      ["2026-04-16", "Marianne Graham — phone consultation", 90],
      ["2026-04-22", "Sue Dulaney", 180],
      ["2026-04-22", "Roslyn Adu — phone consultation", 90],
      ["2026-04-23", "Alexandra Mackenzie", 180],
    ],
  },
  {
    number: "411",
    date: "2026-05-28",
    subtotal: 540,
    tax: 70.2,
    total: 610.2,
    messageId: "19e6fba78f5325d7",
    file: "Invoice_411_from_Dressing_Rooms_e081a6b3.pdf",
    lines: [
      ["2026-05-01", "Paul Toonders", 180],
      ["2026-05-20", "Kirsty Harris", 180],
      ["2026-05-20", "David Rennie", 180],
    ],
  },
  {
    number: "412",
    date: "2026-07-02",
    subtotal: 540,
    tax: 70.2,
    total: 610.2,
    messageId: "19f22dc3373b259c",
    file: "Invoice_412_from_Dressing_Rooms_3f28ff41.pdf",
    lines: [
      ["2026-06-04", "Phil Anido", 180],
      ["2026-06-24", "Corey Parsons", 180],
      ["2026-06-25", "Barry Dollin", 180],
    ],
  },
  {
    number: "414",
    date: "2026-07-31",
    subtotal: 1260,
    tax: 163.8,
    total: 1423.8,
    messageId: "19fb96bf3d770c37",
    file: "Invoice_414_from_Dressing_Rooms_70167d1c.pdf",
    lines: [
      ["2026-07-02", "Sally Bidal", 180],
      ["2026-07-03", "Diane Benoit", 180],
      ["2026-07-08", "Chris Jupp", 180],
      ["2026-07-16", "Lorraine Ulrick", 180],
      ["2026-07-22", "Jon Roebuck", 180],
      ["2026-07-29", "Pauline Burton", 180],
      ["2026-07-30", "Isabelle Alvarez", 180],
    ],
  },
];

const payments = [
  ["c221bae2-b14a-4752-beb0-45b4568fd6c4", [["393", 203.4]]],
  ["36e3744f-3c39-46b0-a317-780223c19f3c", [["395", 813.6]]],
  ["af837b81-0a25-4b64-b931-c0f559c69028", [["396", 610.2]]],
  [
    "ebb21991-8a1f-4e7d-8496-91fcfe354893",
    [
      ["397", 406.8],
      ["400", 203.4],
    ],
  ],
  ["9ec344ff-c117-4258-862b-1e6f1f3fc203", [["401", 305.1]]],
  ["bd2fa756-1bb2-429c-8a7e-2b84886b4405", [["403", 610.02]]],
  ["44251181-bf19-4998-b494-80864ad2a522", [["405", 203.4]]],
  ["437b0352-fdc6-4231-b8e2-a2d5266b7378", [["406", 813.6]]],
  ["2800bf38-eb6c-4f0e-b7d4-768966c02a98", [["407", 203.4]]],
  ["09995281-3f48-4abc-bfd5-85aaba8ece09", [["409", 813.6]]],
  ["2f237783-e5bd-4766-88cd-186522097622", [["411", 610.2]]],
  ["269beeb1-843e-4515-9b64-8f2858c7fc37", [["412", 610.2]]],
];

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

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertResult(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

for (const invoice of invoices) {
  assert(
    existsSync(path.join(attachmentRoot, invoice.file)),
    `Missing ${invoice.file}`,
  );
  assert(
    roundMoney(invoice.lines.reduce((sum, line) => sum + line[2], 0)) ===
      invoice.subtotal,
    `Invoice ${invoice.number} line subtotal mismatch.`,
  );
  assert(
    roundMoney(invoice.subtotal + invoice.tax) === invoice.total,
    `Invoice ${invoice.number} total mismatch.`,
  );
}

const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey)
  throw new Error("Missing Supabase credentials.");
assert(
  new URL(supabaseUrl).hostname.split(".")[0] === TARGET_PROJECT_REF,
  "Unexpected Supabase project.",
);
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const paymentIds = payments.map(([id]) => id);
const [existingContractors, existingInvoices, bankRows, activeAllocations] =
  await Promise.all([
    db
      .from("labour_contractors")
      .select("*")
      .eq("supplier_name", "Dressing Rooms"),
    db
      .from("labour_invoices")
      .select("*")
      .eq("supplier_name", "Dressing Rooms"),
    db
      .from("financial_transactions")
      .select("id,posted_on,description,amount,source_data")
      .in("id", paymentIds),
    db
      .from("labour_payment_allocations")
      .select("*")
      .in("financial_transaction_id", paymentIds)
      .is("reversed_at", null),
  ]);
for (const [label, result] of Object.entries({
  existingContractors,
  existingInvoices,
  bankRows,
  activeAllocations,
}))
  assertResult(label, result);
assert(
  bankRows.data.length === paymentIds.length,
  "One or more Dressing Rooms bank rows are missing.",
);
for (const [id, allocations] of payments) {
  const bank = bankRows.data.find((row) => row.id === id);
  const expected = roundMoney(
    allocations.reduce((sum, [, amount]) => sum + amount, 0),
  );
  assert(
    roundMoney(Math.abs(bank.amount)) === expected,
    `Payment ${id} amount mismatch.`,
  );
}

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      invoices: invoices.length,
      printed_lines: invoices.reduce(
        (sum, invoice) => sum + invoice.lines.length,
        0,
      ),
      payment_rows: payments.length,
      allocated: roundMoney(
        payments.reduce(
          (sum, [, rows]) =>
            sum + rows.reduce((subtotal, [, amount]) => subtotal + amount, 0),
          0,
        ),
      ),
      invoice_hst: roundMoney(
        invoices.reduce((sum, invoice) => sum + invoice.tax, 0),
      ),
      existing_invoices: existingInvoices.data.length,
      existing_allocations: activeAllocations.data.length,
    },
    null,
    2,
  ),
);

if (!APPLY) {
  console.log("Dry run only. Re-run with --apply.");
  process.exit(0);
}

const now = new Date().toISOString();
let contractor = existingContractors.data[0];
if (!contractor) {
  contractor = assertResult(
    "contractor insert",
    await db
      .from("labour_contractors")
      .insert({
        supplier_name: "Dressing Rooms",
        is_active: true,
        notes: "Darlene colour-consultation supplier · HST 868151010RT0001",
      })
      .select("*")
      .single(),
  );
}

const invoiceByNumber = new Map(
  existingInvoices.data.map((invoice) => [invoice.invoice_number, invoice]),
);
for (const source of invoices) {
  const pdfPath = path.join(attachmentRoot, source.file);
  const pdf = readFileSync(pdfPath);
  const hash = createHash("sha256").update(pdf).digest("hex");
  const storagePath = `gmail-labour-invoices/${source.date}/${hash.slice(0, 16)}-${source.date} - Invoice ${source.number} - Dressing Rooms.pdf`;
  let invoice = invoiceByNumber.get(source.number);
  if (!invoice) {
    const upload = await db.storage
      .from("labour-invoices")
      .upload(storagePath, pdf, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (upload.error && !/already exists/i.test(upload.error.message))
      throw upload.error;
    invoice = assertResult(
      `invoice ${source.number} insert`,
      await db
        .from("labour_invoices")
        .insert({
          contractor_id: contractor.id,
          supplier_name: "Dressing Rooms",
          invoice_number: source.number,
          invoice_date: source.date,
          currency: "CAD",
          amount_paid: source.total,
          amount_before_tax: source.subtotal,
          tax_amount: source.tax,
          payment_basis: "invoice_total",
          document_type: "invoice",
          match_status: "unmatched",
          storage_bucket: "labour-invoices",
          storage_path: storagePath,
          original_filename: source.file,
          mime_type: "application/pdf",
          file_size: statSync(pdfPath).size,
          content_sha256: hash,
          source_date: source.date,
          source_label: "Gmail / Dressing Rooms invoices",
          duplicate_group_size: 1,
          text_excerpt: `Dressing Rooms invoice ${source.number}. HST registration 868151010RT0001. Source Gmail message ${source.messageId}.`,
        })
        .select("*")
        .single(),
    );
    invoiceByNumber.set(source.number, invoice);

    const lineTax = source.lines.map((line) => roundMoney(line[2] * 0.13));
    assertResult(
      `invoice ${source.number} lines`,
      await db.from("labour_invoice_lines").insert(
        source.lines.map((line, index) => ({
          invoice_id: invoice.id,
          line_number: index + 1,
          description: line[1],
          service_started_on: line[0],
          service_ended_on: line[0],
          quantity_hours: null,
          hourly_rate: null,
          amount_before_tax: line[2],
          is_adjustment: false,
          source_kind: "extracted",
          source_text: `Printed item from Dressing Rooms invoice ${source.number}: ${line[1]} — Paint Consultation`,
          needs_review: false,
          entry_type: "labour",
          quantity: 1,
          unit: "consultation",
          unit_price: line[2],
          tax_amount: lineTax[index],
          source_reference: `gmail:${source.messageId}:invoice:${source.number}:line:${index + 1}`,
        })),
      ),
    );
  }
}

for (const [transactionId, allocations] of payments) {
  const bank = bankRows.data.find((row) => row.id === transactionId);
  const existing = activeAllocations.data.filter(
    (row) => row.financial_transaction_id === transactionId,
  );
  if (!existing.length) {
    assertResult(
      `payment record ${transactionId}`,
      await db.from("labour_payment_records").upsert(
        {
          financial_transaction_id: transactionId,
          contractor_id: contractor.id,
          recipient_status: "confirmed",
          confirmation_method: "bank_record",
          confirmation_note:
            "Darlene / Dressing Rooms recipient confirmed by TD e-transfer evidence and the supplier invoices archived from Gmail.",
          confirmed_at: now,
        },
        { onConflict: "financial_transaction_id" },
      ),
    );

    for (const [invoiceNumber, amount] of allocations) {
      const invoice = invoiceByNumber.get(invoiceNumber);
      assertResult(
        `allocation ${transactionId}/${invoiceNumber}`,
        await db.from("labour_payment_allocations").insert({
          financial_transaction_id: transactionId,
          invoice_id: invoice.id,
          allocated_amount: amount,
          match_method: [
            "supplier_match",
            "invoice_date_sequence",
            "exact_after_hst_amount",
            "gmail_invoice",
            "bank_record",
          ],
          invoice_source_message_id: invoices.find(
            (item) => item.number === invoiceNumber,
          ).messageId,
          payment_confirmation_message_id:
            bank.source_data?.interac_gmail_message_id ?? null,
          confirmed_at: now,
          notes:
            invoiceNumber === "403"
              ? "Bank payment is $0.18 below the printed invoice total; the invoice remains partially paid."
              : "Physical supplier invoice and bank payment reconcile.",
        }),
      );
    }
  }

  const allocatedTax = roundMoney(
    allocations.reduce((sum, [invoiceNumber, amount]) => {
      const source = invoices.find((item) => item.number === invoiceNumber);
      return sum + amount * (source.tax / source.total);
    }, 0),
  );
  const updatedSource = {
    ...(bank.source_data ?? {}),
    supplier_invoice_tax_evidence: {
      status: "documented",
      supplier: "Dressing Rooms",
      hst_registration: "868151010RT0001",
      invoice_numbers: allocations.map(([number]) => number),
      invoice_gmail_message_ids: allocations.map(
        ([number]) => invoices.find((item) => item.number === number).messageId,
      ),
      confirmed_on: "2026-08-02",
    },
  };
  assertResult(
    `tax update ${transactionId}`,
    await db
      .from("financial_transactions")
      .update({
        tax_amount: -allocatedTax,
        source_data: updatedSource,
        updated_at: now,
      })
      .eq("id", transactionId),
  );
}

console.log(
  "Imported Dressing Rooms invoices, lines, payment allocations, and documented HST.",
);
