"use client";

import { DataTable, TablePanel, Td, Th, Tr } from "./table-ui";
import { Button, EmptyState } from "./ui";

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Report rows as a table, downloadable as CSV. Columns holding only numbers
 * are right-aligned; a column with any fractional value shows two decimals. */
export function ReportTable({
  rows,
  columns,
  filename,
}: {
  rows: Record<string, unknown>[];
  columns: string[];
  filename: string;
}) {
  function download() {
    const csv = [columns.map(csvCell).join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }
  const numeric = new Map(
    columns
      .filter((column) => rows.some((row) => typeof row[column] === "number") && rows.every((row) => row[column] == null || typeof row[column] === "number"))
      .map((column) => [column, rows.some((row) => !Number.isInteger(row[column] ?? 0)) ? 2 : 0]),
  );
  const show = (column: string, value: unknown) => {
    if (value == null) return "—";
    const digits = numeric.get(column);
    return digits === undefined
      ? String(value)
      : (value as number).toLocaleString("en-CA", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  };
  return (
    <TablePanel
      fill
      footer={
        <>
          <span>
            {rows.length} {rows.length === 1 ? "row" : "rows"}
          </span>
          <Button variant="secondary" size="sm" disabled={!rows.length} onClick={download}>
            Download CSV
          </Button>
        </>
      }
    >
      <DataTable>
        <thead>
          <tr>
            {columns.map((column) => (
              <Th key={column} numeric={numeric.has(column)}>
                {column}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <Tr key={index}>
              {columns.map((column) => (
                <Td key={column} numeric={numeric.has(column)} className="whitespace-nowrap">
                  {show(column, row[column])}
                </Td>
              ))}
            </Tr>
          ))}
        </tbody>
      </DataTable>
      {rows.length ? null : <EmptyState>No rows for this report and period.</EmptyState>}
    </TablePanel>
  );
}
