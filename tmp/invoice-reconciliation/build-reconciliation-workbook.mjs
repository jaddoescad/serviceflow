import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const repoRoot = "/Users/jadslim/Desktop/ottawa-painters-admin";
const inputPath = path.join(
  repoRoot,
  "tmp/invoice-reconciliation/live-reconciliation.json",
);
const outputDir = path.join(repoRoot, "outputs/invoice-reconciliation");
const previewDir = path.join(
  repoRoot,
  "tmp/invoice-reconciliation/previews",
);
const outputPath = path.join(
  outputDir,
  "labour-invoice-reconciliation-2026-07-25.xlsx",
);
const data = JSON.parse(await fs.readFile(inputPath, "utf8"));

const workbook = Workbook.create();
const summarySheet = workbook.worksheets.add("Summary");
const invoicesSheet = workbook.worksheets.add("Invoices");
const unmatchedSheet = workbook.worksheets.add("Unmatched");
const duplicatesSheet = workbook.worksheets.add("Duplicate Groups");
const jobsSheet = workbook.worksheets.add("Jobs Without Invoices");
const reviewSheet = workbook.worksheets.add("Review Links");
const amountAuditSheet = workbook.worksheets.add("Amount Audit");

const colours = {
  navy: "#17324D",
  blue: "#2D6A8A",
  paleBlue: "#EAF3F7",
  paleYellow: "#FFF4CC",
  paleRed: "#FDECEC",
  paleGreen: "#E8F5EE",
  border: "#D4DEE5",
  text: "#20303B",
  muted: "#637582",
  white: "#FFFFFF",
};

function excelDate(value) {
  return value ? new Date(`${value}T00:00:00`) : null;
}

function setTitle(sheet, endColumn, title, note) {
  const titleRange = sheet.getRange(`A1:${endColumn}1`);
  titleRange.merge();
  titleRange.values = [[title]];
  titleRange.format = {
    fill: colours.navy,
    font: { bold: true, color: colours.white, size: 18 },
    verticalAlignment: "center",
  };
  titleRange.format.rowHeight = 30;
  const noteRange = sheet.getRange(`A2:${endColumn}2`);
  noteRange.merge();
  noteRange.values = [[note]];
  noteRange.format = {
    fill: colours.paleBlue,
    font: { color: colours.muted, italic: true },
    wrapText: true,
    verticalAlignment: "center",
  };
  noteRange.format.rowHeight = 34;
  sheet.showGridLines = false;
}

function styleHeader(range) {
  range.format = {
    fill: colours.blue,
    font: { bold: true, color: colours.white },
    wrapText: true,
    verticalAlignment: "center",
    borders: { preset: "all", style: "thin", color: colours.border },
  };
  range.format.rowHeight = 26;
}

function styleBody(range) {
  range.format = {
    font: { color: colours.text },
    verticalAlignment: "top",
    borders: { preset: "all", style: "thin", color: colours.border },
  };
}

const linksByInvoice = new Map();
for (const link of data.links) {
  const links = linksByInvoice.get(link.invoice_id) ?? [];
  links.push(link);
  linksByInvoice.set(link.invoice_id, links);
}
for (const links of linksByInvoice.values()) {
  links.sort(
    (left, right) =>
      Number(right.is_primary) - Number(left.is_primary) ||
      right.match_score - left.match_score,
  );
}

setTitle(
  summarySheet,
  "F",
  "Labour Invoice Reconciliation",
  `Live Supabase audit exported ${data.exported_at}. Amounts are recorded per source file; no aggregate payment total is shown because revisions and payment copies can duplicate amounts.`,
);
summarySheet.getRange("A4:B4").values = [["Archive control", "Result"]];
styleHeader(summarySheet.getRange("A4:B4"));
summarySheet.getRange("A5:A16").values = [
  ["Files archived"],
  ["Matched to ≥1 job"],
  ["Unmatched"],
  ["Overhead / no job"],
  ["Supporting documents"],
  ["Not invoices"],
  ["Duplicate/version groups"],
  ["Jobs without invoices"],
  ["Active jobs without invoices"],
  ["Links flagged for review"],
  ["Amounts captured"],
  ["Storage integrity"],
];
summarySheet.getRange("B5:B16").formulas = [
  ["=COUNTA(Invoices!A5:A214)"],
  ['=COUNTIF(Invoices!H5:H214,"matched")+COUNTIF(Invoices!H5:H214,"matched_multiple")'],
  ['=COUNTIF(Invoices!H5:H214,"unmatched")'],
  ['=COUNTIF(Invoices!H5:H214,"overhead_unmatched")'],
  ['=COUNTIF(Invoices!H5:H214,"supporting_document")'],
  ['=COUNTIF(Invoices!H5:H214,"not_invoice")'],
  [`=COUNTA('Duplicate Groups'!A6:A${data.summary.duplicate_groups + 5})`],
  ["=COUNTA('Jobs Without Invoices'!A5:A117)"],
  ['=COUNTIF(\'Jobs Without Invoices\'!D5:D117,"Active")'],
  ["=COUNTA('Review Links'!A5:A16)"],
  ['=COUNTIF(Invoices!E5:E214,">=0")'],
  ['=COUNTA(Invoices!Q5:Q214)&"/"&COUNTA(Invoices!A5:A214)&" files verified"'],
];
styleBody(summarySheet.getRange("A5:B16"));
summarySheet.getRange("A5:A16").format.fill = "#F7FAFC";
summarySheet.getRange("B5:B15").format.numberFormat = "0";
summarySheet.getRange("D4:F4").values = [["Key exception", "Count", "Action"]];
styleHeader(summarySheet.getRange("D4:F4"));
summarySheet.getRange("D5:F9").values = [
  ["Unmatched source files", data.summary.status_counts.unmatched, "Assign only after job evidence is found"],
  ["Duplicate/version files", data.summary.duplicate_group_files, "Confirm the paid/revised version"],
  ["Exact copies excluded", 3, "Kept out of Supabase to avoid byte-for-byte duplicates"],
  ["Low-confidence name links", 3, "Review spelling/name discrepancies"],
  ["CompanyCam lead links", 9, "Confirm lead labels are stale or convert to jobs"],
];
styleBody(summarySheet.getRange("D5:F9"));
summarySheet.getRange("D5:F9").format.wrapText = true;
summarySheet.getRange("D10:F10").values = [[
  "Source amount/HST issues",
  null,
  "Request corrected invoices before relying on the HST",
]];
summarySheet.getRange("E10").formulas = [[
  '=COUNTIF(\'Amount Audit\'!A5:A15,"Issue")',
]];
styleBody(summarySheet.getRange("D10:F10"));
summarySheet.getRange("D10:F10").format.wrapText = true;
summarySheet.getRange("D12:F12").merge();
summarySheet.getRange("D12:F12").values = [["Scope notes"]];
summarySheet.getRange("D12:F12").format = {
  fill: colours.navy,
  font: { bold: true, color: colours.white },
};
summarySheet.getRange("D13:F17").merge(true);
summarySheet.getRange("D13:D17").values = [
  ["Private bucket: labour-invoices (admin/manager access only)"],
  ["Source: Gmail label “Labour Invoices”, downloaded 2026-07-25"],
  ["Operational jobs exclude leads, deleted/test projects, and internal QA records"],
  ["Multiple-job invoices retain one source amount; no unsupported per-job split was invented"],
  ["Existing labour metrics were not changed, preventing double-counting"],
];
summarySheet.getRange("D13:F17").format = {
  fill: "#F7FAFC",
  font: { color: colours.muted },
  wrapText: true,
  borders: { preset: "all", style: "thin", color: colours.border },
};
summarySheet.getRange("A1:F17").format.verticalAlignment = "center";
summarySheet.getRange("A:A").format.columnWidth = 29;
summarySheet.getRange("B:B").format.columnWidth = 20;
summarySheet.getRange("C:C").format.columnWidth = 3;
summarySheet.getRange("D:D").format.columnWidth = 28;
summarySheet.getRange("E:E").format.columnWidth = 12;
summarySheet.getRange("F:F").format.columnWidth = 44;
summarySheet.freezePanes.freezeRows(4);

setTitle(
  invoicesSheet,
  "R",
  "Invoice Archive",
  "One row per archived source file. Amount Paid is the gross amount shown on that file; duplicate/version groups are retained for audit.",
);
const invoiceHeaders = [
  "Date",
  "Supplier",
  "Invoice #",
  "Currency",
  "Amount",
  "HST",
  "Total",
  "Match Status",
  "Document Type",
  "Project IDs",
  "Project Names",
  "Match Scores",
  "Review Required",
  "Duplicate Group",
  "Group Size",
  "Filename",
  "Storage Path",
  "SHA-256",
];
invoicesSheet.getRange("A4:R4").values = [invoiceHeaders];
styleHeader(invoicesSheet.getRange("A4:R4"));
const invoiceRows = data.invoices.map((invoice) => {
  const links = linksByInvoice.get(invoice.id) ?? [];
  return [
    excelDate(invoice.invoice_date),
    invoice.supplier_name,
    invoice.invoice_number,
    invoice.currency,
    invoice.amount_before_tax,
    invoice.tax_amount,
    invoice.amount_paid,
    invoice.match_status,
    invoice.document_type,
    links.map((link) => link.companycam_project_id).join("; "),
    links.map((link) => link.companycam_projects?.name ?? "").join("; "),
    links.map((link) => link.match_score).join("; "),
    links.some((link) => link.needs_review) ? "Yes" : "No",
    invoice.duplicate_group_id,
    invoice.duplicate_group_size,
    invoice.original_filename,
    invoice.storage_path,
    invoice.content_sha256,
  ];
});
invoicesSheet.getRange(`A5:R${invoiceRows.length + 4}`).values = invoiceRows;
styleBody(invoicesSheet.getRange(`A5:R${invoiceRows.length + 4}`));
invoicesSheet.getRange(`A5:A${invoiceRows.length + 4}`).format.numberFormat = "yyyy-mm-dd";
invoicesSheet.getRange(`E5:G${invoiceRows.length + 4}`).format.numberFormat = "$#,##0.00";
invoicesSheet.getRange(`H5:H${invoiceRows.length + 4}`).conditionalFormats.add(
  "containsText",
  { text: "unmatched", format: { fill: colours.paleRed, font: { color: "#9B2C2C" } } },
);
invoicesSheet.getRange(`M5:M${invoiceRows.length + 4}`).conditionalFormats.add(
  "containsText",
  { text: "Yes", format: { fill: colours.paleYellow, font: { color: "#8A5A00", bold: true } } },
);
const invoiceTable = invoicesSheet.tables.add(
  `A4:R${invoiceRows.length + 4}`,
  true,
  "InvoiceArchiveTable",
);
invoiceTable.style = "TableStyleMedium2";
invoicesSheet.freezePanes.freezeRows(4);
const invoiceWidths = [12, 25, 18, 9, 14, 14, 12, 20, 19, 22, 30, 15, 14, 18, 10, 48, 58, 28];
invoiceWidths.forEach((width, index) => {
  invoicesSheet.getCell(3, index).format.columnWidth = width;
});

const unmatchedInvoices = data.invoices.filter(
  (invoice) => invoice.match_status === "unmatched",
);
setTitle(
  unmatchedSheet,
  "H",
  "Unmatched Source Files",
  "These files were uploaded but not attached to a job because the source did not contain a reliable CompanyCam name/address match.",
);
unmatchedSheet.getRange("A4:H4").values = [[
  "Date",
  "Supplier",
  "Invoice #",
  "Currency",
  "Amount Paid",
  "Document Type",
  "Reason",
  "Filename",
]];
styleHeader(unmatchedSheet.getRange("A4:H4"));
const unmatchedRows = unmatchedInvoices.map((invoice) => [
  excelDate(invoice.invoice_date),
  invoice.supplier_name,
  invoice.invoice_number,
  invoice.currency,
  invoice.amount_paid,
  invoice.document_type,
  "No reliable project name/address match",
  invoice.original_filename,
]);
unmatchedSheet.getRange(`A5:H${unmatchedRows.length + 4}`).values = unmatchedRows;
styleBody(unmatchedSheet.getRange(`A5:H${unmatchedRows.length + 4}`));
unmatchedSheet.getRange(`A5:A${unmatchedRows.length + 4}`).format.numberFormat = "yyyy-mm-dd";
unmatchedSheet.getRange(`E5:E${unmatchedRows.length + 4}`).format.numberFormat = "$#,##0.00";
const unmatchedTable = unmatchedSheet.tables.add(
  `A4:H${unmatchedRows.length + 4}`,
  true,
  "UnmatchedInvoicesTable",
);
unmatchedTable.style = "TableStyleMedium3";
unmatchedSheet.freezePanes.freezeRows(4);
[12, 25, 19, 9, 14, 18, 37, 55].forEach((width, index) => {
  unmatchedSheet.getCell(3, index).format.columnWidth = width;
});

const duplicateGroups = new Map();
for (const invoice of data.invoices.filter((item) => item.duplicate_group_id)) {
  const items = duplicateGroups.get(invoice.duplicate_group_id) ?? [];
  items.push(invoice);
  duplicateGroups.set(invoice.duplicate_group_id, items);
}
setTitle(
  duplicatesSheet,
  "G",
  "Duplicate and Version Groups",
  "Same supplier/invoice-number groups can be exact copies, revised totals, or payment copies. They are flagged—not automatically deleted.",
);
duplicatesSheet.getRange("A5:G5").values = [[
  "Group ID",
  "Supplier",
  "Invoice #",
  "Files",
  "Amounts Seen",
  "Dates",
  "Filenames",
]];
styleHeader(duplicatesSheet.getRange("A5:G5"));
const duplicateRows = [...duplicateGroups.entries()]
  .sort(([, left], [, right]) =>
    String(left[0].supplier_name).localeCompare(String(right[0].supplier_name)),
  )
  .map(([groupId, items]) => [
    groupId,
    items[0].supplier_name,
    items[0].invoice_number,
    items.length,
    [...new Set(items.map((item) => `${item.currency} ${item.amount_paid ?? "—"}`))].join("; "),
    items.map((item) => item.invoice_date ?? "—").join("; "),
    items.map((item) => item.original_filename).join(" | "),
  ]);
duplicatesSheet.getRange(`A6:G${duplicateRows.length + 5}`).values = duplicateRows;
styleBody(duplicatesSheet.getRange(`A6:G${duplicateRows.length + 5}`));
const duplicateTable = duplicatesSheet.tables.add(
  `A5:G${duplicateRows.length + 5}`,
  true,
  "DuplicateGroupsTable",
);
duplicateTable.style = "TableStyleMedium4";
const exactStart = duplicateRows.length + 8;
duplicatesSheet.getRange(`A${exactStart}:C${exactStart}`).merge();
duplicatesSheet.getRange(`A${exactStart}:C${exactStart}`).values = [[
  "Exact byte-for-byte copies excluded before upload",
]];
duplicatesSheet.getRange(`A${exactStart}:C${exactStart}`).format = {
  fill: colours.navy,
  font: { bold: true, color: colours.white },
};
const exactRows = [
  ["2026-05-26", "Perfect Strokes invoice 118", "Exact copy excluded"],
  ["2026-06-27", "XDesign invoice 8590", "Exact copy excluded"],
  ["2026-06-02", "74932994… (2).pdf", "Exact copy excluded"],
];
duplicatesSheet.getRange(`A${exactStart + 1}:C${exactStart + 3}`).values = exactRows;
styleBody(duplicatesSheet.getRange(`A${exactStart + 1}:C${exactStart + 3}`));
duplicatesSheet.freezePanes.freezeRows(5);
[19, 28, 19, 9, 30, 38, 75].forEach((width, index) => {
  duplicatesSheet.getCell(4, index).format.columnWidth = width;
});

setTitle(
  jobsSheet,
  "D",
  "Operational Jobs Without Invoices",
  "CompanyCam jobs with no linked invoice in this archive. Active jobs appear first; leads, deleted/test projects, and internal QA records are excluded.",
);
jobsSheet.getRange("A4:D4").values = [[
  "CompanyCam ID",
  "Job",
  "Address",
  "Status",
]];
styleHeader(jobsSheet.getRange("A4:D4"));
const jobRows = data.jobs_without_invoices.map((job) => [
  job.companycam_id,
  job.name,
  job.formatted_address,
  job.is_archived ? "Archived" : "Active",
]);
jobsSheet.getRange(`A5:D${jobRows.length + 4}`).values = jobRows;
styleBody(jobsSheet.getRange(`A5:D${jobRows.length + 4}`));
jobsSheet.getRange(`D5:D${jobRows.length + 4}`).conditionalFormats.add(
  "containsText",
  { text: "Active", format: { fill: colours.paleYellow, font: { color: "#8A5A00", bold: true } } },
);
const jobsTable = jobsSheet.tables.add(
  `A4:D${jobRows.length + 4}`,
  true,
  "JobsWithoutInvoicesTable",
);
jobsTable.style = "TableStyleMedium2";
jobsSheet.freezePanes.freezeRows(4);
[19, 32, 50, 12].forEach((width, index) => {
  jobsSheet.getCell(3, index).format.columnWidth = width;
});

const invoiceById = new Map(data.invoices.map((invoice) => [invoice.id, invoice]));
const reviewLinks = data.links
  .filter((link) => link.needs_review || link.match_score < 65)
  .sort(
    (left, right) =>
      Number(right.companycam_projects?.is_lead) -
        Number(left.companycam_projects?.is_lead) ||
      left.match_score - right.match_score,
  );
setTitle(
  reviewSheet,
  "J",
  "Links Requiring Review",
  "These associations are plausible but flagged because CompanyCam still marks the record as a lead or because the name evidence is lower confidence.",
);
reviewSheet.getRange("A4:J4").values = [[
  "Invoice Date",
  "Supplier",
  "Invoice #",
  "Amount Paid",
  "Job",
  "Address",
  "Project ID",
  "Score",
  "Evidence",
  "Review Reason",
]];
styleHeader(reviewSheet.getRange("A4:J4"));
const reviewRows = reviewLinks.map((link) => {
  const invoice = invoiceById.get(link.invoice_id);
  const reasons = [];
  if (link.companycam_projects?.is_lead) reasons.push("CompanyCam record marked lead");
  if (link.match_score < 65) reasons.push("Lower-confidence name evidence");
  return [
    excelDate(invoice?.invoice_date),
    invoice?.supplier_name,
    invoice?.invoice_number,
    invoice?.amount_paid,
    link.companycam_projects?.name,
    link.companycam_projects?.formatted_address,
    link.companycam_project_id,
    link.match_score,
    link.match_method.join("; "),
    reasons.join("; "),
  ];
});
reviewSheet.getRange(`A5:J${reviewRows.length + 4}`).values = reviewRows;
styleBody(reviewSheet.getRange(`A5:J${reviewRows.length + 4}`));
reviewSheet.getRange(`A5:A${reviewRows.length + 4}`).format.numberFormat = "yyyy-mm-dd";
reviewSheet.getRange(`D5:D${reviewRows.length + 4}`).format.numberFormat = "$#,##0.00";
reviewSheet.getRange(`J5:J${reviewRows.length + 4}`).format.fill = colours.paleYellow;
const reviewTable = reviewSheet.tables.add(
  `A4:J${reviewRows.length + 4}`,
  true,
  "ReviewLinksTable",
);
reviewTable.style = "TableStyleMedium4";
reviewSheet.freezePanes.freezeRows(4);
[12, 25, 18, 14, 32, 46, 18, 9, 34, 34].forEach((width, index) => {
  reviewSheet.getCell(3, index).format.columnWidth = width;
});

const amountAuditDefinitions = [
  {
    filename: "2026-01-31 - B9DDD3A2-B2E2-4407-8E74-0890B770FBE8.png",
    status: "Issue",
    finding:
      "Invoice shows $182.50 HST on $1,350.00. At 13%, HST would be $175.50, so the source appears $7.00 high.",
  },
  {
    filename: "2026-05-25 - 108-Ottawa-painters.pdf",
    status: "Issue",
    finding:
      "Source includes three HST lines totalling $787.50. Later revisions show $605.93 HST and a total $181.57 lower.",
  },
  {
    filename: "2026-01-31 - BEC47543-6E34-4983-9A83-EF932417A7C6.png",
    status: "Explained exception",
    finding:
      "HST is exactly 13% of the $1,000 painting service; the $91 parking fee is not taxed.",
  },
  {
    filename: "2026-01-31 - Untitled.pdf",
    status: "Explained exception",
    finding:
      "HST is exactly 13% of $750 painting/additional work; the $50 parking fee is not taxed.",
  },
  {
    filename: "2026-02-05 - Hosted - invoice-380069.pdf",
    status: "Explained exception",
    finding:
      "The source taxes project management and sales at 13% and shows paint reimbursements as zero-tax.",
  },
  {
    filename: "2026-04-13 - Invoice_239605_from_Caledonian_Painting_Ltd.pdf",
    status: "Explained exception",
    finding:
      "The source tax summary applies 13% to $10,836.68 and zero-rates $1,463.15 of paint.",
  },
  {
    filename: "2026-05-01 - Invoice_239606_from_Caledonian_Painting_Ltd.pdf",
    status: "Explained exception",
    finding:
      "The source tax summary applies 13% to $10,147.34 and zero-rates $109.37 of supplies.",
  },
  {
    filename: "2026-06-11 - Invoice_239607_from_Caledonian_Painting_Ltd.pdf",
    status: "Explained exception",
    finding:
      "The source tax summary applies 13% to $10,711.52 and zero-rates $152.08 of supplies.",
  },
  {
    filename: "2026-06-30 - Invoice_239608_from_Caledonian_Painting_Ltd.pdf",
    status: "Explained exception",
    finding:
      "The source tax summary applies 13% to $8,926.00 and zero-rates $106.67 of supplies.",
  },
  {
    filename: "2026-05-26 - 108-Ottawa-painters.pdf",
    status: "Explained exception",
    finding:
      "Corrected revision taxes $4,661.00 at 13%; $97.26 of materials is outside the taxable base.",
  },
  {
    filename: "2026-05-28 - 108-Ottawa-painters.pdf",
    status: "Explained exception",
    finding:
      "Corrected revision taxes $4,661.00 at 13%; $97.26 of materials is outside the taxable base.",
  },
];
const amountAuditRows = amountAuditDefinitions.map((definition) => {
  const invoice = data.invoices.find(
    (item) => item.original_filename === definition.filename,
  );
  if (!invoice) throw new Error(`Missing audit source: ${definition.filename}`);
  return {
    definition,
    invoice,
  };
});
setTitle(
  amountAuditSheet,
  "L",
  "Amount and HST Audit",
  "All 186 classified invoices balance arithmetically. This sheet records the source documents whose effective HST is not exactly 13% of the full pre-tax amount.",
);
amountAuditSheet.getRange("A4:L4").values = [[
  "Status",
  "Supplier",
  "Invoice #",
  "Invoice Date",
  "Amount",
  "HST",
  "Total",
  "Effective HST Rate",
  "Full 13% HST",
  "Variance vs Full 13%",
  "Finding",
  "Filename",
]];
styleHeader(amountAuditSheet.getRange("A4:L4"));
const amountAuditEndRow = amountAuditRows.length + 4;
amountAuditSheet.getRange(`A5:G${amountAuditEndRow}`).values = amountAuditRows.map(
  ({ definition, invoice }) => [
    definition.status,
    invoice.supplier_name,
    invoice.invoice_number,
    excelDate(invoice.invoice_date),
    invoice.amount_before_tax,
    invoice.tax_amount,
    invoice.amount_paid,
  ],
);
amountAuditSheet.getRange(`H5:J${amountAuditEndRow}`).formulas = amountAuditRows.map(
  (_item, index) => {
    const row = index + 5;
    return [
      `=IF(E${row}=0,0,F${row}/E${row})`,
      `=E${row}*13%`,
      `=F${row}-I${row}`,
    ];
  },
);
amountAuditSheet.getRange(`K5:L${amountAuditEndRow}`).values = amountAuditRows.map(
  ({ definition, invoice }) => [definition.finding, invoice.original_filename],
);
styleBody(amountAuditSheet.getRange(`A5:L${amountAuditEndRow}`));
amountAuditSheet.getRange(`D5:D${amountAuditEndRow}`).format.numberFormat = "yyyy-mm-dd";
amountAuditSheet.getRange(`E5:G${amountAuditEndRow}`).format.numberFormat = "$#,##0.00";
amountAuditSheet.getRange(`H5:H${amountAuditEndRow}`).format.numberFormat = "0.00%";
amountAuditSheet.getRange(`I5:J${amountAuditEndRow}`).format.numberFormat = "$#,##0.00";
amountAuditSheet.getRange(`K5:L${amountAuditEndRow}`).format.wrapText = true;
amountAuditSheet.getRange(`A5:A${amountAuditEndRow}`).conditionalFormats.add(
  "containsText",
  {
    text: "Issue",
    format: { fill: colours.paleRed, font: { color: "#9B2C2C", bold: true } },
  },
);
amountAuditSheet.getRange(`A5:A${amountAuditEndRow}`).conditionalFormats.add(
  "containsText",
  {
    text: "Explained exception",
    format: { fill: colours.paleGreen, font: { color: "#276749" } },
  },
);
const amountAuditTable = amountAuditSheet.tables.add(
  `A4:L${amountAuditEndRow}`,
  true,
  "AmountAuditTable",
);
amountAuditTable.style = "TableStyleMedium2";
amountAuditSheet.freezePanes.freezeRows(4);
[20, 28, 20, 13, 14, 14, 14, 18, 16, 20, 66, 55].forEach(
  (width, index) => {
    amountAuditSheet.getCell(3, index).format.columnWidth = width;
  },
);

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });

const summaryInspection = await workbook.inspect({
  kind: "region",
  sheetId: "Summary",
  range: "A1:F17",
  maxChars: 5000,
});
console.log(summaryInspection.ndjson);
const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(formulaErrors.ndjson);

const previews = [
  ["Summary", "A1:F17", "summary.png"],
  ["Invoices", "A1:R30", "invoices.png"],
  ["Unmatched", "A1:H30", "unmatched.png"],
  ["Duplicate Groups", `A1:G${exactStart + 3}`, "duplicate-groups.png"],
  ["Jobs Without Invoices", "A1:D35", "jobs-without-invoices.png"],
  ["Review Links", `A1:J${reviewRows.length + 4}`, "review-links.png"],
  ["Amount Audit", `A1:L${amountAuditEndRow}`, "amount-audit.png"],
];
for (const [sheetName, range, filename] of previews) {
  const preview = await workbook.render({
    sheetName,
    range,
    scale: 1,
    format: "png",
  });
  await fs.writeFile(
    path.join(previewDir, filename),
    new Uint8Array(await preview.arrayBuffer()),
  );
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(
  JSON.stringify(
    {
      outputPath,
      previewDir,
      sheets: workbook.worksheets.items.map((sheet) => sheet.name),
      rows: {
        invoices: invoiceRows.length,
        unmatched: unmatchedRows.length,
        duplicateGroups: duplicateRows.length,
        jobsWithoutInvoices: jobRows.length,
        reviewLinks: reviewRows.length,
        amountAudit: amountAuditRows.length,
      },
    },
    null,
    2,
  ),
);
