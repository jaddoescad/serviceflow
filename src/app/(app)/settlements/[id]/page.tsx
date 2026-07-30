import Link from "next/link";
import { notFound } from "next/navigation";
import { Kpi, PageHeader } from "@/components/kpi";
import { Badge, Card, CardHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { getInvoiceBankMatchProposal } from "@/lib/invoice-bank-matching";

export const dynamic = "force-dynamic";

const currency = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function money(value: number) {
  return currency.format(value);
}

export default async function InvoicePaymentCandidatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const candidateId = decodeURIComponent(id);
  const [, candidate] = await Promise.all([
    requireStaff(),
    getInvoiceBankMatchProposal(candidateId),
  ]);

  if (!candidate) notFound();

  return (
    <>
      <div className="mb-4">
        <Link
          href="/settlements"
          className="text-sm font-medium text-[var(--color-brand-strong)] hover:underline"
        >
          ← Invoice payments
        </Link>
      </div>
      <PageHeader
        title={candidate.supplierName}
        subtitle="Review every source before creating a settlement allocation"
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={candidate.confidence === "high" ? "good" : "warn"}>
              {candidate.confidence} confidence
            </Badge>
            <Badge tone="brand">Not yet settled</Badge>
          </div>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Invoice outstanding" value={money(candidate.invoiceAmount)} />
        <Kpi label="Bank available" value={money(candidate.paymentAmount)} />
        <Kpi
          label="Difference"
          value={money(candidate.difference)}
          tone={Math.abs(candidate.difference) < 0.005 ? "good" : "warn"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader
            title="Invoice evidence"
            subtitle="Canonical invoice files; duplicate copies are excluded from the payable total"
            right={<Badge tone="neutral">{candidate.invoices.length}</Badge>}
          />
          <div className="divide-y divide-[var(--color-border)]">
            {candidate.invoices.map((invoice) => (
              <div key={invoice.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Link
                      href={`/invoices/${encodeURIComponent(invoice.id)}`}
                      className="font-medium text-[var(--color-brand-strong)] hover:underline"
                    >
                      Invoice #{invoice.invoiceNumber}
                    </Link>
                    <div className="mt-1 text-xs text-[var(--color-muted)]">
                      {fmtDate(invoice.invoiceDate)} · {invoice.originalFilename}
                    </div>
                  </div>
                  <div className="text-right text-sm font-semibold tabular-nums">
                    {money(invoice.remainingAmount)}
                    <div className="mt-1 text-xs font-normal text-[var(--color-muted)]">
                      {money(invoice.grossAmount)} gross
                    </div>
                  </div>
                </div>
                {invoice.duplicateVersionCount > 1 ? (
                  <div className="mt-3">
                    <Badge tone="neutral">
                      {invoice.duplicateVersionCount} duplicate file versions
                    </Badge>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title="Bank evidence"
            subtitle="Posted debit minus every active invoice, bonus, and other allocation"
            right={<Badge tone="neutral">{candidate.payments.length}</Badge>}
          />
          <div className="divide-y divide-[var(--color-border)]">
            {candidate.payments.map((payment) => (
              <div key={payment.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Link
                      href={`/financials/transactions/${encodeURIComponent(payment.id)}`}
                      className="font-medium text-[var(--color-brand-strong)] hover:underline"
                    >
                      {fmtDate(payment.postedOn)} · {payment.description}
                    </Link>
                    <div className="mt-1 text-xs text-[var(--color-muted)]">
                      {payment.accountName} •••• {payment.accountLastFour ?? "—"} ·{" "}
                      {payment.sourceFilename}
                    </div>
                  </div>
                  <div className="text-right text-sm font-semibold tabular-nums">
                    {money(payment.availableAmount)}
                    <div className="mt-1 text-xs font-normal text-[var(--color-muted)]">
                      {money(payment.paymentAmount)} posted
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <span className="text-[var(--color-muted)]">Recipient: </span>
                    {payment.recipientName ??
                      payment.supplierName ??
                      payment.counterparty ??
                      "Unknown"}
                  </div>
                  <div>
                    <span className="text-[var(--color-muted)]">Email: </span>
                    {payment.recipientEmail ?? "Not in bank evidence"}
                  </div>
                  <div>
                    <span className="text-[var(--color-muted)]">Confirmation: </span>
                    {payment.confirmationSuffix ?? "Not available"}
                  </div>
                  <div>
                    <span className="text-[var(--color-muted)]">Identity: </span>
                    <Badge
                      tone={
                        payment.recipientStatus === "confirmed" ? "good" : "warn"
                      }
                    >
                      {payment.recipientStatus === "confirmed"
                        ? "Confirmed"
                        : "Not verified"}
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader
          title="Why this candidate exists"
          subtitle="Deterministic rules used for this suggestion"
        />
        <ul className="space-y-2 px-5 py-4 text-sm text-[var(--color-text)]">
          {candidate.evidence.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-[var(--color-good)]">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-5 py-3 text-xs text-[var(--color-muted)]">
          This page does not write to accounting records. A separate confirmation
          action can be added after these rules and evidence are approved.
        </div>
      </Card>
    </>
  );
}
