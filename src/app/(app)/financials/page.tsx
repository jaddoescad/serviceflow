import Link from "next/link";
import { PageHeader, Kpi } from "@/components/kpi";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fmtDate, fmtMoney } from "@/lib/format";
import { getLedger } from "@/lib/v2-accounting";

export const dynamic = "force-dynamic";

export default async function FinancialsPage() {
  await requireStaff();
  const { accounts, transactions } = await getLedger();
  const income = transactions.filter((row) => Number(row.amount_cents) > 0).reduce((sum, row) => sum + Number(row.amount_cents), 0) / 100;
  const expenses = Math.abs(transactions.filter((row) => Number(row.amount_cents) < 0).reduce((sum, row) => sum + Number(row.amount_cents), 0)) / 100;
  const needsReview = transactions.filter((row) => row.review_status !== "verified").length;
  return (
    <>
      <PageHeader title="Financials" subtitle="Bank transactions, payments, credits, and invoice allocations" />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Income" value={fmtMoney(income)} hint="all imported transactions" tone="good" />
        <Kpi label="Expenses" value={fmtMoney(expenses)} hint="all imported transactions" />
        <Kpi label="Net cash" value={fmtMoney(income - expenses)} />
        <Kpi label="Needs review" value={needsReview} hint={`${accounts.length} accounts`} tone={needsReview ? "warn" : "good"} />
      </div>
      <Card>
        <CardHeader title="Transactions" subtitle="Newest imported bank activity" />
        {transactions.length ? (
          <div className="overflow-auto">
            <table className="w-full min-w-[850px] text-sm">
              <thead><tr className="border-b border-[var(--color-border)] text-left text-xs uppercase text-[var(--color-muted)]"><th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Description</th><th className="px-4 py-2.5">Account</th><th className="px-4 py-2.5">Category</th><th className="px-4 py-2.5 text-right">Amount</th></tr></thead>
              <tbody>{transactions.map((row) => (
                <tr key={row.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3 text-[var(--color-muted)]">{fmtDate(row.posted_on)}</td>
                  <td className="px-4 py-3"><Link href={`/financials/transactions/${row.id}`} className="font-medium hover:underline">{row.counterparty ?? row.description}</Link><div className="text-xs text-[var(--color-muted)]">{row.description}</div></td>
                  <td className="px-4 py-3">{row.account?.name ?? "Account"}</td>
                  <td className="px-4 py-3"><Badge tone={row.review_status === "verified" ? "good" : "neutral"}>{row.category}</Badge></td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{fmtMoney(Number(row.amount_cents) / 100)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState>No transactions.</EmptyState>}
      </Card>
    </>
  );
}
