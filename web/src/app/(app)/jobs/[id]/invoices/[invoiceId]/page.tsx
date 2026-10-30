import { notFound } from "next/navigation";
import { BillingEditor } from "@/components/billing-editor";
import { requireStaff } from "@/lib/auth";
import { draftFinalInvoice, getInvoice } from "@/lib/billing";
import { getDocumentExtras } from "@/lib/documents";
import { getProjectShell } from "@/lib/project-data";
import { getCatalogItems } from "@/lib/proposals";

export const dynamic = "force-dynamic";

function addDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("en-CA");
}

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; invoiceId: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const [{ id, invoiceId }, query] = await Promise.all([params, searchParams]);
  const jobId = decodeURIComponent(id);
  const isNew = invoiceId === "new";
  const final = isNew && query.kind === "final";
  const [shell, invoice, draft, catalog, extras] = await Promise.all([
    getProjectShell(jobId),
    isNew ? null : getInvoice(invoiceId),
    final ? draftFinalInvoice(jobId) : null,
    getCatalogItems(),
    isNew ? null : getDocumentExtras("invoice", invoiceId),
    requireStaff(),
  ]);
  if (!shell || shell.isLead || (!isNew && (!invoice || invoice.jobId !== jobId))) notFound();
  return (
    <BillingEditor
      key={invoice?.id ?? "new"}
      kind="invoice"
      id={invoice?.id ?? crypto.randomUUID()}
      jobId={jobId}
      isNew={isNew}
      invoice={invoice}
      catalog={catalog}
      extras={extras}
      initial={{
        name: invoice?.name ?? (final ? "Final invoice" : "Invoice"),
        items: invoice?.items ?? draft?.items ?? [],
        taxRatePercent: invoice?.taxRatePercent ?? draft?.taxRatePercent ?? 13,
        message: invoice?.notes ?? "",
        invoiceKind: invoice?.kind ?? (final ? "final" : "standard"),
        issuedOn: invoice?.issuedOn ?? addDays(0),
        dueOn: invoice ? (invoice.dueOn ?? "") : addDays(14),
      }}
      backHref={`/jobs/${encodeURIComponent(jobId)}/invoices`}
      backLabel={shell.name}
    />
  );
}
