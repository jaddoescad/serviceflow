import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

for (const sourcePath of process.argv.slice(2)) {
  const input = await FileBlob.load(sourcePath);
  const workbook = await SpreadsheetFile.importXlsx(input);
  const inspection = await workbook.inspect({
    kind: "workbook,sheet,table",
    include: "id,name,values,formulas",
    maxChars: 20_000,
    tableMaxRows: 100,
    tableMaxCols: 30,
    tableMaxCellChars: 200,
  });

  console.log(`===== ${sourcePath} =====`);
  console.log(inspection.ndjson);
}
