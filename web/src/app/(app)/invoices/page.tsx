import { InvoiceRows } from "@/components/invoice-rows";
import { PageHeader } from "@/components/kpi";
import { FilterPills, TablePanel, TableToolbar, statusFilterOptions } from "@/components/table-ui";
import { EmptyState } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { getInvoices } from "@/lib/billing";
import { INVOICE_STATUS, type InvoiceStatus } from "@/lib/billing-types";
import { fmtCents } from "@/lib/line-items";

export const dynamic = "force-dynamic";

const FILTERS: InvoiceStatus[] = ["open", "partial", "late", "paid", "draft", "void"];

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: requested } = await searchParams;
  const status = FILTERS.find((value) => value === requested) ?? null;
  const [, all] = await Promise.all([requireStaff(), getInvoices(null)]);
  const invoices = status ? all.filter((invoice) => invoice.status === status) : all;
  const outstanding = all
    .filter((invoice) => ["open", "partial", "late"].includes(invoice.status))
    .reduce((sum, invoice) => sum + invoice.balanceCents, 0);
  return (
    <div className="page-fill">
      <PageHeader title="Invoices" subtitle={`${fmtCents(outstanding)} outstanding`} />
      <TableToolbar>
        <FilterPills
          label="Invoice status"
          value={status ?? "all"}
          options={statusFilterOptions("/invoices", FILTERS, (value) => INVOICE_STATUS[value].label)}
        />
      </TableToolbar>
      <TablePanel fill>
        <InvoiceRows invoices={invoices} />
        {invoices.length ? null : (
          <EmptyState>{all.length ? "No invoices match this filter." : "No invoices yet. Create them from a job's Invoices tab."}</EmptyState>
        )}
      </TablePanel>
    </div>
  );
}
