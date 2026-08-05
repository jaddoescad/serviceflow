import { PageHeader, Kpi } from "@/components/kpi";
import { UnifiedInvoicesTable } from "@/components/unified-invoices";
import { requireStaff } from "@/lib/auth";
import { getUnifiedInvoices } from "@/lib/v2-accounting";

export const dynamic = "force-dynamic";

export default async function MaterialInvoicesPage() {
  await requireStaff();
  const invoices = await getUnifiedInvoices("material");
  const settled = invoices.filter((invoice) => Number(invoice.balance_cents) === 0).length;
  const allocated = invoices.filter((invoice) => (invoice.allocations ?? []).length > 0).length;
  const credits = invoices.filter((invoice) => Number(invoice.total_cents) < 0).length;
  return (
    <>
      <PageHeader title="Material invoices" subtitle="Supplier documents, product lines, credits, payments, and job costs" />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Invoices" value={invoices.length} hint={`${credits} credits`} />
        <Kpi label="Settled" value={settled} hint="zero remaining balance" tone="good" />
        <Kpi label="Job allocated" value={allocated} hint="overhead remains unassigned by design" />
      </div>
      <UnifiedInvoicesTable invoices={invoices} title="Material invoices and credits" />
    </>
  );
}
