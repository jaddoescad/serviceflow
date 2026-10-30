import { PageHeader } from "@/components/kpi";
import { RangePicker } from "@/components/range-picker";
import { ReportTable } from "@/components/report-table";
import { TablePanel, TableToolbar } from "@/components/table-ui";
import { Button, EmptyState, Select } from "@/components/ui";
import { getReport } from "@/lib/actions/crm";
import { requireStaff } from "@/lib/auth";
import { REPORT_COLUMNS, REPORT_LABELS, type ReportKind } from "@/lib/crm-types";
import { resolveRange } from "@/lib/date-ranges";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; preset?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const report = (Object.keys(REPORT_LABELS) as ReportKind[]).find((key) => key === params.report) ?? null;
  const range = resolveRange(params);
  await requireStaff();
  const rows = report ? await getReport(report, range.from, range.to) : null;
  return (
    <div className="page-fill">
      <PageHeader title="Reports" />
      <TableToolbar>
        <form action="/reports" className="flex items-center gap-2">
          <input type="hidden" name="from" value={range.from} />
          <input type="hidden" name="to" value={range.to} />
          <Select name="report" aria-label="Report" defaultValue={report ?? ""}>
            <option value="" disabled>
              Select a report
            </option>
            {(Object.keys(REPORT_LABELS) as ReportKind[]).map((key) => (
              <option key={key} value={key}>
                {REPORT_LABELS[key]}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">
            Run
          </Button>
        </form>
        {report ? (
          <RangePicker path="/reports" preset={range.preset} from={range.from} to={range.to} extra={{ report }} />
        ) : null}
      </TableToolbar>
      {report && rows ? (
        <ReportTable rows={rows} columns={REPORT_COLUMNS[report]} filename={`${report}-${range.from}-to-${range.to}.csv`} />
      ) : (
        <TablePanel fill>
          <div className="flex h-full items-center justify-center">
            <EmptyState>Pick a report and run it.</EmptyState>
          </div>
        </TablePanel>
      )}
    </div>
  );
}
