import { requireStaff } from "@/lib/auth";
import { getLabourInvoices } from "@/lib/invoice-queries";
import { PageHeader, Kpi } from "@/components/kpi";
import { LabourInvoicesTable } from "@/components/labour-invoices-table";

export const dynamic = "force-dynamic";

export default async function LabourInvoicesPage() {
  const [, invoices] = await Promise.all([requireStaff(), getLabourInvoices()]);
  const matched = invoices.filter((invoice) =>
    ["matched", "matched_multiple"].includes(invoice.match_status),
  ).length;
  const unmatched = invoices.filter(
    (invoice) => invoice.match_status === "unmatched",
  ).length;
  const duplicateGroups = new Set(
    invoices
      .map((invoice) => invoice.duplicate_group_id)
      .filter((group): group is string => Boolean(group)),
  ).size;
  const amountsCaptured = invoices.filter(
    (invoice) => invoice.amount_paid != null,
  ).length;

  return (
    <>
      <PageHeader
        title="Labour Invoices"
        subtitle="Private invoice archive with the amount paid and linked CompanyCam jobs"
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Archived files"
          value={invoices.length}
          hint={`${matched} matched to at least one job`}
        />
        <Kpi
          label="Unmatched"
          value={unmatched}
          hint="Needs a reliable job reference"
          tone={unmatched ? "warn" : "good"}
        />
        <Kpi
          label="Duplicate groups"
          value={duplicateGroups}
          hint="Includes revisions and payment copies"
          tone={duplicateGroups ? "warn" : "good"}
        />
        <Kpi
          label="Amounts captured"
          value={amountsCaptured}
          hint="Per-file totals; duplicate versions are not summed"
        />
      </div>
      <LabourInvoicesTable invoices={invoices} />
    </>
  );
}
