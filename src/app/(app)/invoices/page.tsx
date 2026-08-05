import { PageHeader, Kpi } from "@/components/kpi";
import { UnifiedInvoicesTable } from "@/components/unified-invoices";
import { requireStaff } from "@/lib/auth";
import { getUnifiedInvoices } from "@/lib/v2-accounting";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  await requireStaff();
  const invoices = await getUnifiedInvoices();
  const labour = invoices.filter((invoice) => invoice.category === "labour").length;
  const materials = invoices.filter((invoice) => invoice.category === "material").length;
  const customers = invoices.filter((invoice) => invoice.category === "customer").length;
  const needsAllocation = invoices.filter((invoice) => !(invoice.allocations ?? []).length).length;
  return (
    <>
      <PageHeader title="Invoices" subtitle="Customer, labour, and material invoices in one accounting model" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Customer" value={customers} hint="receivable invoices" />
        <Kpi label="Labour" value={labour} hint="payable painter invoices" />
        <Kpi label="Material" value={materials} hint="payable supplier invoices" />
        <Kpi label="No job allocation" value={needsAllocation} hint="includes legitimate overhead" tone={needsAllocation ? "warn" : "good"} />
      </div>
      <UnifiedInvoicesTable invoices={invoices} />
    </>
  );
}
