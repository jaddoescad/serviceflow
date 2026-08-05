import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Kpi } from "@/components/kpi";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fmtDate, fmtMoney } from "@/lib/format";
import { getUnifiedInvoice } from "@/lib/v2-accounting";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const invoice = await getUnifiedInvoice(decodeURIComponent(id));
  if (!invoice) notFound();
  return (
    <>
      <div className="mb-4"><Link href="/invoices" className="text-sm text-[var(--color-brand-strong)] hover:underline">← Invoices</Link></div>
      <PageHeader
        title={`Invoice ${invoice.invoice_number}`}
        subtitle={`${invoice.contact?.name ?? "Unassigned"} · ${fmtDate(invoice.issued_on)}`}
        actions={<Badge tone={invoice.direction === "receivable" ? "good" : "neutral"}>{invoice.category}</Badge>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Before tax" value={fmtMoney(Number(invoice.subtotal_cents) / 100)} />
        <Kpi label="Tax" value={fmtMoney(Number(invoice.tax_cents) / 100)} />
        <Kpi label="Total" value={fmtMoney(Number(invoice.total_cents) / 100)} />
        <Kpi label="Balance" value={fmtMoney(Number(invoice.balance_cents) / 100)} tone={Number(invoice.balance_cents) ? "warn" : "good"} />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Lines" subtitle="Exact items preserved from the source invoice" />
          <div className="divide-y divide-[var(--color-border)]">
            {(invoice.lines ?? []).map((line: any) => (
              <div key={line.id} className="flex justify-between gap-4 p-4 text-sm">
                <div><div className="font-medium">{line.description}</div><div className="text-xs text-[var(--color-muted)]">Line {line.line_number}</div></div>
                <div className="font-medium tabular-nums">{fmtMoney(Number(line.total_cents) / 100)}</div>
              </div>
            ))}
            {!(invoice.lines ?? []).length ? <EmptyState>No invoice lines.</EmptyState> : null}
          </div>
        </Card>
        <Card>
          <CardHeader title="Jobs and evidence" subtitle="Allocations and original documents remain linked" />
          <div className="space-y-3 p-4 text-sm">
            {(invoice.allocations ?? []).map((allocation: any) => (
              <Link key={allocation.id} href={`/jobs/${allocation.job_id}`} className="flex justify-between hover:underline">
                <span>{allocation.job?.name ?? allocation.job_id}</span>
                <span>{fmtMoney(Number(allocation.total_cents) / 100)}</span>
              </Link>
            ))}
            {(invoice.evidence ?? []).map((evidence: any) => (
              <div key={evidence.id} className="text-[var(--color-muted)]">Document: {evidence.document?.original_filename ?? evidence.evidence_role}</div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
