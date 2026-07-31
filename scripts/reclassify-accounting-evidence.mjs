#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();
const CONFIRMED_ON = "2026-07-30";

const TRANSACTION_CORRECTIONS = [
  {
    id: "2800bf38-eb6c-4f0e-b7d4-768966c02a98",
    description: "SEND E-TFR ***mDm",
    counterparty: "Darlene",
    amount: 203.4,
    desired: {
      category: "Colour consultation",
      review_status: "reconciled",
    },
    classification: "colour_consultation",
    reason:
      "Ottawa Painters confirmed that every paid Darlene invoice is for colour-consultation services.",
  },
  {
    id: "269beeb1-843e-4515-9b64-8f2858c7fc37",
    description: "SEND E-TFR ***ZRd",
    counterparty: "Darlene",
    amount: 610.2,
    desired: {
      category: "Colour consultation",
      review_status: "reconciled",
    },
    classification: "colour_consultation",
    reason:
      "Ottawa Painters confirmed that every paid Darlene invoice is for colour-consultation services.",
  },
  {
    id: "da13f617-0cbb-4259-adde-df839e58dcb6",
    description: "SEND E-TFR ***7nb",
    counterparty: "Darlene",
    amount: 610.2,
    desired: {
      category: "Colour consultation",
      transaction_type: "transfer",
      is_transfer: true,
      review_status: "reconciled",
    },
    classification: "cancelled_colour_consultation_e_transfer",
    cancelledPair: {
      pairedTransactionId: "e6a0d911-8aae-442b-b77b-0f80c61e7025",
      role: "original_send",
      reference: "7nb",
    },
    reason:
      "The $610.20 Darlene send and same-day CANCEL E-TFR share suffix 7nb and net to zero. They are preserved as a cancelled colour-consultation transfer pair, not an expense.",
  },
  {
    id: "e6a0d911-8aae-442b-b77b-0f80c61e7025",
    description: "CANCEL E-TFR ***7nb",
    counterparty: "Darlene",
    amount: 610.2,
    desired: {
      category: "Colour consultation",
      transaction_type: "transfer",
      is_transfer: true,
      review_status: "reconciled",
    },
    classification: "cancelled_colour_consultation_e_transfer",
    cancelledPair: {
      pairedTransactionId: "da13f617-0cbb-4259-adde-df839e58dcb6",
      role: "cancelled_refund",
      reference: "7nb",
    },
    reason:
      "The $610.20 Darlene send and same-day CANCEL E-TFR share suffix 7nb and net to zero. They are preserved as a cancelled colour-consultation transfer pair, not an expense.",
  },
  {
    id: "3d9a604c-b723-42d4-9d58-28889dc3543b",
    description: "SEND E-TFR ***nSH",
    counterparty: "One Touch Print",
    amount: 678,
    desired: {
      category: "Advertising & marketing",
      review_status: "reconciled",
      notes:
        "Overhead printing cost for Ottawa Painters lawn signs. Recipient confirmed by TD EasyWeb.",
    },
    classification: "overhead_lawn_sign_printing",
    reason:
      "Ottawa Painters confirmed that One Touch Print supplied printed lawn signs; this is advertising/marketing overhead, not subcontractor labour.",
  },
  {
    id: "7cdbf570-d184-4714-98f5-5c0637f24bb3",
    description: "SEND E-TFR ***2KR",
    counterparty: "Curb Appeal Pro Wash",
    amount: 440,
    desired: {
      category: "Pressure washing",
      transaction_type: "transfer",
      is_transfer: true,
      review_status: "reconciled",
    },
    classification: "cancelled_pressure_washing_e_transfer",
    cancelledPair: {
      pairedTransactionId: "c29d1276-aa7c-4fea-9569-d2bb79d3fb12",
      role: "original_send",
      reference: "2KR",
    },
    reason:
      "The failed $440.00 Curb Appeal send was cancelled and returned before the successful thB payment. This pair must net to zero and not count as pressure-washing expense.",
  },
  {
    id: "c29d1276-aa7c-4fea-9569-d2bb79d3fb12",
    description: "CANCEL E-TFR ***2KR",
    counterparty: "Curb Appeal Pro Wash",
    amount: 440,
    desired: {
      category: "Pressure washing",
      transaction_type: "transfer",
      is_transfer: true,
      review_status: "reconciled",
    },
    classification: "cancelled_pressure_washing_e_transfer",
    cancelledPair: {
      pairedTransactionId: "7cdbf570-d184-4714-98f5-5c0637f24bb3",
      role: "cancelled_refund",
      reference: "2KR",
    },
    reason:
      "The failed $440.00 Curb Appeal send was cancelled and returned before the successful thB payment. This pair must net to zero and not count as pressure-washing expense.",
  },
  {
    id: "13f39c54-5f94-4256-aac1-17ca33373178",
    description: "SEND E-TFR ***thB",
    counterparty: "Curb Appeal Pro Wash",
    amount: 440,
    desired: {
      category: "Pressure washing",
      review_status: "reconciled",
    },
    classification: "pressure_washing",
    reason:
      "Ottawa Painters confirmed Curb Appeal Pro Wash supplies pressure-washing services. The three linked invoices explicitly describe pressure, deck/window and exterior siding washing.",
  },
  {
    id: "512598f2-9ad1-4936-a34e-fb479ad3065d",
    description: "SEND E-TFR ***r8P",
    counterparty: "kirsty johnson customer",
    amount: 597.97,
    desired: {
      category: "Customer refunds",
      review_status: "reconciled",
      notes:
        "Customer refund to Kirsty Johnson. Recipient and deposited transfer confirmed by TD EasyWeb.",
    },
    classification: "customer_refund",
    reason:
      "Ottawa Painters confirmed the payment to Kirsty Johnson was a customer refund, not subcontractor labour.",
  },
  {
    id: "76b9e16b-e026-4bc6-a58a-96078bef085d",
    description: "SEND E-TFR ***5gZ",
    counterparty: "Caledonian Painting Ltd",
    amount: 5000,
    desired: {
      category: "Sales commissions",
    },
    classification: "sales_commission_and_overhead",
    reason:
      "Ottawa Painters confirmed Caledonian payments are sales commissions and business overhead, not subcontractor labour.",
  },
  {
    id: "c1d3757c-fe6b-4abd-89c8-b25e545e4829",
    description: "SEND E-TFR ***3C3",
    counterparty: "Scott Madden",
    amount: 5464.68,
    desired: {
      category: "Sales commissions",
    },
    classification: "caledonian_sales_commission_and_overhead",
    reason:
      "Scott Madden is the Caledonian payee. Ottawa Painters confirmed these payments are sales commissions and business overhead, not subcontractor labour.",
  },
  {
    id: "c1ca7036-d0f0-4de2-88cc-bcd4005f09cd",
    description: "SEND E-TFR ***ACF",
    counterparty: "Scott Madden",
    amount: 2301.81,
    desired: {
      category: "Sales commissions",
    },
    classification: "caledonian_sales_commission_and_overhead",
    reason:
      "Scott Madden is the Caledonian payee. Ottawa Painters confirmed these payments are sales commissions and business overhead, not subcontractor labour.",
  },
  {
    id: "ddd6a173-aeef-4b8b-966d-07bc73b6babe",
    description: "SEND E-TFR ***Uw5",
    counterparty: "Scott Madden",
    amount: 1222.1,
    desired: {
      category: "Sales commissions",
    },
    classification: "caledonian_sales_commission_and_overhead",
    reason:
      "Scott Madden is the Caledonian payee. Ottawa Painters confirmed these payments are sales commissions and business overhead, not subcontractor labour.",
  },
  {
    id: "ef0b5397-97da-4f20-b094-07a305363b55",
    description: "SEND E-TFR ***JrB",
    counterparty: "XDesign Dev Inc",
    amount: 542.4,
    desired: {
      review_status: "reconciled",
      notes:
        "Correct XDesign invoice payment confirmed by Ottawa Painters: $169.50 to invoice #8584 plus $372.90 to invoice #8586, totalling $542.40.",
    },
    classification: "correct_grouped_invoice_payment",
    reason:
      "Ottawa Painters confirmed JrB $542.40 is the correct payment for XDesign invoices #8584 and #8586.",
  },
  {
    id: "b01979d2-f2fb-4053-859a-5063d93b3b6e",
    description: "SEND E-TFR ***n2H",
    counterparty: "XDesign Dev Inc",
    amount: 372.9,
    desired: {
      review_status: "needs_review",
      notes:
        "Confirmed $372.90 XDesign overpayment. Invoice #8586 is already settled as part of the correct JrB $542.40 payment; retain this bank expense pending refund or supplier credit.",
    },
    classification: "confirmed_subcontractor_overpayment",
    confirmedOverpayment: {
      correctPaymentId: "ef0b5397-97da-4f20-b094-07a305363b55",
      duplicatedInvoiceId: "7584089c-caa2-4233-aa4d-d37352c12f8f",
      amount: 372.9,
    },
    reason:
      "Ottawa Painters confirmed n2H $372.90 was paid in excess after invoice #8586 had already been included in the correct JrB $542.40 payment.",
  },
];

const CURB_APPEAL_LINES = [
  {
    id: "dc9cbc5c-6c30-4bb9-abe0-fe7fc9bee054",
    invoiceId: "43e526bb-d915-401e-a25f-ff0e0b9ec2ae",
    lineNumber: 1,
    entryType: "expense",
    description: "Pressure Wash Parging — Rashonda Legault",
    amountBeforeTax: 90,
    taxAmount: 0,
    sourceReference: "curb-appeal:1375:pressure-wash-parging",
    sourceText:
      "Invoice #1375: Rashonda Legault — Pressure Washing; May 19, 2026; Pressure Wash Parging; $90.00.",
  },
  {
    id: "b3ba834e-2f6a-4fac-916d-89cbb7f3b93a",
    invoiceId: "87af7349-6936-4a88-9833-c9e927023356",
    lineNumber: 1,
    entryType: "expense",
    description: "Deck & Windows Wash — Tareq Shiblaq",
    amountBeforeTax: 150,
    taxAmount: 0,
    sourceReference: "curb-appeal:1376:deck-windows-wash",
    sourceText:
      "Invoice #1376: Tareq Shiblaq — Deck & Windows Wash; May 20, 2026; $150.00.",
  },
  {
    id: "7a760ece-6dc8-4bf3-bf0b-c6b66e7a23b6",
    invoiceId: "30ee0dcf-2e47-4262-aadf-079bd80928ca",
    lineNumber: 1,
    entryType: "expense",
    description: "Exterior Siding Wash — Saroeun Cole",
    amountBeforeTax: 200,
    taxAmount: 0,
    sourceReference: "curb-appeal:1377:exterior-siding-wash",
    sourceText:
      "Invoice #1377: Saroeun Cole — Exterior Siding Wash; May 16, 2026; $200.00.",
  },
];

const CALEDONIAN_INVOICES = [
  {
    id: "eea3d610-7db9-4b85-a0bf-0e39579b8aaf",
    number: "380069",
    beforeTax: 5107.86,
    tax: 607.36,
    seedLineId: "247e50b4-df92-4d93-bf15-a56f09651a05",
    lines: [
      {
        entryType: "material",
        description: "Paint — Gordon Zans and Carly Prate jobs",
        amountBeforeTax: 435.87,
        taxAmount: 0,
        sourceText:
          "Paint: Sherwin $224.84 (Gordon Zans) + Ben Moore $211.03 (Carly Prate) = $435.87; source invoice shows $0.00 tax.",
      },
      {
        entryType: "expense",
        description: "Project management — 19 hours × $50",
        amountBeforeTax: 950,
        taxAmount: 123.5,
        sourceText:
          "Project Management: Jan 21–30; total 19 hours × $50 = $950.00; tax $123.50.",
      },
      {
        entryType: "commission",
        description: "Sales commission — 6% of $62,033.26",
        amountBeforeTax: 3721.99,
        taxAmount: 483.86,
        sourceText: "Sales: $62,033.26 at 6% = $3,721.99; tax $483.86.",
      },
    ],
  },
  {
    id: "f9e1aa0a-3121-4172-882c-91008638e2da",
    number: "1",
    beforeTax: 7525.65,
    tax: 888.82,
    lines: [
      {
        entryType: "commission",
        description: "Sales commissions — Shawn, Natasha and Katie",
        amountBeforeTax: 337.08,
        taxAmount: 0,
        sourceText:
          "Sales: Shawn Myers $141.90 + Natasha Beauparlant $39.30 + Katie Kobia $155.88 = $337.08.",
      },
      {
        entryType: "expense",
        description: "Business expenses — paint, equipment and parking",
        amountBeforeTax: 688.57,
        taxAmount: 0,
        sourceText:
          "Expenses: extension pole, Benjamin Moore, Home Depot, parking and Sherwin Williams = $688.57.",
      },
      {
        entryType: "expense",
        description: "Sales & project-management base",
        amountBeforeTax: 6500,
        taxAmount: 0,
        sourceText: "Sales & Project Management Base = $6,500.00.",
      },
      {
        entryType: "expense",
        description: "HST on invoice #1",
        amountBeforeTax: 0,
        taxAmount: 888.82,
        sourceText:
          "Invoice #1 shows total HST of $888.82 without a per-line tax breakdown; tax is preserved as its own source line.",
      },
    ],
  },
  {
    id: "e921e252-1c25-47d7-adc2-f9fd731a3772",
    number: "239605",
    beforeTax: 12299.83,
    tax: 1408.77,
    seedLineId: "fe52ae40-0dc0-4e19-8d17-412431a8de62",
    lines: [
      {
        entryType: "expense",
        description: "Base business consulting",
        amountBeforeTax: 6500,
        taxAmount: 0,
        sourceText: "Base Business Consulting = $6,500.00.",
      },
      {
        entryType: "commission",
        description: "Sales commission — March Ottawa Painters sales",
        amountBeforeTax: 4336.68,
        taxAmount: 0,
        sourceText: "Sales — OP sales done in March = $4,336.68.",
      },
      {
        entryType: "material",
        description: "Paint — Sonya Lee and Darko jobs",
        amountBeforeTax: 1463.15,
        taxAmount: 0,
        sourceText:
          "Paint: Preston Paints $1,106.34 (Sonya Lee) + Merivale Paints $356.81 (Darko) = $1,463.15; zero-rated on source invoice.",
      },
      {
        entryType: "expense",
        description: "HST on taxable consulting and commission",
        amountBeforeTax: 0,
        taxAmount: 1408.77,
        sourceText:
          "Invoice #239605 shows HST of $1,408.77 on taxable net $10,836.68; zero-rated paint is excluded.",
      },
    ],
  },
  {
    id: "ab85002a-026b-43ba-a57b-f25ea824385a",
    number: "239606",
    beforeTax: 10256.71,
    tax: 1319.15,
    seedLineId: "6723f0ff-90bd-48cb-8fb7-1fd04673d9b9",
    lines: [
      {
        entryType: "commission",
        description: "Sales commission — 6% of $60,789",
        amountBeforeTax: 3647.34,
        taxAmount: 0,
        sourceText: "Sales OP: 6% of $60,789 = $3,647.34.",
      },
      {
        entryType: "expense",
        description: "Base business development",
        amountBeforeTax: 6500,
        taxAmount: 0,
        sourceText: "Base Business Development = $6,500.00.",
      },
      {
        entryType: "material",
        description: "Benjamin Moore supplies",
        amountBeforeTax: 109.37,
        taxAmount: 0,
        sourceText:
          "Services — Benjamin Moore = $109.37; zero-rated on source invoice.",
      },
      {
        entryType: "expense",
        description: "HST on taxable business development and commission",
        amountBeforeTax: 0,
        taxAmount: 1319.15,
        sourceText:
          "Invoice #239606 shows HST of $1,319.15 on taxable net $10,147.34.",
      },
    ],
  },
  {
    id: "b006a973-44c3-4bcd-aa45-0408268ecb82",
    number: "239607",
    beforeTax: 10863.6,
    tax: 1392.5,
    seedLineId: "6ee927f9-720e-480c-a107-5a9727dbd9f2",
    lines: [
      {
        entryType: "commission",
        description: "Sales commission — 6% of $70,192",
        amountBeforeTax: 4211.52,
        taxAmount: 0,
        sourceText: "Sales OP: 6% of $70,192 = $4,211.52.",
      },
      {
        entryType: "expense",
        description: "Base business development",
        amountBeforeTax: 6500,
        taxAmount: 0,
        sourceText: "Base Business Development = $6,500.00.",
      },
      {
        entryType: "material",
        description: "Benjamin Moore supplies — Boulet",
        amountBeforeTax: 152.08,
        taxAmount: 0,
        sourceText:
          "Services — Benjamin Moore $152.08 (Boulet); zero-rated on source invoice.",
      },
      {
        entryType: "expense",
        description: "HST on taxable business development and commission",
        amountBeforeTax: 0,
        taxAmount: 1392.5,
        sourceText:
          "Invoice #239607 shows HST of $1,392.50 on taxable net $10,711.52.",
      },
    ],
  },
  {
    id: "4cabfd2a-98af-4422-810c-9e57fabd42c3",
    number: "239608",
    beforeTax: 9032.67,
    tax: 1160.38,
    seedLineId: "b59cbb4c-9a28-4743-af11-a0d192526fa6",
    lines: [
      {
        entryType: "commission",
        description: "Sales commission — 6% of $40,434",
        amountBeforeTax: 2426,
        taxAmount: 0,
        sourceText: "Sales OP: 6% of $40,434 = $2,426.00.",
      },
      {
        entryType: "expense",
        description: "Base business development",
        amountBeforeTax: 6500,
        taxAmount: 0,
        sourceText: "Base Business Development = $6,500.00.",
      },
      {
        entryType: "material",
        description: "Benjamin Moore supplies",
        amountBeforeTax: 34.42,
        taxAmount: 0,
        sourceText:
          "Services — Benjamin Moore supplies = $34.42; zero-rated on source invoice.",
      },
      {
        entryType: "material",
        description: "Benjamin Moore supplies",
        amountBeforeTax: 38.4,
        taxAmount: 0,
        sourceText:
          "Services — Benjamin Moore supplies = $38.40; zero-rated on source invoice.",
      },
      {
        entryType: "material",
        description: "Home Depot supplies",
        amountBeforeTax: 33.85,
        taxAmount: 0,
        sourceText:
          "Services — Home Depot supplies = $33.85; zero-rated on source invoice.",
      },
      {
        entryType: "expense",
        description: "HST on taxable business development and commission",
        amountBeforeTax: 0,
        taxAmount: 1160.38,
        sourceText:
          "Invoice #239608 shows HST of $1,160.38 on taxable net $8,926.00.",
      },
    ],
  },
];

const WRONG_CALEDONIAN_LINE_ALLOCATION = {
  invoiceLineId: "247e50b4-df92-4d93-bf15-a56f09651a05",
  projectId: "dripjobs-2394323",
  amount: 5107.86,
  reason:
    "The legacy derived row assigned the entire mixed Caledonian invoice #380069 to Gordon Zans as labour. The source invoice instead contains paint, project-management overhead and sales commission, so the derived labour/job allocation is removed.",
};

const XDESIGN = {
  correctPaymentId: "ef0b5397-97da-4f20-b094-07a305363b55",
  overpaymentId: "b01979d2-f2fb-4053-859a-5063d93b3b6e",
  invoice8584Id: "404d9e86-745b-4142-bdfb-43d428b0211f",
  invoice8586Id: "7584089c-caa2-4233-aa4d-d37352c12f8f",
  overpaymentAllocationId: "6a79c517-195f-479d-868c-6fb838c4eca4",
  amount8586: 372.9,
  invoiceMessageId: "19ea6b97a37118c6",
  correctPaymentMessageId: "19ea255e8ec0e7b8",
};

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

function cents(value) {
  return Math.round(Number(value) * 100);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJson(child)]),
    );
  }
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sameValue(actual, expected) {
  if (typeof expected === "number") return cents(actual) === cents(expected);
  if (expected && typeof expected === "object") {
    return (
      JSON.stringify(canonicalJson(actual)) ===
      JSON.stringify(canonicalJson(expected))
    );
  }
  return actual === expected;
}

function objectChanged(current, desired) {
  return Object.entries(desired).some(
    ([key, value]) => !sameValue(current[key], value),
  );
}

async function insertAuditEvent(row) {
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
  env.SUPABASE_URL ||
  env.NEXT_PUBLIC_SUPABASE_URL ||
  env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== TARGET_PROJECT_REF) {
  throw new Error(`Refusing accounting changes for project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const invoiceIds = [
  ...new Set([
    ...CURB_APPEAL_LINES.map((line) => line.invoiceId),
    ...CALEDONIAN_INVOICES.map((invoice) => invoice.id),
  ]),
];
const [transactionsResult, invoicesResult, invoiceLinesResult] =
  await Promise.all([
    db
      .from("financial_transactions")
      .select(
        "id,posted_on,description,counterparty,amount,currency,transaction_type,category,is_transfer,review_status,notes,source_data",
      )
      .in(
        "id",
        TRANSACTION_CORRECTIONS.map((correction) => correction.id),
      ),
    db
      .from("labour_invoices")
      .select(
        "id,invoice_number,amount_before_tax,tax_amount,amount_paid,match_status,document_type",
      )
      .in("id", invoiceIds),
    db.from("labour_invoice_lines").select("*").in("invoice_id", invoiceIds),
  ]);
for (const [label, result] of Object.entries({
  transactions: transactionsResult,
  invoices: invoicesResult,
  invoiceLines: invoiceLinesResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
assert(
  transactionsResult.data.length === TRANSACTION_CORRECTIONS.length,
  "One or more reviewed transactions are missing.",
);
assert(
  invoicesResult.data.length === invoiceIds.length,
  "One or more reviewed non-labour invoices are missing.",
);

const transactionById = new Map(
  transactionsResult.data.map((transaction) => [transaction.id, transaction]),
);
const invoiceById = new Map(
  invoicesResult.data.map((invoice) => [invoice.id, invoice]),
);
const invoiceLineById = new Map(
  invoiceLinesResult.data.map((line) => [line.id, line]),
);
const invoiceLineByReference = new Map(
  invoiceLinesResult.data
    .filter((line) => line.source_reference)
    .map((line) => [`${line.invoice_id}:${line.source_reference}`, line]),
);

let transactionUpdateCount = 0;
for (const correction of TRANSACTION_CORRECTIONS) {
  const transaction = transactionById.get(correction.id);
  assert(
    transaction.description === correction.description &&
      transaction.counterparty === correction.counterparty &&
      cents(Math.abs(transaction.amount)) === cents(correction.amount) &&
      transaction.currency === "CAD",
    `Transaction ${correction.description} no longer matches the reviewed bank evidence.`,
  );

  const sourceData = {
    ...(transaction.source_data ?? {}),
    accounting_classification: {
      classification: correction.classification,
      source: "Ottawa Painters administrator confirmation",
      confirmed_on: CONFIRMED_ON,
      reason: correction.reason,
    },
  };
  if (correction.cancelledPair) {
    sourceData.cancelled_e_transfer = {
      status: "cancelled",
      amount: correction.amount,
      reference: correction.cancelledPair.reference,
      paired_transaction_id: correction.cancelledPair.pairedTransactionId,
      role: correction.cancelledPair.role,
      confirmed_on: CONFIRMED_ON,
      evidence:
        transaction.source_data?.easyweb_e_transfer_evidence ??
        transaction.source_data?.td_interac_email_evidence ??
        null,
    };
  }
  if (correction.confirmedOverpayment) {
    sourceData.confirmed_overpayment = {
      status: "confirmed",
      amount: correction.confirmedOverpayment.amount,
      correct_payment_id: correction.confirmedOverpayment.correctPaymentId,
      duplicated_invoice_id:
        correction.confirmedOverpayment.duplicatedInvoiceId,
      confirmed_on: CONFIRMED_ON,
      reason: correction.reason,
    };
  }
  const desired = { ...correction.desired, source_data: sourceData };
  correction.resolvedDesired = desired;
  if (objectChanged(transaction, desired)) transactionUpdateCount += 1;
}

let invoiceUpdateCount = 0;
for (const invoice of CALEDONIAN_INVOICES) {
  const current = invoiceById.get(invoice.id);
  assert(
    current.invoice_number === invoice.number &&
      current.document_type === "invoice" &&
      cents(current.amount_before_tax) === cents(invoice.beforeTax) &&
      cents(current.tax_amount) === cents(invoice.tax),
    `Caledonian invoice #${invoice.number} no longer matches the reviewed source document.`,
  );
  if (current.match_status !== "overhead_unmatched") {
    invoiceUpdateCount += 1;
  }
}

const desiredLines = [
  ...CURB_APPEAL_LINES.map((line) => ({
    ...line,
    sourceKind: "extracted",
    needsReview: false,
  })),
  ...CALEDONIAN_INVOICES.flatMap((invoice) =>
    invoice.lines.map((line, index) => ({
      id: index === 0 ? invoice.seedLineId : null,
      invoiceId: invoice.id,
      lineNumber: index + 1,
      entryType: line.entryType,
      description: line.description,
      amountBeforeTax: line.amountBeforeTax,
      taxAmount: line.taxAmount,
      sourceKind: "extracted",
      sourceReference: `caledonian:${invoice.number}:line:${index + 1}`,
      sourceText: line.sourceText,
      needsReview: false,
    })),
  ),
];

let invoiceLineUpdateCount = 0;
let invoiceLineInsertCount = 0;
for (const line of desiredLines) {
  const current =
    invoiceLineByReference.get(`${line.invoiceId}:${line.sourceReference}`) ??
    (line.id ? invoiceLineById.get(line.id) : null);
  const desired = {
    invoice_id: line.invoiceId,
    line_number: line.lineNumber,
    entry_type: line.entryType,
    description: line.description,
    amount_before_tax: line.amountBeforeTax,
    tax_amount: line.taxAmount,
    source_kind: line.sourceKind,
    source_reference: line.sourceReference,
    source_text: line.sourceText,
    needs_review: line.needsReview,
  };
  line.current = current;
  line.desired = desired;
  if (!current) {
    invoiceLineInsertCount += 1;
  } else if (objectChanged(current, desired)) {
    invoiceLineUpdateCount += 1;
  }
}

const legacyAllocationResult = await db
  .from("labour_invoice_line_allocations")
  .select("*")
  .eq("invoice_line_id", WRONG_CALEDONIAN_LINE_ALLOCATION.invoiceLineId)
  .eq("companycam_project_id", WRONG_CALEDONIAN_LINE_ALLOCATION.projectId)
  .maybeSingle();
if (legacyAllocationResult.error) throw legacyAllocationResult.error;
if (legacyAllocationResult.data) {
  assert(
    cents(legacyAllocationResult.data.allocated_amount) ===
      cents(WRONG_CALEDONIAN_LINE_ALLOCATION.amount),
    "The reviewed legacy Caledonian job allocation has changed.",
  );
}

const xdesignAllocationsResult = await db
  .from("labour_payment_allocations")
  .select("*")
  .in("financial_transaction_id", [
    XDESIGN.correctPaymentId,
    XDESIGN.overpaymentId,
  ]);
if (xdesignAllocationsResult.error) throw xdesignAllocationsResult.error;
const activeXdesignAllocations = xdesignAllocationsResult.data.filter(
  (allocation) => allocation.reversed_at == null,
);
const activeOverpaymentAllocation = activeXdesignAllocations.find(
  (allocation) =>
    allocation.id === XDESIGN.overpaymentAllocationId &&
    allocation.invoice_id === XDESIGN.invoice8586Id,
);
const historicalCorrectAllocation = xdesignAllocationsResult.data.find(
  (allocation) =>
    allocation.financial_transaction_id === XDESIGN.correctPaymentId &&
    allocation.invoice_id === XDESIGN.invoice8586Id,
);
const activeCorrectAllocation = activeXdesignAllocations.find(
  (allocation) =>
    allocation.financial_transaction_id === XDESIGN.correctPaymentId &&
    allocation.invoice_id === XDESIGN.invoice8586Id,
);
assert(
  !historicalCorrectAllocation ||
    cents(historicalCorrectAllocation.allocated_amount) ===
      cents(XDESIGN.amount8586),
  "The existing JrB → #8586 allocation has an unexpected amount.",
);

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      transaction_updates: transactionUpdateCount,
      invoice_updates: invoiceUpdateCount,
      invoice_line_updates: invoiceLineUpdateCount,
      invoice_line_inserts: invoiceLineInsertCount,
      legacy_labour_job_allocation_deletes:
        legacyAllocationResult.data == null ? 0 : 1,
      xdesign_overpayment_allocation_reversals: activeOverpaymentAllocation
        ? 1
        : 0,
      xdesign_correct_allocation_inserts: activeCorrectAllocation ? 0 : 1,
    },
    null,
    2,
  ),
);
if (!APPLY) process.exit(0);

for (const correction of TRANSACTION_CORRECTIONS) {
  const current = transactionById.get(correction.id);
  const desired = correction.resolvedDesired;
  if (!objectChanged(current, desired)) continue;
  const oldValues = Object.fromEntries(
    Object.keys(desired).map((key) => [key, current[key]]),
  );
  const update = await db
    .from("financial_transactions")
    .update(desired)
    .eq("id", correction.id);
  if (update.error) throw update.error;
  await insertAuditEvent({
    entity_type: "payment",
    entity_id: correction.id,
    action: "update",
    old_values: oldValues,
    new_values: desired,
    reason: correction.reason,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

for (const invoice of CALEDONIAN_INVOICES) {
  const current = invoiceById.get(invoice.id);
  if (current.match_status === "overhead_unmatched") continue;
  const update = await db
    .from("labour_invoices")
    .update({ match_status: "overhead_unmatched" })
    .eq("id", invoice.id);
  if (update.error) throw update.error;
  await insertAuditEvent({
    entity_type: "invoice",
    entity_id: invoice.id,
    action: "update",
    old_values: { match_status: current.match_status },
    new_values: { match_status: "overhead_unmatched" },
    reason:
      "Caledonian invoice entries are sales commissions, business-development/project-management overhead and materials; the invoice is not subcontractor labour.",
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

if (legacyAllocationResult.data) {
  const deletion = await db
    .from("labour_invoice_line_allocations")
    .delete()
    .eq("invoice_line_id", WRONG_CALEDONIAN_LINE_ALLOCATION.invoiceLineId)
    .eq("companycam_project_id", WRONG_CALEDONIAN_LINE_ALLOCATION.projectId);
  if (deletion.error) throw deletion.error;
  await insertAuditEvent({
    entity_type: "job_allocation",
    entity_id: WRONG_CALEDONIAN_LINE_ALLOCATION.invoiceLineId,
    action: "update",
    old_values: legacyAllocationResult.data,
    new_values: null,
    reason: WRONG_CALEDONIAN_LINE_ALLOCATION.reason,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

for (const line of desiredLines) {
  if (line.current && !objectChanged(line.current, line.desired)) continue;
  if (line.current) {
    const oldValues = Object.fromEntries(
      Object.keys(line.desired).map((key) => [key, line.current[key]]),
    );
    const update = await db
      .from("labour_invoice_lines")
      .update(line.desired)
      .eq("id", line.current.id);
    if (update.error) throw update.error;
    await insertAuditEvent({
      entity_type: "invoice_line",
      entity_id: line.current.id,
      action: "update",
      old_values: oldValues,
      new_values: line.desired,
      reason:
        "Reclassified from the exact invoice text using Ottawa Painters' confirmed accounting treatment.",
      performed_by: ADMIN_USER_ID,
      performed_at: NOW,
    });
  } else {
    const insert = await db
      .from("labour_invoice_lines")
      .insert(line.desired)
      .select("id")
      .single();
    if (insert.error) throw insert.error;
    await insertAuditEvent({
      entity_type: "invoice_line",
      entity_id: insert.data.id,
      action: "insert",
      old_values: null,
      new_values: line.desired,
      reason:
        "Extracted from the exact invoice text using Ottawa Painters' confirmed accounting treatment.",
      performed_by: ADMIN_USER_ID,
      performed_at: NOW,
    });
  }
}

if (activeOverpaymentAllocation) {
  const reversalReason =
    "Ottawa Painters confirmed n2H is the $372.90 overpayment; invoice #8586 belongs to the correct grouped JrB $542.40 payment.";
  const reversal = await db
    .from("labour_payment_allocations")
    .update({
      reversed_at: NOW,
      reversed_by: ADMIN_USER_ID,
      reversal_reason: reversalReason,
    })
    .eq("id", activeOverpaymentAllocation.id)
    .is("reversed_at", null);
  if (reversal.error) throw reversal.error;
  await insertAuditEvent({
    entity_type: "invoice_payment",
    entity_id: activeOverpaymentAllocation.id,
    action: "reverse",
    old_values: { reversed_at: null, reversed_by: null },
    new_values: {
      reversed_at: NOW,
      reversed_by: ADMIN_USER_ID,
      reversal_reason: reversalReason,
    },
    reason: reversalReason,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

if (!activeCorrectAllocation) {
  const desiredAllocation = {
    financial_transaction_id: XDESIGN.correctPaymentId,
    invoice_id: XDESIGN.invoice8586Id,
    allocated_amount: XDESIGN.amount8586,
    match_method: [
      "verified_contractor_identity",
      "user_confirmed_payment_order",
      "unique_exact_invoice_sum",
      "bank_record",
    ],
    invoice_source_message_id: XDESIGN.invoiceMessageId,
    payment_confirmation_message_id: XDESIGN.correctPaymentMessageId,
    confirmed_by: ADMIN_USER_ID,
    confirmed_at: NOW,
    notes:
      "Ottawa Painters confirmed JrB $542.40 is the correct grouped invoice payment: #8584 $169.50 plus #8586 $372.90. The later n2H $372.90 is preserved as an overpayment.",
  };
  const allocation = await db
    .from("labour_payment_allocations")
    .insert(desiredAllocation);
  if (allocation.error) throw allocation.error;
}

const [verificationResult, lineVerificationResult, pairVerificationResult] =
  await Promise.all([
    db
      .from("labour_payment_verification")
      .select(
        "financial_transaction_id,payment_amount,total_allocated_amount,unallocated_amount,payment_status",
      )
      .in("financial_transaction_id", [
        XDESIGN.correctPaymentId,
        XDESIGN.overpaymentId,
      ]),
    db
      .from("labour_invoice_lines")
      .select("invoice_id,amount_before_tax,tax_amount")
      .in("invoice_id", invoiceIds),
    db
      .from("financial_transactions")
      .select(
        "id,transaction_type,category,is_transfer,review_status,source_data",
      )
      .in(
        "id",
        TRANSACTION_CORRECTIONS.map((correction) => correction.id),
      ),
  ]);
for (const result of [
  verificationResult,
  lineVerificationResult,
  pairVerificationResult,
]) {
  if (result.error) throw result.error;
}

const jrB = verificationResult.data.find(
  (row) => row.financial_transaction_id === XDESIGN.correctPaymentId,
);
const n2H = verificationResult.data.find(
  (row) => row.financial_transaction_id === XDESIGN.overpaymentId,
);
assert(
  jrB?.payment_status === "fully_allocated" &&
    cents(jrB.total_allocated_amount) === cents(542.4) &&
    cents(jrB.unallocated_amount) === 0,
  "JrB did not become the fully matched $542.40 payment.",
);
assert(
  n2H?.payment_status === "unmatched" &&
    cents(n2H.total_allocated_amount) === 0 &&
    cents(n2H.unallocated_amount) === cents(372.9),
  "n2H did not become the visible $372.90 overpayment.",
);

for (const invoiceId of invoiceIds) {
  const invoice = invoiceById.get(invoiceId);
  const lines = lineVerificationResult.data.filter(
    (line) => line.invoice_id === invoiceId,
  );
  assert(
    cents(
      lines.reduce((total, line) => total + Number(line.amount_before_tax), 0),
    ) === cents(invoice.amount_before_tax) &&
      cents(
        lines.reduce((total, line) => total + Number(line.tax_amount), 0),
      ) === cents(invoice.tax_amount),
    `Invoice lines for ${invoiceId} do not equal the source invoice totals.`,
  );
}

console.log(
  JSON.stringify(
    {
      applied: true,
      transactions_verified: pairVerificationResult.data.length,
      invoices_verified: invoiceIds.length,
      xdesign_correct_payment: {
        reference: "JrB",
        amount: 542.4,
        status: jrB.payment_status,
      },
      xdesign_overpayment: {
        reference: "n2H",
        amount: 372.9,
        status: "confirmed_overpayment",
      },
    },
    null,
    2,
  ),
);
