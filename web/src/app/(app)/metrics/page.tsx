import { PageHeader } from "@/components/kpi";
import { RangePicker } from "@/components/range-picker";
import { DataTable, TablePanel, Td, Th, Tr } from "@/components/table-ui";
import { EmptyState, Stat, StatGrid } from "@/components/ui";
import { getSalesMetrics } from "@/lib/actions/crm";
import { requireStaff } from "@/lib/auth";
import { resolveRange } from "@/lib/date-ranges";
import { fmtDate } from "@/lib/format";
import { fmtCents } from "@/lib/line-items";

export const dynamic = "force-dynamic";

const percent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "—");

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 text-sm font-semibold text-[var(--color-heading)]">{children}</h2>;
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const range = resolveRange(await searchParams);
  await requireStaff();
  const metrics = await getSalesMetrics(range.from, range.to);
  return (
    <>
      <PageHeader
        title="Metrics"
        subtitle={`${fmtDate(range.from)} – ${fmtDate(range.to)}`}
        actions={<RangePicker path="/metrics" preset={range.preset} from={range.from} to={range.to} />}
      />
      <SectionLabel>Revenue &amp; wins</SectionLabel>
      <StatGrid columns={3} className="mb-6">
        <Stat label="Sales" value={fmtCents(metrics.salesCents)} hint="Accepted proposals" />
        <Stat label="Jobs won" value={metrics.jobsWon} hint="Accepted proposals" />
        <Stat
          label="Avg job size"
          value={metrics.jobsWon ? fmtCents(Math.round(metrics.salesCents / metrics.jobsWon)) : "—"}
          hint="Sales per job won"
        />
      </StatGrid>
      <SectionLabel>Conversions &amp; volume</SectionLabel>
      <StatGrid columns={4} className="mb-6">
        <Stat label="Closing ratio" value={percent(metrics.jobsWon, metrics.proposalsSent)} hint={`${metrics.jobsWon} won of ${metrics.proposalsSent} proposals sent`} />
        <Stat label="Set rate" value={percent(metrics.booked, metrics.leads)} hint={`${metrics.booked} of ${metrics.leads} new leads reached an estimate`} />
        <Stat label="New leads" value={metrics.leads} />
        <Stat label="Appointments" value={metrics.appointments} hint="Booked in this period" />
      </StatGrid>
      <SectionLabel>By lead source</SectionLabel>
      <TablePanel>
        <DataTable minWidth={560}>
          <thead>
            <tr>
              <Th>Source</Th>
              <Th numeric>Leads</Th>
              <Th numeric>Set rate</Th>
              <Th numeric>Jobs won</Th>
              <Th numeric>Sales</Th>
            </tr>
          </thead>
          <tbody>
            {metrics.bySource.map((row) => (
              <Tr key={row.source}>
                <Td className="font-medium text-[var(--color-heading)]">{row.source}</Td>
                <Td numeric>{row.leads}</Td>
                <Td numeric>{percent(row.booked, row.leads)}</Td>
                <Td numeric>{row.jobsWon}</Td>
                <Td numeric>{fmtCents(row.salesCents)}</Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
        {metrics.bySource.length ? null : <EmptyState>No leads or wins in this period.</EmptyState>}
      </TablePanel>
    </>
  );
}
