import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Kpi } from "@/components/kpi";
import { Card, CardHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fmtDate, fmtMoney } from "@/lib/format";
import { getLedgerTransaction } from "@/lib/v2-accounting";

export const dynamic = "force-dynamic";

export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const transaction = await getLedgerTransaction(decodeURIComponent(id));
  if (!transaction) notFound();
  return (
    <>
      <div className="mb-4"><Link href="/financials" className="text-sm text-[var(--color-brand-strong)] hover:underline">← Financials</Link></div>
      <PageHeader title={transaction.counterparty ?? transaction.description} subtitle={`${fmtDate(transaction.posted_on)} · ${transaction.account?.name ?? "Account"}`} />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Amount" value={fmtMoney(Number(transaction.amount_cents) / 100)} />
        <Kpi label="Tax" value={fmtMoney(Number(transaction.tax_cents) / 100)} />
        <Kpi label="Category" value={transaction.category} hint={transaction.review_status} />
      </div>
      <Card>
        <CardHeader title="Allocations" subtitle="Invoices, jobs, and contacts supported by this transaction" />
        <div className="divide-y divide-[var(--color-border)]">
          {(transaction.allocations ?? []).map((allocation: any) => (
            <div key={allocation.id} className="flex justify-between gap-4 p-4 text-sm">
              <div>{allocation.invoice ? `Invoice ${allocation.invoice.invoice_number}` : allocation.job?.name ?? allocation.contact?.name ?? allocation.allocation_type}</div>
              <div>{fmtMoney(Number(allocation.amount_cents) / 100)}</div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
