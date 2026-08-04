#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const ACCOUNT_ID = "c3fe49f6-c4d8-43dd-ae8a-7e799912305e";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();
const REVIEWED_ON = "2026-07-30";

const CONTRACTORS = {
  amg: {
    id: "532d06b9-eb55-49cf-b8a5-88623da5b118",
    name: "AMG Service Construction",
  },
  fennec: {
    id: "d527f5d1-322a-43b0-8343-d5ac67ef5d83",
    name: "Fennec Contracting",
  },
  grutenco: {
    id: "f3414a57-3a53-47b8-9f25-24be03fbca1c",
    name: "Grutenco Painting & Construction Services",
  },
  marcelo: {
    id: "93b35206-dc2d-4604-9ba3-ff64d57b44b5",
    name: "Angel Marcelo Cabrera",
  },
  michael: {
    id: "f7fbacc2-3135-4db1-b944-bbf1ee7cca3d",
    name: "Michael Prudhomme",
  },
  painttastic: {
    id: "730887dc-f2fa-4bb3-9a11-7acb03a59936",
    name: "PaintTastic Pro Inc",
  },
  phillip: {
    id: "a30d8df6-8f46-4069-b4af-6061c43b1cd6",
    name: "Phillip Hyde",
  },
  polaris: {
    id: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    name: "Polaris Painters",
  },
};

const TRANSACTIONS = {
  amgReimbursement: {
    id: "d6bc90f6-f0a4-4d2e-8fcc-6bacdb69eecd",
    date: "2026-05-21",
    description: "SEND E-TFR ***VvV",
    counterparty: "10509213 Canada Inc.",
    amount: 5905,
  },
  marcelo: {
    id: "0a400bd8-0f3e-49c7-afea-e84225051d67",
    date: "2026-02-20",
    description: "SEND E-TFR ***s2H",
    amount: 1665.62,
  },
  michael: {
    id: "3c852f1b-ccd5-43fc-9708-958fd6e12774",
    date: "2026-06-24",
    description: "SEND E-TFR ***Mw7",
    amount: 600,
  },
  painttastic: {
    id: "bd8f903c-b121-49d0-8b8d-3580e9688ce0",
    date: "2025-09-17",
    description: "SEND E-TFR ***Vmv",
    amount: 2260,
  },
  phillipSent: {
    id: "d8015be6-2972-471d-a284-ca02a8117136",
    date: "2025-07-22",
    description: "SEND E-TFR ***W7c",
    amount: -291.08,
  },
  phillipReturned: {
    id: "b5a41b11-e61b-4ca8-a6af-0fe1f00bc537",
    date: "2025-07-23",
    description: "E-TRANSFER ***hB8",
    amount: 291.08,
  },
  polarisIsabelle: {
    id: "b618bd08-cf00-4403-9a4b-53eb1fdd58c4",
    date: "2025-11-13",
    description: "SEND E-TFR ***hS9",
    amount: 2100,
  },
  polarisJustin: {
    id: "9030c57f-2b73-4963-9844-8bf756113a6b",
    date: "2026-01-12",
    description: "SEND E-TFR ***tqg",
    amount: 680,
  },
};

const EXISTING_INVOICES = {
  amg107: {
    id: "40d20d4d-4cd5-472c-a8e5-9482d6f8feb6",
    contractorId: CONTRACTORS.amg.id,
    number: "107",
    gross: 5905,
  },
  fennec2Old: {
    id: "af699bde-0989-4108-9430-8f083ebbf0c5",
    contractorId: CONTRACTORS.fennec.id,
    number: "2",
    gross: 1035,
  },
  grutencoJuly03: {
    id: "a1dd5593-2a01-4395-841a-3b48bec2d426",
    contractorId: CONTRACTORS.grutenco.id,
    number: "GT-INV-202607-03",
    gross: 1582,
  },
  grutencoJuly04: {
    id: "ed9b3190-bd48-48af-b7fc-dee814fe4e84",
    contractorId: CONTRACTORS.grutenco.id,
    number: "GT-INV-202707-04",
    gross: 2655.5,
  },
  philDebitNote: {
    id: "ccd433e4-caa9-4e4f-aefe-0c1a331e2a3f",
    number: "276606",
    gross: 291.08,
  },
  polaris51: {
    id: "5e4d0f46-05fd-4a3a-a37d-efee90476b89",
    contractorId: CONTRACTORS.polaris.id,
    number: "51",
    gross: 430,
  },
};

const NEW_INVOICES = [
  {
    key: "painttastic320438",
    contractor: CONTRACTORS.painttastic,
    invoiceNumber: "320438",
    invoiceDate: "2025-09-16",
    sourceDate: "2025-09-16",
    beforeTax: 2000,
    tax: 260,
    gross: 2260,
    sourcePath:
      "/Users/jadslim/.workspace-mcp/attachments/invoice-320438_c8808da0.pdf",
    expectedSha256:
      "acf640c690cdbcd10f2d914733267b1523afaef53f93920b2c30113c31e1f2d9",
    expectedSize: 32237,
    mimeType: "application/pdf",
    originalFilename: "2025-09-16 - PaintTastic invoice-320438.pdf",
    messageId: "1995375bd3b95663",
    textExcerpt:
      "PaintTastic Pro Inc invoice #320438 dated September 16, 2025. Materials reimbursement for the exterior project at 36 Marchbrook. Subtotal $2,000.00, tax $260.00, total $2,260.00.",
    lines: [
      {
        lineNumber: 1,
        entryType: "material",
        description:
          "Materials reimbursement — 36 Marchbrook exterior project",
        amountBeforeTax: 2000,
        taxAmount: 260,
        sourceText:
          "Materials — Reimbursement for materials purchased for the exterior project at 36 Marchbrook — $2,000.00 plus $260.00 tax.",
      },
    ],
  },
  {
    key: "marcelo2",
    contractor: CONTRACTORS.marcelo,
    invoiceNumber: "2",
    invoiceDate: "2026-02-20",
    sourceDate: "2026-02-20",
    beforeTax: 1665.62,
    tax: 0,
    gross: 1665.62,
    sourcePath:
      "/Users/jadslim/.workspace-mcp/attachments/1000170276_fd7f1d46.heic",
    expectedSha256:
      "fd1d93a146d7f9a3bcc852f97d109c3ec3c466bf6424ff17b9d5372a58b4b8c4",
    expectedSize: 6678848,
    mimeType: "image/heic",
    originalFilename: "2026-02-20 - Angel Marcelo Cabrera invoice 2.heic",
    messageId: "19c7c5a113ffaee0",
    textExcerpt:
      "Handwritten Angel Marcelo Cabrera invoice #2 dated February 20, 2026. Printed total and amount paid are $1,665.62. The six handwritten line amounts add to $1,665.63, so a visible one-cent rounding adjustment is retained.",
    lines: [
      {
        lineNumber: 1,
        entryType: "labour",
        description: "Roberval Avenue — February 12",
        serviceStartedOn: "2026-02-12",
        serviceEndedOn: "2026-02-12",
        amountBeforeTax: 325,
        taxAmount: 0,
        sourceText: "February 12 — Roberval Avenue — $325.00",
      },
      {
        lineNumber: 2,
        entryType: "labour",
        description: "Roberval Avenue — February 13",
        serviceStartedOn: "2026-02-13",
        serviceEndedOn: "2026-02-13",
        amountBeforeTax: 343.75,
        taxAmount: 0,
        sourceText: "February 13 — Roberval Avenue — $343.75",
      },
      {
        lineNumber: 3,
        entryType: "labour",
        description: "Roberval Avenue — February 17",
        serviceStartedOn: "2026-02-17",
        serviceEndedOn: "2026-02-17",
        amountBeforeTax: 312.5,
        taxAmount: 0,
        sourceText: "February 17 — Roberval Avenue — $312.50",
      },
      {
        lineNumber: 4,
        entryType: "labour",
        description: "Maple Grove Road — February 18",
        serviceStartedOn: "2026-02-18",
        serviceEndedOn: "2026-02-18",
        amountBeforeTax: 325,
        taxAmount: 0,
        sourceText: "February 18 — Maple Grove Road — $325.00",
      },
      {
        lineNumber: 5,
        entryType: "labour",
        description: "Maple Grove Road — February 19",
        serviceStartedOn: "2026-02-19",
        serviceEndedOn: "2026-02-19",
        amountBeforeTax: 305,
        taxAmount: 0,
        sourceText: "February 19 — Maple Grove Road — $305.00",
      },
      {
        lineNumber: 6,
        entryType: "labour",
        description: "Painting service — February 20",
        serviceStartedOn: "2026-02-20",
        serviceEndedOn: "2026-02-20",
        amountBeforeTax: 54.38,
        taxAmount: 0,
        sourceText: "February 20 — handwritten line amount $54.38",
      },
      {
        lineNumber: 7,
        entryType: "other",
        description: "Invoice arithmetic adjustment",
        amountBeforeTax: -0.01,
        taxAmount: 0,
        isAdjustment: true,
        needsReview: true,
        sourceText:
          "The six printed line amounts total $1,665.63, while the handwritten invoice total and payment are $1,665.62. This one-cent adjustment preserves the source total.",
      },
    ],
  },
  {
    key: "michaelEmail",
    contractor: CONTRACTORS.michael,
    invoiceNumber: "EMAIL-20260624",
    invoiceDate: "2026-06-24",
    sourceDate: "2026-06-24",
    beforeTax: 600,
    tax: 0,
    gross: 600,
    sourcePath:
      "/Users/jadslim/.workspace-mcp/attachments/Invoice_66660cb2.eml",
    expectedSha256:
      "269dbbfc3d3df0cb5fb429c6a412485d3a87f12475bcddd5750b750ff3630b81",
    expectedSize: 7821,
    mimeType: "message/rfc822",
    originalFilename: "2026-06-24 - Michael Prudhomme email invoice.eml",
    messageId: "19efaa2f58b6875c",
    textExcerpt:
      "Michael Prudhomme email invoice: 20 hours at $30/hour for June 12 and June 13, 2026, total $600.00. Ottawa Painters replied that payment was sent.",
    lines: [
      {
        lineNumber: 1,
        entryType: "labour",
        description: "Painting services — Friday, June 12",
        serviceStartedOn: "2026-06-12",
        serviceEndedOn: "2026-06-12",
        quantity: 10,
        unit: "hour",
        unitPrice: 30,
        quantityHours: 10,
        hourlyRate: 30,
        amountBeforeTax: 300,
        taxAmount: 0,
        sourceText: "Friday June 12, 8:00 a.m.–6:00 p.m. — 10 hours.",
      },
      {
        lineNumber: 2,
        entryType: "labour",
        description: "Painting services — Saturday, June 13",
        serviceStartedOn: "2026-06-13",
        serviceEndedOn: "2026-06-13",
        quantity: 10,
        unit: "hour",
        unitPrice: 30,
        quantityHours: 10,
        hourlyRate: 30,
        amountBeforeTax: 300,
        taxAmount: 0,
        sourceText: "Saturday June 13, 8:00 a.m.–6:00 p.m. — 10 hours.",
      },
    ],
  },
  {
    key: "polarisIsabelle",
    contractor: CONTRACTORS.polaris,
    invoiceNumber: "EMAIL-20251112",
    invoiceDate: "2025-11-12",
    sourceDate: "2025-11-12",
    beforeTax: 2100,
    tax: 0,
    gross: 2100,
    sourcePath:
      "/Users/jadslim/.workspace-mcp/attachments/Invoice from Polaris Painters - Isabelle Ares Invoice_6bd56814.eml",
    expectedSha256:
      "bef714f8108bf92f030fef947334c2f0399f63a4b9a7527442d5e9681b634387",
    expectedSize: 23131,
    mimeType: "message/rfc822",
    originalFilename: "2025-11-12 - Polaris Isabelle Ares email invoice.eml",
    messageId: "19a7a691753318b1",
    textExcerpt:
      "Polaris Painters email invoice for Isabelle Ares dated November 12, 2025. The email states an invoice total of $2,100.00 due upon receipt. No supplier invoice number was present in the archived email.",
    lines: [
      {
        lineNumber: 1,
        entryType: "labour",
        description: "Isabelle Ares painting services",
        amountBeforeTax: 2100,
        taxAmount: 0,
        sourceText:
          "Polaris Painters email: invoice for Isabelle Ares, total $2,100.00 due upon receipt.",
      },
    ],
  },
  {
    key: "fennec2Revised",
    contractor: CONTRACTORS.fennec,
    invoiceNumber: "2",
    invoiceDate: "2026-07-28",
    sourceDate: "2026-07-30",
    beforeTax: 1440,
    tax: 0,
    gross: 1440,
    sourcePath:
      "/Users/jadslim/.workspace-mcp/attachments/Invoice_2_2026-07-31_7374ee72.pdf",
    expectedSha256:
      "796d8a578384d7393819ab6b8e72d62f6d76f116e97639c21fdc3419945f7b10",
    expectedSize: 31691,
    mimeType: "application/pdf",
    originalFilename: "2026-07-30 - Fennec Invoice 2 revised.pdf",
    messageId: "19fb55a198a638e5",
    textExcerpt:
      "Fennec Contracting revised invoice #2, dated July 28, 2026 and received July 30. It lists 48 hours at $30/hour and a total of $1,440.00. A separate line says “Bonus: Anjou $30”, but the printed invoice total does not add that $30; the discrepancy is retained for review.",
    lines: [
      {
        lineNumber: 1,
        entryType: "labour",
        description: "Sally Bidal — July 15",
        serviceStartedOn: "2026-07-15",
        serviceEndedOn: "2026-07-15",
        quantity: 10.75,
        unit: "hour",
        unitPrice: 30,
        quantityHours: 10.75,
        hourlyRate: 30,
        amountBeforeTax: 322.5,
        taxAmount: 0,
        sourceText: "Sally Bidal — Wednesday, July 15 — 10h 45m.",
      },
      {
        lineNumber: 2,
        entryType: "labour",
        description: "Phil Anido — July 16",
        serviceStartedOn: "2026-07-16",
        serviceEndedOn: "2026-07-16",
        quantity: 8,
        unit: "hour",
        unitPrice: 30,
        quantityHours: 8,
        hourlyRate: 30,
        amountBeforeTax: 240,
        taxAmount: 0,
        sourceText: "Phil Anido — Thursday, July 16 — 8h.",
      },
      {
        lineNumber: 3,
        entryType: "labour",
        description: "Anjou Delplancke — July 17",
        serviceStartedOn: "2026-07-17",
        serviceEndedOn: "2026-07-17",
        quantity: 7.25,
        unit: "hour",
        unitPrice: 30,
        quantityHours: 7.25,
        hourlyRate: 30,
        amountBeforeTax: 217.5,
        taxAmount: 0,
        sourceText: "Anjou Delplancke — Friday, July 17 — 7h 15m.",
      },
      {
        lineNumber: 4,
        entryType: "labour",
        description: "Sue Deluney — July 28",
        serviceStartedOn: "2026-07-28",
        serviceEndedOn: "2026-07-28",
        quantity: 8.75,
        unit: "hour",
        unitPrice: 30,
        quantityHours: 8.75,
        hourlyRate: 30,
        amountBeforeTax: 262.5,
        taxAmount: 0,
        sourceText: "Sue Deluney — Tuesday, July 28 — 8h 45m.",
      },
      {
        lineNumber: 5,
        entryType: "labour",
        description: "Sue Deluney — July 29",
        serviceStartedOn: "2026-07-29",
        serviceEndedOn: "2026-07-29",
        quantity: 8.75,
        unit: "hour",
        unitPrice: 30,
        quantityHours: 8.75,
        hourlyRate: 30,
        amountBeforeTax: 262.5,
        taxAmount: 0,
        sourceText: "Sue Deluney — Wednesday, July 29 — 8h 45m.",
      },
      {
        lineNumber: 6,
        entryType: "labour",
        description: "Paul Toonders — July 30",
        serviceStartedOn: "2026-07-30",
        serviceEndedOn: "2026-07-30",
        quantity: 4.5,
        unit: "hour",
        unitPrice: 30,
        quantityHours: 4.5,
        hourlyRate: 30,
        amountBeforeTax: 135,
        taxAmount: 0,
        sourceText: "Paul Toonders — Thursday, July 30 — 4h 30m.",
      },
      {
        lineNumber: 7,
        entryType: "bonus",
        description:
          "Anjou bonus stated on invoice but not added to printed total",
        amountBeforeTax: 0,
        taxAmount: 0,
        needsReview: true,
        sourceText:
          "The invoice says “Bonus: Anjou $30” while also stating 48h @ $30/h and total $1,440.00. Adding the bonus would produce $1,470.00, so no unsupported $30 payable was created.",
      },
    ],
  },
];

const JAD_MROUEH_TRANSACTION_IDS = [
  "8e1bc876-d760-489c-a85c-e4832c035bae",
  "c021bf82-3321-4631-b382-fefe0e4b2928",
  "c5e04639-9737-4334-a8a1-7601deb9a96a",
  "b482a12b-df22-4409-aaf6-7d2de9e6e524",
  "e60e2a6f-b86e-403e-9ea0-b00fd2ec8214",
  "8ee96085-8b14-4ad6-97af-5527ba7d35bb",
  "6746219a-895e-41b7-93bb-a634f4e28544",
  "7b221a4f-317f-4044-bf99-c421573a10c1",
  "8ea10a52-5e72-4916-97ab-6637ff67dcad",
  "ff4dcdac-8ac3-4301-9240-7165264ddac2",
  "fbe610cc-bbcb-47ea-bc4e-80951ee57130",
  "a8dd5891-1a6a-44d2-930f-354d842691dd",
  "742c6694-f9a8-4b9f-a176-44bc4b18f594",
];
const M_AND_A_TRANSACTION_ID = "6680c4bf-aef6-4bf6-8ee8-7947adf9e54d";
const YOUSSEF_PAYMENT_IDS = [
  "31101d5e-0c1a-43e6-82b8-e476f1343424",
  "dd3d007a-5d8f-40ee-9d37-9553f7fd8007",
  "ed2b0fb3-8b5f-4eb7-9d78-b22e83d2f0c1",
  "24ff3033-16f8-4267-832d-3217ec07ef7f",
  "7fecc380-de39-4d4e-9ad9-28f78080a5e0",
  "bdd7b861-0518-44d9-a2b8-12db22549767",
  "b1939ba0-7021-4f6e-9730-7c03f734ac45",
  "5528fe63-cf89-471f-b86e-36617cf5443e",
];

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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
}

function sourceObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value;
}

function changed(current, desired) {
  return Object.entries(desired).some(
    ([key, value]) =>
      JSON.stringify(canonicalJson(current?.[key])) !==
      JSON.stringify(canonicalJson(value)),
  );
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

async function upsertPaymentRecord(db, {
  transactionId,
  contractor,
  method,
  note,
}) {
  const result = await db.from("labour_payment_records").upsert(
    {
      financial_transaction_id: transactionId,
      contractor_id: contractor.id,
      recipient_status: "confirmed",
      confirmation_method: method,
      confirmation_note: note,
      confirmed_by: ADMIN_USER_ID,
      confirmed_at: NOW,
      inserted_by: ADMIN_USER_ID,
    },
    { onConflict: "financial_transaction_id" },
  );
  if (result.error) throw result.error;
}

async function ensureAllocation(db, {
  transactionId,
  invoiceId,
  amount,
  methods,
  invoiceMessageId,
  paymentMessageId,
  notes,
}) {
  const existing = await db
    .from("labour_payment_allocations")
    .select("id,allocated_amount")
    .eq("financial_transaction_id", transactionId)
    .eq("invoice_id", invoiceId)
    .is("reversed_at", null)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) {
    assert(
      cents(existing.data.allocated_amount) === cents(amount),
      `Allocation ${transactionId} → ${invoiceId} has a different amount.`,
    );
    return existing.data.id;
  }
  const insertion = await db
    .from("labour_payment_allocations")
    .insert({
      financial_transaction_id: transactionId,
      invoice_id: invoiceId,
      allocated_amount: amount,
      match_method: methods,
      invoice_source_message_id: invoiceMessageId ?? null,
      payment_confirmation_message_id: paymentMessageId ?? null,
      confirmed_by: ADMIN_USER_ID,
      confirmed_at: NOW,
      inserted_by: ADMIN_USER_ID,
      notes,
    })
    .select("id")
    .single();
  if (insertion.error) throw insertion.error;
  return insertion.data.id;
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
assert(
  projectRef === TARGET_PROJECT_REF,
  `Refusing reconciliation for unexpected project ${projectRef}.`,
);
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

for (const invoice of NEW_INVOICES) {
  assert(existsSync(invoice.sourcePath), `Missing ${invoice.sourcePath}.`);
  const file = readFileSync(invoice.sourcePath);
  assert(
    sha256(file) === invoice.expectedSha256,
    `${invoice.originalFilename} hash changed.`,
  );
  assert(
    file.byteLength === invoice.expectedSize,
    `${invoice.originalFilename} size changed.`,
  );
  assert(
    cents(
      invoice.lines.reduce(
        (total, line) => total + Number(line.amountBeforeTax),
        0,
      ),
    ) === cents(invoice.beforeTax),
    `${invoice.originalFilename} lines do not equal the pre-tax total.`,
  );
  assert(
    cents(invoice.beforeTax + invoice.tax) === cents(invoice.gross),
    `${invoice.originalFilename} total is invalid.`,
  );
}

const existingInvoiceIds = Object.values(EXISTING_INVOICES).map(
  (invoice) => invoice.id,
);
const existingTransactionIds = Object.values(TRANSACTIONS).map(
  (transaction) => transaction.id,
);
const reviewedTransactionIds = [
  ...existingTransactionIds,
  ...JAD_MROUEH_TRANSACTION_IDS,
  M_AND_A_TRANSACTION_ID,
  ...YOUSSEF_PAYMENT_IDS,
];
const [
  contractorsResult,
  invoicesResult,
  transactionsResult,
  allocationsResult,
  newInvoiceLookupResult,
  accountResult,
] = await Promise.all([
  db
    .from("labour_contractors")
    .select("id,supplier_name")
    .in(
      "id",
      Object.values(CONTRACTORS).map((contractor) => contractor.id),
    ),
  db
    .from("labour_invoices")
    .select(
      "id,contractor_id,supplier_name,invoice_number,invoice_date,amount_before_tax,tax_amount,document_type,match_status,supporting_invoice_reference,duplicate_group_id,duplicate_group_size",
    )
    .in("id", existingInvoiceIds),
  db
    .from("financial_transactions")
    .select(
      "id,posted_on,description,counterparty,amount,tax_amount,currency,transaction_type,category,is_transfer,review_status,notes,source_data",
    )
    .in("id", reviewedTransactionIds),
  db
    .from("labour_payment_allocations")
    .select(
      "id,financial_transaction_id,invoice_id,allocated_amount,reversed_at",
    )
    .in("financial_transaction_id", reviewedTransactionIds)
    .is("reversed_at", null),
  db
    .from("labour_invoices")
    .select("id,content_sha256,invoice_number")
    .in(
      "content_sha256",
      NEW_INVOICES.map((invoice) => invoice.expectedSha256),
    ),
  db
    .from("financial_accounts")
    .select("id,name,last_four,currency,is_active")
    .eq("id", ACCOUNT_ID)
    .single(),
]);
for (const [label, result] of Object.entries({
  contractors: contractorsResult,
  invoices: invoicesResult,
  transactions: transactionsResult,
  allocations: allocationsResult,
  newInvoices: newInvoiceLookupResult,
  account: accountResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
assert(
  contractorsResult.data.length === Object.keys(CONTRACTORS).length,
  "One or more reviewed contractors are missing.",
);
for (const expected of Object.values(CONTRACTORS)) {
  const contractor = contractorsResult.data.find(
    (candidate) => candidate.id === expected.id,
  );
  assert(
    contractor?.supplier_name === expected.name,
    `Contractor ${expected.id} changed.`,
  );
}
assert(
  accountResult.data.name === "Business Chequing" &&
    accountResult.data.last_four === "6970" &&
    accountResult.data.currency === "CAD" &&
    accountResult.data.is_active,
  "Expected TD Business Chequing account was not found.",
);

const invoiceById = new Map(
  invoicesResult.data.map((invoice) => [invoice.id, invoice]),
);
for (const expected of Object.values(EXISTING_INVOICES)) {
  const invoice = invoiceById.get(expected.id);
  assert(invoice, `Missing invoice ${expected.id}.`);
  assert(
    invoice.invoice_number === expected.number &&
      cents(invoice.amount_before_tax) + cents(invoice.tax_amount) ===
        cents(expected.gross),
    `Invoice #${expected.number} no longer matches the reviewed total.`,
  );
  if (expected.contractorId) {
    assert(
      invoice.contractor_id === expected.contractorId,
      `Invoice #${expected.number} contractor changed.`,
    );
  }
}

const transactionById = new Map(
  transactionsResult.data.map((transaction) => [transaction.id, transaction]),
);
for (const expected of Object.values(TRANSACTIONS)) {
  const transaction = transactionById.get(expected.id);
  assert(transaction, `Missing transaction ${expected.id}.`);
  assert(
    transaction.posted_on === expected.date &&
      transaction.description === expected.description &&
      Math.abs(cents(transaction.amount)) ===
        Math.abs(cents(expected.amount)) &&
      transaction.currency === "CAD",
    `${expected.description} no longer matches the reviewed bank row.`,
  );
  if (expected.counterparty) {
    assert(
      transaction.counterparty === expected.counterparty,
      `${expected.description} counterparty changed.`,
    );
  }
}
assert(
  cents(TRANSACTIONS.phillipSent.amount) +
    cents(TRANSACTIONS.phillipReturned.amount) ===
    0,
  "Phillip Hyde returned-payment pair does not net to zero.",
);
const activeAllocationByTransaction = new Map();
for (const allocation of allocationsResult.data ?? []) {
  const list =
    activeAllocationByTransaction.get(allocation.financial_transaction_id) ??
    [];
  list.push(allocation);
  activeAllocationByTransaction.set(allocation.financial_transaction_id, list);
}
for (const transactionId of [
  TRANSACTIONS.phillipSent.id,
  TRANSACTIONS.phillipReturned.id,
  ...JAD_MROUEH_TRANSACTION_IDS,
  M_AND_A_TRANSACTION_ID,
]) {
  assert(
    !(activeAllocationByTransaction.get(transactionId)?.length > 0),
    `Transaction ${transactionId} unexpectedly has an active invoice allocation.`,
  );
}
assert(
  YOUSSEF_PAYMENT_IDS.every((id) => {
    const transaction = transactionById.get(id);
    return (
      transaction?.source_data?.reconciliation_research?.status ===
      "no_invoice_provided"
    );
  }),
  "One or more Youssef Mroueh payments lost the no-invoice classification.",
);

const planned = {
  new_invoice_sources:
    NEW_INVOICES.length - (newInvoiceLookupResult.data?.length ?? 0),
  revised_invoice_versions: 1,
  invoice_allocations: 8,
  imported_bank_transactions: 1,
  returned_payment_pairs: 1,
  invoice_not_found_transactions:
    JAD_MROUEH_TRANSACTION_IDS.length + 1,
  user_confirmed_no_invoice_transactions: YOUSSEF_PAYMENT_IDS.length,
};
console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      planned,
      matched_evidence: {
        painttastic: 2260,
        marcelo: 1665.62,
        michael_prudhomme: 600,
        polaris_isabelle: 2100,
        polaris_justin_invoice_component: 430,
        amg_reimbursement: 5905,
        grutenco_grouped_payment: 4237.5,
      },
      retained_exceptions: {
        polaris_unexplained_remainder: 250,
        fennec_bonus_line_inconsistent_with_total: 30,
        marcelo_invoice_arithmetic_difference: 0.01,
        phillip_returned_payment_net: 0,
      },
    },
    null,
    2,
  ),
);
if (!APPLY) process.exit(0);

const insertedInvoices = new Map();
for (const invoice of NEW_INVOICES) {
  const file = readFileSync(invoice.sourcePath);
  const storagePath =
    `gmail-labour-invoices/${invoice.sourceDate}/` +
    `${invoice.expectedSha256.slice(0, 16)}-${invoice.originalFilename}`;
  const upload = await db.storage
    .from("labour-invoices")
    .upload(storagePath, file, {
      contentType: invoice.mimeType,
      cacheControl: "3600",
      upsert: false,
    });
  if (
    upload.error &&
    String(upload.error.statusCode) !== "409" &&
    !/already exists|duplicate/i.test(upload.error.message)
  ) {
    throw new Error(`Upload failed: ${upload.error.message}`);
  }

  const duplicateGroupId =
    invoice.key === "fennec2Revised"
      ? sha256("Fennec Contracting:2").slice(0, 16)
      : null;
  const existed = (newInvoiceLookupResult.data ?? []).some(
    (candidate) => candidate.content_sha256 === invoice.expectedSha256,
  );
  const upsert = await db
    .from("labour_invoices")
    .upsert(
      {
        supplier_name: invoice.contractor.name,
        contractor_id: invoice.contractor.id,
        invoice_number: invoice.invoiceNumber,
        invoice_date: invoice.invoiceDate,
        currency: "CAD",
        amount_paid: invoice.gross,
        amount_before_tax: invoice.beforeTax,
        tax_amount: invoice.tax,
        payment_basis: "invoice_total",
        document_type: "invoice",
        match_status:
          invoice.key === "fennec2Revised" ? "matched_multiple" : "matched",
        storage_bucket: "labour-invoices",
        storage_path: storagePath,
        original_filename: invoice.originalFilename,
        mime_type: invoice.mimeType,
        file_size: invoice.expectedSize,
        content_sha256: invoice.expectedSha256,
        source_date: invoice.sourceDate,
        source_label: `Gmail / Labour Invoices · message ${invoice.messageId}`,
        duplicate_group_id: duplicateGroupId,
        duplicate_group_size:
          invoice.key === "fennec2Revised" ? 2 : 1,
        supporting_invoice_reference: null,
        text_excerpt: invoice.textExcerpt,
        inserted_by: ADMIN_USER_ID,
      },
      { onConflict: "content_sha256" },
    )
    .select("id,invoice_number,content_sha256")
    .single();
  if (upsert.error) throw upsert.error;
  insertedInvoices.set(invoice.key, upsert.data);

  if (!existed) {
    await insertAuditEvent(db, {
      entity_type: "invoice",
      entity_id: upsert.data.id,
      action: "insert",
      old_values: null,
      new_values: {
        supplier_name: invoice.contractor.name,
        invoice_number: invoice.invoiceNumber,
        amount_before_tax: invoice.beforeTax,
        tax_amount: invoice.tax,
        amount_after_tax: invoice.gross,
        source_message_id: invoice.messageId,
        content_sha256: invoice.expectedSha256,
      },
      reason:
        `Imported exact archived source for ${invoice.contractor.name} ` +
        `${invoice.invoiceNumber}; Gmail message ${invoice.messageId}.`,
      performed_by: ADMIN_USER_ID,
      performed_at: NOW,
    });
  }

  for (const line of invoice.lines) {
    const lineResult = await db.from("labour_invoice_lines").upsert(
      {
        invoice_id: upsert.data.id,
        line_number: line.lineNumber,
        entry_type: line.entryType,
        description: line.description,
        service_started_on: line.serviceStartedOn ?? null,
        service_ended_on: line.serviceEndedOn ?? null,
        quantity: line.quantity ?? null,
        unit: line.unit ?? null,
        unit_price: line.unitPrice ?? null,
        quantity_hours: line.quantityHours ?? null,
        hourly_rate: line.hourlyRate ?? null,
        amount_before_tax: line.amountBeforeTax,
        tax_amount: line.taxAmount,
        is_adjustment: line.isAdjustment ?? false,
        source_kind: "extracted",
        source_reference: `${invoice.key}:line:${line.lineNumber}`,
        source_text: line.sourceText,
        needs_review: line.needsReview ?? false,
        inserted_by: ADMIN_USER_ID,
      },
      { onConflict: "invoice_id,line_number" },
    );
    if (lineResult.error) throw lineResult.error;
  }
}

const fennecGroupId = sha256("Fennec Contracting:2").slice(0, 16);
const fennecOld = invoiceById.get(EXISTING_INVOICES.fennec2Old.id);
const fennecNew = insertedInvoices.get("fennec2Revised");
const fennecOldDesired = {
  match_status: "supporting_document",
  supporting_invoice_reference:
    `Superseded by revised invoice record ${fennecNew.id}`,
  duplicate_group_id: fennecGroupId,
  duplicate_group_size: 2,
};
if (changed(fennecOld, fennecOldDesired)) {
  const update = await db
    .from("labour_invoices")
    .update(fennecOldDesired)
    .eq("id", fennecOld.id);
  if (update.error) throw update.error;
  await insertAuditEvent(db, {
    entity_type: "invoice",
    entity_id: fennecOld.id,
    action: "update",
    old_values: {
      match_status: fennecOld.match_status,
      supporting_invoice_reference: fennecOld.supporting_invoice_reference,
    },
    new_values: fennecOldDesired,
    reason:
      "Fennec sent a revised invoice #2 on July 30 adding July 29 and July 30 work. The $1,035 copy is retained as superseded evidence; the current payable is $1,440.",
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const philInvoice = invoiceById.get(EXISTING_INVOICES.philDebitNote.id);
const philInvoiceDesired = {
  supplier_name: CONTRACTORS.phillip.name,
  contractor_id: CONTRACTORS.phillip.id,
  match_status: "supporting_document",
  supporting_invoice_reference:
    "Supplier email says cash was already received; W7c e-transfer was returned in full by hB8.",
};
if (changed(philInvoice, philInvoiceDesired)) {
  const update = await db
    .from("labour_invoices")
    .update(philInvoiceDesired)
    .eq("id", philInvoice.id);
  if (update.error) throw update.error;
  await insertAuditEvent(db, {
    entity_type: "invoice",
    entity_id: philInvoice.id,
    action: "update",
    old_values: {
      supplier_name: philInvoice.supplier_name,
      contractor_id: philInvoice.contractor_id,
      match_status: philInvoice.match_status,
    },
    new_values: philInvoiceDesired,
    reason:
      "The workbook identifies Phillip Hyde by email. His July 22 email says cash was already received, and the $291.08 e-transfer was returned the next day.",
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const grutencoManifest = {
  source: "TD Interac confirmation email and EasyWeb e-transfer history",
  reviewed_on: REVIEWED_ON,
  gmail_message_id: "19f9f7c71f2d53c2",
  recipient_name: "grutenco",
  recipient_email: "hello@grutenco.ca",
  date: "2026-07-26",
  amount: 4237.5,
  confirmation_reference: "CAgkYntd",
  confirmation_suffix: "ntd",
  status: "Deposited",
};
const manifestJson = JSON.stringify(grutencoManifest);
const manifestHash = sha256(manifestJson);
let importRecord;
const importLookup = await db
  .from("financial_imports")
  .select("*")
  .eq("content_sha256", manifestHash)
  .maybeSingle();
if (importLookup.error) throw importLookup.error;
if (importLookup.data) {
  importRecord = importLookup.data;
} else {
  const importInsert = await db
    .from("financial_imports")
    .insert({
      content_sha256: manifestHash,
      original_filename:
        "TD Interac confirmation 2026-07-26 Grutenco CAgkYntd.json",
      mime_type: "application/json",
      source_kind: "etransfer_report",
      account_id: ACCOUNT_ID,
      period_start: "2026-07-26",
      period_end: "2026-07-26",
      row_count: 1,
      source_message_id: "19f9f7c71f2d53c2",
      metadata: {
        ...grutencoManifest,
        evidence_role: "transaction_source",
        reconciliation_script: "reconcile-final-subcontractor-residuals.mjs",
      },
      imported_by: ADMIN_USER_ID,
    })
    .select("*")
    .single();
  if (importInsert.error) throw importInsert.error;
  importRecord = importInsert.data;
}

const grutencoSourceKey = sha256(
  "td-interac-email:19f9f7c71f2d53c2:CAgkYntd",
);
const grutencoTransactionUpsert = await db
  .from("financial_transactions")
  .upsert(
    {
      account_id: ACCOUNT_ID,
      import_id: importRecord.id,
      source_key: grutencoSourceKey,
      posted_on: "2026-07-26",
      transaction_on: "2026-07-26",
      description: "SEND E-TFR ***ntd",
      counterparty: CONTRACTORS.grutenco.name,
      amount: -4237.5,
      tax_amount: -487.5,
      currency: "CAD",
      transaction_type: "expense",
      category: "Subcontractors",
      is_transfer: false,
      review_status: "needs_review",
      notes:
        "TD confirmation CAgkYntd: $4,237.50 deposited to grutenco. This exactly equals invoices GT-INV-202607-03 ($1,582.00) and GT-INV-202707-04 ($2,655.50).",
      source_data: {
        source: "td_interac_confirmation_email",
        td_interac_email_evidence: {
          source:
            "TD Interac e-Transfer confirmation email in info@paintersottawa.com",
          status: "Deposited",
          sent_on: "2026-07-26",
          bank_posted_on: "2026-07-26",
          amount: 4237.5,
          recipient_name: "grutenco",
          recipient_email: "hello@grutenco.ca",
          gmail_message_id: "19f9f7c71f2d53c2",
          full_confirmation_reference: "CAgkYntd",
          confirmation_suffix: "ntd",
          match_method: "confirmation_suffix_amount_date",
        },
      },
    },
    { onConflict: "source_key" },
  )
  .select("id,posted_on,description,amount")
  .single();
if (grutencoTransactionUpsert.error) {
  throw grutencoTransactionUpsert.error;
}
const grutencoTransactionId = grutencoTransactionUpsert.data.id;

await upsertPaymentRecord(db, {
  transactionId: grutencoTransactionId,
  contractor: CONTRACTORS.grutenco,
  method: "payment_confirmation",
  note:
    "TD confirmation email 19f9f7c71f2d53c2 and EasyWeb confirm $4,237.50 to grutenco <hello@grutenco.ca>, reference CAgkYntd, deposited July 26, 2026.",
});
await ensureAllocation(db, {
  transactionId: grutencoTransactionId,
  invoiceId: EXISTING_INVOICES.grutencoJuly03.id,
  amount: 1582,
  methods: [
    "verified_recipient_email",
    "td_payment_confirmation",
    "unique_exact_invoice_sum",
    "same_contractor",
  ],
  invoiceMessageId: "19f81f4ee471ef77",
  paymentMessageId: "19f9f7c71f2d53c2",
  notes:
    "The two current Grutenco invoices total exactly $4,237.50. Allocated $1,582.00 to GT-INV-202607-03.",
});
await ensureAllocation(db, {
  transactionId: grutencoTransactionId,
  invoiceId: EXISTING_INVOICES.grutencoJuly04.id,
  amount: 2655.5,
  methods: [
    "verified_recipient_email",
    "td_payment_confirmation",
    "unique_exact_invoice_sum",
    "same_contractor",
  ],
  invoiceMessageId: "19f957677e3ea2dc",
  paymentMessageId: "19f9f7c71f2d53c2",
  notes:
    "The two current Grutenco invoices total exactly $4,237.50. Allocated $2,655.50 to GT-INV-202707-04.",
});

const invoiceIdsByKey = Object.fromEntries(
  [...insertedInvoices.entries()].map(([key, invoice]) => [key, invoice.id]),
);
const allocations = [
  {
    transaction: TRANSACTIONS.painttastic,
    contractor: CONTRACTORS.painttastic,
    invoiceId: invoiceIdsByKey.painttastic320438,
    amount: 2260,
    invoiceMessageId: "1995375bd3b95663",
    paymentMessageId: "19958251be165411",
    methods: [
      "invoice_number_in_vendor_receipt",
      "unique_exact_invoice_total",
      "td_payment_confirmation",
      "next_day_payment",
    ],
    paymentNote:
      "TD confirmation 19958251be165411 confirms $2,260.00 to PAINTTASTIC PRO PAINTING INC. Vendor receipt 199788a991b1d8d5 explicitly applies the payment to invoice #320438.",
    allocationNote:
      "Exact $2,260.00 payment for PaintTastic invoice #320438, confirmed by the supplier payment receipt and TD confirmation.",
  },
  {
    transaction: TRANSACTIONS.marcelo,
    contractor: CONTRACTORS.marcelo,
    invoiceId: invoiceIdsByKey.marcelo2,
    amount: 1665.62,
    invoiceMessageId: "19c7c5a113ffaee0",
    paymentMessageId: null,
    methods: [
      "exact_invoice_total",
      "same_day_payment",
      "easyweb_recipient_identity",
      "original_invoice_attachment",
    ],
    paymentNote:
      "TD EasyWeb confirms $1,665.62 to Marcelo Cabrera <mashelo325@gmail.com>, suffix s2H, autodeposited February 20, 2026. The same-day original invoice #2 has a printed total of $1,665.62.",
    allocationNote:
      "Same-day exact payment for Angel Marcelo Cabrera invoice #2. A one-cent source arithmetic discrepancy is visible in the normalized invoice lines.",
  },
  {
    transaction: TRANSACTIONS.michael,
    contractor: CONTRACTORS.michael,
    invoiceId: invoiceIdsByKey.michaelEmail,
    amount: 600,
    invoiceMessageId: "19efaa2f58b6875c",
    paymentMessageId: "19efaa59143bad43",
    methods: [
      "supplier_email_identity",
      "hours_times_rate",
      "same_day_exact_amount",
      "td_payment_confirmation",
    ],
    paymentNote:
      "Michael Prudhomme emailed an invoice for 20 hours at $30/hour. TD confirmation 19efaa59143bad43 confirms the same-day $600 payment, reference C1AgN9kz8Mw7.",
    allocationNote:
      "Michael Prudhomme email invoice is exactly 20 hours × $30 = $600; Ottawa Painters replied that payment was sent.",
  },
  {
    transaction: TRANSACTIONS.polarisIsabelle,
    contractor: CONTRACTORS.polaris,
    invoiceId: invoiceIdsByKey.polarisIsabelle,
    amount: 2100,
    invoiceMessageId: "19a7a691753318b1",
    paymentMessageId: "19a801037715bc11",
    methods: [
      "same_contractor",
      "unique_exact_invoice_total",
      "next_day_payment",
      "td_payment_confirmation",
    ],
    paymentNote:
      "Polaris emailed an Isabelle Ares invoice for exactly $2,100.00 on November 12. TD confirms $2,100.00 was deposited to Polaris the next day, reference CA4YEhS9.",
    allocationNote:
      "Exact next-day payment for the Polaris Isabelle Ares invoice email.",
  },
  {
    transaction: TRANSACTIONS.polarisJustin,
    contractor: CONTRACTORS.polaris,
    invoiceId: EXISTING_INVOICES.polaris51.id,
    amount: 430,
    invoiceMessageId: "19ba9159010b0e28",
    paymentMessageId: "19baeec276eed904",
    methods: [
      "same_contractor",
      "invoice_precedes_payment",
      "invoice_component_of_payment",
      "td_payment_confirmation",
    ],
    paymentNote:
      "Polaris invoice #51 for Justin Arcand is $430.00 and was issued two days before the confirmed $680.00 Polaris payment. Allocate only the documented $430 invoice component; the remaining $250 has no invoice or memo.",
    allocationNote:
      "Allocated the documented $430.00 invoice #51 component. The remaining $250.00 stays unallocated and needs review; it is not labelled as a bonus without evidence.",
  },
  {
    transaction: TRANSACTIONS.amgReimbursement,
    contractor: CONTRACTORS.amg,
    invoiceId: EXISTING_INVOICES.amg107.id,
    amount: 5905,
    invoiceMessageId: "19e0f3d28397ef8e",
    paymentMessageId: "19e4afdae0281a73",
    methods: [
      "exact_invoice_total",
      "reimbursement_memo",
      "td_payment_confirmation",
      "invoice_email",
    ],
    paymentNote:
      "TD confirmation email 19e4afdae0281a73 states this $5,905 transfer reimburses 10509213 Canada Inc. for accidentally paying an AMG Service Construction invoice for the painting company.",
    allocationNote:
      "Exact reimbursement of AMG Service Construction invoice #107. The bank counterparty remains the reimbursement recipient 10509213 Canada Inc.; the email memo proves the underlying Ottawa Painters payable.",
  },
];

for (const item of allocations) {
  await upsertPaymentRecord(db, {
    transactionId: item.transaction.id,
    contractor: item.contractor,
    method: "payment_confirmation",
    note: item.paymentNote,
  });
  await ensureAllocation(db, {
    transactionId: item.transaction.id,
    invoiceId: item.invoiceId,
    amount: item.amount,
    methods: item.methods,
    invoiceMessageId: item.invoiceMessageId,
    paymentMessageId: item.paymentMessageId,
    notes: item.allocationNote,
  });
  const current = transactionById.get(item.transaction.id);
  const sourceData = sourceObject(current.source_data);
  const isPolarisPartial =
    item.transaction.id === TRANSACTIONS.polarisJustin.id;
  const isAmg =
    item.transaction.id === TRANSACTIONS.amgReimbursement.id;
  const desired = {
    category: "Subcontractors",
    transaction_type: "expense",
    is_transfer: false,
    review_status: isPolarisPartial ? "needs_review" : "reconciled",
    notes: item.paymentNote,
    source_data: {
      ...sourceData,
      reconciliation_research: isPolarisPartial
        ? {
            status: "partially_matched",
            reviewed_on: REVIEWED_ON,
            invoice_component: 430,
            unexplained_remainder: 250,
            finding:
              "Invoice #51 is a documented $430 component of the $680 payment. No invoice, memo, or email supports the remaining $250.",
          }
        : sourceData.reconciliation_research,
      ...(isAmg
        ? {
            reimbursement_evidence: {
              status: "confirmed",
              gmail_message_id: "19e4afdae0281a73",
              amount: 5905,
              recipient: "10509213 Canada Inc.",
              underlying_supplier: CONTRACTORS.amg.name,
              underlying_invoice_number: "107",
              memo:
                "Paying 10509213 CANADA INC for accidentally paying an invoice for AMG Service Construction for the painting company.",
              reviewed_on: REVIEWED_ON,
            },
          }
        : {}),
    },
  };
  const update = await db
    .from("financial_transactions")
    .update(desired)
    .eq("id", item.transaction.id);
  if (update.error) throw update.error;
  await insertAuditEvent(db, {
    entity_type: "invoice_payment",
    entity_id: `${item.transaction.id}:${item.invoiceId}`,
    action: "insert",
    old_values: { allocated_amount: 0 },
    new_values: {
      invoice_id: item.invoiceId,
      allocated_amount: item.amount,
      match_method: item.methods,
    },
    reason: item.allocationNote,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const grutencoReconciled = await db
  .from("financial_transactions")
  .update({ review_status: "reconciled" })
  .eq("id", grutencoTransactionId);
if (grutencoReconciled.error) throw grutencoReconciled.error;

const philPaymentRecord = await db
  .from("labour_payment_records")
  .select("*")
  .eq("financial_transaction_id", TRANSACTIONS.phillipSent.id)
  .maybeSingle();
if (philPaymentRecord.error) throw philPaymentRecord.error;
if (philPaymentRecord.data) {
  const removal = await db
    .from("labour_payment_records")
    .delete()
    .eq("financial_transaction_id", TRANSACTIONS.phillipSent.id);
  if (removal.error) throw removal.error;
  await insertAuditEvent(db, {
    entity_type: "payment",
    entity_id: TRANSACTIONS.phillipSent.id,
    action: "delete",
    old_values: philPaymentRecord.data,
    new_values: {
      reason:
        "Removed the derived labour-payment record because direct TD evidence proves the outgoing payment was returned in full and is a zero-net transfer pair.",
    },
    reason:
      "The labour-payment record would incorrectly treat W7c as an operating payment after the exact hB8 return was proven. The immutable bank transactions and email evidence remain archived.",
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

for (const [role, expected, counterpart] of [
  [
    "outgoing_payment",
    TRANSACTIONS.phillipSent,
    TRANSACTIONS.phillipReturned,
  ],
  [
    "returned_funds",
    TRANSACTIONS.phillipReturned,
    TRANSACTIONS.phillipSent,
  ],
]) {
  const current = transactionById.get(expected.id);
  const sourceData = sourceObject(current.source_data);
  const desired = {
    category: "Transfers",
    transaction_type: "transfer",
    is_transfer: true,
    review_status: "reconciled",
    notes:
      "Phillip Hyde $291.08 e-transfer was returned in full the next day. The two bank rows net to zero and are excluded from operating income and expenses.",
    source_data: {
      ...sourceData,
      returned_e_transfer: {
        status: "returned",
        amount: 291.08,
        role,
        paired_transaction_id: counterpart.id,
        sent_payment_message_id: "198355158c400438",
        returned_payment_message_id: "19838f41fb63438d",
        supplier_email_message_id: "198339f9d2357d39",
        finding:
          "Supplier said cash was already received; outgoing W7c and incoming hB8 net to zero.",
        reviewed_on: REVIEWED_ON,
      },
    },
  };
  const update = await db
    .from("financial_transactions")
    .update(desired)
    .eq("id", expected.id);
  if (update.error) throw update.error;
  await insertAuditEvent(db, {
    entity_type: "payment",
    entity_id: expected.id,
    action: "update",
    old_values: {
      category: current.category,
      transaction_type: current.transaction_type,
      is_transfer: current.is_transfer,
    },
    new_values: desired,
    reason:
      "Direct TD emails prove the $291.08 Phillip Hyde payment was returned in full; the pair is a zero-net transfer, not an expense and income.",
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const missingEvidenceGroups = [
  {
    contractorName: "Jad Mroueh",
    transactionIds: JAD_MROUEH_TRANSACTION_IDS,
    searches: [
      '"Jad Mroueh" after:2025/06/01 before:2026/01/01',
      '"JAD MROUEH" after:2025/06/01 before:2026/01/01',
      "Mroueh has:attachment",
      "Mroue subject:invoice",
    ],
    finding:
      "No invoice for these payments was found in the invoice database or the connected Ottawa Painters mailbox. The bank payments and recipient identity remain confirmed.",
  },
  {
    contractorName: "M&A Nice Painting Inc.",
    transactionIds: [M_AND_A_TRANSACTION_ID],
    searches: [
      '"M&A Nice Painting Inc."',
      '"M&A NICE PAINTING INC."',
      '"$1,017.00" after:2026/01/25 before:2026/02/15',
      '"1017.00" "invoice"',
    ],
    finding:
      "The TD payment confirmation was found, but no corresponding invoice was found in the invoice database or connected Ottawa Painters mailbox.",
  },
];
for (const group of missingEvidenceGroups) {
  for (const transactionId of group.transactionIds) {
    const current = transactionById.get(transactionId);
    assert(current, `Missing invoice-search transaction ${transactionId}.`);
    const sourceData = sourceObject(current.source_data);
    const desired = {
      review_status: "needs_review",
      notes:
        `Invoice not found. ${group.finding} Keep the payment unallocated until the original invoice is obtained.`,
      source_data: {
        ...sourceData,
        reconciliation_research: {
          status: "invoice_not_found",
          reviewed_on: REVIEWED_ON,
          payment_has_invoice: null,
          sources_searched: [
            "Supabase labour_invoices",
            "info@paintersottawa.com Gmail",
          ],
          gmail_queries: group.searches,
          finding: group.finding,
        },
      },
    };
    if (changed(current, desired)) {
      const update = await db
        .from("financial_transactions")
        .update(desired)
        .eq("id", transactionId);
      if (update.error) throw update.error;
      await insertAuditEvent(db, {
        entity_type: "payment",
        entity_id: transactionId,
        action: "update",
        old_values: {
          review_status: current.review_status,
          notes: current.notes,
        },
        new_values: desired,
        reason:
          `Completed invoice evidence search for ${group.contractorName}; no invoice was found, so the confirmed bank payment remains unallocated.`,
        performed_by: ADMIN_USER_ID,
        performed_at: NOW,
      });
    }
  }
}

const verificationTransactionIds = [
  TRANSACTIONS.painttastic.id,
  TRANSACTIONS.marcelo.id,
  TRANSACTIONS.michael.id,
  TRANSACTIONS.polarisIsabelle.id,
  TRANSACTIONS.polarisJustin.id,
  TRANSACTIONS.amgReimbursement.id,
  grutencoTransactionId,
];
const verificationInvoiceIds = [
  invoiceIdsByKey.painttastic320438,
  invoiceIdsByKey.marcelo2,
  invoiceIdsByKey.michaelEmail,
  invoiceIdsByKey.polarisIsabelle,
  EXISTING_INVOICES.polaris51.id,
  EXISTING_INVOICES.amg107.id,
  EXISTING_INVOICES.grutencoJuly03.id,
  EXISTING_INVOICES.grutencoJuly04.id,
  invoiceIdsByKey.fennec2Revised,
];
const [
  paymentVerification,
  invoiceVerification,
  philVerification,
  missingEvidenceVerification,
  youssefVerification,
] = await Promise.all([
  db
    .from("labour_payment_verification")
    .select(
      "financial_transaction_id,payment_amount,invoice_allocated_amount,total_allocated_amount,unallocated_amount,payment_status",
    )
    .in("financial_transaction_id", verificationTransactionIds),
  db
    .from("labour_invoice_verification")
    .select(
      "invoice_id,invoice_amount,paid_amount,amount_remaining,payment_status,verification_status",
    )
    .in("invoice_id", verificationInvoiceIds),
  db
    .from("financial_transactions")
    .select(
      "id,amount,category,transaction_type,is_transfer,review_status,source_data",
    )
    .in("id", [
      TRANSACTIONS.phillipSent.id,
      TRANSACTIONS.phillipReturned.id,
    ]),
  db
    .from("financial_transactions")
    .select("id,review_status,source_data")
    .in("id", [
      ...JAD_MROUEH_TRANSACTION_IDS,
      M_AND_A_TRANSACTION_ID,
    ]),
  db
    .from("financial_transactions")
    .select("id,source_data")
    .in("id", YOUSSEF_PAYMENT_IDS),
]);
for (const [label, result] of Object.entries({
  paymentVerification,
  invoiceVerification,
  philVerification,
  missingEvidenceVerification,
  youssefVerification,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
assert(
  paymentVerification.data.length === verificationTransactionIds.length,
  "One or more matched payments are missing from verification.",
);
for (const payment of paymentVerification.data) {
  if (payment.financial_transaction_id === TRANSACTIONS.polarisJustin.id) {
    assert(
      payment.payment_status === "partially_allocated" &&
        cents(payment.invoice_allocated_amount) === 43000 &&
        cents(payment.unallocated_amount) === 25000,
      "Polaris $680 payment no longer has the expected $430/$250 split.",
    );
  } else {
    assert(
      payment.payment_status === "fully_allocated" &&
        cents(payment.unallocated_amount) === 0,
      `Payment ${payment.financial_transaction_id} is not fully allocated.`,
    );
  }
}
const paidInvoiceIds = new Set(
  invoiceVerification.data
    .filter((invoice) => invoice.payment_status === "paid")
    .map((invoice) => invoice.invoice_id),
);
for (const invoiceId of verificationInvoiceIds.filter(
  (id) => id !== invoiceIdsByKey.fennec2Revised,
)) {
  assert(paidInvoiceIds.has(invoiceId), `Invoice ${invoiceId} is not paid.`);
}
const fennecVerification = invoiceVerification.data.find(
  (invoice) => invoice.invoice_id === invoiceIdsByKey.fennec2Revised,
);
assert(
  fennecVerification?.payment_status === "unpaid" &&
    cents(fennecVerification.amount_remaining) === 144000,
  "Revised Fennec invoice #2 should remain unpaid at $1,440.",
);
assert(
  philVerification.data.length === 2 &&
    philVerification.data.every(
      (transaction) =>
        transaction.category === "Transfers" &&
        transaction.transaction_type === "transfer" &&
        transaction.is_transfer === true &&
        transaction.review_status === "reconciled" &&
        transaction.source_data?.returned_e_transfer?.status === "returned",
    ) &&
    cents(
      philVerification.data.reduce(
        (total, transaction) => total + Number(transaction.amount),
        0,
      ),
    ) === 0,
  "Phillip Hyde returned-payment verification failed.",
);
assert(
  missingEvidenceVerification.data.length ===
      JAD_MROUEH_TRANSACTION_IDS.length + 1 &&
    missingEvidenceVerification.data.every(
      (transaction) =>
        transaction.review_status === "needs_review" &&
        transaction.source_data?.reconciliation_research?.status ===
          "invoice_not_found",
    ),
  "Invoice-not-found verification failed.",
);
assert(
  youssefVerification.data.length === YOUSSEF_PAYMENT_IDS.length &&
    youssefVerification.data.every(
      (transaction) =>
        transaction.source_data?.reconciliation_research?.status ===
        "no_invoice_provided",
    ),
  "Youssef no-invoice verification failed.",
);

console.log(
  JSON.stringify(
    {
      applied: true,
      project_ref: projectRef,
      payments_fully_matched: paymentVerification.data.filter(
        (payment) => payment.payment_status === "fully_allocated",
      ).length,
      payments_partially_matched: paymentVerification.data.filter(
        (payment) => payment.payment_status === "partially_allocated",
      ).length,
      invoices_paid: paidInvoiceIds.size,
      revised_fennec_invoice_unpaid: 1440,
      invoice_not_found_transactions:
        missingEvidenceVerification.data.length,
      user_confirmed_no_invoice_transactions: youssefVerification.data.length,
      returned_payment_net: 0,
    },
    null,
    2,
  ),
);
