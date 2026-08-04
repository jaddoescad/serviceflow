import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import type { ProjectMaterialInvoice } from "@/lib/materials";

const CAD_FORMATTER = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});

function money(value: number) {
  return CAD_FORMATTER.format(value);
}

export function ProjectMaterialInvoices({
  invoices,
}: {
  invoices: ProjectMaterialInvoice[];
}) {
  const beforeTax = invoices.reduce(
    (sum, invoice) => sum + invoice.amountBeforeTax,
    0,
  );
  const tax = invoices.reduce((sum, invoice) => sum + invoice.taxAmount, 0);
  const total = invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0);

  return (
    <Card className="mt-6 overflow-hidden">
      <CardHeader
        title="Material job costs"
        subtitle="Only supplier lines allocated to this job are included; HST stays visible and separate"
        right={
          <div className="flex items-center gap-2">
            <Badge tone="neutral">{invoices.length} invoices</Badge>
            <span className="text-sm font-semibold tabular-nums text-[var(--color-heading)]">
              {money(beforeTax)} before HST
            </span>
          </div>
        }
      />
      {invoices.length ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-[13px]">
              <thead className="border-b border-[var(--color-border)] text-[11px] uppercase tracking-[0.08em] text-[var(--color-muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Supplier / invoice</th>
                  <th className="px-4 py-2.5 font-medium">PO</th>
                  <th className="px-4 py-2.5 text-right font-medium">Lines</th>
                  <th className="px-4 py-2.5 text-right font-medium">Before HST</th>
                  <th className="px-4 py-2.5 text-right font-medium">HST</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {invoices.map((invoice) => (
                  <tr key={invoice.invoiceId}>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums text-[var(--color-muted)]">
                      {fmtDate(invoice.invoiceDate)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/material-invoices/${encodeURIComponent(invoice.invoiceId)}`}
                        className="font-semibold text-[var(--color-heading)] hover:text-[var(--color-brand-strong)] hover:underline"
                      >
                        {invoice.supplierName}
                      </Link>
                      <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                        Invoice #{invoice.invoiceNumber}
                      </div>
                    </td>
                    <td className="px-4 py-3">{invoice.poNumber ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {invoice.lineCount}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {money(invoice.amountBeforeTax)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--color-muted)]">
                      {money(invoice.taxAmount)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {money(invoice.totalAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] font-semibold">
                <tr>
                  <td colSpan={4} className="px-4 py-3">
                    Allocated material cost
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {money(beforeTax)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {money(tax)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {money(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      ) : (
        <EmptyState>No material invoice lines are connected to this job.</EmptyState>
      )}
    </Card>
  );
}
