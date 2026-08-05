import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { fmtDate, fmtMoney } from "@/lib/format";

export function UnifiedInvoicesTable({
  invoices,
  title = "Invoices",
}: {
  invoices: any[];
  title?: string;
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
              <th className="px-4 py-2.5 text-right">Total</th>
              <th className="px-4 py-2.5 text-right">Balance</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id} className="border-b border-[var(--color-border)] last:border-0">
                <td className="px-4 py-3 text-[var(--color-muted)]">{fmtDate(invoice.issued_on)}</td>
                <td className="px-4 py-3">
                  <Link href={`/invoices/${invoice.id}`} className="font-medium text-[var(--color-heading)] hover:underline">
                    {invoice.invoice_number}
                  </Link>
                  <div className="text-xs text-[var(--color-muted)]">{invoice.status}</div>
                </td>
                <td className="px-4 py-3">{invoice.contact?.name ?? "Unassigned"}</td>
                <td className="px-4 py-3"><Badge tone={invoice.direction === "receivable" ? "good" : "neutral"}>{invoice.category}</Badge></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(invoice.allocations ?? []).slice(0, 3).map((allocation: any) => (
                      <Link key={allocation.id} href={`/jobs/${allocation.job_id}`} className="text-xs text-[var(--color-brand-strong)] hover:underline">
                        {allocation.job?.name ?? allocation.job_id}
                      </Link>
                    ))}
                    {(invoice.allocations ?? []).length === 0 ? <span className="text-[var(--color-muted)]">—</span> : null}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">{fmtMoney(Number(invoice.total_cents) / 100)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(Number(invoice.balance_cents) / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
