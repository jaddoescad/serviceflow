import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source =
  "/Users/jadslim/.workspace-mcp/attachments/Invoice 278691 and 280975_3ffe9ae8.xlsx";
const outputDir =
  "/Users/jadslim/Desktop/ottawa-painters-admin/tmp/spreadsheets/phil-invoice-inspect";

const input = await FileBlob.load(source);
const workbook = await SpreadsheetFile.importXlsx(input);

const summary = await workbook.inspect({
  kind: "workbook,sheet,table,region,formula",
  maxChars: 12000,
  tableMaxRows: 60,
  tableMaxCols: 20,
  tableMaxCellChars: 200,
  options: { maxResults: 300 },
});
console.log(summary.ndjson);

const sheets = await workbook.inspect({
  kind: "sheet",
  include: "id,name",
  maxChars: 4000,
});
console.log(sheets.ndjson);

for (const sheet of workbook.worksheets.items) {
  const preview = await workbook.render({
    sheetName: sheet.name,
    autoCrop: "all",
    scale: 2,
    format: "png",
  });
  const safeName = sheet.name.replaceAll(/[^a-zA-Z0-9_-]+/g, "-");
  await fs.writeFile(
    `${outputDir}/${safeName}.png`,
    new Uint8Array(await preview.arrayBuffer()),
  );
}
