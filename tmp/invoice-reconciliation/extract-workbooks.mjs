import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputDir = "/Users/jadslim/Desktop/Labour Invoices - 2026-07-25";
const outputPath =
  "/Users/jadslim/Desktop/ottawa-painters-admin/tmp/invoice-reconciliation/workbooks.json";

const filenames = (await fs.readdir(inputDir))
  .filter((name) => name.toLowerCase().endsWith(".xlsx"))
  .sort();
const output = [];

for (const filename of filenames) {
  const fullPath = path.join(inputDir, filename);
  const input = await FileBlob.load(fullPath);
  const workbook = await SpreadsheetFile.importXlsx(input);
  const sheetSummary = await workbook.inspect({
    kind: "sheet",
    include: "id,name",
    maxChars: 5000,
  });
  const sheets = [];

  for (const sheet of workbook.worksheets.items) {
    const used = sheet.getUsedRange();
    sheets.push({
      name: sheet.name,
      address: used?.address ?? null,
      values: used?.values ?? [],
      formulas: used?.formulas ?? [],
    });
  }

  output.push({
    source_path: fullPath,
    source_filename: filename,
    sheet_summary: sheetSummary.ndjson,
    sheets,
  });
}

await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify({ workbooks: output.length, outputPath }, null, 2));
