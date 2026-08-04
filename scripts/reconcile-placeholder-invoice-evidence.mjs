#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();

const item = (description, amount, sourceText, options = {}) => ({
  description,
  amount,
  taxAmount: options.taxAmount ?? 0,
  entryType: options.entryType ?? "labour",
  quantity: options.quantity ?? 1,
  unit: options.unit ?? "item",
  unitPrice: options.unitPrice ?? amount,
  quantityHours: options.quantityHours ?? null,
  hourlyRate: options.hourlyRate ?? null,
  isAdjustment: options.isAdjustment ?? false,
  sourceKind: options.sourceKind ?? "extracted",
  needsReview: options.needsReview ?? false,
  sourceText,
});

const DOCUMENTS = [
  {
    id: "0d32c6b9-84b6-48f2-bb33-3c59994bbe47",
    lines: [
      item(
        "Sales commission — Christopher Fernandez, invoice 250012",
        126,
        "Printed item: Sales commission; Christopher Fernandez; 6%; invoice 250012; quantity 1; rate and amount $126.00.",
        { entryType: "commission", taxAmount: 16.38 },
      ),
    ],
  },
  {
    id: "11b5f7f5-d475-43ce-ae7a-27c856b8ca08",
    lines: [
      item(
        "Sales commission — Rick Piche PO #250032 and Salah Osman PO #250033",
        524.7,
        "Printed item: Sales commission; Rick Piche PO #250032 $108.30; Salah Osman PO #250033 $416.40; quantity 1; rate and amount $524.70.",
        { entryType: "commission" },
      ),
    ],
  },
  {
    id: "130ed159-3eb3-40c3-a24d-1bf684341df9",
    lines: [
      item(
        "Weekly payment (as agreed)",
        272,
        "Printed item: Weekly payment (as agreed) — $272.00 USD.",
      ),
    ],
  },
  {
    id: "2c2eefb8-18cd-4004-9b87-c417a69bc160",
    lines: [
      item(
        "Painting sales commission — Carol Anderson, invoice 250008",
        129,
        "Printed item: Painting Sales Commission; Carol Anderson; invoice 250008; quantity 1; rate and amount $129.00.",
        { entryType: "commission" },
      ),
    ],
  },
  {
    id: "2d9a4ee9-f047-40af-9d68-e1e4cc526929",
    lines: [
      item(
        "Painting sales commission — Barb Howie, invoice 250009",
        1384.5,
        "Printed item: Painting Sales Commission; Barb Howie; invoice 250009; quantity 1; rate and amount $1,384.50.",
        { entryType: "commission" },
      ),
    ],
  },
  {
    id: "439e36d1-2053-45ac-b277-c9f69c0b0566",
    lines: [
      item(
        "Sales commission and appointment visits",
        2662.3,
        "One printed item: Sales commission — Christopher Fernandez $126 invoice 250012; Maryanne $241.80 invoice 250017; Vincy Lee $262.50 invoice 250019; Titley $1,902 invoice 250020; appointment visits $130; quantity 1; total $2,662.30.",
        { entryType: "commission" },
      ),
    ],
  },
  {
    id: "45025b23-2fda-4927-a7ac-4eb9ec663f92",
    lines: [
      item(
        "Monthly payment (April)",
        1152,
        "Printed item: Monthly payment (April) — $1,152.00 USD.",
      ),
    ],
  },
  {
    id: "4846f650-70f2-4237-82d4-69bab42441f5",
    lines: [
      item(
        "Project Coordinator — 21 days at $10/hour",
        1680,
        "Printed item: Project Coordinator; 21 days; rate $10/hour; amount $1,680.00 USD. The printed quantity and hourly rate do not independently reproduce the amount unless an unstated eight-hour day is assumed.",
        {
          quantity: 21,
          unit: "day",
          unitPrice: 10,
          needsReview: true,
        },
      ),
    ],
  },
  {
    id: "494f078f-9c0a-48d2-bffc-a5a62498b030",
    lines: [
      item(
        "Salary for May",
        1250,
        "Printed item: Salary of the month of May — $1,250.00 USD.",
      ),
    ],
  },
  {
    id: "4e5c3977-c483-4cd8-b073-e6ad67cbb629",
    lines: [
      item(
        "Painting sales commission — Ben Javanpour, invoice 250006",
        49.5,
        "Printed item: Painting Sales Commission; Ben Javanpour; invoice 250006; quantity 1; rate and amount $49.50.",
        { entryType: "commission" },
      ),
    ],
  },
  {
    id: "52b9d873-cb6a-441a-a835-5c82ba10a9f4",
    lines: [
      item(
        "Job 1 — Christine, 2033 Scully Way",
        540,
        "Printed item: Job 1 — Christine; 2033 Scully Way, K4A 4L8; amount $540.00.",
        { unit: "job" },
      ),
      item(
        "Job 2 — Paul, 1512 Walkley Rd #136",
        315,
        "Printed item: Job 2 — Paul; 1512 Walkley Rd #136, K1M 2L1; amount $315.00.",
        { unit: "job" },
      ),
    ],
  },
  {
    id: "52e2da99-e0fd-4c9a-a0f4-cc7c3eac46b1",
    lines: [
      item(
        "Painting services — May 1 to May 15",
        3250,
        "Printed item dated May 15: Painting Services from May 1 to May 15, including project supervision, coordination, walkthroughs, delivery, administration communication, materials management, estimates, operational support, and budget monitoring; quantity 1; amount $3,250.00.",
        { unit: "service", taxAmount: 422.5 },
      ),
      item(
        "Material reimbursement — George Chama project paint",
        76.08,
        "Printed item dated May 15: Material Reimbursement; paint gallon purchased May 13 for George Chama's project at Benjamin Moore / Preston Paints; quantity 1; amount $76.08.",
        { entryType: "material", unit: "reimbursement", taxAmount: 9.89 },
      ),
    ],
  },
  {
    id: "552c591f-2353-4b96-bd7d-d1873480797b",
    lines: [
      item(
        "8 hours × 5 days × $6/hour",
        240,
        "Printed item: 8 Hours × 5 Days × $6/hour — $240.00 USD.",
        {
          quantity: 40,
          unit: "hour",
          unitPrice: 6,
          quantityHours: 40,
          hourlyRate: 6,
        },
      ),
      item(
        "18 proposals × $2",
        36,
        "Printed item: 18 Proposals × $2 each — $36.00 USD.",
        {
          entryType: "commission",
          quantity: 18,
          unit: "proposal",
          unitPrice: 2,
        },
      ),
    ],
  },
  {
    id: "5530cea1-4eed-445f-93af-6f76a16f6fc1",
    lines: [
      item(
        "Weekly payment (as agreed)",
        272,
        "Printed item: Weekly payment (as agreed) — $272.00 USD.",
      ),
    ],
  },
  {
    id: "73599f88-015a-4ca3-8265-b955771af744",
    supplierName: "Phillip Hyde",
    lines: [
      item(
        "Sales commission — 6% of $2,100",
        126,
        "Spreadsheet item 1: Sale Commision; 6% of total ($2,100); quantity 1; price and amount $126.00.",
        { entryType: "commission" },
      ),
      item(
        "Project management commission — 5% of $2,100",
        105,
        "Spreadsheet item 2: Project Management Commision; 5% of total; quantity 1; price and amount $105.00.",
        { entryType: "commission" },
      ),
      item(
        "Material — 20% of $2,100",
        420,
        "Spreadsheet item 3: Material; 20% of total; quantity 1; price and amount $420.00.",
        { entryType: "material" },
      ),
      item(
        "Shipping",
        10,
        "Spreadsheet invoice summary: subtotal $651.00; shipping $10.00; total $661.00.",
        { entryType: "expense", unit: "shipping" },
      ),
    ],
  },
  {
    id: "86264601-366e-4682-953a-6ca1b79b14e0",
    lines: [
      item(
        "Painting services — May 16 to May 31",
        3250,
        "Printed item dated May 31: Painting Services from May 16 to May 31, including project supervision, coordination, walkthroughs, delivery, administration communication, materials management, estimates, operational support, and budget monitoring; quantity 1; amount $3,250.00.",
        { unit: "service", taxAmount: 422.5 },
      ),
      item(
        "Sales commissions — May 2026",
        1500,
        "Printed item dated May 31: Services; Sales Commissions for May 2026; quantity 1; amount $1,500.00.",
        { entryType: "commission", taxAmount: 195 },
      ),
    ],
  },
  {
    id: "8fec14c5-a308-4203-b2b9-4bd74f91b6c4",
    lines: [
      item(
        "Weekly payment (as agreed)",
        270,
        "Printed item: Weekly payment (as agreed) — $270.00 USD.",
      ),
    ],
  },
  {
    id: "94bf55d6-1323-4b9e-b4e9-7b55eae79830",
    lines: [
      item(
        "Weekly payment (as agreed)",
        268,
        "Printed item: Weekly payment (as agreed) — $268.00 USD.",
      ),
    ],
  },
  {
    id: "970498fe-b32c-47e6-8655-e8931e2d329d",
    lines: [
      item(
        "Base salary for July and August",
        2112,
        "Printed item: Base salary of July/August — $2,112.00 USD.",
      ),
    ],
  },
  {
    id: "9900a510-afb3-47ce-b4c2-6a26bc575436",
    lines: [
      item(
        "Project Coordinator — 24 days at $10/hour",
        1920,
        "Printed item: Project Coordinator; 24 days; rate $10/hour; amount $1,920.00 USD. The printed quantity and hourly rate do not independently reproduce the amount unless an unstated eight-hour day is assumed.",
        {
          quantity: 24,
          unit: "day",
          unitPrice: 10,
          needsReview: true,
        },
      ),
    ],
  },
  {
    id: "a1aa0428-7e53-41b0-86a7-e5eb5529bf6d",
    lines: [
      item(
        "Reinstall light fixture — minimum charge",
        150,
        "Printed item: Reinstall light fixture; minimum charge applies; amount $150.00.",
        { unit: "service", taxAmount: 19.5 },
      ),
    ],
  },
  {
    id: "b5e82787-cd6c-4918-b6df-5aad0b430481",
    lines: [
      item(
        "Sales commission and November proposals",
        917.34,
        "One printed item: Sales commission; total commission $647.34; 27 November proposals × $10 = $270.00; total $917.34.",
        { entryType: "commission" },
      ),
    ],
  },
  {
    id: "bf9e0ca2-c3ae-4f47-9296-849ee9b3024c",
    lines: [
      item(
        "Sales commission — Maryanne, invoice 250017",
        241.8,
        "Printed item: Sale commission; Maryanne; 6%; invoice 250017; quantity 1; rate and amount $241.80.",
        { entryType: "commission" },
      ),
    ],
  },
  {
    id: "c4ee3621-56f5-4f52-a88b-a088ed9e2e2f",
    lines: [
      item(
        "Bradley — PO #250001",
        1087,
        "Spreadsheet item 1: Bradley; PO #250001; quantity 1; price and amount $1,087.00.",
        { entryType: "commission" },
      ),
      item(
        "Roxanne — PO #250002",
        1349,
        "Spreadsheet item 2: Roxanne; PO #250002; quantity 1; price and amount $1,349.00.",
        { entryType: "commission" },
      ),
      item(
        "Roxanne — PO #250002 additional amount",
        138,
        "Spreadsheet item 3: Roxanne; PO #250002; quantity 1; price and amount $138.00.",
        { entryType: "commission" },
      ),
    ],
  },
  {
    id: "c5ea6d68-6c64-45ba-89e5-a6cfa7b9257c",
    lines: [
      item(
        "Paint sales commission — Danish Meman, invoice 250005",
        51,
        "Printed item: Paint Sales Commission; Danish Meman; invoice 250005; quantity 1; rate and amount $51.00.",
        { entryType: "commission" },
      ),
    ],
  },
  {
    id: "ccd433e4-caa9-4e4f-aefe-0c1a331e2a3f",
    lines: [
      item(
        "Sales commission — Bradley McDermid, invoice 276606",
        149.16,
        "Spreadsheet item 1: Sale Commission; invoice #276606; Bradley McDermid; 6% of $2,486; quantity 1; price and amount $149.16.",
        { entryType: "commission" },
      ),
      item(
        "Sales commission — Roxanne Dore, invoice 280975",
        141.92,
        "Spreadsheet item 2: Sale Commission; invoice #280975; Roxanne Dore; 6% of $2,147 + $218.40; quantity 1; price and amount $141.92.",
        { entryType: "commission" },
      ),
    ],
  },
  {
    id: "d1d4e6c3-5a34-45dc-a6e5-6212954ce834",
    lines: [
      item(
        "Monthly bonus (as agreed)",
        140,
        "Printed item: Monthly bonus (as agreed) — $140.00 USD.",
        { entryType: "bonus" },
      ),
    ],
  },
  {
    id: "d6b60fff-bc60-41e7-a61d-6d5bac366304",
    lines: [
      item(
        "Friday — Reza worked with Scott",
        180,
        "Printed item: Friday — Reza work with Scott; quantity 1; unit price and total $180.00.",
        { unit: "job" },
      ),
    ],
  },
  {
    id: "dbb826cd-2ce8-49ad-83ec-e8ddcb9aa6f9",
    lines: [
      item(
        "Advance payment for services",
        3600,
        "Printed item dated April 27: Services; Advance Payment for Services; quantity 1; amount $3,600.00.",
        { unit: "advance" },
      ),
    ],
  },
  {
    id: "ded41e90-b9a4-4215-9930-5f9e97f4da96",
    lines: [
      item(
        "Painting sales commission — Karen Lamb, invoice 250007",
        1065,
        "Printed item: Painting Sales commission; Karen Lamb; invoice 250007; quantity 1; rate and amount $1,065.00.",
        { entryType: "commission" },
      ),
    ],
  },
  {
    id: "eb21c723-6ca6-4136-adfa-4a9324ae58be",
    lines: [
      item(
        "Elizabeth McCrae — 201 Cairnsmore Circle",
        2150,
        "Printed item: Elizabeth McCrae — 201 Cairnsmore Circle; quantity 1; unit price and total $2,150.00.",
        { unit: "job" },
      ),
    ],
  },
  {
    id: "ebe71903-b56f-4664-8eef-c5680482730f",
    lines: [
      item(
        "Cabinet and interior painting — Scott MacEwen",
        5900,
        "Printed item: Cabinet Painting and Interior Painting for Scott MacEwen; quantity 1; unit price and total $5,900.00.",
        { unit: "job" },
      ),
    ],
  },
  {
    id: "efa816d9-a078-4281-87fb-d56f4a928b64",
    lines: [
      item(
        "Salary for June",
        1400,
        "Printed item: Salary of the month of June — $1,400.00 USD.",
      ),
    ],
  },
  {
    id: "f165520e-e3ef-4a82-824a-0c9c40833508",
    lines: [
      item(
        "Painting sales commission — Laurissa Hevenor, invoice 250003",
        639,
        "Printed item: Painting Sales Commission; Laurissa Hevenor; invoice 250003; quantity 1; rate and amount $639.00.",
        { entryType: "commission" },
      ),
    ],
  },
  {
    id: "083fe4ae-5409-4ab1-b560-6aef0a2f5991",
    lines: [
      item(
        "Painting services — Laura Van Cleef, 13 Shannondoe Crescent",
        6000,
        "Printed item dated March 16: Painting Services for job #2413005, Laura Van Cleef, 13 Shannondoe Crescent; comprehensive interior preparation, repairs, painting, protection, and cleanup; quantity 1; amount $6,000.00.",
        { unit: "job", taxAmount: 780 },
      ),
      item(
        "Plaster — taping and repairs including materials",
        140,
        "Printed item dated March 16: Plaster; taping and plaster repair work on walls and ceilings, including materials; quantity 1; amount $140.00.",
        { unit: "service", taxAmount: 18.2 },
      ),
      item(
        "Material reimbursement — Sherwin-Williams invoice 88024182730326",
        135.85,
        "Printed item dated March 20: Material Reimbursement; Sherwin Williams invoice 88024182730326; paint; quantity 1; amount $135.85.",
        { entryType: "material", unit: "reimbursement", taxAmount: 17.66 },
      ),
      item(
        "Material reimbursement — Sherwin-Williams invoice 31467198110326",
        124.32,
        "Printed item dated March 20: Material Reimbursement; Sherwin Williams invoice 31467198110326; paint and consumables; quantity 1; amount $124.32.",
        { entryType: "material", unit: "reimbursement", taxAmount: 16.16 },
      ),
    ],
  },
  {
    id: "e8cb4cc5-2610-4385-aa3d-1d64cc4c552d",
    lines: [
      item(
        "Painting services — May 16 to May 31",
        3250,
        "Printed item dated May 16: Painting Services from May 16 to May 31, including project supervision, coordination, walkthroughs, delivery, administration communication, materials management, estimates, operational support, and budget monitoring; quantity 1; amount $3,250.00.",
        { unit: "service", taxAmount: 422.5 },
      ),
      item(
        "Material reimbursement — Dever Jylha project primer",
        84,
        "Printed item dated May 18: Material Reimbursement; primer purchased for the Dever Jylha project at Home Depot; quantity 1; amount $84.00.",
        { entryType: "material", unit: "reimbursement", taxAmount: 10.92 },
      ),
      item(
        "Material reimbursement — Sherwin-Williams supplies",
        78.41,
        "Printed item dated May 27: Material Reimbursement; Sherwin-Williams supplies for multiple projects; quantity 1; amount $78.41.",
        { entryType: "material", unit: "reimbursement", taxAmount: 10.19 },
      ),
      item(
        "Sales commissions — May 2026",
        1660,
        "Printed item dated May 31: Services; Sales Commissions for May 2026; $83,000 CAD at 2%; quantity 1; amount $1,660.00.",
        { entryType: "commission", taxAmount: 215.8 },
      ),
      item(
        "Advance payment for services reimbursement",
        -3600,
        "Printed negative item dated May 31: Services; Advance Payment for services Reimbursement; quantity 1; amount -$3,600.00. The invoice's tax summary taxes the $5,072.41 positive items and assigns no tax to this reimbursement.",
        {
          entryType: "other",
          unit: "adjustment",
          unitPrice: 3600,
          isAdjustment: true,
        },
      ),
    ],
  },
  {
    id: "d1266895-85f3-4ce7-a4fe-a0646f8347ba",
    lines: [
      item(
        "Ian Rothwell — exterior painting, 280 River Rd",
        500,
        "Printed item 1: project 2967529, Ian Rothwell, 280 River Rd; exterior painting of soffits, fascia, eavestroughs, downspouts, and four exterior window frames; unit JOB; quantity 1; amount $500.00.",
        { unit: "job", taxAmount: 65 },
      ),
      item(
        "Saroeun Cole — exterior fence staining, 1556 Drake Ave",
        320,
        "Printed item 2: project 2792078, Saroeun Cole, 1556 Drake Ave; exterior fence staining, one side, prep work; unit JOB; quantity 1; amount $320.00.",
        { unit: "job", taxAmount: 41.6 },
      ),
      item(
        "Saroeun Cole — SuperDeck solid stain, 1 gallon",
        61.53,
        "Printed item 3: project 2792078, Saroeun Cole, 1556 Drake Ave; Sherwin-Williams SuperDeck solid stain, 1 gallon; quantity 1; amount $61.53.",
        {
          entryType: "material",
          unit: "gallon",
          quantity: 1,
          unitPrice: 61.53,
          taxAmount: 8,
        },
      ),
    ],
  },
];

const FENNEC = {
  id: "78da62ba-8904-49aa-92a9-46f695be4d8c",
  expectedDetailedTotal: 3705,
  correction: item(
    "Printed-total correction — detailed hours exceed invoice total",
    -15,
    "Manual control line: the 15 printed shifts total 123.5 hours × $30 = $3,705.00, but page 2 states 123 hours × $30 and the invoice total is $3,690.00. The $15.00 source-document discrepancy is preserved visibly instead of changing a shift.",
    {
      entryType: "other",
      unit: "difference",
      unitPrice: 15,
      isAdjustment: true,
      sourceKind: "manual",
      needsReview: true,
    },
  ),
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cents(value) {
  return Math.round(Number(value ?? 0) * 100);
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
  const insertion = await db.from("labour_verification_events").insert(event);
  if (insertion.error) throw insertion.error;
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
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

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const documentIds = DOCUMENTS.map((document) => document.id);
assert(
  new Set(documentIds).size === documentIds.length,
  "Duplicate invoice ids in the correction plan.",
);

const [invoiceResult, lineResult] = await Promise.all([
  db
    .from("labour_invoices")
    .select(
      "id,supplier_name,invoice_number,amount_before_tax,tax_amount,amount_paid,original_filename",
    )
    .in("id", [...documentIds, FENNEC.id]),
  db
    .from("labour_invoice_lines")
    .select(
      "id,invoice_id,line_number,entry_type,description,quantity,unit,unit_price,quantity_hours,hourly_rate,amount_before_tax,tax_amount,is_adjustment,source_kind,source_text,needs_review",
    )
    .in("invoice_id", [...documentIds, FENNEC.id]),
]);
for (const [label, result] of Object.entries({
  invoices: invoiceResult,
  lines: lineResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
const placeholderLineIds = lineResult.data
  .filter((line) => documentIds.includes(line.invoice_id))
  .map((line) => line.id);
const allocationResult = placeholderLineIds.length
  ? await db
      .from("labour_invoice_line_allocations")
      .select("invoice_line_id,allocated_amount")
      .in("invoice_line_id", placeholderLineIds)
  : { data: [], error: null };
if (allocationResult.error) {
  throw new Error(`allocations: ${allocationResult.error.message}`);
}

assert(
  invoiceResult.data.length === DOCUMENTS.length + 1,
  "One or more target invoice documents are missing.",
);
assert(
  allocationResult.data.length === 0,
  "A placeholder invoice gained a job allocation; review it before rebuilding lines.",
);

const invoiceById = new Map(
  invoiceResult.data.map((invoice) => [invoice.id, invoice]),
);
const linesByInvoice = Map.groupBy(lineResult.data, (line) => line.invoice_id);
for (const document of DOCUMENTS) {
  const invoice = invoiceById.get(document.id);
  assert(invoice, `Missing invoice ${document.id}.`);
  assert(
    cents(document.lines.reduce((total, line) => total + line.amount, 0)) ===
      cents(invoice.amount_before_tax),
    `Planned line amounts do not equal ${invoice.supplier_name} #${invoice.invoice_number}.`,
  );
  assert(
    cents(document.lines.reduce((total, line) => total + line.taxAmount, 0)) ===
      cents(invoice.tax_amount),
    `Planned line tax does not equal ${invoice.supplier_name} #${invoice.invoice_number}.`,
  );
  const currentLines = linesByInvoice.get(document.id) ?? [];
  assert(
    currentLines.every((line) =>
      ["legacy_invoice_total", "extracted", "manual"].includes(line.source_kind),
    ),
    `Unexpected evidence source on ${invoice.supplier_name} #${invoice.invoice_number}.`,
  );
}

const fennecInvoice = invoiceById.get(FENNEC.id);
const fennecLines = linesByInvoice.get(FENNEC.id) ?? [];
const fennecDetailedLines = fennecLines.filter((line) => line.line_number <= 15);
assert(
  fennecInvoice &&
    fennecInvoice.supplier_name === "Fennec Contracting" &&
    fennecInvoice.invoice_number === "1" &&
    cents(fennecInvoice.amount_before_tax) === 369000,
  "Fennec invoice #1 changed since the physical source was audited.",
);
assert(
  fennecDetailedLines.length === 15 &&
    cents(
      fennecDetailedLines.reduce(
        (total, line) => total + Number(line.amount_before_tax),
        0,
      ),
    ) === cents(FENNEC.expectedDetailedTotal),
  "Fennec detailed shift lines no longer equal the audited $3,705.00.",
);

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      exact_documents: DOCUMENTS.length,
      placeholder_documents: DOCUMENTS.filter(
        (document) =>
          (linesByInvoice.get(document.id) ?? [])[0]?.source_kind ===
          "legacy_invoice_total",
      ).length,
      empty_documents: DOCUMENTS.filter(
        (document) => (linesByInvoice.get(document.id) ?? []).length === 0,
      ).length,
      exact_items: DOCUMENTS.reduce(
        (total, document) => total + document.lines.length,
        0,
      ),
      fennec_control_line: FENNEC.correction,
    },
    null,
    2,
  ),
);
if (!APPLY) {
  console.log("Dry run only. Re-run with --apply to write the evidence.");
  process.exit(0);
}

for (const document of DOCUMENTS) {
  const invoice = invoiceById.get(document.id);
  const currentLines = linesByInvoice.get(document.id) ?? [];
  const oldSnapshot = currentLines.map((line) => ({
    line_number: line.line_number,
    description: line.description,
    amount_before_tax: Number(line.amount_before_tax),
    tax_amount: Number(line.tax_amount),
    source_kind: line.source_kind,
  }));

  for (const [index, desired] of document.lines.entries()) {
    const lineNumber = index + 1;
    const upsert = await db
      .from("labour_invoice_lines")
      .upsert(
        {
          invoice_id: document.id,
          line_number: lineNumber,
          entry_type: desired.entryType,
          description: desired.description,
          service_started_on: null,
          service_ended_on: null,
          quantity: desired.quantity,
          unit: desired.unit,
          unit_price: desired.unitPrice,
          quantity_hours: desired.quantityHours,
          hourly_rate: desired.hourlyRate,
          amount_before_tax: desired.amount,
          tax_amount: desired.taxAmount,
          is_adjustment: desired.isAdjustment,
          source_kind: desired.sourceKind,
          source_reference: `physical-invoice:${document.id}:line:${lineNumber}`,
          source_text:
            `${desired.sourceText} Verified against ${invoice.original_filename}.`,
          needs_review: desired.needsReview,
          inserted_by: ADMIN_USER_ID,
        },
        { onConflict: "invoice_id,line_number" },
      );
    if (upsert.error) throw upsert.error;
  }

  const obsoleteLineIds = currentLines
    .filter((line) => line.line_number > document.lines.length)
    .map((line) => line.id);
  if (obsoleteLineIds.length) {
    const deletion = await db
      .from("labour_invoice_lines")
      .delete()
      .in("id", obsoleteLineIds)
      .eq("invoice_id", document.id);
    if (deletion.error) throw deletion.error;
  }

  if (document.supplierName) {
    const supplierUpdate = await db
      .from("labour_invoices")
      .update({ supplier_name: document.supplierName })
      .eq("id", document.id);
    if (supplierUpdate.error) throw supplierUpdate.error;
  }

  await insertAuditEvent(db, {
    entity_type: "invoice",
    entity_id: document.id,
    action: "update",
    old_values: {
      supplier_name: invoice.supplier_name,
      entries: oldSnapshot,
    },
    new_values: {
      supplier_name: document.supplierName ?? invoice.supplier_name,
      evidence: "physical_invoice_items",
      entries: document.lines.map((line, index) => ({
        line_number: index + 1,
        description: line.description,
        amount_before_tax: line.amount,
        tax_amount: line.taxAmount,
        source_kind: line.sourceKind,
        needs_review: line.needsReview,
      })),
    },
    reason:
      `Replaced the whole-invoice placeholder with every printed item from ${invoice.original_filename}; ` +
      "the item subtotal and item tax now reconcile to the archived source.",
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const fennecCorrectionLine = await db
  .from("labour_invoice_lines")
  .upsert(
    {
      invoice_id: FENNEC.id,
      line_number: 16,
      entry_type: FENNEC.correction.entryType,
      description: FENNEC.correction.description,
      service_started_on: null,
      service_ended_on: null,
      quantity: 1,
      unit: FENNEC.correction.unit,
      unit_price: FENNEC.correction.unitPrice,
      quantity_hours: null,
      hourly_rate: null,
      amount_before_tax: FENNEC.correction.amount,
      tax_amount: 0,
      is_adjustment: FENNEC.correction.isAdjustment,
      source_kind: FENNEC.correction.sourceKind,
      source_reference: `manual-control:${FENNEC.id}:line:16`,
      source_text:
        `${FENNEC.correction.sourceText} Verified against ${fennecInvoice.original_filename}.`,
      needs_review: true,
      inserted_by: ADMIN_USER_ID,
    },
    { onConflict: "invoice_id,line_number" },
  );
if (fennecCorrectionLine.error) throw fennecCorrectionLine.error;

const fennecDateReview = await db
  .from("labour_invoice_lines")
  .update({
    needs_review: true,
    source_text:
      "Printed item says Tuesday, June 20 (7h), which is inconsistent with the surrounding Monday, June 29 sequence; stored service date June 30 is an explicit interpretation and remains reviewable.",
  })
  .eq("invoice_id", FENNEC.id)
  .eq("line_number", 5);
if (fennecDateReview.error) throw fennecDateReview.error;

await insertAuditEvent(db, {
  entity_type: "invoice",
  entity_id: FENNEC.id,
  action: "update",
  old_values: {
    detailed_hours: 123.5,
    detailed_amount: 3705,
    printed_hours: 123,
    printed_total: 3690,
  },
  new_values: {
    detailed_hours: 123.5,
    detailed_amount: 3705,
    printed_hours: 123,
    printed_total: 3690,
    manual_control_amount: -15,
    needs_review: true,
  },
  reason:
    "Preserved Fennec invoice #1's $15 source-document arithmetic discrepancy with a visible manual control line and marked the ambiguous June 20/30 date for review.",
  performed_by: ADMIN_USER_ID,
  performed_at: NOW,
});

const [remainingPlaceholderResult, correctedInvoiceResult, correctedLineResult] =
  await Promise.all([
    db
      .from("labour_invoice_lines")
      .select("id", { count: "exact", head: true })
      .eq("source_kind", "legacy_invoice_total"),
    db
      .from("labour_invoices")
      .select("id,supplier_name,invoice_number,amount_before_tax,tax_amount")
      .in("id", [...documentIds, FENNEC.id]),
    db
      .from("labour_invoice_lines")
      .select(
        "id,invoice_id,line_number,amount_before_tax,tax_amount,source_kind,needs_review",
      )
      .in("invoice_id", [...documentIds, FENNEC.id]),
  ]);
for (const [label, result] of Object.entries({
  remainingPlaceholders: remainingPlaceholderResult,
  correctedInvoices: correctedInvoiceResult,
  correctedLines: correctedLineResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

assert(
  remainingPlaceholderResult.count === 0,
  `${remainingPlaceholderResult.count} whole-invoice placeholders remain.`,
);
const finalLinesByInvoice = Map.groupBy(
  correctedLineResult.data,
  (line) => line.invoice_id,
);
for (const invoice of correctedInvoiceResult.data) {
  const finalLines = finalLinesByInvoice.get(invoice.id) ?? [];
  assert(finalLines.length > 0, `Invoice ${invoice.id} still has no entries.`);
  assert(
    cents(
      finalLines.reduce(
        (total, line) => total + Number(line.amount_before_tax),
        0,
      ),
    ) === cents(invoice.amount_before_tax),
    `Final entries do not equal ${invoice.supplier_name} #${invoice.invoice_number}.`,
  );
  assert(
    cents(
      finalLines.reduce((total, line) => total + Number(line.tax_amount), 0),
    ) === cents(invoice.tax_amount),
    `Final entry tax does not equal ${invoice.supplier_name} #${invoice.invoice_number}.`,
  );
}

console.log(
  JSON.stringify(
    {
      applied: true,
      corrected_documents: DOCUMENTS.length + 1,
      exact_items:
        correctedLineResult.data.length -
        fennecDetailedLines.length,
      remaining_whole_invoice_placeholders: remainingPlaceholderResult.count,
      invoice_totals_reconciled: true,
    },
    null,
    2,
  ),
);
