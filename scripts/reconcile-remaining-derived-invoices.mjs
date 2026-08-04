#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();

const SIMPLE_EXACT = [
  "006cc656-b31b-4aa4-9bc3-03b6db566fde",
  "020c8a4f-fd4c-43b6-a093-d49f87c465f5",
  "0f2fff9f-b026-44b0-aca2-e471a5de8981",
  "37e76d25-9462-4c17-9195-6f004283a3ec",
  "3f1763a8-5a42-40bc-8b99-e8dba792f8c4",
  "40ad6ba7-fd53-4d2a-8169-82d8610c2441",
  "4929d6a1-70bc-417b-b0c3-3e80a5d0565b",
  "56789374-5897-4e51-aa3b-52ec737bc016",
  "6e0b7b31-5a73-4ab1-a4fb-a30936d65704",
  "7584089c-caa2-4233-aa4d-d37352c12f8f",
  "8e25d48d-bc96-4c82-a90a-b3e7f9bce30c",
  "a1dd5593-2a01-4395-841a-3b48bec2d426",
  "aea0a22a-9c41-4714-bbea-021315fcafb3",
  "b0d48498-0bff-4269-8aee-df4ab4a8b0d8",
  "c11e8ae4-1586-4f90-8a40-87343640a9bd",
  "d273c857-9fc7-450d-a5e3-d4dfff59d3b1",
  "df8d230d-3f7a-4eaa-8ab3-f57fa2ef326e",
  "e7acae64-3dfd-4b3a-8571-a7e805ae933d",
];
const SIMPLE_ALLOCATION_REVIEW = new Set([
  // The source says 153 Oakdean Crescent while the linked project says 1953.
  "b0d48498-0bff-4269-8aee-df4ab4a8b0d8",
]);

const allocation = (projectId, amount, needsReview = false) => ({
  projectId,
  amount,
  needsReview,
});
const line = (
  description,
  amount,
  sourceText,
  allocations = [],
  options = {},
) => ({
  entryType: options.entryType ?? "labour",
  description,
  amount,
  taxAmount: options.taxAmount ?? 0,
  quantity: options.quantity ?? 1,
  unit: options.unit ?? "job",
  unitPrice: options.unitPrice ?? amount,
  quantityHours: options.quantityHours ?? null,
  hourlyRate: options.hourlyRate ?? null,
  sourceKind: options.sourceKind ?? "extracted",
  sourceText,
  needsReview: options.needsReview ?? false,
  allocations,
});

const COMPLEX = [
  {
    id: "03b1ecdf-538f-4d6c-9802-31c7c280e1e4",
    reason:
      "Split Mas Reno invoice #012224 into the three printed items; parking is retained separately and is not silently assigned to the painting job.",
    lines: [
      line(
        "Painting and related services (Job 2)",
        600,
        "Printed item: Painting and related services (Job 2) — $600.00.",
        [allocation("96929139", 600)],
      ),
      line(
        "Additional work / added items",
        150,
        "Printed item: Additional work / added items — $150.00.",
        [allocation("96929139", 150)],
      ),
      line(
        "Parking fee",
        50,
        "Printed item: Parking Fee — $50.00. The printed total is $897.50, including $97.50 HST on the $750.00 taxable work.",
        [],
        { entryType: "expense", unit: "fee" },
      ),
    ],
  },
  ...[
    "0dd5d2ac-2b6a-41d5-a32b-78074285356d",
    "76ac6ef6-ab10-403b-9be6-58ff92ad1c5e",
    "85a25280-4464-49fe-9e82-0b41848212f9",
  ].map((id) => ({
    id,
    reason:
      "Added the printed 613PAINTING site-visits item that was absent from the stored entries. The invoice names Tess, Liz, Sue, and Andrea but does not allocate the $88.48 among jobs, so that item remains visibly reviewable.",
    lines: [
      line(
        "Tessa F — PO #250015",
        159.29,
        "Printed item: Tessa F, PO #250015 — $159.29.",
        [allocation("dripjobs-2045413", 159.29)],
      ),
      line(
        "Liz F — PO #250016",
        981.41,
        "Printed item: Liz F, PO #250016 — $981.41.",
        [allocation("dripjobs-2059567", 981.41)],
      ),
      line(
        "Site visits — Tess, Liz, Sue, Andrea",
        88.48,
        "Printed item: Site Visits, Tess, Liz, Sue, Andrea; quantity 4 at $22.12 — $88.48. The physical invoice does not state the per-job split.",
        [],
        {
          quantity: 4,
          unit: "visit",
          unitPrice: 22.12,
          needsReview: true,
        },
      ),
    ],
  })),
  {
    id: "28e83673-497a-4f2b-8d6d-e453035a311d",
    reason:
      "Restored all five printed Abdellah Aouf invoice items, including the previously missing $300 paint line.",
    lines: [
      line(
        "Job 1: Mariah Landers — 45 Damselfish Walk",
        600,
        "Printed item: Job 1, Mariah Landers, 45 Damselfish Walk — $600.00.",
        [allocation("dripjobs-2362146", 600)],
      ),
      line(
        "Job 2: Bethon Elliott — 99 Forestglade Crescent",
        900,
        "Printed item: Job 2, Bethon Elliott, 99 Forestglade Crescent — $900.00.",
        [allocation("96936844", 900)],
      ),
      line(
        "Job 3: Alycia Vachon — 404 Jewelwing Private",
        400,
        "Printed item: Job 3, Alycia Vachon, 404 Jewelwing Private — $400.00.",
        [allocation("dripjobs-2330911", 400)],
      ),
      line(
        "Job 4: Tracey Adams — 14 Jalna Ct.",
        700,
        "Printed item: Job 4, Tracey Adams, 14 Jalna Ct. — $700.00.",
        [allocation("97196041", 700)],
      ),
      line(
        "Paint",
        300,
        "Printed item: Paint — $300.00. The physical invoice does not allocate the material among the four jobs.",
        [],
        { entryType: "material", unit: "material" },
      ),
    ],
  },
  {
    id: "2a342af9-9189-448b-8346-91940e0d91b5",
    reason:
      "Preserved the three printed Scott Bertin items and exposed the invoice's own $5 arithmetic discrepancy instead of forcing a false match.",
    lines: [
      line(
        "Wonda Peters — 1526 Thurlow",
        195,
        "Printed item: job 1, 1526 Thurlow, Wonda Peters — $195.00.",
        [allocation("100424315", 195)],
      ),
      line(
        "Amy Felton — 171 Lees Ave.",
        270,
        "Printed item: job 2, 171 Lees Ave., Amy Felton — $270.00.",
        [allocation("100775529", 270)],
      ),
      line(
        "Noah Rossman — 193 Carleton Ave.",
        615,
        "Printed item: job 3, 193 Carleton Ave., Noah Rossman — $615.00.",
        [allocation("96695216", 615)],
      ),
      line(
        "Unexplained printed-total difference",
        5,
        "Manual control line: the three physical items total $1,080.00, while the same invoice prints a $1,085.00 total. The unexplained $5.00 is preserved as a review item.",
        [],
        {
          entryType: "other",
          unit: "difference",
          sourceKind: "manual",
          needsReview: true,
        },
      ),
    ],
  },
  {
    id: "2c90c639-506f-43f1-8c09-207eeae88243",
    reason:
      "Expanded the superseded Goulet invoice into its six exact printed lines rather than collapsing extras into the customer rows.",
    lines: [
      line(
        "1802104 — Drywall repair",
        1700,
        "Printed item 1: 1802104 — Drywall repair — $1,700.00.",
        [allocation("dripjobs-1802104", 1700)],
      ),
      line(
        "1843130 — Orleans interior and exterior",
        1170,
        "Printed item 2: 1843130 — Orleans interior and exterior — $1,170.00.",
        [allocation("dripjobs-1843130", 1170)],
      ),
      line(
        "1863401 — Interior (Almonte)",
        2580,
        "Printed item 3: 1863401 — Interior (Almonte) — $2,580.00.",
        [allocation("dripjobs-1863401", 2580)],
      ),
      line(
        "Extra — third coat",
        733,
        "Printed item 4: Extra — 3rd coat — $733.00.",
        [allocation("dripjobs-1863401", 733)],
      ),
      line(
        "1908370 — Daycare",
        2625,
        "Printed item 5: 1908370 — Daycare — $2,625.00.",
        [allocation("dripjobs-1908370", 2625)],
      ),
      line(
        "Extra — time and materials",
        1400,
        "Printed item 6: Extra — time and materials; 5 gallons at $50 and 23h at $50 — $1,400.00. Its placement suggests the Daycare job, but the invoice does not explicitly name the job for this extra.",
        [allocation("dripjobs-1908370", 1400, true)],
        { needsReview: true },
      ),
    ],
  },
  {
    id: "34d2b7bc-5e76-4b6a-9f33-19c30ab06b5e",
    reason:
      "Replaced three invented XDesign item amounts with the one physical $300 Paint & Plaster line. Existing job splits are retained only as reviewable allocations.",
    lines: [
      line(
        "Paint & Plaster touch-ups — Christine Leclair, Gregg Alexander, Phil Anido",
        300,
        "Printed item: Paint & Plaster, 10 at $30.00 — $300.00. The invoice lists Christine Leclair, Gregg Alexander, and Phil Anido but does not print a per-person split.",
        [
          allocation("98894646", 160.67, true),
          allocation("106305548", 86.95, true),
          allocation("96770884", 52.38, true),
        ],
        { quantity: 10, unit: "hour", unitPrice: 30 },
      ),
    ],
  },
  {
    id: "3e8d9196-4007-4ad7-9899-e8f02fe13726",
    reason:
      "Split Mas Reno invoice #012225 into its two printed work items and retained a visible review flag because the printed $182.50 HST is $7.00 higher than 13% of the $1,350.00 subtotal.",
    lines: [
      line(
        "Painting and related services (Job 3)",
        1100,
        "Printed item: Painting and related services (Job 3) — $1,100.00.",
        [allocation("96869012", 1100)],
      ),
      line(
        "Third coat",
        250,
        "Printed item: 3rd Coat — $250.00. Control note: the invoice prints $182.50 HST, while 13% of the printed $1,350.00 subtotal is $175.50.",
        [allocation("96869012", 250)],
        { needsReview: true },
      ),
    ],
  },
  {
    id: "40d20d4d-4cd5-472c-a8e5-9482d6f8feb6",
    reason:
      "Restored all five printed AMG invoice #107 lines, including the previously missing $2,725 Joel/236 Trailsedge job.",
    lines: [
      line(
        "Heather Thomsen — base painting",
        1100,
        "Printed item: Heather Thomsen, 639 Chénier Way — $1,100.00.",
        [allocation("100014400", 1100)],
      ),
      line(
        "Alexandra — 39 Rue Gendron base painting",
        1345,
        "Printed item: Alexandra, 39 Rue Gendron — $1,345.00.",
        [allocation("104199412", 1345)],
      ),
      line(
        "Joel — 236 Trails Edge",
        2725,
        "Printed item: Joel, 236 Trails Edge, interior painting — $2,725.00.",
        [allocation("104221368", 2725)],
      ),
      line(
        "39 Rue Gendron — remove wallpaper",
        280,
        "Printed item: 39 Rue Gendron, remove paper walls, 8 at $35.00 — $280.00.",
        [allocation("104199412", 280)],
        { quantity: 8, unit: "hour", unitPrice: 35 },
      ),
      line(
        "Heather Thomsen — skim coat four walls",
        455,
        "Printed item: Heather Thomsen, skim coat four walls, 13 at $35.00 — $455.00.",
        [allocation("100014400", 455)],
        { quantity: 13, unit: "hour", unitPrice: 35 },
      ),
    ],
  },
  {
    id: "60056524-83a3-4480-a685-e59ef03ed974",
    reason:
      "Expanded the current Goulet invoice into its five printed lines and removed the obsolete zero-dollar Drywall job inherited from the superseded version.",
    lines: [
      line(
        "1843130 — Orleans interior and exterior",
        1170,
        "Printed item 1: 1843130 — Orleans interior and exterior — $1,170.00.",
        [allocation("dripjobs-1843130", 1170)],
      ),
      line(
        "1863401 — Interior (Almonte)",
        2580,
        "Printed item 2: 1863401 — Interior (Almonte) — $2,580.00.",
        [allocation("dripjobs-1863401", 2580)],
      ),
      line(
        "Extra — third coat",
        733,
        "Printed item 3: Extra — 3rd coat — $733.00.",
        [allocation("dripjobs-1863401", 733)],
      ),
      line(
        "1908370 — Daycare",
        3615,
        "Printed item 4: 1908370 — Daycare — $3,615.00.",
        [allocation("dripjobs-1908370", 3615)],
      ),
      line(
        "Extra — time and materials",
        0,
        "Printed item 5: Extra — time and materials; 5 gallons at $50 and 23h at $50 — $0.00 on the revised invoice.",
        [],
        { entryType: "other", unit: "item", unitPrice: 0 },
      ),
    ],
  },
  ...[
    {
      id: "82e7b902-1446-4d4c-926d-ffecce87b009",
      malformed: false,
    },
    {
      id: "966934b8-3938-424a-ac09-da08c593d08f",
      malformed: false,
    },
    {
      id: "b4f0f232-63f0-4ba4-9f47-cc9c41c0683f",
      malformed: true,
    },
  ].map(({ id, malformed }) => ({
    id,
    reason: malformed
      ? "Restored all six printed AMG #108 items in the earliest supporting copy. The revised duplicate supplies the missing Saroeun identity; the supporting copy's inconsistent printed HST remains visibly flagged."
      : "Added the printed $97.26 material line to AMG invoice #108 so the entries equal the physical $4,758.26 subtotal.",
    lines: [
      line(
        "Daniel Leblanc — interior painting",
        1236,
        "Printed item: Daniel Leblanc, 499 Russel Rd — $1,236.00.",
        [allocation("105445031", 1236)],
      ),
      line(
        "Bailey Muldner — interior painting",
        535,
        "Printed item: Bailey Muldner, 126 Versilia Dr — $535.00.",
        [allocation("102791614", 535)],
      ),
      line(
        "Rene Bellavance — interior painting",
        1850,
        "Printed item: Rene Bellavance, 14 Dowdall Crescent — $1,850.00.",
        [allocation("105711390", 1850)],
      ),
      line(
        "Rashonda Legault — exterior painting",
        320,
        "Printed item: Rashonda Legault, 559 Redwood Ave — $320.00.",
        [allocation("102085458", 320)],
      ),
      line(
        "Saroeun Cole — exterior painting",
        720,
        malformed
          ? "Printed item in this supporting copy: exterior painting / paint chimney — $720.00; the later revised duplicate identifies the client as Saroeun Cole at 1556 Drake Ave."
          : "Printed item: Saroeun Cole, 1556 Drake Ave — $720.00.",
        [allocation("105302560", 720)],
        { needsReview: malformed },
      ),
      line(
        "Materials — primer, flat paint, masking paper",
        97.26,
        malformed
          ? "Printed item: Buy 1 primer, 1 flat, 1 paper for floor — $97.26. This supporting copy prints $787.50 total tax instead of the later revised $605.93, so the source version remains reviewable."
          : "Printed item: Material — 1 primer, 1 flat, 1 paper for masking the floor — $97.26.",
        [],
        {
          entryType: "material",
          unit: "material",
          needsReview: malformed,
        },
      ),
    ],
  })),
  {
    id: "bc643df1-5aec-4ef3-85c8-03d816006d76",
    reason:
      "Split Mas Reno invoice #012223 into the printed $1,000 painting line and $91 parking fee; HST remains the printed invoice-level $130.",
    lines: [
      line(
        "Painting and related services (Job 1)",
        1000,
        "Printed item: Painting and related services (Job 1) — $1,000.00.",
        [allocation("97546597", 1000)],
      ),
      line(
        "Parking fee",
        91,
        "Printed item: Parking Fee — $91.00.",
        [],
        { entryType: "expense", unit: "fee" },
      ),
    ],
  },
  {
    id: "c3a378dd-86e0-4826-bc2e-12e792163e6e",
    reason:
      "Replaced three invented $90 XDesign items with the one physical $270 Paint & Plaster line. Existing equal job splits remain visibly reviewable because the invoice does not print them.",
    lines: [
      line(
        "Paint & Plaster touch-ups — Paul Toonders, Christine Leclair, Diane Benoit",
        270,
        "Printed item: Paint & Plaster, 9 at $30.00 — $270.00. The invoice lists Paul Toonders, Christine Leclair, and Diane Benoit but does not print per-person hours.",
        [
          allocation("105395079", 90, true),
          allocation("96770884", 90, true),
          allocation("108859223", 90, true),
        ],
        { quantity: 9, unit: "hour", unitPrice: 30 },
      ),
    ],
  },
  {
    id: "ca3e8c1e-5689-4a9d-b59d-f4469d553ba5",
    reason:
      "Converted the archived Angel invoice's job split to an explicit manual allocation. The physical invoice prints dates, addresses, combined hours, rate, and total but does not print the two stored job amounts, and Mar 1 spans both addresses.",
    preserveExistingLinesAsManual: true,
  },
];

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const lineText = rawLine.trim();
    if (!lineText || lineText.startsWith("#")) continue;
    const separator = lineText.indexOf("=");
    if (separator < 1) continue;
    const key = lineText.slice(0, separator).trim();
    let value = lineText.slice(separator + 1).trim();
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

const targetIds = [...SIMPLE_EXACT, ...COMPLEX.map((invoice) => invoice.id)];
assert(
  new Set(targetIds).size === 35,
  "The reviewed invoice correction set must contain exactly 35 documents.",
);
const [invoiceResult, lineResult, projectResult] = await Promise.all([
  db
    .from("labour_invoices")
    .select(
      "id,supplier_name,invoice_number,amount_before_tax,tax_amount,amount_paid,original_filename,match_status",
    )
    .in("id", targetIds),
  db
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
        source_reference,
        source_text,
        needs_review,
        labour_invoice_line_allocations (
          companycam_project_id,
          allocated_amount,
          allocated_hours,
          needs_review
        )
      `,
    )
    .in("invoice_id", targetIds)
    .order("line_number"),
  db
    .from("labour_invoice_projects")
    .select(
      "invoice_id,companycam_project_id,allocated_amount,match_score,match_method,is_primary,needs_review",
    )
    .in("invoice_id", targetIds),
]);
for (const [label, result] of Object.entries({
  invoices: invoiceResult,
  lines: lineResult,
  projects: projectResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
assert(
  invoiceResult.data.length === 35,
  "One or more reviewed invoice documents are missing.",
);
const invoiceById = new Map(invoiceResult.data.map((invoice) => [invoice.id, invoice]));
const linesByInvoice = Map.groupBy(lineResult.data, (entry) => entry.invoice_id);
const projectsByInvoice = Map.groupBy(
  projectResult.data,
  (project) => project.invoice_id,
);

for (const id of targetIds) {
  const invoice = invoiceById.get(id);
  const entries = linesByInvoice.get(id) ?? [];
  assert(invoice, `Missing invoice ${id}.`);
  assert(entries.length > 0, `Invoice ${id} has no entries to reconcile.`);
  assert(
    entries.every((entry) =>
      [
        "legacy_project_link",
        "legacy_invoice_total",
        "extracted",
        "manual",
      ].includes(
        entry.source_kind,
      ),
    ),
    `Invoice ${id} has an unexpected evidence source: ${entries
      .map((entry) => entry.source_kind)
      .join(", ")}.`,
  );
}

for (const correction of COMPLEX) {
  if (correction.preserveExistingLinesAsManual) continue;
  const invoice = invoiceById.get(correction.id);
  const desiredTotal = correction.lines.reduce(
    (total, entry) => total + Number(entry.amount),
    0,
  );
  assert(
    cents(desiredTotal) === cents(invoice.amount_before_tax),
    `Desired entries do not equal the printed subtotal for ${correction.id}.`,
  );
  for (const desiredLine of correction.lines) {
    const allocated = desiredLine.allocations.reduce(
      (total, row) => total + Number(row.amount),
      0,
    );
    assert(
      allocated <= desiredLine.amount + 0.005,
      `Job allocations exceed the line amount on ${correction.id}.`,
    );
  }
}

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      simple_exact_documents: SIMPLE_EXACT.length,
      rebuilt_documents: COMPLEX.length - 1,
      manual_allocation_documents: 1,
      source_documents: 35,
      source_entries_before: lineResult.data.length,
      complex_documents: COMPLEX.map((invoice) => ({
        id: invoice.id,
        supplier: invoiceById.get(invoice.id).supplier_name,
        invoice: invoiceById.get(invoice.id).invoice_number,
        old_entries: (linesByInvoice.get(invoice.id) ?? []).length,
        new_entries: invoice.preserveExistingLinesAsManual
          ? (linesByInvoice.get(invoice.id) ?? []).length
          : invoice.lines.length,
        reason: invoice.reason,
      })),
    },
    null,
    2,
  ),
);
if (!APPLY) {
  console.log("Dry run only. Re-run with --apply to write the corrections.");
  process.exit(0);
}

for (const invoiceId of SIMPLE_EXACT) {
  const invoice = invoiceById.get(invoiceId);
  const allocationReview = SIMPLE_ALLOCATION_REVIEW.has(invoiceId);
  for (const entry of linesByInvoice.get(invoiceId) ?? []) {
    const sourceText = [
      `Verified directly against ${invoice.original_filename}.`,
      `Printed item ${entry.description} — $${Number(entry.amount_before_tax).toFixed(2)}.`,
      entry.source_text,
      allocationReview
        ? "Job allocation remains reviewable because the physical source says 153 Oakdean Crescent while the linked project says 1953 Oakdean Crescent."
        : null,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 1800);
    const update = await db
      .from("labour_invoice_lines")
      .update({
        source_kind: "extracted",
        source_reference: `physical-invoice:${invoiceId}:line:${entry.line_number}`,
        source_text: sourceText,
        needs_review: false,
      })
      .eq("id", entry.id)
      .eq("invoice_id", invoiceId);
    if (update.error) throw update.error;
    const allocationUpdate = await db
      .from("labour_invoice_line_allocations")
      .update({ needs_review: allocationReview })
      .eq("invoice_line_id", entry.id);
    if (allocationUpdate.error) throw allocationUpdate.error;
  }
  const projectUpdate = await db
    .from("labour_invoice_projects")
    .update({ needs_review: allocationReview })
    .eq("invoice_id", invoiceId);
  if (projectUpdate.error) throw projectUpdate.error;

  await insertAuditEvent(db, {
    entity_type: "invoice",
    entity_id: invoiceId,
    action: "update",
    old_values: { source_kind: "legacy_project_link" },
    new_values: {
      source_kind: "extracted",
      allocation_needs_review: allocationReview,
    },
    reason:
      `Verified every stored entry and amount directly against ${invoice.original_filename}.` +
      (allocationReview
        ? " The source/project address discrepancy remains flagged."
        : " The printed identity and existing job evidence agree."),
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

for (const correction of COMPLEX) {
  const invoice = invoiceById.get(correction.id);
  const currentLines = linesByInvoice.get(correction.id) ?? [];
  const oldSnapshot = currentLines.map((entry) => ({
    id: entry.id,
    line_number: entry.line_number,
    description: entry.description,
    amount_before_tax: Number(entry.amount_before_tax),
    source_kind: entry.source_kind,
    allocations: entry.labour_invoice_line_allocations,
  }));

  if (correction.preserveExistingLinesAsManual) {
    for (const entry of currentLines) {
      const update = await db
        .from("labour_invoice_lines")
        .update({
          source_kind: "manual",
          source_reference: `manual-allocation:${correction.id}:line:${entry.line_number}`,
          source_text:
            `Manual job allocation from the archived invoice's printed dates, addresses, combined 46.08 hours, $37.50 rate, and $1,728.00 gross. ` +
            `The physical invoice does not print the stored per-job amount, and the March 1 shift spans both 785 Mooney's Bay and 4 Stradwick. Existing allocation retained for transparency.`,
          needs_review: true,
        })
        .eq("id", entry.id)
        .eq("invoice_id", correction.id);
      if (update.error) throw update.error;
      const allocationUpdate = await db
        .from("labour_invoice_line_allocations")
        .update({ needs_review: true })
        .eq("invoice_line_id", entry.id);
      if (allocationUpdate.error) throw allocationUpdate.error;
    }
    const projectUpdate = await db
      .from("labour_invoice_projects")
      .update({ needs_review: true })
      .eq("invoice_id", correction.id);
    if (projectUpdate.error) throw projectUpdate.error;
  } else {
    const currentLineIds = currentLines.map((entry) => entry.id);
    if (currentLineIds.length) {
      const clearAllocations = await db
        .from("labour_invoice_line_allocations")
        .delete()
        .in("invoice_line_id", currentLineIds);
      if (clearAllocations.error) throw clearAllocations.error;
    }

    const desiredLineIds = new Map();
    for (const [index, desired] of correction.lines.entries()) {
      const lineNumber = index + 1;
      const upsert = await db
        .from("labour_invoice_lines")
        .upsert(
          {
            invoice_id: correction.id,
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
            is_adjustment: false,
            source_kind: desired.sourceKind,
            source_reference:
              desired.sourceKind === "manual"
                ? `manual-control:${correction.id}:line:${lineNumber}`
                : `physical-invoice:${correction.id}:line:${lineNumber}`,
            source_text:
              `${desired.sourceText} Verified against ${invoice.original_filename}.`,
            needs_review: desired.needsReview,
            inserted_by: ADMIN_USER_ID,
          },
          { onConflict: "invoice_id,line_number" },
        )
        .select("id,line_number")
        .single();
      if (upsert.error) throw upsert.error;
      desiredLineIds.set(lineNumber, upsert.data.id);
    }

    for (const [index, desired] of correction.lines.entries()) {
      const invoiceLineId = desiredLineIds.get(index + 1);
      if (!desired.allocations.length) continue;
      const rows = desired.allocations.map((row) => ({
        invoice_line_id: invoiceLineId,
        companycam_project_id: row.projectId,
        allocated_amount: row.amount,
        allocated_hours: null,
        allocation_method: [
          "physical_invoice_item",
          "reviewed_project_identity",
          "derived_invoice_cleanup_20260731",
        ],
        needs_review: row.needsReview,
      }));
      const insertion = await db
        .from("labour_invoice_line_allocations")
        .insert(rows);
      if (insertion.error) throw insertion.error;
    }

    const desiredLineNumbers = correction.lines.map((_, index) => index + 1);
    const obsoleteLineIds = currentLines
      .filter((entry) => !desiredLineNumbers.includes(entry.line_number))
      .map((entry) => entry.id);
    if (obsoleteLineIds.length) {
      const deletion = await db
        .from("labour_invoice_lines")
        .delete()
        .in("id", obsoleteLineIds)
        .eq("invoice_id", correction.id);
      if (deletion.error) throw deletion.error;
    }

    const existingProjects = projectsByInvoice.get(correction.id) ?? [];
    if (existingProjects.length) {
      const projectDeletion = await db
        .from("labour_invoice_projects")
        .delete()
        .eq("invoice_id", correction.id);
      if (projectDeletion.error) throw projectDeletion.error;
    }
    const projectAggregates = new Map();
    for (const desired of correction.lines) {
      for (const row of desired.allocations) {
        const current = projectAggregates.get(row.projectId) ?? {
          amount: 0,
          needsReview: false,
        };
        current.amount += Number(row.amount);
        current.needsReview ||= row.needsReview;
        projectAggregates.set(row.projectId, current);
      }
    }
    if (projectAggregates.size) {
      const projectRows = [...projectAggregates.entries()].map(
        ([projectId, row], index) => ({
          invoice_id: correction.id,
          companycam_project_id: projectId,
          allocated_amount: Number(row.amount.toFixed(2)),
          match_score: 200,
          match_method: [
            "physical_invoice_item",
            "reviewed_project_identity",
            "derived_invoice_cleanup_20260731",
          ],
          is_primary: index === 0,
          needs_review: row.needsReview,
        }),
      );
      const insertion = await db
        .from("labour_invoice_projects")
        .insert(projectRows);
      if (insertion.error) throw insertion.error;
    }
  }

  await insertAuditEvent(db, {
    entity_type: "invoice",
    entity_id: correction.id,
    action: "update",
    old_values: { entries: oldSnapshot },
    new_values: {
      evidence:
        correction.preserveExistingLinesAsManual
          ? "manual_reviewable_allocation"
          : "physical_invoice_items",
      entries: correction.preserveExistingLinesAsManual
        ? currentLines.map((entry) => ({
            line_number: entry.line_number,
            amount_before_tax: Number(entry.amount_before_tax),
            source_kind: "manual",
            needs_review: true,
          }))
        : correction.lines.map((entry, index) => ({
            line_number: index + 1,
            description: entry.description,
            amount_before_tax: entry.amount,
            source_kind: entry.sourceKind,
            needs_review: entry.needsReview,
            allocations: entry.allocations,
          })),
    },
    reason: correction.reason,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

const [remainingDerived, correctedLines, correctedInvoices] = await Promise.all([
  db
    .from("labour_invoice_lines")
    .select("id", { count: "exact", head: true })
    .eq("source_kind", "legacy_project_link"),
  db
    .from("labour_invoice_lines")
    .select(
      "id,invoice_id,line_number,description,amount_before_tax,source_kind,needs_review",
    )
    .in("invoice_id", targetIds),
  db
    .from("labour_invoices")
    .select("id,amount_before_tax")
    .in("id", targetIds),
]);
for (const [label, result] of Object.entries({
  remainingDerived,
  correctedLines,
  correctedInvoices,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}
assert(
  remainingDerived.count === 0,
  `${remainingDerived.count} derived invoice entries still remain.`,
);
const finalByInvoice = Map.groupBy(
  correctedLines.data,
  (entry) => entry.invoice_id,
);
for (const invoice of correctedInvoices.data) {
  const entryTotal = (finalByInvoice.get(invoice.id) ?? []).reduce(
    (total, entry) => total + Number(entry.amount_before_tax),
    0,
  );
  assert(
    cents(entryTotal) === cents(invoice.amount_before_tax),
    `Corrected entries do not equal the invoice subtotal for ${invoice.id}.`,
  );
}

console.log(
  JSON.stringify(
    {
      applied: true,
      corrected_documents: correctedInvoices.data.length,
      corrected_entries: correctedLines.data.length,
      remaining_derived_entries: remainingDerived.count,
      evidence_sources: Object.fromEntries(
        Object.entries(
          Object.groupBy(correctedLines.data, (entry) => entry.source_kind),
        ).map(([source, entries]) => [source, entries.length]),
      ),
      reviewable_entries: correctedLines.data.filter(
        (entry) => entry.needs_review,
      ).length,
    },
    null,
    2,
  ),
);
