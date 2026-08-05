import { PageHeader, Kpi } from "@/components/kpi";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fmtDate, fmtMoney } from "@/lib/format";
import { getMarketingPerformance } from "@/lib/v2-accounting";

export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  await requireStaff();
  const rows = await getMarketingPerformance();
  const spend = rows.reduce((sum, row) => sum + Number(row.spend_cents ?? 0), 0) / 100;
  const results = rows.reduce((sum, row) => sum + Number(row.results ?? 0), 0);
  const platforms = new Set(rows.map((row) => row.platform)).size;
  return (
    <>
      <PageHeader title="Marketing" subtitle="Spend and results from the unified performance table" />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Spend" value={fmtMoney(spend)} />
        <Kpi label="Results" value={results.toLocaleString("en-CA")} />
        <Kpi label="Platforms" value={platforms} />
      </div>
      <Card>
        <CardHeader title="Performance periods" subtitle="Daily, range, and monthly source records" />
        {rows.length ? (
          <div className="overflow-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b border-[var(--color-border)] text-left text-xs uppercase text-[var(--color-muted)]"><th className="px-4 py-2.5">Period</th><th className="px-4 py-2.5">Platform</th><th className="px-4 py-2.5">Purpose</th><th className="px-4 py-2.5 text-right">Results</th><th className="px-4 py-2.5 text-right">Spend</th></tr></thead>
              <tbody>{rows.map((row, index) => (
                <tr key={`${row.platform}-${row.period_start}-${row.purpose}-${index}`} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3">{fmtDate(row.period_start)}–{fmtDate(row.period_end)}</td>
                  <td className="px-4 py-3">{row.platform}</td>
                  <td className="px-4 py-3">{row.purpose}</td>
                  <td className="px-4 py-3 text-right">{Number(row.results ?? 0).toLocaleString("en-CA")}</td>
                  <td className="px-4 py-3 text-right">{fmtMoney(Number(row.spend_cents ?? 0) / 100)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState>No marketing performance.</EmptyState>}
      </Card>
    </>
  );
}
