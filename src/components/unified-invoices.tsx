import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { fmtDate, fmtMoney } from "@/lib/format";

export function UnifiedInvoicesTable({
  invoices,
  title = "Invoices",
  showJobAllocation = false,
}: {
  invoices: any[];
  title?: string;
  showJobAllocation?: boolean;
}) {
  if (!invoices.length) return <EmptyState>No invoices to show.</EmptyState>;
  return (
    <Card>
      <CardHeader title={title} subtitle="One accounting model with source evidence and job allocations" />
      <div className="overflow-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted)]">
              <th className="px-4 py-2.5">Date</th>
              <th className="px-4 py-2.5">Invoice</th>
              <th className="px-4 py-2.5">Contact</th>
              <th className="px-4 py-2.5">Type</th>
              <th className="px-4 py-2.5">Jobs</th>
              {showJobAllocation ? (
                <th className="px-4 py-2.5 text-right">Job allocation (pre-tax)</th>
              ) : null}
              <th className="px-4 py-2.5 text-right">Invoice total</th>
              <th className="px-4 py-2.5 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => {
              const jobAllocations = (invoice.allocations ?? []).filter(
                (allocation: any, index: number, allocations: any[]) =>
                  allocations.findIndex(
                    (candidate: any) => candidate.job_id === allocation.job_id,
                  ) === index,
              );
              const allocatedSubtotalCents = (invoice.allocations ?? []).reduce(
                (sum: number, allocation: any) =>
                  sum + Number(allocation.subtotal_cents ?? 0),
                0,
              );
              return (
              <tr key={invoice.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-3 text-[var(--color-muted)]">{fmtDate(invoice.issued_on)}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/invoices/${invoice.id}`}
                    aria-label={`Open invoice ${invoice.invoice_number}`}
                    className="inline-flex items-center gap-1 font-semibold text-[var(--color-brand-strong)] underline decoration-1 underline-offset-4 transition hover:decoration-2 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2"
                  >
                    <span>#{invoice.invoice_number}</span>
                    <span aria-hidden="true">→</span>
                  </Link>
                  <div className="text-xs text-[var(--color-muted)]">{invoice.status}</div>
                </td>
                <td className="px-4 py-3">{invoice.contact?.name ?? "Unassigned"}</td>
                <td className="px-4 py-3"><Badge tone={invoice.direction === "receivable" ? "good" : "neutral"}>{invoice.category}</Badge></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {jobAllocations.slice(0, 3).map((allocation: any) => (
                      <Link key={allocation.id} href={`/jobs/${allocation.job_id}`} className="text-xs text-[var(--color-brand-strong)] hover:underline">
                        {allocation.job?.name ?? allocation.job_id}
                      </Link>
                    ))}
                    {jobAllocations.length === 0 ? <span className="text-[var(--color-muted)]">—</span> : null}
                  </div>
                </td>
                {showJobAllocation ? (
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {fmtMoney(allocatedSubtotalCents / 100)}
                  </td>
                ) : null}
                <td className="px-4 py-3 text-right font-medium tabular-nums">{fmtMoney(Number(invoice.total_cents) / 100)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(Number(invoice.balance_cents) / 100)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
