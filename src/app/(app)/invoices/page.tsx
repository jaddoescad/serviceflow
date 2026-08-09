import { PageHeader, Kpi } from "@/components/kpi";
import { UnifiedInvoicesTable } from "@/components/unified-invoices";
import { requireStaff } from "@/lib/auth";
import { getUnifiedInvoices } from "@/lib/v2-accounting";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  await requireStaff();
  const invoices = await getUnifiedInvoices("labour");
  const settled = invoices.filter((invoice) => Number(invoice.balance_cents) === 0).length;
  const allocated = invoices.filter((invoice) => (invoice.allocations ?? []).length > 0).length;
  const needsAllocation = invoices.length - allocated;
  return (
    <>
      <PageHeader title="Labour invoices" subtitle="Painter and subcontractor invoices, payments, and job allocations" />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Labour invoices" value={invoices.length} hint="hourly and subcontractor" />
        <Kpi label="Settled" value={settled} hint="zero remaining balance" tone="good" />
        <Kpi label="Job allocated" value={allocated} hint={`${needsAllocation} still unallocated`} tone={needsAllocation ? "warn" : "good"} />
      </div>
      <UnifiedInvoicesTable invoices={invoices} title="Labour invoices" />
    </>
  );
}
