#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const CONTRACTOR_NAME = "XDesign Dev Inc";
const CONTRACTOR_ID = "4eefe6f2-8f47-48be-a9cf-ff90286a3410";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const ACCOUNT_ID = "c3fe49f6-c4d8-43dd-ae8a-7e799912305e";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();

const EXISTING_INVOICES = {
  8584: {
    id: "404d9e86-745b-4142-bdfb-43d428b0211f",
    gross: 169.5,
  },
  8585: {
    id: "a720a14f-aace-464d-89e6-5aa6f8645f28",
    gross: 1593.3,
  },
  8586: {
    id: "7584089c-caa2-4233-aa4d-d37352c12f8f",
    gross: 372.9,
    sourceMessageId: "19ea6b97a37118c6",
  },
  8589: {
    id: "ba0bece0-6efb-49d7-a879-4768794736a9",
    gross: 372.9,
    sourceMessageId: "19ec58bd8a520e9f",
  },
  8597: {
    id: "c3a378dd-86e0-4826-bc2e-12e792163e6e",
    gross: 305.1,
  },
  8598: {
    id: "d52e8834-c45e-4408-8993-c05a33cac934",
    gross: 644.1,
  },
  8599: {
    id: "05550900-0a54-41f3-ad07-509fd224a6e4",
    gross: 508.5,
  },
  8600: {
    id: "a753666e-78e9-4345-acb3-da6e25d07bbc",
    gross: 915.3,
  },
  8601: {
    id: "34d2b7bc-5e76-4b6a-9f33-19c30ab06b5e",
    gross: 339,
  },
  8602: {
    id: "32e8b90e-22e1-4145-a7e2-797079c582ef",
    gross: 372.9,
  },
  8603: {
    id: "4dfa4e22-8d24-448d-835d-2f98f9348586",
    gross: 678,
  },
  8604: {
    id: "009639eb-e73e-412d-82e0-5f965df79e9f",
    gross: 474.6,
  },
  8605: {
    id: "37a145f1-c5fa-44f8-b468-b5cb3bd3351d",
    gross: 237.3,
  },
};

const SUPERSEDED_INVOICES = [
  {
    id: "3f1763a8-5a42-40bc-8b99-e8dba792f8c4",
    invoiceNumber: "8586",
    replacementId: EXISTING_INVOICES["8586"].id,
    reason:
      "Superseded by the updated #8586 invoice adding Sunday hours; Gmail message 19ea6b97a37118c6.",
  },
  {
    id: "55fdc7f8-0d9b-485f-8274-17fda5584ea7",
    invoiceNumber: "8602",
    replacementId: EXISTING_INVOICES["8602"].id,
    reason:
      "Superseded by the updated #8602 invoice for $372.90; the Wave paid receipt confirms the updated total.",
  },
];

const EXISTING_PAYMENTS = [
  {
    key: "JrB",
    id: "ef0b5397-97da-4f20-b094-07a305363b55",
    amount: 542.4,
    date: "2026-06-08",
    sentOn: "2026-06-07",
    messageId: "19ea255e8ec0e7b8",
    memo: "Mike Ralph - Sonya Lee",
  },
  {
    key: "n2H",
    id: "b01979d2-f2fb-4053-859a-5063d93b3b6e",
    amount: 372.9,
    date: "2026-06-10",
    sentOn: "2026-06-10",
    messageId: "19eb1739f35966bc",
    memo: "Danielle Hards",
  },
  {
    key: "fq4",
    id: "f38b459c-4623-42e6-9c7f-009f029a90e3",
    amount: 330,
    date: "2026-06-15",
    sentOn: "2026-06-15",
    messageId: "19ecd0c6a89ef18d",
    memo: "Jen Payne",
  },
  {
    key: "pKE",
    id: "e6322e93-9d56-4a15-84d4-92ee3ad5efeb",
    amount: 1636.2,
    date: "2026-06-15",
    sentOn: "2026-06-15",
    messageId: "19ecd4adf5526be1",
    memo: "Christian Boulet + taxes from Jen Payne",
  },
  {
    key: "6jd",
    id: "e5de6117-94d9-46eb-9577-9c1c8f562a53",
    amount: 1796,
    date: "2026-07-16",
    sentOn: "2026-07-16",
    messageId: "19f6d0e7e04e3dd1",
    memo: null,
  },
  {
    key: "DNe",
    id: "70636341-202c-4670-8add-97bac21e094f",
    amount: 577,
    date: "2026-07-16",
    sentOn: "2026-07-16",
    messageId: "19f6d0f0ac37da0d",
    memo: null,
  },
];

const NEW_PAYMENTS = [
  {
    key: "Brg",
    fullReference: "CAruNBrg",
    amount: 2101.8,
    date: "2026-07-26",
    messageId: "19f9f4d8e2a37b6f",
  },
  {
    key: "Paw",
    fullReference: "CAYFXPaw",
    amount: 113,
    date: "2026-07-26",
    messageId: "19f9f5be6b17fe9f",
  },
  {
    key: "ZSw",
    fullReference: "CAuTtZSw",
    amount: 84.75,
    date: "2026-07-28",
    messageId: "19fa92675831ee6c",
  },
];

const NEW_INVOICES = [
  {
    invoiceNumber: "8606",
    invoiceDate: "2026-07-26",
    beforeTax: 100,
    tax: 13,
    gross: 113,
    matchStatus: "matched_multiple",
    messageId: "19f9f50064cf21ee",
    paymentReceiptMessageId: "19f9f5c1f06a7eb7",
    sourcePath:
      "/Users/jadslim/.workspace-mcp/attachments/Invoice_8606_2026-07-26_e56f3684.pdf",
    expectedSha256:
      "ca0acecccabfa6cbae1a21468ea621063466a9b1867f9c8a0264c1a6fb593d4f",
    expectedSize: 80339,
    originalFilename: "2026-07-26 - Invoice_8606_2026-07-26.pdf",
    lines: [
      {
        lineNumber: 1,
        description: "Pierre Caron",
        amount: 60,
        tax: 7.8,
        projectId: "109261475",
        sourceReference: "invoice_item:bonus:pierre-caron",
        sourceText: "Bonus: Pierre Caron - 60$",
      },
      {
        lineNumber: 2,
        description: "Anjou Delplancke",
        amount: 40,
        tax: 5.2,
        projectId: "109570018",
        sourceReference: "invoice_item:bonus:anjou-delplancke",
        sourceText: "Bonus: Anjou - 40$",
      },
    ],
    textExcerpt: `INVOICE
XDesign Dev Inc
1300 Richmond Road
Unit 321
Ottawa, Ontario K2B 8L2
Canada
6137628638
BILL TO
Ottawa Painters
+1 (343) 326-5133
info@paintersottawa.com
Invoice Number: 8606
Invoice Date: July 26, 2026
Payment Due: July 26, 2026
Amount Due (CAD): $113.00
Items Quantity Price Amount
Paint & Plaster
Bonus: Pierre Caron - 60$
Bonus: Anjou - 40$
1 $100.00 $100.00
Subtotal: $100.00
ON 13%: $13.00
Total: $113.00
Amount Due (CAD): $113.00
GST/ HST Number: 79764 4168 RT0001`,
  },
  {
    invoiceNumber: "8607",
    invoiceDate: "2026-07-28",
    beforeTax: 75,
    tax: 9.75,
    gross: 84.75,
    matchStatus: "matched",
    messageId: "19fa923a54967ad1",
    paymentReceiptMessageId: "19fa926a8493b7e6",
    sourcePath:
      "/Users/jadslim/.workspace-mcp/attachments/Invoice_8607_2026-07-28_f4ea0f3d.pdf",
    expectedSha256:
      "d42e836d0f0041d4607218c9cf27a9d75132b7ff44911044431bb78f8a60a655",
    expectedSize: 80416,
    originalFilename: "2026-07-28 - Invoice_8607_2026-07-28.pdf",
    lines: [
      {
        lineNumber: 1,
        description: "Leiya Dobson",
        amount: 75,
        tax: 9.75,
        projectId: "109381573",
        sourceReference: "invoice_item:bonus:leiya-dobson",
        sourceText: "Bonus: Leiya Dobson - 75$",
      },
    ],
    textExcerpt: `INVOICE
XDesign Dev Inc
1300 Richmond Road
Unit 321
Ottawa, Ontario K2B 8L2
Canada
6137628638
BILL TO
Ottawa Painters
+1 (343) 326-5133
info@paintersottawa.com
Invoice Number: 8607
Invoice Date: July 28, 2026
Payment Due: July 28, 2026
Amount Due (CAD): $84.75
Items Quantity Price Amount
Paint & Plaster
Bonus: Leiya Dobson - 75$
1 $75.00 $75.00
Subtotal: $75.00
ON 13%: $9.75
Total: $84.75
Amount Due (CAD): $84.75
GST/ HST Number: 79764 4168 RT0001`,
  },
];

const ALLOCATIONS = [
  {
    paymentKey: "JrB",
    invoiceNumber: "8586",
    amount: 372.9,
    methods: [
      "verified_contractor_identity",
      "user_confirmed_payment_order",
      "unique_exact_invoice_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Ottawa Painters confirmed JrB $542.40 is the correct grouped payment: invoice #8584 $169.50 plus updated invoice #8586 $372.90. The later n2H transfer is the $372.90 overpayment.",
  },
  {
    paymentKey: "fq4",
    invoiceNumber: "8589",
    amount: 330,
    methods: [
      "verified_contractor_identity",
      "invoice_subtotal_component",
      "td_payment_confirmation",
      "payment_memo",
    ],
    note: "TD confirmation memo names Jen Payne; this payment is the $330.00 pre-HST component of invoice #8589.",
  },
  {
    paymentKey: "pKE",
    invoiceNumber: "8585",
    amount: 1593.3,
    methods: [
      "verified_contractor_identity",
      "exact_invoice_total_component",
      "td_payment_confirmation",
      "payment_memo",
      "wave_paid_receipt",
    ],
    note: "TD memo names Christian Boulet plus Jen Payne tax; Wave receipt 19ecd4ba0cbe53ce confirms $1,593.30 paid on invoice #8585.",
  },
  {
    paymentKey: "pKE",
    invoiceNumber: "8589",
    amount: 42.9,
    methods: [
      "verified_contractor_identity",
      "invoice_tax_component",
      "td_payment_confirmation",
      "payment_memo",
      "wave_paid_receipt",
    ],
    note: "TD memo explicitly includes taxes from Jen Payne; Wave receipt 19ecd4beb5f518f8 confirms the final $42.90 on invoice #8589.",
  },
  {
    paymentKey: "6jd",
    invoiceNumber: "8597",
    amount: 305.1,
    methods: [
      "verified_contractor_identity",
      "exact_invoice_sum",
      "same_day_wave_receipts",
      "td_payment_confirmation",
    ],
    note: "Part of the exact $1,796.00 four-invoice total confirmed by TD and same-day Wave paid receipt 19f6d0f98e895a30.",
  },
  {
    paymentKey: "6jd",
    invoiceNumber: "8598",
    amount: 644.1,
    methods: [
      "verified_contractor_identity",
      "exact_invoice_sum",
      "same_day_wave_receipts",
      "td_payment_confirmation",
    ],
    note: "Part of the exact $1,796.00 four-invoice total confirmed by TD and same-day Wave paid receipt 19f6d10215047428.",
  },
  {
    paymentKey: "6jd",
    invoiceNumber: "8599",
    amount: 508.5,
    methods: [
      "verified_contractor_identity",
      "exact_invoice_sum",
      "same_day_wave_receipts",
      "td_payment_confirmation",
    ],
    note: "Part of the exact $1,796.00 four-invoice total confirmed by TD and same-day Wave paid receipt 19f6d10753e045ab.",
  },
  {
    paymentKey: "6jd",
    invoiceNumber: "8600",
    amount: 338.3,
    methods: [
      "verified_contractor_identity",
      "exact_invoice_sum",
      "same_day_wave_receipts",
      "td_payment_confirmation",
    ],
    note: "Final component of the exact $1,796.00 four-invoice total; invoice #8600 is completed by the separate $577.00 transfer and Wave receipt 19f6d10b76c1d63e.",
  },
  {
    paymentKey: "DNe",
    invoiceNumber: "8600",
    amount: 577,
    methods: [
      "verified_contractor_identity",
      "split_invoice_payment",
      "same_day_wave_receipt",
      "td_payment_confirmation",
    ],
    note: "Completes invoice #8600 together with $338.30 from transfer 6jd; exact combined invoice total is $915.30.",
  },
  {
    paymentKey: "Brg",
    invoiceNumber: "8601",
    amount: 339,
    methods: [
      "verified_contractor_identity",
      "exact_invoice_sum",
      "same_day_td_confirmation",
    ],
    note: "Part of the unique exact $2,101.80 total paid by TD transfer Brg.",
  },
  {
    paymentKey: "Brg",
    invoiceNumber: "8602",
    amount: 372.9,
    methods: [
      "verified_contractor_identity",
      "exact_invoice_sum",
      "updated_invoice_version",
      "same_day_td_confirmation",
    ],
    note: "Part of the unique exact $2,101.80 total; allocation uses updated invoice #8602 for $372.90.",
  },
  {
    paymentKey: "Brg",
    invoiceNumber: "8603",
    amount: 678,
    methods: [
      "verified_contractor_identity",
      "exact_invoice_sum",
      "same_day_td_confirmation",
    ],
    note: "Part of the unique exact $2,101.80 total paid by TD transfer Brg.",
  },
  {
    paymentKey: "Brg",
    invoiceNumber: "8604",
    amount: 474.6,
    methods: [
      "verified_contractor_identity",
      "exact_invoice_sum",
      "same_day_td_confirmation",
    ],
    note: "Part of the unique exact $2,101.80 total paid by TD transfer Brg.",
  },
  {
    paymentKey: "Brg",
    invoiceNumber: "8605",
    amount: 237.3,
    methods: [
      "verified_contractor_identity",
      "exact_invoice_sum",
      "same_day_td_confirmation",
    ],
    note: "Part of the unique exact $2,101.80 total paid by TD transfer Brg.",
  },
  {
    paymentKey: "Paw",
    invoiceNumber: "8606",
    amount: 113,
    methods: [
      "verified_contractor_identity",
      "exact_after_hst_amount_cents",
      "same_day_td_confirmation",
      "wave_paid_receipt",
    ],
    note: "Exact same-day TD transfer and Wave paid receipt 19f9f5c1f06a7eb7 for invoice #8606.",
  },
  {
    paymentKey: "ZSw",
    invoiceNumber: "8607",
    amount: 84.75,
    methods: [
      "verified_contractor_identity",
      "exact_after_hst_amount_cents",
      "same_day_td_confirmation",
      "wave_paid_receipt",
    ],
    note: "Exact same-day TD transfer and Wave paid receipt 19fa926a8493b7e6 for invoice #8607.",
  },
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cents(value) {
  return Math.round(Number(value) * 100);
}

function gross(invoice) {
  return Number(
    invoice.amount_paid ??
      Number(invoice.amount_before_tax ?? 0) + Number(invoice.tax_amount ?? 0),
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

async function selectSingle(query, label) {
  const result = await query.single();
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function insertAuditEvent(db, row) {
  const existing = await db
    .from("labour_verification_events")
    .select("id")
    .eq("entity_type", row.entity_type)
    .eq("entity_id", row.entity_id)
    .eq("action", row.action)
    .eq("reason", row.reason)
    .limit(1);
  if (existing.error) throw existing.error;
  if ((existing.data ?? []).length) return;
  const result = await db.from("labour_verification_events").insert(row);
  if (result.error) throw result.error;
}

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
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
  `Refusing reconciliation for unexpected project ${projectRef}.`,
);

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [contractor, admin, account] = await Promise.all([
  selectSingle(
    db
      .from("labour_contractors")
      .select("id,supplier_name")
      .eq("id", CONTRACTOR_ID),
    "contractor",
  ),
  selectSingle(
    db
      .from("employee_profiles")
      .select("user_id,email,role,is_active")
      .eq("user_id", ADMIN_USER_ID),
    "admin",
  ),
  selectSingle(
    db
      .from("financial_accounts")
      .select("id,name,last_four,currency,is_active")
      .eq("id", ACCOUNT_ID),
    "account",
  ),
]);
assert(contractor.supplier_name === CONTRACTOR_NAME, "Contractor changed.");
assert(
  admin.email === "info@paintersottawa.com" &&
    admin.role === "admin" &&
    admin.is_active,
  "Expected active Ottawa Painters admin was not found.",
);
assert(
  account.name === "Business Chequing" &&
    account.last_four === "6970" &&
    account.currency === "CAD" &&
    account.is_active,
  "Expected TD Business Chequing account was not found.",
);

for (const invoice of NEW_INVOICES) {
  assert(existsSync(invoice.sourcePath), `Missing ${invoice.sourcePath}`);
  const file = readFileSync(invoice.sourcePath);
  assert(
    sha256(file) === invoice.expectedSha256,
    `PDF hash changed for invoice #${invoice.invoiceNumber}.`,
  );
  assert(
    file.byteLength === invoice.expectedSize,
    `PDF size changed for invoice #${invoice.invoiceNumber}.`,
  );
  assert(
    cents(invoice.lines.reduce((total, line) => total + line.amount, 0)) ===
      cents(invoice.beforeTax),
    `Invoice #${invoice.invoiceNumber} line subtotal is invalid.`,
  );
  assert(
    cents(invoice.beforeTax + invoice.tax) === cents(invoice.gross),
    `Invoice #${invoice.invoiceNumber} total is invalid.`,
  );
}

const existingInvoiceResult = await db
  .from("labour_invoices")
  .select(
    "id,invoice_number,contractor_id,amount_before_tax,tax_amount,amount_paid,currency,document_type",
  )
  .in(
    "id",
    Object.values(EXISTING_INVOICES).map((invoice) => invoice.id),
  );
if (existingInvoiceResult.error) throw existingInvoiceResult.error;
assert(
  (existingInvoiceResult.data ?? []).length ===
    Object.keys(EXISTING_INVOICES).length,
  "One or more expected XDesign invoices are missing.",
);
for (const [invoiceNumber, expected] of Object.entries(EXISTING_INVOICES)) {
  const actual = existingInvoiceResult.data.find(
    (invoice) => invoice.id === expected.id,
  );
  assert(
    actual?.invoice_number === invoiceNumber &&
      actual.contractor_id === CONTRACTOR_ID &&
      actual.currency === "CAD" &&
      actual.document_type === "invoice" &&
      cents(gross(actual)) === cents(expected.gross),
    `Invoice #${invoiceNumber} no longer matches the reviewed evidence.`,
  );
}

const existingPaymentResult = await db
  .from("financial_transactions")
  .select(
    "id,posted_on,description,counterparty,amount,currency,transaction_type,is_transfer,category,source_data",
  )
  .in(
    "id",
    EXISTING_PAYMENTS.map((payment) => payment.id),
  );
if (existingPaymentResult.error) throw existingPaymentResult.error;
assert(
  (existingPaymentResult.data ?? []).length === EXISTING_PAYMENTS.length,
  "One or more expected XDesign payments are missing.",
);
for (const expected of EXISTING_PAYMENTS) {
  const actual = existingPaymentResult.data.find(
    (payment) => payment.id === expected.id,
  );
  assert(
    actual?.posted_on === expected.date &&
      actual.description === `SEND E-TFR ***${expected.key}` &&
      actual.counterparty === CONTRACTOR_NAME &&
      cents(Math.abs(Number(actual.amount))) === cents(expected.amount) &&
      actual.currency === "CAD" &&
      actual.transaction_type === "expense" &&
      actual.is_transfer === false &&
      actual.category === "Subcontractors",
    `Payment ${expected.key} no longer matches the reviewed bank evidence.`,
  );
}

const wrongAllocation = await selectSingle(
  db
    .from("labour_payment_allocations")
    .select("*")
    .eq("id", "6a79c517-195f-479d-868c-6fb838c4eca4"),
  "incorrect n2H allocation",
);
assert(
  wrongAllocation.financial_transaction_id ===
    "b01979d2-f2fb-4053-859a-5063d93b3b6e" &&
    wrongAllocation.invoice_id === EXISTING_INVOICES["8586"].id &&
    cents(wrongAllocation.allocated_amount) === cents(372.9),
  "The reviewed n2H allocation has changed.",
);

const dryRun = {
  mode: APPLY ? "apply" : "dry-run",
  project_ref: projectRef,
  contractor,
  corrections: {
    reverse_incorrect_allocation: wrongAllocation.reversed_at == null ? 1 : 0,
    superseded_invoice_versions: SUPERSEDED_INVOICES.length,
    existing_payments_enriched: EXISTING_PAYMENTS.length,
    missing_payments_imported: NEW_PAYMENTS.length,
    missing_invoices_imported: NEW_INVOICES.length,
    new_invoice_entries: NEW_INVOICES.reduce(
      (total, invoice) => total + invoice.lines.length,
      0,
    ),
    payment_allocations_ensured: ALLOCATIONS.length,
  },
  deliberate_exception: {
    payment: "SEND E-TFR ***n2H",
    payment_amount: 372.9,
    classification: "confirmed overpayment",
    treatment: "leave unallocated and needs_review pending refund or credit",
  },
};
console.log(JSON.stringify(dryRun, null, 2));
if (!APPLY) process.exit(0);

const evidenceManifest = {
  source: "TD Interac payment confirmation emails and EasyWeb history",
  reviewed_on: "2026-07-30",
  recipient_name: "Michael Matambo",
  recipient_email: "xdesign.ottawa@gmail.com",
  payments: NEW_PAYMENTS.map((payment) => ({
    date: payment.date,
    amount: payment.amount,
    confirmation_reference: payment.fullReference,
    gmail_message_id: payment.messageId,
    status: "Deposited",
  })),
};
const evidenceJson = JSON.stringify(evidenceManifest);
const evidenceHash = sha256(evidenceJson);
let importRecord;
const importLookup = await db
  .from("financial_imports")
  .select("*")
  .eq("content_sha256", evidenceHash)
  .maybeSingle();
if (importLookup.error) throw importLookup.error;
if (importLookup.data) {
  importRecord = importLookup.data;
} else {
  const importInsert = await db
    .from("financial_imports")
    .insert({
      content_sha256: evidenceHash,
      original_filename:
        "TD Interac confirmation emails 2026-07-26 to 2026-07-28.json",
      mime_type: "application/json",
      source_kind: "etransfer_report",
      account_id: ACCOUNT_ID,
      period_start: "2026-07-26",
      period_end: "2026-07-28",
      row_count: NEW_PAYMENTS.length,
      metadata: {
        ...evidenceManifest,
        evidence_role: "transaction_source",
        reconciliation_script: "reconcile-xdesign-evidence.mjs",
      },
    })
    .select("*")
    .single();
  if (importInsert.error) throw importInsert.error;
  importRecord = importInsert.data;
}

const paymentByKey = new Map(
  EXISTING_PAYMENTS.map((payment) => [payment.key, payment]),
);
for (const payment of NEW_PAYMENTS) {
  const sourceKey = sha256(`td-interac-email:${payment.messageId}`);
  const transactionRow = {
    account_id: ACCOUNT_ID,
    import_id: importRecord.id,
    source_key: sourceKey,
    posted_on: payment.date,
    transaction_on: payment.date,
    description: `SEND E-TFR ***${payment.key}`,
    counterparty: CONTRACTOR_NAME,
    amount: -payment.amount,
    tax_amount: 0,
    currency: "CAD",
    transaction_type: "expense",
    category: "Subcontractors",
    is_transfer: false,
    review_status: "needs_review",
    notes:
      `TD payment confirmation ${payment.messageId}; EasyWeb confirms ` +
      `Michael Matambo <xdesign.ottawa@gmail.com>, ${payment.fullReference}, deposited.`,
    source_data: {
      source: "td_interac_confirmation_email",
      td_payment_confirmation: {
        gmail_message_id: payment.messageId,
        confirmation_reference: payment.fullReference,
        amount: payment.amount,
        sent_on: payment.date,
      },
      easyweb_e_transfer_evidence: {
        source: "TD EasyWeb Interac e-Transfer history viewed 2026-07-30",
        status: "Deposited",
        sent_on: payment.date,
        bank_posted_on: payment.date,
        amount: payment.amount,
        recipient_name: "Michael Matambo",
        recipient_email: "xdesign.ottawa@gmail.com",
        confirmation_suffix: payment.key,
        full_confirmation_reference: payment.fullReference,
        match_method: "confirmation_suffix_amount_date",
      },
    },
  };
  const transactionUpsert = await db
    .from("financial_transactions")
    .upsert(transactionRow, { onConflict: "source_key" })
    .select("id,source_key,posted_on,description,amount")
    .single();
  if (transactionUpsert.error) throw transactionUpsert.error;
  paymentByKey.set(payment.key, {
    ...payment,
    id: transactionUpsert.data.id,
    sentOn: payment.date,
    memo: null,
  });
}

for (const payment of EXISTING_PAYMENTS) {
  const current = existingPaymentResult.data.find(
    (transaction) => transaction.id === payment.id,
  );
  const evidence = objectValue(current.source_data);
  const update = await db
    .from("financial_transactions")
    .update({
      source_data: {
        ...evidence,
        td_payment_confirmation: {
          gmail_message_id: payment.messageId,
          amount: payment.amount,
          sent_on: payment.sentOn,
          memo: payment.memo,
          evidence_role: "payment_instruction_confirmation",
        },
      },
    })
    .eq("id", payment.id);
  if (update.error) throw update.error;
}

for (const payment of paymentByKey.values()) {
  const note =
    `TD EasyWeb and payment confirmation email ${payment.messageId}: ` +
    `${payment.sentOn}, $${payment.amount.toFixed(2)}, Michael Matambo ` +
    `<xdesign.ottawa@gmail.com>, confirmation ${payment.key}, deposited.` +
    (payment.memo ? ` Memo: ${payment.memo}.` : "");
  const current = await db
    .from("labour_payment_records")
    .select("*")
    .eq("financial_transaction_id", payment.id)
    .maybeSingle();
  if (current.error) throw current.error;
  const desired = {
    financial_transaction_id: payment.id,
    contractor_id: CONTRACTOR_ID,
    recipient_status: "confirmed",
    confirmation_method: "payment_confirmation",
    confirmation_note: note,
    confirmed_by: ADMIN_USER_ID,
    confirmed_at: NOW,
  };
  if (
    !current.data ||
    current.data.contractor_id !== desired.contractor_id ||
    current.data.recipient_status !== desired.recipient_status ||
    current.data.confirmation_method !== desired.confirmation_method ||
    current.data.confirmation_note !== desired.confirmation_note
  ) {
    const paymentRecord = await db
      .from("labour_payment_records")
      .upsert(desired, { onConflict: "financial_transaction_id" });
    if (paymentRecord.error) throw paymentRecord.error;
  }
}

const invoiceByNumber = new Map(
  Object.entries(EXISTING_INVOICES).map(([number, invoice]) => [
    number,
    invoice,
  ]),
);
for (const invoice of NEW_INVOICES) {
  const file = readFileSync(invoice.sourcePath);
  const storagePath =
    `gmail-labour-invoices/${invoice.invoiceDate}/` +
    `${invoice.expectedSha256.slice(0, 16)}-${invoice.originalFilename}`;
  const upload = await db.storage
    .from("labour-invoices")
    .upload(storagePath, file, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: false,
    });
  if (
    upload.error &&
    String(upload.error.statusCode) !== "409" &&
    !/already exists|duplicate/i.test(upload.error.message)
  ) {
    throw new Error(
      `Upload failed for invoice #${invoice.invoiceNumber}: ${upload.error.message}`,
    );
  }

  const duplicateGroupId = sha256(
    `${CONTRACTOR_NAME}:${invoice.invoiceNumber}`,
  ).slice(0, 16);
  const priorInvoice = await db
    .from("labour_invoices")
    .select("id")
    .eq("content_sha256", invoice.expectedSha256)
    .maybeSingle();
  if (priorInvoice.error) throw priorInvoice.error;
  const invoiceUpsert = await db
    .from("labour_invoices")
    .upsert(
      {
        supplier_name: CONTRACTOR_NAME,
        contractor_id: CONTRACTOR_ID,
        invoice_number: invoice.invoiceNumber,
        invoice_date: invoice.invoiceDate,
        currency: "CAD",
        amount_paid: invoice.gross,
        amount_before_tax: invoice.beforeTax,
        tax_amount: invoice.tax,
        payment_basis: "invoice_total",
        document_type: "invoice",
        match_status: invoice.matchStatus,
        storage_bucket: "labour-invoices",
        storage_path: storagePath,
        original_filename: invoice.originalFilename,
        mime_type: "application/pdf",
        file_size: invoice.expectedSize,
        content_sha256: invoice.expectedSha256,
        source_date: invoice.invoiceDate,
        source_label: `Gmail / Labour Invoices · message ${invoice.messageId}`,
        duplicate_group_id: duplicateGroupId,
        duplicate_group_size: 1,
        supporting_invoice_reference: null,
        text_excerpt: invoice.textExcerpt,
      },
      { onConflict: "content_sha256" },
    )
    .select("id,invoice_number,amount_paid")
    .single();
  if (invoiceUpsert.error) throw invoiceUpsert.error;
  invoiceByNumber.set(invoice.invoiceNumber, {
    id: invoiceUpsert.data.id,
    gross: invoice.gross,
    sourceMessageId: invoice.messageId,
  });
  if (!priorInvoice.data) {
    await insertAuditEvent(db, {
      entity_type: "invoice",
      entity_id: invoiceUpsert.data.id,
      action: "insert",
      old_values: null,
      new_values: {
        invoice_number: invoice.invoiceNumber,
        amount_before_tax: invoice.beforeTax,
        tax_amount: invoice.tax,
        amount_after_tax: invoice.gross,
        source_message_id: invoice.messageId,
        content_sha256: invoice.expectedSha256,
      },
      reason:
        `Imported exact Gmail PDF for XDesign invoice #${invoice.invoiceNumber}; ` +
        `source message ${invoice.messageId}.`,
      performed_by: ADMIN_USER_ID,
      performed_at: NOW,
    });
  }

  for (const line of invoice.lines) {
    const lineUpsert = await db
      .from("labour_invoice_lines")
      .upsert(
        {
          invoice_id: invoiceUpsert.data.id,
          line_number: line.lineNumber,
          entry_type: "bonus",
          description: line.description,
          quantity: 1,
          unit: "bonus",
          unit_price: line.amount,
          quantity_hours: null,
          hourly_rate: null,
          amount_before_tax: line.amount,
          tax_amount: line.tax,
          is_adjustment: false,
          source_kind: "extracted",
          source_text: line.sourceText,
          source_reference: line.sourceReference,
          needs_review: false,
        },
        { onConflict: "invoice_id,line_number" },
      )
      .select("id")
      .single();
    if (lineUpsert.error) throw lineUpsert.error;
    const lineAllocation = await db
      .from("labour_invoice_line_allocations")
      .upsert(
        {
          invoice_line_id: lineUpsert.data.id,
          companycam_project_id: line.projectId,
          allocated_amount: line.amount,
          allocated_hours: null,
          allocation_method: [
            "exact_invoice_name",
            "existing_verified_project_identity",
            "xdesign_reconciliation_20260730",
          ],
          needs_review: false,
        },
        { onConflict: "invoice_line_id,companycam_project_id" },
      );
    if (lineAllocation.error) throw lineAllocation.error;
  }

  for (const [index, line] of invoice.lines.entries()) {
    const projectLink = await db.from("labour_invoice_projects").upsert(
      {
        invoice_id: invoiceUpsert.data.id,
        companycam_project_id: line.projectId,
        allocated_amount: line.amount,
        match_score: 200,
        match_method: [
          `name:${line.description.toLowerCase()}`,
          "exact_invoice_item",
          "xdesign_reconciliation_20260730",
        ],
        is_primary: index === 0,
        needs_review: false,
      },
      { onConflict: "invoice_id,companycam_project_id" },
    );
    if (projectLink.error) throw projectLink.error;
  }
}

for (const superseded of SUPERSEDED_INVOICES) {
  const current = await selectSingle(
    db
      .from("labour_invoices")
      .select(
        "id,invoice_number,match_status,supporting_invoice_reference,document_type",
      )
      .eq("id", superseded.id),
    `superseded invoice #${superseded.invoiceNumber}`,
  );
  assert(
    current.invoice_number === superseded.invoiceNumber &&
      current.document_type === "invoice",
    `Superseded invoice #${superseded.invoiceNumber} changed.`,
  );
  const reference = `Superseded by invoice record ${superseded.replacementId}`;
  if (
    current.match_status !== "supporting_document" ||
    current.supporting_invoice_reference !== reference
  ) {
    const update = await db
      .from("labour_invoices")
      .update({
        match_status: "supporting_document",
        supporting_invoice_reference: reference,
      })
      .eq("id", superseded.id);
    if (update.error) throw update.error;
    await insertAuditEvent(db, {
      entity_type: "invoice",
      entity_id: superseded.id,
      action: "update",
      old_values: {
        match_status: current.match_status,
        supporting_invoice_reference: current.supporting_invoice_reference,
      },
      new_values: {
        match_status: "supporting_document",
        supporting_invoice_reference: reference,
      },
      reason: superseded.reason,
      performed_by: ADMIN_USER_ID,
      performed_at: NOW,
    });
  }
}

if (wrongAllocation.reversed_at == null) {
  const reversalReason =
    "Ottawa Painters confirmed n2H is the $372.90 overpayment; invoice #8586 belongs to the correct grouped JrB $542.40 payment.";
  const reversal = await db
    .from("labour_payment_allocations")
    .update({
      reversed_at: NOW,
      reversed_by: ADMIN_USER_ID,
      reversal_reason: reversalReason,
    })
    .eq("id", wrongAllocation.id)
    .is("reversed_at", null);
  if (reversal.error) throw reversal.error;
}

for (const allocation of ALLOCATIONS) {
  const payment = paymentByKey.get(allocation.paymentKey);
  const invoice = invoiceByNumber.get(allocation.invoiceNumber);
  assert(payment?.id, `Missing payment ${allocation.paymentKey}.`);
  assert(invoice?.id, `Missing invoice #${allocation.invoiceNumber}.`);

  const active = await db
    .from("labour_payment_allocations")
    .select("id,allocated_amount")
    .eq("financial_transaction_id", payment.id)
    .eq("invoice_id", invoice.id)
    .is("reversed_at", null)
    .maybeSingle();
  if (active.error) throw active.error;
  if (active.data) {
    assert(
      cents(active.data.allocated_amount) === cents(allocation.amount),
      `Existing ${allocation.paymentKey} → #${allocation.invoiceNumber} allocation has a different amount.`,
    );
    continue;
  }

  const allocationInsert = await db.from("labour_payment_allocations").insert({
    financial_transaction_id: payment.id,
    invoice_id: invoice.id,
    allocated_amount: allocation.amount,
    match_method: allocation.methods,
    invoice_source_message_id: invoice.sourceMessageId ?? null,
    payment_confirmation_message_id: payment.messageId,
    confirmed_by: ADMIN_USER_ID,
    confirmed_at: NOW,
    notes:
      `${allocation.note} Evidence: TD message ${payment.messageId}` +
      (invoice.sourceMessageId
        ? `; invoice source message ${invoice.sourceMessageId}.`
        : "."),
  });
  if (allocationInsert.error) throw allocationInsert.error;
}

const paymentIds = [...paymentByKey.values()].map((payment) => payment.id);
const verificationResult = await db
  .from("labour_payment_verification")
  .select(
    "financial_transaction_id,payment_amount,invoice_allocated_amount,total_allocated_amount,unallocated_amount,payment_status",
  )
  .in("financial_transaction_id", paymentIds);
if (verificationResult.error) throw verificationResult.error;
for (const verification of verificationResult.data ?? []) {
  const isOverpayment =
    verification.financial_transaction_id ===
    "b01979d2-f2fb-4053-859a-5063d93b3b6e";
  if (isOverpayment) {
    assert(
      verification.payment_status === "unmatched" &&
        cents(verification.unallocated_amount) === cents(372.9) &&
        cents(verification.total_allocated_amount) === 0,
      "n2H no longer has the expected $372.90 overpayment balance.",
    );
    const review = await db
      .from("financial_transactions")
      .update({
        review_status: "needs_review",
        notes:
          "Confirmed $372.90 XDesign overpayment. Invoice #8586 is already settled as part of the correct JrB $542.40 payment; retain this bank expense pending refund or supplier credit.",
      })
      .eq("id", verification.financial_transaction_id);
    if (review.error) throw review.error;
  } else {
    assert(
      verification.payment_status === "fully_allocated" &&
        cents(verification.unallocated_amount) === 0,
      `Payment ${verification.financial_transaction_id} is not fully allocated.`,
    );
    const reconciled = await db
      .from("financial_transactions")
      .update({ review_status: "reconciled" })
      .eq("id", verification.financial_transaction_id);
    if (reconciled.error) throw reconciled.error;
  }
}

const allContractorPayments = await db
  .from("labour_payment_verification")
  .select(
    "financial_transaction_id,payment_amount,total_allocated_amount,unallocated_amount,payment_status",
  )
  .eq("contractor_id", CONTRACTOR_ID);
if (allContractorPayments.error) throw allContractorPayments.error;
for (const payment of allContractorPayments.data ?? []) {
  if (payment.payment_status !== "fully_allocated") continue;
  const reconciled = await db
    .from("financial_transactions")
    .update({ review_status: "reconciled" })
    .eq("id", payment.financial_transaction_id);
  if (reconciled.error) throw reconciled.error;
}

const canonicalInvoiceResult = await db
  .from("labour_invoices")
  .select(
    "id,invoice_number,source_date,invoice_date,amount_before_tax,tax_amount,amount_paid,duplicate_group_id,match_status",
  )
  .eq("contractor_id", CONTRACTOR_ID)
  .eq("document_type", "invoice");
if (canonicalInvoiceResult.error) throw canonicalInvoiceResult.error;
const canonicalByGroup = new Map();
for (const invoice of canonicalInvoiceResult.data ?? []) {
  if (invoice.match_status === "supporting_document") continue;
  const key = invoice.duplicate_group_id ?? invoice.id;
  const current = canonicalByGroup.get(key);
  const invoiceRank = [
    invoice.source_date ?? "",
    invoice.invoice_date ?? "",
    cents(gross(invoice)),
    invoice.id,
  ];
  const currentRank = current
    ? [
        current.source_date ?? "",
        current.invoice_date ?? "",
        cents(gross(current)),
        current.id,
      ]
    : null;
  if (
    !current ||
    invoiceRank[0] > currentRank[0] ||
    (invoiceRank[0] === currentRank[0] &&
      (invoiceRank[1] > currentRank[1] ||
        (invoiceRank[1] === currentRank[1] &&
          (invoiceRank[2] > currentRank[2] ||
            (invoiceRank[2] === currentRank[2] &&
              invoiceRank[3] > currentRank[3])))))
  ) {
    canonicalByGroup.set(key, invoice);
  }
}
const canonicalInvoices = [...canonicalByGroup.values()];
const canonicalIds = canonicalInvoices.map((invoice) => invoice.id);
const invoiceVerification = await db
  .from("labour_invoice_verification")
  .select(
    "invoice_id,invoice_amount,paid_amount,amount_remaining,payment_status,verification_status",
  )
  .in("invoice_id", canonicalIds);
if (invoiceVerification.error) throw invoiceVerification.error;
const unpaidCanonical = (invoiceVerification.data ?? []).filter(
  (invoice) =>
    invoice.payment_status !== "paid" || cents(invoice.amount_remaining) !== 0,
);
assert(
  unpaidCanonical.length === 0,
  `Canonical XDesign invoices remain unpaid: ${JSON.stringify(unpaidCanonical)}`,
);

const depositedPayments = (allContractorPayments.data ?? []).filter(
  (payment) => Number(payment.payment_amount) > 0,
);
const canonicalInvoiceTotal = canonicalInvoices.reduce(
  (total, invoice) => total + cents(gross(invoice)),
  0,
);
const depositedPaymentTotal = depositedPayments.reduce(
  (total, payment) => total + cents(payment.payment_amount),
  0,
);
const unresolvedTotal = depositedPayments.reduce(
  (total, payment) => total + cents(payment.unallocated_amount),
  0,
);
assert(
  canonicalInvoiceTotal === cents(18616.75),
  `Unexpected canonical invoice total $${(canonicalInvoiceTotal / 100).toFixed(2)}.`,
);
assert(
  depositedPaymentTotal === cents(18989.65),
  `Unexpected deposited payment total $${(depositedPaymentTotal / 100).toFixed(2)}.`,
);
assert(
  unresolvedTotal === cents(372.9) &&
    depositedPaymentTotal - canonicalInvoiceTotal === cents(372.9),
  "Final XDesign exception is not exactly $372.90.",
);

console.log(
  JSON.stringify(
    {
      mode: "applied_and_verified",
      project_ref: projectRef,
      contractor,
      financial_import_id: importRecord.id,
      canonical_invoice_count: canonicalInvoices.length,
      canonical_invoice_total: canonicalInvoiceTotal / 100,
      deposited_payment_count: depositedPayments.length,
      deposited_payment_total: depositedPaymentTotal / 100,
      fully_paid_canonical_invoices: canonicalInvoices.length,
      unresolved_payment_count: depositedPayments.filter(
        (payment) => cents(payment.unallocated_amount) !== 0,
      ).length,
      unresolved_amount: unresolvedTotal / 100,
      unresolved_evidence:
        "SEND E-TFR ***n2H: confirmed $372.90 overpayment pending refund or supplier credit.",
    },
    null,
    2,
  ),
);
